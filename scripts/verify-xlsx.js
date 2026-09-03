'use strict';

/**
 * 校验导出的 xlsx：行数、列头、前 N 行字段、嵌入图片数量与锚点位置。
 * 用法：node scripts/verify-xlsx.js [文件路径] [预览行数]
 * 不传文件路径时自动取 data/output 下最新的 xlsx。
 */

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const root = path.resolve(__dirname, '..');

function findLatestXlsx() {
  const outDir = path.join(root, 'data', 'output');
  if (!fs.existsSync(outDir)) return null;
  let best = null;
  for (const dir of fs.readdirSync(outDir)) {
    const full = path.join(outDir, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full)) {
      if (!f.endsWith('.xlsx') || f.startsWith('~$')) continue;
      const p = path.join(full, f);
      const st = fs.statSync(p);
      if (!best || st.mtimeMs > best.mt) best = { path: p, mt: st.mtimeMs };
    }
  }
  return best && best.path;
}

async function main() {
  const arg2 = process.argv[2];
  const isPath = arg2 && !/^\d+$/.test(arg2);
  const file = isPath ? path.resolve(arg2) : findLatestXlsx();
  if (!file || !fs.existsSync(file)) {
    console.error('未找到 xlsx 文件：' + file);
    process.exit(1);
  }
  const preview = Number(isPath ? process.argv[3] : arg2) || 3;

  const sizeMB = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
  console.log('文件：' + path.relative(root, file));
  console.log('大小：' + sizeMB + ' MB');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);

  console.log('工作表：' + wb.worksheets.map((w) => w.name).join(', '));

  const ws = wb.worksheets[0];
  const header = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => {
    header[i] = c.value == null ? '' : String(c.value);
  });
  console.log('\n表头(' + header.filter(Boolean).length + '列)：' + header.filter(Boolean).join(' | '));

  // 嵌入图片统计（只取安全字段，避免 Worksheet 循环引用）
  const images = ws.getImages().map((img) => {
    const tl = img.range && img.range.tl;
    return {
      row: tl ? tl.nativeRow + 1 : null,
      col: tl ? tl.nativeCol + 1 : null,
      w: img.range && img.range.ext ? Math.round(img.range.ext.width) : null,
      h: img.range && img.range.ext ? Math.round(img.range.ext.height) : null,
    };
  });
  console.log('\n嵌入图片：' + images.length + ' 张');
  const byRow = {};
  images.forEach((i) => { byRow[i.row] = (byRow[i.row] || 0) + 1; });
  console.log('图片所在行：' + Object.keys(byRow).slice(0, 10).join(', ') + (Object.keys(byRow).length > 10 ? ' ...' : ''));

  const rowCount = ws.rowCount;
  const dataRows = rowCount - 1;
  console.log('\n数据行：' + dataRows + ' 行');

  // 字段完整性
  const idx = (name) => header.findIndex((h) => h === name);
  const fields = ['商品ID', '店铺名称', '商品价格', '销量', '商品链接'];
  // 注：「商品首图」列单元格文本故意留空，图片以浮层锚定覆盖其上，故不计入缺失统计
  const miss = {};
  fields.forEach((f) => { miss[f] = 0; });
  for (let r = 2; r <= rowCount; r++) {
    fields.forEach((f) => {
      const c = idx(f);
      const v = c > 0 ? ws.getRow(r).getCell(c).value : null;
      if (v == null || String(v).trim() === '') miss[f]++;
    });
  }
  console.log('\n字段缺失统计（共 ' + dataRows + ' 行）：');
  fields.forEach((f) => {
    const n = miss[f];
    const rate = dataRows ? ((n / dataRows) * 100).toFixed(1) : '0.0';
    console.log('  ' + f.padEnd(6, '　') + ' 缺失 ' + n + ' (' + rate + '%)');
  });

  console.log('\n前 ' + Math.min(preview, dataRows) + ' 行预览：');
  for (let r = 2; r <= Math.min(preview + 1, rowCount); r++) {
    const row = ws.getRow(r);
    const get = (name) => {
      const c = idx(name);
      if (c <= 0) return '';
      const v = row.getCell(c).value;
      if (v && typeof v === 'object' && v.text != null) return String(v.text);
      return v == null ? '' : String(v);
    };
    const h = row.height;
    console.log('  ── 第 ' + (r - 1) + ' 条' + (h ? '（行高 ' + Math.round(h) + '）' : ''));
    console.log('     商品ID  : ' + get('商品ID'));
    console.log('     标题    : ' + String(get('商品标题')).slice(0, 40));
    console.log('     店铺    : ' + get('店铺名称'));
    console.log('     价格    : ' + get('商品价格'));
    console.log('     销量    : ' + get('销量') + '（原文：' + get('销量原文') + '）');
    console.log('     链接    : ' + String(get('商品链接')).slice(0, 60));
    console.log('     备注    : ' + (get('备注') || '—'));
  }
}

main().catch((e) => {
  console.error('校验失败：' + e.message);
  process.exit(1);
});
