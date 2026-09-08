'use strict';
// 校验 out12 win-unpacked 内 app.asar 是否包含最新 engine.js（防跑旧包）
const asar = require('@electron/asar');
const fs = require('fs');
const app = 'out12/win-unpacked/resources/app.asar';
const list = asar.listPackage(app);

// 顶层条目
const top = list.filter((p) => p.split(/[\\/]/).filter(Boolean).length === 1);
console.log('top-level:', top.join(' | '));

// 找 engine.js
const engPath = list.find((p) => p.endsWith('collector/engine.js') || p.endsWith('collector\\engine.js') || p.endsWith('engine.js'));
console.log('engine.js in asar:', engPath || 'NOT FOUND');

const disk = fs.readFileSync('src/collector/engine.js', 'utf8');
const marker1 = '绝不自动降级短信';
const marker2 = 'att < 4';
const pkgRaw = asar.extractFile(app, 'package.json').toString('utf8');
console.log('asar version:', JSON.parse(pkgRaw).version);

if (engPath) {
  // extractFile 路径键在不同平台不一致，直接整包解压到临时目录读取最稳
  const os = require('os');
  const path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asar-verify-'));
  asar.extractAll(app, tmp);
  const eng = fs.readFileSync(path.join(tmp, 'src', 'collector', 'engine.js'), 'utf8');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('marker1(扫码主路径):', eng.includes(marker1) ? 'OK' : 'MISSING!');
  console.log('marker2(重试4次):  ', eng.includes(marker2) ? 'OK' : 'MISSING!');
  console.log('与磁盘一致:', eng === disk ? 'YES' : 'NO');
}
