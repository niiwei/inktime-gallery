import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import sharp from 'sharp';

export async function createHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'inktime-upgrade-'));
  const images = path.join(root, '照片 library');
  await fs.mkdir(images);
  await fs.mkdir(path.join(root, 'config'));
  await sharp({ create: { width: 360, height: 240, channels: 3, background: '#568060' } }).png().toFile(path.join(images, 'sample photo.png'));
  let calls = 0;
  let delay = 0;
  const model = http.createServer(async (req, res) => {
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'test-vision' }] }));
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    calls++;
    await new Promise(resolve => setTimeout(resolve, delay));
    const content = input.format === 'json' ? JSON.stringify({ caption: '树下的一次散步', type: ['日常'], memory_score: 82, reason: '生活记录' }) : '树影落在回家的路上';
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.end(JSON.stringify({ message: { content }, done: true, prompt_eval_count: 10, eval_count: 5 }) + '\n');
  });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const config = { imageDir: images, model: 'test-vision', providerBaseUrl: `http://127.0.0.1:${model.address().port}/api/chat`, maxImagesPerRun: 20, maxConcurrentImages: 1, wallpaperAutoIntervalHours: 0, wallpaperWidth: 640, wallpaperHeight: 400 };
  await fs.writeFile(path.join(root, 'config', 'gallery.config.json'), JSON.stringify(config));
  let child;
  let url;
  let output = '';
  async function start() {
    const probe = http.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    url = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, INKTIME_CONFIG_DIR: path.join(root, 'config'), INKTIME_DATA_ROOT: path.join(root, 'data'), INKTIME_ENV_DIR: root, INKTIME_STATIC: '1', PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(url + '/api/config')).ok) return; } catch {}
      if (child.exitCode !== null) throw new Error(output);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Server did not start: ' + output);
  }
  async function stop(signal = 'SIGTERM') {
    if (!child || child.exitCode !== null) return;
    const stopped = new Promise(resolve => child.once('exit', resolve));
    child.kill(signal);
    await stopped;
  }
  await start();
  return {
    root, images, config, get url() { return url; }, get calls() { return calls; }, setDelay(ms) { delay = ms; }, start, stop,
    async request(route, method = 'GET', body) {
      const response = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await response.json();
      return { status: response.status, data };
    },
    async close() { await stop(); model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); await fs.rm(root, { recursive: true, force: true }); },
  };
}

export async function waitForTask(harness, id, statuses = ['done', 'error'], timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const { data } = await harness.request(`/api/tasks/${id}`);
    if (statuses.includes(data.status)) return data;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error('Task timed out: ' + id);
}
