'use strict';

/**
 * 抖音电商入口穷举：URL type 参数 + 各商城域名 + 综合 tab 深滚，确认是否有商品数据。
 *   node scripts/probe-douyin-mall.js --keyword=充电器
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
    if (/goods|product|mall|shop|item/i.test(h)) goodsLinks.push(h.slice(0, 120));
  }
  return {
    url: location.href,
    title: document.title,
    priceCount: priceNodes.length,
    priceSample: priceNodes.slice(0, 4),
    goodsLinks: goodsLinks,
    imgCount: document.querySelectorAll('img').length,
    hasLoginWall: /登录后查看|扫码登录/.test(t.slice(0, 2000)),
    textHead: t.replace(/\\s+/g, ' ').trim().slice(0, 260),
  };
})()`;

const URLS = [
  { name: '搜索 type=goods', url: 'https://www.douyin.com/search/' + encodeURIComponent(keyword) + '?type=goods' },
  { name: '搜索 type=product', url: 'https://www.douyin.com/search/' + encodeURIComponent(keyword) + '?type=product' },
  { name: '搜索 type=ecommerce', url: 'https://www.douyin.com/search/' + encodeURIComponent(keyword) + '?type=ecommerce' },
  { name: '搜索 type=shop', url: 'https://www.douyin.com/search/' + encodeURIComponent(keyword) + '?type=shop' },
  { name: '商城 mall.douyin.com', url: 'https://mall.douyin.com/' },
  { name: '商城 mall.douyin.com/search', url: 'https://mall.douyin.com/search?keyword=' + encodeURIComponent(keyword) },
  { name: '商城 www.douyin.com/mall/index', url: 'https://www.douyin.com/mall/index' },
  { name: '电商 haohuo 首页', url: 'https://haohuo.jinritemai.com/' },
  { name: '抖音商城 buyin', url: 'https://buyin.jinritemai.com/' },
];

(async () => {
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'douyin'), launchOptions());
  const page = ctx.pages()[0] || (await ctx.newPage());

  const results = [];
  for (const c of URLS) {
    console.log('\n── ' + c.name + ' ──');
    console.log('   ' + c.url);
    await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 40000 }).catch((e) => console.log('   goto: ' + String(e.message).slice(0, 60)));
    await sleep(4000);
    await page.evaluate('window.scrollTo(0, 1000)').catch(() => {});
    await sleep(1500);
    const ev = await page.evaluate(EVAL_SRC).catch((e) => ({ error: e.message }));
    if (ev.error) { console.log('   ERR ' + ev.error); results.push({ name: c.name, url: c.url, error: ev.error }); continue; }
    console.log('   落地    : ' + ev.url.slice(0, 110));
    console.log('   标题    : ' + ev.title);
    console.log('   价格节点: ' + ev.priceCount + '   商品链接: ' + ev.goodsLinks.length + '   图片: ' + ev.imgCount + '   登录墙: ' + ev.hasLoginWall);
    if (ev.priceCount) ev.priceSample.forEach((p) => console.log('      ' + p.text + '  ← ' + p.chain));
    if (ev.goodsLinks.length) console.log('   链接样例: ' + ev.goodsLinks.slice(0, 3).join('  '));
    console.log('   首屏    : ' + ev.textHead.slice(0, 170));
    results.push({ name: c.name, url: c.url, ev });
  }

  // 综合 tab 深滚，确认是否混有商品
  console.log('\n════ 综合 tab 深滚排查 ════');
  await page.goto('https://www.douyin.com/search/' + encodeURIComponent(keyword), { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  await sleep(4500);
  for (let i = 0; i < 12; i++) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await sleep(1600);
  }
  const deep = await page.evaluate(EVAL_SRC).catch((e) => ({ error: e.message }));
  console.log(JSON.stringify(deep, null, 2).slice(0, 1600));
  results.push({ name: '综合tab深滚', ev: deep });

  fs.writeFileSync(path.join(paths.ensureDir('probe'), 'douyin-mall.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('\n详情：data/probe/douyin-mall.json');
  await ctx.close().catch(() => {});
  process.exit(0);
})();
