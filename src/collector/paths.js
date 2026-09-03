'use strict';

const path = require('path');
const fs = require('fs');

let _base = null;

/** 由 Electron 主进程注入 userData 目录；CLI/探测脚本下走项目内 data/ */
function setBase(dir) {
  _base = dir;
  return _base;
}

function getBase() {
  if (_base) return _base;
  return path.join(__dirname, '..', '..', 'data');
}

function ensureDir(...parts) {
  const d = path.join(getBase(), ...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

module.exports = { setBase, getBase, ensureDir };
