'use strict';

// 端到端验证：
// A) 登录成功检测：向全新上下文注入 PDDAccessToken Cookie（模拟扫码成功后的状态），
//    确认 engine 的 isLoggedIn 逻辑（context.cookies 读 HttpOnly + value 校验）能正确判定为已登录。
// B) 风控检测：加载被标记的 data/pw-data/pdd 上下文，确认登录页 URL 带 _x_no_login_launch=1，
//    即 v0.2.7 的 engine 风控检查会命中。
const path = require('path');
const fs = require('fs');
const os = require('os');
const browserMod = require('../src/collector/browser');
const paths = require('../src/collector/paths');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function launchOpts() {
  const lo = browserMod.launchOptions();
  lo.viewport = { width: 390, height: 844 };
  lo.isMobile = true; lo.hasTouch = true; lo.userAgent = UA;
  return lo;
}

// 复刻 engine.isLoggedIn 的核心判定（adapter.loginCookies=['PDDAccessToken']）
async function isLoggedInByCookies(ctx) {
  const names = ['PDDAccessToken'];
  const cs = await ctx.cookies();
  for (const name of names) {
    const c = cs.find((x) => x.name === name);
    if (c && c.value && c.value !== '0') return true;
  }
  return false;
}

(async () => {
  // ── A) 登录成功检测（模拟扫码后 PDDAccessToken 已写入）──
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdd-detect-'));
  const { chromium } = require('playwright');
  const ctxA = await chromium.launchPersistentContext(tmpDir, launchOpts());
  const pageA = ctxA.pages()[0] || (await ctxA.newPage());
  await browserMod.scrubHeadlessUa(pageA);

  // 普通 Cookie
  await ctxA.addCookies([{ name: 'PDDAccessToken', value: 'abc123token', domain: '.pinduoduo.com', path: '/' }]);
  // HttpOnly Cookie（拼多多真实场景）
  await ctxA.addCookies([{ name: 'PDDAccessToken', value: 'httpOnlyTok', domain: '.pinduoduo.com', path: '/', httpOnly: true }]);

  const cookiesA = await ctxA.cookies();
  const tok = cookiesA.find((c) => c.name === 'PDDAccessToken');
  console.log('[A] 注入 PDDAccessToken 后 context.cookies 读到:', tok ? ('name=' + tok.name + ' value=' + tok.value + ' httpOnly=' + tok.httpOnly) : '未读到');
  const detected = await isLoggedInByCookies(ctxA);
  console.log('[A] engine.isLoggedIn 判定(模拟扫码成功):', detected ? '✓ 已登录（检测通过）' : '✗ 未登录（检测失败）');

  // 反向：空值/0 值不应误判
  const ctxB = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'pdd-detect2-')), launchOpts());
  await ctxB.addCookies([{ name: 'PDDAccessToken', value: '0', domain: '.pinduoduo.com', path: '/' }]);
  const falsePositive = await isLoggedInByCookies(ctxB);
  console.log('[A] 反向校验(value=0 不应误判):', falsePositive ? '✗ 误判为已登录' : '✓ 正确不误判');

  await ctxA.close().catch(() => {});
  await ctxB.close().catch(() => {});
  fs.rmSync(tmpDir, { recursive: true, force: true });

  // ── B) 风控检测：加载被标记的持久化上下文 ──
  const flaggedDir = path.join(paths.getBase(), 'pw-data', 'pdd');
  if (!fs.existsSync(flaggedDir)) {
    console.log('[B] 未找到被标记 profile（', flaggedDir, '），跳过风控检测');
    return;
  }
  const ctxC = await chromium.launchPersistentContext(flaggedDir, launchOpts());
  const pageC = ctxC.pages()[0] || (await ctxC.newPage());
  await browserMod.scrubHeadlessUa(pageC);
  await pageC.goto('https://mobile.pinduoduo.com/login.html', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await pageC.waitForTimeout(4000);
  const risk = /_x_no_login_launch=1/.test(pageC.url());
  console.log('[B] 被标记 profile 登录页 URL:', pageC.url());
  console.log('[B] v0.2.7 风控检测(/_x_no_login_launch=1/):', risk ? '✓ 会命中（将提示用户重置）' : '✗ 未命中（当前 profile 已无风控标记）');
  await ctxC.close().catch(() => {});
})().catch((e) => { console.log('EXCEPTION', e.stack || e.message); process.exit(1); });
