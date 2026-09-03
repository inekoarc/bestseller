'use strict';

/**
 * 实机探测脚本：打开真实浏览器，dump 三大平台搜索页的 DOM 结构。
 *
 *   node scripts/probe.js --platform=taobao --keyword=充电器
 *   node scripts/probe.js --platform=jd
 *   node scripts/probe.js --platform=douyin
 *
 * 产出：data/probe/<platform>.json  +  控制台摘要
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
const platformId = args.platform || 'taobao';
const keyword = args.keyword || '充电器';
const root = path.join(__dirname, '..');

let chromium;
try {
  ({ chromium } = require(path.join(root, 'node_modules', 'playwright')));
} catch (e) {
  console.error('未安装 playwright：', e.message);
  process.exit(1);
}

const platforms = require(path.join(root, 'src', 'collector', 'platforms'));
const { launchOptions } = require(path.join(root, 'src', 'collector', 'browser'));
const paths = require(path.join(root, 'src', 'collector', 'paths'));
const { grabQR } = require(path.join(root, 'src', 'collector', 'qr'));
const { sleep } = require(path.join(root, 'src', 'collector', 'util'));

const adapter = platforms.get(platformId);
if (!adapter) {
  console.error('未知平台：' + platformId + '，可选：' + platforms.list().map((p) => p.id).join(', '));
  process.exit(1);
}

const KEYWORDS = [
  'card', 'goods', 'item', 'product', 'title', 'name', 'price', 'shop',
  'sales', 'sold', 'img', 'pic', 'commit', 'comment', 'pagination', 'page', 'sort', 'sku',
];

const INVENTORY_SRC = `(function (keywords) {
  var all = document.querySelectorAll('*');
  var counts = {};
  var samples = {};
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var raw = el.className;
    var cls = typeof raw === 'string' ? raw : (raw && raw.baseVal ? raw.baseVal : '');
    if (!cls) continue;
    var parts = cls.split(/\\s+/);
    for (var j = 0; j < parts.length; j++) {
      var c = parts[j];
      if (!c) continue;
      var lc = c.toLowerCase();
      for (var k = 0; k < keywords.length; k++) {
        if (lc.indexOf(keywords[k].toLowerCase()) >= 0) {
          counts[c] = (counts[c] || 0) + 1;
          if (!samples[c]) samples[c] = String(el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
          break;
        }
      }
    }
  }
  var arr = Object.keys(counts).map(function (c) { return { cls: c, n: counts[c], sample: samples[c] }; });
  arr.sort(function (a, b) { return b.n - a.n; });
  return arr.slice(0, 150);
})(${JSON.stringify(KEYWORDS)})`;

const DUMP_CARD_SRC = `(function (cardSel) {
  var cards = document.querySelectorAll(cardSel);
  if (!cards.length) return null;
  var c = cards[0];
  return {
    tag: c.tagName,
    cls: String(c.className || ''),
    attrs: Array.prototype.slice.call(c.attributes).map(function (a) { return a.name + '=' + String(a.value).slice(0, 60); }).slice(0, 24),
    text: String(c.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400),
    imgs: Array.prototype.slice.call(c.querySelectorAll('img')).slice(0, 3).map(function (im) {
      return { src: (im.getAttribute('src') || '').slice(0, 160), dataSrc: (im.getAttribute('data-src') || im.getAttribute('data-lazy-img') || '').slice(0, 160), cls: String(im.className || '').slice(0, 60) };
    }),
    links: Array.prototype.slice.call(c.querySelectorAll('a[href]')).slice(0, 4).map(function (a) { return (a.getAttribute('href') || '').slice(0, 160); }),
    html: c.outerHTML.slice(0, 3000)
  };
})(${JSON.stringify(adapter.selectors.card)})`;

const PAGINATION_SRC = `(function () {
  var out = [];
  var sels = ['.next-pagination', '#J_topPage', '.p-wrap', '.ui-page', '[class*="pagination"]', '[class*="Pagination"]'];
  for (var i = 0; i < sels.length; i++) {
    var el = document.querySelector(sels[i]);
    if (!el) continue;
    out.push({ sel: sels[i], cls: String(el.className || '').slice(0, 80), text: String(el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120) });
  }
  return out;
})()`;

const SORT_TABS_SRC = `(function () {
  var els = document.querySelectorAll('li, div, span, a, em');
  var out = [];
  for (var i = 0; i < els.length && out.length < 60; i++) {
    var t = (els[i].textContent || '').trim();
    if (!t || t.length > 8) continue;
    if (/^(综合|销量|人气|价格|新品|评论|信用)/.test(t)) out.push({ tag: els[i].tagName, cls: String(els[i].className || '').slice(0, 80), text: t });
  }
  return out;
})()`;

async function ensureLogin(ctx, page) {
  console.log('→ 打开首页检测登录态：' + adapter.homeUrl);
  await page.goto(adapter.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(3000);

  let loggedIn = await page.evaluate(adapter.isLoggedInSrc).catch(() => false);
  if (loggedIn) {
    console.log('✓ 已登录（复用本地登录态）');
    return true;
  }

  console.log('→ 未登录，打开登录页：' + adapter.loginUrl);
  await page.goto(adapter.loginUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await sleep(2000);

  const qr = await grabQR(page, 20000);
  if (qr) {
    const outDir = paths.ensureDir('probe');
    const file = path.join(outDir, platformId + '-qrcode.png');
    fs.writeFileSync(file, qr.buffer);
    console.log('\n========================================');
    console.log('  请用 APP 扫码登录：' + file);
    console.log('  （二维码已存为图片，直接用手机扫这张图）');
    console.log('========================================\n');
  } else {
    console.log('! 未能自动定位二维码，请在弹出的浏览器窗口中手动扫码');
  }

  const deadline = Date.now() + 180000;
  let lastQrAt = Date.now();
  while (Date.now() < deadline) {
    await sleep(2000);
    loggedIn = await page.evaluate(adapter.isLoggedInSrc).catch(() => false);
    const url = page.url();
    if (loggedIn || (!/login|passport/i.test(url) && url !== 'about:blank')) {
      // 二次确认：跳回首页再看一次
      await page.goto(adapter.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await sleep(2500);
      loggedIn = await page.evaluate(adapter.isLoggedInSrc).catch(() => false);
      if (loggedIn) {
        console.log('✓ 登录成功');
        return true;
      }
    }
    // 二维码过期则刷新
    if (Date.now() - lastQrAt > 60000) {
      const qr2 = await grabQR(page, 5000);
      if (qr2) {
        const file = path.join(paths.ensureDir('probe'), platformId + '-qrcode.png');
        fs.writeFileSync(file, qr2.buffer);
        console.log('↻ 二维码已刷新：' + file);
      }
      lastQrAt = Date.now();
    }
  }
  console.log('✗ 等待扫码超时');
  return false;
}

async function scrollPage(page) {
  await page.evaluate(`(function () { window.scrollTo(0, document.body.scrollHeight); })()`).catch(() => {});
  await sleep(1200);
  await page.evaluate(`(function () { window.scrollTo(0, document.body.scrollHeight / 2); })()`).catch(() => {});
  await sleep(800);
  await page.evaluate(`(function () { window.scrollTo(0, document.body.scrollHeight); })()`).catch(() => {});
  await sleep(1500);
}

async function probeSearchUrl(page, url) {
  console.log('→ 访问：' + url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('  goto 警告: ' + e.message.slice(0, 80)));
  await sleep(2500);

  // 等卡片渲染（淘宝首屏真实卡片要 20~30s）
  const t0 = Date.now();
  let cardCount = 0;
  while (Date.now() - t0 < adapter.firstRenderTimeout || 0) {
    cardCount = await page.evaluate(adapter.waitCardsSrc(1)).catch(() => 0);
    const n = await page
      .evaluate(`(function (s) { try { return document.querySelectorAll(s).length; } catch (e) { return 0; } })(${JSON.stringify(adapter.selectors.card)})`)
      .catch(() => 0);
    cardCount = n;
    if (n >= 5) break;
    await sleep(1500);
  }
  await scrollPage(page);
  await sleep(1500);

  const finalCount = await page
    .evaluate(`(function (s) { try { return document.querySelectorAll(s).length; } catch (e) { return 0; } })(${JSON.stringify(adapter.selectors.card)})`)
    .catch(() => 0);

  return { url: page.url(), cardCount: finalCount };
}

(async () => {
  const userDataDir = paths.ensureDir('pw-data', platformId);
  console.log('=== 探测平台：' + adapter.name + '（' + adapter.id + '）===');
  console.log('登录态目录：' + userDataDir);

  const ctx = await chromium.launchPersistentContext(userDataDir, launchOptions());
  const page = ctx.pages()[0] || (await ctx.newPage());

  const report = {
    platform: adapter.id,
    name: adapter.name,
    keyword,
    probedAt: new Date().toISOString(),
    currentSelectors: adapter.selectors,
  };

  try {
    report.loggedIn = await ensureLogin(ctx, page);

    const urlsToTry =
      adapter.id === 'douyin' && adapter.candidateSearchUrls
        ? adapter.candidateSearchUrls(keyword)
        : [adapter.searchUrl(keyword)];

    const attempts = [];
    for (const u of urlsToTry) {
      const r = await probeSearchUrl(page, u);
      attempts.push(r);
      console.log('  卡片数：' + r.cardCount);
      if (r.cardCount >= 5) {
        report.workingSearchUrl = u;
        break;
      }
    }
    report.searchUrlAttempts = attempts;

    const cardCount = attempts.reduce((m, a) => Math.max(m, a.cardCount), 0);
    report.cardCount = cardCount;

    if (cardCount > 0) {
      report.url = page.url();
      report.title = await page.title().catch(() => '');
      report.inventory = await page.evaluate(INVENTORY_SRC).catch(() => []);
      report.firstCard = await page.evaluate(DUMP_CARD_SRC).catch(() => null);
      report.pagination = await page.evaluate(PAGINATION_SRC).catch(() => []);
      report.sortTabs = await page.evaluate(SORT_TABS_SRC).catch(() => []);
      const parsed = await page.evaluate(adapter.parseSrc()).catch(() => []);
      report.parsedSample = (parsed || []).slice(0, 5);
      report.parsedCount = (parsed || []).length;
      report.parseQuality = score(parsed || []);
      report.riskHit = await page.evaluate(adapter.riskSrc()).catch(() => '');
    } else {
      report.url = page.url();
      report.note = '未找到商品卡片，可能未登录 / 选择器失效 / 页面结构不同';
      report.inventory = await page.evaluate(INVENTORY_SRC).catch(() => []);
      report.riskHit = await page.evaluate(adapter.riskSrc()).catch(() => '');
    }
  } catch (e) {
    report.error = e && e.stack ? e.stack.slice(0, 2000) : String(e);
  }

  const outDir = paths.ensureDir('probe');
  const outFile = path.join(outDir, adapter.id + '.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');

  printSummary(report);
  console.log('\n完整报告：' + outFile);

  if (!process.env.PROBE_KEEP_OPEN) {
    await sleep(1000);
    await ctx.close().catch(() => {});
  }
  process.exit(0);
})();

function score(rows) {
  const n = rows.length || 1;
  const f = (k) => Math.round((rows.filter((r) => r && r[k]).length / n) * 100);
  return {
    total: rows.length,
    idPct: f('id'),
    titlePct: f('title'),
    shopPct: f('shop'),
    pricePct: f('price'),
    salesTextPct: f('salesText'),
    linkPct: f('link'),
    imageUrlPct: f('imageUrl'),
  };
}

function printSummary(r) {
  console.log('\n──────── 探测摘要 ────────');
  console.log('登录态      : ' + (r.loggedIn ? '已登录' : '未登录'));
  console.log('可用搜索URL : ' + (r.workingSearchUrl || '无'));
  console.log('卡片数      : ' + r.cardCount);
  if (r.error) console.log('错误        : ' + String(r.error).slice(0, 300));
  if (r.riskHit) console.log('⚠ 风控命中  : ' + r.riskHit);
  if (r.parseQuality) {
    console.log('解析覆盖    : ' + JSON.stringify(r.parseQuality));
  }
  if (r.parsedSample && r.parsedSample.length) {
    console.log('\n首条样本：');
    console.log(JSON.stringify(r.parsedSample[0], null, 2));
  }
  if (r.firstCard) {
    console.log('\n首个卡片 class：' + r.firstCard.cls);
    console.log('卡片链接：' + JSON.stringify(r.firstCard.links, null, 1));
    console.log('卡片图片：' + JSON.stringify(r.firstCard.imgs, null, 1));
  }
  if (r.sortTabs && r.sortTabs.length) {
    console.log('\n排序页签候选：' + r.sortTabs.map((s) => s.text).join(' | '));
  }
  console.log('──────────────────────────');
}
