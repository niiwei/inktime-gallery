import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import express from "express";
import exifr from "exifr";
import sharp from "sharp";
import { createServer as createViteServer } from "vite";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isStaticServer = process.env.INKTIME_STATIC === "1";
const configDir = process.env.INKTIME_CONFIG_DIR ? path.resolve(process.env.INKTIME_CONFIG_DIR) : path.join(rootDir, "config");
const runtimeDataRoot = process.env.INKTIME_DATA_ROOT ? path.resolve(process.env.INKTIME_DATA_ROOT) : "";
const envDir = process.env.INKTIME_ENV_DIR ? path.resolve(process.env.INKTIME_ENV_DIR) : rootDir;
const configPath = path.join(configDir, "gallery.config.json");
const worldCitiesPath = path.join(rootDir, "reference", "InkTime", "data", "world_cities_zh.csv");
const cityGridDeg = 1.0;
const cityMaxDistanceKm = 80.0;
const ollamaContextTokens = 8192;
const ollamaImageMaxEdge = 1024;
const modelCallTimeoutMs = 240000;
const modelStreamIdleTimeoutMs = 90000;
const execFileAsync = promisify(execFile);

const defaultScoringPrompt = [
  "你是一个个人相册照片回忆度评估助手，目标是判断一张照片将来是否值得被重新看见。",
  "请只输出 JSON，不要输出 Markdown，不要输出解释。",
  "字段：caption 中文 80~200 字；type 中文标签数组；memory_score 0~100；reason 中文不超过 80 字。",
  "回忆度不是照片好不好看，而是它和个人生活、关系、经历、情绪、地点、时间、事件之间的连接强度。",
  "高回忆度照片通常包含：重要人物或亲密关系；旅行、聚会、毕业、搬家、生日、节日等事件；少见场景或很难复现的瞬间；能唤起明确情绪的表情、动作、物件或环境；能代表某段生活状态的日常细节。",
  "中等回忆度照片通常是普通但有生活痕迹的记录，例如一顿饭、一次出门、某件新买的东西、家里某个角落、一次普通自拍。若它能让人想起具体的人、地点或阶段，可以适当提高分数。",
  "低回忆度照片通常包括：纯截图、账单、广告、表情包、模糊废片、重复快门中信息量较少的一张、没有明确主体的杂物、临时保存的资料图。",
  "重复或相似照片中，如果画面信息接近，应优先给人物表情更自然、事件信息更完整、故事线索更多的一张更高分。",
  "评分参考：90~100 非常值得长期保留；75~89 有明确回忆价值；55~74 普通生活记录但仍有意义；35~54 信息较弱；0~34 基本不值得进入相框轮播。",
].join("\n");

const defaultSideCaptionPrompt = [
  "你是一位为电子相框撰写中文短句的文案助手。",
  "目标不是复述画面，而是为照片补上一点画外之意。",
  "只输出一句中文短句，不要引号，不要解释，不要换行。",
  "长度 8 到 24 个汉字，克制、自然、有余味，可以轻微幽默，但不要鸡汤。",
  "避免使用“这张照片”“这一刻”“时光”“岁月”“世界”“治愈”等套话。",
].join("\n");

await loadLocalEnv(path.join(envDir, ".env"));
await loadLocalEnv(path.join(envDir, ".env.local"));

const defaultLayoutTemplates = {
  portrait: {
    width: 420,
    height: 700,
    background: "#f8f4ec",
    elements: {
      photo: { x: 24, y: 24, width: 372, height: 500, fit: "cover", radius: 16 },
      caption: { x: 32, y: 548, width: 270, height: 68, fontSize: 24, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#171b18", align: "left" },
      date: { x: 32, y: 642, width: 108, height: 24, fontSize: 15, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#4f5752", align: "left" },
      place: { x: 238, y: 642, width: 132, height: 24, fontSize: 15, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#4f5752", align: "right" },
      score: { x: 286, y: 604, width: 84, height: 24, fontSize: 15, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#4f5752", align: "right" },
    },
  },
  landscape: {
    width: 700,
    height: 420,
    background: "#f8f4ec",
    elements: {
      photo: { x: 24, y: 24, width: 452, height: 372, fit: "cover", radius: 16 },
      caption: { x: 504, y: 42, width: 150, height: 130, fontSize: 24, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#171b18", align: "left" },
      date: { x: 504, y: 328, width: 110, height: 24, fontSize: 15, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#4f5752", align: "left" },
      place: { x: 504, y: 356, width: 110, height: 24, fontSize: 15, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#4f5752", align: "left" },
      score: { x: 504, y: 248, width: 110, height: 24, fontSize: 15, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#4f5752", align: "left" },
    },
  },
  square: {
    width: 560,
    height: 560,
    background: "#f8f4ec",
    elements: {
      photo: { x: 28, y: 28, width: 504, height: 372, fit: "cover", radius: 16 },
      caption: { x: 36, y: 424, width: 330, height: 58, fontSize: 23, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#171b18", align: "left" },
      date: { x: 36, y: 506, width: 110, height: 24, fontSize: 15, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#4f5752", align: "left" },
      place: { x: 386, y: 506, width: 110, height: 24, fontSize: 15, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#4f5752", align: "right" },
      score: { x: 416, y: 466, width: 84, height: 24, fontSize: 15, fontFamily: "Songti SC, Noto Serif CJK SC, serif", color: "#4f5752", align: "right" },
    },
  },
};

const defaultConfig = {
  imageDir: path.join(os.homedir(), "Pictures"),
  providerBaseUrl: "http://127.0.0.1:11434",
  apiKeyEnvName: "",
  model: "qwen3-vl:8b",
  modelOptions: ["qwen3-vl:8b"],
  excludeScreenshots: true,
  excludeNamePatterns: ["screenshot", "screen shot", "screen_shot", "截屏", "截图", "屏幕截图"],
  maxImagesPerRun: 20,
  maxConcurrentImages: 1,
  dataDir: "data",
  databaseFile: "gallery.sqlite",
  renderFrameMode: "fixed",
  renderWidth: 480,
  renderHeight: 800,
  footerHeight: 112,
  wallpaperWidth: 3024,
  wallpaperHeight: 1964,
  wallpaperAutoIntervalHours: 1,
  wallpaperCollection: "representative",
  layoutTemplates: defaultLayoutTemplates,
  promptVersion: "v1",
  scoringPrompt: defaultScoringPrompt,
  sideCaptionPrompt: defaultSideCaptionPrompt,
};

let cachedCities = null;
let cachedCityGrid = null;
let processProgress = createProcessProgress("idle");
let sqliteDb = null;
let sqliteDbPath = "";
let processStopRequested = false;
const activeModelAbortControllers = new Set();

const initialConfig = await loadConfig();
const app = express();

app.use(express.json({ limit: "4mb" }));

app.get("/api/config", async (_req, res) => {
  const config = await loadConfig();
  res.json({ ...config, apiKeyConfigured: Boolean(resolveApiKey(config)) });
});

app.put("/api/config", async (req, res) => {
  try {
    const nextConfig = normalizeConfig(req.body ?? {});
    await writeConfig(nextConfig);
    res.json({ ...nextConfig, apiKeyConfigured: Boolean(resolveApiKey(nextConfig)) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "配置保存失败。" });
  }
});

app.get("/api/photos", async (req, res) => {
  const config = await loadConfig();
  const db = await readDb(config, normalizeCollection(req.query.collection));
  res.json(db.items);
});

app.get("/api/sources", async (req, res) => {
  const config = await loadConfig();
  res.json(await readSources(config, normalizeSourceStatus(req.query.status)));
});

app.post("/api/sources/scan", async (_req, res) => {
  try {
    const config = await loadConfig();
    const files = await listImageFiles(config.imageDir);
    await syncSourceInventory(config, files);
    const db = await getLibraryDb(config);
    await refreshSourceSkipState(config, db);
    res.json({ total: files.length, stats: await readLibraryStats(config) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "扫描失败。" });
  }
});

app.get("/api/library/stats", async (_req, res) => {
  const config = await loadConfig();
  res.json(await readLibraryStats(config));
});

app.post("/api/photos/:id/curated", async (req, res) => {
  try {
    const config = await loadConfig();
    const item = await setCuratedPhoto(config, req.params.id, Boolean(req.body?.curated));
    if (!item) {
      res.status(404).json({ error: "照片不存在。" });
      return;
    }
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "精选状态保存失败。" });
  }
});

app.post("/api/photos/:id/wallpaper", async (req, res) => {
  try {
    const config = await loadConfig();
    const result = await setWallpaperByPhotoId(config, req.params.id);
    if (!result) {
      res.status(404).json({ error: "照片不存在或还没有生成壁纸。" });
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "壁纸设置失败。" });
  }
});

app.post("/api/wallpaper/random", async (_req, res) => {
  try {
    const config = await loadConfig();
    res.json(await setRandomWallpaper(config));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "壁纸设置失败。" });
  }
});

app.post("/api/process", async (req, res) => {
  try {
    if (processProgress.status === "running") {
      res.status(409).json({ error: "已有处理任务正在运行。" });
      return;
    }
    const config = await loadConfig();
    const mode = req.body?.mode === "rerun" ? "rerun" : "new";
    const sourceIds = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds.map((id) => String(id)).filter(Boolean) : [];
    const result = sourceIds.length ? await processSelectedSources(config, sourceIds) : mode === "rerun" ? await rerunExistingItems(config) : await processNewItems(config);
    res.json(result);
  } catch (error) {
    failProcessProgress(error instanceof Error ? error.message : "处理失败。");
    res.status(500).json({ error: error instanceof Error ? error.message : "处理失败。" });
  }
});

app.post("/api/process/stop", (_req, res) => {
  processStopRequested = true;
  for (const controller of activeModelAbortControllers) controller.abort();
  updateProcessProgress({ message: "正在停止，已完成的图片会保留。" });
  res.json({ stopping: true });
});

app.get("/api/process/progress", (_req, res) => {
  res.json(processProgress);
});

app.post("/api/rerender", async (req, res) => {
  try {
    if (processProgress.status === "running") {
      res.status(409).json({ error: "已有处理任务正在运行。" });
      return;
    }
    const config = await loadConfig();
    const limit = sanitizePositiveInt(req.body?.limit, 0);
    const result = await rerenderExistingItems(config, limit);
    res.json(result);
  } catch (error) {
    failProcessProgress(error instanceof Error ? error.message : "重新渲染失败。");
    res.status(500).json({ error: error instanceof Error ? error.message : "重新渲染失败。" });
  }
});

app.post("/api/library/clear", async (_req, res) => {
  try {
    const config = await loadConfig();
    const result = await clearLibrary(config);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "清空失败。" });
  }
});

app.use("/renders", async (req, res, next) => {
  const config = await loadConfig();
  res.setHeader("Cache-Control", "no-store");
  return express.static(getRendersDir(config), { etag: false, lastModified: false })(req, res, next);
});

app.use("/wallpapers", async (req, res, next) => {
  const config = await loadConfig();
  res.setHeader("Cache-Control", "no-store");
  return express.static(getWallpapersDir(config), { etag: false, lastModified: false })(req, res, next);
});

app.use("/source", async (req, res, next) => {
  const config = await loadConfig();
  return express.static(config.imageDir)(req, res, next);
});

if (isStaticServer) {
  const distDir = path.join(rootDir, "dist");
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  const vite = await createViteServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

const serverPort = Number(process.env.PORT || 5173);
app.listen(serverPort, "127.0.0.1", () => {
  console.log(`InkTime Gallery running at http://127.0.0.1:${serverPort}`);
});

async function processNewItems(config) {
  processStopRequested = false;
  startProcessProgress("new", "正在扫描图片目录...");
  const files = await listImageFiles(config.imageDir);
  await syncSourceInventory(config, files);
  const libraryDb = await getLibraryDb(config);
  await refreshSourceSkipState(config, libraryDb);
  const runId = createRunId();
  const selected = readProcessableSources(libraryDb, config.maxImagesPerRun);
  const skippedDuplicates = countSkippedSources(libraryDb);
  updateProcessProgress({
    message: selected.length ? "正在分析并生成图片..." : "没有发现需要处理的新图片。",
    total: selected.length,
    skippedDuplicates,
  });

  const results = await mapWithConcurrency(selected, config.maxConcurrentImages, async (source) => {
    if (processStopRequested) return null;
    updateProcessProgress({
      currentFile: source.file_name,
      message: `正在处理 ${source.file_name}`,
    });
    try {
      markSourceStatus(libraryDb, source.id, "processing", "", "");
      const item = await processImage(source.source_path, config, { fileHash: source.file_hash || (await hashFile(source.source_path)), runId });
      await writeDb(config, { items: [item, ...(await readDb(config, "all")).items.filter((entry) => entry.id !== item.id)] });
      markSourceStatus(libraryDb, source.id, "processed", "", "");
      incrementProcessProgress({ succeeded: 1, tokenUsage: item.tokenUsage });
      return item;
    } catch (error) {
      if (processStopRequested || isAbortError(error)) {
        markSourceStatus(libraryDb, source.id, "pending", "", "");
        appendAguiEvent("warn", `${source.file_name} 已停止，保留为未处理`);
        return null;
      }
      const errorMessage = error instanceof Error ? error.message : "处理失败";
      appendAguiEvent("error", `${source.file_name}: ${errorMessage}`);
      markSourceStatus(libraryDb, source.id, "failed", "process_error", errorMessage);
      incrementProcessProgress({ failed: 1 });
      return null;
    }
  });
  const processed = results.filter(Boolean);
  if (processed.length) await rewriteProcessedGroups(config);

  const result = {
    mode: "new",
    runId,
    processed: processed.length,
    skipped: countSkippedSources(libraryDb),
    skippedDuplicates,
    tokenTotal: processProgress.tokenTotal,
    stopped: processStopRequested,
  };
  finishProcessProgress({
    message: processStopRequested ? `已停止：本次完成 ${processed.length} 张。` : `处理完成：新增 ${processed.length} 张，跳过 ${result.skipped} 张。`,
    processed: processed.length,
    skipped: result.skipped,
  });
  processStopRequested = false;
  return result;
}

async function processSelectedSources(config, sourceIds) {
  processStopRequested = false;
  startProcessProgress("selected", "正在准备选中图片...");
  const files = await listImageFiles(config.imageDir);
  await syncSourceInventory(config, files);
  const libraryDb = await getLibraryDb(config);
  await refreshSourceSkipState(config, libraryDb);
  const runId = createRunId();
  const selected = readSourcesByIds(libraryDb, sourceIds).slice(0, config.maxImagesPerRun);
  updateProcessProgress({
    message: selected.length ? "正在处理选中图片..." : "没有可处理的选中图片。",
    total: selected.length,
  });

  const results = await mapWithConcurrency(selected, config.maxConcurrentImages, async (source) => {
    if (processStopRequested) return null;
    updateProcessProgress({
      currentFile: source.file_name,
      message: `正在处理 ${source.file_name}`,
    });
    try {
      markSourceStatus(libraryDb, source.id, "processing", "", "");
      const item = await processImage(source.source_path, config, {
        fileHash: source.file_hash || (await hashFile(source.source_path)),
        runId,
      });
      await writeDb(config, { items: [item, ...(await readDb(config, "all")).items.filter((entry) => entry.id !== item.id)] });
      markSourceStatus(libraryDb, source.id, "processed", "", "");
      incrementProcessProgress({ succeeded: 1, tokenUsage: item.tokenUsage });
      return item;
    } catch (error) {
      if (processStopRequested || isAbortError(error)) {
        markSourceStatus(libraryDb, source.id, "pending", "", "");
        appendAguiEvent("warn", `${source.file_name} 已停止，保留为未处理`);
        return null;
      }
      const errorMessage = error instanceof Error ? error.message : "处理失败";
      appendAguiEvent("error", `${source.file_name}: ${errorMessage}`);
      markSourceStatus(libraryDb, source.id, "failed", "process_error", errorMessage);
      incrementProcessProgress({ failed: 1 });
      return null;
    }
  });

  const processed = results.filter(Boolean);
  if (processed.length) await rewriteProcessedGroups(config);
  const result = {
    mode: "selected",
    runId,
    processed: processed.length,
    skipped: selected.length - processed.length,
    skippedDuplicates: 0,
    tokenTotal: processProgress.tokenTotal,
    stopped: processStopRequested,
  };
  finishProcessProgress({
    message: processStopRequested ? `已停止：选中图片完成 ${processed.length} 张。` : `选中图片处理完成：${processed.length} 张。`,
    processed: processed.length,
    skipped: result.skipped,
  });
  processStopRequested = false;
  return result;
}

async function rerunExistingItems(config) {
  startProcessProgress("rerun", "正在读取已入库图片...");
  const db = await readDb(config, "all");
  const runId = createRunId();
  const existing = [...db.items];
  const toProcess = existing.slice(0, config.maxImagesPerRun);
  const untouched = existing.slice(config.maxImagesPerRun);
  updateProcessProgress({
    message: toProcess.length ? "正在重跑已入库图片..." : "没有可重跑的图片。",
    total: toProcess.length,
  });

  const results = await mapWithConcurrency(toProcess, config.maxConcurrentImages, async (item) => {
    updateProcessProgress({
      currentFile: item.fileName,
      message: `正在重跑 ${item.fileName}`,
    });
    try {
      const refreshed = await processImage(item.sourcePath, config, {
        fileHash: item.fileHash || (await hashFile(item.sourcePath)),
        runId,
        existingId: item.id,
      });
      incrementProcessProgress({ succeeded: 1, tokenUsage: refreshed.tokenUsage });
      return { item: refreshed, processed: true };
    } catch {
      incrementProcessProgress({ failed: 1 });
      return { item, processed: false };
    }
  });

  const processed = results.filter((result) => result.processed);
  const nextItems = [...results.map((result) => result.item), ...untouched];
  db.items = assignSimilarityGroups(nextItems).sort((a, b) => b.processedAt.localeCompare(a.processedAt));
  await writeDb(config, db);

  const result = {
    mode: "rerun",
    runId,
    processed: processed.length,
    skipped: Math.max(0, existing.length - processed.length),
    skippedDuplicates: 0,
    tokenTotal: processProgress.tokenTotal,
  };
  finishProcessProgress({
    message: `重跑完成：更新 ${processed.length} 张。`,
    processed: processed.length,
    skipped: result.skipped,
  });
  return result;
}

async function rerenderExistingItems(config, limit) {
  startProcessProgress("rerender", "正在重新生成图片...");
  const db = await readDb(config, "all");
  const rendersDir = getRendersDir(config);
  const wallpapersDir = getWallpapersDir(config);
  await fs.mkdir(rendersDir, { recursive: true });
  await fs.mkdir(wallpapersDir, { recursive: true });

  let rendered = 0;
  let skipped = 0;
  const total = limit > 0 ? Math.min(limit, db.items.length) : db.items.length;
  updateProcessProgress({ total, message: total ? "正在重新生成渲染图和 Mac 壁纸..." : "没有可重新生成的图片。" });
  for (const item of db.items) {
    if (limit > 0 && rendered >= limit) {
      skipped += 1;
      continue;
    }
    try {
      const renderVersion = Date.now();
      updateProcessProgress({
        currentFile: item.fileName,
        message: `正在重渲染 ${item.fileName}`,
      });
      const stat = await fs.stat(item.sourcePath);
      const photoDetails = await readPhotoDetails(item.sourcePath, stat);
      const renderAnalysis = {
        caption: item.caption || "",
        side_caption: item.sideCaption || item.caption || "",
        location: photoDetails.location,
        memory_score: Number(item.scores?.memory || 0),
      };
      await renderImage(
        item.sourcePath,
        renderAnalysis,
        path.join(rendersDir, `${item.id}.png`),
        config,
        photoDetails.capturedDate || item.capturedDate,
      );
      await renderMacWallpaper(
        item.sourcePath,
        renderAnalysis,
        path.join(wallpapersDir, `${item.id}.jpg`),
        config,
        photoDetails.capturedDate || item.capturedDate,
      );
      item.renderedUrl = `/renders/${item.id}.png?v=${renderVersion}`;
      item.wallpaperUrl = `/wallpapers/${item.id}.jpg?v=${renderVersion}`;
      rendered += 1;
      incrementProcessProgress({ succeeded: 1 });
    } catch {
      skipped += 1;
      incrementProcessProgress({ failed: 1 });
    }
  }
  await writeDb(config, db);

  const result = {
    mode: "rerender",
    rendered,
    skipped,
  };
  finishProcessProgress({
    message: `重渲染完成：生成 ${rendered} 张，跳过 ${skipped} 张。`,
    processed: rendered,
    skipped,
  });
  return result;
}

async function clearLibrary(config) {
  const libraryDb = await getLibraryDb(config);
  const removedItems = libraryDb.prepare("select count(*) as count from processed_photos").get().count;
  const rendersDir = getRendersDir(config);
  const wallpapersDir = getWallpapersDir(config);
  const removedRenders = await clearRenderFiles(rendersDir);
  const removedWallpapers = await clearRenderFiles(wallpapersDir);
  libraryDb.exec("delete from wallpaper_history; delete from curated_photos; delete from processed_photos; delete from source_photos;");
  return {
    mode: "clear",
    removedItems,
    removedRenders,
    removedWallpapers,
  };
}

async function loadConfig() {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return normalizeConfig(defaultConfig);
  }
}

async function writeConfig(config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

function normalizeConfig(input) {
  const merged = { ...defaultConfig, ...input };
  return {
    imageDir: normalizeImageDir(merged.imageDir),
    providerBaseUrl: String(merged.providerBaseUrl || defaultConfig.providerBaseUrl).trim() || defaultConfig.providerBaseUrl,
    apiKeyEnvName: normalizeOptionalString(merged.apiKeyEnvName, defaultConfig.apiKeyEnvName),
    model: String(merged.model || defaultConfig.model).trim() || defaultConfig.model,
    modelOptions: normalizeModelOptions(merged.modelOptions),
    excludeScreenshots: Boolean(merged.excludeScreenshots),
    excludeNamePatterns: normalizeStringList(merged.excludeNamePatterns, defaultConfig.excludeNamePatterns),
    maxImagesPerRun: sanitizePositiveInt(merged.maxImagesPerRun, defaultConfig.maxImagesPerRun),
    maxConcurrentImages: Math.min(6, sanitizePositiveInt(merged.maxConcurrentImages, defaultConfig.maxConcurrentImages)),
    dataDir: String(merged.dataDir || defaultConfig.dataDir).trim() || defaultConfig.dataDir,
    databaseFile: normalizeDatabaseFile(merged.databaseFile, defaultConfig.databaseFile),
    renderFrameMode: normalizeRenderFrameMode(merged.renderFrameMode),
    renderWidth: sanitizePositiveInt(merged.renderWidth, defaultConfig.renderWidth),
    renderHeight: sanitizePositiveInt(merged.renderHeight, defaultConfig.renderHeight),
    footerHeight: sanitizePositiveInt(merged.footerHeight, defaultConfig.footerHeight),
    wallpaperWidth: sanitizePositiveInt(merged.wallpaperWidth, defaultConfig.wallpaperWidth),
    wallpaperHeight: sanitizePositiveInt(merged.wallpaperHeight, defaultConfig.wallpaperHeight),
    wallpaperAutoIntervalHours: sanitizeNonNegativeNumber(merged.wallpaperAutoIntervalHours, defaultConfig.wallpaperAutoIntervalHours),
    wallpaperCollection: normalizeWallpaperCollection(merged.wallpaperCollection),
    layoutTemplates: normalizeLayoutTemplates(merged.layoutTemplates),
    promptVersion: String(merged.promptVersion || defaultConfig.promptVersion).trim() || defaultConfig.promptVersion,
    scoringPrompt: String(merged.scoringPrompt || defaultConfig.scoringPrompt).trim() || defaultConfig.scoringPrompt,
    sideCaptionPrompt: String(merged.sideCaptionPrompt || defaultConfig.sideCaptionPrompt).trim() || defaultConfig.sideCaptionPrompt,
  };
}

function normalizeImageDir(value) {
  const raw = String(value || "").trim();
  if (!raw) return defaultConfig.imageDir;
  if (isWindowsAbsolutePath(raw) && process.platform !== "win32") {
    return defaultConfig.imageDir;
  }
  return path.resolve(raw);
}

function normalizeOptionalString(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function isWindowsAbsolutePath(value) {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function normalizeModelOptions(value) {
  const cleaned = normalizeStringList(value, defaultConfig.modelOptions);
  return cleaned.length ? Array.from(new Set(cleaned)) : [...defaultConfig.modelOptions];
}

function normalizeStringList(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  const cleaned = source.map((item) => String(item || "").trim()).filter(Boolean);
  return cleaned.length ? Array.from(new Set(cleaned)) : [...fallback];
}

function normalizeDatabaseFile(value, fallback) {
  const raw = String(value || fallback).trim() || fallback;
  const normalized = raw.replaceAll("\\", "/").split("/").filter(Boolean).join("/") || fallback;
  return normalized.endsWith(".json") ? normalized.replace(/\.json$/i, ".sqlite") : normalized;
}

function sanitizePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

function sanitizeNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed * 100) / 100;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

function getDataDir(config) {
  if (runtimeDataRoot) return runtimeDataRoot;
  return path.resolve(rootDir, config.dataDir);
}

function getDbPath(config) {
  return path.join(getDataDir(config), config.databaseFile);
}

function getLegacyJsonDbPath(config) {
  return path.join(getDataDir(config), "gallery-db.json");
}

function getRendersDir(config) {
  return path.join(getDataDir(config), "renders");
}

function getWallpapersDir(config) {
  return path.join(getDataDir(config), "wallpapers");
}

async function readDb(config, collection = "representative") {
  const db = await getLibraryDb(config);
  const where = collection === "curated" ? "where c.photo_id is not null" : collection === "all" ? "" : "where p.is_representative = 1";
  const rows = db
    .prepare(
      `select p.*, s.source_path, s.file_name, s.file_hash, s.perceptual_hash, s.captured_at, s.captured_date,
              s.location, s.width, s.height, s.orientation, c.photo_id as curated_photo_id
         from processed_photos p
         join source_photos s on s.id = p.source_id
         left join curated_photos c on c.photo_id = p.id
         ${where}
         order by p.processed_at desc`,
    )
    .all();
  return { items: rows.map(rowToGalleryItem) };
}

async function writeDb(config, dbData) {
  const db = await getLibraryDb(config);
  const items = assignSimilarityGroups(Array.isArray(dbData.items) ? dbData.items : []);
  const keepIds = new Set(items.map((item) => item.id));
  db.exec("begin immediate");
  try {
    for (const item of items) {
      upsertSourceRow(db, item);
      upsertProcessedRow(db, item);
    }
    const existing = db.prepare("select id from processed_photos").all();
    const deleteProcessed = db.prepare("delete from processed_photos where id = ?");
    const deleteCurated = db.prepare("delete from curated_photos where photo_id = ?");
    for (const row of existing) {
      if (keepIds.has(row.id)) continue;
      deleteCurated.run(row.id);
      deleteProcessed.run(row.id);
    }
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

async function getLibraryDb(config) {
  const dbPath = getDbPath(config);
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  if (sqliteDb && sqliteDbPath === dbPath) return sqliteDb;
  if (sqliteDb) sqliteDb.close();
  sqliteDb = new DatabaseSync(dbPath);
  sqliteDbPath = dbPath;
  sqliteDb.exec("pragma journal_mode = WAL");
  sqliteDb.exec("pragma foreign_keys = ON");
  ensureSchema(sqliteDb);
  await migrateLegacyJsonDb(config, sqliteDb);
  return sqliteDb;
}

function ensureSchema(db) {
  db.exec(`
    create table if not exists metadata (
      key text primary key,
      value text not null
    );
    create table if not exists source_photos (
      id text primary key,
      source_path text not null unique,
      file_name text not null,
      file_hash text,
      perceptual_hash text,
      captured_at text,
      captured_date text,
      location text,
      width integer,
      height integer,
      orientation text,
      status text not null default 'pending',
      skip_code text,
      skip_reason text,
      added_at text not null,
      last_seen_at text not null
    );
    create table if not exists processed_photos (
      id text primary key,
      source_id text not null,
      run_id text,
      prompt_version text,
      model text,
      source_url text,
      rendered_url text,
      wallpaper_url text,
      memory_score real not null default 0,
      metrics_json text,
      caption text,
      side_caption text,
      reason text,
      tags_json text,
      processed_at text not null,
      token_input integer not null default 0,
      token_output integer not null default 0,
      token_total integer not null default 0,
      token_estimated integer not null default 0,
      similar_group_id text,
      is_representative integer not null default 1,
      foreign key (source_id) references source_photos(id) on delete cascade
    );
    create table if not exists curated_photos (
      photo_id text primary key,
      created_at text not null,
      foreign key (photo_id) references processed_photos(id) on delete cascade
    );
    create table if not exists wallpaper_history (
      id text primary key,
      photo_id text not null,
      wallpaper_path text not null,
      set_at text not null,
      foreign key (photo_id) references processed_photos(id) on delete cascade
    );
  `);
  ensureColumn(db, "source_photos", "status", "text not null default 'pending'");
  ensureColumn(db, "source_photos", "skip_code", "text");
  ensureColumn(db, "source_photos", "skip_reason", "text");
  db.exec(`
    create index if not exists idx_processed_representative on processed_photos(is_representative, processed_at);
    create index if not exists idx_processed_group on processed_photos(similar_group_id);
    create index if not exists idx_source_captured on source_photos(captured_at);
    create index if not exists idx_source_status on source_photos(status, last_seen_at);
  `);
}

function ensureColumn(db, tableName, columnName, definition) {
  const columns = db.prepare(`pragma table_info(${tableName})`).all();
  if (columns.some((column) => column.name === columnName)) return;
  db.exec(`alter table ${tableName} add column ${columnName} ${definition}`);
}

async function migrateLegacyJsonDb(config, db) {
  const migrated = db.prepare("select value from metadata where key = ?").get("legacyJsonImported");
  if (migrated?.value === "1") return;
  const count = db.prepare("select count(*) as count from processed_photos").get().count;
  if (count > 0) {
    db.prepare("insert or replace into metadata(key, value) values (?, ?)").run("legacyJsonImported", "1");
    return;
  }
  try {
    const raw = await fs.readFile(getLegacyJsonDbPath(config), "utf8");
    const legacy = JSON.parse(raw);
    const items = assignSimilarityGroups(Array.isArray(legacy.items) ? legacy.items : []);
    db.exec("begin immediate");
    try {
      for (const item of items) {
        upsertSourceRow(db, item);
        upsertProcessedRow(db, item);
        if (item.isCurated) {
          db.prepare("insert or ignore into curated_photos(photo_id, created_at) values (?, ?)").run(item.id, new Date().toISOString());
        }
      }
      db.prepare("insert or replace into metadata(key, value) values (?, ?)").run("legacyJsonImported", "1");
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
  } catch {
    db.prepare("insert or replace into metadata(key, value) values (?, ?)").run("legacyJsonImported", "1");
  }
}

async function readLibraryStats(config) {
  const db = await getLibraryDb(config);
  const original = db.prepare("select count(*) as count from source_photos").get().count;
  const processed = db.prepare("select count(*) as count from processed_photos").get().count;
  const pending = db.prepare("select count(*) as count from source_photos where status = 'pending'").get().count;
  const skipped = db.prepare("select count(*) as count from source_photos where status = 'skipped'").get().count;
  const failed = db.prepare("select count(*) as count from source_photos where status = 'failed'").get().count;
  const curated = db.prepare("select count(*) as count from curated_photos").get().count;
  const representatives = db.prepare("select count(*) as count from processed_photos where is_representative = 1").get().count;
  const groups = db.prepare("select count(distinct similar_group_id) as count from processed_photos where similar_group_id is not null").get().count;
  const tokens = db.prepare("select coalesce(sum(token_total), 0) as total from processed_photos").get().total;
  return { original, processed, pending, skipped, failed, curated, representatives, similarGroups: groups, tokenTotal: tokens, databasePath: getDbPath(config) };
}

async function setCuratedPhoto(config, photoId, curated) {
  const db = await getLibraryDb(config);
  const exists = db.prepare("select id from processed_photos where id = ?").get(photoId);
  if (!exists) return null;
  if (curated) {
    db.prepare("insert or ignore into curated_photos(photo_id, created_at) values (?, ?)").run(photoId, new Date().toISOString());
  } else {
    db.prepare("delete from curated_photos where photo_id = ?").run(photoId);
  }
  const row = readProcessedRow(db, photoId);
  return row ? rowToGalleryItem(row) : null;
}

async function setRandomWallpaper(config) {
  const db = await getLibraryDb(config);
  const latest = db.prepare("select photo_id from wallpaper_history order by set_at desc limit 1").get();
  const source = normalizeWallpaperCollection(config.wallpaperCollection);
  const joinCurated = source === "curated" ? "join curated_photos c on c.photo_id = p.id" : "";
  const sourceWhere = source === "representative" ? "and p.is_representative = 1" : "";
  let row = db
    .prepare(
      `select p.id, p.wallpaper_url, s.file_name
         from processed_photos p
         join source_photos s on s.id = p.source_id
         ${joinCurated}
        where p.wallpaper_url is not null and p.wallpaper_url != '' ${sourceWhere}
          and (? is null or p.id != ?)
        order by random()
        limit 1`,
    )
    .get(latest?.photo_id || null, latest?.photo_id || null);
  if (!row && latest?.photo_id) {
    row = db
      .prepare(
        `select p.id, p.wallpaper_url, s.file_name
           from processed_photos p
           join source_photos s on s.id = p.source_id
           ${joinCurated}
          where p.wallpaper_url is not null and p.wallpaper_url != '' ${sourceWhere}
          order by random()
          limit 1`,
      )
      .get();
  }
  if (!row) throw new Error("还没有可用的壁纸图片。");
  return applyWallpaperRow(config, db, row);
}

async function setWallpaperByPhotoId(config, photoId) {
  const db = await getLibraryDb(config);
  const row = db
    .prepare(
      `select p.id, p.wallpaper_url, s.file_name
         from processed_photos p
         join source_photos s on s.id = p.source_id
        where p.id = ? and p.wallpaper_url is not null and p.wallpaper_url != ''
        limit 1`,
    )
    .get(photoId);
  if (!row) return null;
  return applyWallpaperRow(config, db, row);
}

async function applyWallpaperRow(config, db, row) {
  const wallpaperPath = path.join(getWallpapersDir(config), path.basename(stripUrlQuery(row.wallpaper_url)));
  try {
    await fs.access(wallpaperPath);
  } catch {
    throw new Error("壁纸文件不存在，请先重新渲染这批照片。");
  }
  const appliedPath = await applyDesktopWallpaper(wallpaperPath);
  db.prepare("insert into wallpaper_history(id, photo_id, wallpaper_path, set_at) values (?, ?, ?, ?)").run(
    createRunId(),
    row.id,
    wallpaperPath,
    new Date().toISOString(),
  );
  return { photoId: row.id, fileName: row.file_name, wallpaperPath, appliedPath };
}

function readProcessedRow(db, photoId) {
  return db
    .prepare(
      `select p.*, s.source_path, s.file_name, s.file_hash, s.perceptual_hash, s.captured_at, s.captured_date,
              s.location, s.width, s.height, s.orientation, c.photo_id as curated_photo_id
         from processed_photos p
         join source_photos s on s.id = p.source_id
         left join curated_photos c on c.photo_id = p.id
        where p.id = ?`,
    )
    .get(photoId);
}

function upsertSourceRow(db, item) {
  const sourceId = item.sourceId || createSourceId(item.sourcePath);
  const metrics = item.metrics || {};
  db.prepare(
    `insert into source_photos(
      id, source_path, file_name, file_hash, perceptual_hash, captured_at, captured_date,
      location, width, height, orientation, status, skip_code, skip_reason, added_at, last_seen_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      source_path = excluded.source_path,
      file_name = excluded.file_name,
      file_hash = coalesce(excluded.file_hash, source_photos.file_hash),
      perceptual_hash = coalesce(excluded.perceptual_hash, source_photos.perceptual_hash),
      captured_at = coalesce(excluded.captured_at, source_photos.captured_at),
      captured_date = coalesce(excluded.captured_date, source_photos.captured_date),
      location = coalesce(excluded.location, source_photos.location),
      width = coalesce(excluded.width, source_photos.width),
      height = coalesce(excluded.height, source_photos.height),
      orientation = coalesce(excluded.orientation, source_photos.orientation),
      status = excluded.status,
      skip_code = excluded.skip_code,
      skip_reason = excluded.skip_reason,
      last_seen_at = excluded.last_seen_at`,
  ).run(
    sourceId,
    item.sourcePath,
    item.fileName || path.basename(item.sourcePath || ""),
    item.fileHash || null,
    item.perceptualHash || null,
    item.capturedAt || null,
    item.capturedDate || null,
    item.location || null,
    metrics.width || null,
    metrics.height || null,
    metrics.orientation || null,
    item.skipReason ? "skipped" : "processed",
    item.skipCode || null,
    item.skipReason || null,
    item.processedAt || new Date().toISOString(),
    new Date().toISOString(),
  );
  item.sourceId = sourceId;
}

function upsertProcessedRow(db, item) {
  const tokenUsage = item.tokenUsage || emptyTokenUsage();
  db.prepare(
    `insert into processed_photos(
      id, source_id, run_id, prompt_version, model, source_url, rendered_url, wallpaper_url,
      memory_score, metrics_json, caption, side_caption, reason, tags_json, processed_at,
      token_input, token_output, token_total, token_estimated, similar_group_id, is_representative
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      source_id = excluded.source_id,
      run_id = excluded.run_id,
      prompt_version = excluded.prompt_version,
      model = excluded.model,
      source_url = excluded.source_url,
      rendered_url = excluded.rendered_url,
      wallpaper_url = excluded.wallpaper_url,
      memory_score = excluded.memory_score,
      metrics_json = excluded.metrics_json,
      caption = excluded.caption,
      side_caption = excluded.side_caption,
      reason = excluded.reason,
      tags_json = excluded.tags_json,
      processed_at = excluded.processed_at,
      token_input = excluded.token_input,
      token_output = excluded.token_output,
      token_total = excluded.token_total,
      token_estimated = excluded.token_estimated,
      similar_group_id = excluded.similar_group_id,
      is_representative = excluded.is_representative`,
  ).run(
    item.id,
    item.sourceId || createSourceId(item.sourcePath),
    item.runId || null,
    item.promptVersion || null,
    item.model || null,
    item.sourceUrl || null,
    item.renderedUrl || null,
    item.wallpaperUrl || null,
    Number(item.scores?.memory || 0),
    JSON.stringify(item.metrics || null),
    item.caption || "",
    item.sideCaption || "",
    item.reason || "",
    JSON.stringify(item.tags || []),
    item.processedAt || new Date().toISOString(),
    tokenUsage.input || 0,
    tokenUsage.output || 0,
    tokenUsage.total || 0,
    tokenUsage.estimated ? 1 : 0,
    item.similarGroupId || null,
    item.isRepresentative === false ? 0 : 1,
  );
  if (item.isCurated) {
    db.prepare("insert or ignore into curated_photos(photo_id, created_at) values (?, ?)").run(item.id, new Date().toISOString());
  }
}

function rowToGalleryItem(row) {
  const metrics = parseJson(row.metrics_json, null) || {
    width: row.width || 0,
    height: row.height || 0,
    orientation: row.orientation || "portrait",
  };
  return {
    id: row.id,
    sourceId: row.source_id,
    runId: row.run_id || "",
    promptVersion: row.prompt_version || "",
    model: row.model || "",
    fileName: row.file_name,
    fileHash: row.file_hash || "",
    perceptualHash: row.perceptual_hash || "",
    sourcePath: row.source_path,
    sourceUrl: row.source_url || "",
    renderedUrl: row.rendered_url || "",
    wallpaperUrl: row.wallpaper_url || "",
    scores: { memory: Number(row.memory_score || 0) },
    metrics,
    caption: row.caption || "",
    sideCaption: row.side_caption || "",
    reason: row.reason || "",
    tags: parseJson(row.tags_json, []),
    location: row.location || "",
    capturedAt: row.captured_at || "",
    capturedDate: row.captured_date || "",
    processedAt: row.processed_at || "",
    tokenUsage: {
      input: Number(row.token_input || 0),
      output: Number(row.token_output || 0),
      total: Number(row.token_total || 0),
      estimated: Boolean(row.token_estimated),
    },
    similarGroupId: row.similar_group_id || "",
    isRepresentative: Boolean(row.is_representative),
    isCurated: Boolean(row.curated_photo_id),
  };
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

async function clearRenderFiles(rendersDir) {
  try {
    const entries = await fs.readdir(rendersDir, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      await fs.unlink(path.join(rendersDir, entry.name));
      removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}

async function readSources(config, status) {
  const db = await getLibraryDb(config);
  const where = status === "all" ? "" : "where s.status = ?";
  const rows = db
    .prepare(
      `select s.*, p.id as processed_id, p.processed_at, p.memory_score, p.caption, p.side_caption,
              p.similar_group_id, p.is_representative, c.photo_id as curated_photo_id
         from source_photos s
         left join processed_photos p on p.source_id = s.id
         left join curated_photos c on c.photo_id = p.id
         ${where}
         order by s.last_seen_at desc, s.file_name`,
    )
    .all(...(status === "all" ? [] : [status]));
  return rows.map((row) => rowToSourceItem(row, config));
}

async function syncSourceInventory(config, files) {
  const db = await getLibraryDb(config);
  const upsert = db.prepare(
    `insert into source_photos(
      id, source_path, file_name, file_hash, perceptual_hash, captured_at, captured_date,
      location, width, height, orientation, status, skip_code, skip_reason, added_at, last_seen_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      source_path = excluded.source_path,
      file_name = excluded.file_name,
      file_hash = coalesce(source_photos.file_hash, excluded.file_hash),
      perceptual_hash = coalesce(source_photos.perceptual_hash, excluded.perceptual_hash),
      captured_at = coalesce(source_photos.captured_at, excluded.captured_at),
      captured_date = coalesce(source_photos.captured_date, excluded.captured_date),
      location = coalesce(source_photos.location, excluded.location),
      width = coalesce(source_photos.width, excluded.width),
      height = coalesce(source_photos.height, excluded.height),
      orientation = coalesce(source_photos.orientation, excluded.orientation),
      last_seen_at = excluded.last_seen_at`,
  );
  db.exec("begin immediate");
  try {
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        const fileHash = await hashFile(file);
        const profile = await buildSourceProfile(file, stat, fileHash);
        upsert.run(
          profile.id,
          file,
          path.basename(file),
          fileHash,
          profile.perceptualHash || null,
          profile.capturedAt || null,
          profile.capturedDate || null,
          profile.location || null,
          profile.metrics.width || null,
          profile.metrics.height || null,
          profile.metrics.orientation || null,
          "pending",
          null,
          null,
          new Date().toISOString(),
          new Date().toISOString(),
        );
      } catch {
        // Ignore unreadable files during source inventory; scanning should keep moving.
      }
    }
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

async function refreshSourceSkipState(config, db) {
  const processedRows = db.prepare("select source_id from processed_photos").all();
  const processedSourceIds = new Set(processedRows.map((row) => row.source_id));
  const rows = db.prepare("select * from source_photos order by captured_at, source_path").all();

  const reset = db.prepare(
    `update source_photos
        set status = 'pending', skip_code = null, skip_reason = null
      where id = ? and id not in (select source_id from processed_photos)`,
  );
  const markSkipped = db.prepare("update source_photos set status = 'skipped', skip_code = ?, skip_reason = ? where id = ?");
  const markProcessed = db.prepare("update source_photos set status = 'processed', skip_code = null, skip_reason = null where id = ?");

  db.exec("begin immediate");
  try {
    for (const row of rows) {
      if (processedSourceIds.has(row.id)) {
        markProcessed.run(row.id);
      } else if (row.status !== "processing") {
        reset.run(row.id);
      }
    }

    for (const row of rows) {
      if (processedSourceIds.has(row.id)) continue;
      if (config.excludeScreenshots && matchesScreenshotPattern(row.source_path, config)) {
        markSkipped.run("screenshot", "文件名命中截图剔除规则", row.id);
      }
    }

    markDuplicateSources(db, markSkipped);
    markBurstSources(db, markSkipped);
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

function markDuplicateSources(db, markSkipped) {
  const groups = db
    .prepare(
      `select file_hash, group_concat(id) as ids
         from source_photos
        where file_hash is not null and file_hash != '' and status != 'skipped'
        group by file_hash
       having count(*) > 1`,
    )
    .all();
  for (const group of groups) {
    const ids = String(group.ids || "").split(",").filter(Boolean);
    const keepId = chooseSourceToKeep(db, ids);
    for (const id of ids) {
      if (id !== keepId) markSkipped.run("duplicate", "与另一张图片文件内容完全相同", id);
    }
  }
}

function markBurstSources(db, markSkipped) {
  const rows = db.prepare("select * from source_photos where status != 'skipped' order by captured_at, source_path").all();
  const groups = [];
  for (const row of rows) {
    const match = groups.find((group) => group.some((candidate) => isSourceBurstSimilar(candidate, row)));
    if (match) {
      match.push(row);
    } else {
      groups.push([row]);
    }
  }

  for (const group of groups) {
    if (group.length <= 1) continue;
    const keepId = chooseSourceToKeep(db, group.map((row) => row.id));
    for (const row of group) {
      if (row.id !== keepId) markSkipped.run("burst", "识别为连拍或相似图片，优先保留同组代表", row.id);
    }
  }
}

function chooseSourceToKeep(db, ids) {
  const placeholders = ids.map(() => "?").join(",");
  const processed = db
    .prepare(`select source_id from processed_photos where source_id in (${placeholders}) order by memory_score desc, processed_at desc limit 1`)
    .get(...ids);
  if (processed?.source_id) return processed.source_id;
  const source = db.prepare(`select id from source_photos where id in (${placeholders}) order by captured_at, source_path limit 1`).get(...ids);
  return source?.id || ids[0];
}

function readProcessableSources(db, limit) {
  return db
    .prepare(
      `select * from source_photos
        where status = 'pending'
        order by captured_at, source_path
        limit ?`,
    )
    .all(limit);
}

function readSourcesByIds(db, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(`select * from source_photos where id in (${placeholders}) order by captured_at, source_path`).all(...ids);
}

function countSkippedSources(db) {
  return db.prepare("select count(*) as count from source_photos where status = 'skipped'").get().count;
}

function markSourceStatus(db, sourceId, status, skipCode, skipReason) {
  db.prepare("update source_photos set status = ?, skip_code = ?, skip_reason = ? where id = ?").run(status, skipCode || null, skipReason || null, sourceId);
}

async function rewriteProcessedGroups(config) {
  const db = await readDb(config, "all");
  await writeDb(config, { items: assignSimilarityGroups(db.items) });
}

function matchesScreenshotPattern(filePath, config) {
  const normalizedPath = filePath.toLowerCase();
  return config.excludeNamePatterns.some((pattern) => normalizedPath.includes(String(pattern).toLowerCase()));
}

function rowToSourceItem(row, config) {
  const effectiveStatus = row.processed_id ? "processed" : row.status || "pending";
  return {
    id: row.id,
    processedId: row.processed_id || "",
    fileName: row.file_name,
    sourcePath: row.source_path,
    sourceUrl: buildSourceUrl(row.source_path, config),
    status: effectiveStatus,
    skipCode: row.skip_code || "",
    skipReason: row.skip_reason || "",
    capturedAt: row.captured_at || "",
    capturedDate: row.captured_date || "",
    location: row.location || "",
    width: Number(row.width || 0),
    height: Number(row.height || 0),
    orientation: row.orientation || "",
    processedAt: row.processed_at || "",
    memoryScore: row.memory_score === null || row.memory_score === undefined ? null : Number(row.memory_score),
    caption: row.side_caption || row.caption || "",
    similarGroupId: row.similar_group_id || "",
    isRepresentative: row.is_representative === null || row.is_representative === undefined ? true : Boolean(row.is_representative),
    isCurated: Boolean(row.curated_photo_id),
  };
}

function buildSourceUrl(filePath, config) {
  const relativeSource = path.relative(config.imageDir, filePath).replaceAll(path.sep, "/");
  return `/source/${encodeURI(relativeSource)}`;
}

async function listImageFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listImageFiles(fullPath)));
    } else if (/\.(jpe?g|png|webp)$/i.test(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

async function buildSourceProfile(filePath, stat, fileHash) {
  const [photoDetails, metadata, perceptualHash] = await Promise.all([
    readPhotoDetails(filePath, stat),
    sharp(filePath).rotate().metadata(),
    computePerceptualHash(filePath),
  ]);
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  return {
    id: createSourceId(filePath),
    fileHash,
    perceptualHash,
    capturedAt: photoDetails.capturedAt,
    capturedDate: photoDetails.capturedDate,
    location: photoDetails.location,
    metrics: {
      width,
      height,
      orientation: width === height ? "square" : width > height ? "landscape" : "portrait",
    },
  };
}

async function computePerceptualHash(filePath) {
  try {
    const pixels = await sharp(filePath).rotate().resize(9, 8, { fit: "fill" }).grayscale().raw().toBuffer();
    let bits = 0n;
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        bits <<= 1n;
        if (pixels[row * 9 + col] > pixels[row * 9 + col + 1]) bits |= 1n;
      }
    }
    return bits.toString(16).padStart(16, "0");
  } catch {
    return "";
  }
}

function assignSimilarityGroups(items) {
  const sorted = [...items].sort((a, b) => String(a.capturedAt || a.processedAt || "").localeCompare(String(b.capturedAt || b.processedAt || "")));
  const groups = [];
  for (const item of sorted) {
    const match = groups.find((group) => group.some((candidate) => isBurstSimilar(candidate, item)));
    if (match) {
      match.push(item);
    } else {
      groups.push([item]);
    }
  }

  for (const group of groups) {
    const groupId = group.length > 1 ? `sim-${group[0].id}` : "";
    const representative = [...group].sort((a, b) => {
      const scoreDiff = Number(b.scores?.memory || 0) - Number(a.scores?.memory || 0);
      if (scoreDiff) return scoreDiff;
      return String(b.processedAt || "").localeCompare(String(a.processedAt || ""));
    })[0];
    for (const item of group) {
      item.similarGroupId = groupId;
      item.isRepresentative = !groupId || item.id === representative.id;
    }
  }
  return items;
}

function isBurstSimilar(a, b) {
  if (!a || !b || a.id === b.id || !a.perceptualHash || !b.perceptualHash) return false;
  const distance = hammingHex(a.perceptualHash, b.perceptualHash);
  if (distance > 10) return false;
  const aTime = Date.parse(a.capturedAt || "");
  const bTime = Date.parse(b.capturedAt || "");
  if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
    return Math.abs(aTime - bTime) <= 120000;
  }
  return a.capturedDate && a.capturedDate === b.capturedDate && distance <= 6;
}

function isSourceBurstSimilar(a, b) {
  if (!a || !b || a.id === b.id || !a.perceptual_hash || !b.perceptual_hash) return false;
  const distance = hammingHex(a.perceptual_hash, b.perceptual_hash);
  if (distance > 10) return false;
  const aTime = Date.parse(a.captured_at || "");
  const bTime = Date.parse(b.captured_at || "");
  if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
    return Math.abs(aTime - bTime) <= 120000;
  }
  return a.captured_date && a.captured_date === b.captured_date && distance <= 6;
}

function hammingHex(a, b) {
  try {
    let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let count = 0;
    while (value) {
      count += Number(value & 1n);
      value >>= 1n;
    }
    return count;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

async function processImage(filePath, config, options) {
  const id = options.existingId || crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 16);
  const fileName = path.basename(filePath);
  const stat = await fs.stat(filePath);
  const sourceProfile = await buildSourceProfile(filePath, stat, options.fileHash);
  const analysis = await analyzeWithModel(filePath, config);
  const sideCaptionResult = await generateSideCaption(filePath, config, analysis);
  const tokenUsage = addTokenUsage(analysis.tokenUsage, sideCaptionResult.tokenUsage);
  const renderName = `${id}.png`;
  const wallpaperName = `${id}.jpg`;
  const rendersDir = getRendersDir(config);
  const wallpapersDir = getWallpapersDir(config);
  await fs.mkdir(rendersDir, { recursive: true });
  await fs.mkdir(wallpapersDir, { recursive: true });
  await renderImage(
    filePath,
    { ...analysis, side_caption: sideCaptionResult.text, location: sourceProfile.location },
    path.join(rendersDir, renderName),
    config,
    sourceProfile.capturedDate,
  );
  await renderMacWallpaper(
    filePath,
    { ...analysis, side_caption: sideCaptionResult.text, location: sourceProfile.location },
    path.join(wallpapersDir, wallpaperName),
    config,
    sourceProfile.capturedDate,
  );
  const relativeSource = path.relative(config.imageDir, filePath).replaceAll(path.sep, "/");

  return {
    id,
    sourceId: sourceProfile.id,
    runId: options.runId,
    promptVersion: config.promptVersion,
    model: config.model,
    fileName,
    fileHash: options.fileHash,
    perceptualHash: sourceProfile.perceptualHash,
    sourcePath: filePath,
    sourceUrl: `/source/${encodeURI(relativeSource)}`,
    renderedUrl: `/renders/${renderName}`,
    wallpaperUrl: `/wallpapers/${wallpaperName}`,
    scores: {
      memory: analysis.memory_score,
    },
    metrics: analysis.metrics,
    caption: analysis.caption,
    sideCaption: sideCaptionResult.text,
    reason: analysis.reason,
    tags: analysis.tags,
    location: sourceProfile.location,
    capturedAt: sourceProfile.capturedAt,
    capturedDate: sourceProfile.capturedDate,
    tokenUsage,
    processedAt: new Date().toISOString(),
  };
}

async function readPhotoDetails(filePath, stat) {
  try {
    const exif = await exifr.parse(filePath, [
      "DateTimeOriginal",
      "CreateDate",
      "ModifyDate",
      "City",
      "State",
      "Country",
      "CountryCode",
      "SubLocation",
      "GPSLatitude",
      "GPSLongitude",
      "latitude",
      "longitude",
    ]);
    const candidate = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
    const capturedAt = candidate instanceof Date && !Number.isNaN(candidate.getTime()) ? candidate.toISOString() : stat.mtime.toISOString();
    return {
      capturedAt,
      capturedDate: capturedAt.slice(0, 10),
      location: await resolvePhotoLocation(exif),
    };
  } catch {
    // EXIF is optional; fall back to file timestamp.
  }
  return {
    capturedAt: stat.mtime.toISOString(),
    capturedDate: stat.mtime.toISOString().slice(0, 10),
    location: "",
  };
}

async function resolvePhotoLocation(exif) {
  const latitude = Number(exif?.latitude ?? exif?.GPSLatitude);
  const longitude = Number(exif?.longitude ?? exif?.GPSLongitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const city = await findNearestCity(latitude, longitude);
    if (city) return city;
  }

  const textParts = [exif?.Country, exif?.State, exif?.City, exif?.SubLocation]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (textParts.length) {
    return Array.from(new Set(textParts)).join(" ");
  }

  return "";
}

async function analyzeWithModel(filePath, config) {
  appendAguiEvent("read", `读取图片：${path.basename(filePath)}`);
  const imageBuffer = await fs.readFile(filePath);
  const metadata = await sharp(imageBuffer).metadata();
  const imageWidth = metadata.width || 0;
  const imageHeight = metadata.height || 0;
  const metrics = {
    width: imageWidth,
    height: imageHeight,
    orientation: imageWidth === imageHeight ? "square" : imageWidth > imageHeight ? "landscape" : "portrait",
  };

  const result = await callVisionModel(filePath, config, {
    text: `${config.scoringPrompt}\n\nJSON 格式如下：{"caption":"...","type":["..."],"memory_score":0,"reason":"..."}`,
    temperature: 0.2,
    responseFormat: "json",
  });
  const parsed = JSON.parse(extractJson(result.content));

  return {
    caption: String(parsed.caption || ""),
    tags: Array.isArray(parsed.type) ? parsed.type.map((item) => String(item)) : [],
    memory_score: clampScore(parsed.memory_score),
    reason: String(parsed.reason || ""),
    location: String(parsed.location || ""),
    metrics,
    tokenUsage: result.tokenUsage,
  };
}

async function generateSideCaption(filePath, config, analysis) {
  try {
    const result = await callVisionModel(filePath, config, {
      text: `${config.sideCaptionPrompt}\n\n参考信息：${analysis.caption}\n评分理由：${analysis.reason}`,
      temperature: 0.7,
      responseFormat: "text",
    });
    return {
      text: sanitizeOneLine(result.content, 30) || fallbackSideCaption(analysis),
      tokenUsage: result.tokenUsage,
    };
  } catch {
    return { text: fallbackSideCaption(analysis), tokenUsage: emptyTokenUsage() };
  }
}

async function callVisionModel(filePath, config, options) {
  const provider = resolveVisionProvider(config.providerBaseUrl);
  const controller = new AbortController();
  activeModelAbortControllers.add(controller);
  const timeout = setTimeout(() => {
    appendAguiEvent("warn", `模型调用超过 ${Math.round(modelCallTimeoutMs / 1000)} 秒，自动中断当前图片`);
    controller.abort();
  }, modelCallTimeoutMs);
  try {
    if (provider.kind === "ollama") {
      return await callOllamaImage(filePath, config, options, provider.endpoint, controller);
    }
    return await callDashScopeImage(filePath, config, options, provider.endpoint, controller.signal);
  } finally {
    clearTimeout(timeout);
    activeModelAbortControllers.delete(controller);
  }
}

async function callDashScopeImage(filePath, config, options, endpoint, signal) {
  const apiKey = resolveApiKey(config);
  if (!apiKey) {
    throw new Error(`未找到 API Key。请在 .env.local 中配置 ${config.apiKeyEnvName}。`);
  }

  const imageBuffer = await fs.readFile(filePath);
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      input: {
        messages: [
          {
            role: "user",
            content: [
              { image: `data:image/${imageMime(filePath)};base64,${imageBuffer.toString("base64")}` },
              { text: options.text },
            ],
          },
        ],
      },
      parameters: {
        result_format: "message",
        temperature: options.temperature,
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.message || payload?.code || "调用 DashScope 失败。");
  }

  const rawContent = payload?.output?.choices?.[0]?.message?.content;
  const content = Array.isArray(rawContent)
    ? rawContent
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part.text === "string") return part.text;
          return "";
        })
        .join("")
    : String(rawContent || "");

  if (!content) {
    throw new Error("模型没有返回可解析的内容。");
  }
  return { content, tokenUsage: normalizeTokenUsage(payload?.usage) };
}

async function callOllamaImage(filePath, config, options, endpoint, controller) {
  const imageBuffer = await prepareModelImage(filePath);
  appendAguiEvent("call", `调用模型：${config.model}，上下文 ${ollamaContextTokens}，图片 ${Math.round(imageBuffer.length / 1024)} KB`);
  const response = await fetch(endpoint, {
    method: "POST",
    signal: controller.signal,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      format: options.responseFormat === "json" ? "json" : undefined,
      messages: [
        {
          role: "user",
          content: options.text,
          images: [imageBuffer.toString("base64")],
        },
      ],
      options: {
        temperature: options.temperature,
        num_ctx: ollamaContextTokens,
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = formatModelError(payload?.error || payload?.message || "调用 Ollama 失败。");
    appendAguiEvent("error", message);
    throw new Error(message);
  }

  const { content, payload } = await readOllamaStream(response, controller);
  if (!content) {
    throw new Error("模型没有返回可解析的内容。");
  }
  return { content, tokenUsage: normalizeOllamaTokenUsage(payload) };
}

async function prepareModelImage(filePath) {
  const before = await sharp(filePath).metadata();
  const buffer = await sharp(filePath)
    .rotate()
    .resize(ollamaImageMaxEdge, ollamaImageMaxEdge, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const after = await sharp(buffer).metadata();
  appendAguiEvent(
    "compress",
    `压缩图片：${before.width || "?"}x${before.height || "?"} -> ${after.width || "?"}x${after.height || "?"}，${Math.round(buffer.length / 1024)} KB`,
  );
  return buffer;
}

async function readOllamaStream(response, controller) {
  if (!response.body) {
    const payload = await response.json();
    const content = String(payload?.message?.content || "").trim();
    const eventId = appendAguiEvent("output", content);
    updateAguiEvent(eventId, content);
    return { content, payload };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const eventId = appendAguiEvent("output", "");
  let buffer = "";
  let content = "";
  let latestPayload = null;

  while (true) {
    const { done, value } = await readStreamChunkWithIdleTimeout(reader, controller);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const payload = JSON.parse(line);
      latestPayload = payload;
      const delta = String(payload?.message?.content || "");
      if (delta) {
        content += delta;
        updateAguiEvent(eventId, content);
      }
      if (payload.done) return { content: content.trim(), payload };
    }
  }

  if (buffer.trim()) {
    const payload = JSON.parse(buffer);
    latestPayload = payload;
    content += String(payload?.message?.content || "");
    updateAguiEvent(eventId, content);
  }
  return { content: content.trim(), payload: latestPayload || {} };
}

async function readStreamChunkWithIdleTimeout(reader, controller) {
  let timeout = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          appendAguiEvent("warn", `模型 ${Math.round(modelStreamIdleTimeoutMs / 1000)} 秒没有输出，自动中断当前图片`);
          controller.abort();
          reject(new Error("模型长时间没有输出，已自动中断当前图片。"));
        }, modelStreamIdleTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function formatModelError(error) {
  const raw = typeof error === "string" ? error : JSON.stringify(error);
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.message) return parsed.message;
  } catch {
    // Some providers return plain text errors.
  }
  return raw;
}

function summarizeModelContent(content) {
  return String(content || "").replace(/\s+/g, " ").slice(0, 180);
}

async function renderImage(filePath, analysis, outputPath, config, capturedDate) {
  const metadata = await sharp(filePath).rotate().metadata();
  const sourceWidth = metadata.width || config.renderWidth;
  const sourceHeight = metadata.height || config.renderHeight;
  const isLandscape = sourceWidth >= sourceHeight;
  if (config.layoutTemplates) {
    await renderTemplatedImage(filePath, analysis, outputPath, config, capturedDate, sourceWidth, sourceHeight);
    return;
  }
  const frame = getFrameSize(config, isLandscape, sourceWidth, sourceHeight);
  const footerHeight = Math.min(Number(config.footerHeight), Math.floor(frame.height * 0.24));
  const photoAreaHeight = frame.height - footerHeight;
  const photoPadding = getPhotoPadding(frame.width, photoAreaHeight);
  const photoBackground = "#f7f2ea";
  const footer = Buffer.from(buildFooterSvg(frame.width, footerHeight, analysis, capturedDate));

  const photo = await sharp(filePath)
    .rotate()
    .resize(frame.width - photoPadding * 2, photoAreaHeight - photoPadding * 2, { fit: "contain", background: photoBackground })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: frame.width,
      height: frame.height,
      channels: 3,
      background: photoBackground,
    },
  })
    .composite([
      { input: photo, left: photoPadding, top: photoPadding },
      { input: footer, left: 0, top: photoAreaHeight },
    ])
    .png()
    .toFile(outputPath);
}

async function renderTemplatedImage(filePath, analysis, outputPath, config, capturedDate, sourceWidth, sourceHeight) {
  const baseTemplate = selectLayoutTemplate(config.layoutTemplates, sourceWidth, sourceHeight);
  const template = scaleLayoutTemplate(baseTemplate, getTemplateRenderScale(baseTemplate, config));
  const photoElement = template.elements.photo;
  const overlay = Buffer.from(buildTemplateSvg(template, analysis, capturedDate));
  const composites = [{ input: overlay, left: 0, top: 0 }];

  if (photoElement.visible !== false) {
    const radius = Number(photoElement.radius || 0);
    const photo = await sharp(filePath)
      .rotate()
      .resize(photoElement.width, photoElement.height, { fit: photoElement.fit === "contain" ? "contain" : "cover", background: template.background })
      .png()
      .toBuffer();
    const clippedPhoto = radius > 0 ? await clipRoundedImage(photo, photoElement.width, photoElement.height, radius) : photo;
    composites.unshift({ input: clippedPhoto, left: Math.round(photoElement.x), top: Math.round(photoElement.y) });
  }

  await sharp({
    create: {
      width: template.width,
      height: template.height,
      channels: 3,
      background: template.background,
    },
  })
    .composite(composites)
    .png()
    .toFile(outputPath);
}

function selectLayoutTemplate(templates, sourceWidth, sourceHeight) {
  const orientation = sourceWidth === sourceHeight ? "square" : sourceWidth > sourceHeight ? "landscape" : "portrait";
  return templates?.[orientation] || defaultLayoutTemplates[orientation];
}

function getTemplateRenderScale(template, config) {
  const configuredShort = Math.min(Number(config.renderWidth) || template.width, Number(config.renderHeight) || template.height);
  const configuredLong = Math.max(Number(config.renderWidth) || template.width, Number(config.renderHeight) || template.height);
  const templateShort = Math.min(template.width, template.height);
  const templateLong = Math.max(template.width, template.height);
  return Math.min(6, Math.max(2, configuredShort / templateShort, configuredLong / templateLong));
}

function scaleLayoutTemplate(template, scale) {
  if (scale === 1) return template;
  const scaleElement = (element) => ({
    ...element,
    x: Math.round(element.x * scale),
    y: Math.round(element.y * scale),
    width: Math.round(element.width * scale),
    height: Math.round(element.height * scale),
    radius: element.radius === undefined ? undefined : Math.round(element.radius * scale),
    fontSize: element.fontSize === undefined ? undefined : Math.round(element.fontSize * scale),
  });
  return {
    ...template,
    width: Math.round(template.width * scale),
    height: Math.round(template.height * scale),
    elements: Object.fromEntries(Object.entries(template.elements).map(([key, element]) => [key, scaleElement(element)])),
  };
}

async function clipRoundedImage(buffer, width, height, radius) {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/>
    </svg>`,
  );
  return sharp(buffer).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
}

function buildTemplateSvg(template, analysis, capturedDate) {
  const values = {
    caption: analysis.side_caption || analysis.caption || "",
    date: formatDisplayDate(capturedDate),
    place: analysis.location || "",
    score: `回忆度 ${clampScore(analysis.memory_score ?? analysis.scores?.memory ?? 0).toFixed(1)}`,
  };
  const parts = ["caption", "date", "place", "score"]
    .map((key) => buildTemplateTextElement(template.elements[key], values[key], key))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${template.width}" height="${template.height}" viewBox="0 0 ${template.width} ${template.height}">
    ${parts}
  </svg>`;
}

function buildTemplateTextElement(element, text, key) {
  if (!element || element.visible === false || !text) return "";
  const anchor = element.align === "center" ? "middle" : element.align === "right" ? "end" : "start";
  const x = element.align === "center" ? element.x + element.width / 2 : element.align === "right" ? element.x + element.width : element.x;
  const layout = fitTemplateText(text, element);
  const textNodes = layout.lines
    .map((line, index) => {
      const y = element.y + layout.fontSize + index * layout.lineHeight;
      return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${escapeXml(element.fontFamily)}" font-size="${layout.fontSize}" fill="${escapeXml(element.color)}">${escapeXml(line)}</text>`;
    })
    .join("");
  const clipId = `text-clip-${escapeXml(key)}`;
  return `<clipPath id="${clipId}"><rect x="${element.x}" y="${element.y}" width="${element.width}" height="${element.height}"/></clipPath><g clip-path="url(#${clipId})">${textNodes}</g>`;
}

async function renderMacWallpaper(filePath, analysis, outputPath, config, capturedDate) {
  const width = Number(config.wallpaperWidth);
  const height = Number(config.wallpaperHeight);
  const footerHeight = Math.min(320, Math.max(220, Math.round(height * 0.15)));
  const photoAreaHeight = height - footerHeight;
  const background = await sharp(filePath)
    .rotate()
    .resize(width, height, { fit: "cover" })
    .blur(36)
    .modulate({ brightness: 0.58, saturation: 0.74 })
    .png()
    .toBuffer();
  const foreground = await sharp(filePath)
    .rotate()
    .resize(Math.round(width * 0.92), photoAreaHeight, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  const footer = Buffer.from(buildWallpaperFooterSvg(width, footerHeight, analysis, capturedDate));
  const metadata = await sharp(foreground).metadata();
  const left = Math.max(0, Math.round((width - (metadata.width || width)) / 2));
  const top = Math.max(0, Math.round(photoAreaHeight - (metadata.height || photoAreaHeight)));

  await sharp(background)
    .composite([
      { input: foreground, left, top },
      { input: footer, left: 0, top: height - footerHeight },
    ])
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(outputPath);
}

function createProcessProgress(mode) {
  return {
    id: "",
    mode,
    status: "idle",
    message: "",
    currentFile: "",
    total: 0,
    done: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    skippedDuplicates: 0,
    tokenTotal: 0,
    aguiEvents: [],
    updatedAt: new Date().toISOString(),
  };
}

function startProcessProgress(mode, message) {
  processProgress = {
    ...createProcessProgress(mode),
    id: createRunId(),
    status: "running",
    message,
    updatedAt: new Date().toISOString(),
  };
}

function updateProcessProgress(patch) {
  processProgress = {
    ...processProgress,
    ...patch,
    aguiEvents: patch.aguiEvents || processProgress.aguiEvents || [],
    updatedAt: new Date().toISOString(),
  };
}

function appendAguiEvent(kind, text) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const nextEvents = [
    ...(processProgress.aguiEvents || []),
    {
      id,
      kind,
      text: String(text || ""),
      at: new Date().toISOString(),
    },
  ].slice(-80);
  updateProcessProgress({ aguiEvents: nextEvents });
  return id;
}

function updateAguiEvent(id, text) {
  const nextEvents = (processProgress.aguiEvents || []).map((event) => (event.id === id ? { ...event, text: String(text || ""), at: new Date().toISOString() } : event));
  updateProcessProgress({ aguiEvents: nextEvents });
}

function incrementProcessProgress({ succeeded = 0, failed = 0, tokenUsage = emptyTokenUsage() }) {
  updateProcessProgress({
    done: processProgress.done + succeeded + failed,
    succeeded: processProgress.succeeded + succeeded,
    failed: processProgress.failed + failed,
    tokenTotal: processProgress.tokenTotal + Number(tokenUsage?.total || 0),
  });
}

function finishProcessProgress(patch) {
  updateProcessProgress({
    ...patch,
    status: "done",
    currentFile: "",
  });
}

function failProcessProgress(message) {
  if (processProgress.status !== "running") return;
  appendAguiEvent("error", message);
  updateProcessProgress({
    status: "error",
    message,
    currentFile: "",
  });
}

function getFrameSize(config, isLandscape, sourceWidth, sourceHeight) {
  if (config.renderFrameMode === "adaptive") {
    return getAdaptiveFrameSize(config, sourceWidth, sourceHeight);
  }

  const shortSide = Number(config.renderWidth);
  const longSide = Number(config.renderHeight);
  if (isLandscape) {
    return { width: Math.max(shortSide, longSide), height: Math.min(shortSide, longSide) };
  }
  return { width: Math.min(shortSide, longSide), height: Math.max(shortSide, longSide) };
}

function getAdaptiveFrameSize(config, sourceWidth, sourceHeight) {
  const ratio = Math.max(0.05, sourceWidth / sourceHeight);
  const longSide = Math.max(Number(config.renderWidth), Number(config.renderHeight));
  const footerHeight = Math.min(Number(config.footerHeight), Math.floor(longSide * 0.24));

  if (ratio >= 1) {
    const photoWidth = longSide;
    const photoHeight = Math.max(160, Math.round(photoWidth / ratio));
    return {
      width: photoWidth,
      height: photoHeight + footerHeight,
    };
  }

  const photoHeight = Math.max(160, longSide - footerHeight);
  const photoWidth = Math.max(180, Math.round(photoHeight * ratio));
  return {
    width: photoWidth,
    height: photoHeight + footerHeight,
  };
}

function normalizeRenderFrameMode(value) {
  return value === "adaptive" ? "adaptive" : "fixed";
}

function normalizeWallpaperCollection(value) {
  return ["curated", "representative", "all"].includes(value) ? value : defaultConfig.wallpaperCollection;
}

function normalizeLayoutTemplates(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    portrait: normalizeLayoutTemplate(source.portrait, defaultLayoutTemplates.portrait),
    landscape: normalizeLayoutTemplate(source.landscape, defaultLayoutTemplates.landscape),
    square: normalizeLayoutTemplate(source.square, defaultLayoutTemplates.square),
  };
}

function normalizeLayoutTemplate(value, fallback) {
  const source = value && typeof value === "object" ? value : {};
  const elements = source.elements && typeof source.elements === "object" ? source.elements : {};
  const width = sanitizePositiveInt(source.width, fallback.width);
  const height = sanitizePositiveInt(source.height, fallback.height);
  const bounds = { width, height };
  return {
    width,
    height,
    background: normalizeColor(source.background, fallback.background),
    elements: {
      photo: normalizeLayoutElement(elements.photo, fallback.elements.photo, bounds, true),
      caption: normalizeLayoutElement(elements.caption, fallback.elements.caption, bounds),
      date: normalizeLayoutElement(elements.date, fallback.elements.date, bounds),
      place: normalizeLayoutElement(elements.place, fallback.elements.place, bounds),
      score: normalizeLayoutElement(elements.score, fallback.elements.score, bounds),
    },
  };
}

function normalizeLayoutElement(value, fallback, bounds, isPhoto = false) {
  const source = value && typeof value === "object" ? value : {};
  const x = Math.min(Math.max(0, bounds.width - 1), sanitizeNonNegativeNumber(source.x, fallback.x));
  const y = Math.min(Math.max(0, bounds.height - 1), sanitizeNonNegativeNumber(source.y, fallback.y));
  const normalized = {
    x,
    y,
    width: Math.min(Math.max(1, bounds.width - x), sanitizePositiveInt(source.width, fallback.width)),
    height: Math.min(Math.max(1, bounds.height - y), sanitizePositiveInt(source.height, fallback.height)),
    visible: source.visible !== false,
  };
  if (isPhoto) {
    return {
      ...normalized,
      fit: source.fit === "contain" ? "contain" : "cover",
      radius: sanitizeNonNegativeNumber(source.radius, fallback.radius || 0),
    };
  }
  return {
    ...normalized,
    fontSize: sanitizePositiveInt(source.fontSize, fallback.fontSize),
    fontFamily: String(source.fontFamily || fallback.fontFamily).trim() || fallback.fontFamily,
    color: normalizeColor(source.color, fallback.color),
    align: ["left", "center", "right"].includes(source.align) ? source.align : fallback.align,
  };
}

function normalizeColor(value, fallback) {
  const text = String(value || "").trim();
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text) || /^rgba?\(/i.test(text) ? text : fallback;
}

function getPhotoPadding(width, height) {
  return Math.max(12, Math.round(Math.min(width, height) * 0.025));
}

function buildFooterSvg(width, footerHeight, analysis, capturedDate) {
  const sideCaption = wrapByChars(analysis.side_caption || analysis.caption, 16, 2)
    .map(escapeXml)
    .map((line, index) => `<text x="24" y="${34 + index * 24}" class="caption">${line}</text>`)
    .join("");
  const location = escapeXml(analysis.location || "");
  const date = escapeXml(formatDisplayDate(capturedDate));
  const locationText = location ? `<text x="${width - 24}" y="${footerHeight - 20}" class="meta" text-anchor="end">${location}</text>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${footerHeight}" viewBox="0 0 ${width} ${footerHeight}">
  <style>
    .caption { font: 22px "SimSun", "Songti SC", "Noto Serif CJK SC", serif; fill: #16130f; }
    .meta { font: 15px "SimSun", "Songti SC", "Noto Serif CJK SC", serif; fill: #4c453b; }
  </style>
  <rect width="100%" height="100%" fill="#fbf7ef"/>
  ${sideCaption}
  <text x="24" y="${footerHeight - 20}" class="meta">${date}</text>
  ${locationText}
</svg>`;
}

function buildWallpaperFooterSvg(width, footerHeight, analysis, capturedDate) {
  const sideCaption = wrapByChars(analysis.side_caption || analysis.caption, 24, 2)
    .map(escapeXml)
    .map((line, index) => `<text x="96" y="${92 + index * 54}" class="caption">${line}</text>`)
    .join("");
  const location = escapeXml(analysis.location || "");
  const date = escapeXml(formatDisplayDate(capturedDate));
  const locationText = location ? `<text x="${width - 96}" y="${footerHeight - 70}" class="meta" text-anchor="end">${location}</text>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${footerHeight}" viewBox="0 0 ${width} ${footerHeight}">
  <style>
    .caption { font: 44px "Songti SC", "Noto Serif CJK SC", "STSong", serif; fill: #f8f3e8; }
    .meta { font: 24px "Songti SC", "Noto Serif CJK SC", "STSong", serif; fill: rgba(248, 243, 232, 0.72); }
  </style>
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0c1115" stop-opacity="0"/>
      <stop offset="0.28" stop-color="#0c1115" stop-opacity="0.68"/>
      <stop offset="1" stop-color="#0c1115" stop-opacity="0.9"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#fade)"/>
  ${sideCaption}
  <text x="96" y="${footerHeight - 70}" class="meta">${date}</text>
  ${locationText}
</svg>`;
}

async function loadWorldCities() {
  if (cachedCities && cachedCityGrid) {
    return { cities: cachedCities, grid: cachedCityGrid };
  }

  const raw = await fs.readFile(worldCitiesPath, "utf8");
  const rows = parseCsv(raw);
  const cities = [];
  const grid = new Map();

  for (const row of rows) {
    const latitude = Number((row.lat || "").trim());
    const longitude = Number((row.lon || "").trim());
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const name = String(row.name_zh || row.name_en || "").trim();
    if (!name) continue;
    const index = cities.length;
    cities.push({ latitude, longitude, name });
    const key = gridKey(latitude, longitude);
    const bucket = grid.get(key) || [];
    bucket.push(index);
    grid.set(key, bucket);
  }

  cachedCities = cities;
  cachedCityGrid = grid;
  return { cities, grid };
}

async function findNearestCity(latitude, longitude) {
  try {
    const { cities, grid } = await loadWorldCities();
    const [gx, gy] = gridKey(latitude, longitude).split(":").map(Number);
    let candidates = collectCityCandidates(grid, gx, gy, 1);
    if (!candidates.length) candidates = collectCityCandidates(grid, gx, gy, 2);
    if (!candidates.length) return "";

    let bestName = "";
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const index of candidates) {
      const city = cities[index];
      const distance = haversineKm(latitude, longitude, city.latitude, city.longitude);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestName = city.name;
      }
    }

    return bestDistance <= cityMaxDistanceKm ? bestName : "";
  } catch {
    return "";
  }
}

function collectCityCandidates(grid, gx, gy, radius) {
  const candidates = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const bucket = grid.get(`${gx + dx}:${gy + dy}`);
      if (bucket) candidates.push(...bucket);
    }
  }
  return candidates;
}

function gridKey(latitude, longitude) {
  return `${Math.floor(latitude / cityGridDeg)}:${Math.floor(longitude / cityGridDeg)}`;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function parseCsv(raw) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    return record;
  });
}

function formatDisplayDate(value) {
  return String(value || "").replaceAll("-", ".");
}

function wrapByChars(text, maxChars, maxLines) {
  const chars = Array.from(text || "");
  const lines = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += maxChars) {
    lines.push(chars.slice(i, i + maxChars).join(""));
  }
  return lines.length ? lines : [""];
}

function wrapByCharsWithEllipsis(text, maxChars, maxLines) {
  const chars = Array.from(text || "");
  const lines = [];
  for (let i = 0; i < chars.length && lines.length < maxLines; i += maxChars) {
    lines.push(chars.slice(i, i + maxChars).join(""));
  }
  if (lines.length && chars.length > maxChars * maxLines) {
    const last = Array.from(lines[lines.length - 1]);
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).join("")}…`;
  }
  return lines.length ? lines : [""];
}

function fitTemplateText(text, element) {
  const startFontSize = Math.max(1, Number(element.fontSize || 16));
  const minFontSize = Math.max(10, Math.floor(startFontSize * 0.68));
  const safeWidth = Math.max(1, Number(element.width || 1) * 0.94);
  const height = Math.max(1, Number(element.height || 1));
  for (let fontSize = startFontSize; fontSize >= minFontSize; fontSize -= 1) {
    const lineHeight = Math.max(1, fontSize * 1.22);
    const maxLines = Math.max(1, Math.floor(height / lineHeight));
    const lines = wrapByVisualWidth(text, safeWidth, fontSize);
    if (lines.length <= maxLines) {
      return { fontSize, lineHeight, lines };
    }
  }
  const lineHeight = Math.max(1, minFontSize * 1.22);
  const maxLines = Math.max(1, Math.floor(height / lineHeight));
  return {
    fontSize: minFontSize,
    lineHeight,
    lines: ellipsizeVisualLines(wrapByVisualWidth(text, safeWidth, minFontSize), safeWidth, minFontSize, maxLines),
  };
}

function wrapByVisualWidth(text, maxWidth, fontSize) {
  const chars = Array.from(text || "");
  const lines = [];
  let line = "";
  let lineWidth = 0;
  for (const char of chars) {
    const charWidth = estimateGlyphWidth(char, fontSize);
    if (line && lineWidth + charWidth > maxWidth) {
      lines.push(line);
      line = char;
      lineWidth = charWidth;
    } else {
      line += char;
      lineWidth += charWidth;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function ellipsizeVisualLines(lines, maxWidth, fontSize, maxLines) {
  const visible = lines.slice(0, maxLines);
  if (lines.length <= maxLines || !visible.length) return visible.length ? visible : [""];
  let last = visible[visible.length - 1];
  while (last && estimateTextWidth(`${last}…`, fontSize) > maxWidth) {
    last = Array.from(last).slice(0, -1).join("");
  }
  visible[visible.length - 1] = `${last}…`;
  return visible;
}

function estimateTextWidth(text, fontSize) {
  return Array.from(text || "").reduce((total, char) => total + estimateGlyphWidth(char, fontSize), 0);
}

function estimateGlyphWidth(char, fontSize) {
  if (/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uff00-\uffef]/u.test(char)) return fontSize;
  if (/[A-Z0-9]/.test(char)) return fontSize * 0.66;
  if (/[a-z]/.test(char)) return fontSize * 0.55;
  if (/\s/.test(char)) return fontSize * 0.33;
  return fontSize * 0.72;
}

function sanitizeOneLine(value, maxChars) {
  const text = String(value || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^["“”「」『』]+|["“”「」『』]+$/g, "")
    .replace(/\s+/g, "")
    .trim();
  return Array.from(text).slice(0, maxChars).join("");
}

function fallbackSideCaption(analysis) {
  return sanitizeOneLine(analysis.reason || analysis.caption, 24);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function imageMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "png";
  if (ext === ".webp") return "webp";
  return "jpeg";
}

function stripUrlQuery(value) {
  return String(value || "").split("?")[0];
}

function clampScore(value) {
  return roundOne(Math.max(0, Math.min(100, Number(value) || 0)));
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return emptyTokenUsage();
  const input = readTokenNumber(usage.input_tokens, usage.prompt_tokens, usage.inputTokens, usage.promptTokens);
  const output = readTokenNumber(usage.output_tokens, usage.completion_tokens, usage.outputTokens, usage.completionTokens);
  const explicitTotal = readTokenNumber(usage.total_tokens, usage.totalTokens);
  const tokenLikeTotal = Object.entries(usage).reduce((sum, [key, value]) => {
    return /token/i.test(key) && Number.isFinite(Number(value)) ? sum + Number(value) : sum;
  }, 0);
  const total = explicitTotal || input + output || tokenLikeTotal;
  return {
    input,
    output,
    total,
    estimated: false,
  };
}

function normalizeOllamaTokenUsage(payload) {
  const input = readTokenNumber(payload?.prompt_eval_count, payload?.promptEvalCount);
  const output = readTokenNumber(payload?.eval_count, payload?.evalCount);
  return {
    input,
    output,
    total: input + output,
    estimated: false,
  };
}

function readTokenNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
  }
  return 0;
}

function addTokenUsage(...usages) {
  return usages.reduce(
    (sum, usage) => ({
      input: sum.input + Number(usage?.input || 0),
      output: sum.output + Number(usage?.output || 0),
      total: sum.total + Number(usage?.total || 0),
      estimated: Boolean(sum.estimated || usage?.estimated),
    }),
    emptyTokenUsage(),
  );
}

function emptyTokenUsage() {
  return { input: 0, output: 0, total: 0, estimated: true };
}

async function hashFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

function createSourceId(filePath) {
  return crypto.createHash("sha1").update(filePath).digest("hex").slice(0, 16);
}

function createRunId() {
  return `${new Date().toISOString().replaceAll(/[-:TZ.]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
}

function normalizeCollection(value) {
  if (value === "all" || value === "curated") return value;
  return "representative";
}

function normalizeSourceStatus(value) {
  if (value === "pending" || value === "processed" || value === "skipped" || value === "failed" || value === "processing") return value;
  return "all";
}

function escapeAppleScriptString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function applyDesktopWallpaper(wallpaperPath) {
  const escaped = escapeAppleScriptString(wallpaperPath);
  await execFileAsync(
    "osascript",
    ["-e", `tell application "System Events"\nrepeat with desktopItem in desktops\nset picture of desktopItem to POSIX file "${escaped}"\nend repeat\nend tell`],
    { timeout: 8000 },
  );
  await execFileAsync("killall", ["Dock"]).catch(() => {});
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const appliedPath = await readDesktopWallpaperPath();
    if (desktopWallpaperMatches(appliedPath, wallpaperPath)) return appliedPath;
    await wait(500);
  }
  const appliedPath = await readDesktopWallpaperPath();
  throw new Error(`macOS 未确认壁纸已切换。目标：${wallpaperPath}；当前：${appliedPath || "未知"}`);
}

async function readDesktopWallpaperPath() {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", 'tell application "System Events" to get picture of every desktop'], { timeout: 8000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

function desktopWallpaperMatches(appliedPath, wallpaperPath) {
  const expected = path.resolve(wallpaperPath);
  return String(appliedPath || "")
    .split(/\s*,\s*|\n/)
    .map((value) => value.trim())
    .some((value) => value && path.resolve(value) === expected);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveApiKey(config) {
  const preferred = String(config.apiKeyEnvName || "").trim();
  if (preferred && process.env[preferred]) {
    return process.env[preferred];
  }
  return process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || "";
}

function resolveVisionProvider(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return {
      kind: "dashscope",
      endpoint: resolveDashScopeEndpoint(""),
    };
  }

  try {
    const url = new URL(normalized);
    const isLocalOllamaHost =
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      (url.port === "11434" || (!url.port && url.protocol === "http:"));
    if (isLocalOllamaHost) {
      return {
        kind: "ollama",
        endpoint: resolveOllamaEndpoint(normalized),
      };
    }
  } catch {
    // Fall through to DashScope-compatible handling for non-URL values.
  }

  return {
    kind: "dashscope",
    endpoint: resolveDashScopeEndpoint(normalized),
  };
}

function resolveDashScopeEndpoint(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
  }
  if (normalized.endsWith("/services/aigc/multimodal-generation/generation")) {
    return normalized;
  }
  if (normalized.endsWith("/compatible-mode/v1")) {
    return `${normalized.slice(0, -"/compatible-mode/v1".length)}/api/v1/services/aigc/multimodal-generation/generation`;
  }
  if (normalized.endsWith("/api/v1")) {
    return `${normalized}/services/aigc/multimodal-generation/generation`;
  }
  return `${normalized}/services/aigc/multimodal-generation/generation`;
}

function resolveOllamaEndpoint(baseUrl) {
  const normalized = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return "http://127.0.0.1:11434/api/chat";
  }
  if (normalized.endsWith("/api/chat")) {
    return normalized;
  }
  if (normalized.endsWith("/api")) {
    return `${normalized}/chat`;
  }
  return `${normalized}/api/chat`;
}

function extractJson(value) {
  const text = String(value).trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1);
  }
  return text;
}

function isAbortError(error) {
  return error instanceof Error && (error.name === "AbortError" || /abort/i.test(error.message));
}

function loadLocalEnv(filePath) {
  return fs
    .readFile(filePath, "utf8")
    .then((raw) => {
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const splitIndex = trimmed.indexOf("=");
        if (splitIndex <= 0) continue;
        const key = trimmed.slice(0, splitIndex).trim();
        const value = trimmed.slice(splitIndex + 1).trim().replace(/^['"]|['"]$/g, "");
        if (key) {
          process.env[key] = value;
        }
      }
    })
    .catch(() => {});
}

await fs.mkdir(getRendersDir(initialConfig), { recursive: true });
