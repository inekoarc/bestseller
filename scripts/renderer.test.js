'use strict';

/**
 * 渲染端回归测试：用 jsdom 真实加载 index.html + app.js。
 * 背景：els 漏绑定导致 app.js 顶层抛错 → init 不执行 → 平台列表空白，
 * 该故障模式只有真实加载才能发现（静态 id 核对无效）。
 */
const path = require('path');
const root = path.join(__dirname, '..');
const { JSDOM } = require(path.join(root, 'node_modules', 'jsdom'));
const fs = require('fs');

const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
const appjs = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');

const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.api = {
  platforms: async () => ([
    { id: 'taobao', name: '淘宝', experimental: false, desc: '已支持' },
    { id: 'jd', name: '京东', experimental: false, desc: '已支持' },
    { id: 'pdd', name: '拼多多', experimental: false, desc: '移动端 H5' },
    { id: 'douyin', name: '抖音商城', experimental: true, reason: '暂未启用' },
  ]),
  start: async () => ({ ok: true }),
  stop: async () => ({ ok: true }),
  pause: async () => ({}),
  resume: async () => ({}),
  pickOutputDir: async () => null,
  openFile: async () => ({ ok: true }),
  showInFolder: async () => ({ ok: true }),
  smsAction: async () => ({ ok: true }),
  onState: () => () => {},
  onLog: () => () => {},
  onQr: () => () => {},
  onProgress: () => () => {},
  onDone: () => () => {},
  onError: () => () => {},
};

let failed = false;
try {
  w.eval(appjs);
} catch (e) {
  console.error('✗ app.js 加载抛错: ' + e.message);
  failed = true;
}

setTimeout(() => {
  const doc = w.document;
  const cards = doc.querySelectorAll('.platform-card');
  if (cards.length !== 4) {
    console.error('✗ 平台卡片数应为 4，实际 ' + cards.length);
    failed = true;
  }
  const names = [...cards].map((c) => c.querySelector('.name') && c.querySelector('.name').textContent);
  if (!names.some((n) => n === '拼多多')) {
    console.error('✗ 卡片中没有拼多多: ' + JSON.stringify(names));
    failed = true;
  }
  // els 绑定完整性：app.js 用到的每个 els.xxx 必须在 els 对象里定义
  const m = appjs.match(/const els = \{[\s\S]*?\n\};/);
  const defined = new Set([...m[0].matchAll(/([a-zA-Z]+):/g)].map((x) => x[1]));
  const used = new Set([...appjs.matchAll(/els\.([a-zA-Z]+)/g)].map((x) => x[1]));
  const missing = [...used].filter((u) => !defined.has(u));
  if (missing.length) {
    console.error('✗ els 缺少绑定: ' + JSON.stringify(missing));
    failed = true;
  }
  if (failed) process.exit(1);
  console.log('✓ app.js 加载无异常；平台卡片 4 张（含拼多多）；els 绑定完整');
  process.exit(0);
}, 500);
