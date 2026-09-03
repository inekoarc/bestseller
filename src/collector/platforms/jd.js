'use strict';

const {
  buildParseSrc,
  buildWaitCardsSrc,
  buildClickSortSrc,
  buildClickPageSrc,
  buildRiskSrc,
} = require('../dom-scripts');
const { parseSales } = require('../util');

// 京东存在新旧两版卡片结构并存（灰度中），用逗号选择器同时兼容（skill 第八节）
const SELECTORS = {
  card: 'div.plugin_goodsCardWrapper, li.gl-item',
  link: 'a[href*="item.jd.com"]',
  linkRe: 'item\\.jd\\.com',
  idRe: '[?&]?\\/(\\d+)\\.html',
  img: 'img[data-src], img[data-lazy-img], img.J_goodsImg, .p-img img',
  title: 'div.p-name a, .p-name em, [class*="goodsName"], [class*="title"]',
  shop: '.p-shop a, a[href*="mall.jd.com"], [class*="shopName"]',
  priceInt: '.p-price i, [class*="price"] i, [class*="Price"]',
  priceFloat: '',
  sales: '[class*="sales"], [class*="Sales"]',
  comments: '.p-commit a, [class*="comment"] a, [class*="Comment"]',
};

const RISK_PATTERNS = ['访问验证', '访问频繁', '滑块', '安全验证', '请输入验证码'];

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
  searchUrl: (kw) =>
    'https://search.jd.com/Search?keyword=' + encodeURIComponent(kw) + '&enc=utf-8',
  selectors: SELECTORS,
  riskPatterns: RISK_PATTERNS,
  isLoggedInSrc: IS_LOGGED_IN_SRC,
  loginCookies: ['pin', '__jdu', 'thor'],
  sortLabel: '销量',
  sortedRe: '',
  defaultRe: '',
  sortRequired: true,
  // 京东排序参数随翻页保留在 URL，不做逐页重校验（skill 第八节）
  recheckSortEachPage: false,
  firstRenderTimeout: 30000,
  // 京东首屏默认只渲染 30 个，需滚动到底触发懒加载凑齐一页 60 个
  needScrollToBottom: true,

  parseSrc: () => buildParseSrc(SELECTORS),
  waitCardsSrc: (n) => buildWaitCardsSrc(SELECTORS.card, n),
  clickSortSrc: () => buildClickSortSrc('销量'),
  salesKindSrc: () => null,
  clickPageSrc: (n) => buildClickPageSrc(n),
  riskSrc: () => buildRiskSrc(RISK_PATTERNS),
  parseSalesNumber: parseSales,

  /** 京东图片规格：n7=350px，n1=大图，n0=原图。优先取原图 */
  imageVariants: (u) => {
    const out = [];
    const m = String(u).match(/^(https?:\/\/[^/]+\/)n(\d)(\/.*)$/i);
    if (m) {
      out.push(m[1] + 'n0' + m[3]);
      out.push(m[1] + 'n1' + m[3]);
    }
    out.push(String(u));
    return out;
  },

  /** 翻页兜底：京东 page 参数为 1,3,5…，s 为 1,61,121… */
  nextPageUrl: (p) =>
    'https://search.jd.com/Search?keyword={kw}&enc=utf-8&page=' + (p * 2 - 1) + '&s=' + ((p - 1) * 60 + 1),
};
