'use strict';

// 验证：在当前 _x_no_login_launch=1 风控态下，点击「扫码登录」页签是否仍能渲染二维码。
// 若能，则扫码（手机认证）是绕开该风控的可行路径。
const path = require('path');
const browserMod = require('../src/collector/browser');
const paths = require('../src/collector/paths');
const { grabQR } = require('../src/collector/qr');

(async () => {
  const userDataDir = path.join(paths.getBase(), 'pw-data', 'pdd');
  const lo = browserMod.launchOptions();
  lo.viewport = { width: 390, height: 844 };
  lo.isMobile = true; lo.hasTouch = true;
  lo.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  const { chromium } = require('playwright');
  const ctx = await chromium.launchPersistentContext(userDataDir, lo);
  const page = ctx.pages()[0] || (await ctx.newPage());
  await browserMod.scrubHeadlessUa(page);
  await page.goto('https://mobile.pinduoduo.com/login.html', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(5000);

  console.log('初始 URL:', page.url());

  // 点「扫码登录」页签（清洗零宽字符）
  const r = await page.evaluate(`(function(){
    function clean(s){ return String(s||'').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g,'').replace(/\\s+/g,'').trim(); }
    function vis(el){ var b=el.getBoundingClientRect(); return b.width>0&&b.height>0; }
    var els=document.querySelectorAll('button,div,span,a,p,li');
    for(var i=0;i<els.length;i++){ var e=els[i]; var s=clean(e.textContent); if(s!=='扫码登录'&&s!=='扫码')continue; if(!vis(e)||e.children.length>2)continue; e.click(); return 'clicked:'+s; }
    return 'NOT_FOUND';
  })()`).catch((e)=>'ERR:'+e.message);
  console.log('扫码页签:', r);
  await page.waitForTimeout(3000);

  const qr = await grabQR(page, 8000).catch(() => null);
  console.log('二维码是否渲染:', qr ? '是 (dataUrl长度=' + (qr.dataUrl||'').length + ')' : '否');
  console.log('当前 URL:', page.url());
  const hasImg = await page.evaluate(`(function(){ var i=document.querySelector('img.qr-code-box'); return !!i; })()`).catch(()=>false);
  console.log('img.qr-code-box 存在:', hasImg);

  await ctx.close().catch(() => {});
})();
