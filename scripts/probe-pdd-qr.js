'use strict';

/**
 * 探测拼多多 H5 登录页「扫码登录」形态。
 *   node scripts/probe-pdd-qr.js
 *
 * 流程：goto login.html → 点击「扫码登录」页签 → 轮询等待二维码渲染
 * → dump 二维码候选元素（标签/class/尺寸/正方形判定）+ 截图。
 * 结论用于确定 pdd.js 的 qrSelectors 是否需要脱离 qr.js 通用选择器。
 */

const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright'));
const { launchOptions } = require(path.join(root, 'src', 'collector', 'browser'));
const paths = require(path.join(root, 'src', 'collector', 'paths'));
const { sleep } = require(path.join(root, 'src', 'collector', 'util'));
const pdd = require(path.join(root, 'src', 'collector', 'platforms', 'pdd'));
const { COLLECT_QR_SRC, QR_READY_SRC } = require(path.join(root, 'src', 'collector', 'qr'));

const DUMP_SRC = `(function () {
  var els = document.querySelectorAll('img, canvas, div, iframe');
  var out = [];
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 60) continue;
    var ratio = r.width / r.height;
    if (ratio < 0.7 || ratio > 1.45) continue; // 只看近似正方形
    var tag = el.tagName.toLowerCase();
    if (tag === 'div' && !el.querySelector('img') && !el.querySelector('canvas')) continue;
    out.push({
      tag: tag,
      cls: String(el.className || '').slice(0, 90),
      id: el.id || '',
      w: Math.round(r.width),
      h: Math.round(r.height),
      src: tag === 'img' ? String(el.getAttribute('src') || '').slice(0, 90) : '',
      childImg: !!el.querySelector('img'),
      childCanvas: !!el.querySelector('canvas')
    });
  }
  return out.slice(0, 15);
})()`;

// 文本清洗：拼多多页面元素文本常被塞入零宽字符，精确匹配前必须剥掉
const CLICK_SCAN_SRC = `(function () {
  function clean(s) { return String(s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').replace(/\\s+/g, '').trim(); }
  function vis(el) { var b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; }
  var els = document.querySelectorAll('button, div, span, a, p, li');
  var seen = [];
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    var s = clean(e.textContent);
    if (!s || s.length > 12) continue;
    if (seen.indexOf(s) >= 0) continue;
    seen.push(s);
    if (s !== '扫码登录' && s !== '扫码') continue;
    if (!vis(e) || e.children.length > 2) continue;
    e.click();
    return 'ok: ' + e.tagName + '.' + String(e.className || '').slice(0, 40);
  }
  return 'not-found; 可见短文本=' + seen.slice(0, 25).join(' | ');
})()`;

(async () => {
  const lo = launchOptions();
  for (const variantName of ['mobile', 'desktop']) {
    const lo2 = { ...lo };
    if (variantName === 'desktop') {
      delete lo2.isMobile;
      delete lo2.hasTouch;
      delete lo2.userAgent;
      lo2.viewport = { width: 893, height: 844 };
    }
    const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'pdd-probe-' + variantName), lo2);
    const page = ctx.pages()[0] || (await ctx.newPage());

    console.log('\n════ ' + variantName + ' UA ════');
    console.log('── 1. 打开登录页 ──');
    await page.goto(pdd.loginUrl, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
    await sleep(3000);
    console.log('落地: ' + page.url());

    console.log('── 2. 点击「扫码登录」（文本已清洗零宽字符） ──');
    const r = await page.evaluate(CLICK_SCAN_SRC).catch((e) => 'ERR ' + e.message);
    console.log('点击结果: ' + r);
    await sleep(4000);

    console.log('── 3. 轮询二维码渲染（qr.js QR_READY_SRC） ──');
    let ready = false;
    for (let i = 0; i < 15; i++) {
      ready = await page.evaluate(QR_READY_SRC).catch(() => false);
      if (ready) break;
      await sleep(800);
    }
    console.log('QR_READY_SRC（通用选择器）: ' + ready);

    console.log('── 4. 正方形候选元素 dump ──');
    const cands = await page.evaluate(DUMP_SRC).catch((e) => [{ err: e.message }]);
    for (const c of cands) {
      console.log(
        '  [' + c.tag + '] cls=' + (c.cls || c.id || '(无)') + '  ' + c.w + 'x' + c.h +
        (c.src ? '  src=' + c.src.slice(0, 60) : '')
      );
    }

    console.log('── 5. qr.js COLLECT_QR_SRC 定位测试 ──');
    const info = await page.evaluate(COLLECT_QR_SRC).catch((e) => ({ found: false, err: e.message }));
    console.log(JSON.stringify(info));

    const shot = path.join(paths.ensureDir('probe'), 'pdd-qr-' + variantName + '.png');
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.log('截图: ' + shot);
    console.log('最终落地: ' + page.url());

    await ctx.close().catch(() => {});
  }
  process.exit(0);
})();
