'use strict';

// 诊断：用与 app 完全相同的浏览器/上下文，打开拼多多登录页，
// 打印 Cookie 命名空间 + localStorage 键，验证 PDDAccessToken 假设是否成立。
// 不修改任何文件，仅读取。

const path = require('path');
const browserMod = require('../src/collector/browser');
const paths = require('../src/collector/paths');

(async () => {
  const userDataDir = path.join(paths.getBase(), 'pw-data', 'pdd');
  console.log('userDataDir =', userDataDir);

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
    console.log('\n=== 打开 home ===');
    await page.goto('https://mobile.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('home goto err', e.message));
    await page.waitForTimeout(4000);

    const cookiesHome = await ctx.cookies();
    console.log('Cookie 总数(home):', cookiesHome.length);
    console.log('Cookie 名称:', cookiesHome.map((c) => c.name + (c.httpOnly ? '(H)' : '')).join(', '));
    const pdd = cookiesHome.filter((c) => /pinduoduo|yankeduo/i.test(c.domain || ''));
    console.log('\npinduoduo 域 Cookie:');
    for (const c of pdd) {
      console.log('  ', c.name, '| domain=', c.domain, '| httpOnly=', c.httpOnly, '| value=', (c.value || '').slice(0, 40));
    }
    const found = pdd.find((c) => c.name === 'PDDAccessToken');
    console.log('\nPDDAccessToken 是否存在:', found ? '是 (value=' + (found.value || '').slice(0, 30) + ')' : '否');

    const lsHome = await page.evaluate('(function(){ try { return Object.keys(localStorage); } catch(e){ return ["<err:"+e.message+">"]; } })()').catch((e) => ['<err:' + e.message + '>']);
    const ssHome = await page.evaluate('(function(){ try { return Object.keys(sessionStorage); } catch(e){ return ["<err:"+e.message+">"]; } })()').catch((e) => ['<err:' + e.message + '>']);
    console.log('\nlocalStorage 键:', lsHome.join(', ') || '(空)');
    console.log('sessionStorage 键:', ssHome.join(', ') || '(空)');

    console.log('\n=== 打开 login.html ===');
    await page.goto('https://mobile.pinduoduo.com/login.html', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.log('login goto err', e.message));
    await page.waitForTimeout(4000);

    const cookiesLogin = await ctx.cookies();
    const pddLogin = cookiesLogin.filter((c) => /pinduoduo|yankeduo/i.test(c.domain || ''));
    const found2 = pddLogin.find((c) => c.name === 'PDDAccessToken');
    console.log('login 后 PDDAccessToken 是否存在:', found2 ? '是' : '否');
    console.log('login 页 document.cookie 是否含 PDDAccessToken:', (await page.evaluate('document.cookie').catch(() => '')).includes('PDDAccessToken'));

    const lsKeys = await page.evaluate('(function(){ try { var ks=Object.keys(localStorage); return ks.length? ks.join(", ") : "(空)"; } catch(e){ return "<err:"+e.message+">"; } })()').catch((e) => '<err:' + e.message + '>');
    console.log('login 页 localStorage 键:', lsKeys);
  } catch (e) {
    console.log('EXCEPTION', e.stack || e.message);
  } finally {
    await ctx.close().catch(() => {});
  }
})();
