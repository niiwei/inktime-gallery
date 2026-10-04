import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHarness, waitForTask } from './api-harness.js';
const h=await createHarness();
try {
  const tags=await (await fetch('http://127.0.0.1:11434/api/tags')).json();
  const model=process.env.INKTIME_TEST_MODEL || tags.models.find(item => /Qwen3-VL/i.test(item.name))?.name;
  assert.ok(model,'Set INKTIME_TEST_MODEL to an installed vision model');
  const config={...h.config,model,providerBaseUrl:'http://127.0.0.1:11434/api/chat'};
  await fs.writeFile(path.join(h.root,'config','gallery.config.json'),JSON.stringify(config));
  const started=performance.now();
  const created=await h.request('/api/process','POST',{mode:'new'});
  assert.equal(created.status,202);
  const task=await waitForTask(h,created.data.taskId,['done','error'],300000);
  assert.equal(task.succeeded,1,JSON.stringify(task));
  const photo=(await h.request('/api/photos?collection=all')).data.items[0];
  assert.equal((await fetch(h.url+photo.renderedUrl)).status,200);
  const result={model,elapsedMs:performance.now()-started,realLocalModel:true,succeeded:task.succeeded,tokenTotal:task.tokenTotal,syntheticImage:true};
  await fs.mkdir('tmp/upgrade',{recursive:true});
  await fs.writeFile('tmp/upgrade/live-model-metrics.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally { await h.close(); }
