'use strict';

/**
 * 京东排序方案探测：URL 参数 psort vs 点击页签，哪个真正生效。
 *   node scripts/probe-jd-sort.js --keyword=充电器
 */

const path = require('path');
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

// 取前 10 张卡片的销量数字，用于判断排序是否生效
const SALES_LIST_SRC = `(function (cardSel) {
  var cards = document.querySelectorAll(cardSel);
  var out = [];
  for (var i = 0; i < cards.length && out.length < 12; i++) {
    var c = cards[i];
    var els = c.querySelectorAll('span, div, em, i');
    var s = '';
    for (var k = 0; k < els.length; k++) {
      if (els[k].children.length) continue;
      var t = String(els[k].textContent || '').trim();
      if (/^已售/.test(t)) { s = t; break; }
    }
    out.push(s || '(无)');
  }
  return out;
})(${JSON.stringify(adapter.selectors.card)})`;

const ACTIVE_TAB_SRC = `(function () {
  var out = [];
  var els = document.querySelectorAll('li, div, span, a, em');
  for (var i = 0; i < els.length && out.length < 20; i++) {
    var e = els[i];
    var t = (e.textContent || '').trim();
    if (t !== '销量' && t !== '综合') continue;
    if (e.children.length > 2) continue;
    out.push({ text: t, cls: String(e.className || '').slice(0, 90), parentCls: String(e.parentElement ? e.parentElement.className : '').slice(0, 90) });
  }
  return out;
})()`;

async function waitCards(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    const n = await page
      .evaluate(`(function (s) { try { return document.querySelectorAll(s).length; } catch (e) { return 0; } })(${JSON.stringify(adapter.selectors.card)})`)
      .catch(() => 0);
    if (n >= 5) break;
    await sleep(1500);
  }
  for (let i = 0; i < 6; i++) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await sleep(1100);
  }
  await sleep(1200);
}

(async () => {
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'jd'), launchOptions());
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(adapter.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(3000);

  // ── 方案 A：URL 参数 psort=3
  console.log('\n════ 方案 A：URL 参数 psort=3 ════');
  const urlA = 'https://search.jd.com/Search?keyword=' + encodeURIComponent(keyword) + '&enc=utf-8&psort=3';
  await page.goto(urlA, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(2500);
  await waitCards(page);
  console.log('URL   : ' + page.url());
  console.log('活跃页签: ' + JSON.stringify(await page.evaluate(ACTIVE_TAB_SRC).catch(() => [])));
  console.log('销量序列: ' + JSON.stringify(await page.evaluate(SALES_LIST_SRC).catch(() => []), null, 0));

  // ── 方案 B：点击「销量」页签
  console.log('\n════ 方案 B：点击「销量」页签 ════');
  await page.goto(adapter.searchUrl(keyword), { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(2500);
  await waitCards(page);
  console.log('点击前 URL: ' + page.url());
  console.log('点击前销量: ' + JSON.stringify(await page.evaluate(SALES_LIST_SRC).catch(() => [])));

  const clicked = await page.evaluate(`(function () {
    var els = document.querySelectorAll('li, div, span, a, em');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if ((e.textContent || '').trim() !== '销量') continue;
      if (e.children.length > 2) continue;
      e.click();
      return { ok: true, cls: String(e.className || ''), parentCls: String(e.parentElement ? e.parentElement.className : '') };
    }
    return { ok: false };
  })()`).catch(() => ({ ok: false }));
  console.log('点击结果: ' + JSON.stringify(clicked));

  await sleep(5000);
  await waitCards(page);
  console.log('点击后 URL: ' + page.url());
  console.log('点击后销量: ' + JSON.stringify(await page.evaluate(SALES_LIST_SRC).catch(() => [])));

  await ctx.close().catch(() => {});
  process.exit(0);
})();
