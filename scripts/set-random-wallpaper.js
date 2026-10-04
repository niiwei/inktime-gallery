import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { latestScheduledBoundary, selectWallpaperRow } from "../server/platform/wallpaper-selection.js";
import { applyDesktopWallpaper } from "../server/platform/desktop-wallpaper.js";
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const configDir = path.resolve(args.configDir || process.env.INKTIME_CONFIG_DIR || path.join(rootDir, "config"));
const dataRoot = args.dataRoot ? path.resolve(args.dataRoot) : process.env.INKTIME_DATA_ROOT ? path.resolve(process.env.INKTIME_DATA_ROOT) : "";
const logFile = args.logFile ? path.resolve(args.logFile) : "";
const configPath = path.join(configDir, "gallery.config.json");

let db = null;

try {
  const config = normalizeConfig(loadConfig());
  const dbPath = path.join(getDataDir(config), config.databaseFile);
  const wallpapersDir = path.join(getDataDir(config), "wallpapers");
  db = new DatabaseSync(dbPath);

  const boundary = latestScheduledBoundary(config.wallpaperAutoIntervalHours);
  let alreadyApplied = false;
  if (process.env.INKTIME_SCHEDULED_WALLPAPER === "1") {
    const last = db.prepare("select set_at from wallpaper_history order by set_at desc limit 1").get();
    alreadyApplied = !boundary || (last && Date.parse(last.set_at) >= boundary.getTime());
  }
  const row = alreadyApplied ? null : selectWallpaperRow(db, config);
  if (!row) {
    log(alreadyApplied ? "Scheduled boundary already applied or disabled." : "No wallpaper candidates found.");
    if (!alreadyApplied) writeStatus({ status: "empty", lastError: "还没有可用的壁纸图片。" });
    process.exitCode = 0;
  } else {
    const wallpaperPath = path.join(wallpapersDir, path.basename(stripUrlQuery(row.wallpaper_url)));
    if (!fs.existsSync(wallpaperPath)) throw new Error(`Wallpaper file does not exist: ${wallpaperPath}`);
    const appliedPath = await applyDesktopWallpaper(wallpaperPath);
    db.prepare("insert into wallpaper_history(id, photo_id, wallpaper_path, set_at) values (?, ?, ?, ?)").run(
      createRunId(),
      row.id,
      wallpaperPath,
      new Date().toISOString(),
    );
    writeStatus({ status: "ok", lastError:"", photoId: row.id, fileName: row.file_name, wallpaperPath, appliedPath });
    log(JSON.stringify({ status: "ok", photoId: row.id, fileName: row.file_name, wallpaperPath, appliedPath }));
  }
} catch (error) {
  writeStatus({ status: "error", lastError: error instanceof Error ? error.message : String(error) });
  logError(error);
  process.exitCode = 1;
} finally {
  if (db) db.close();
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[name] = true;
      continue;
    }
    parsed[name] = next;
    index += 1;
  }
  return parsed;
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return {};
  }
}

function normalizeConfig(config) {
  return {
    dataDir: String(config.dataDir || "data"),
    databaseFile: normalizeDatabaseFile(config.databaseFile || "gallery.sqlite"),
    wallpaperCollection: normalizeWallpaperCollection(config.wallpaperCollection),
    wallpaperAutoIntervalHours: Number(config.wallpaperAutoIntervalHours || 0),
  };
}

function normalizeDatabaseFile(value) {
  const normalized = String(value || "gallery.sqlite").replaceAll("\\", "/").split("/").filter(Boolean).join("/") || "gallery.sqlite";
  return normalized.endsWith(".json") ? normalized.replace(/\.json$/i, ".sqlite") : normalized;
}

function normalizeWallpaperCollection(value) {
  return ["curated", "representative", "all"].includes(value) ? value : "representative";
}

function getDataDir(config) {
  return dataRoot || path.resolve(rootDir, config.dataDir);
}

function stripUrlQuery(value) {
  return String(value || "").split("?")[0];
}

function createRunId() {
  return `${new Date().toISOString().replaceAll(/[-:TZ.]/g, "").slice(0, 14)}-${Math.random().toString(16).slice(2, 8)}`;
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  if (logFile && !process.env.XPC_SERVICE_NAME) fs.appendFileSync(logFile, `${line}\n`, "utf8");
}

function logError(error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error);
  log(`ERROR ${message}`);
}

function writeStatus(status) {
  try {
    const target = path.join(getDataDir(normalizeConfig(loadConfig())), "wallpaper-status.json");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ ...status, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  } catch (error) {
    log(`ERROR writing wallpaper status: ${error instanceof Error ? error.message : String(error)}`);
  }
}
