'use strict';

/**
 * 注入浏览器的脚本一律生成为「字符串 IIFE + 参数直接拼进源码」。
 * 原因（skill 坑 1）：page.evaluate(字符串, arg) 时 arg 会被静默丢弃，
 * 写成 IIFE 把参数拼进调用里才可靠，且 pkg/打包后同样能序列化。
 */

// 公共小工具，会被拼进每个脚本
const COMMON = `
  function q(root, s) { if (!s) return null; try { return root.querySelector(s); } catch (e) { return null; } }
  function qa(root, s) { if (!s) return []; try { return root.querySelectorAll(s); } catch (e) { return []; } }
  function txt(el) { return el ? String(el.textContent || '').replace(/\\s+/g, ' ').trim() : ''; }
  function abs(href) {
    if (!href) return '';
    href = String(href).replace(/&amp;/g, '&');
    if (href.indexOf('//') === 0) return 'https:' + href;
    if (href.indexOf('/') === 0) { try { return new URL(href, location.href).href; } catch (e) { return href; } }
    return href;
  }
  function firstText(root, sel) {
    var els = qa(root, sel);
    for (var i = 0; i < els.length; i++) { var t = txt(els[i]); if (t) return t; }
    return '';
  }
  function pickAttr(el, names) {
    if (!el) return '';
    var srcFallback = '';
    for (var i = 0; i < names.length; i++) {
      var n = names[i];
      var v = el.getAttribute(n);
      if (!v) continue;
      if (String(v).indexOf('data:image') === 0) continue;
      var low = String(v).toLowerCase();
      if (/placeholder|blank|loading|default|1x1|grey|gray|\\.gif$/.test(low)) continue;
      var u = abs(v);
      if (n === 'src') { if (!srcFallback) srcFallback = u; continue; }
      return u;
    }
    return srcFallback;
  }
`;

/**
 * 唯一的解析脚本。
 * 关键设计：翻页后的「页面是否换过」判定也复用本脚本的返回值（取 id 列表），
 * 而不是另写一个 PID 提取脚本 —— 从根上消除 skill 坑 5（两套取链接逻辑不一致
 * 导致每次翻页白等 10 秒）。
 */
function buildParseSrc(sel) {
  return (
    '(function (sel) {' +
    COMMON +
    `
  var cards = document.querySelectorAll(sel.card);
  var out = [];
  var linkRe = sel.linkRe ? new RegExp(sel.linkRe) : null;
  var idRe = sel.idRe ? new RegExp(sel.idRe) : null;
  for (var i = 0; i < cards.length; i++) {
    var c = cards[i];
    var link = '';
    var links = qa(c, 'a[href]');
    for (var k = 0; k < links.length; k++) {
      var h = abs(links[k].getAttribute('href') || '');
      if (!h) continue;
      if (linkRe) { if (linkRe.test(h)) { link = h; break; } }
      else if (!link) { link = h; }
    }
    if (!link) {
      var a0 = q(c, sel.link);
      link = a0 ? abs(a0.getAttribute('href') || '') : '';
    }
    var id = '';
    if (idRe) { var m = link.match(idRe); if (m) id = m[1]; }
    if (!id) {
      var sku = c.getAttribute('data-sku') || c.getAttribute('data-id') || c.getAttribute('data-pid') || '';
      if (sku) id = String(sku);
    }
    var imgEl = q(c, sel.img);
    out.push({
      id: id,
      title: firstText(c, sel.title) || (imgEl ? (imgEl.getAttribute('title') || imgEl.getAttribute('alt') || '') : ''),
      shop: firstText(c, sel.shop),
      price: (firstText(c, sel.priceInt) + firstText(c, sel.priceFloat)).replace(/[^\\d.]/g, ''),
      priceText: (firstText(c, sel.priceInt) + firstText(c, sel.priceFloat)).trim(),
      salesText: firstText(c, sel.sales),
      commentsText: firstText(c, sel.comments),
      link: link,
      imageUrl: pickAttr(imgEl, ['data-src', 'data-lazy-img', 'data-lazyload', 'data-origin', 'src'])
    });
  }
  return out;
})(` +
    JSON.stringify(sel) +
    ')'
  );
}

/** 等卡片渲染到至少 n 个（淘宝首屏真实卡片要 20~30s，先出骨架屏） */
function buildWaitCardsSrc(cardSelector, n) {
  return (
    '(function () { try { return document.querySelectorAll(' +
    JSON.stringify(cardSelector) +
    ').length >= ' +
    Number(n) +
    '; } catch (e) { return false; } })()'
  );
}

/** 点击文案为 label 的排序页签（在前 n 个候选中取最像页签的那个） */
function buildClickSortSrc(label) {
  return (
    '(function () {' +
    `
  var want = ${JSON.stringify(label)};
  var els = document.querySelectorAll('li, div, span, a, em');
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    if ((e.textContent || '').trim() !== want) continue;
    if (e.children.length > 2) continue;
    e.click();
    return true;
  }
  return false;
})()`
  );
}

/** 统计销量文案类型（淘宝：人收货 = 销量排序生效；人付款 = 综合排序） */
function buildSalesKindSrc(salesSelector, sortedRe, defaultRe) {
  return (
    '(function () {' +
    COMMON +
    `
  var els = document.querySelectorAll(${JSON.stringify(salesSelector)});
  var recv = 0, pay = 0, other = 0;
  var sortedRe = ${JSON.stringify(sortedRe)};
  var defaultRe = ${JSON.stringify(defaultRe)};
  var sorted = new RegExp(sortedRe), def = new RegExp(defaultRe);
  for (var i = 0; i < els.length; i++) {
    var s = txt(els[i]);
    if (!s) continue;
    if (sorted.test(s)) recv++;
    else if (def.test(s)) pay++;
    else other++;
  }
  return { recv: recv, pay: pay, other: other, total: recv + pay + other };
})()`
  );
}

/** 点击分页器第 n 页；找不到页码则点「下一页」 */
function buildClickPageSrc(n) {
  return (
    '(function (n) {' +
    `
  var want = String(n);
  var els = document.querySelectorAll('.next-pagination-item, li, button, a, span');
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    if ((e.textContent || '').trim() !== want) continue;
    var cls = String(e.className || '');
    if (!/pagination|pagi|page/i.test(cls)) continue;
    if (/disabled/i.test(cls)) continue;
    e.click();
    return 'num:' + want;
  }
  for (var j = 0; j < els.length; j++) {
    var el = els[j];
    var label = el.getAttribute('aria-label') || '';
    var text = (el.textContent || '').trim();
    if (!(label.indexOf('下一页') >= 0 || label.indexOf('next') >= 0 || text === '下一页' || text === '>' || text === '›')) continue;
    if (/disabled/i.test(String(el.className || ''))) continue;
    el.click();
    return 'next';
  }
  return 'none';
})(` +
    Number(n) +
    ')'
  );
}

/** 页面是否命中风控文案 */
function buildRiskSrc(patterns) {
  return (
    '(function () {' +
    `
  var pats = ${JSON.stringify(patterns || [])};
  if (!pats.length) return '';
  var body = (document.body ? document.body.innerText : '') || '';
  var sample = body.slice(0, 6000);
  for (var i = 0; i < pats.length; i++) {
    if (sample.indexOf(pats[i]) >= 0) return pats[i];
  }
  return '';
})()`
  );
}

module.exports = {
  COMMON,
  buildParseSrc,
  buildWaitCardsSrc,
  buildClickSortSrc,
  buildSalesKindSrc,
  buildClickPageSrc,
  buildRiskSrc,
};
