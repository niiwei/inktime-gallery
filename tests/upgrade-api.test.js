import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHarness, waitForTask } from './api-harness.js';

test('scan returns a paginated inventory and reuses unchanged image features', async () => {
  const h = await createHarness();
  try {
    const first = await h.request('/api/sources/scan', 'POST');
    assert.equal(first.status, 200);
    const page = await h.request('/api/sources');
    assert.equal(page.data.total, 1);
    assert.equal(page.data.pageSize, 60);
    assert.equal(page.data.items.length, 1);
    const again = await h.request('/api/sources/scan', 'POST');
    assert.equal(again.data.unchanged, 1);
    assert.equal(again.data.changed, 0);
  } finally { await h.close(); }
});

test('force exit after analysis recovers paused and only repeats the unfinished caption', async () => {
  const h = await createHarness();
  try {
    h.setDelay(500);
    const created = await h.request('/api/process', 'POST', { mode: 'new' });
    const id = created.data.taskId;
    const deadline = Date.now()+5000;
    let stage = '';
    while (Date.now()<deadline) {
      const data = (await h.request('/api/tasks/'+id)).data;
      stage = data.items[0]?.stage;
      if (stage === 'caption') break;
      await new Promise(resolve => setTimeout(resolve,20));
    }
    assert.equal(stage,'caption');
    await h.stop('SIGKILL');
    const previousCalls = h.calls;
    await h.start();
    assert.equal((await h.request('/api/tasks/'+id)).data.status,'paused');
    h.setDelay(0);
    assert.equal((await h.request(`/api/tasks/${id}/resume`,'POST')).status,200);
    assert.equal((await waitForTask(h,id)).succeeded,1);
    assert.equal(h.calls-previousCalls,1);
  } finally { await h.close(); }
});

test('backup restore retains curated data and queue remains usable', async () => {
  const h = await createHarness();
  try {
    const created = await h.request('/api/process','POST',{mode:'new'});
    await waitForTask(h,created.data.taskId);
    const photo=(await h.request('/api/photos?collection=all')).data.items[0];
    await h.request(`/api/photos/${photo.id}/curated`,'POST',{curated:true});
    const backup=await h.request('/api/library/backup','POST');
    assert.equal(backup.status,200);
    await h.request(`/api/photos/${photo.id}/curated`,'POST',{curated:false});
    assert.equal((await h.request('/api/library/restore','POST',{fileName:backup.data.fileName})).status,200);
    assert.equal((await h.request('/api/photos?collection=curated')).data.total,1);
    const rerender=await h.request('/api/rerender','POST',{sourceIds:[photo.sourceId]});
    assert.equal((await waitForTask(h,rerender.data.taskId)).succeeded,1);
    const health=(await h.request('/api/library/health')).data;
    assert.equal(health.integrity,'ok');
    assert.deepEqual(health.missingSources,[]);
    assert.deepEqual(health.missingRenders,[]);
  } finally { await h.close(); }
});

test('failed reanalysis preserves the last successful render and can be retried', async () => {
  const h = await createHarness();
  try {
    const created=await h.request('/api/process','POST',{mode:'new'});
    await waitForTask(h,created.data.taskId);
    const photo=(await h.request('/api/photos?collection=all')).data.items[0];
    await fs.rename(path.join(h.images,'sample photo.png'),path.join(h.images,'sample.offline'));
    const rerun=await h.request('/api/process','POST',{sourceIds:[photo.sourceId]});
    const failed=await waitForTask(h,rerun.data.taskId);
    assert.equal(failed.failed,1);
    const failedSources=(await h.request('/api/sources?status=failed')).data;
    assert.equal(failedSources.total,1);
    assert.equal(failedSources.items[0].status,'failed');
    assert.ok(failedSources.items[0].skipReason);
    assert.equal((await h.request('/api/photos?collection=all')).data.items[0].renderedUrl,photo.renderedUrl);
    assert.equal((await fetch(h.url+photo.renderedUrl)).status,200);
    await fs.rename(path.join(h.images,'sample.offline'),path.join(h.images,'sample photo.png'));
    await h.request(`/api/tasks/${rerun.data.taskId}/retry`,'POST');
    assert.equal((await waitForTask(h,rerun.data.taskId)).succeeded,1);
  } finally { await h.close(); }
});

test('changed sources invalidate checkpoints and group corrections remain after rerun', async () => {
  const h = await createHarness();
  try {
    await fs.copyFile(path.join(h.images,'sample photo.png'),path.join(h.images,'second.png'));
    await h.request('/api/sources/scan','POST');
    const sources=(await h.request('/api/sources')).data.items;
    const created=await h.request('/api/process','POST',{sourceIds:sources.map(source => source.id)});
    assert.equal((await waitForTask(h,created.data.taskId)).succeeded,2);
    const gallery=(await h.request('/api/photos?collection=all')).data.items;
    assert.ok(gallery[0].similarGroupId);
    await h.request(`/api/photos/${gallery[0].id}/representative`,'POST');
    assert.equal((await h.request('/api/photos?collection=representative')).data.total,1);
    await h.request(`/api/photos/${gallery[0].id}/split-group`,'POST');
    const rerun=await h.request('/api/process','POST',{sourceIds:sources.map(source => source.id)});
    await waitForTask(h,rerun.data.taskId);
    assert.equal((await h.request('/api/photos?collection=representative')).data.total,2);
    const scan=await h.request('/api/sources/scan','POST');
    assert.equal(scan.data.unchanged,2);
    await fs.utimes(path.join(h.images,'second.png'),new Date(),new Date(Date.now()+5000));
    const changed=await h.request('/api/sources/scan','POST');
    assert.equal(changed.data.changed,1);
    assert.equal(changed.data.unchanged,1);
  } finally { await h.close(); }
});

test('a task completes real renders and manual edits survive reanalysis', async () => {
  const h = await createHarness();
  try {
    const created = await h.request('/api/process', 'POST', { mode: 'new', limit: 3 });
    assert.equal(created.status, 202);
    const task = await waitForTask(h, created.data.taskId);
    assert.equal(task.succeeded, 1);
    const gallery = await h.request('/api/photos?collection=all');
    const photo = gallery.data.items[0];
    assert.equal((await fetch(h.url + photo.renderedUrl)).status, 200);
    assert.equal((await fetch(h.url + photo.thumbnailUrl)).status, 200);
    const edited = await h.request(`/api/photos/${photo.id}`, 'PATCH', { manualEdits: { sideCaption: '我的散步', capturedDate: '2020-04-03', location: '杭州' } });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.sideCaption, '我的散步');
    if (edited.data.taskId) await waitForTask(h, edited.data.taskId);
    const rerun = await h.request('/api/process', 'POST', { sourceIds: [photo.sourceId] });
    assert.equal((await waitForTask(h, rerun.data.taskId)).succeeded, 1);
    const next = (await h.request('/api/photos?collection=all')).data.items[0];
    assert.equal(next.sideCaption, '我的散步');
    assert.equal(next.capturedDate, '2020-04-03');
    assert.equal(next.location, '杭州');
  } finally { await h.close(); }
});

test('pause aborts an active model request and cancel prevents pending photos from running',async () => {
  const h=await createHarness();
  try {
    await fs.copyFile(path.join(h.images,'sample photo.png'),path.join(h.images,'another.png'));
    h.setDelay(1000);
    const created=await h.request('/api/process','POST',{mode:'new'});
    const id=created.data.taskId;
    await new Promise(resolve => setTimeout(resolve,100));
    assert.equal((await h.request(`/api/tasks/${id}/pause`,'POST')).data.status,'paused');
    await new Promise(resolve => setTimeout(resolve,100));
    const cancelled=(await h.request(`/api/tasks/${id}/cancel`,'POST')).data;
    assert.equal(cancelled.status,'cancelled');
    assert.equal(cancelled.succeeded,0);
    assert.equal((await h.request(`/api/tasks/${id}/resume`,'POST')).status,400);
    assert.equal((await h.request('/api/photos?collection=all')).data.total,0);
  } finally { await h.close(); }
});

test('default new-photo processing reanalyses changed sources while retaining the prior result',async () => {
  const h=await createHarness();
  try {
    const initial=await h.request('/api/process','POST',{mode:'new'});
    await waitForTask(h,initial.data.taskId);
    const old=(await h.request('/api/photos?collection=all')).data.items[0];
    const {default:sharp}=await import('sharp');
    await sharp({create:{width:360,height:240,channels:3,background:'#aa5533'}}).png().toFile(path.join(h.images,'sample photo.png'));
    await h.request('/api/sources/scan','POST');
    assert.equal((await h.request('/api/sources?status=pending')).data.total,1);
    assert.equal((await h.request('/api/photos?collection=all')).data.items[0].renderedUrl,old.renderedUrl);
    const before=h.calls;
    const changed=await h.request('/api/process','POST',{mode:'new'});
    assert.equal((await waitForTask(h,changed.data.taskId)).succeeded,1);
    assert.equal(h.calls-before,2);
    assert.notEqual((await h.request('/api/photos?collection=all')).data.items[0].renderedUrl,old.renderedUrl);
  } finally { await h.close(); }
});

test('source collection filters, wallpaper eligibility and task selection use fixed matching IDs',async () => {
  const h=await createHarness();
  try {
    await fs.copyFile(path.join(h.images,'sample photo.png'),path.join(h.images,'another.png'));
    await h.request('/api/sources/scan','POST');
    const ids=(await h.request('/api/sources')).data.items.map(item => item.id);
    const initial=await h.request('/api/process','POST',{sourceIds:ids});
    await waitForTask(h,initial.data.taskId);
    const photo=(await h.request('/api/photos?collection=all')).data.items[0];
    await h.request(`/api/photos/${photo.id}/curated`,'POST',{curated:true});
    assert.equal((await h.request('/api/sources?collection=curated')).data.total,1);
    assert.equal((await h.request('/api/sources?collection=representative')).data.total,1);
    assert.equal((await h.request('/api/photos?collection=curated&wallpaperEligible=1')).data.total,1);
    await h.request(`/api/photos/${photo.id}`,'PATCH',{wallpaperExcluded:true});
    assert.equal((await h.request('/api/photos?collection=curated&wallpaperEligible=1')).data.total,0);
    h.setDelay(200);
    const selected=await h.request('/api/process','POST',{selection:{filters:{collection:'curated'}}});
    await h.request(`/api/photos/${photo.id}/curated`,'POST',{curated:false});
    const task=await waitForTask(h,selected.data.taskId);
    assert.equal(task.total,1);
    assert.equal(task.items[0].sourceId,photo.sourceId);
  } finally { await h.close(); }
});

test('a complete pre-upgrade library remains operable after migration',async () => {
  const h=await createHarness();
  try {
    const created=await h.request('/api/process','POST',{mode:'new'});
    await waitForTask(h,created.data.taskId);
    const photo=(await h.request('/api/photos?collection=all')).data.items[0];
    await h.request(`/api/photos/${photo.id}/curated`,'POST',{curated:true});
    await h.stop();
    const {DatabaseSync}=await import('node:sqlite');
    const db=new DatabaseSync(path.join(h.root,'data','gallery.sqlite'));
    db.prepare('insert into wallpaper_history(id,photo_id,wallpaper_path,set_at) values(?,?,?,?)').run('legacy-history',photo.id,path.join(h.root,'data','wallpapers',path.basename(photo.wallpaperUrl)),'2020-01-01T00:00:00Z');
    db.exec('drop table task_items; drop table tasks; pragma user_version=0;');
    for(const [table,column] of [['source_photos','file_size'],['source_photos','file_mtime'],['processed_photos','manual_edits'],['processed_photos','wallpaper_excluded'],['processed_photos','group_override'],['processed_photos','source_hash']]) db.exec(`alter table ${table} drop column ${column}`);
    db.close();
    await h.start();
    assert.equal((await h.request('/api/sources')).data.total,1);
    assert.equal((await h.request('/api/photos?collection=curated')).data.items[0].id,photo.id);
    assert.equal((await h.request('/api/wallpaper/status')).data.history[0].photoId,photo.id);
    assert.equal((await h.request(`/api/photos/${photo.id}/curated`,'POST',{curated:false})).status,200);
    const rerender=await h.request('/api/rerender','POST',{sourceIds:[photo.sourceId]});
    assert.equal((await waitForTask(h,rerender.data.taskId)).succeeded,1);
    assert.equal((await h.request('/api/library/health')).data.integrity,'ok');
    assert.equal((await h.request('/api/wallpaper/status')).data.history[0].url,photo.wallpaperUrl);
  } finally { await h.close(); }
});

test('one failed photo can be retried without retrying other failed photos',async () => {
  const h=await createHarness();
  try {
    await fs.copyFile(path.join(h.images,'sample photo.png'),path.join(h.images,'another.png'));
    await h.request('/api/sources/scan','POST');
    const sources=(await h.request('/api/sources')).data.items;
    for(const source of sources) await fs.rename(source.sourcePath,source.sourcePath+'.offline');
    const created=await h.request('/api/process','POST',{sourceIds:sources.map(source => source.id)});
    assert.equal((await waitForTask(h,created.data.taskId)).failed,2);
    await fs.rename(sources[0].sourcePath+'.offline',sources[0].sourcePath);
    const retry=await h.request(`/api/tasks/${created.data.taskId}/retry`,'POST',{sourceIds:[sources[0].id]});
    assert.equal(retry.status,200);
    const result=await waitForTask(h,created.data.taskId);
    assert.equal(result.succeeded,1);
    assert.equal(result.failed,1);
    assert.equal(result.items.find(item => item.sourceId===sources[1].id).status,'failed');
  } finally { await h.close(); }
});

test('force exit during rendering resumes saved model stages and removes staged partial files',async () => {
  const h=await createHarness();
  try {
    const config={...h.config,renderWidth:1600,renderHeight:2800,renderFrameMode:'fixed'};
    await fs.writeFile(path.join(h.root,'config','gallery.config.json'),JSON.stringify(config));
    h.setDelay(150);
    const created=await h.request('/api/process','POST',{mode:'new'});
    let stage='';
    const end=Date.now()+8000;
    while(Date.now()<end){
      const task=(await h.request('/api/tasks/'+created.data.taskId)).data;
      stage=task.items[0]?.stage;
      if(stage==='render')break;
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.equal(stage,'render');
    await h.stop('SIGKILL');
    const calls=h.calls;
    const partial=path.join(h.root,'data','renders','.inktime-staging');
    await fs.mkdir(partial,{recursive:true});
    await fs.writeFile(path.join(partial,'interrupted.png'),'partial');
    await h.start();
    await assert.rejects(fs.access(path.join(partial,'interrupted.png')));
    assert.equal((await h.request('/api/tasks/'+created.data.taskId)).data.status,'paused');
    await h.request(`/api/tasks/${created.data.taskId}/resume`,'POST');
    assert.equal((await waitForTask(h,created.data.taskId)).succeeded,1);
    assert.equal(h.calls,calls,'Completed analysis and caption must not run again');
  } finally { await h.close(); }
});

test('process returns a persistent task before scan failure and preserves unreadable-file reports',async () => {
  const h=await createHarness();
  try {
    const imageDir=path.join(h.root,'missing-folder');
    await fs.writeFile(path.join(h.root,'config','gallery.config.json'),JSON.stringify({...h.config,imageDir}));
    const created=await h.request('/api/process','POST',{mode:'new'});
    assert.equal(created.status,202);
    assert.equal((await waitForTask(h,created.data.taskId)).status,'error');
    await fs.mkdir(imageDir);
    await fs.writeFile(path.join(imageDir,'broken.png'),'not an image');
    await h.request(`/api/tasks/${created.data.taskId}/retry`,'POST');
    const finished=await waitForTask(h,created.data.taskId);
    assert.equal(finished.scanErrors,1);
    assert.equal(finished.scanReport.errors[0].file,path.join(imageDir,'broken.png'));
    await h.stop();await h.start();
    assert.equal((await h.request('/api/tasks/'+created.data.taskId)).data.scanErrors,1);
  } finally { await h.close(); }
});
