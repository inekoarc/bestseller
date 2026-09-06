#!/usr/bin/env node
'use strict';

/**
 * 拼多多短信登录诊断脚本
 *
 * 以有头模式打开拼多多 H5 登录页，让用户在浏览器里手动完成短信登录，
 * 脚本在后台每 2 秒打印：当前 URL、PDDAccessToken 等关键 Cookie 是否存在、
 * 页面可见提示文本。用于定位"点击登录后一直等待结果"的根因。
 *
 * 用法：
 *   cd D:\Project\Bestseller
 *   set BESTSELLER_HEADLESS=false
 *   node scripts/diagnose-pdd-login.js
 *
 * 然后在弹出的浏览器窗口里：输入手机号 → 点发送验证码 → 输入短信验证码 → 点登录。
 * 观察命令行输出的 cookie 变化和页面提示。
 */

const path = require('path');
const fs = require('fs');

function chromiumLazy() {
  try {
    return require('playwright').chromium;
  } catch (e) {
    throw new Error('未安装 playwright：' + e.message);
  }
}

const ROOT = path.resolve(__dirname, '..');
const userDataDir = path.join(ROOT, 'pw-data', 'pdd-diagnose');

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

async function run() {
  ensureDir(userDataDir);
  const headless = process.env.BESTSELLER_HEADLESS !== 'false';
  console.log(`启动浏览器（headless=${headless}）...`);
  console.log('用户数据目录：', userDataDir);

  const ctx = await chromiumLazy().launchPersistentContext(userDataDir, {
    headless,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const page = ctx.pages()[0] || (await ctx.newPage());

  page.on('console', (msg) => {
    const t = msg.text();
    if (/pdd|login|token|error|fail/i.test(t)) {
      console.log('[page console]', msg.type(), t.slice(0, 300));
    }
  });
  page.on('response', (resp) => {
    const u = resp.url();
    if (/login|verify|token|api\/|passport/i.test(u)) {
      console.log('[network]', resp.status(), u.slice(0, 200));
    }
  });

  console.log('\n请在本窗口或弹出的浏览器窗口里完成短信登录。');
  console.log('步骤：输入手机号 → 点「发送验证码」→ 输入短信验证码 → 点「登录」。\n');

  await page.goto('https://mobile.pinduoduo.com/login.html', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  const start = Date.now();
  const seenCookies = new Set();

  while (Date.now() - start < 300000) {
    await new Promise((r) => setTimeout(r, 2000));

    const url = page.url();
    const cookies = await ctx.cookies().catch(() => []);
    const names = cookies.map((c) => c.name);
    const accessToken = cookies.find((c) => c.name === 'PDDAccessToken');
    const pdduid = cookies.find((c) => c.name === 'pdduid');
    const pddUserId = cookies.find((c) => /pdd_user_id|pddUserId/i.test(c.name));

    // 只要出现新的 cookie 名就打印一次
    const newNames = names.filter((n) => !seenCookies.has(n));
    newNames.forEach((n) => seenCookies.add(n));

    const toast = await page
      .evaluate(() => {
        const cands = document.querySelectorAll('div, p, span');
        for (let i = 0; i < cands.length; i++) {
          const e = cands[i];
          if (e.children.length) continue;
          const cls = String(e.className || '');
          const pCls = e.parentElement ? String(e.parentElement.className || '') : '';
          if (!/toast|tip|notice|message|dialog|popup|hint/i.test(cls + ' ' + pCls)) continue;
          const t = (e.textContent || '').replace(/[\u200b\u200c\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
          if (t && t.length <= 80) return t;
        }
        return '';
      })
      .catch(() => '');

    const line = [
      `[${new Date().toLocaleTimeString()}]`,
      `URL=${url.replace(/\?.*$/, '')}`,
      `cookies=[${names.join(',')}]`,
      accessToken ? `PDDAccessToken=✓` : 'PDDAccessToken=✗',
      pdduid ? `pdduid=${pdduid.value ? '✓' : 'empty'}` : 'pdduid=✗',
      pddUserId ? `${pddUserId.name}=✓` : 'pddUserId=✗',
      newNames.length ? `NEW=[${newNames.join(',')}]` : '',
      toast ? `toast=${JSON.stringify(toast)}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    console.log(line);

    if (accessToken && accessToken.value && accessToken.value !== '0') {
      console.log('\n✓ 检测到 PDDAccessToken，登录态已建立。');
      console.log('请手动关闭浏览器窗口，或按 Ctrl+C 结束脚本。');
      await new Promise(() => {});
    }
  }

  console.log('\n5 分钟超时，未检测到登录态。');
  await ctx.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
