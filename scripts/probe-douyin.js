'use strict';

/**
 * 抖音商城可行性探测：
 *   1) 未登录状态下各搜索入口是否能渲染商品卡片
 *   2) 登录弹层如何触发、二维码在哪
 *   3) 若登录，重新检查商品卡片
 *
 *   node scripts/probe-douyin.js --keyword=充电器 [--login]
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
const doLogin = !!args.login;
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright'));
const { launchOptions } = require(path.join(root, 'src', 'collector', 'browser'));
const paths = require(path.join(root, 'src', 'collector', 'paths'));
const { sleep } = require(path.join(root, 'src', 'collector', 'util'));

const CANDIDATES = [
  { name: '抖音搜索-综合', url: 'https://www.douyin.com/search/' + encodeURIComponent(keyword) },
  { name: '抖音搜索-商品', url: 'https://www.douyin.com/search/' + encodeURIComponent(keyword) + '?type=general' },
  { name: '抖音商城-首页', url: 'https://www.douyin.com/mall' },
  { name: '好物街', url: 'https://haohuo.jinritemai.com/views/product/list?q=' + encodeURIComponent(keyword) },
  { name: '抖音商城搜索', url: 'https://mall.douyin.com/search?keyword=' + encodeURIComponent(keyword) },
];

// 通用的「页面状态」快照
const SNAP_SRC = `(function () {
  var t = (document.body ? document.body.innerText : '') || '';
  return {
    url: location.href,
    title: document.title,
    textHead: t.replace(/\\s+/g, ' ').trim().slice(0, 300),
    hasLoginWall: /登录|扫码|验证/.test(t.slice(0, 3000)),
    loginBtns: (function () {
      var out = [];
      var els = document.querySelectorAll('button, div, span, a, p');
      for (var i = 0; i < els.length && out.length < 20; i++) {
        var x = (els[i].textContent || '').trim();
        if (!x || x.length > 12) continue;
        if (/登录|扫码/.test(x) && !els[i].children.length) {
          out.push({ tag: els[i].tagName, cls: String(els[i].className || '').slice(0, 70), text: x });
        }
      }
      return out;
    })(),
    imgs: (function () {
      var out = [];
      var im = document.querySelectorAll('img');
      for (var i = 0; i < im.length && out.length < 8; i++) {
        out.push((im[i].getAttribute('src') || '').slice(0, 110));
      }
      return out;
    })(),
    imgCount: document.querySelectorAll('img').length,
    // 疑似商品卡片：含价格符号的容器
    priceNodes: (function () {
      var out = [];
      var els = document.querySelectorAll('div, span, p, em, i');
      for (var i = 0; i < els.length && out.length < 15; i++) {
        if (els[i].children.length) continue;
        var x = (els[i].textContent || '').trim();
        if (/^[¥￥]\\s?[\\d.]+$/.test(x)) {
          var p = els[i];
          var chain = [];
          for (var d = 0; d < 5 && p; d++) { chain.push(p.tagName.toLowerCase() + '.' + String(p.className || '').split(/\\s+/)[0]); p = p.parentElement; }
          out.push({ text: x, chain: chain.join(' < ') });
        }
      }
      return out;
    })(),
    goodsLinks: (function () {
      var out = [];
      var as = document.querySelectorAll('a[href]');
      for (var i = 0; i < as.length && out.length < 12; i++) {
        var h = as[i].getAttribute('href') || '';
        if (/goods|product|mall|haohuo/i.test(h)) out.push(h.slice(0, 110));
      }
      return out;
    })(),
  };
})()`;

const QR_SCAN_SRC = `(function () {
  var out = { canvas: 0, qrishImgs: 0, candidates: [] };
  out.canvas = document.querySelectorAll('canvas').length;
  var imgs = document.querySelectorAll('img');
  for (var i = 0; i < imgs.length; i++) {
    var im = imgs[i];
    var w = im.naturalWidth || im.clientWidth || 0;
    var h = im.naturalHeight || im.clientHeight || 0;
    var src = (im.getAttribute('src') || '').slice(0, 90);
    if (w >= 100 && Math.abs(w - h) <= 30) {
      out.qrishImgs++;
      if (out.candidates.length < 5) out.candidates.push({ w: w, h: h, src: src });
    }
  }
  return out;
})()`;

async function tryClickLogin(page) {
  // 依次尝试常见登录触发点
  const clicked = await page
    .evaluate(`(function () {
      var els = document.querySelectorAll('button, div, span, a, p, li');
      for (var i = 0; i < els.length; i++) {
        var e = els[i];
        if (e.children.length) continue;
        var x = (e.textContent || '').trim();
        if (x === '登录' || x === '扫码登录' || x === '立即登录') { e.click(); return x; }
      }
      return '';
    })()`)
    .catch(() => '');
  return clicked;
}

(async () => {
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'douyin'), launchOptions());
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(30000);

  console.log('=== 未登录状态下遍历候选入口 ===');
  const results = [];
  for (const c of CANDIDATES) {
    console.log('\n── ' + c.name + ' ──');
    console.log('   ' + c.url);
    await page.goto(c.url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('   goto: ' + e.message.slice(0, 70)));
    await sleep(4500);
    await page.evaluate('window.scrollTo(0, 1200)').catch(() => {});
    await sleep(1500);
    const s = await page.evaluate(SNAP_SRC).catch((e) => ({ error: e.message }));
    if (s.error) { console.log('   ERR ' + s.error); results.push({ name: c.name, url: c.url, error: s.error }); continue; }
    console.log('   落地URL  : ' + s.url.slice(0, 110));
    console.log('   标题     : ' + s.title);
    console.log('   首屏文本 : ' + s.textHead.slice(0, 150));
    console.log('   登录墙   : ' + s.hasLoginWall + '   图片数: ' + s.imgCount);
    console.log('   价格节点 : ' + s.priceNodes.length + ' 个');
    if (s.priceNodes.length) s.priceNodes.slice(0, 3).forEach((p) => console.log('       ' + p.text + '  ← ' + p.chain));
    console.log('   商品链接 : ' + (s.goodsLinks.length ? s.goodsLinks.slice(0, 3).join('  ') : '无'));
    if (s.loginBtns.length) console.log('   登录按钮 : ' + s.loginBtns.slice(0, 5).map((b) => b.tag + '[' + b.cls + ']"' + b.text + '"').join('  '));
    results.push({ name: c.name, url: c.url, snap: s });
  }

  fs.writeFileSync(
    path.join(paths.ensureDir('probe'), 'douyin-candidates.json'),
    JSON.stringify(results, null, 2),
    'utf8'
  );

  if (doLogin) {
    console.log('\n=== 触发登录 ===');
    await page.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(3500);
    const hit = await tryClickLogin(page);
    console.log('点击登录按钮：' + (hit || '(未找到)'));
    await sleep(3500);
    const qr = await page.evaluate(QR_SCAN_SRC).catch(() => null);
    console.log('二维码扫描：' + JSON.stringify(qr));

    // 截图整个视口，便于人工确认
    const shot = path.join(paths.ensureDir('probe'), 'douyin-login.png');
    await page.screenshot({ path: shot }).catch(() => {});
    console.log('截图：' + shot);

    console.log('\n请在浏览器窗口中扫码（脚本等待 180s）...');
    const deadline = Date.now() + 180000;
    let lastShot = 0;
    while (Date.now() < deadline) {
      await sleep(3000);
      const snap = await page.evaluate(SNAP_SRC).catch(() => null);
      if (snap && !snap.hasLoginWall) {
        console.log('✓ 疑似已登录（登录墙消失）：' + snap.textHead.slice(0, 80));
        break;
      }
      if (Date.now() - lastShot > 60000) {
        await page.screenshot({ path: shot }).catch(() => {});
        const q = await page.evaluate(QR_SCAN_SRC).catch(() => null);
        console.log('↻ 二维码刷新检测：' + JSON.stringify(q) + '  截图：' + shot);
        lastShot = Date.now();
      }
    }
    await page.screenshot({ path: shot }).catch(() => {});
    console.log('最终截图：' + shot);
  }

  fs.writeFileSync(path.join(paths.ensureDir('probe'), 'douyin-raw.json'), JSON.stringify(results, null, 2), 'utf8');
  await ctx.close().catch(() => {});
  process.exit(0);
})();
