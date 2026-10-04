import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { resolveUnpackedRoot } from "./runtime-paths.js";

const execFileAsync = promisify(execFile);
const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const windowsBridgePath = path.join(resolveUnpackedRoot(platformRoot), "scripts", "windows", "set-desktop-wallpaper.ps1");

/**
 * Set the primary desktop wallpaper and return the path reported by the OS.
 * The adapter deliberately keeps all platform-specific side effects here so
 * the server and the standalone scheduler share exactly the same contract.
 */
export async function applyDesktopWallpaper(wallpaperPath, options = {}) {
  const targetPath = path.resolve(String(wallpaperPath));
  if (!fs.existsSync(targetPath)) throw new Error(`Wallpaper file does not exist: ${targetPath}`);
  if (process.platform === "win32") return applyWindowsWallpaper(targetPath, options);
  if (process.platform !== "darwin") throw new Error(`Unsupported desktop wallpaper platform: ${process.platform}`);
  return applyMacWallpaper(targetPath, options);
}

export async function readDesktopWallpaperPath(options = {}) {
  if (process.platform === "win32") return readWindowsWallpaper(options);
  if (process.platform !== "darwin") return "";
  try {
    const { stdout } = await execFileAsync(
      "osascript",
      ["-e", 'tell application "System Events"\nset output to ""\nrepeat with desktopItem in desktops\nset output to output & (picture of desktopItem as text) & linefeed\nend repeat\nreturn output\nend tell'],
      { timeout: options.timeout ?? 8000 },
    );
    return stdout.trim();
  } catch {
    return "";
  }
}

export function desktopWallpaperMatches(appliedPath, wallpaperPath) {
  const expected = normalizeComparablePath(wallpaperPath);
  if (normalizeComparablePath(appliedPath || "") === expected) return true;
  return String(appliedPath || "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => normalizeComparablePath(value) === expected);
}

async function applyMacWallpaper(targetPath, options) {
  const escaped = escapeAppleScriptString(targetPath);
  await execFileAsync(
    "osascript",
    ["-e", `tell application "System Events"\nrepeat with desktopItem in desktops\nset picture of desktopItem to POSIX file "${escaped}"\nend repeat\nend tell`],
    { timeout: options.timeout ?? 8000 },
  );
  await execFileAsync("killall", ["Dock"], { timeout: options.timeout ?? 8000 }).catch(() => {});
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const appliedPath = await readDesktopWallpaperPath(options);
    if (desktopWallpaperMatches(appliedPath, targetPath)) return appliedPath;
    await wait(500);
  }
  const appliedPath = await readDesktopWallpaperPath(options);
  throw new Error(`macOS did not confirm wallpaper change. target=${targetPath} current=${appliedPath || "unknown"}`);
}

async function applyWindowsWallpaper(targetPath, options) {
  const appliedPath = await runWindowsBridge(targetPath, options);
  if (!desktopWallpaperMatches(appliedPath, targetPath)) {
    throw new Error(`Windows did not confirm wallpaper change. target=${targetPath} current=${appliedPath || "unknown"}`);
  }
  return appliedPath;
}

async function readWindowsWallpaper(options) {
  try {
    return await runWindowsBridge(null, options);
  } catch {
    return "";
  }
}

async function runWindowsBridge(targetPath, options = {}) {
  if (!fs.existsSync(windowsBridgePath)) throw new Error(`Windows wallpaper bridge does not exist: ${windowsBridgePath}`);
  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    windowsBridgePath,
  ];
  if (targetPath) args.push("-WallpaperPath", targetPath);
  const { stdout } = await execFileAsync("powershell.exe", args, {
    timeout: options.timeout ?? 15000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  const output = String(stdout).trim();
  if (!output) throw new Error("Windows wallpaper bridge returned no confirmation.");
  try {
    const payload = JSON.parse(output.split(/\r?\n/).filter(Boolean).at(-1));
    return String(payload.path || "").trim();
  } catch {
    return output.split(/\r?\n/).filter(Boolean).at(-1).trim();
  }
}

function normalizeComparablePath(value) {
  const normalized = String(value || "").trim();
  let canonical;
  try { canonical = fs.realpathSync.native(normalized); } catch { canonical = path.resolve(normalized); }
  return process.platform === "win32" ? canonical.replaceAll("\\", "/").toLowerCase() : canonical;
}

function escapeAppleScriptString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
