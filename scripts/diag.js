'use strict';

/**
 * 诊断脚本：逐秒采样搜索页状态，看商品卡究竟有没有渲染、卡在哪一步。
 *   node scripts/diag.js --platform=taobao --keyword=充电器
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');

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

const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const platforms = require(path.join(ROOT, 'src', 'collector', 'platforms'));
const { launchOptions } = require(path.join(ROOT, 'src', 'collector', 'browser'));
const paths = require(path.join(ROOT, 'src', 'collector', 'paths'));
const { sleep } = require(path.join(ROOT, 'src', 'collector', 'util'));

const adapter = platforms.get(platformId);

const SAMPLE_SRC = `(function () {
  function cnt(s) { try { return document.querySelectorAll(s).length; } catch (e) { return -1; } }
  var body = document.body ? document.body.innerText : '';
  return {
    url: location.href.slice(0, 120),
    textLen: body.length,
    links: cnt('a[href*="item.taobao.com"], a[href*="detail.tmall.com"]'),
    bone: cnt('[class*="boneClass"]'),
    cards: cnt('div[class*="card--"]'),
    imgs: cnt('img'),
    bodyHead: body.replace(/\\s+/g, ' ').slice(0, 300)
  };
})()`;

(async () => {
  const userDataDir = paths.ensureDir('pw-data', platformId);
  const ctx = await chromium.launchPersistentContext(userDataDir, launchOptions());
  const page = ctx.pages()[0] || (await ctx.newPage());

  page.on('console', (m) => {
    if (/error|Error/.test(m.text())) console.log('  [page-error]', m.text().slice(0, 160));
  });
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e.message).slice(0, 200)));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (/wsearch|mtop|search/i.test(u)) console.log('  [req-fail]', u.slice(0, 120), r.failure() ? r.failure().errorText : '');
  });

  // 响应里找商品数据接口
  const apiHits = [];
  page.on('response', async (resp) => {
    const u = resp.url();
    if (/mtop|wsearch|h5api|search/i.test(u)) {
      apiHits.push({ url: u.slice(0, 130), status: resp.status(), ct: (resp.headers()['content-type'] || '').slice(0, 40) });
    }
  });

  console.log('=== 诊断：' + adapter.name + ' / ' + keyword + ' ===');
  const url = adapter.searchUrl(keyword);
  console.log('目标 URL：' + url);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', e.message.slice(0, 80)));

  for (let t = 0; t < 24; t++) {
    const s = await page.evaluate(SAMPLE_SRC).catch((e) => ({ err: e.message.slice(0, 80) }));
    console.log(
      't=' + String(t * 5).padStart(3) + 's',
      'links=' + String(s.links).padStart(4),
      'bone=' + String(s.bone).padStart(4),
      'cards=' + String(s.cards).padStart(4),
      'imgs=' + String(s.imgs).padStart(4),
      'textLen=' + String(s.textLen).padStart(6)
    );
    if (t === 3) {
      // 中途尝试：滚动
      console.log('  → 尝试滚动到底');
      await page.evaluate('(function(){ window.scrollTo(0, document.body.scrollHeight); })()').catch(() => {});
    }
    if (t === 8) {
      console.log('  → 尝试点击「综合」页签');
      const r = await page.evaluate(`(function(){ var els = document.querySelectorAll('li,div,span,a,em'); for (var i=0;i<els.length;i++){ if ((els[i].textContent||'').trim()==='综合') { els[i].click(); return true; } } return false; })()`).catch(() => false);
      console.log('     点击结果:', r);
    }
    if (t === 12) {
      console.log('  → 尝试点击「销量」页签');
      const r = await page.evaluate(`(function(){ var els = document.querySelectorAll('li,div,span,a,em'); for (var i=0;i<els.length;i++){ if ((els[i].textContent||'').trim()==='销量') { els[i].click(); return true; } } return false; })()`).catch(() => false);
      console.log('     点击结果:', r);
    }
    if (t === 16) {
      console.log('  → 尝试刷新页面');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }
    if (s.links >= 5) {
      console.log('  ✓ 出现 ' + s.links + ' 个商品链接');
      break;
    }
    await sleep(5000);
  }

  const final = await page.evaluate(SAMPLE_SRC).catch(() => null);
  console.log('\n--- 最终状态 ---');
  console.log(JSON.stringify(final, null, 2));

  console.log('\n--- 命中的接口 (' + apiHits.length + ') ---');
  apiHits.slice(0, 20).forEach((h) => console.log(' ', h.status, h.ct, h.url));

  // 截图存档
  const shot = path.join(paths.ensureDir('probe'), platformId + '-diag.png');
  await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
  console.log('\n截图：' + shot);

  await ctx.close().catch(() => {});
  process.exit(0);
})();