'use strict';

/**
 * 诊断 engine 同款 profile（pw-data/pdd）下的扫码登录页状态。
 *   node scripts/debug-pdd-qr2.js
 */

const path = require('path');
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright'));
const { launchOptions } = require(path.join(root, 'src', 'collector', 'browser'));
const paths = require(path.join(root, 'src', 'collector', 'paths'));
const { sleep } = require(path.join(root, 'src', 'collector', 'util'));
const pdd = require(path.join(root, 'src', 'collector', 'platforms', 'pdd'));
const { QR_READY_SRC, COLLECT_QR_SRC } = require(path.join(root, 'src', 'collector', 'qr'));

(async () => {
  const lo = launchOptions();
  lo.viewport = pdd.viewport;
  lo.isMobile = true;
  lo.hasTouch = true;
  lo.userAgent = pdd.userAgent;
  // 与 engine 完全一致的 userDataDir
  const userDataDir = paths.ensureDir('pw-data', 'pdd');
  console.log('profile: ' + userDataDir);
  const ctx = await chromium.launchPersistentContext(userDataDir, lo);
  const page = ctx.pages()[0] || (await ctx.newPage());

  await page.goto(pdd.loginUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => console.log('goto: ' + e.message.slice(0, 50)));
  await sleep(2000);
  console.log('落地: ' + page.url());

  const enter = await pdd.enterQrLogin(page).catch((e) => 'ERR ' + e.message);
  console.log('enterQrLogin: ' + enter);
  await sleep(3000);

  let ready = false;
  for (let i = 0; i < 15; i++) {
    ready = await page.evaluate(QR_READY_SRC).catch((e) => 'ERR ' + e.message);
    if (ready === true) break;
    await sleep(800);
  }
  console.log('QR_READY: ' + ready);
  const info = await page.evaluate(COLLECT_QR_SRC).catch((e) => ({ found: false, err: e.message }));
  console.log('COLLECT_QR: ' + JSON.stringify(info));

  // 页面状态：扫码元素与文本
  const state = await page
    .evaluate(
      `(function () {
    function clean(s) { return String(s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').replace(/\\s+/g, ' ').trim(); }
    return {
      hasQrWrapper: !!document.querySelector('.qr-code-wrapper, img.qr-code-box'),
      qrBoxCount: document.querySelectorAll('img.qr-code-box').length,
      qrcodeLoginCount: document.querySelectorAll('.qrcode-login').length,
      head: clean(document.body ? document.body.innerText : '').slice(0, 160)
    };
  })()`
    )
    .catch((e) => ({ err: e.message }));
  console.log('页面状态: ' + JSON.stringify(state, null, 1));

  await page.screenshot({ path: path.join(paths.ensureDir('probe'), 'pdd-qr2.png'), fullPage: true }).catch(() => {});
  await ctx.close().catch(() => {});
  process.exit(0);
})();
