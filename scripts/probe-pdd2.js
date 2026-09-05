'use strict';

/**
 * 拼多多二次探测：
 *   node scripts/probe-pdd2.js --keyword=充电器
 *
 * 待确认：
 *  1. portal.html 落地页渲染的商品是否与关键词相关（还是首页推荐流）
 *  2. 页面内搜索框流程：输入关键词提交后 URL 变成什么
 *  3. __SSR__ 内嵌数据的结构（商品列表在哪个字段）
 */

const path = require('path');
const fs = require('fs');

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
    if (m) a[m[1]] = m[2] === undefined ? true : m[2];
  }
  return a;
}
const args = parseArgs();
const keyword = args.keyword || '充电器';
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright'));
const { launchOptions } = require(path.join(root, 'src', 'collector', 'browser'));
const paths = require(path.join(root, 'src', 'collector', 'paths'));
const { sleep } = require(path.join(root, 'src', 'collector', 'util'));

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const CARDS_SRC = `(function () {
  // 广度扫描：找所有含价格（¥+数字）且含图片的候选卡片容器
  var els = document.querySelectorAll('a, div, li');
  var out = [];
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    var t = (e.textContent || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '');
    if (!/[¥￥]?\\s?\\d{1,5}(\\.\\d{1,2})?/.test(t)) continue;
    if (t.length > 200) continue;
    var imgs = e.querySelectorAll('img');
    if (!imgs.length) continue;
    out.push({
      tag: e.tagName,
      cls: String(e.className || '').slice(0, 80),
      href: (e.getAttribute && e.getAttribute('href')) || '',
      text: t.replace(/\\s+/g, ' ').trim().slice(0, 120),
      imgCount: imgs.length
    });
  }
  // 去重：取最内层的（text 相同则跳过）
  var seen = {};
  var dedup = [];
  for (var j = 0; j < out.length; j++) {
    var key = out[j].text;
    if (seen[key]) continue;
    seen[key] = 1;
    dedup.push(out[j]);
  }
  return dedup.slice(0, 15);
})()`;

const SSR_KEYS_SRC = `(function () {
  function walk(obj, prefix, depth, acc) {
    if (!obj || typeof obj !== 'object' || depth > 4) return;
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length && acc.length < 80; i++) {
      var k = keys[i];
      var v = obj[k];
      acc.push(prefix + k + ' : ' + (v === null ? 'null' : Array.isArray(v) ? 'array(' + v.length + ')' : typeof v));
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, prefix + k + '.', depth + 1, acc);
      else if (Array.isArray(v) && v.length && typeof v[0] === 'object') walk(v[0], prefix + k + '[0].', depth + 1, acc);
    }
  }
  var acc = [];
  try { walk(window.__SSR__ || {}, '', 0, acc); } catch (e) { acc.push('ERR ' + e.message); }
  return acc;
})()`;

(async () => {
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'pdd-probe'), {
    ...launchOptions(),
    userAgent: MOBILE_UA,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  console.log('═══ 1. 直接落地 portal（带 search_key） ═══');
  await page
    .goto('https://mobile.pinduoduo.com/gsearch.html?search_key=' + encodeURIComponent(keyword), {
      waitUntil: 'domcontentloaded',
      timeout: 40000,
    })
    .catch(() => {});
  await sleep(6000);
  for (let i = 0; i < 5; i++) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await sleep(1200);
  }
  console.log('落地: ' + page.url());
  const cards1 = await page.evaluate(CARDS_SRC).catch((e) => [{ err: e.message }]);
  console.log('卡片样本:');
  for (const c of cards1.slice(0, 10)) console.log('  [' + c.tag + '.' + (c.cls || '') + '] ' + c.text.slice(0, 90) + '  href=' + String(c.href).slice(0, 60));

  const rel = cards1.filter((c) => /充电|快充|插头|数据线/.test(c.text)).length;
  console.log('与关键词相关卡片数（粗判）: ' + rel + '/' + cards1.length);

  console.log('\n═══ 2. 页面内搜索框流程 ═══');
  // 找搜索框
  const searchBox = await page
    .evaluate(`(function(){
    var inp = document.querySelector('input[type="search"], input[placeholder], input');
    if (!inp) return null;
    return { ph: inp.placeholder || '', name: inp.name || '' };
  })()`)
    .catch(() => null);
  console.log('搜索框: ' + JSON.stringify(searchBox));
  if (searchBox) {
    await page.fill('input', keyword).catch((e) => console.log('fill: ' + e.message));
    await sleep(800);
    await page.keyboard.press('Enter').catch(() => {});
    await sleep(5000);
    for (let i = 0; i < 4; i++) {
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
      await sleep(1200);
    }
    console.log('搜索后落地: ' + page.url());
    const cards2 = await page.evaluate(CARDS_SRC).catch(() => []);
    const rel2 = cards2.filter((c) => /充电|快充|插头|数据线/.test(c.text)).length;
    console.log('搜索后卡片: ' + cards2.length + ' 条，相关 ' + rel2 + ' 条');
    for (const c of cards2.slice(0, 8)) console.log('  [' + c.tag + '.' + (c.cls || '') + '] ' + c.text.slice(0, 90));
  }

  console.log('\n═══ 3. __SSR__ 结构 ═══');
  const ssrKeys = await page.evaluate(SSR_KEYS_SRC).catch((e) => ['ERR ' + e.message]);
  for (const k of ssrKeys.slice(0, 60)) console.log('  ' + k);

  await ctx.close().catch(() => {});
  process.exit(0);
})();
