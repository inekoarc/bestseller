'use strict';
/**
 * 验证拼多多扫码登录链路（全新上下文，模拟 v0.2.8 doLogin 抓码流程）：
 * 进 login.html → 点「扫码登录」页签 → grabQR 轮询抓码。
 * 输出 URL 是否带风控标记、扫码页签是否存在、二维码是否抓到。
 * 用法: node scripts/verify-pdd-qr-fresh.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const browserMod = require('../src/collector/browser');
const { grabQR } = require('../src/collector/qr');
const pdd = require('../src/collector/platforms/pdd');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdd-qr-verify-'));
  const { chromium } = require('playwright');
  const lo = browserMod.launchOptions();
  lo.viewport = pdd.viewport;
  lo.isMobile = true;
  lo.hasTouch = true;
  lo.userAgent = pdd.userAgent;
  const ctx = await chromium.launchPersistentContext(tmpDir, lo);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await browserMod.scrubHeadlessUa(page);

  console.log('headless =', lo.headless);
  await page.goto(pdd.loginUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await sleep(2500);
  console.log('URL      :', page.url());
  console.log('风控标记  :', /_x_no_login_launch=1/.test(page.url()) ? '是(_x_no_login_launch)' : '否');

  // 同 doLogin：enterQrLogin 点「扫码登录」页签
  const r = await pdd.enterQrLogin(page).catch(() => 'err');
  console.log('扫码页签  :', r);
  await sleep(1500);

  const qr = await grabQR(page, 15000);
  console.log('二维码    :', qr ? `抓到 ${qr.w}x${qr.h} (${qr.buffer.length}B)` : '未抓到');

  await ctx.close().catch(() => {});
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(qr ? 0 : 1);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(2);
});
