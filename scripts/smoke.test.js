'use strict';

/**
 * jsdom 冒烟测试：校验核心模块的形状、可序列化、Excel 可正常落盘。
 *   node scripts/smoke.test.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const tmp = path.join(os.tmpdir(), 'bestseller-smoke-' + Date.now());
fs.mkdirSync(tmp, { recursive: true });

let failures = 0;
function ok(cond, msg) {
  if (cond) {
    console.log('  ✓ ' + msg);
  } else {
    console.log('  ✗ ' + msg);
    failures++;
  }
}

function section(t) {
  console.log('\n── ' + t + ' ──');
}

(async () => {
  section('平台适配器');
  const platforms = require(path.join(ROOT, 'src', 'collector', 'platforms'));
  ok(platforms.ALL.length >= 3, '三平台已注册');
  for (const p of platforms.ALL) {
    ok(typeof p.id === 'string' && p.id, p.id + '.id');
    ok(typeof p.name === 'string' && p.name, p.id + '.name');
    ok(typeof p.homeUrl === 'string', p.id + '.homeUrl');
    ok(typeof p.searchUrl === 'function', p.id + '.searchUrl');
    ok(typeof p.isLoggedInSrc === 'string', p.id + '.isLoggedInSrc');
    ok(typeof p.parseSrc === 'function', p.id + '.parseSrc');
    ok(typeof p.imageVariants === 'function', p.id + '.imageVariants');
    const src = p.parseSrc();
    ok(typeof src === 'string' && src.length > 500, p.id + '.parseSrc 字符串 IIFE 可用');
    try { new Function(src); ok(true, p.id + '.parseSrc JS 语法 OK'); } catch (e) { ok(false, p.id + '.parseSrc JS 语法: ' + e.message); }
  }

  section('生成脚本可序列化（无函数闭包）');
  const taobao = platforms.get('taobao');
  for (const s of [taobao.parseSrc(), taobao.waitCardsSrc(10), taobao.clickSortSrc(), taobao.clickPageSrc(3), taobao.riskSrc(), taobao.isLoggedInSrc]) {
    ok(typeof s === 'string', '脚本是字符串');
    try { new Function(s); ok(true, '可作为 Function 构造'); } catch (e) { ok(false, 'Function 构造失败: ' + e.message); }
  }

  section('Excel 写盘');
  const { ExcelWriter } = require(path.join(ROOT, 'src', 'collector', 'excel-writer'));
  const xlsxPath = path.join(tmp, 'smoke.xlsx');
  const writer = new ExcelWriter({ filePath: xlsxPath, imageMode: 'embed' });
  writer.add({ platform: '淘宝', keyword: '充电器', id: 'A1', title: '样例', shop: '样例店', price: '99.0', sales: 2000, salesText: '2000+人收货', link: 'https://example.com', imageUrl: '', remark: '', time: '2026-09-03 12:00:00' });
  writer.add({ platform: '淘宝', keyword: '手机壳', id: 'A2', title: '样例2', shop: '样例店2', price: '19.0', sales: -1, salesText: '本月行业热销', link: 'https://example.com/2', imageUrl: '', remark: '', time: '2026-09-03 12:00:01' });
  await writer.flush();
  ok(fs.existsSync(xlsxPath), 'xlsx 已写入：' + path.basename(xlsxPath));
  const stat = fs.statSync(xlsxPath);
  ok(stat.size > 3000, 'xlsx 文件大小合理：' + stat.size + 'B');

  // 验证可被 ExcelJS 读回
  const ExcelJS = require(path.join(ROOT, 'node_modules', 'exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const ws = wb.worksheets[0];
  ok(ws.rowCount === 3, '工作表含表头 + 2 行数据 = 3 行');
  ok(ws.getCell('A2').value === '淘宝', 'A2 = 平台「淘宝」');
  ok(ws.getCell('C2').value === 'A1', 'C2 = 商品ID「A1」');

  section('util');
  const { parseSales } = require(path.join(ROOT, 'src', 'collector', 'util'));
  ok(parseSales('2万+人收货') === 20000, '「2万+人收货」→ 20000');
  ok(parseSales('3000+人付款') === 3000, '「3000+人付款」→ 3000');
  ok(parseSales('本月行业热销') === -1, '「本月行业热销」→ -1');
  ok(parseSales('1.5万已售') === 15000, '「1.5万已售」→ 15000');

  section('二维码 collectQRs 函数语法');
  const { COLLECT_QR_SRC, QR_READY_SRC, QR_REFRESH_SRC } = require(path.join(ROOT, 'src', 'collector', 'qr'));
  for (const [n, s] of [['COLLECT_QR_SRC', COLLECT_QR_SRC], ['QR_READY_SRC', QR_READY_SRC], ['QR_REFRESH_SRC', QR_REFRESH_SRC]]) {
    try { new Function(s); ok(true, n + ' 语法 OK'); } catch (e) { ok(false, n + ' 语法: ' + e.message); }
  }

  console.log('\n────────────────────────');
  console.log(failures === 0 ? '✓ 全部通过' : '✗ ' + failures + ' 项失败');
  // cleanup
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});