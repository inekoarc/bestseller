'use strict';

const taobao = require('./platforms/taobao');
const jd = require('./platforms/jd');
const douyin = require('./platforms/douyin');
const pdd = require('./platforms/pdd');

const ALL = [taobao, jd, pdd, douyin];

function get(id) {
  return ALL.find((p) => p.id === id) || null;
}

function list() {
  return ALL.map((p) => ({
    id: p.id,
    name: p.name,
    experimental: !!p.experimental,
    reason: p.experimentalReason || '',
    desc: p.desc || '已支持',
  }));
}

module.exports = { ALL, get, list };
