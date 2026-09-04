'use strict';

const path = require('path');
const fs = require('fs');

/**
 * 统一解析 Chromium 可执行文件（完整版 chrome.exe，非 headless-shell）。
 * 依次尝试：
 * - 打包态：main.js 设置的 PLAYWRIGHT_BROWSERS_PATH → resources/ms-playwright
 * - 开发态：%LOCALAPPDATA%/ms-playwright（Playwright 默认下载位置）
 *
 * 必须用完整版：Playwright 在 headless 模式下默认选择 chrome-headless-shell
 * （旧无头壳），其 UA 带 HeadlessChrome 且内核行为不同，实测淘宝风控下
 * 完全不渲染商品卡片。完整版 + --headless=new 的 UA 与有头一致。
 */
function resolveChromiumExecutable() {
  const bases = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) bases.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  bases.push(
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'ms-playwright')
      : path.join(process.env.USERPROFILE || process.env.HOME || '', 'AppData', 'Local', 'ms-playwright'),
  );
  for (const base of bases) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(base);
    } catch (_) {
      continue;
    }
    // 取修订号最大的 chromium 目录（排除 headless-shell）
    const cr = dirs
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))[0];
    if (!cr) continue;
    const candidates = [
      path.join(base, cr, 'chrome-win64', 'chrome.exe'),
      path.join(base, cr, 'chrome-win', 'chrome.exe'),
      path.join(base, cr, 'chrome-linux', 'chrome'),
      path.join(base, cr, 'chrome-mac', 'Chrome.app', 'Contents', 'MacOS', 'Chrome'),
    ];
    for (const e of candidates) if (fs.existsSync(e)) return e;
  }
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

/**
 * 默认无头（后台）运行：采集过程中不弹出可见浏览器窗口。
 * 登录二维码通过 grabQR 截图回传到 Electron UI 显示，无需看到浏览器窗口。
 * 调试时如需查看浏览器，设 BESTSELLER_HEADLESS=false 即可回到有头模式。
 */
const HEADLESS = process.env.BESTSELLER_HEADLESS !== 'false';

function launchOptions() {
  const opts = {
    headless: HEADLESS,
    viewport: { width: 1440, height: 900 },
    args: ['--no-first-run', '--no-default-browser-check', '--disable-infobars'],
  };
  if (HEADLESS) {
    // 强制新版无头模式：UA 与有头完全一致（不带 HeadlessChrome 标识）。
    // 用户参数排在 Playwright 默认参数之后，后者即使给了旧无头开关也会被覆盖。
    opts.args.push('--headless=new');
  }
  if (HIDE_AUTOMATION) {
    opts.args.push('--disable-blink-features=AutomationControlled');
    opts.ignoreDefaultArgs = ['--enable-automation'];
  }
  const exe = resolveChromiumExecutable();
  if (exe) opts.executablePath = exe;
  return opts;
}

/**
 * 无头模式的 UA 洗白：通过 CDP 把 UA 里的 HeadlessChrome 换成 Chrome
 * （版本号保持真实，不做伪造）。实测淘宝搜索页在 UA 带 HeadlessChrome
 * 时不下发商品数据接口（页面停在「加载中...」），洗白后正常渲染。
 * 需在 page.goto 之前、页面创建之后调用一次。
 */
async function scrubHeadlessUa(page) {
  if (!HEADLESS) return;
  try {
    const cdp = page.context().newCDPSession ? await page.context().newCDPSession(page) : null;
    if (!cdp) return;
    const realUa = await page.evaluate('navigator.userAgent');
    if (!/HeadlessChrome/.test(realUa)) return;
    await cdp.send('Emulation.setUserAgentOverride', {
      userAgent: realUa.replace('HeadlessChrome', 'Chrome'),
    });
  } catch (_) {
    /* 覆写失败不影响主流程 */
  }
}

module.exports = { resolveChromiumExecutable, launchOptions, scrubHeadlessUa };
