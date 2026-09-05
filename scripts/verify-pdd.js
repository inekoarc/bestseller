'use strict';

/**
 * 验证 pdd 适配器的解析通道（不登录，用首页推荐流验证 SSR 通道——
 * 其 __SSR__ 内嵌商品对象结构与搜索结果页一致）。
 *   node scripts/verify-pdd.js
 */

const path = require('path');
const root = path.join(__dirname, '..');
const { chromium } = require(path.join(root, 'node_modules', 'playwright'));
const { launchOptions } = require(path.join(root, 'src', 'collector', 'browser'));
const paths = require(path.join(root, 'src', 'collector', 'paths'));
const { sleep } = require(path.join(root, 'src', 'collector', 'util'));
const pdd = require(path.join(root, 'src', 'collector', 'platforms', 'pdd'));

(async () => {
  const lo = launchOptions();
  lo.viewport = pdd.viewport;
  lo.isMobile = true;
  lo.hasTouch = true;
  lo.userAgent = pdd.userAgent;

  const ctx = await chromium.launchPersistentContext(paths.ensureDir('pw-data', 'pdd-probe'), lo);
  const page = ctx.pages()[0] || (await ctx.newPage());

  await page.goto('https://mobile.pinduoduo.com/', { waitUntil: 'domcontentloaded', timeout: 40000 }).catch(() => {});
  await sleep(5000);
  for (let i = 0; i < 3; i++) {
    await page.evaluate('window.scrollTo(0, document.body.scrollHeight)').catch(() => {});
    await sleep(1500);
  }

  // 1) 登录态判定（未登录应返回 false）
  const loggedIn = await page.evaluate(pdd.isLoggedInSrc).catch((e) => 'ERR:' + e.message);
  console.log('isLoggedInSrc（未登录应为 false）: ' + JSON.stringify(loggedIn));

  // 2) waitCardsSrc（应为 true）
  const waitOk = await page.evaluate(pdd.waitCardsSrc(5)).catch((e) => 'ERR:' + e.message);
  console.log('waitCardsSrc(5)（应为 true）: ' + JSON.stringify(waitOk));

  // 3) parseSrc：SSR 通道提取
  const items = await page.evaluate(pdd.parseSrc()).catch((e) => ({ err: e.message }));
  if (items.err) {
    console.log('parseSrc ERR: ' + items.err);
  } else {
    console.log('parseSrc 提取 ' + items.length + ' 条');
    const withTitle = items.filter((x) => x.title).length;
    const withPrice = items.filter((x) => x.price).length;
    const withSales = items.filter((x) => x.salesText).length;
    const withImg = items.filter((x) => x.imageUrl).length;
    const withLink = items.filter((x) => x.link).length;
    console.log('字段覆盖: title ' + withTitle + ' / price ' + withPrice + ' / sales ' + withSales +
      ' / img ' + withImg + ' / link ' + withLink);
    console.log('\n样本（前 5 条）:');
    for (const it of items.slice(0, 5)) {
      console.log('  id=' + it.id);
      console.log('    title=' + String(it.title).slice(0, 50));
      console.log('    price=' + it.price + '  sales=' + it.salesText + '  shop=' + (it.shop || '(无)'));
      console.log('    img=' + String(it.imageUrl).slice(0, 80));
      console.log('    link=' + String(it.link).slice(0, 80));
    }
    // 4) parseSalesNumber 验证
    const { parseSales } = require(path.join(root, 'src', 'collector', 'util'));
    const samples = items.slice(0, 8).map((x) => x.salesText).filter(Boolean);
    console.log('\nsalesText → 数字:');
    for (const s of samples) console.log('  "' + s + '" → ' + parseSales(s));
  }

  // 5) riskSrc / clickPageSrc / imageVariants 单元验证
  const risk = await page.evaluate(pdd.riskSrc()).catch((e) => 'ERR:' + e.message);
  console.log('\nriskSrc（首页应为空）: ' + JSON.stringify(risk));
  const clickPage = await page.evaluate(pdd.clickPageSrc(2)).catch(() => 'ERR');
  console.log('clickPageSrc（应为 none，由无限滚动接管）: ' + JSON.stringify(clickPage));
  const img = 'https://img.pddpic.com/mms-goods-image/2026-08-22/xxx.jpeg.a.jpeg?imageMogr2/thumbnail/400x%7CimageView2/2/w/400/q/80';
  console.log('imageVariants: ' + JSON.stringify(pdd.imageVariants(img), null, 1));

  await page.screenshot({ path: path.join(paths.ensureDir('probe'), 'pdd-verify.png') }).catch(() => {});
  await ctx.close().catch(() => {});
  process.exit(0);
})();
