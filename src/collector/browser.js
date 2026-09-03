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
  const candidates = [
    path.join(base, cr, 'chrome-win64', 'chrome.exe'),
    path.join(base, cr, 'chrome-win', 'chrome.exe'),
    path.join(base, cr, 'chrome-linux', 'chrome'),
    path.join(base, cr, 'chrome-mac', 'Chrome.app', 'Contents', 'MacOS', 'Chrome'),
  ];
  for (const e of candidates) if (fs.existsSync(e)) return e;
  return null;
}

/**
 * 启动参数。
 *
 * 关于自动化标记：实测 s.taobao.com 的商品数据接口会因为浏览器自报自动化身份
 * （navigator.webdriver=true + 「正受自动化软件控制」横幅）而被风控重定向到
 * h5api.m.taobao.com/.../_____tmd_____/punish，导致搜索结果永远停在「加载中...」。
 *
 * 下面两项只做一件事：不主动声明自己是自动化浏览器。它们不绕过任何登录、验证码
 * 或访问控制 —— 用户仍需用自己的账号扫码登录，只能看到自己本就能看到的公开数据。
 * 若你希望严格保留自动化标记，把 HIDE_AUTOMATION 设为 false 即可（代价是淘宝不可用）。
 */
const HIDE_AUTOMATION = process.env.BESTSELLER_HIDE_AUTOMATION !== 'false';

function launchOptions() {
  const opts = {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check', '--disable-infobars'],
  };
  if (HIDE_AUTOMATION) {
    opts.args.push('--disable-blink-features=AutomationControlled');
    opts.ignoreDefaultArgs = ['--enable-automation'];
  }
  const exe = resolveChromiumExecutable();
  if (exe) opts.executablePath = exe;
  return opts;
}

module.exports = { resolveChromiumExecutable, launchOptions };
