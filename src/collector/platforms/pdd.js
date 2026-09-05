'use strict';

const {
  buildClickSortSrc,
  buildRiskSrc,
  COMMON,
} = require('../dom-scripts');
const { parseSales, sleep } = require('../util');

/**
 * 拼多多移动端 H5（mobile.pinduoduo.com）适配器 — 2026-09 实机探测结论
 *
 * ── 探测记录（scripts/probe-pdd*.js，未登录态实测）──
 *
 * | 入口 / 行为                                   | 结果                                              |
 * |-----------------------------------------------|---------------------------------------------------|
 * | mobile.pinduoduo.com 首页                     | 无需登录即可渲染推荐商品流，SSR 内嵌 __SSR__ + XHR |
 * | proxy/api/* 数据接口                          | 全部携带 anti_content 签名，不能直接拼 URL 调接口 |
 * | goods.html?search_keyword=                    | 「商品不存在」                                     |
 * | search_goods.html / gsearch.html              | 302 → portal.html（首页推荐流，非搜索结果）        |
 * | 首页 → 点顶部搜索栏                           | → relative_goods.html（可见 input[type=search]）   |
 * | relative_goods.html 提交关键词                | → search_result.html?search_key=...               |
 * | search_result.html（未登录）                  | 立即 302 → login.html                              |
 * | login.html 落地默认「手机登录」               | 有「扫码登录」页签（class=qrcode-login，文本含零宽字符需清洗后匹配）|
 * | 点击「扫码登录」后                            | 渲染 img.qr-code-box 350x350 二维码（data:base64），qr.js 通用选择器可直接定位 |
 *
 * 结论：
 *  1. 扫码登录可用（2026-09 实测：点击后二维码正常渲染、grabQR 定位成功），作为主路径，
 *     与淘宝/京东体验一致；短信验证码保留为备用路径（UI 可切换，smsFallback: true）。
 *  2. 登录态由 PDDAccessToken Cookie 承载，持久化在 pw-data/pdd 后自动复用，无需每次登录。
 *  3. 已登录后的 search_result.html DOM 结构无法在无账号环境实测，因此解析策略
 *     采用双通道：优先从 window.rawData 内嵌 JSON 递归找 goods_id+goods_name 的
 *     商品对象（字段名与服务端接口一致，比哈希 CSS 类名稳定得多）；
 *     取不到时再用「恰好 1 个价格 + ≥1 张图」的 DOM 广度扫描兜底。
 *  4. H5 搜索结果为无限滚动加载，没有分页器（infiniteScroll: true）。
 */

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const SELECTORS = {
  // DOM 兜底扫描不用固定卡片类名（H5 为 CSS Modules 哈希类，随版本轮换），
  // 这里仅保留商品详情链接形态供链接提取。
  card: 'a[href*="goods"]',
  link: 'a[href*="goods"]',
  linkRe: 'goods_id=\\d+',
  idRe: 'goods_id=(\\d+)',
  img: 'img',
  title: '',
  shop: '',
  priceInt: '',
  priceFloat: '',
  sales: '',
  comments: '',
};

const RISK_PATTERNS = ['请完成验证', '安全验证', '滑块', '验证码输入', '访问异常', '操作过于频繁', '系统繁忙'];

const IS_LOGGED_IN_SRC = `(function () {
  // 拼多多 H5 登录态由 PDDAccessToken Cookie 承载。
  // engine.js 已优先通过 Playwright context.cookies() 读取（支持 HttpOnly），
  // 此处作为页面内兜底：Cookie 可读即认为已登录。
  return /(?:^|;\\s*)PDDAccessToken=[^;]/.test(document.cookie || '');
})()`;

/** 在浏览器里给受控 input 赋值（React 受控组件需走原生 setter） */
const SET_VAL_SRC = `
  function setVal(el, v) {
    var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    desc.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function vis(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
`;

/** 抓页面可见提示（toast/notice），拼进返回状态，让日志呈现真实失败原因（滑块/协议/频率限制等） */
const TOAST_SRC = `
  function grabToast() {
    var cands = document.querySelectorAll('div, p, span');
    for (var i = 0; i < cands.length; i++) {
      var e = cands[i];
      if (e.children.length) continue;
      var cls = String(e.className || '');
      var pCls = e.parentElement ? String(e.parentElement.className || '') : '';
      if (!/toast|tip|notice|message|dialog|popup|hint/i.test(cls + ' ' + pCls)) continue;
      var t = (e.textContent || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
      if (t && t.length <= 60) return t;
    }
    return '';
  }
`;

/** 短信登录第一步：勾协议 → 填手机号 → 点「发送验证码」。返回状态码供日志输出 */
const SMS_FILL_PHONE_SRC = `
  (async function (phone) {
    ${SET_VAL_SRC}
    ${TOAST_SRC}
    // 勾选用户协议（原生 checkbox）
    var cbs = document.querySelectorAll('input[type="checkbox"]');
    for (var i = 0; i < cbs.length; i++) {
      if (vis(cbs[i]) && !cbs[i].checked) { cbs[i].click(); break; }
    }
    // 可见输入框；没有则先尝试点「手机登录」页签再扫一遍
    function visibleInputs() {
      var out = [];
      var all = document.querySelectorAll('input');
      for (var j = 0; j < all.length; j++) if (vis(all[j])) out.push(all[j]);
      return out;
    }
    var inps = visibleInputs();
    if (!inps.length) {
      var tabs = document.querySelectorAll('div, span, a');
      for (var t = 0; t < tabs.length; t++) {
        var ts = (tabs[t].textContent || '').trim();
        if ((ts === '手机登录' || ts === '短信登录') && vis(tabs[t]) && tabs[t].children.length <= 2) {
          tabs[t].click(); break;
        }
      }
      inps = visibleInputs();
    }
    if (!inps.length) return 'no-input';
    // 手机号输入框：优先 tel 类型 / 含「手机」占位符，否则取第一个
    var tel = null;
    for (var k = 0; k < inps.length; k++) {
      var it = (inps[k].type || '') + ' ' + (inps[k].placeholder || '');
      if (/tel|手机/.test(it)) { tel = inps[k]; break; }
    }
    if (!tel) tel = inps[0];
    setVal(tel, String(phone));
    // 点「发送验证码」（文案精确匹配，避开「重新发送」等禁用态）
    var els = document.querySelectorAll('button, div, span, a');
    for (var m = 0; m < els.length; m++) {
      var e = els[m];
      var s = (e.textContent || '').trim();
      if (!/^(发送验证码|获取验证码|获取短信验证码)$/.test(s)) continue;
      if (!vis(e) || e.children.length > 2) continue;
      e.click();
      await new Promise(function (res) { setTimeout(res, 1600); });
      var toast = grabToast();
      return 'ok' + (toast ? '｜页面提示: ' + toast : '');
    }
    return 'no-send-btn';
  })`;

/** 短信登录第二步：填验证码 → 点「登录」。返回状态码供日志输出。
 *  注意：这里只保证「登录按钮被点击」，真正的登录结果由 engine 轮询 isLoggedIn 判定。 */
const SMS_SUBMIT_SRC = `
  (async function (code) {
    ${SET_VAL_SRC}
    ${TOAST_SRC}
    var inps = [];
    var all = document.querySelectorAll('input');
    for (var j = 0; j < all.length; j++) if (vis(all[j])) inps.push(all[j]);
    if (!inps.length) return 'no-input';
    // 验证码输入框：占位符优先，其次第二个可见输入框，最后第一个
    var codeInp = null;
    for (var k = 0; k < inps.length; k++) {
      if (/验证码|code/i.test(inps[k].placeholder || '')) { codeInp = inps[k]; break; }
    }
    if (!codeInp && inps.length >= 2) codeInp = inps[1];
    if (!codeInp) codeInp = inps[0];
    setVal(codeInp, String(code));
    // 勾用户协议（提交前再勾一次：验证码视图可能重置勾选态，未勾选时点「登录」会被页面静默拒绝）
    var cbs = document.querySelectorAll('input[type="checkbox"]');
    for (var b = 0; b < cbs.length; b++) {
      if (vis(cbs[b]) && !cbs[b].checked) { cbs[b].click(); break; }
    }
    // 点「登录」（精确文案，避开「发送验证码」「登录即同意」等）
    var els = document.querySelectorAll('button, div, span, a');
    for (var m = 0; m < els.length; m++) {
      var e = els[m];
      var s = (e.textContent || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').trim();
      if (s !== '登录' && s !== '登录/注册') continue;
      if (!vis(e) || e.children.length > 2) continue;
      e.click();
      await new Promise(function (res) { setTimeout(res, 1200); });
      var toast = grabToast();
      return 'clicked' + (toast ? '｜页面提示: ' + toast : '');
    }
    return 'no-login-btn';
  })`;

module.exports = {
  id: 'pdd',
  name: '拼多多',
  experimental: false,
  desc: '移动端 H5 · 扫码登录（可切短信验证码）',
  homeUrl: 'https://mobile.pinduoduo.com/',
  loginUrl: 'https://mobile.pinduoduo.com/login.html',
  // 扫码优先（实测可渲染二维码、grabQR 可定位）；短信验证码为备用路径
  loginMode: 'qr',
  smsFallback: true,
  loginCookies: ['PDDAccessToken'],
  // H5 页面，移动端 UA + 手机视口最稳（实测桌面 UA 也能渲染，但移动端是主路径）
  userAgent: MOBILE_UA,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  searchUrl: (kw) =>
    'https://mobile.pinduoduo.com/search_result.html?search_key=' +
    encodeURIComponent(kw) +
    '&search_type=goods&source=index',
  selectors: SELECTORS,
  riskPatterns: RISK_PATTERNS,
  isLoggedInSrc: IS_LOGGED_IN_SRC,
  sortLabel: '销量',
  sortedRe: '',
  defaultRe: '',
  // H5 筛选栏有「销量」页签；无销量维度校验文案，点击即认为生效
  sortRequired: true,
  recheckSortEachPage: false,
  firstRenderTimeout: 30000,
  // 搜索结果为无限滚动：每轮滚到底触发加载更多，靠连续无新增判定结束
  needScrollToBottom: true,
  infiniteScroll: true,

  parseSrc: () => {
    return (
      '(function () {' +
      COMMON +
      `
  function clean(s) { return String(s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').replace(/\\s+/g, ' ').trim(); }
  var out = [];
  var seen = {};

  function pushItem(it) {
    if (!it || !it.id || seen[it.id]) return;
    if (!it.title && !it.price) return;
    seen[it.id] = 1;
    out.push(it);
  }
  // 拼多多价格字段以「分」为单位（实测 normal_price=1480 → ¥14.8）。
  // 防御：带小数点的值视为已是元。
  function toYuan(numStr) {
    var f = parseFloat(numStr);
    if (isNaN(f)) return '';
    if (numStr.indexOf('.') >= 0) return String(f);
    return String(f / 100);
  }
  function pickPriceVal(o) {
    var keys = ['min_normal_price', 'min_group_price', 'min_on_sale_group_price', 'normal_price', 'price'];
    for (var i = 0; i < keys.length; i++) {
      var v = o[keys[i]];
      if (v == null) continue;
      var num = '';
      if (typeof v === 'object' && v.price != null) num = String(v.price).replace(/[^\\d.]/g, '');
      else if (typeof v === 'string') num = v.replace(/[^\\d.]/g, '');
      else if (typeof v === 'number') num = String(v);
      if (!num) continue;
      var y = toYuan(num);
      if (y) return y;
    }
    return '';
  }
  function pickLink(o, id) {
    var u = o.link_url || o.page_url || '';
    if (typeof u === 'string' && u) return abs(u);
    return id ? 'https://mobile.pinduoduo.com/goods.html?goods_id=' + id : '';
  }

  // ── 通道 1：window.rawData 内嵌 JSON，递归找 goods_id+goods_name 的商品对象 ──
  // 实测字段（首页 rawData.stores）：goods_id / goods_name / sales_tip（本店已拼X件）/
  // normal_price（分）/ hd_thumb_url / link_url（goods.html?goods_id=...）。
  // __SSR__ 实测为数字占位，真正的内嵌数据在 rawData。
  function visitSSR(v, depth) {
    if (!v || typeof v !== 'object' || depth > 9) return;
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) visitSSR(v[i], depth + 1);
      return;
    }
    var gid = v.goods_id || v.goodsId;
    var gname = v.goods_name || v.goodsName;
    if (gid && gname) {
      var id = String(gid);
      var price = pickPriceVal(v);
      pushItem({
        id: id,
        title: clean(gname),
        shop: clean(v.shop_name || v.mall_name || ''),
        price: price,
        priceText: price ? '¥' + price : '',
        salesText: clean(v.sales_tip || v.side_sales_tip || v.salesTip || ''),
        commentsText: '',
        link: pickLink(v, id),
        imageUrl: String(v.hd_thumb_url || v.thumb_url || v.image_url || '')
      });
      return; // 已识别为商品对象，不再深入其内部结构
    }
    var ks = Object.keys(v);
    for (var k = 0; k < ks.length; k++) {
      var nv = v[ks[k]];
      if (nv && typeof nv === 'object') visitSSR(nv, depth + 1);
    }
  }
  try { visitSSR(window.rawData || window.__SSR__, 0); } catch (e) {}

  // ── 通道 2：DOM 兜底。找「恰好 1 个价格 + ≥1 张图」的最小容器作为卡片 ──
  // 注意：H5 把「￥」和数字渲染成相邻的独立叶子元素，需按数字叶子向上合并判定。
  if (!out.length) {
    function isNumLeaf(el) {
      if (el.children.length) return false;
      return /^\\d{1,6}(\\.\\d{1,2})?$/.test((el.textContent || '').trim());
    }
    function priceOf(el) {
      // 数字叶子 → 向上找 ≤3 层内包含「￥ 数字」的最近容器
      var node = el;
      for (var up = 0; up < 3 && node.parentElement; up++) {
        node = node.parentElement;
        var t = clean(node.textContent);
        if (/^[¥￥]\\s?[\\d,]{1,7}(\\.\\d{1,2})?$/.test(t)) return t.replace(/[^\\d.]/g, '');
        if ((node.textContent || '').length > 60) break;
      }
      return '';
    }
    function hashId(s) {
      var h = 5381;
      for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
      return 'h' + h;
    }
    var all = document.querySelectorAll('div, li, a');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var t = clean(el.textContent);
      if (!t || t.length > 160) continue;
      var imgs = el.querySelectorAll('img');
      if (!imgs.length) continue;
      var desc2 = el.querySelectorAll('*');
      var pc = 0, price = '';
      for (var j = 0; j < desc2.length && pc < 2; j++) {
        if (!isNumLeaf(desc2[j])) continue;
        var pv = priceOf(desc2[j]);
        if (!pv) continue;
        pc++;
        if (!price) price = pv;
      }
      if (pc !== 1 || !price) continue; // 外层容器含多个价格会被跳过，天然取最小卡片
      // 标题：img alt → 最长的非价格/销量文本叶子
      var title = clean(imgs[0].getAttribute('alt') || imgs[0].getAttribute('title') || '');
      if (!title) {
        var best = '';
        for (var k2 = 0; k2 < desc2.length; k2++) {
          if (desc2[k2].children.length) continue;
          var tt = clean(desc2[k2].textContent);
          if (!tt || /^[¥￥]/.test(tt) || /^\\d/.test(tt) || /已拼|人已拼|万人团/.test(tt)) continue;
          if (tt.length > best.length && tt.length < 80) best = tt;
        }
        title = best;
      }
      // 销量（拼多多口径「已拼X件」）与店铺
      var salesText = '', shop = '';
      for (var k3 = 0; k3 < desc2.length; k3++) {
        if (desc2[k3].children.length) continue;
        var tx = clean(desc2[k3].textContent);
        if (!salesText && /已拼|人已拼|万人团|销量/.test(tx) && tx.length < 24) salesText = tx;
        if (!shop && /(旗舰店|专卖店|专营店|官方旗舰|自营|品牌店|百货店)$/.test(tx) && tx.length < 30) shop = tx;
      }
      // 链接 / 商品ID
      var link = '';
      var aEl = el.tagName === 'A' ? el : el.querySelector('a[href*="goods"]');
      if (!aEl && el.closest) aEl = el.closest('a[href*="goods"]');
      if (aEl) link = abs(aEl.getAttribute('href') || '');
      var dataId = el.getAttribute('data-goods-id') || '';
      var mm = (link + ' ' + dataId).match(/goods_id=(\\d+)/);
      var id = mm ? mm[1] : dataId;
      if (!id) id = hashId(title + '|' + price); // 无真实 ID 时用标题+价格哈希做去重键
      pushItem({
        id: id, title: title, shop: shop,
        price: price, priceText: '¥' + price,
        salesText: salesText, commentsText: '',
        link: link || (id.charAt(0) !== 'h' ? 'https://mobile.pinduoduo.com/goods.html?goods_id=' + id : ''),
        imageUrl: pickAttr(imgs[0], ['data-src', 'data-lazy-img', 'data-lazyload', 'src'])
      });
    }
  }
  return out;
})()`
    );
  },

  /** 等首屏：以「纯数字叶子 + rawData goods_id」计数，不依赖卡片类名 */
  waitCardsSrc: (n) =>
    '(function (n) {' +
    `
  var c = 0;
  var els = document.querySelectorAll('div, span, p, em, i');
  for (var i = 0; i < els.length; i++) {
    if (els[i].children.length) continue;
    var t = (els[i].textContent || '').trim();
    if (/^\\d{1,6}(\\.\\d{1,2})?$/.test(t)) c++;
  }
  try {
    var s = JSON.stringify(window.rawData || '');
    if (s && s.indexOf('goods_id') >= 0) c += 3;
  } catch (e) {}
  return c >= n;
})(${Number(n)})`,

  clickSortSrc: () => buildClickSortSrc('销量'),
  salesKindSrc: () => null, // H5 无销量维度校验文案，点击即认为生效
  clickPageSrc: () => '(function () { return "none"; })()', // 无分页器，由 infiniteScroll 接管
  riskSrc: () => buildRiskSrc(RISK_PATTERNS),
  parseSalesNumber: parseSales,

  /**
   * 首屏等待超时后的兜底：改走「首页 → 点搜索栏 → 输入 → 提交」交互链路。
   * 已有卡片时直接返回 false（无需修复）。
   */
  fixupSearch: async (page, kw, helpers) => {
    const { emit } = helpers;
    const hasCards = await page.evaluate(module.exports.waitCardsSrc(5)).catch(() => false);
    if (hasCards) return false;
    emit('log', { level: 'warn', msg: '搜索结果页未渲染出商品，改走首页搜索交互链路' });
    await page
      .goto('https://mobile.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 40000 })
      .catch(() => {});
    await sleep(4000);
    // 点顶部搜索栏（坐标：移动视口 390 宽的顶部中央）
    await page.evaluate('window.scrollTo(0, 0)').catch(() => {});
    let clicked = false;
    for (const sel of ['input[type="search"]', '[class*="search"]', 'input']) {
      const el = page.locator(sel).first();
      if (!(await el.count())) continue;
      try {
        await el.click({ timeout: 3000 });
        clicked = true;
        break;
      } catch (_) {}
    }
    if (!clicked) await page.mouse.click(195, 40).catch(() => {});
    await sleep(4000);
    const inp = page.locator('input:visible').first();
    if (!(await inp.count())) {
      emit('log', { level: 'error', msg: '未找到可见搜索框，本关键词跳过' });
      return false;
    }
    await inp.fill(kw).catch(() => {});
    await sleep(1000);
    await page.keyboard.press('Enter').catch(() => {});
    await sleep(6000);
    return true;
  },

  /** 短信登录：填手机号并点「发送验证码」。返回状态码由 engine 记日志 */
  smsFillPhone: (page, phone) =>
    page.evaluate(SMS_FILL_PHONE_SRC + `(${JSON.stringify(String(phone))})`),

  /** 短信登录：填验证码并点「登录」。返回状态码由 engine 记日志 */
  smsSubmitCode: (page, code) =>
    page.evaluate(SMS_SUBMIT_SRC + `(${JSON.stringify(String(code))})`),

  /**
   * 扫码登录入口：落地默认「手机登录」，需先点「扫码登录」页签。
   * 注意：页面文本被塞入零宽字符，精确匹配前必须清洗（实测 trim 匹配不到）。
   */
  enterQrLogin: (page) =>
    page.evaluate(`(function () {
    function clean(s) { return String(s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').replace(/\\s+/g, '').trim(); }
    function vis(el) { var b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; }
    // 已在扫码态则直接成功
    if (document.querySelector('.qr-code-wrapper, img.qr-code-box')) return 'ok:already';
    var els = document.querySelectorAll('button, div, span, a, p, li');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      var s = clean(e.textContent);
      if (s !== '扫码登录' && s !== '扫码') continue;
      if (!vis(e) || e.children.length > 2) continue;
      e.click();
      return 'ok:click';
    }
    return 'not-found';
  })()`),

  /** 拼多多图片：CDN 带裁剪参数（imageMogr2/thumbnail/400x...），剥掉 query 取原图；
   *  双后缀（.a.jpeg，实测 rawData.hd_thumb_url 有此形态）剥掉中间的尺寸标记 */
  imageVariants: (u) => {
    const raw = String(u || '');
    const noQuery = raw.split('?')[0];
    // 仅当剥掉中间标记后仍是图片扩展名才处理（xxx.jpeg.a.jpeg → xxx.jpeg）
    const m = noQuery.match(/^(.+)\.[\w-]{1,4}\.(jpe?g|png|webp)$/i);
    const cleaned = m && /\.(jpe?g|png|webp)$/i.test(m[1]) ? m[1] : noQuery;
    const out = [];
    for (const x of [cleaned, noQuery, raw]) {
      if (x && out.indexOf(x) < 0) out.push(x);
    }
    return out;
  },

  nextPageUrl: () => null,
};
