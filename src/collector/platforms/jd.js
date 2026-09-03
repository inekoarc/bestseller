'use strict';

/**
 * 京东适配器（2026-09 新版搜索页实测）
 *
 * 新版 DOM 全部使用 CSS Modules 哈希类名（如 _price_9y3st_31 / _limit_3z0zc_23），
 * 且销量元素的 class 为空字符串，只能靠文本正则 /^已售/ 定位；
 * 商品链接在卡片内没有 item.jd.com 的 <a>，需用卡片根的 data-sku 拼接。
 * 因此本平台不使用通用 buildParseSrc，改为自定义 parseSrc。
 *
 * 卡片：div.plugin_goodsCardWrapper（新版） / li.gl-item（旧版，兼容保留）
 * 排序：URL 参数 psort=3（销量降序），实测与点击「销量」页签结果一致，且翻页时参数自动保留
 * 图片：//imgNN.360buyimg.com/n2/s480x480_jfs/... → 优先取 n0 原图
 */

const {
  buildWaitCardsSrc,
  buildClickSortSrc,
  buildClickPageSrc,
  buildRiskSrc,
  COMMON,
} = require('../dom-scripts');
const { parseSales } = require('../util');

const SELECTORS = {
  card: 'div.plugin_goodsCardWrapper, li.gl-item',
  img: 'div[class*="bannerPicBox"] img, img[data-src], img[data-lazy-img], img.J_goodsImg, .p-img img',
  title: '[class*="goods_title_container"], .p-name em',
  price: 'span[class*="_price_"], .p-price i',
  shop: 'span[class*="_limit_"], .p-shop a, a[href*="mall.jd.com"]',
  sales: '', // 新版销量元素 class 为空，改用文本正则（见 parseSrc 的 findSales）
  comments: '.p-commit a, [class*="comment"] a',
};

const RISK_PATTERNS = ['访问验证', '访问频繁', '滑块', '安全验证', '请输入验证码', '网络有点拥挤'];

const IS_LOGGED_IN_SRC = `(function () {
  if (/passport\\.jd\\.com/.test(location.href)) return false;
  var t = ((document.body && document.body.innerText) || '').slice(0, 6000);
  if (/你好，请登录|请登录/.test(t)) return false;
  if (/我的订单|我的京东|我的关注/.test(t)) return true;
  return false;
})()`;

module.exports = {
  id: 'jd',
  name: '京东',
  experimental: false,
  homeUrl: 'https://www.jd.com',
  loginUrl: 'https://passport.jd.com/new/login.aspx',
  // psort=3 = 销量降序（实测生效，且与点击「销量」页签结果完全一致）
  searchUrl: (kw) =>
    'https://search.jd.com/Search?keyword=' + encodeURIComponent(kw) + '&enc=utf-8&psort=3',
  selectors: SELECTORS,
  riskPatterns: RISK_PATTERNS,
  isLoggedInSrc: IS_LOGGED_IN_SRC,
  loginCookies: ['pin', '__jdu', 'thor'],
  sortLabel: '销量',
  sortedRe: '',
  defaultRe: '',
  // 排序已由 URL 参数 psort=3 保证，无需点页签；但每页做降序校验兜底
  sortRequired: false,
  recheckSortEachPage: true,
  firstRenderTimeout: 40000,
  // 京东首屏默认渲染 30 个，需滚动到底触发懒加载凑齐一页 60 个
  needScrollToBottom: true,

  parseSrc: () => {
    return (
      '(function (sel) {' +
      COMMON +
      `
  // 只看叶子元素（无子元素），避免父容器文本把整卡文字都带出来
  function leaves(root) {
    var all = root.querySelectorAll('span, div, em, i, p, a');
    var out = [];
    for (var i = 0; i < all.length; i++) if (!all[i].children.length) out.push(all[i]);
    return out;
  }
  // 销量：新版卡片该元素 class 为空串，只能按文本识别
  function findSales(root) {
    var ls = leaves(root);
    for (var i = 0; i < ls.length; i++) {
      var t = txt(ls[i]);
      if (/^已售\\s*[\\d.]/.test(t)) return t;
    }
    return '';
  }
  function findComments(root) {
    var ls = leaves(root);
    for (var i = 0; i < ls.length; i++) {
      var t = txt(ls[i]);
      if (/^[\\d.]+\\s*万?\\+?\\s*条评价$/.test(t)) return t;
      if (/^[\\d.]+\\s*万?\\+?\\s*人评价$/.test(t)) return t;
    }
    return '';
  }
  // 广告位：卡片内有独立「广告」文本节点
  function isAd(root) {
    var ls = leaves(root);
    for (var i = 0; i < ls.length; i++) {
      if (txt(ls[i]) === '广告') return true;
    }
    return false;
  }

  var cards = document.querySelectorAll(sel.card);
  var out = [];
  var seen = {};
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    // 商品ID：新版在卡片根元素的 data-sku 上（旧版 li.gl-item 也有）
    var id = c.getAttribute('data-sku') || c.getAttribute('data-spu') || '';
    if (!id) {
      var a0 = q(c, 'a[href*="item.jd.com"], a[href*="item.jd.hk"]');
      if (a0) {
        var m0 = (a0.getAttribute('href') || '').match(/(\\d+)\\.html/);
        if (m0) id = m0[1];
      }
    }
    if (!id || seen[id]) continue;
    seen[id] = 1;

    var imgEl = q(c, sel.img);
    var title = firstText(c, sel.title);
    var priceText = firstText(c, sel.price);
    var salesText = findSales(c);

    out.push({
      id: id,
      title: title,
      shop: firstText(c, sel.shop),
      price: priceText.replace(/[^\\d.]/g, ''),
      priceText: priceText,
      salesText: salesText,
      commentsText: findComments(c),
      // 卡片内无商品详情 <a>，用 sku 拼标准链接
      link: 'https://item.jd.com/' + id + '.html',
      imageUrl: pickAttr(imgEl, ['data-src', 'data-lazy-img', 'data-lazyload', 'data-origin', 'src']),
      isAd: isAd(c)
    });
  }
  return out;
})(${JSON.stringify(SELECTORS)})`
    );
  },

  waitCardsSrc: (n) => buildWaitCardsSrc(SELECTORS.card, n),
  clickSortSrc: () => buildClickSortSrc('销量'),

  /**
   * 排序校验：把前若干条销量转成数字，统计相邻「降序对 / 升序对」。
   * 复用 engine 的 recv(降序) vs pay(升序) 判定：升序对更多即认为排序丢失。
   */
  salesKindSrc: () => {
    return (
      '(function () {' +
      COMMON +
      `
  var cards = document.querySelectorAll(${JSON.stringify(SELECTORS.card)});
  var vals = [];
  for (var i = 0; i < cards.length && vals.length < 12; i++) {
    var c = cards[i];
    var all = c.querySelectorAll('span, div, em, i');
    for (var k = 0; k < all.length; k++) {
      if (all[k].children.length) continue;
      var t = txt(all[k]);
      if (!/^已售\\s*[\\d.]/.test(t)) continue;
      var m = t.replace(/,/g, '').match(/([\\d.]+)\\s*(万|w|W)?/);
      if (!m) continue;
      var n = parseFloat(m[1]);
      if (isNaN(n)) continue;
      vals.push(m[2] ? n * 10000 : n);
      break;
    }
  }
  var desc = 0, asc = 0;
  for (var j = 1; j < vals.length; j++) {
    if (vals[j] < vals[j - 1]) desc++;
    else if (vals[j] > vals[j - 1]) asc++;
  }
  return { recv: desc, pay: asc, other: 0, total: vals.length, vals: vals };
})()`
    );
  },

  clickPageSrc: (n) => buildClickPageSrc(n),
  riskSrc: () => buildRiskSrc(RISK_PATTERNS),
  parseSalesNumber: parseSales,

  /**
   * 京东图片：n2/s480x480_ 为缩放图，n0 为原图，n1 为大图。
   * 新版 CDN 会在末尾追加 .avif / .webp（Excel 嵌图不支持），需先剥掉。
   */
  imageVariants: (u) => {
    const raw = String(u || '');
    const out = [];
    const push = (x) => {
      if (x && out.indexOf(x) < 0) out.push(x);
    };
    const s = raw.replace(/\.(avif|webp)(\?.*)?$/i, '$2');
    const m = s.match(/^(https?:)?\/\/([^/]*360buyimg\.com\/)n(\d)\/(?:s\d+x\d+_)?(jfs\/.*)$/i);
    if (m) {
      const p = (m[1] || 'https:') + '//' + m[2];
      push(p + 'n0/' + m[4]); // 原图
      push(p + 'n1/' + m[4]); // 大图
      push(p + 'n' + m[3] + '/' + m[4]); // 同级去缩放后缀
    }
    push(s);
    push(raw);
    return out;
  },

  /** 翻页兜底：京东 page 参数为 1,3,5…，s 为 1,61,121…；psort=3 保持销量排序 */
  nextPageUrl: (p) =>
    'https://search.jd.com/Search?keyword={kw}&enc=utf-8&psort=3&page=' +
    (p * 2 - 1) +
    '&s=' +
    ((p - 1) * 60 + 1),
};
