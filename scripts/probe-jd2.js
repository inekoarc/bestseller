'use strict';

/**
 * 京东新版搜索页定向探测：在卡片内部逐字段验证候选选择器命中率。
 *   node scripts/probe-jd2.js --keyword=充电器
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

// 候选选择器逐条测命中率（限定在卡片内）
const CANDIDATES = {
  id: [
    '[data-sku]',
  ],
  title: [
    '[class*="goods_title_container"] span',
    '[class*="goods_title_container"]',
    'span[class*="_newStyle_"]',
    '[title]',
  ],
  price: [
    '[class*="_price_"]',
    'span[class*="price"]',
    '[class*="Price"]',
  ],
  shop: [
    '[class*="shopName"]',
    '[class*="shop_name"]',
    'a[href*="mall.jd.com"]',
    '[class*="_shop"]',
    '[class*="storeName"]',
    '[class*="store"]',
  ],
  sales: [
    '[class*="sales"]',
    '[class*="Sales"]',
    '[class*="sold"]',
    '[class*="comment"]',
    '[class*="Comment"]',
    '[class*="evaluate"]',
  ],
  link: [
    'a[href*="item.jd.com"]',
    'a[href*="item.jd.hk"]',
    'a[href]',
  ],
  img: [
    'img[data-src]',
    'div[class*="bannerPicBox"] img',
    'img[class*="_img_"]',
    'img',
  ],
};

const PROBE_SRC = `(function (cands, cardSel) {
  var cards = Array.prototype.slice.call(document.querySelectorAll(cardSel));
  var out = { cardCount: cards.length, hits: {}, samples: {}, allText: '' };
  Object.keys(cands).forEach(function (field) {
    cands[field].forEach(function (sel) {
      var hit = 0;
      var sample = null;
      for (var i = 0; i < cards.length; i++) {
        var el = cards[i].querySelector(sel);
        if (!el) continue;
        hit++;
        if (!sample) {
          sample = {
            tag: el.tagName,
            cls: String(el.className || '').slice(0, 90),
            attr: el.getAttribute('data-sku') || el.getAttribute('data-src') || el.getAttribute('href') || '',
            text: String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
          };
        }
      }
      var key = field + ' >> ' + sel;
      out.hits[key] = hit;
      if (sample) out.samples[key] = sample;
    });
  });
  if (cards[0]) out.allText = String(cards[0].innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 500);
  return out;
})(${JSON.stringify(CANDIDATES)}, ${JSON.stringify(adapter.selectors.card)})`;

const PAGINATION_SRC = `(function () {
  var out = [];
  var sels = ['[class*="pagination"]', '[class*="Pagination"]', '#J_topPage', '.p-wrap', '.ui-page', '[class*="_page"]'];
  for (var i = 0; i < sels.length; i++) {
    var el = document.querySelector(sels[i]);
    if (!el) continue;
    out.push({ sel: sels[i], cls: String(el.className || '').slice(0, 80), text: String(el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100) });
  }
  return out;
})()`;

(async () => {
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'jd'), launchOptions());
  const page = ctx.pages()[0] || (await ctx.newPage());

  // 先访问首页预热登录态 cookie，再进搜索页（直接进搜索页有时不渲染卡片）
  console.log('预热：' + adapter.homeUrl);
  await page.goto(adapter.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(3000);
  console.log('登录态：' + (await page.evaluate(adapter.isLoggedInSrc).catch(() => 'ERR')));

  const url = adapter.searchUrl(keyword);
  console.log('访问：' + url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(3000);

  // 等卡片渲染
  let n = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    n = await page
      .evaluate(`(function (s) { try { return document.querySelectorAll(s).length; } catch (e) { return 0; } })(${JSON.stringify(adapter.selectors.card)})`)
      .catch(() => 0);
    if (n >= 5) break;
    await sleep(1500);
  }
  console.log('等待渲染：' + n + ' 张卡片（' + Math.round((Date.now() - t0) / 1000) + 's）');
  console.log('页面标题：' + (await page.title().catch(() => '')));
  console.log('当前URL ：' + page.url());
  console.log('风控命中：' + (await page.evaluate(adapter.riskSrc()).catch(() => '') || '无'));

  // 分段滚动触发懒加载
  for (let i = 0; i < 10; i++) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await sleep(1200);
  }
  await sleep(2000);

  const r = await page.evaluate(PROBE_SRC).catch((e) => ({ error: e.message }));
  console.log('卡片数：' + r.cardCount);
  if (r.error) console.log('错误：' + r.error);

  console.log('\n── 选择器命中率 ──');
  Object.keys(r.hits || {}).forEach((k) => {
    const n = r.hits[k];
    const pct = r.cardCount ? Math.round((n / r.cardCount) * 100) : 0;
    const bar = pct === 100 ? '✓' : pct >= 80 ? '~' : '✗';
    console.log('  ' + bar + ' ' + String(n).padStart(3) + '/' + r.cardCount + ' (' + String(pct).padStart(3) + '%)  ' + k);
  });

  console.log('\n── 命中样本 ──');
  Object.keys(r.samples || {}).forEach((k) => {
    const s = r.samples[k];
    console.log('  ' + k);
    console.log('      tag=' + s.tag + '  cls=' + s.cls);
    if (s.attr) console.log('      attr=' + s.attr.slice(0, 100));
    if (s.text) console.log('      text=' + s.text);
  });

  console.log('\n── 首卡全文 ──');
  console.log('  ' + (r.allText || ''));

  const pag = await page.evaluate(PAGINATION_SRC).catch(() => []);
  console.log('\n── 分页器 ──');
  pag.forEach((p) => console.log('  ' + p.sel + '  [' + p.cls + ']  ' + p.text));

  const outFile = path.join(paths.ensureDir('probe'), 'jd-detailed.json');
  fs.writeFileSync(outFile, JSON.stringify(r, null, 2), 'utf8');
  console.log('\n详情：' + outFile);

  await ctx.close().catch(() => {});
  process.exit(0);
})();
