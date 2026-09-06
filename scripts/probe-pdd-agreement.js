'use strict';

// 诊断：确认「登录」按钮是否默认 disabled，以及「同意协议」开关的真实形态。
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

    const info = await page.evaluate(`(function(){
      function clean(s){ return String(s||'').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g,'').replace(/\\s+/g,'').trim(); }
      function vis(el){ var b=el.getBoundingClientRect(); return b.width>0&&b.height>0; }
      // 登录按钮
      var btn = document.querySelector('button[type="submit"]');
      var btnInfo = btn ? { text: clean(btn.textContent), disabled: btn.disabled, cls: String(btn.className||'').slice(0,50) } : null;
      // 协议开关：文本含「同意/协议/隐私」的可点击元素（很可能是 div/span，不是 input）
      var agree = [];
      var all = document.querySelectorAll('div, span, a, label, i, p');
      for (var i=0;i<all.length;i++){
        var e=all[i];
        var t=clean(e.textContent||'');
        if(!/同意|协议|隐私|条款/.test(t)) continue;
        if(!vis(e)) continue;
        // 跳过纯说明文案（过长），保留可点开关
        agree.push({ tag:e.tagName, text:t.slice(0,40), children:e.children.length, cls:String(e.className||'').slice(0,40), hasCheckboxSibling: !!e.querySelector('input[type=checkbox]') });
      }
      // 任何 checkbox
      var cbs = [];
      var inputs = document.querySelectorAll('input');
      for (var j=0;j<inputs.length;j++){ if(inputs[j].type==='checkbox') cbs.push({id:inputs[j].id,name:inputs[j].name,checked:inputs[j].checked}); }
      return { btn: btnInfo, agree: agree.slice(0,8), checkboxes: cbs };
    })()`).catch((e) => ({ err: e.message }));
    console.log(JSON.stringify(info, null, 2));
  } catch (e) {
    console.log('EXCEPTION', e.stack || e.message);
  } finally {
    await ctx.close().catch(() => {});
  }
})();
