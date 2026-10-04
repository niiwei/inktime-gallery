import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHarness, waitForTask } from './api-harness.js';
const run=promisify(execFile);
assert.equal(process.platform,'darwin');
assert.equal(process.env.INKTIME_TEST_SYSTEM_WALLPAPER,'1','Enable explicitly for reversible desktop acceptance');
const snapshotScript='tell application "System Events"\nset output to ""\nrepeat with d in desktops\nset output to output & (id of d as text) & tab & (picture of d as text) & linefeed\nend repeat\nreturn output\nend tell';
const snapshot=async () => (await run('osascript',['-e',snapshotScript])).stdout.trim().split('\n').map(line => { const [id,...parts]=line.split('\t'); return {id:Number(id),file:parts.join('\t')}; });
const originals=await snapshot();
assert.ok(originals.length && originals.every(item => item.id && item.file));
const escape=value => value.replaceAll('\\','\\\\').replaceAll('"','\\"');
const h=await createHarness();
let result;
try {
  const created=await h.request('/api/process','POST',{mode:'new'});
  assert.equal((await waitForTask(h,created.data.taskId)).succeeded,1);
  const photo=(await h.request('/api/photos?collection=all')).data.items[0];
  const response=await h.request(`/api/photos/${photo.id}/wallpaper`,'POST');
  assert.equal(response.status,200,JSON.stringify(response.data));
  const current=await snapshot();
  const expected=path.join(h.root,'data','wallpapers',path.basename(photo.wallpaperUrl));
  const awaitedExpected=await fs.realpath(expected);
  assert.ok(current.every(item => item.file===awaitedExpected),'Every desktop must confirm the test path');
  const history=(await h.request('/api/wallpaper/status')).data.history;
  assert.equal(history.length,1);
  result={manualSet:true,readback:true,historyOnlyAfterSuccess:true,desktopCount:originals.length};
} finally {
  for(const item of originals) await run('osascript',['-e',`tell application "System Events" to set picture of desktop id ${item.id} to POSIX file "${escape(item.file)}"`]);
  assert.deepEqual(await snapshot(),originals,'Original desktop wallpapers must be restored');
  await h.close();
}
result.restored=true;
await fs.mkdir('tmp/upgrade',{recursive:true});
await fs.writeFile('tmp/upgrade/mac-wallpaper-metrics.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
