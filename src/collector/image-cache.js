'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('./paths');

const _is = require('image-size');
const imageSize = typeof _is === 'function' ? _is : _is.imageSize || _is.default;

// 关键：不要声明 webp/avif，否则 CDN 会回 webp，而 Excel 单元格嵌图只稳支持 jpeg/png/gif
const ACCEPT = 'image/jpeg,image/png,image/gif,image/*,*/*;q=0.8';

function normalizeUrl(url, base) {
  if (!url) return '';
  let u = String(url).trim();
  if (u.startsWith('//')) u = 'https:' + u;
  else if (u.startsWith('/')) {
    try {
      u = new URL(u, base).href;
    } catch (_) {
      /* 保持原样 */
    }
  }
  return u.replace(/&amp;/g, '&');
}

function cacheKey(url) {
  return crypto.createHash('md5').update(url).digest('hex').slice(0, 20);
}

/**
 * 下载图片。
 * @param {import('playwright').BrowserContext} context 复用浏览器上下文（自带 cookie / UA）
 * @param {string} url
 * @param {{referer?: string, timeout?: number, transform?: Function, cacheDir?: string, key?: string}} opts
 */
async function download(context, url, opts = {}) {
  const { referer = '', timeout = 15000, transform = null, cacheDir = null, key = null } = opts;
  const full = normalizeUrl(url, referer);
  if (!/^https?:/i.test(full)) throw new Error('非法图片地址: ' + String(url).slice(0, 80));

  const variants = [];
  if (transform) {
    const t = transform(full) || [];
    if (Array.isArray(t)) variants.push(...t.filter(Boolean));
    else variants.push(t);
  }
  variants.push(full);

  let lastErr = null;
  for (const v of variants) {
    try {
      const resp = await context.request.get(v, {
        timeout,
        headers: { Referer: referer, Accept: ACCEPT },
      });
      if (!resp.ok()) throw new Error('HTTP ' + resp.status());
      const buf = await resp.body();
      if (!buf || buf.length < 512) throw new Error('响应过小(' + (buf ? buf.length : 0) + 'B)');

      let dim = null;
      try {
        dim = imageSize(buf);
      } catch (_) {
        dim = null;
      }
      if (!dim || !dim.width || !dim.height) throw new Error('无法识别图片格式');

      let file = null;
      if (cacheDir) {
        fs.mkdirSync(cacheDir, { recursive: true });
        file = path.join(cacheDir, (key || cacheKey(v)) + '.' + (dim.type || 'jpg'));
        fs.writeFileSync(file, buf);
      }
      return { buffer: buf, file, ext: dim.type, width: dim.width, height: dim.height, url: v };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('图片下载失败');
}

module.exports = { download, normalizeUrl, cacheKey, imageSize };
