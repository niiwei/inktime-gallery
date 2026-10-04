import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { createHarness } from "./api-harness.js";

const SAMPLE_SIZE = 1000;
const PAGE_SIZE = 120;
const OUTPUT = path.resolve("tmp/upgrade/real-library-metrics.json");
const imageExtensions = /\.(jpe?g|png|webp)$/i;

const runtimeConfig = await readRuntimeConfig();
const sourceFiles = await listSourceFiles(runtimeConfig.imageDir);
assert.ok(sourceFiles.length >= SAMPLE_SIZE, `runtime library must contain at least ${SAMPLE_SIZE} images`);
const selectedFiles = sourceFiles.slice(0, SAMPLE_SIZE);
const metrics = {
  status: "running",
  sampleSize: selectedFiles.length,
  sourceLibraryCount: sourceFiles.length,
  seededProcessedRows: 0,
  seedMode: "synthetic metadata only; no model calls",
};

let harness = null;
let browser = null;
try {
  harness = await createHarness();
  await harness.stop();
  const benchmarkLibrary = path.join(harness.root, "real-library");
  await fs.mkdir(benchmarkLibrary, { recursive: true });
  await createSymlinkSample(selectedFiles, benchmarkLibrary);

  const configPath = path.join(harness.root, "config", "gallery.config.json");
  await fs.writeFile(configPath, JSON.stringify({
    ...harness.config,
    imageDir: benchmarkLibrary,
    maxImagesPerRun: SAMPLE_SIZE,
    wallpaperAutoIntervalHours: 0,
  }));
  await harness.start();

  const firstScan = await timedRequest(harness, "/api/sources/scan", "POST");
  const repeatScan = await timedRequest(harness, "/api/sources/scan", "POST");
  assert.equal(firstScan.data.errors?.length || 0, 0, "sample scan should not report unreadable files");
  assert.equal(repeatScan.data.unchanged, SAMPLE_SIZE, "repeat scan should reuse every unchanged source");
  assert.equal(repeatScan.data.changed, 0, "repeat scan should not reprofile unchanged sources");
  metrics.scan = {
    firstMs: round(firstScan.durationMs),
    repeatMs: round(repeatScan.durationMs),
    firstChanged: firstScan.data.changed,
    firstUnchanged: firstScan.data.unchanged,
    repeatChanged: repeatScan.data.changed,
    repeatUnchanged: repeatScan.data.unchanged,
    unreadable: repeatScan.data.errors?.length || 0,
  };

  await harness.stop();
  metrics.seededProcessedRows = await seedProcessedMetadata(path.join(harness.root, "data", "gallery.sqlite"));
  await harness.start();

  const sourceIds = await readAllSourceIds(harness);
  assert.equal(sourceIds.length, SAMPLE_SIZE, "the isolated source inventory should contain the selected sample");
  metrics.thumbnails = await generateThumbnails(harness, sourceIds);
  metrics.filter = await measureFilterP95(harness);

  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.INKTIME_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--enable-precise-memory-info"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
  let pageErrors = 0;
  page.on("pageerror", () => { pageErrors += 1; });
  metrics.browser = {};
  metrics.browser.cold = await measureGalleryNavigation(page, harness.url, true);
  metrics.browser.warm = await measureGalleryNavigation(page, harness.url, false);
  metrics.browser.pageErrors = pageErrors;
  await browser.close();
  browser = null;

  metrics.status = "ok";
  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (harness) await harness.close();
}

async function readRuntimeConfig() {
  const candidates = [];
  if (process.env.INKTIME_CONFIG_DIR) candidates.push(path.join(process.env.INKTIME_CONFIG_DIR, "gallery.config.json"));
  candidates.push(path.join(os.homedir(), "Library", "Application Support", "inktime-gallery", "config", "gallery.config.json"));
  candidates.push(path.resolve("config/gallery.config.json"));
  for (const candidate of candidates) {
    try {
      const config = JSON.parse(await fs.readFile(candidate, "utf8"));
      if (config.imageDir && (await isDirectory(config.imageDir))) return config;
    } catch {
      // Try the next configured runtime location without exposing paths.
    }
  }
  throw new Error("No runtime image directory with a readable configuration was found");
}

async function isDirectory(value) {
  try { return (await fs.stat(value)).isDirectory(); } catch { return false; }
}

async function listSourceFiles(directory) {
  const files = [];
  async function visit(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && imageExtensions.test(entry.name)) files.push(file);
    }
  }
  await visit(directory);
  return files;
}

async function createSymlinkSample(files, directory) {
  await Promise.all(files.map((file, index) => {
    const extension = path.extname(file).toLowerCase();
    return fs.symlink(file, path.join(directory, `${String(index).padStart(4, "0")}${extension}`), "file");
  }));
}

async function seedProcessedMetadata(databasePath) {
  const db = new DatabaseSync(databasePath);
  try {
    const rows = db.prepare("select id,source_path,file_name,file_hash,file_mtime,captured_at,captured_date,location,width,height,orientation from source_photos order by id").all();
    db.exec("begin immediate");
    const insert = db.prepare(`insert into processed_photos(
      id,source_id,run_id,prompt_version,model,source_url,rendered_url,wallpaper_url,
      memory_score,metrics_json,caption,side_caption,reason,tags_json,processed_at,
      token_input,token_output,token_total,token_estimated,similar_group_id,is_representative,source_hash
    ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const update = db.prepare("update source_photos set status='processed',skip_code=null,skip_reason=null where id=?");
    rows.forEach((row, index) => {
      insert.run(
        row.id, row.id, "benchmark-fixture", "benchmark-fixture", "benchmark-fixture",
        `/source/${encodeURIComponent(row.file_name)}`, "", "",
        50 + (index % 50), JSON.stringify({ width: row.width || 0, height: row.height || 0, orientation: row.orientation || "" }),
        "benchmark fixture", "benchmark fixture", "synthetic metadata; no model result", "[]", "2020-01-01T00:00:00.000Z",
        0, 0, 0, 1, "", 1, row.file_hash || null,
      );
      update.run(row.id);
    });
    db.exec("commit");
    return rows.length;
  } catch (error) {
    try { db.exec("rollback"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

async function timedRequest(h, route, method = "GET") {
  const started = performance.now();
  const result = await h.request(route, method);
  return { ...result, durationMs: performance.now() - started };
}

async function readAllSourceIds(h) {
  const first = await h.request(`/api/sources?page=1&pageSize=${PAGE_SIZE}`);
  const ids = [...first.data.items.map(item => item.id)];
  for (let page = 2; page <= Math.ceil(first.data.total / PAGE_SIZE); page += 1) {
    const result = await h.request(`/api/sources?page=${page}&pageSize=${PAGE_SIZE}`);
    ids.push(...result.data.items.map(item => item.id));
  }
  return ids;
}

async function generateThumbnails(h, sourceIds) {
  const started = performance.now();
  let generated = 0;
  for (let offset = 0; offset < sourceIds.length; offset += 8) {
    const batch = sourceIds.slice(offset, offset + 8);
    const responses = await Promise.all(batch.map(id => fetch(`${h.url}/api/thumbnails/${encodeURIComponent(id)}`)));
    responses.forEach(response => { assert.equal(response.status, 200); generated += 1; });
  }
  return { count: generated, durationMs: round(performance.now() - started) };
}

async function measureFilterP95(h) {
  const durations = [];
  for (let index = 0; index < 25; index += 1) {
    const started = performance.now();
    const response = await fetch(`${h.url}/api/photos?collection=all&status=all&dateFrom=2010-01-01&dateTo=2030-12-31&minScore=70&maxScore=95&sort=memory&page=1&pageSize=60`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.items.length, 60);
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  return { samples: durations.length, p50Ms: round(durations[Math.floor(durations.length * 0.5)]), p95Ms: round(durations[Math.ceil(durations.length * 0.95) - 1]) };
}

async function measureGalleryNavigation(page, url, cold) {
  if (cold) {
    const session = await page.context().newCDPSession(page);
    await session.send("Network.clearBrowserCache");
    await session.detach();
  }
  const started = performance.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "时间线", exact: true }).click();
  await page.locator(".photoCard").first().waitFor();
  await page.locator(".photoCard img").first().evaluate(image => image.decode());
  const firstScreenMs = performance.now() - started;
  const initialMountedCards = await page.locator(".photoCard").count();
  const heapBytes = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  const viewport = page.locator(".virtualViewport");
  await viewport.evaluate(element => { element.scrollTop = 1600; });
  await page.waitForTimeout(120);
  const scrolledMountedCards = await page.locator(".photoCard").count();
  assert.ok(initialMountedCards < 60 && scrolledMountedCards < 60, "virtual gallery should mount fewer than one page of cards");
  return { firstScreenMs: round(firstScreenMs), initialMountedCards, scrolledMountedCards, heapBytes };
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}
