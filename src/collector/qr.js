'use strict';

/**
 * 登录二维码定位。
 * 核心经验来自 taobao-search-scraping skill：
 * 1) 二维码是异步加载的，必须 networkidle + 轮询尺寸，不能 domcontentloaded + 固定等待。
 * 2) 不能「返回首个匹配」：淘宝登录页左侧有 118x183 的手机引导图 img#qrcode-img-guide，
 *    id 里也含 "qrcode"，必须按宽高比过滤掉非正方形元素。
 */

// 收集全部候选 → 按宽高比/面积排序 → 给最优候选打标记
const COLLECT_QR_SRC = `(function () {
  var cands = [];
  var selectors = [
    '#passport-main-qrcode-img',
    'img[src*="/qr.m.jd.com/"]',
    '#qrcode-img canvas', '.qrcode-img canvas', '.qrcode canvas', '#qrcode canvas',
    'canvas[class*="qr"]', 'canvas[class*="qrcode"]',
    'img[src*="qrcode"]', 'img[class*="qrcode"]', 'img[class*="qr"]',
    '.qrcode img', '.login-qrcode img', '.qr-code img', '.qr-img img', '#qrImg',
    'img[id*="qr"]'
  ];
  selectors.forEach(function (sel) {
    var els;
    try { els = document.querySelectorAll(sel); } catch (e) { return; }
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.width < 60 || r.height < 60) continue;
      var ratio = r.width / r.height;
      if (ratio < 0.7 || ratio > 1.45) continue;
      cands.push({ el: els[i], w: r.width, h: r.height, ratio: ratio, area: r.width * r.height });
    }
  });

  var containers = ['.qrcode-img', '#qrcode-img', '.qrcode', '.qrcode-login', '.qrcode-main', '#qrcode'];
  for (var c = 0; c < containers.length; c++) {
    var el;
    try { el = document.querySelector(containers[c]); } catch (e) { continue; }
    if (!el) continue;
    var r2 = el.getBoundingClientRect();
    if (r2.width < 80 || r2.height < 80) continue;
    var ratio2 = r2.width / r2.height;
    if (ratio2 < 0.6 || ratio2 > 1.5) continue;
    cands.push({ el: el, w: r2.width, h: r2.height, ratio: ratio2, area: r2.width * r2.height, container: true });
  }

  if (!cands.length) return { found: false };
  cands.sort(function (a, b) {
    var ar = Math.abs(1 - a.ratio), br = Math.abs(1 - b.ratio);
    if (ar !== br) return ar - br;
    return b.area - a.area;
  });

  var best = cands[0];
  var prev = document.querySelectorAll('[data-bq-qr]');
  for (var p = 0; p < prev.length; p++) prev[p].removeAttribute('data-bq-qr');
  if (best.el && best.el.setAttribute) best.el.setAttribute('data-bq-qr', '1');

  var r3 = best.el.getBoundingClientRect();
  return {
    found: true,
    container: !!best.container,
    w: Math.round(r3.width),
    h: Math.round(r3.height),
    rect: {
      x: Math.round(r3.left + window.scrollX),
      y: Math.round(r3.top + window.scrollY),
      width: Math.round(r3.width),
      height: Math.round(r3.height)
    }
  };
})()`;

// 二维码是否已渲染出尺寸（轮询用）
const QR_READY_SRC = `(function () {
  var selectors = [
    '#passport-main-qrcode-img',
    'img[id*="qrcode"]', '.qrcode-img img', 'img[src*="/qr.m.jd.com/"]',
    '#qrcode-img canvas', '.qrcode-img canvas', '.qrcode canvas', '#qrcode canvas',
    'canvas[class*="qr"]', 'img[class*="qr"]'
  ];
  for (var i = 0; i < selectors.length; i++) {
    var el;
    try { el = document.querySelector(selectors[i]); } catch (e) { continue; }
    if (!el) continue;
    var r = el.getBoundingClientRect();
    if (r.width >= 20 && r.height >= 20) return true;
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0) return false;
  }
  return false;
})()`;

// 二维码过期 / 加载失败 → 点刷新，而不是直接放弃
const QR_REFRESH_SRC = `(function () {
  var refresh = document.querySelector('.refresh-btn, a[clstag*="qrcode_refresh"], .qrcode-refresh, [class*="refresh"]');
  if (refresh) { refresh.click(); return 'refresh-btn'; }
  var error = document.querySelector('#J-qrcoderror:not(.hide), .qrcode-error02:not(.hide), .qrcode-error:not(.hide)');
  if (error) {
    var a = error.querySelector('a');
    if (a) { a.click(); return 'error-link'; }
  }
  return 'none';
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询等待二维码渲染就绪 */
async function waitForQRReady(page, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(QR_READY_SRC).catch(() => false);
    if (ok) return true;
    await sleep(400);
  }
  return false;
}

/**
 * 抓取当前页面上的二维码图片。
 * @returns {Promise<{buffer: Buffer, dataUrl: string, rect: object}|null>}
 */
async function grabQR(page, timeout = 15000) {
  const ready = await waitForQRReady(page, timeout);
  if (!ready) return null;

  const info = await page.evaluate(COLLECT_QR_SRC).catch(() => null);
  if (!info || !info.found) return null;

  let buffer = null;
  try {
    const loc = page.locator('[data-bq-qr="1"]').first();
    if (await loc.count()) buffer = await loc.screenshot({ timeout: 8000 });
  } catch (_) {
    buffer = null;
  }
  if (!buffer && info.rect) {
    buffer = await page.screenshot({ clip: info.rect, timeout: 8000 }).catch(() => null);
  }
  if (!buffer || buffer.length < 200) return null;

  return {
    buffer,
    dataUrl: 'data:image/png;base64,' + buffer.toString('base64'),
    rect: info.rect,
  };
}

/** 二维码过期时尝试点击刷新 */
async function refreshQR(page) {
  const r = await page.evaluate(QR_REFRESH_SRC).catch(() => 'none');
  return r !== 'none';
}

module.exports = { COLLECT_QR_SRC, QR_READY_SRC, QR_REFRESH_SRC, waitForQRReady, grabQR, refreshQR };
