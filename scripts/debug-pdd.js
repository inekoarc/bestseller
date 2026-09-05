'use strict';

/**
 * 诊断拼多多首页 SSR 数据与 DOM 状态。
 *   node scripts/debug-pdd.js
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
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'pdd-probe'), lo);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://mobile.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  await sleep(6000);
  for (let i = 0; i < 3; i++) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await sleep(1500);
  }
  const info = await page
    .evaluate(
      `(function () {
    var out = { url: location.href, title: document.title };
    var body = (document.body ? document.body.innerText : '') || '';
    out.textLen = body.length;
    out.textHead = body.replace(/[\\u200b\\u200c\\u200d\\ufeff\\s]+/g, ' ').trim().slice(0, 200);
    out.ssrType = typeof window.__SSR__;
    try { out.ssrLen = window.__SSR__ ? JSON.stringify(window.__SSR__).length : 0; } catch (e) { out.ssrErr = e.message; }
    out.rawDataType = typeof window.rawData;
    try { out.rawDataLen = window.rawData ? JSON.stringify(window.rawData).length : 0; } catch (e) { out.rawDataErr = e.message; }
    var c = 0; var els = document.querySelectorAll('div, span, p, em, i');
    for (var i = 0; i < els.length; i++) {
      if (els[i].children.length) continue;
      if (/^[¥￥]\\s?[\\d,]{1,7}(\\.\\d{1,2})?$/.test((els[i].textContent || '').trim())) c++;
    }
    out.priceLeaves = c;
    out.imgCount = document.querySelectorAll('img').length;
    if (window.__SSR__ && typeof window.__SSR__ === 'object') out.ssrKeys = Object.keys(window.__SSR__).slice(0, 20);
    if (window.rawData && typeof window.rawData === 'object') out.rawDataKeys = Object.keys(window.rawData).slice(0, 20);
    var gn = 0, gid = 0;
    var scripts = document.querySelectorAll('script');
    for (var s = 0; s < scripts.length; s++) {
      var t = scripts[s].textContent || '';
      if (t.length < 500) continue;
      gn += (t.match(/goods_name/g) || []).length;
      gid += (t.match(/goods_id/g) || []).length;
    }
    out.scriptGoodsName = gn; out.scriptGoodsId = gid;
    return out;
  })()`
    )
    .catch((e) => ({ err: e.message }));
  console.log(JSON.stringify(info, null, 2));

  // 找 rawData 中的 goods 对象样本
  const sample = await page
    .evaluate(
      `(function () {
    var found = [];
    function visit(v, depth) {
      if (!v || typeof v !== 'object' || depth > 9 || found.length >= 3) return;
      if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) visit(v[i], depth + 1); return; }
      if ((v.goods_id || v.goodsId) && (v.goods_name || v.goodsName)) { found.push(v); return; }
      var ks = Object.keys(v);
      for (var k = 0; k < ks.length; k++) { var nv = v[ks[k]]; if (nv && typeof nv === 'object') visit(nv, depth + 1); }
    }
    try { visit(window.rawData, 0); } catch (e) { return { err: e.message }; }
    // 序列化前三个商品对象的键与关键字段值
    return found.map(function (o) {
      var keys = Object.keys(o);
      var pick = {};
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i]; var v = o[k];
        if (/price|sales|shop|mall|name|image|thumb|url|id/i.test(k)) {
          pick[k] = (typeof v === 'object' && v !== null) ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120);
        }
      }
      return { keyCount: keys.length, pick: pick };
    });
  })()`
    )
    .catch((e) => [{ err: e.message }]);
  console.log('\nrawData 中 goods 对象样本:');
  console.log(JSON.stringify(sample, null, 2));
  await ctx.close().catch(() => {});
  process.exit(0);
})();
