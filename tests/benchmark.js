import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { createHarness } from './api-harness.js';

const h = await createHarness();
const results = { label: process.argv[2] || 'current', node: process.version, rows: [], capturedAt: new Date().toISOString() };
try {
  const first = performance.now();
  await h.request('/api/sources/scan', 'POST');
  results.scanFirstMs = performance.now() - first;
  const repeat = performance.now();
  results.repeatReport = (await h.request('/api/sources/scan', 'POST')).data;
  results.scanRepeatMs = performance.now() - repeat;
  const db = new DatabaseSync(path.join(h.root, 'data', 'gallery.sqlite'));
  const seed = db.prepare('select * from source_photos limit 1').get();
  const source = db.prepare('insert or ignore into source_photos(id,source_path,file_name,captured_date,captured_at,status,added_at,last_seen_at) values(?,?,?,?,?,?,?,?)');
  const photo = db.prepare('insert or ignore into processed_photos(id,source_id,memory_score,caption,tags_json,processed_at,is_representative,source_url) values(?,?,?,?,?,?,?,?)');
  for (const size of [1000, 10000]) {
    db.exec('begin');
    for (let i = 0; i < size; i++) {
      source.run(`fixture-${i}`, seed.source_path + `.${i}`, `fixture-${i}.png`, '2020-04-03', '2020-04-03T12:00:00Z', 'processed', '2020-01-01', '2020-01-01');
      photo.run(`fixture-${i}`, `fixture-${i}`, 80, '基准照片', '[]', '2020-01-01', 1, '/source/sample%20photo.png');
    }
    db.exec('commit');
    const durations = [];
    let bytes = 0;
    let count = 0;
    for (let i = 0; i < 25; i++) {
      const before = performance.now();
      const response = await fetch(h.url + '/api/photos?collection=all&minScore=75&page=1&pageSize=60');
      const raw = await response.text();
      durations.push(performance.now() - before);
      bytes = Buffer.byteLength(raw);
      const payload = JSON.parse(raw);
      count = Array.isArray(payload) ? payload.length : payload.items.length;
    }
    durations.sort((a,b) => a-b);
    results.rows.push({ size, returned: count, bytes, p50Ms: durations[12], p95Ms: durations[23] });
  }
  db.close();
  await fs.mkdir('tmp/upgrade', { recursive: true });
  await fs.writeFile(`tmp/upgrade/benchmark-${results.label}.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await h.close(); }
