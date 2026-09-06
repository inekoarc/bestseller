'use strict';

// 诊断：打开拼多多登录页，列出所有文本含「登录」的可交互元素，
// 确认 SMS_SUBMIT_SRC 当前的选择器会不会点错元素。
const path = require('path');
const browserMod = require('../src/collector/browser');
const paths = require('../src/collector/paths');

(async () => {
  const userDataDir = path.join(paths.getBase(), 'pw-data', 'pdd');
  const lo = browserMod.launchOptions();
  lo.viewport = { width: 390, height: 844 };
  lo.isMobile = true;
  lo.hasTouch = true;
  lo.userAgent =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  const { chromium } = require('playwright');
  const ctx = await chromium.launchPersistentContext(userDataDir, lo);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await browserMod.scrubHeadlessUa(page);

  try {
    await page.goto('https://mobile.pinduoduo.com/login.html', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(5000);

    // 列出所有含「登录」文本的元素（含 tag / href / type / 是否按钮）
    const list = await page.evaluate(`(function(){
      function clean(s){ return String(s||'').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g,'').replace(/\\s+/g,'').trim(); }
      function vis(el){ var b=el.getBoundingClientRect(); return b.width>0&&b.height>0; }
      var out=[];
      var all=document.querySelectorAll('button, input, a, div, span, p, li, label');
      for(var i=0;i<all.length;i++){
        var e=all[i];
        var t=clean(e.textContent||e.value||e.innerText||'');
        if(t.indexOf('登录')<0) continue;
        if(!vis(e)) continue;
        out.push({
          tag:e.tagName,
          type:e.type||'',
          href:(e.getAttribute&&e.getAttribute('href'))||'',
          text:t.slice(0,30),
          children:e.children.length,
          cls:String(e.className||'').slice(0,40)
        });
      }
      return out;
    })()`).catch((e) => [{ err: e.message }]);
    console.log('含「登录」的可交互元素（DOM 顺序，即脚本命中顺序）：');
    for (const it of list) console.log('  ', JSON.stringify(it));

    // 同时列出可见 input（手机号/验证码输入框）
    const inputs = await page.evaluate(`(function(){
      function vis(el){ var b=el.getBoundingClientRect(); return b.width>0&&b.height>0; }
      var out=[]; var all=document.querySelectorAll('input');
      for(var i=0;i<all.length;i++){ var e=all[i]; if(!vis(e))continue; out.push({type:e.type, ph:e.placeholder, name:e.name, id:e.id, val:e.value}); }
      return out;
    })()`).catch((e) => [{ err: e.message }]);
    console.log('\\n可见 input：');
    for (const it of inputs) console.log('  ', JSON.stringify(it));
  } catch (e) {
    console.log('EXCEPTION', e.stack || e.message);
  } finally {
    await ctx.close().catch(() => {});
  }
})();
