'use strict';

/**
 * 抖音 so.douyin.com 商品卡片结构探测（移动端 UA）。
 * 重点：1) 是否有独立「商品」tab  2) 商品卡片 DOM 结构  3) 价格真实值从哪取（字体混淆问题）
 *   node scripts/probe-douyin-cards.js --keyword=充电器
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

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const TABS_SRC = `(function () {
  var out = [];
  var els = document.querySelectorAll('div, span, li, a, p, em');
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    if (e.children.length > 1) continue;
    var t = (e.textContent || '').trim();
    if (!t || t.length > 6) continue;
    out.push({ idx: i, tag: e.tagName, cls: String(e.className || '').slice(0, 70), text: t });
  }
  return out;
})()`;

// 找含「已售」的卡片，dump 结构
const CARD_SRC = `(function () {
  var out = { salesCards: [], priceSamples: [] };
  var els = document.querySelectorAll('div, span, p, em, i, a');
  // 1. 销量文案
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    if (e.children.length) continue;
    var t = (e.textContent || '').trim();
    if (!/已售[\\d.]+万?\\+?件?$/.test(t)) continue;
    // 向上找卡片容器
    var p = e;
    var chain = [];
    for (var d = 0; d < 7 && p; d++) {
      chain.push(p.tagName.toLowerCase() + (p.className ? '.' + String(p.className).split(/\\s+/).join('.') : ''));
      p = p.parentElement;
    }
    var card = e;
    for (var k = 0; k < 6 && card.parentElement; k++) card = card.parentElement;
    var imgs = card.querySelectorAll('img');
    var links = card.querySelectorAll('a[href]');
    out.salesCards.push({
      sales: t,
      chain: chain.slice(0, 5).join(' < '),
      cardCls: String(card.className || '').slice(0, 120),
      cardText: String(card.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 220),
      imgs: Array.prototype.slice.call(imgs).slice(0, 3).map(function (im) { return (im.getAttribute('src') || '').slice(0, 130); }),
      links: Array.prototype.slice.call(links).slice(0, 4).map(function (a) { return (a.getAttribute('href') || '').slice(0, 130); }),
      html: card.outerHTML.slice(0, 2500),
    });
    if (out.salesCards.length >= 2) break;
  }
  // 2. 价格节点（含混淆字符）
  for (var j = 0; j < els.length && out.priceSamples.length < 12; j++) {
    var el = els[j];
    if (el.children.length) continue;
    var x = (el.textContent || '').trim();
    if (!/^[¥￥]/.test(x) || x.length > 20) continue;
    var pp = el;
    var pchain = [];
    for (var d2 = 0; d2 < 4 && pp; d2++) { pchain.push(pp.tagName.toLowerCase() + (pp.className ? '.' + String(pp.className).split(/\\s+/)[0] : '')); pp = pp.parentElement; }
    out.priceSamples.push({
      text: x,
      codepoints: Array.prototype.map.call(x, function (c) { return c.charCodeAt(0); }).join(','),
      chain: pchain.join(' < '),
      dataAttrs: Array.prototype.slice.call(el.attributes).map(function (a) { return a.name + '=' + String(a.value).slice(0, 60); }).slice(0, 6),
      parentDataAttrs: el.parentElement ? Array.prototype.slice.call(el.parentElement.attributes).map(function (a) { return a.name + '=' + String(a.value).slice(0, 80); }).slice(0, 8) : [],
    });
  }
  // 3. 字体：抖音用自定义字体混淆数字，列出页面字体
  out.fonts = (function () {
    var f = [];
    var links = document.querySelectorAll('link[href*="woff"], link[href*="ttf"]');
    for (var i = 0; i < links.length && f.length < 8; i++) f.push((links[i].getAttribute('href') || '').slice(0, 140));
    return f;
  })();
  return out;
})()`;

(async () => {
  const base = launchOptions();
  const opts = { ...base, userAgent: MOBILE_UA, viewport: { width: 414, height: 896 }, isMobile: true, hasTouch: true };
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'douyin-mobile'), opts);
  const page = ctx.pages()[0] || (await ctx.newPage());

  const url = 'https://so.douyin.com/s?keyword=' + encodeURIComponent(keyword);
  console.log('搜索页：' + url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('goto: ' + e.message.slice(0, 70)));
  await sleep(5000);
  for (let i = 0; i < 5; i++) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await sleep(1600);
  }

  console.log('落地URL：' + page.url().slice(0, 140));

  const tabs = await page.evaluate(TABS_SRC).catch(() => []);
  console.log('\n── 全部短文本节点（找 tab）──');
  const seen = {};
  tabs.filter((t) => t.text.length <= 4).forEach((t) => {
    if (seen[t.text]) return;
    seen[t.text] = 1;
    console.log('  [' + t.idx + '] ' + t.tag + ' "' + t.text + '"  cls=' + t.cls);
  });

  const cards = await page.evaluate(CARD_SRC).catch((e) => ({ error: e.message }));
  if (cards.error) console.log('\nERR ' + cards.error);

  console.log('\n── 含「已售」的商品卡片：' + ((cards.salesCards || []).length) + ' 个 ──');
  (cards.salesCards || []).forEach((c, i) => {
    console.log('\n  ══ 卡片 ' + (i + 1) + ' ══');
    console.log('  销量    : ' + c.sales);
    console.log('  结构链  : ' + c.chain);
    console.log('  卡片cls : ' + c.cardCls);
    console.log('  卡片文本: ' + c.cardText);
    console.log('  图片    : ' + JSON.stringify(c.imgs, null, 0));
    console.log('  链接    : ' + JSON.stringify(c.links, null, 0));
  });

  console.log('\n── 价格节点（含混淆字符）──');
  (cards.priceSamples || []).forEach((p) => {
    console.log('  文本 "' + p.text + '"  码点[' + p.codepoints + ']');
    console.log('    链: ' + p.chain);
    if (p.dataAttrs.length) console.log('    自身属性: ' + p.dataAttrs.join(' '));
    if (p.parentDataAttrs.length) console.log('    父级属性: ' + p.parentDataAttrs.join(' '));
  });

  console.log('\n── 页面字体 ──');
  (cards.fonts || []).forEach((f) => console.log('  ' + f));
  console.log('  (空则说明走 CSS @font-face)');

  fs.writeFileSync(path.join(paths.ensureDir('probe'), 'douyin-cards.json'), JSON.stringify(cards, null, 2), 'utf8');
  console.log('\n详情：data/probe/douyin-cards.json');

  await ctx.close().catch(() => {});
  process.exit(0);
})();
