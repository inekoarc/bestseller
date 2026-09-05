'use strict';

/**
 * 拼多多移动端 Web（mobile.pinduoduo.com）入口探测。
 *   node scripts/probe-pdd.js --keyword=充电器
 *
 * 目标：确认
 *  1. 哪些搜索入口能落地（登录墙 / 下载引导 / 验证码 / 真实商品流）
 *  2. 数据下发方式（SSR 内嵌 JSON 还是 XHR，是否有 anti-content 签名依赖）
 *  3. 商品卡片的 DOM 形态（选择器、销量文案「已拼X件」等）
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

// 记录页面发出的 XHR/fetch（看数据接口形态与签名参数）
function tapNetwork(page, bucket) {
  page.on('request', (req) => {
    const u = req.url();
    if (/^(xhr|fetch)$/i.test(req.resourceType()) || /search|goods|list|mcs|proxy/i.test(u)) {
      bucket.push({
        url: u.slice(0, 220),
        method: req.method(),
        hasAnti: /anti|sign|captcha/i.test(u + JSON.stringify(req.headers())),
      });
    }
  });
}

const EVAL_SRC = `(function () {
  var t = (document.body ? document.body.innerText : '') || '';
  // 找价格叶子节点
  var priceNodes = [];
  var els = document.querySelectorAll('div, span, p, em, i');
  for (var i = 0; i < els.length && priceNodes.length < 15; i++) {
    if (els[i].children.length) continue;
    var x = (els[i].textContent || '').trim();
    if (/^[¥￥]?\\s?[\\d.]+$/.test(x) && /[\\d]/.test(x)) priceNodes.push(x);
  }
  // 销量文案（拼多多口径：「已拼X件」「已拼X万+件」「X人团」等）
  var sales = [];
  for (var j = 0; j < els.length && sales.length < 12; j++) {
    if (els[j].children.length) continue;
    var s = (els[j].textContent || '').trim();
    if (/已拼|人团|万+件|销量/.test(s) && s.length < 20) sales.push(s);
  }
  // 商品链接
  var links = [];
  var as = document.querySelectorAll('a[href]');
  for (var k = 0; k < as.length && links.length < 12; k++) {
    var h = as[k].getAttribute('href') || '';
    if (/goods|goods_id|pinduoduo|yangkeduo/.test(h)) links.push(h.slice(0, 120));
  }
  // SSR 内嵌数据
  var hasRouterData = false;
  var scriptDataKeys = [];
  var scripts = document.querySelectorAll('script');
  for (var m2 = 0; m2 < scripts.length; m2++) {
    var sc = scripts[m2].textContent || '';
    if (/window\\._|INITIAL_STATE|RENDER_DATA|rawData/.test(sc) && sc.length > 200) {
      hasRouterData = true;
      var mm = sc.match(/window\\.([A-Za-z_$][\\w$]{2,30})\\s*=/);
      if (mm) scriptDataKeys.push(mm[1]);
    }
  }
  return {
    url: location.href,
    title: document.title,
    priceCount: priceNodes.length,
    priceSample: priceNodes.slice(0, 6),
    salesSample: sales,
    goodsLinks: links,
    hasScriptData: hasRouterData,
    scriptDataKeys: scriptDataKeys,
    imgCount: document.querySelectorAll('img').length,
    textHead: t.replace(/\\s+/g, ' ').trim().slice(0, 260),
  };
})()`;

(async () => {
  const base = launchOptions();
  const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  const variants = [
    {
      name: '移动端 UA + iPhone 视口',
      opts: {
        ...base,
        userAgent: MOBILE_UA,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
    { name: '桌面 UA（默认）', opts: { ...base } },
  ];

  const urls = [
    'https://mobile.pinduoduo.com/',
    'https://mobile.pinduoduo.com/goods.html?search_keyword=' + encodeURIComponent(keyword),
    'https://mobile.pinduoduo.com/search_goods.html?search_key=' + encodeURIComponent(keyword),
    'https://mobile.pinduoduo.com/gsearch.html?search_key=' + encodeURIComponent(keyword),
    'https://mobile.yangkeduo.com/search_goods.html?search_key=' + encodeURIComponent(keyword),
  ];

  const results = [];
  for (const v of variants) {
    console.log('\n════ ' + v.name + ' ════');
    const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'pdd-probe'), v.opts);
    const page = ctx.pages()[0] || (await ctx.newPage());
    const net = [];
    tapNetwork(page, net);
    for (const u of urls) {
      console.log('\n  ── ' + u.slice(0, 100));
      await page
        .goto(u, { waitUntil: 'domcontentloaded', timeout: 40000 })
        .catch((e) => console.log('     goto: ' + String(e.message).slice(0, 60)));
      await sleep(5000);
      for (let i = 0; i < 4; i++) {
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
        await sleep(1400);
      }
      const ev = await page.evaluate(EVAL_SRC).catch((e) => ({ error: e.message }));
      if (ev.error) {
        console.log('     ERR ' + ev.error);
        continue;
      }
      console.log('     落地  : ' + ev.url.slice(0, 110));
      console.log('     标题  : ' + ev.title);
      console.log('     价格  : ' + ev.priceCount + ' 个 ' + JSON.stringify(ev.priceSample.slice(0, 4)));
      console.log('     销量  : ' + JSON.stringify(ev.salesSample.slice(0, 6)));
      console.log(
        '     链接  : ' + ev.goodsLinks.length + ' 条 ' + (ev.goodsLinks[0] || '')
      );
      console.log(
        '     内嵌  : ' + (ev.hasScriptData ? '有 ' + ev.scriptDataKeys.join(',') : '无（数据走 XHR）')
      );
      console.log('     首屏  : ' + ev.textHead.slice(0, 150));
      results.push({ variant: v.name, url: u, ev });
    }
    const netSample = net.filter((r, i, a) => a.findIndex((x) => x.url === r.url) === i).slice(0, 20);
    console.log('\n  网络（去重前 20）:');
    for (const r of netSample) console.log('   ' + (r.hasAnti ? '[签名]' : '      ') + ' ' + r.method + ' ' + r.url);
    await ctx.close().catch(() => {});
  }

  fs.writeFileSync(
    path.join(paths.ensureDir('probe'), 'pdd.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );
  console.log('\n详情：data/probe/pdd.json');
  process.exit(0);
})();
