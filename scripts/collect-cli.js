'use strict';

/**
 * CLI 端到端验证脚本：直接走 engine 流程，验证采集、销量排序、解析、Excel 写入的链路通畅。
 * 不走 Electron UI；登录二维码保存到 data/probe/<platform>-qrcode.png，可手动扫码继续。
 *
 *   node scripts/collect-cli.js --platform=taobao --keyword=充电器 --topN=20
 *
 * 注：本脚本主要为无 GUI 环境下的冒烟；正常使用时建议走 Electron UI。
 */

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
    if (m) a[m[1]] = m[2] === undefined ? true : m[2];
  }
  return a;
}

const args = parseArgs();
const platformId = args.platform || 'taobao';
const keyword = args.keyword || '充电器';
const topN = Number(args.topN) || 20;

const platforms = require(path.join(ROOT, 'src', 'collector', 'platforms'));
const { createCollector } = require(path.join(ROOT, 'src', 'collector', 'engine'));
const paths = require(path.join(ROOT, 'src', 'collector', 'paths'));

const adapter = platforms.get(platformId);
if (!adapter) {
  console.error('未知平台');
  process.exit(1);
}

const events = [];
function emit(channel, payload) {
  events.push({ channel, payload, t: new Date().toISOString() });
  const tag = '[' + channel + ']';
  if (channel === 'log') {
    console.log(tag, (payload.level || '').padEnd(5), payload.msg);
  } else if (channel === 'progress') {
    const pct = payload.target ? Math.round((payload.fetched / payload.target) * 100) : 0;
    process.stdout.write('\r' + tag + ' ' + (payload.fetched || 0) + '/' + (payload.target || 0) + ' (' + pct + '%) ' + (payload.note || '') + '         ');
  } else if (channel === 'qr') {
    console.log(tag, '二维码已存盘：' + payload.file);
  } else if (channel === 'state') {
    console.log(tag, JSON.stringify(payload));
  } else if (channel === 'done') {
    console.log('\n' + tag, JSON.stringify(payload));
  } else if (channel === 'error') {
    console.log('\n' + tag, JSON.stringify(payload));
  }
}

(async () => {
  console.log('=== CLI 端到端验证 ===');
  console.log('平台：' + adapter.name);
  console.log('关键词：' + keyword);
  console.log('目标：每关键词 ' + topN + ' 条');
  console.log('数据目录：' + paths.getBase());

  const collector = createCollector(adapter, {
    keywords: [keyword],
    topN,
    imageMode: 'embed',
    splitByKeyword: false,
    fetchDetail: false,
  }, emit);

  // 30 分钟总超时（主要是给扫码留时间）
  const tm = setTimeout(() => {
    console.log('\n超时未完成，已强制退出');
    collector.stop();
    setTimeout(() => process.exit(2), 2000);
  }, 30 * 60 * 1000);

  try {
    await collector.start();
    clearTimeout(tm);
    setTimeout(() => process.exit(0), 500);
  } catch (e) {
    clearTimeout(tm);
    console.error('\nFAIL:', e && e.message ? e.message : e);
    setTimeout(() => process.exit(1), 500);
  }
})();