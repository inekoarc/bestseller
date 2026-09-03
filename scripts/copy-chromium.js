'use strict';

/**
 * 打包前置：把本机已下载的 Chromium 复制到 resources/ms-playwright/chromium-<rev>，
 * 供 electron-builder 的 extraResources 随包分发。
 *
 * 源目录按以下顺序查找：
 *   1. PLAYWRIGHT_BROWSERS_PATH 环境变量
 *   2. %LOCALAPPDATA%\ms-playwright   （Windows 默认）
 *   3. ~/.cache/ms-playwright         （macOS / Linux 默认）
 *
 * 用法：node scripts/copy-chromium.js [--force]
 *   --force  已存在时也重新覆盖
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');

function candidateRoots() {
  const out = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) out.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  if (process.platform === 'win32') {
    const lad = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    out.push(path.join(lad, 'ms-playwright'));
  }
  out.push(path.join(os.homedir(), '.cache', 'ms-playwright'));
  return out;
}

function findChromium() {
  for (const rootDir of candidateRoots()) {
    if (!rootDir || !fs.existsSync(rootDir)) continue;
    let dirs = [];
    try {
      dirs = fs.readdirSync(rootDir);
    } catch (_) {
      continue;
    }
    // 取修订号最大的完整 chromium（排除 headless shell）
    const cr = dirs
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const d of cr) {
      const full = path.join(rootDir, d);
      const candidates = [
        path.join(full, 'chrome-win64', 'chrome.exe'),
        path.join(full, 'chrome-win', 'chrome.exe'),
        path.join(full, 'chrome-linux', 'chrome'),
        path.join(full, 'chrome-mac', 'Chrome.app', 'Contents', 'MacOS', 'Chrome'),
      ];
      if (candidates.some((e) => fs.existsSync(e))) return { dir: full, rev: d };
    }
  }
  return null;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  let n = 0;
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      n += copyDir(s, d);
    } else {
      try {
        fs.copyFileSync(s, d);
        n++;
      } catch (_) {
        /* 跳过被占用/权限受限的文件 */
      }
    }
  }
  return n;
}

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch (_) {}
      }
    }
  };
  walk(dir);
  return total;
}

async function main() {
  const force = process.argv.includes('--force');
  const found = findChromium();
  if (!found) {
    console.error('✗ 未找到本机 Chromium。请先执行：npx playwright install chromium');
    process.exit(1);
  }

  const dest = path.join(root, 'resources', 'ms-playwright', found.rev);
  if (fs.existsSync(dest) && !force) {
    console.log('✓ Chromium 已就位（跳过复制）：' + path.relative(root, dest));
    console.log('  大小：' + (dirSize(dest) / 1024 / 1024).toFixed(0) + ' MB');
    console.log('  需要强制刷新请加 --force');
    return;
  }

  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });

  console.log('源  ：' + found.dir);
  console.log('目标：' + path.relative(root, dest));
  console.log('复制中（约 400MB，需要一点时间）...');
  const t0 = Date.now();
  const n = copyDir(found.dir, dest);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('✓ 完成：' + n + ' 个文件，' + (dirSize(dest) / 1024 / 1024).toFixed(0) + ' MB，用时 ' + secs + 's');

  // 校验可执行文件
  const exeCan64 = path.join(dest, 'chrome-win64', 'chrome.exe');
  const exeCan32 = path.join(dest, 'chrome-win', 'chrome.exe');
  if (fs.existsSync(exeCan64)) console.log('✓ 可执行文件存在：chrome-win64/chrome.exe');
  else if (fs.existsSync(exeCan32)) console.log('✓ 可执行文件存在：chrome-win/chrome.exe');
  else console.warn('⚠ 未找到 chrome.exe，请检查目录结构');
}

main().catch((e) => {
  console.error('✗ 失败：' + e.message);
  process.exit(1);
});
