'use strict';
/**
 * 拼多多短信脚本真页验证（不发短信）：
 *  - smsFillPhone('') → 空手机号点「发送验证码」→ 页面应弹格式错误 toast（验证 async 脚本 + toast 抓取）
 *  - smsSubmitCode('1234') → 未进验证码视图时点「登录」→ 页面应弹提示（验证勾协议与登录按钮定位）
 */
const path = require('path');
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright'));
const { launchOptions } = require(path.join(root, 'src', 'collector', 'browser'));
const paths = require(path.join(root, 'src', 'collector', 'paths'));
const { sleep } = require(path.join(root, 'src', 'collector', 'util'));
const pdd = require(path.join(root, 'src', 'collector', 'platforms', 'pdd'));

(async () => {
  const lo = launchOptions();
  lo.viewport = pdd.viewport;
  lo.isMobile = true;
  lo.hasTouch = true;
  lo.userAgent = pdd.userAgent;
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'pdd'), lo);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(pdd.loginUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await sleep(2500);
  console.log('落地: ' + page.url());

  const r1 = await pdd.smsFillPhone(page, '').catch((e) => 'ERR ' + e.message);
  console.log('smsFillPhone(空号): ' + r1);

  const r2 = await pdd.smsSubmitCode(page, '1234').catch((e) => 'ERR ' + e.message);
  console.log('smsSubmitCode: ' + r2);

  await ctx.close().catch(() => {});
  process.exit(0);
})();
