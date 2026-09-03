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
 * 抖音商城（买家端）— 实验性平台，2026-09 实机探测结论：Web 端不可用。
 *
 * ── 探测结论（scripts/probe-douyin*.js，已登录态 + 移动端 UA 均试过）──
 *
 * | 入口                                | 结果                                              |
 * |-------------------------------------|---------------------------------------------------|
 * | douyin.com/search/{kw}              | 有登录墙；登录后 tab 仅 综合/视频/用户/直播，无「商品」|
 * | douyin.com/mall                     | 404「页面不见啦」                                  |
 * | mall.douyin.com                     | App 下载落地页，无商品                             |
 * | mall.douyin.com/search              | 空白页                                            |
 * | haohuo.jinritemai.com               | 已下线（404 / 触发下载）                           |
 * | buyin.jinritemai.com                | 商家入驻官网，非买家端                             |
 * | so.douyin.com/s?keyword= (移动 UA)   | tab 仅 综合/AI搜索/图片/视频/直播/用户，无「商品」  |
 * | douyin.com 首页导航                  | 精选/推荐/AI抖音/关注/朋友/我的/直播/放映厅/短剧/小游戏，无商城入口 |
 *
 * 唯一能拿到零星商品的路径是「移动端 UA + so.douyin.com 综合流」中混杂在视频卡片里的
 * 带货商品（约每屏 1~2 个），但存在两个硬伤：
 *   1. 价格被自定义字体混淆：DOM 里是 `¥ ?.99` / `¥ 3?`，数字被映射到字体私有区码点，
 *      无 SSR 内嵌数据（window._ROUTER_DATA / RENDER_DATA 均为空，数据走 XHR），
 *      要还原需下载并解析 woff 的 cmap，且字体随请求轮换，成本与稳定性都不划算。
 *   2. 不是「商品搜索结果」：没有销量排序、没有分页器，拿不到「爆款」口径。
 *
 * 因此本平台保持 experimental: true，UI 中禁用并给出原因。
 * 若未来抖音开放 Web 端商品搜索，可复用下面保留的结构线索快速适配：
 *   - 卡片容器链：div.cardInner-LuU1pH.h5-card-padding > div.shopCartNewAnchor_ >
 *                 div.anchorTextContainer_ > div.labelContainer_ > span.textLabel_
 *   - 销量文案：span.textLabel_ 内「已售2万+件」
 *   - 商品图：https://pXX-item.ecombdimg.com/img/ecom-shop-material/...~tplv-5mmsx3fu...
 */

const SELECTORS = {
  card: 'div.cardInner-LuU1pH, div[class*="cardInner"]',
  link: 'a[href*="/goods/"], a[href*="haohuo"], a[href*="product"]',
  linkRe: 'haohuo\\.jinritemai\\.com|/goods/|douyin\\.com/goods',
  idRe: '[?&]?(?:id|product_id|promotion_id)=(\\d+)',
  img: 'img',
  title: '[class*="title"], [class*="Title"], [class*="desc"]',
  shop: '[class*="shop"], [class*="Shop"], [class*="userNickname"]',
  priceInt: 'span.textLabel_, [class*="price"], [class*="Price"]',
  priceFloat: '',
  sales: 'span.textLabel_, [class*="sales"], [class*="sold"]',
  comments: '',
};

const RISK_PATTERNS = ['验证', '滑块', '访问频繁', '操作过于频繁', '请稍后再试'];

const IS_LOGGED_IN_SRC = `(function () {
  if (/passport\\.douyin\\.com|\\/passport/.test(location.href)) return false;
  var t = ((document.body && document.body.innerText) || '').slice(0, 4000);
  // 出现「下载 APP / 登录后查看更多」等引导，或存在明显的登录入口，即视为未登录
  if (/登录后查看精彩内容|扫码登录|登录账号/.test(t)) return false;
  // 登录后在侧边/顶栏能看到「我」相关的计数或入口
  if (/我的订单|我\\s*的$|关注\\s*\\d/.test(t)) return true;
  return false;
})()`;

module.exports = {
  id: 'douyin',
  name: '抖音商城',
  experimental: true,
  experimentalReason:
    'Web 端无商品搜索入口（实测：douyin.com/mall 已 404、mall.douyin.com 仅 APP 下载页、搜索页无「商品」tab），仅移动端综合流能零散捞到带货商品且价格被字体混淆，暂不可采集',
  homeUrl: 'https://www.douyin.com',
  loginUrl: 'https://www.douyin.com',
  // 保留候选入口，便于日后抖音开放时快速复测
  candidateSearchUrls: (kw) => [
    'https://so.douyin.com/s?keyword=' + encodeURIComponent(kw),
    'https://www.douyin.com/search/' + encodeURIComponent(kw),
    'https://www.douyin.com/search/' + encodeURIComponent(kw) + '?type=general',
  ],
  searchUrl: (kw) => 'https://so.douyin.com/s?keyword=' + encodeURIComponent(kw),
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
