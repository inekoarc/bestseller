'use strict';

/**
 * engine 干跑验证：拼多多平台走到「短信登录等待」分支后取消。
 *   node scripts/dryrun-pdd-engine.js
 * 预期日志顺序：启动浏览器 → 打开首页 → 检测未登录 → 短信登录提示 → 15s 后取消退出
 */

const path = require('path');
const root = path.join(__dirname, '..');
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '';
const platforms = require(path.join(root, 'src', 'collector', 'platforms'));
const { createCollector } = require(path.join(root, 'src', 'collector', 'engine'));

const adapter = platforms.get('pdd');
if (!adapter) throw new Error('pdd 平台未注册');

const c = createCollector(
  adapter,
  { keywords: ['充电器'], topN: 5, imageMode: 'embed', splitByKeyword: false },
  (channel, payload) => {
    if (channel === 'log') console.log('[' + payload.level + '] ' + payload.msg);
    else if (channel === 'state') console.log('[state] ' + JSON.stringify(payload));
    else if (channel === 'qr') console.log('[qr] 收到二维码（不应出现在短信模式）');
  }
);

c.start().catch((e) => {
  console.log('[结束] ' + e.message);
  process.exit(0);
});

// 15 秒后：请求切换到短信登录（验证扫码→短信备用链路），再取消
setTimeout(() => {
  console.log('--- 切换短信登录 ---');
  console.log('use-sms: ' + JSON.stringify(c.handleSmsAction({ type: 'use-sms' })));
  setTimeout(() => {
    console.log('--- 发送验证码（短信链路） ---');
    console.log('send-code: ' + JSON.stringify(c.handleSmsAction({ type: 'send-code', phone: '13800138000' })));
    setTimeout(() => {
      c.stop();
      console.log('--- 已请求停止 ---');
      setTimeout(() => process.exit(0), 8000);
    }, 6000);
  }, 6000);
}, 15000);
