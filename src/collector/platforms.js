'use strict';

const taobao = require('./platforms/taobao');
const jd = require('./platforms/jd');
const douyin = require('./platforms/douyin');

const ALL = [taobao, jd, douyin];

function get(id) {
  return ALL.find((p) => p.id === id) || null;
}

function list() {
  return ALL.map((p) => ({
    id: p.id,
    name: p.name,
    experimental: !!p.experimental,
    reason: p.experimentalReason || '',
  }));
}

module.exports = { ALL, get, list };
