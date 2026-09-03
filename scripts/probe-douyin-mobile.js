'use strict';

/**
 * 抖音最后尝试：移动端 UA 模拟，看是否能拿到商品搜索结果。
 *   node scripts/probe-douyin-mobile.js --keyword=充电器
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
const { chromium, devices } = require(path.join(root, 'node_modules', 'playwright'));
const { launchOptions } = require(path.join(root, 'src', 'collector', 'browser'));
const paths = require(path.join(root, 'src', 'collector', 'paths'));
const { sleep } = require(path.join(root, 'src', 'collector', 'util'));

const EVAL_SRC = `(function () {
  var t = (document.body ? document.body.innerText : '') || '';
  var priceNodes = [];
  var els = document.querySelectorAll('div, span, p, em, i');
  for (var i = 0; i < els.length && priceNodes.length < 15; i++) {
    if (els[i].children.length) continue;
    var x = (els[i].textContent || '').trim();
    if (/^[¥￥]\\s?[\\d.]+$/.test(x)) priceNodes.push(x);
  }
  var tabs = [];
  for (var j = 0; j < els.length && tabs.length < 15; j++) {
    if (els[j].children.length) continue;
    var s = (els[j].textContent || '').trim();
    if (!s || s.length > 5) continue;
    if (/^(综合|视频|商品|用户|直播|小店|商城|购物)$/.test(s)) tabs.push(s);
  }
  return {
    url: location.href,
    title: document.title,
    priceCount: priceNodes.length,
    priceSample: priceNodes.slice(0, 6),
    tabs: tabs,
    imgCount: document.querySelectorAll('img').length,
    textHead: t.replace(/\\s+/g, ' ').trim().slice(0, 220),
  };
})()`;

(async () => {
  const base = launchOptions();
  const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  const variants = [
    {
      name: '移动端 UA + iPhone 视口',
      opts: { ...base, userAgent: MOBILE_UA, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
    },
    {
      name: '移动端 UA（桌面视口）',
      opts: { ...base, userAgent: MOBILE_UA },
    },
  ];

  const urls = [
    'https://www.douyin.com/search/' + encodeURIComponent(keyword),
    'https://www.douyin.com/search/' + encodeURIComponent(keyword) + '?type=general',
    'https://mall.douyin.com/',
  ];

  const results = [];
  for (const v of variants) {
    console.log('\n════ ' + v.name + ' ════');
    const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'douyin-mobile'), v.opts);
    const page = ctx.pages()[0] || (await ctx.newPage());
    for (const u of urls) {
      console.log('\n  ── ' + u.slice(0, 90));
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch((e) => console.log('     goto: ' + String(e.message).slice(0, 60)));
      await sleep(4500);
      for (let i = 0; i < 4; i++) {
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
        await sleep(1500);
      }
      const ev = await page.evaluate(EVAL_SRC).catch((e) => ({ error: e.message }));
      if (ev.error) { console.log('     ERR ' + ev.error); continue; }
      console.log('     落地  : ' + ev.url.slice(0, 100));
      console.log('     标题  : ' + ev.title);
      console.log('     tab   : ' + (ev.tabs.join(' | ') || '无'));
      console.log('     价格  : ' + ev.priceCount + ' 个 ' + (ev.priceSample.length ? JSON.stringify(ev.priceSample) : '') + '   图片: ' + ev.imgCount);
      console.log('     首屏  : ' + ev.textHead.slice(0, 140));
      results.push({ variant: v.name, url: u, ev });
    }
    await ctx.close().catch(() => {});
  }

  fs.writeFileSync(path.join(paths.ensureDir('probe'), 'douyin-mobile.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('\n详情：data/probe/douyin-mobile.json');
  process.exit(0);
})();
