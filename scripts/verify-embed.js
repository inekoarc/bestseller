'use strict';
// 聚焦验证：图片是否真正嵌入（锚定）到所属单元格，而非浮动层。
const fs = require('fs');
const path = require('path');
const os = require('os');

// 一张 80x120 的红色 PNG（竖图），用于验证比例/锚点
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAAB4CAYAAABjknToAAAAUklEQVR4nO3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAvg0hAAABh0n3AAAAAElFTkSuQmCC';

(async () => {
  const ExcelJS = require('exceljs');
  const { ExcelWriter } = require(path.join(__dirname, '..', 'src', 'collector', 'excel-writer'));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-'));
  const imgFile = path.join(tmp, 'pic.png');
  fs.writeFileSync(imgFile, Buffer.from(PNG_B64, 'base64'));

  const out = path.join(tmp, 'out.xlsx');
  const w = new ExcelWriter({ filePath: out, imageMode: 'embed' });
  w.addAll([
    { platform: '淘宝', keyword: '测试', id: 'A1', title: '商品A', shop: '店A', price: '9.9', sales: 100, salesText: '100人收货', link: 'https://item.taobao.com/item.htm?id=A1', imageFile: imgFile },
    { platform: '京东', keyword: '测试', id: 'B2', title: '商品B', shop: '店B', price: '19.9', sales: 200, salesText: '200已售', link: 'https://item.jd.com/B2.html', imageFile: imgFile },
  ]);
  await w.flush();

  // 解包 drawing xml 检查锚点
  const { execSync } = require('child_process');
  const xml = execSync(`unzip -p "${out}" "xl/drawings/drawing1.xml"`).toString();

  const twoCell = /<xdr:twoCellAnchor[\s>]/i.test(xml);
  const oneCell = /<xdr:oneCellAnchor[\s>]/i.test(xml);
  const absolute = /<xdr:absoluteAnchor[\s>]/i.test(xml);
  const pics = (xml.match(/<xdr:pic>/g) || []).length;
  const fromCells = [...xml.matchAll(/<xdr:from>([\s\S]*?)<\/xdr:from>/g)].map((m) => {
    const col = (m[1].match(/<xdr:col>(\d+)<\/xdr:col>/) || [])[1];
    const row = (m[1].match(/<xdr:row>(\d+)<\/xdr:row>/) || [])[1];
    return { col, row };
  });
  const toCells = [...xml.matchAll(/<xdr:to>([\s\S]*?)<\/xdr:to>/g)].map((m) => {
    const col = (m[1].match(/<xdr:col>(\d+)<\/xdr:col>/) || [])[1];
    const row = (m[1].match(/<xdr:row>(\d+)<\/xdr:row>/) || [])[1];
    return { col, row };
  });

  console.log('=== 嵌入验证结果 ===');
  console.log('图片数量 (xdr:pic):', pics);
  console.log('锚点类型: twoCellAnchor=' + twoCell + ' oneCellAnchor=' + oneCell + ' absoluteAnchor=' + absolute);
  console.log('每个图片的 from 单元格:', JSON.stringify(fromCells));
  console.log('每个图片的 to 单元格:', JSON.stringify(toCells));
  console.log('商品首图列 IMG_COL=9(0-based) → xlsx 列号应为 9');

  const ok = pics === 2 && twoCell && !oneCell && !absolute &&
    fromCells.every((c) => c.col === '9' && (c.row === '1' || c.row === '2')) &&
    toCells.every((c) => c.col === '10' && (c.row === '2' || c.row === '3'));
  console.log(ok ? '\n✅ 图片已正确锚定到第 10 列(商品首图)对应行单元格内' : '\n❌ 锚点不符合预期');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
