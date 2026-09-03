'use strict';

const {
  buildParseSrc,
  buildWaitCardsSrc,
  buildClickSortSrc,
  buildSalesKindSrc,
  buildClickPageSrc,
  buildRiskSrc,
} = require('../dom-scripts');
const { parseSales } = require('../util');

// 选择器来自 skill 第四节（2026-09 实测）。title 为待探测项，probe 会校验。
const SELECTORS = {
  card: 'div[class*="doubleCard--"]',
  link: 'a[href*="item.taobao.com"], a[href*="detail.tmall.com"]',
  linkRe: 'item\\.taobao\\.com|detail\\.tmall\\.com',
  idRe: '[?&]id=(\\d+)',
  img: 'img[class*="mainPic--"]',
  title: '[class*="title--"]',
  shop: '[class*="shopNameText--"]',
  priceInt: '[class*="priceInt--"]',
  priceFloat: '[class*="priceFloat--"]',
  sales: '[class*="realSales--"]',
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
  firstRenderTimeout: 40000,

  parseSrc: () => buildParseSrc(SELECTORS),
  waitCardsSrc: (n) => buildWaitCardsSrc(SELECTORS.card, n),
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
