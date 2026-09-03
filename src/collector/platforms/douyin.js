'use strict';

const {
  buildParseSrc,
  buildWaitCardsSrc,
  buildClickSortSrc,
  buildClickPageSrc,
  buildRiskSrc,
} = require('../dom-scripts');
const { parseSales } = require('../util');

/**
 * 抖音商城（买家端）— 实验性平台。
 *
 * ⚠️ 下面的选择器均为【占位/待探测】，不是实测结论。
 * 必须先跑 `npm run probe:douyin` 拿到真实 DOM 报告，再用报告的结论覆盖这里。
 * 若探测判定不可行，本适配器保持 experimental: true，UI 中禁用。
 */
const SELECTORS = {
  card: '[class*="goods"], [class*="product"], [class*="card"]',
  link: 'a[href*="/goods/"], a[href*="haohuo"], a[href*="product"]',
  linkRe: 'haohuo\\.jinritemai\\.com|/goods/|douyin\\.com/goods',
  idRe: '[?&]?(?:id|product_id|promotion_id)=(\\d+)',
  img: 'img',
  title: '[class*="title"], [class*="name"]',
  shop: '[class*="shop"], [class*="Shop"]',
  priceInt: '[class*="price"], [class*="Price"]',
  priceFloat: '',
  sales: '[class*="sales"], [class*="sold"], [class*="Sales"]',
  comments: '',
};

const RISK_PATTERNS = ['验证', '滑块', '访问频繁', '操作过于频繁', '请稍后再试'];

const IS_LOGGED_IN_SRC = `(function () {
  var t = ((document.body && document.body.innerText) || '').slice(0, 6000);
  if (/登录|扫码登录/.test(t) && !/我的|消息/.test(t)) return false;
  return false;
})()`;

module.exports = {
  id: 'douyin',
  name: '抖音商城',
  experimental: true,
  experimentalReason: '页面结构未实机探测，需先运行「抖音探测」确认可行性',
  homeUrl: 'https://www.douyin.com',
  loginUrl: 'https://www.douyin.com',
  // 候选入口，探测脚本会逐个验证哪个能出商品卡片
  candidateSearchUrls: (kw) => [
    'https://www.douyin.com/search/' + encodeURIComponent(kw),
    'https://www.douyin.com/search/' + encodeURIComponent(kw) + '?type=general',
    'https://haohuo.jinritemai.com/views/product/list?q=' + encodeURIComponent(kw),
  ],
  searchUrl: (kw) => 'https://www.douyin.com/search/' + encodeURIComponent(kw),
  selectors: SELECTORS,
  riskPatterns: RISK_PATTERNS,
  isLoggedInSrc: IS_LOGGED_IN_SRC,
  loginCookies: ['sessionid', 'passport_csrf_token', 'ttwid'],
  sortLabel: '',
  sortedRe: '',
  defaultRe: '',
  sortRequired: false,
  recheckSortEachPage: false,
  firstRenderTimeout: 30000,

  parseSrc: () => buildParseSrc(SELECTORS),
  waitCardsSrc: (n) => buildWaitCardsSrc(SELECTORS.card, n),
  clickSortSrc: () => buildClickSortSrc('销量'),
  salesKindSrc: () => null,
  clickPageSrc: (n) => buildClickPageSrc(n),
  riskSrc: () => buildRiskSrc(RISK_PATTERNS),
  parseSalesNumber: parseSales,

  imageVariants: (u) => [String(u)],
  nextPageUrl: () => null,
};
