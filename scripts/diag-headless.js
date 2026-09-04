#!/usr/bin/env node
/**
 * 无头模式诊断：看淘宝搜索页在 headless 下实际渲染了什么。
 * 输出 UA / webdriver / 标题 / 卡片数 / 正文摘要 / 截图。
 */
'use strict';
const path = require('path');
const { chromium } = require('../node_modules/playwright');
const { launchOptions } = require('../src/collector/browser');
const paths = require('../src/collector/paths');
const { sleep } = require('../src/collector/util');

(async () => {
  const keyword = (process.argv.find((a) => a.startsWith('--keyword=')) || '--keyword=充电器').split('=')[1];
  const url = 'https://s.taobao.com/search?q=' + encodeURIComponent(keyword);

  const opts = launchOptions();
  console.log('executablePath:', opts.executablePath || '(playwright default)');
  console.log('args:', JSON.stringify(opts.args));

  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'taobao'), opts);
  const page = ctx.pages()[0] || (await ctx.newPage());

  // CDP 覆写 UA：HeadlessChrome → Chrome（版本号保持真实）
  if (opts.headless) {
    const cdp = await ctx.newCDPSession(page);
    const realUa = await page.evaluate('navigator.userAgent');
    const scrubbed = realUa.replace('HeadlessChrome', 'Chrome');
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: scrubbed });
    console.log('UA 覆写:', realUa.slice(60), '→', scrubbed.slice(60));
  }

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto err:', e.message.slice(0, 80)));

  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const info = await page.evaluate(`(function(){
      var links = document.querySelectorAll('a[href*="item.taobao.com"], a[href*="detail.tmall.com"]');
      var glCanvas = document.createElement('canvas');
      var gl = glCanvas.getContext('webgl');
      var renderer = gl ? gl.getParameter(gl.RENDERER) : '(no webgl)';
      var vendor = gl ? gl.getParameter(gl.VENDOR) : '(no webgl)';
      var dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      var unmasked = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '(no dbg)';
      return {
        url: location.href.slice(0, 100),
        ua: navigator.userAgent.slice(52),
        webdriver: navigator.webdriver,
        brands: (navigator.userAgentData && navigator.userAgentData.brands ? JSON.stringify(navigator.userAgentData.brands) : '(none)'),
        mobile: (navigator.userAgentData && navigator.userAgentData.mobile),
        plugins: navigator.plugins.length,
        renderer: String(renderer).slice(0, 60),
        unmaskedRenderer: String(unmasked).slice(0, 80),
        vendor: String(vendor),
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory,
        chrome: typeof window.chrome,
        cardLinks: links.length,
        bodyLen: (document.body ? document.body.innerText : '').length,
      };
    })()`).catch((e) => ({ err: e.message.slice(0, 80) }));
    if (i === 0) console.log('指纹:', JSON.stringify(info, null, 2));
    else console.log('[' + (i + 1) + 's] cardLinks=' + info.cardLinks + ' bodyLen=' + info.bodyLen);
    if (info.cardLinks > 0) break;
  }

  await page.screenshot({ path: path.join('data', 'headless-diag.png'), fullPage: false }).catch(() => {});
  console.log('截图: data/headless-diag.png');
  await ctx.close().catch(() => {});
  process.exit(0);
})();
