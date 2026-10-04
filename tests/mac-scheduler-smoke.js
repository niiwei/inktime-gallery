import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createHarness,waitForTask } from './api-harness.js';
import { desktopWallpaperMatches,readDesktopWallpaperPath } from '../server/platform/desktop-wallpaper.js';
const run=promisify(execFile);
assert.equal(process.platform,'darwin');
assert.equal(process.env.INKTIME_TEST_SYSTEM_WALLPAPER,'1');
const snapshotScript='tell application "System Events"\nset output to ""\nrepeat with d in desktops\nset output to output & (id of d as text) & tab & (picture of d as text) & linefeed\nend repeat\nreturn output\nend tell';
const snapshot=async () => (await run('osascript',['-e',snapshotScript])).stdout.trim().split('\n').map(line => {const [id,...parts]=line.split('\t');return {id:Number(id),file:parts.join('\t')};});
const originals=await snapshot();
const escape=value => value.replaceAll('\\','\\\\').replaceAll('"','\\"');
const xml=value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const label='com.inktime.gallery.acceptance.'+crypto.randomBytes(4).toString('hex');
const domain='gui/'+process.getuid();
const h=await createHarness();
let db;
let registered=false;
let result;
try {
  const task=await h.request('/api/process','POST',{mode:'new'});
  await waitForTask(h,task.data.taskId);
  const photo=(await h.request('/api/photos?collection=all')).data.items[0];
  await h.stop();
  const before=h.calls;
  await fs.writeFile(path.join(h.root,'config','gallery.config.json'),JSON.stringify({...h.config,wallpaperAutoIntervalHours:1}));
  // Use an installation outside macOS protected Documents, whose package scope
  // reads can block a launchd process on an unattended privacy prompt.
  const testApp=path.join(h.root,'InkTime Gallery.app');
  await run('ditto',[path.resolve('release/mac-arm64/InkTime Gallery.app'),testApp]);
  const executable=path.join(testApp,'Contents','MacOS','InkTime Gallery');
  const args=[executable,'--wallpaper-once','--config-dir',path.join(h.root,'config'),'--data-root',path.join(h.root,'data')];
  const log=path.join(h.root,'launch-agent.log');
  const plist=path.join(h.root,'acceptance.plist');
  await fs.writeFile(plist,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(arg=>`<string>${xml(arg)}</string>`).join('')}</array><key>EnvironmentVariables</key><dict><key>INKTIME_USER_DATA_DIR</key><string>${xml(path.join(h.root,'desktop'))}</string></dict><key>LimitLoadToSessionType</key><string>Aqua</string><key>RunAtLoad</key><true/><key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string></dict></plist>`);
  db=new DatabaseSync(path.join(h.root,'data','gallery.sqlite'));
  await run('launchctl',['bootstrap',domain,plist]);
  registered=true;
  const history=()=>db.prepare('select * from wallpaper_history order by set_at desc').all();
  const end=Date.now()+20000;
  while(Date.now()<end && history().length===0) await new Promise(resolve=>setTimeout(resolve,100));
  if(history().length===0) {
    console.error(await fs.readFile(log,'utf8').catch(()=> 'No LaunchAgent log'));
    console.error(await fs.readFile(path.join(h.root,'desktop','logs','main.log'),'utf8').catch(()=> 'No Electron log'));
    console.error((await run('launchctl',['print',domain+'/'+label])).stdout);
  }
  assert.equal(history().length,1,'LaunchAgent must apply wallpaper after the API process exits');
  const target=path.join(h.root,'data','wallpapers',path.basename(photo.wallpaperUrl));
  assert.ok(desktopWallpaperMatches(await readDesktopWallpaperPath(),target));
  await new Promise(resolve=>setTimeout(resolve,500));
  await run('launchctl',['kickstart',domain+'/'+label]);
  const repeatEnd=Date.now()+10000;
  while(Date.now()<repeatEnd){
    if((await fs.readFile(log,'utf8')).includes('Scheduled boundary already applied'))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok((await fs.readFile(log,'utf8')).includes('Scheduled boundary already applied'));
  assert.equal(history().length,1,'Multiple catch-up triggers in one boundary must apply once');
  assert.equal(h.calls,before,'Wallpaper entry must not start AI');
  result={launchAgentAfterAppExit:true,readback:true,catchUpOnce:true,noAI:true};
} finally {
  try {
    if(registered) await run('launchctl',['bootout',domain+'/'+label]);
    if(db)db.close();
    for(const item of originals) await run('osascript',['-e',`tell application "System Events" to set picture of desktop id ${item.id} to POSIX file "${escape(item.file)}"`]);
    const restoreEnd=Date.now()+5000;
    while(JSON.stringify(await snapshot())!==JSON.stringify(originals) && Date.now()<restoreEnd) {
      for(const item of originals) await run('osascript',['-e',`tell application "System Events" to set picture of desktop id ${item.id} to POSIX file "${escape(item.file)}"`]);
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    assert.deepEqual(await snapshot(),originals);
  } finally { await h.close(); }
}
result.restored=true;result.testTaskRemoved=true;
await fs.mkdir('tmp/upgrade',{recursive:true});
await fs.writeFile('tmp/upgrade/mac-scheduler-metrics.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
