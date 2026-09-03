'use strict';

const path = require('path');
const fs = require('fs');

/**
 * 统一解析 Chromium 可执行文件。
 * - 打包态：main.js 在 require('playwright') 之前把 PLAYWRIGHT_BROWSERS_PATH
 *   指向 resources/ms-playwright，这里据此拼出 chrome.exe。
 * - 开发态：不设该环境变量，返回 null，交给 Playwright 默认解析（系统 ms-playwright）。
 */
function resolveChromiumExecutable() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base) return null;
  let dirs = [];
  try {
    dirs = fs.readdirSync(base);
  } catch (_) {
    return null;
  }
  const cr = dirs.filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  if (!cr) return null;
  const exe = path.join(base, cr, 'chrome-win', 'chrome.exe');
  return fs.existsSync(exe) ? exe : null;
}

/**
 * 启动参数。
 * 合规边界：不加任何隐藏自动化特征 / 伪造指纹的参数，只复用用户自己的真实登录态。
 */
function launchOptions() {
  const opts = {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check', '--disable-infobars'],
  };
  const exe = resolveChromiumExecutable();
  if (exe) opts.executablePath = exe;
  return opts;
}

module.exports = { resolveChromiumExecutable, launchOptions };
