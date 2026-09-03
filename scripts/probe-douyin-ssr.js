'use strict';

/**
 * 抖音 SSR 数据 + 已登录态探测。
 * 1) 用已登录的 douyin profile + 移动端 UA，看是否出现「商品」tab
 * 2) 找页面内嵌 JSON（_ROUTER_DATA / RENDER_DATA 等），看能否直接取到真实价格
 *   node scripts/probe-douyin-ssr.js --keyword=充电器
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

// 找页面内嵌的全局数据对象
const GLOBALS_SRC = `(function () {
  var names = ['_ROUTER_DATA', 'RENDER_DATA', '_SSR_HYDRATED_DATA', '__INITIAL_STATE__', '__NUXT__', '_SSR_DATA'];
  var found = {};
  for (var i = 0; i < names.length; i++) {
    var v = window[names[i]];
    if (v) found[names[i]] = { type: typeof v, keys: Object.keys(v).slice(0, 25) };
  }
  // 扫 script 标签里的 JSON
  var scripts = document.querySelectorAll('script');
  var inline = [];
  for (var j = 0; j < scripts.length; j++) {
    var t = scripts[j].textContent || '';
    if (t.length < 200) continue;
    if (/window\\s*\\.\\s*(_ROUTER_DATA|RENDER_DATA|__INITIAL_STATE__)/.test(t)) {
      inline.push({ idx: j, len: t.length, head: t.slice(0, 160) });
    }
  }
  return { globals: found, inline: inline.slice(0, 5), scriptCount: scripts.length };
})()`;

// 深挖 _ROUTER_DATA 里的商品字段
const EXTRACT_SRC = `(function () {
  var data = window._ROUTER_DATA || window.RENDER_DATA || window.__INITIAL_STATE__;
  if (!data) return { error: '无内嵌数据' };
  var json = JSON.stringify(data);
  var hits = { price: 0, sales: 0, goodsId: 0, title: 0, shop: 0 };
  hits.price = (json.match(/"price"\\s*:/g) || []).length;
  hits.sales = (json.match(/"(?:sales|soldCount|sellNum|sold_num)"\\s*:/g) || []).length;
  hits.goodsId = (json.match(/"(?:product_id|promotion_id|goods_id|productId)"\\s*:/g) || []).length;
  hits.title = (json.match(/"(?:title|goods_name|product_name)"\\s*:/g) || []).length;
  hits.shop = (json.match(/"(?:shop_name|shopName|shop_name)"\\s*:/g) || []).length;
  return { size: json.length, hits: hits, topKeys: Object.keys(data).slice(0, 20) };
})()`;

const TABS_SRC = `(function () {
  var out = [];
  var els = document.querySelectorAll('div, span, li, a');
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    if (e.children.length > 1) continue;
    var t = (e.textContent || '').trim();
    if (!t || t.length > 6) continue;
    if (/^(综合|AI搜索|图片|视频|直播|用户|商品|小店|商城|购物)$/.test(t)) out.push({ idx: i, tag: e.tagName, cls: String(e.className || '').slice(0, 70), text: t });
  }
  return out;
})()`;

async function run(label, opts, dirName) {
  console.log('\n════════ ' + label + ' ════════');
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', dirName), opts);
  const page = ctx.pages()[0] || (await ctx.newPage());
  const url = 'https://so.douyin.com/s?keyword=' + encodeURIComponent(keyword);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('  goto: ' + String(e.message).slice(0, 70)));
  await sleep(5000);
  for (let i = 0; i < 4; i++) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await sleep(1600);
  }
  console.log('  落地: ' + page.url().slice(0, 130));

  const tabs = await page.evaluate(TABS_SRC).catch(() => []);
  const seen = {};
  const uniq = [];
  tabs.forEach((t) => { if (seen[t.text]) return; seen[t.text] = 1; uniq.push(t); });
  console.log('  tab : ' + uniq.map((t) => t.text).join(' | '));

  const g = await page.evaluate(GLOBALS_SRC).catch((e) => ({ error: e.message }));
  console.log('  内嵌数据: ' + JSON.stringify(g.globals || g.error));
  console.log('  内联脚本: ' + (g.inline || []).length + ' 个匹配  (script 总数 ' + g.scriptCount + ')');
  (g.inline || []).forEach((s) => console.log('      [' + s.idx + '] len=' + s.len + '  ' + s.head.replace(/\s+/g, ' ').slice(0, 120)));

  const ex = await page.evaluate(EXTRACT_SRC).catch((e) => ({ error: e.message }));
  console.log('  字段命中: ' + JSON.stringify(ex));

  await ctx.close().catch(() => {});
  return { label, tabs: uniq, globals: g, extract: ex };
}

(async () => {
  const base = launchOptions();
  const mobile = {
    ...base,
    userAgent: MOBILE_UA,
    viewport: { width: 414, height: 896 },
    isMobile: true,
    hasTouch: true,
  };

  const out = [];
  out.push(await run('已登录 profile + 移动端 UA', mobile, 'douyin'));
  out.push(await run('已登录 profile + 桌面 UA', base, 'douyin'));

  fs.writeFileSync(path.join(paths.ensureDir('probe'), 'douyin-ssr.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n详情：data/probe/douyin-ssr.json');
  process.exit(0);
})();
