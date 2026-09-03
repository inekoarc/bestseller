'use strict';

/**
 * 京东卡片内部全元素枚举：定位「店铺名」「已售」所在的真实元素。
 *   node scripts/probe-jd3.js --keyword=充电器
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
const platforms = require(path.join(root, 'src', 'collector', 'platforms'));
const { launchOptions } = require(path.join(root, 'src', 'collector', 'browser'));
const paths = require(path.join(root, 'src', 'collector', 'paths'));
const { sleep } = require(path.join(root, 'src', 'collector', 'util'));

const adapter = platforms.get('jd');

const DUMP_SRC = `(function (cardSel) {
  var cards = Array.prototype.slice.call(document.querySelectorAll(cardSel));
  var out = { cardCount: cards.length, cards: [] };
  // 取第 2、3 张（跳过首张广告）
  [1, 2].forEach(function (idx) {
    var c = cards[idx];
    if (!c) return;
    var elems = Array.prototype.slice.call(c.querySelectorAll('*'));
    var list = [];
    for (var i = 0; i < elems.length; i++) {
      var el = elems[i];
      var txt = String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      // 只看自身直接文本（排除子元素干扰）
      var own = '';
      for (var k = 0; k < el.childNodes.length; k++) {
        if (el.childNodes[k].nodeType === 3) own += el.childNodes[k].nodeValue;
      }
      own = own.replace(/\\s+/g, ' ').trim();
      if (!own && !el.getAttribute('data-sku')) continue;
      list.push({
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 100),
        own: own.slice(0, 60),
        sku: el.getAttribute('data-sku') || '',
        href: (el.getAttribute('href') || '').slice(0, 80),
        depth: (function (n) { var d = 0; while (n && n !== c) { d++; n = n.parentElement; } return d; })(el),
      });
    }
    out.cards.push({
      index: idx,
      rootCls: String(c.className || '').slice(0, 120),
      dataSku: c.getAttribute('data-sku'),
      fullText: String(c.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
      elems: list,
    });
  });
  // 全局搜索含「已售」「万+」「+人」文本的元素
  var hits = [];
  var allEls = document.querySelectorAll('div,span,em,i,a,p');
  for (var i = 0; i < allEls.length && hits.length < 40; i++) {
    var el = allEls[i];
    if (el.children.length) continue;
    var t = String(el.textContent || '').trim();
    if (/已售|人付款|万\\+|评价|条评价/.test(t) && t.length < 30) {
      hits.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 90), text: t });
    }
  }
  out.salesHits = hits;
  return out;
})(${JSON.stringify(adapter.selectors.card)})`;

(async () => {
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'jd'), launchOptions());
  const page = ctx.pages()[0] || (await ctx.newPage());

  await page.goto(adapter.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(3000);
  await page.goto(adapter.searchUrl(keyword), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(3000);
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const n = await page
      .evaluate(`(function (s) { try { return document.querySelectorAll(s).length; } catch (e) { return 0; } })(${JSON.stringify(adapter.selectors.card)})`)
      .catch(() => 0);
    if (n >= 5) break;
    await sleep(1500);
  }
  for (let i = 0; i < 8; i++) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await sleep(1200);
  }
  await sleep(1500);

  const r = await page.evaluate(DUMP_SRC).catch((e) => ({ error: e.message }));
  console.log('卡片数：' + r.cardCount);
  if (r.error) { console.log('错误：' + r.error); }

  (r.cards || []).forEach((c) => {
    console.log('\n════ 卡片 #' + c.index + ' ════');
    console.log('rootCls : ' + c.rootCls);
    console.log('data-sku: ' + c.dataSku);
    console.log('fullText: ' + c.fullText);
    console.log('  ── 含文本的后代元素（depth/tag/class/text）──');
    c.elems.forEach((e) => {
      console.log('  d' + String(e.depth).padStart(2) + ' <' + e.tag.toLowerCase() + '> [' + e.cls + ']' + (e.sku ? ' sku=' + e.sku : '') + (e.href ? ' href=' + e.href.slice(0, 40) : '') + ' → ' + e.own);
    });
  });

  console.log('\n════ 全局销量/评价文本命中 ════');
  (r.salesHits || []).forEach((h) => console.log('  <' + h.tag + '> [' + h.cls + '] → ' + h.text));

  fs.writeFileSync(path.join(paths.ensureDir('probe'), 'jd-elems.json'), JSON.stringify(r, null, 2), 'utf8');
  await ctx.close().catch(() => {});
  process.exit(0);
})();
