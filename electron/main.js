import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } from "electron";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const serverPort = Number(process.env.INKTIME_PORT || 5187);
const appUrl = `http://127.0.0.1:${serverPort}`;
const userDataDir = app.getPath("userData");
const logsDir = app.getPath("logs");
const logPath = path.join(logsDir, "main.log");
const launchAgentLogPath = path.join(logsDir, "wallpaper-agent.log");
const runtimeConfigDir = app.isPackaged ? path.join(userDataDir, "config") : path.join(appRoot, "config");
const runtimeDataDir = app.isPackaged ? path.join(userDataDir, "data") : path.join(appRoot, "data");
const iconPath = path.join(appRoot, "assets", "app-icon.png");
const trayIconPath = path.join(appRoot, "assets", "tray-template.svg");
const launchAgentLabel = "com.inktime.gallery.wallpaper";
const launchAgentsDir = path.join(app.getPath("home"), "Library", "LaunchAgents");
const launchAgentPath = path.join(launchAgentsDir, `${launchAgentLabel}.plist`);

let mainWindow = null;
let tray = null;
let isQuitting = false;
let wallpaperAgentConfigTimer = null;
let wallpaperAgentSignature = "";

logMessage(`boot packaged=${app.isPackaged} appRoot=${appRoot}`);
process.on("uncaughtException", (error) => logError("uncaughtException", error));
process.on("unhandledRejection", (error) => logError("unhandledRejection", error));

const hasSingleInstanceLock = app.requestSingleInstanceLock();

process.env.PORT = String(serverPort);
process.env.INKTIME_STATIC = "1";
process.env.INKTIME_CONFIG_DIR = runtimeConfigDir;
process.env.INKTIME_DATA_ROOT = runtimeDataDir;
process.env.INKTIME_ENV_DIR = app.isPackaged ? userDataDir : appRoot;

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.whenReady().then(bootstrap).catch((error) => {
    logError("bootstrap", error);
    dialog.showErrorBox("InkTime Gallery 启动失败", error instanceof Error ? error.message : String(error));
  });
}

app.on("activate", async () => {
  if (!mainWindow) {
    mainWindow = await createMainWindow();
  } else {
    showMainWindow();
  }
});

app.on("second-instance", showMainWindow);

app.on("before-quit", () => {
  isQuitting = true;
  clearWallpaperAgentManager();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

async function bootstrap() {
  logMessage("electron ready");
  await prepareRuntimeFiles();
  logMessage(`runtime config=${runtimeConfigDir} data=${runtimeDataDir}`);
  await import("../server/index.js");
  logMessage(`server imported url=${appUrl}`);
  createMenu();
  createTray();
  startWallpaperAgentManager();
  mainWindow = await createMainWindow();
  logMessage("main window created");
}

async function createMainWindow() {
  await waitForServer();
  const window = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 980,
    minHeight: 680,
    title: "InkTime Gallery",
    backgroundColor: "#121412",
    icon: iconPath,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    logMessage(`window load failed code=${errorCode} description=${errorDescription} url=${validatedUrl}`);
  });
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });
  await window.loadURL(appUrl);
  return window;
}

function createMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "InkTime Gallery",
        submenu: [
          { label: "显示 InkTime Gallery", accelerator: "CommandOrControl+0", click: showMainWindow },
          { label: "随机设置壁纸", accelerator: "CommandOrControl+R", click: setRandomWallpaper },
          { type: "separator" },
          { label: "打开配置目录", click: () => shell.openPath(userDataDir) },
          { label: "打开数据目录", click: () => shell.openPath(runtimeDataDir) },
          { label: "打开图片目录", click: openImageDirectory },
          { type: "separator" },
          { role: "quit", label: "退出 InkTime Gallery" },
        ],
      },
      {
        label: "编辑",
        submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }],
      },
      {
        label: "窗口",
        submenu: [{ role: "minimize" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "front" }],
      },
    ]),
  );
}

function createTray() {
  tray = new Tray(createTrayIcon());
  tray.setToolTip("InkTime Gallery");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示 InkTime Gallery", click: showMainWindow },
      { label: "随机设置壁纸", click: setRandomWallpaper },
      { type: "separator" },
      { label: "打开配置目录", click: () => shell.openPath(userDataDir) },
      { label: "打开数据目录", click: () => shell.openPath(runtimeDataDir) },
      { label: "退出 InkTime Gallery", click: () => app.quit() },
    ]),
  );
  tray.on("click", showMainWindow);
}

function createTrayIcon() {
  const svg = fs.readFileSync(trayIconPath, "utf8");
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
  icon.setTemplateImage(true);
  return icon;
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function setRandomWallpaper(options = {}) {
  const reason = options.reason || "manual";
  try {
    logMessage(`wallpaper update start reason=${reason}`);
    const data = await fetchJson(`${appUrl}/api/wallpaper/random`, { method: "POST" });
    logMessage(`wallpaper update success reason=${reason} file=${data.fileName || ""} photo=${data.photoId || ""} applied=${data.appliedPath || ""}`);
    if (!options.silent) showNotification("壁纸已更新", data.fileName || "InkTime Gallery");
  } catch (error) {
    logError(`wallpaper update failed reason=${reason}`, error);
    if (!options.silent) dialog.showErrorBox("壁纸设置失败", error instanceof Error ? error.message : String(error));
  }
}

function startWallpaperAgentManager() {
  void refreshWallpaperLaunchAgent();
  wallpaperAgentConfigTimer = setInterval(() => void refreshWallpaperLaunchAgent(), 60 * 1000);
}

function clearWallpaperAgentManager() {
  if (wallpaperAgentConfigTimer) {
    clearInterval(wallpaperAgentConfigTimer);
    wallpaperAgentConfigTimer = null;
  }
}

async function refreshWallpaperLaunchAgent() {
  try {
    const config = await fetchJson(`${appUrl}/api/config`);
    const nextInterval = normalizeWallpaperInterval(config.wallpaperAutoIntervalHours);
    const signature = nextInterval > 0 ? `${nextInterval}:${resolveWallpaperAgentScriptPath()}:${runtimeConfigDir}:${runtimeDataDir}:${findNodeExecutable()}` : "disabled";
    if (signature === wallpaperAgentSignature) return;
    if (nextInterval > 0) {
      await installWallpaperLaunchAgent(nextInterval);
      wallpaperAgentSignature = signature;
    } else {
      await uninstallWallpaperLaunchAgent();
      wallpaperAgentSignature = signature;
      logMessage("wallpaper launch agent disabled");
    }
  } catch (error) {
    logError("wallpaper launch agent refresh", error);
  }
}

function normalizeWallpaperInterval(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(1, Math.round(parsed));
}

async function installWallpaperLaunchAgent(intervalHours) {
  const nodePath = findNodeExecutable();
  if (!nodePath) throw new Error("找不到 Node.js，可通过 INKTIME_NODE_PATH 指定 launchd 使用的 node。");
  const scriptPath = resolveWallpaperAgentScriptPath();
  if (!fs.existsSync(scriptPath)) throw new Error(`壁纸脚本不存在：${scriptPath}`);
  const plist = buildWallpaperLaunchAgentPlist({
    intervalHours,
    nodePath,
    scriptPath,
    configDir: runtimeConfigDir,
    dataRoot: runtimeDataDir,
    logFile: launchAgentLogPath,
  });
  fs.mkdirSync(launchAgentsDir, { recursive: true });
  const existing = fs.existsSync(launchAgentPath) ? fs.readFileSync(launchAgentPath, "utf8") : "";
  if (existing === plist && (await isLaunchAgentLoaded())) {
    logMessage(`wallpaper launch agent ready interval=${intervalHours}h`);
    return;
  }
  await unloadWallpaperLaunchAgent();
  fs.writeFileSync(launchAgentPath, plist, "utf8");
  await execFileAsync("launchctl", ["bootstrap", `gui/${process.getuid()}`, launchAgentPath], { timeout: 8000 });
  logMessage(`wallpaper launch agent installed interval=${intervalHours}h plist=${launchAgentPath}`);
}

async function uninstallWallpaperLaunchAgent() {
  await unloadWallpaperLaunchAgent();
  if (fs.existsSync(launchAgentPath)) fs.unlinkSync(launchAgentPath);
}

async function unloadWallpaperLaunchAgent() {
  await execFileAsync("launchctl", ["bootout", `gui/${process.getuid()}`, launchAgentPath], { timeout: 8000 }).catch(() => {});
}

async function isLaunchAgentLoaded() {
  try {
    await execFileAsync("launchctl", ["print", `gui/${process.getuid()}/${launchAgentLabel}`], { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

function buildWallpaperLaunchAgentPlist({ intervalHours, nodePath, scriptPath, configDir, dataRoot, logFile }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(launchAgentLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>--no-warnings</string>
    <string>${escapeXml(scriptPath)}</string>
    <string>--config-dir</string>
    <string>${escapeXml(configDir)}</string>
    <string>--data-root</string>
    <string>${escapeXml(dataRoot)}</string>
    <string>--log-file</string>
    <string>${escapeXml(logFile)}</string>
  </array>
  <key>StartCalendarInterval</key>
${buildStartCalendarIntervalXml(intervalHours)}
  <key>StandardOutPath</key>
  <string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logFile)}</string>
</dict>
</plist>
`;
}

function buildStartCalendarIntervalXml(intervalHours) {
  const normalized = normalizeWallpaperInterval(intervalHours);
  if (normalized <= 1) {
    return `  <dict>
    <key>Minute</key>
    <integer>0</integer>
  </dict>`;
  }
  const entries = [];
  for (let hour = 0; hour < 24; hour += normalized) {
    entries.push(`    <dict>
      <key>Hour</key>
      <integer>${hour}</integer>
      <key>Minute</key>
      <integer>0</integer>
    </dict>`);
  }
  return `  <array>
${entries.join("\n")}
  </array>`;
}

function resolveWallpaperAgentScriptPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, "app.asar.unpacked", "scripts", "set-random-wallpaper.js");
  return path.join(appRoot, "scripts", "set-random-wallpaper.js");
}

function findNodeExecutable() {
  const candidates = [
    process.env.INKTIME_NODE_PATH,
    ...String(process.env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, "node")),
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

async function openImageDirectory() {
  try {
    const response = await fetch(`${appUrl}/api/config`);
    const config = await response.json();
    if (config.imageDir) await shell.openPath(config.imageDir);
  } catch (error) {
    dialog.showErrorBox("打开图片目录失败", error instanceof Error ? error.message : String(error));
  }
}

function showNotification(title, body) {
  if (tray) tray.displayBalloon?.({ title, content: body });
}

async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${appUrl}/api/config`);
      if (response.ok) return;
    } catch {
      // Keep waiting until the embedded Express server is listening.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("InkTime Gallery server did not start in time.");
}

async function prepareRuntimeFiles() {
  fs.mkdirSync(runtimeConfigDir, { recursive: true });
  fs.mkdirSync(runtimeDataDir, { recursive: true });
  if (app.isPackaged) {
    copyIfMissing(path.join(appRoot, "config", "gallery.config.json"), path.join(runtimeConfigDir, "gallery.config.json"));
    copyIfMissing(path.join(appRoot, ".env.local"), path.join(userDataDir, ".env.local"));
    copyIfMissing(path.join(process.cwd(), ".env.local"), path.join(userDataDir, ".env.local"));
    copyDirIfEmpty(path.join(appRoot, "data"), runtimeDataDir);
  }
}

function copyIfMissing(source, target) {
  if (!fs.existsSync(source) || fs.existsSync(target)) return;
  fs.copyFileSync(source, target);
}

function copyDirIfEmpty(source, target) {
  if (!fs.existsSync(source) || (fs.existsSync(target) && fs.readdirSync(target).length > 0)) return;
  copyDir(source, target);
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
    } else if (entry.isFile()) {
      copyIfMissing(sourcePath, targetPath);
    }
  }
}

function logMessage(message) {
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // Logging must never prevent the app from starting.
  }
}

function logError(label, error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error);
  logMessage(`${label}: ${message}`);
}
