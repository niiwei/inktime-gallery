import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveUnpackedRoot } from './platform/runtime-paths.js';

export async function prepareFontRuntime(root, dataRoot) {
  const fontDir = path.join(resolveUnpackedRoot(root),'assets','fonts');
  await fs.access(path.join(fontDir,'noto-serif-cjk-sc.otf'));
  const escape = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const cacheDir = path.join(dataRoot,'font-cache');
  await fs.mkdir(cacheDir,{ recursive:true });
  const configPath = path.join(dataRoot,'fonts.conf');
  const systemDirs = process.platform === 'win32' ? [path.join(process.env.WINDIR || 'C:\\Windows','Fonts')] : ['/System/Library/Fonts','/Library/Fonts',path.join(os.homedir(),'Library','Fonts'),'/usr/share/fonts'];
  const config = `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig><dir>${escape(fontDir)}</dir>${systemDirs.map(dir => `<dir>${escape(dir)}</dir>`).join('')}<cachedir>${escape(cacheDir)}</cachedir><alias><family>serif</family><prefer><family>Noto Serif CJK SC</family></prefer></alias><alias><family>Songti SC</family><prefer><family>Noto Serif CJK SC</family></prefer></alias><alias><family>PingFang SC</family><prefer><family>Noto Serif CJK SC</family></prefer></alias><alias><family>Kaiti SC</family><prefer><family>Noto Serif CJK SC</family></prefer></alias></fontconfig>`;
  await fs.writeFile(configPath,config);
  process.env.FONTCONFIG_FILE = configPath;
  return fontDir;
}
