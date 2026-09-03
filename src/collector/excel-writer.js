'use strict';

const fs = require('fs');
const ExcelJS = require('exceljs');
const { imageSize } = require('./image-cache');

const COLUMNS = [
  { key: 'platform', header: '平台', width: 8 },
  { key: 'keyword', header: '关键词', width: 18 },
  { key: 'id', header: '商品ID', width: 22 },
  { key: 'title', header: '商品标题', width: 42 },
  { key: 'shop', header: '店铺名称', width: 24 },
  { key: 'price', header: '商品价格', width: 12 },
  { key: 'sales', header: '销量', width: 12 },
  { key: 'salesText', header: '销量原文', width: 16 },
  { key: 'link', header: '商品链接', width: 46 },
  { key: 'image', header: '商品首图', width: 22 },
  { key: 'remark', header: '备注', width: 20 },
  { key: 'time', header: '采集时间', width: 20 },
];

const IMG_COL = 9; // 0-based，「商品首图」列
const IMG_DISPLAY_W = 160; // 单元格内显示宽（px）
const IMG_MAX_H = 200; // 显示高上限（px），竖图不至于撑爆行

const HEADER_FILL = 'FF2A2F3A';
const HEADER_FONT = 'FFE6E9EF';

class ExcelWriter {
  /**
   * @param {{filePath: string, imageMode?: 'embed'|'link', splitByKeyword?: boolean}} opts
   */
  constructor(opts) {
    this.filePath = opts.filePath;
    this.imageMode = opts.imageMode || 'embed';
    this.splitByKeyword = !!opts.splitByKeyword;
    this.rows = [];
    this.writing = false;
    this.pending = false;
    this.lastFlushMs = 0;
    this.flushInterval = 20; // 自适应：每 N 条落一次盘
  }

  add(row) {
    this.rows.push(row);
  }

  addAll(rows) {
    for (const r of rows) this.add(r);
  }

  /** 自适应落盘：flush 变慢就拉长间隔，避免后期每条重建整个 workbook */
  maybeFlush(force = false) {
    if (!force && this.rows.length > 0 && this.rows.length % this.flushInterval !== 0) return false;
    this.flush();
    return true;
  }

  flush() {
    if (this.writing) {
      this.pending = true;
      return Promise.resolve();
    }
    this.writing = true;
    this.pending = false;
    const t0 = Date.now();
    return this._build()
      .catch((e) => {
        this.lastError = e && e.message ? e.message : String(e);
      })
      .then(() => {
        this.lastFlushMs = Date.now() - t0;
        this.writing = false;
        if (this.lastFlushMs > 8000 && this.flushInterval < 200) {
          this.flushInterval = Math.min(200, this.flushInterval * 2);
        }
        if (this.pending) return this.flush();
        return undefined;
      });
  }

  async _build() {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Bestseller';
    wb.created = new Date();

    const groups = this.splitByKeyword ? groupByKeyword(this.rows) : [['商品数据', this.rows]];

    for (const [sheetName, rows] of groups) {
      const ws = wb.addWorksheet(sanitizeSheetName(sheetName));
      ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

      const h = ws.getRow(1);
      h.font = { bold: true, color: { argb: HEADER_FONT } };
      h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
      h.alignment = { vertical: 'middle', horizontal: 'center' };
      h.height = 22;
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const r0 = i + 1; // 0-based 行号
        const xl = ws.getRow(r0 + 1);

        for (let c = 0; c < COLUMNS.length; c++) {
          const key = COLUMNS[c].key;
          if (key === 'image') continue;
          if (key === 'link') {
            xl.getCell(c + 1).value = { text: row.link || '', hyperlink: row.link || undefined };
            xl.getCell(c + 1).font = { color: { argb: 'FF4A9EFF' }, underline: true };
          } else {
            xl.getCell(c + 1).value = row[key] !== undefined && row[key] !== null ? row[key] : '';
          }
        }
        xl.alignment = { vertical: 'middle', wrapText: false };
        xl.getCell(IMG_COL + 1).alignment = { vertical: 'middle', horizontal: 'center' };

        if (this.imageMode === 'embed' && row.imageFile && fs.existsSync(row.imageFile)) {
          const ok = embedImage(wb, ws, row.imageFile, r0, xl);
          if (!ok) xl.getCell(IMG_COL + 1).value = '图解析失败';
        } else {
          xl.getCell(IMG_COL + 1).value = row.imageError || row.imageUrl || '图获取失败';
        }
      }
    }

    await wb.xlsx.writeFile(this.filePath);
  }
}

function embedImage(wb, ws, file, r0, xlRow) {
  let buf, dim;
  try {
    buf = fs.readFileSync(file);
    dim = imageSize(buf);
  } catch (_) {
    return false;
  }
  if (!dim || !dim.width || !dim.height) return false;

  // 只稳支持 Excel 能渲染的格式
  if (!['jpg', 'jpeg', 'png', 'gif'].includes(String(dim.type || '').toLowerCase())) return false;

  // 依据图片原始比例计算显示高，使单元格比例≈图片比例，避免被拉变形。
  // 单元格宽固定为 IMG_DISPLAY_W 对应列宽，行高=dispH*0.75（px→pt），
  // 于是单元格像素比 (IMG_DISPLAY_W : dispH) 与图片原始比一致 → 不拉伸。
  let dispH = (dim.height * IMG_DISPLAY_W) / dim.width;
  if (dispH > IMG_MAX_H) dispH = IMG_MAX_H;
  if (dispH < 40) dispH = 40;
  xlRow.height = dispH * 0.75; // px → pt

  // 关键修复：用 tl + br 双单元格锚点把图片钉在所属单元格矩形内。
  // 这样图片是「随单元格移动/缩放」的嵌入式对象，而不是浮在表格上方的独立绘图层。
  const imageId = wb.addImage({ buffer: buf, extension: normalizeExt(dim.type) });
  ws.addImage(imageId, {
    tl: { col: IMG_COL, row: r0 }, // 锚定单元格左上角
    br: { col: IMG_COL + 1, row: r0 + 1 }, // 锚定同一单元格右下角 → 图片填满该单元格
    editAs: 'twoCell',
  });
  return true;
}

function normalizeExt(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'jpeg') return 'jpg';
  if (t === 'jpg' || t === 'png' || t === 'gif') return t;
  return 'png';
}

function groupByKeyword(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.keyword || '未命名';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return [...map.entries()];
}

function sanitizeSheetName(name) {
  const s = String(name).replace(/[\\\/\?\*\[\]:]/g, '_').slice(0, 31);
  return s || 'Sheet';
}

module.exports = { ExcelWriter, COLUMNS, IMG_COL, IMG_DISPLAY_W, IMG_MAX_H };
