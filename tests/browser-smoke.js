import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DatabaseSync } from 'node:sqlite';
import { createHarness, waitForTask } from './api-harness.js';

const h = await createHarness();
const browser = await chromium.launch({ headless:true, executablePath:process.env.INKTIME_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport:{ width:1440,height:1000 },colorScheme:'light' });
const errors=[];
page.on('pageerror',error => errors.push(error.message));
const metrics=[];
await fs.mkdir('tmp/upgrade',{ recursive:true });
try {
  await page.goto(h.url);
  await page.getByRole('heading',{name:'照片管理',exact:true}).waitFor();
  await page.getByRole('button',{name:'检查模型',exact:true}).click();
  await page.getByText('模型已就绪',{exact:true}).waitFor();
  await page.getByRole('button',{name:'试处理 3 张',exact:true}).click();
  await page.getByRole('heading',{name:'任务中心',exact:true}).waitFor();
  const tasks = (await h.request('/api/tasks')).data;
  await waitForTask(h,tasks[0].id);
  await page.getByRole('button',{name:/照片管理/}).click();
  await page.locator('.sourcePreviewButton').first().click();
  await page.getByRole('button',{name:'返回',exact:true}).waitFor();
  await page.locator('.insightPanel').screenshot({path:'tmp/upgrade/detail.png'});
  await page.getByRole('button',{name:'返回',exact:true}).click();
  await page.getByRole('button',{name:/壁纸/}).first().click();
  await page.getByRole('button',{name:'编辑相框布局'}).click();
  await page.getByRole('button',{name:'预览一张'}).click();
  await page.locator('.singlePreview img').waitFor();
  await page.locator('.singlePreview').screenshot({path:'tmp/upgrade/layout-preview.png'});
  await page.getByRole('button',{name:'返回编辑'}).click();
  await page.locator('.layoutHeader button').click();
  const db = new DatabaseSync(path.join(h.root,'data','gallery.sqlite'));
  const seed=db.prepare('select * from source_photos limit 1').get();
  const insertSource=db.prepare('insert or ignore into source_photos(id,source_path,file_name,captured_date,captured_at,status,added_at,last_seen_at,file_mtime) values(?,?,?,?,?,?,?,?,?)');
  const insertPhoto=db.prepare('insert or ignore into processed_photos(id,source_id,memory_score,caption,side_caption,tags_json,processed_at,is_representative,source_url,rendered_url) values(?,?,?,?,?,?,?,?,?,?)');
  for (const size of [1000,10000]) {
    db.exec('begin');
    for (let i=0;i<size;i++) {
      const id='fixture-'+String(i).padStart(5,'0');
      insertSource.run(id,seed.source_path+'.'+i,`photo-${i}.png`,'2020-04-03','2020-04-03T12:00:00Z','processed','2020-01-01','2020-01-01',seed.file_mtime);
      insertPhoto.run(id,id,90,'基准照片','树影落在回家的路上','[]','2020-01-01',1,'/source/sample%20photo.png','');
    }
    db.exec('commit');
    for (let i=0;i<120;i++) { try { await fs.link(seed.source_path,seed.source_path+'.'+i); } catch {} }
    for (const state of ['cold','warm']) {
      if(state==='cold') { const session=await page.context().newCDPSession(page); await session.send('Network.clearBrowserCache'); await session.detach(); }
      const started=performance.now();
      await page.goto(h.url);
      await page.getByRole('button',{name:'时间线',exact:true}).click();
      await page.locator('.photoCard').first().waitFor();
      await page.locator('.photoCard img').first().evaluate(img => img.decode());
      const firstScreenMs=performance.now()-started;
      const domCards=await page.locator('.photoCard').count();
      assert.ok(domCards<60,'Only visible cards should be mounted');
      await page.locator('.virtualViewport').evaluate(element => { element.scrollTop=1600; });
      await page.waitForTimeout(100);
      assert.ok(await page.locator('.photoCard').count()<60);
      metrics.push({size,state,firstScreenMs,domCards,heapBytes:await page.evaluate(() => performance.memory?.usedJSHeapSize || null)});
    }
  }
  await page.screenshot({path:'tmp/upgrade/gallery.png',fullPage:true});
  await page.getByRole('button',{name:/照片管理/}).click();
  await page.getByRole('button',{name:'选择本页',exact:true}).click();
  await page.getByRole('button',{name:/下一页/}).click();
  assert.ok(await page.getByText('60 张已选',{exact:true}).count());
  await page.screenshot({path:'tmp/upgrade/manage.png',fullPage:true});
  await page.getByRole('button',{name:/设置/,exact:false}).last().click();
  await page.getByRole('button',{name:'创建备份',exact:true}).waitFor();
  await page.getByRole('button',{name:'创建备份',exact:true}).click();
  await page.getByText('备份已创建',{exact:true}).waitFor();
  await page.locator('.settingsDrawer').screenshot({path:'tmp/upgrade/settings.png'});
  assert.deepEqual(errors,[]);
  await fs.writeFile('tmp/upgrade/browser-metrics.json',JSON.stringify({metrics,errors},null,2));
  console.log(JSON.stringify({metrics,errors},null,2));
  db.close();
} finally { await browser.close(); await h.close(); }
