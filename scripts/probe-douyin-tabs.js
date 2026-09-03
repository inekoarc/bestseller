'use strict';

/**
 * 抖音搜索页 tab 探测：列出所有搜索 tab，逐个点击，看哪个能渲染出商品卡片（含价格节点）。
 *   node scripts/probe-douyin-tabs.js --keyword=充电器
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

const TABS_SRC = `(function () {
  var out = [];
  var els = document.querySelectorAll('div, span, li, a, p, em');
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    if (e.children.length > 1) continue;
    var t = (e.textContent || '').trim();
    if (!t || t.length > 6) continue;
    if (!/^(综合|视频|商品|用户|直播|音乐|话题|团购|小店|商城|购物|相关搜索)/.test(t)) continue;
    out.push({ tag: e.tagName, cls: String(e.className || '').slice(0, 80), text: t, idx: i });
  }
  return out;
})()`;

const EVAL_SRC = `(function () {
  var t = (document.body ? document.body.innerText : '') || '';
  var priceNodes = [];
  var els = document.querySelectorAll('div, span, p, em, i');
  for (var i = 0; i < els.length && priceNodes.length < 20; i++) {
    if (els[i].children.length) continue;
    var x = (els[i].textContent || '').trim();
    if (/^[¥￥]\\s?[\\d.]+$/.test(x)) {
      var p = els[i];
      var chain = [];
      for (var d = 0; d < 6 && p; d++) { chain.push(p.tagName.toLowerCase() + '.' + String(p.className || '').split(/\\s+/)[0]); p = p.parentElement; }
      priceNodes.push({ text: x, chain: chain.join(' < ') });
    }
  }
  var goodsLinks = [];
  var as = document.querySelectorAll('a[href]');
  for (var j = 0; j < as.length && goodsLinks.length < 12; j++) {
    var h = as[j].getAttribute('href') || '';
    if (/goods|product|mall|shop/i.test(h)) goodsLinks.push(h.slice(0, 120));
  }
  // 销量文案
  var salesHits = [];
  for (var k = 0; k < els.length && salesHits.length < 15; k++) {
    if (els[k].children.length) continue;
    var s = (els[k].textContent || '').trim();
    if (/已售|已卖|人付款|销量|万\\+|件/.test(s) && s.length < 20) salesHits.push(s);
  }
  return {
    url: location.href,
    priceCount: priceNodes.length,
    priceSample: priceNodes.slice(0, 5),
    goodsLinks: goodsLinks,
    salesHits: salesHits,
    imgCount: document.querySelectorAll('img').length,
    textHead: t.replace(/\\s+/g, ' ').trim().slice(0, 200),
  };
})()`;

(async () => {
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'douyin'), launchOptions());
  const page = ctx.pages()[0] || (await ctx.newPage());

  const base = 'https://www.douyin.com/search/' + encodeURIComponent(keyword);
  console.log('搜索页：' + base);
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await sleep(5000);

  const tabs = await page.evaluate(TABS_SRC).catch(() => []);
  console.log('\n发现 tab（' + tabs.length + '）：');
  tabs.forEach((t) => console.log('  [' + t.idx + '] ' + t.tag + ' "' + t.text + '"  cls=' + t.cls));

  const uniq = [];
  const seen = {};
  tabs.forEach((t) => {
    if (seen[t.text]) return;
    seen[t.text] = 1;
    uniq.push(t);
  });

  const results = [];
  for (const t of uniq) {
    if (!/商品|商城|购物|小店|团购/.test(t.text)) continue;
    console.log('\n── 点击 tab「' + t.text + '」──');
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(4000);
    const clicked = await page
      .evaluate(
        `(function (idx) {
          var els = document.querySelectorAll('div, span, li, a, p, em');
          var e = els[idx];
          if (!e) return false;
          e.click();
          return true;
        })(${t.idx})`
      )
      .catch(() => false);
    console.log('   点击结果：' + clicked);
    if (!clicked) continue;

    await sleep(5000);
    for (let i = 0; i < 5; i++) {
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
      await sleep(1500);
    }

    const ev = await page.evaluate(EVAL_SRC).catch((e) => ({ error: e.message }));
    if (ev.error) { console.log('   ERR ' + ev.error); continue; }
    console.log('   URL       : ' + ev.url.slice(0, 120));
    console.log('   价格节点  : ' + ev.priceCount + ' 个   图片数: ' + ev.imgCount);
    ev.priceSample.forEach((p) => console.log('      ' + p.text + '  ← ' + p.chain));
    console.log('   商品链接  : ' + (ev.goodsLinks.length ? ev.goodsLinks.slice(0, 4).join('\n                ') : '无'));
    console.log('   销量文案  : ' + (ev.salesHits.length ? ev.salesHits.slice(0, 8).join(' | ') : '无'));
    console.log('   首屏文本  : ' + ev.textHead.slice(0, 160));
    results.push({ tab: t.text, ...ev });
  }

  fs.writeFileSync(path.join(paths.ensureDir('probe'), 'douyin-tabs.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('\n详情：data/probe/douyin-tabs.json');
  await ctx.close().catch(() => {});
  process.exit(0);
})();
