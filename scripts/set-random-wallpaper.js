import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
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

  const row = selectWallpaperRow(db, config);
  if (!row) {
    log("No wallpaper candidates found.");
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
    log(JSON.stringify({ status: "ok", photoId: row.id, fileName: row.file_name, wallpaperPath, appliedPath }));
  }
} catch (error) {
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
    parsed[key.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = values[index + 1] || "";
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

function selectWallpaperRow(database, config) {
  const latest = database.prepare("select photo_id from wallpaper_history order by set_at desc limit 1").get();
  const source = normalizeWallpaperCollection(config.wallpaperCollection);
  const joinCurated = source === "curated" ? "join curated_photos c on c.photo_id = p.id" : "";
  const sourceWhere = source === "representative" ? "and p.is_representative = 1" : "";
  const query = `select p.id, p.wallpaper_url, s.file_name
       from processed_photos p
       join source_photos s on s.id = p.source_id
       ${joinCurated}
      where p.wallpaper_url is not null and p.wallpaper_url != '' ${sourceWhere}`;
  const row = database
    .prepare(
      `${query}
        and (? is null or p.id != ?)
      order by random()
      limit 1`,
    )
    .get(latest?.photo_id || null, latest?.photo_id || null);
  if (row || !latest?.photo_id) return row;
  return database
    .prepare(
      `${query}
      order by random()
      limit 1`,
    )
    .get();
}

function stripUrlQuery(value) {
  return String(value || "").split("?")[0];
}

function createRunId() {
  return `${new Date().toISOString().replaceAll(/[-:TZ.]/g, "").slice(0, 14)}-${Math.random().toString(16).slice(2, 8)}`;
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
  throw new Error(`macOS did not confirm wallpaper change. target=${wallpaperPath} current=${appliedPath || "unknown"}`);
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

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  if (logFile && !process.env.XPC_SERVICE_NAME) fs.appendFileSync(logFile, `${line}\n`, "utf8");
}

function logError(error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error);
  log(`ERROR ${message}`);
}
