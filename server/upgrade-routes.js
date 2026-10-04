import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';
import { effectivePhoto, selectSourceIds } from './library-service.js';

export function installUpgradeRoutes(app, deps) {
  const { loadConfig, getDb, tasks, createTask, rowToPhoto, readPhoto, dataDir, renderPreview, pauseTasks, closeDb } = deps;
  const route = (method, url, handler) => app[method](url, async (req,res) => {
    try { await handler(req,res); } catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  });
  const photo = (db,id) => {
    const row = readPhoto(db,id);
    if (!row) throw new Error('照片不存在');
    return effectivePhoto(rowToPhoto(row),row);
  };
  route('post','/api/process', async (req,res) => { res.status(202).json({ taskId: await createTask(req.body,req.body.mode === 'rerun' ? 'rerun' : 'new') }); });
  route('post','/api/rerender', async (req,res) => { res.status(202).json({ taskId: await createTask(req.body,'rerender') }); });
  route('get','/api/tasks',async (_req,res) => res.json(await tasks.list()));
  route('get','/api/tasks/:id',async (req,res) => {
    const task = await tasks.get(req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json(task);
  });
  for (const action of ['pause','resume','cancel','retry']) route('post',`/api/tasks/:id/${action}`,async (req,res) => res.json(await tasks.control(req.params.id,action,req.body?.sourceIds)));
  route('post','/api/process/stop',async (_req,res) => {
    const task = await tasks.latest();
    if (task && ['running','queued'].includes(task.status)) await tasks.control(task.id,'pause');
    res.json({ stopping: true });
  });
  route('get','/api/process/progress',async (_req,res) => res.json({ aguiEvents: deps.events(), ...(await tasks.latest() || { status:'idle',total:0,done:0,succeeded:0,failed:0,tokenTotal:0,message:'' }) }));
  route('get','/api/thumbnails/:id',async (req,res) => {
    const config = await loadConfig();
    const db = await getDb(config);
    const source = db.prepare('select * from source_photos where id=?').get(req.params.id);
    if (!source) return res.status(404).json({ error:'来源不存在' });
    const stat = await fs.stat(source.source_path);
    const key = crypto.createHash('sha256').update(`${source.id}:${stat.size}:${stat.mtimeMs}`).digest('hex');
    const directory = path.join(dataDir(config),'thumbnails');
    await fs.mkdir(directory,{ recursive:true });
    const target = path.join(directory,key+'.jpg');
    try { await fs.access(target); } catch {
      const temporary = target+'.'+crypto.randomUUID()+'.tmp';
      try {
        await sharp(source.source_path).rotate().resize(480,480,{ fit:'inside',withoutEnlargement:true }).jpeg({ quality:78 }).toFile(temporary);
        await fs.rename(temporary,target);
      } finally { await fs.rm(temporary,{ force:true }); }
    }
    // Conditional caching preserves freshness even if a source changes before a rescan.
    res.setHeader('Cache-Control','private, max-age=0, must-revalidate');
    res.sendFile(target);
  });
  route('get','/api/photos/:id',async (req,res) => { const db = await getDb(await loadConfig()); res.json(photo(db,req.params.id)); });
  route('patch','/api/photos/:id',async (req,res) => {
    if (tasks.busy) throw new Error('请先暂停正在运行的任务');
    const config = await loadConfig();
    const db = await getDb(config);
    const original = readPhoto(db,req.params.id);
    if (!original) return res.status(404).json({ error:'照片不存在' });
    let edits = req.body.restoreAI ? {} : JSON.parse(original.manual_edits || '{}');
    if (req.body.manualEdits) {
      for (const key of ['sideCaption','capturedDate','location']) {
        if (req.body.manualEdits[key] === undefined) continue;
        const value = String(req.body.manualEdits[key]);
        if (value.length > (key === 'sideCaption' ? 200 : 120)) throw new Error('编辑内容过长');
        if (key === 'capturedDate' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0,10) !== value)) throw new Error('日期格式应为 YYYY-MM-DD');
        edits[key] = value;
      }
    }
    db.prepare('update processed_photos set manual_edits=?,wallpaper_excluded=? where id=?').run(JSON.stringify(edits),req.body.wallpaperExcluded === undefined ? original.wallpaper_excluded : Number(Boolean(req.body.wallpaperExcluded)),req.params.id);
    const taskId = req.body.manualEdits || req.body.restoreAI ? await createTask({ sourceIds:[original.source_id] },'rerender') : undefined;
    res.json({ ...photo(db,req.params.id), taskId });
  });
  route('post','/api/photos/:id/representative',async (req,res) => {
    const db = await getDb(await loadConfig());
    const row = readPhoto(db,req.params.id);
    if (!row) throw new Error('照片不存在');
    const group = row.similar_group_id || row.id;
    db.prepare("update processed_photos set is_representative=case when id=? then 1 else 0 end,group_override=? where similar_group_id=? or id=?").run(row.id,JSON.stringify({ group,representative:row.id }),group,row.id);
    res.json(photo(db,row.id));
  });
  route('post','/api/photos/:id/split-group',async (req,res) => {
    const db = await getDb(await loadConfig());
    const row = readPhoto(db,req.params.id);
    if (!row) throw new Error('照片不存在');
    db.prepare("update processed_photos set similar_group_id='',is_representative=1,group_override=? where id=?").run(JSON.stringify({ group:'',representative:row.id }),row.id);
    if (row.similar_group_id && !db.prepare('select id from processed_photos where similar_group_id=? and is_representative=1').get(row.similar_group_id)) {
      const next = db.prepare('select id from processed_photos where similar_group_id=? order by memory_score desc,id limit 1').get(row.similar_group_id);
      if (next) db.prepare('update processed_photos set is_representative=case when id=? then 1 else 0 end,group_override=? where similar_group_id=?').run(next.id,JSON.stringify({ group:row.similar_group_id,representative:next.id }),row.similar_group_id);
    }
    res.json(photo(db,row.id));
  });
  route('post','/api/photos/batch',async (req,res) => {
    const db = await getDb(await loadConfig());
    const ids = req.body.selection ? selectSourceIds(db,req.body.selection,true) : [...new Set(req.body.sourceIds || [])];
    if (!['curated','wallpaperExcluded'].includes(req.body.action)) throw new Error('不支持的批量操作');
    db.exec('begin immediate');
    try {
      let changed = 0;
      for (const id of ids) {
        const row = db.prepare('select id from processed_photos where source_id=?').get(id);
        if (!row) continue;
        if (req.body.action === 'curated') {
          if (req.body.value) db.prepare('insert or ignore into curated_photos values(?,?)').run(row.id,new Date().toISOString());
          else db.prepare('delete from curated_photos where photo_id=?').run(row.id);
        } else db.prepare('update processed_photos set wallpaper_excluded=? where id=?').run(Number(Boolean(req.body.value)),row.id);
        changed++;
      }
      db.exec('commit'); res.json({ changed });
    } catch (error) { db.exec('rollback'); throw error; }
  });
  route('post','/api/system/select-directory',async (_req,res) => {
    if (!globalThis.inktimeDesktop?.selectDirectory) throw new Error('请在桌面应用中选择目录，浏览器开发模式可在设置中输入路径');
    res.json({ path:await globalThis.inktimeDesktop.selectDirectory() });
  });
  route('post','/api/models/check',async (_req,res) => {
    const config = await loadConfig();
    if (!/localhost|127\.0\.0\.1|:11434/.test(config.providerBaseUrl)) return res.json({ ok:Boolean(config.apiKeyEnvName && process.env[config.apiKeyEnvName]),message:'云模型请通过试处理验证接口与权限' });
    const response = await fetch(config.providerBaseUrl.replace(/\/api\/chat\/?$/,'').replace(/\/$/,'')+'/api/tags',{ signal:AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('无法获取本地模型列表');
    const payload = await response.json();
    const models = (payload.models || []).map(item => item.name);
    const ok = models.includes(config.model);
    res.json({ ok,models,message:ok ? '模型已就绪' : `未找到 ${config.model}，请在 Ollama 中安装或更换模型` });
  });
  route('post','/api/layout/preview',async (req,res) => res.json({ url:await renderPreview(req.body) }));
  route('get','/api/wallpaper/status',async (_req,res) => {
    const config = await loadConfig(); const db = await getDb(config);
    const history = db.prepare('select h.*,s.file_name,p.wallpaper_url as url from wallpaper_history h join processed_photos p on p.id=h.photo_id join source_photos s on s.id=p.source_id order by set_at desc limit 20').all().map(row => ({ ...row,photoId:row.photo_id,fileName:row.file_name,setAt:row.set_at,url:"/wallpapers/"+encodeURIComponent(path.basename(row.wallpaper_path)) }));
    let saved = {};
    try { saved = JSON.parse(await fs.readFile(path.join(dataDir(config),'wallpaper-status.json'),'utf8')); } catch {}
    const interval = config.wallpaperAutoIntervalHours;
    const next = new Date(); next.setMinutes(0,0,0); next.setHours(next.getHours()+1);
    if (interval > 0) while (next.getHours()%interval !== 0) next.setHours(next.getHours()+1);
    res.json({ ...saved,current:history[0] || null,history,nextUpdateAt:interval > 0 ? next.toISOString() : null,lastError:saved.lastError || '',screen:globalThis.inktimeDesktop?.getScreen?.() || { width:config.wallpaperWidth,height:config.wallpaperHeight } });
  });
  route('get','/api/library/backups',async (_req,res) => {
    const config = await loadConfig(); const dir = path.join(dataDir(config),'backups');
    await fs.mkdir(dir,{ recursive:true });
    const names = (await fs.readdir(dir)).filter(name => name.endsWith('.sqlite')).sort().reverse();
    res.json(await Promise.all(names.map(async fileName => ({ fileName,size:(await fs.stat(path.join(dir,fileName))).size }))));
  });
  route('post','/api/library/backup',async (_req,res) => {
    const config = await loadConfig(); const db = await getDb(config);
    const dir = path.join(dataDir(config),'backups'); await fs.mkdir(dir,{ recursive:true });
    const fileName = `manual-${Date.now()}.sqlite`;
    db.exec(`vacuum into '${path.join(dir,fileName).replaceAll("'","''")}'`);
    res.json({ fileName });
  });
  route('post','/api/library/restore',async (req,res) => {
    const name = String(req.body.fileName || '');
    if (!name || path.basename(name) !== name || !name.endsWith('.sqlite')) throw new Error('无效备份文件');
    if (tasks.busy) throw new Error('请先暂停并等待活动任务停止，再恢复备份');
    const config = await loadConfig();
    const backup = path.join(dataDir(config),'backups',name);
    const verify = new DatabaseSync(backup,{ readOnly:true });
    try {
      if (Number(verify.prepare('pragma user_version').get().user_version) > 3) throw new Error('备份来自更新版本，请先升级应用');
      if (verify.prepare('pragma integrity_check').get().integrity_check !== 'ok') throw new Error('备份损坏');
      verify.prepare('select id from source_photos limit 1').get(); verify.prepare('select id from processed_photos limit 1').get();
    } finally { verify.close(); }
    const db = await getDb(config);
    const target = path.join(dataDir(config),config.databaseFile);
    db.exec(`vacuum into '${path.join(dataDir(config),'backups',`before-restore-${Date.now()}.sqlite`).replaceAll("'","''")}'`);
    await pauseTasks();
    closeDb();
    await fs.copyFile(backup,target+'.restore');
    await fs.rename(target+'.restore',target);
    for (const suffix of ['-wal','-shm']) await fs.rm(target+suffix,{ force:true });
    await getDb(config);
    await tasks.recover();
    res.json({ restored:true });
  });
  route('get','/api/library/health',async (_req,res) => {
    const config = await loadConfig(); const db = await getDb(config);
    const missingSources = []; const missingRenders = [];
    for (const row of db.prepare('select s.id,s.source_path,p.rendered_url,p.wallpaper_url from source_photos s left join processed_photos p on p.source_id=s.id').all()) {
      try { await fs.access(row.source_path); } catch { missingSources.push(row.id); }
      for (const url of [row.rendered_url,row.wallpaper_url]) {
        if (!url) continue;
        try { await fs.access(path.join(dataDir(config),url.split('?')[0].replace(/^\//,''))); } catch { missingRenders.push({ sourceId:row.id,url }); }
      }
    }
    res.json({ integrity:db.prepare('pragma quick_check').get().quick_check,missingSources,missingRenders });
  });
}
