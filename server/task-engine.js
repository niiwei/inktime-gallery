import crypto from 'node:crypto';

export function createTaskEngine({ getDb, processItem, prepareItems, regroup, abort, onProgress }) {
  let active = null;
  let pumping = false;
  let stopping = false;
  const now = () => new Date().toISOString();
  function describe(db, row, includeItems = false) {
    if (!row) return null;
    const items = db.prepare('select i.*,s.file_name from task_items i join source_photos s on s.id=i.source_id where task_id=? order by ordinal').all(row.id);
    const scanReport=JSON.parse(row.scan_report_json || '{}');
    const current = items.find(item => item.status === 'running');
    const succeeded = items.filter(item => item.status === 'done').length;
    const failed = items.filter(item => item.status === 'failed').length;
    let tokenTotal = 0;
    for (const item of items) {
      const checkpoint = JSON.parse(item.checkpoint_json);
      for (const value of [checkpoint.analysis?.tokenUsage, checkpoint.sideCaption?.tokenUsage]) tokenTotal += Number(value?.total || 0);
    }
    return { scanErrors:scanReport.errors?.length || 0,...(includeItems ? {scanReport} : {}),id: row.id, mode: row.mode, status: row.status, total: items.length, done: succeeded+failed, succeeded, failed, skipped: items.filter(item => item.status === 'cancelled').length, skippedDuplicates: 0, tokenTotal, currentFile: current?.file_name || '', stage: current?.stage || '', message: row.message, createdAt: row.created_at, updatedAt: row.updated_at, ...(includeItems ? { items: items.map(item => ({ sourceId: item.source_id, fileName: item.file_name, status: item.status, stage: item.stage, error: item.error })) } : {}) };
  }
  async function notify(id) {
    const db = await getDb();
    const task = describe(db, db.prepare('select * from tasks where id=?').get(id));
    onProgress(task);
  }
  async function pump() {
    if (pumping || stopping) return;
    pumping = true;
    try {
      const db = await getDb();
      let row;
      while (!stopping && (row = db.prepare("select * from tasks where status='queued' order by created_at,id limit 1").get())) {
        active = row.id;
        db.prepare("update tasks set status='running',updated_at=?,message='正在处理' where id=?").run(now(), row.id);
        const config = JSON.parse(row.config_json);
        if (config.scanBeforeProcessing && !db.prepare('select 1 from task_items where task_id=? limit 1').get(row.id)) {
          db.prepare("update tasks set message='正在扫描目录' where id=?").run(row.id);
          const check = () => { if (stopping || db.prepare('select status from tasks where id=?').get(row.id).status !== 'running') { const error=new Error('任务已暂停'); error.name='AbortError'; throw error; } };
          const { ids,report } = await prepareItems(config,check);
          check();
          db.exec('begin immediate');
          try {
            const insert=db.prepare('insert into task_items(task_id,source_id,ordinal) values(?,?,?)');
            ids.forEach((sourceId,ordinal) => insert.run(row.id,sourceId,ordinal));
            db.prepare("update tasks set message='正在处理',scan_report_json=? where id=?").run(JSON.stringify(report),row.id);
            db.exec('commit');
          } catch (error) { db.exec('rollback'); throw error; }
        }
        const items = db.prepare("select * from task_items where task_id=? and status='pending' order by ordinal").all(row.id);
        // Keep the configured concurrency while each worker claims an item only once.
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(config.maxConcurrentImages || 1, Math.max(1, items.length)) }, async () => {
          while (cursor < items.length && !stopping) {
            if (db.prepare('select status from tasks where id=?').get(row.id).status !== 'running') break;
            const item = items[cursor++];
            const source = db.prepare('select * from source_photos where id=?').get(item.source_id);
            db.prepare("update task_items set status='running',error='' where task_id=? and source_id=?").run(row.id, item.source_id);
            db.prepare("update source_photos set status='processing' where id=?").run(item.source_id);
            await notify(row.id);
            const check = () => {
              if (stopping || db.prepare('select status from tasks where id=?').get(row.id).status !== 'running') {
                const error = new Error('任务已暂停'); error.name = 'AbortError'; throw error;
              }
            };
            const checkpoint = JSON.parse(item.checkpoint_json);
            const save = (stage, payload) => {
              Object.assign(checkpoint, payload);
              db.prepare('update task_items set stage=?,checkpoint_json=? where task_id=? and source_id=?').run(stage, JSON.stringify(checkpoint), row.id, item.source_id);
              void notify(row.id);
            };
            try {
              await processItem(source, config, { taskId: row.id, mode: row.mode, checkpoint, save, check });
              check();
              db.prepare("update task_items set status='done',stage='done' where task_id=? and source_id=?").run(row.id, item.source_id);
              db.prepare("update source_photos set status='processed',skip_code=null,skip_reason=null where id=?").run(item.source_id);
            } catch (error) {
              const taskStatus = db.prepare('select status from tasks where id=?').get(row.id).status;
              const paused = stopping || taskStatus !== 'running' || error.name === 'AbortError';
              db.prepare('update task_items set status=?,error=? where task_id=? and source_id=?').run(taskStatus === 'cancelled' ? 'cancelled' : paused ? 'pending' : 'failed', paused ? '' : error.message, row.id, item.source_id);
              const existing = db.prepare('select id from processed_photos where source_id=?').get(item.source_id);
              db.prepare('update source_photos set status=?,skip_code=?,skip_reason=? where id=?').run(paused ? existing ? 'processed' : 'pending' : 'failed', paused ? null : 'process_error', paused ? null : error.message, item.source_id);
            }
            await notify(row.id);
          }
        }));
        const current = db.prepare('select status from tasks where id=?').get(row.id);
        if (current.status === 'running') {
          if (row.mode !== 'rerender') await regroup(config);
          db.prepare("update tasks set status='done',message='任务完成',updated_at=? where id=?").run(now(),row.id);
        }
        await notify(row.id);
        active = null;
      }
    } catch (error) {
      if (active) {
        const db = await getDb();
        if (error.name !== "AbortError") db.prepare("update tasks set status='error',message=?,updated_at=? where id=?").run(error.message,now(),active);
        await notify(active);
      }
    } finally { active = null; pumping = false; if (!stopping && (await getDb()).prepare("select 1 from tasks where status='queued' limit 1").get()) void pump(); }
  }
  return {
    async recover() {
      stopping = false;
      const db = await getDb();
      db.exec("update tasks set status='paused',message='应用中断，等待继续' where status in ('running','queued'); update task_items set status='pending' where status='running'; update source_photos set status=case when exists(select 1 from processed_photos p where p.source_id=source_photos.id) then 'processed' else 'pending' end where status='processing';");
    },
    async create(config, mode, ids) {
      const db = await getDb();
      const id = crypto.randomUUID();
      const unique = [...new Set(ids)];
      db.exec('begin immediate');
      try {
        db.prepare('insert into tasks(id,mode,status,config_json,created_at,updated_at,message) values(?,?,?,?,?,?,?)').run(id,mode,'queued',JSON.stringify(config),now(),now(),'等待处理');
        const insert = db.prepare('insert into task_items(task_id,source_id,ordinal) values(?,?,?)');
        unique.forEach((sourceId,i) => {
          if (!db.prepare('select id from source_photos where id=?').get(sourceId)) throw new Error('来源照片不存在');
          insert.run(id,sourceId,i);
        });
        db.exec('commit');
      } catch (error) { db.exec('rollback'); throw error; }
      void pump();
      return id;
    },
    async list() { const db = await getDb(); return db.prepare('select * from tasks order by created_at desc,id desc limit 100').all().map(row => describe(db,row)); },
    async get(id) { const db = await getDb(); return describe(db,db.prepare('select * from tasks where id=?').get(id),true); },
    async latest() { const db = await getDb(); return describe(db,db.prepare("select * from tasks order by case when status='running' then 0 when status='queued' then 1 else 2 end,created_at desc limit 1").get()); },
    async control(id, action, sourceIds) {
      const db = await getDb();
      const row = db.prepare('select * from tasks where id=?').get(id);
      if (!row) throw new Error('任务不存在');
      if (action === 'pause' && ['queued','running'].includes(row.status)) {
        db.prepare("update tasks set status='paused',message='已暂停',updated_at=? where id=?").run(now(),id);
        if (active === id) abort();
      } else if (action === 'cancel' && ['paused','queued','running','error'].includes(row.status)) {
        db.prepare("update tasks set status='cancelled',message='已取消',updated_at=? where id=?").run(now(),id);
        db.prepare("update task_items set status='cancelled' where task_id=? and status='pending'").run(id);
        if (active === id) abort();
      } else if (action === 'resume' && ['paused','error'].includes(row.status)) {
        if (active === id) throw new Error('正在暂停活动请求，请稍后继续');
        db.prepare("update tasks set status='queued',updated_at=?,message='等待继续' where id=?").run(now(),id);
      } else if (action === 'retry') {
        if (active === id) throw new Error('请等待当前任务结束');
        if (sourceIds !== undefined) {
          if (!Array.isArray(sourceIds) || !sourceIds.length) throw new Error('请选择失败照片');
          const failed = new Set(db.prepare("select source_id from task_items where task_id=? and status='failed'").all(id).map(item => item.source_id));
          if (sourceIds.some(sourceId => !failed.has(sourceId))) throw new Error('只能重试当前任务的失败照片');
          const update = db.prepare("update task_items set status='pending',error='' where task_id=? and source_id=? and status='failed'");
          for (const sourceId of new Set(sourceIds)) update.run(id,sourceId);
        } else db.prepare("update task_items set status='pending',error='' where task_id=? and status='failed'").run(id);
        db.prepare("update tasks set status='queued',updated_at=?,message='重试失败项' where id=?").run(now(),id);
      } else if (action !== 'pause') throw new Error('当前状态不支持此操作');
      await notify(id);
      void pump();
      return this.get(id);
    },
    async pauseAll() {
      stopping = true;
      const db = await getDb();
      db.prepare("update tasks set status='paused',message='退出时暂停',updated_at=? where status in ('queued','running')").run(now());
      abort();
      while (pumping) await new Promise(resolve => setTimeout(resolve,20));
    },
    get busy() { return pumping; },
  };
}
