'use strict';

/**
 * 拼多多三次探测：模拟真实搜索交互链路。
 *   node scripts/probe-pdd3.js --keyword=充电器
 *
 * 链路：首页 → 点击顶部搜索栏 → 输入关键词 → 提交 → 观察
 *  - 落地 URL（是否进入真正的搜索结果页）
 *  - 是否出现登录墙 / 验证码
 *  - 结果卡片是否与关键词相关
 */

const path = require('path');

function parseArgs() {
  const a = {};
  for (const s of process.argv.slice(2)) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(s);
    if (m) a[m[1]] = m[2] === undefined ? true : m[2];
  }
  return a;
}
const args = parseArgs();
const keyword = args.keyword || '充电器';
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright'));
const { launchOptions } = require(path.join(root, 'src', 'collector', 'browser'));
const paths = require(path.join(root, 'src', 'collector', 'paths'));
const { sleep } = require(path.join(root, 'src', 'collector', 'util'));

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const SCAN_SRC = `(function () {
  function clean(s) { return String(s || '').replace(/[\\u200b\\u200c\\u200d\\ufeff]/g, '').replace(/\\s+/g, ' ').trim(); }
  var els = document.querySelectorAll('a, div, li');
  var out = [];
  var seen = {};
  for (var i = 0; i < els.length; i++) {
    var e = els[i];
    var t = clean(e.textContent);
    if (!t || t.length > 160) continue;
    if (!/[¥￥]\\s?[\\d.]/.test(t)) continue;
    if (seen[t]) continue;
    seen[t] = 1;
    var imgs = e.querySelectorAll('img');
    out.push({
      tag: e.tagName,
      cls: String(e.className || '').slice(0, 60),
      href: (e.getAttribute && e.getAttribute('href')) || '',
      text: t.slice(0, 110),
      imgs: imgs.length
    });
  }
  var body = clean(document.body ? document.body.innerText : '');
  return { url: location.href, cards: out.slice(0, 12), head: body.slice(0, 200) };
})()`;

(async () => {
  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'pdd-probe'), {
    ...launchOptions(),
    userAgent: MOBILE_UA,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('framenavigated', (f) => {
    if (f === page.mainFrame()) console.log('  [导航] ' + f.url().slice(0, 120));
  });

  console.log('═══ 步骤1：打开首页 ═══');
  await page.goto('https://mobile.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  await sleep(5000);
  console.log('落地: ' + page.url());

  console.log('\n═══ 步骤2：点击搜索栏 ═══');
  // 首页顶部有假的搜索栏（div 伪装），点击后进入真正的搜索页
  const barCandidates = [
    'input[type="search"]',
    'input',
    '[class*="search"]',
    '[placeholder*="搜索"]',
  ];
  let entered = false;
  for (const sel of barCandidates) {
    const el = page.locator(sel).first();
    if (!(await el.count())) continue;
    try {
      await el.click({ timeout: 4000 });
      console.log('点击成功: ' + sel);
      entered = true;
      break;
    } catch (_) {}
  }
  if (!entered) {
    // 兜底：坐标点顶部中央
    await page.evaluate('window.scrollTo(0,0)');
    await page.mouse.click(195, 40);
    console.log('坐标点击 (195,40)');
  }
  await sleep(5000);
  console.log('搜索页落地: ' + page.url());
  const s1 = await page.evaluate(SCAN_SRC).catch(() => null);
  if (s1) {
    console.log('搜索页首屏: ' + s1.head.slice(0, 120));
    console.log('可见input: ' + (await page.locator('input:visible').count()));
  }

  console.log('\n═══ 步骤3：输入关键词并提交 ═══');
  const visibleInput = page.locator('input:visible').first();
  if (await visibleInput.count()) {
    await visibleInput.fill(keyword).catch((e) => console.log('fill: ' + e.message.slice(0, 60)));
    await sleep(1200);
    // 提交：先试搜索按钮，再试 Enter
    const btn = page.locator('[class*="search"] button, button:has-text("搜索"), [class*="btn"]').first();
    let submitted = false;
    if (await btn.count()) {
      try {
        await btn.click({ timeout: 3000 });
        submitted = true;
        console.log('点搜索按钮提交');
      } catch (_) {}
    }
    if (!submitted) {
      await page.keyboard.press('Enter');
      console.log('Enter 提交');
    }
    await sleep(6000);
  } else {
    console.log('无可见输入框，中止提交');
  }

  for (let i = 0; i < 6; i++) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await sleep(1200);
  }
  const s2 = await page.evaluate(SCAN_SRC).catch((e) => ({ head: 'ERR ' + e.message }));
  console.log('\n═══ 步骤4：结果页形态 ═══');
  console.log('最终落地: ' + s2.url);
  console.log('首屏文本: ' + s2.head.slice(0, 180));
  const kwHit = s2.cards.filter((c) => /充电|快充|插头|线/.test(c.text)).length;
  console.log('卡片 ' + s2.cards.length + ' 条，关键词相关 ' + kwHit + ' 条:');
  for (const c of s2.cards.slice(0, 10)) console.log('  [' + c.tag + '.' + c.cls + '] ' + c.text.slice(0, 100) + ' href=' + String(c.href).slice(0, 70));

  await page.screenshot({ path: path.join(paths.ensureDir('probe'), 'pdd3-final.png'), fullPage: false }).catch(() => {});
  console.log('\n截图: data/probe/pdd3-final.png');
  await ctx.close().catch(() => {});
  process.exit(0);
})();
