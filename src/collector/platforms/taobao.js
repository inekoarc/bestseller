'use strict';

const {
  buildWaitCardsSrc,
  buildClickSortSrc,
  buildSalesKindSrc,
  buildClickPageSrc,
  buildRiskSrc,
  COMMON,
} = require('../dom-scripts');
const { parseSales } = require('../util');

// 选择器来自 skill 第四节（2026-09 实测）。注意淘宝 class 名为哈希动态化，
// 实测当前为 card--XXX / cardImg--XXX / cardTitle--XXX（旧的 doubleCard 已废弃）。
// 「card--」会同时匹配热门分类筛选筹码，所以用「含商品链接」二级过滤排除干扰。
const SELECTORS = {
  card: 'a[href*="item.taobao.com"], a[href*="detail.tmall.com"]',
  // 卡片根容器：拿到 a 后向上找最近的有 srcset/img 的 div
  cardRoot: 'div[class*="card--"]',
  link: 'a[href*="item.taobao.com"], a[href*="detail.tmall.com"]',
  linkRe: 'item\\.taobao\\.com|detail\\.tmall\\.com',
  idRe: '[?&]id=(\\d+)',
  img: 'img',
  title: '[class*="cardTitle--"], [class*="title--"]',
  shop: '[class*="shopName--"], [class*="shopNameText--"]',
  priceInt: '[class*="priceInt--"]',
  priceFloat: '[class*="priceFloat--"]',
  sales: '[class*="realSales--"], [class*="salesPoint--"]',
  comments: '',
};

const RISK_PATTERNS = ['滑块', '安全验证', '人机验证', '访问验证', '访问频繁', '请完成验证'];

const IS_LOGGED_IN_SRC = `(function () {
  if (/login\\.taobao\\.com|login\\.tmall\\.com/.test(location.href)) return false;
  var t = ((document.body && document.body.innerText) || '').slice(0, 6000);
  if (/亲，请登录|请登录/.test(t)) return false;
  if (/我的淘宝|已买到的宝贝|我的订单/.test(t)) return true;
  return false;
})()`;

module.exports = {
  id: 'taobao',
  name: '淘宝',
  experimental: false,
  homeUrl: 'https://www.taobao.com',
  loginUrl:
    'https://login.taobao.com/member/login.jhtml?redirect_url=https%3A%2F%2Fwww.taobao.com%2F',
  searchUrl: (kw) => 'https://s.taobao.com/search?q=' + encodeURIComponent(kw),
  selectors: SELECTORS,
  riskPatterns: RISK_PATTERNS,
  isLoggedInSrc: IS_LOGGED_IN_SRC,
  loginCookies: ['cookie2', '_tb_token_', 't'],
  // 淘宝必须点「销量」页签，URL 参数 sort/s/page 已全部失效
  sortLabel: '销量',
  sortedRe: '人收货',
  defaultRe: '人付款',
  sortRequired: true,
  // 淘宝销量排序在翻页后可能丢失，需逐页校验
  recheckSortEachPage: true,
  // 首屏真实卡片要 20~30s 才渲染完
  firstRenderTimeout: 60000,

  parseSrc: () => {
    const sel = SELECTORS;
    return (
      '(function (sel) {' +
      COMMON +
      `
  // 用商品链接作为入口（避免被热门分类筛选筹码干扰）
  var linkEls = document.querySelectorAll('a[href*="item.taobao.com"], a[href*="detail.tmall.com"]');
  var seen = {};
  var out = [];
  for (var i = 0; i < linkEls.length; i++) {
    var a = linkEls[i];
    var href = abs(a.getAttribute('href') || '');
    if (!href) continue;
    var idMatch = href.match(/[?&]id=(\\d+)/);
    var id = idMatch ? idMatch[1] : '';
    if (!id) continue;
    if (seen[id]) continue;
    seen[id] = 1;
    var card = a.closest('div');
    // 向上找含多个子节点的卡片容器（含 img 的祖先）
    var root = a;
    for (var s2 = 0; s2 < 6 && root.parentElement; s2++) {
      root = root.parentElement;
      if (root.tagName === 'DIV' && root.querySelectorAll('img').length >= 1) break;
    }
    var scope = root;
    var imgs = scope ? scope.querySelectorAll('img') : [];
    var imgUrl = '';
    for (var k = 0; k < imgs.length; k++) {
      var v = imgs[k].getAttribute('src') || '';
      if (v && !/placeholder|blank|loading|default/i.test(v)) { imgUrl = abs(v); break; }
    }
    if (!imgUrl && imgs.length) imgUrl = abs(imgs[0].getAttribute('src') || '');
    var titleEl = scope ? q(scope, '[class*="cardTitle--"]') : null;
    var title = titleEl ? txt(titleEl) : (a.getAttribute('title') || a.textContent || '').replace(/\\s+/g,' ').trim().slice(0,80);
    var priceEl = scope ? q(scope, '[class*="priceInt--"]') : null;
    var priceFloatEl = scope ? q(scope, '[class*="priceFloat--"]') : null;
    var price = (priceEl ? txt(priceEl) : '') + (priceFloatEl ? txt(priceFloatEl) : '');
    var shopEl = scope ? q(scope, '[class*="shopName--"], [class*="shopNameText--"]') : null;
    var salesEl = scope ? q(scope, '[class*="realSales--"], [class*="salesPoint--"]') : null;
    out.push({
      id: id,
      title: title,
      shop: shopEl ? txt(shopEl) : '',
      price: price.replace(/[^\\d.]/g, ''),
      priceText: price.trim(),
      salesText: salesEl ? txt(salesEl) : '',
      commentsText: '',
      link: href,
      imageUrl: imgUrl
    });
  }
  return out;
})(${JSON.stringify(sel)})`
    );
  },
  waitCardsSrc: (n) => buildWaitCardsSrc('a[href*="item.taobao.com"], a[href*="detail.tmall.com"]', n),
  clickSortSrc: () => buildClickSortSrc('销量'),
  salesKindSrc: () => buildSalesKindSrc(SELECTORS.sales, '人收货', '人付款'),
  clickPageSrc: (n) => buildClickPageSrc(n),
  riskSrc: () => buildRiskSrc(RISK_PATTERNS),
  parseSalesNumber: parseSales,

  /** 淘宝商品图：去掉 `_400x400q90.jpg` 之类后缀拿原图 */
  imageVariants: (u) => {
    const m = String(u).match(/^(.+\.(?:jpg|jpeg|png|gif|webp))[_.]/i);
    return m ? [m[1], String(u)] : [String(u)];
  },

  /** 淘宝不支持用 URL 翻页，只能点分页器 */
  nextPageUrl: () => null,
};
