'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 区间内随机抖动，避免节奏过于规律 */
function jitter(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

async function sleepJitter(min, max) {
  await sleep(jitter(min, max));
}

/**
 * 「2万+人收货」→ 20000；「本月行业热销」等无数字文案 → -1
 * 注意：-1 表示「无数字但排名靠前」，排序时不要强行下沉（skill 第四节）
 */
function parseSales(s) {
  if (!s) return -1;
  const m = String(s).replace(/,/g, '').match(/([\d.]+)\s*(万|w|W)?/);
  if (!m) return -1;
  const n = parseFloat(m[1]);
  if (isNaN(n)) return -1;
  return Math.round(m[2] ? n * 10000 : n);
}

function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 文件名安全化 */
function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 80) || 'export';
}

module.exports = { sleep, jitter, sleepJitter, parseSales, nowStamp, safeName };
