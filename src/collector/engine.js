'use strict';

const path = require('path');
const fs = require('fs');

let _chromium;
function chromiumLazy() {
  if (_chromium) return _chromium;
  try {
    _chromium = require('playwright').chromium;
  } catch (e) {
    throw new Error('未安装 playwright：' + e.message);
  }
  return _chromium;
}

const { launchOptions } = require('./browser');
const { grabQR } = require('./qr');
const { download } = require('./image-cache');
const { ExcelWriter } = require('./excel-writer');
const paths = require('./paths');
const { sleep, sleepJitter, parseSales, nowStamp, safeName } = require('./util');

/** 受限并发执行 */
async function parallelLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let i = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (i < tasks.length) {
      const idx = i++;
      try {
        results[idx] = { ok: true, value: await tasks[idx]() };
      } catch (e) {
        results[idx] = { ok: false, error: e };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/** 评估当前 keyword 进度是否达到目标（用于多关键词总进度） */
function findPlatformSearchSelector(adapter) {
  return adapter.selectors.card;
}

function nowStampFileSafe() {
  return nowStamp().replace(/[ :]/g, '-');
}

function createCollector(adapter, cfg, emit) {
  const state = {
    canceled: false,
    paused: false,
    ctx: null,
    writer: null,
    outFile: null,
    imageCacheDir: null,
    totalDone: 0,
  };

  const userDataDir = paths.ensureDir('pw-data', adapter.id);

  async function start() {
    if (!cfg.keywords || !cfg.keywords.length) throw new Error('请填写至少一个关键词');
    cfg.topN = Math.max(1, Number(cfg.topN) || 50);

    const stamp = nowStampFileSafe();
    const folder = paths.ensureDir('output', stamp);
    const baseName = safeName(adapter.id + '-' + cfg.keywords.join('_') + '-' + stamp);
    state.outFile = path.join(folder, baseName + '.xlsx');
    state.imageCacheDir = paths.ensureDir('images', baseName);

    state.writer = new ExcelWriter({
      filePath: state.outFile,
      imageMode: cfg.imageMode || 'embed',
      splitByKeyword: !!cfg.splitByKeyword,
    });

    emit('log', { level: 'info', msg: '启动浏览器：' + adapter.name });
    emit('log', { level: 'info', msg: '输出文件：' + state.outFile });

    state.ctx = await chromiumLazy().launchPersistentContext(userDataDir, launchOptions());
    const page = state.ctx.pages()[0] || (await state.ctx.newPage());

    emit('state', { phase: 'login-check' });
    await page.goto(adapter.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(3000);

    let loggedIn = await page.evaluate(adapter.isLoggedInSrc).catch(() => false);
    if (!loggedIn) {
      await doLogin(page);
    } else {
      emit('log', { level: 'info', msg: '✓ 已登录（复用本地登录态）' });
    }
    emit('state', { phase: 'logged-in' });

    emit('state', { phase: 'collecting' });
    const targets = cfg.keywords.length * cfg.topN;
    let sortApplied = true;
    for (const kw of cfg.keywords) {
      if (state.canceled) break;
      await waitNotPaused();
      emit('progress', { keyword: kw, fetched: state.totalDone, target: targets, page: 0, note: '开始' });
      const r = await collectKeyword(page, kw, cfg.topN);
      sortApplied = sortApplied && r.sortApplied;
      emit('log', { level: 'info', msg: '【' + kw + '】采到 ' + r.added + ' 条' + (r.sortApplied ? '' : '（⚠ 未销量排序）') });
      await state.writer.flush();
    }

    if (state.canceled) {
      emit('log', { level: 'warn', msg: '任务已停止，已采数据已保存' });
    }
    await state.writer.flush();
    emit('state', { phase: 'done', output: state.outFile, total: state.totalDone, sortApplied });
    await sleep(500);
    try {
      await state.ctx.close();
    } catch (_) {}
  }

  async function doLogin(page) {
    emit('state', { phase: 'login' });
    emit('log', { level: 'info', msg: '等待扫码登录...（请用手机 ' + adapter.name + ' 扫二维码）' });
    await page.goto(adapter.loginUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await sleep(2000);

    let qr = await grabQR(page, 20000);
    if (!qr) {
      emit('log', { level: 'warn', msg: '未自动定位二维码，请在浏览器窗口内手动扫码' });
    } else {
      pushQR(qr);
    }

    const deadline = Date.now() + 180000;
    let lastRefresh = Date.now();
    while (Date.now() < deadline) {
      if (state.canceled) throw new Error('用户取消');
      await sleep(2000);

      let ok = await page.evaluate(adapter.isLoggedInSrc).catch(() => false);
      if (!ok) {
        const url = page.url();
        if (!/login|passport|login\.taobao|login\.jd/i.test(url) && url !== 'about:blank') {
          // 跳出了登录域，二次确认
          await page.goto(adapter.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          await sleep(2500);
          ok = await page.evaluate(adapter.isLoggedInSrc).catch(() => false);
        }
      }
      if (ok) return true;

      if (Date.now() - lastRefresh > 60000) {
        const newQr = await grabQR(page, 5000);
        if (newQr) pushQR(newQr);
        lastRefresh = Date.now();
      }
    }
    throw new Error('等待扫码超时');
  }

  function pushQR(qr) {
    const dir = paths.ensureDir('pw-data', adapter.id);
    const file = path.join(dir, 'qrcode.png');
    fs.writeFileSync(file, qr.buffer);
    emit('qr', { dataUrl: qr.dataUrl, file });
  }

  async function waitNotPaused() {
    while (state.paused && !state.canceled) await sleep(300);
  }

  async function collectKeyword(page, kw, topN) {
    const url = adapter.searchUrl(kw);
    emit('log', { level: 'info', msg: '打开搜索：' + url });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(2500);

    // 等真实卡片（淘宝首屏 20~30s）
    const t0 = Date.now();
    while (Date.now() - t0 < adapter.firstRenderTimeout) {
      const n = await page
        .evaluate(
          '(function (s){ try { return document.querySelectorAll(s).length; } catch (e) { return 0; } })(' +
            JSON.stringify(findPlatformSearchSelector(adapter)) +
            ')'
        )
        .catch(() => 0);
      if (n >= 5) break;
      await sleep(1500);
    }

    let sortApplied = true;
    if (adapter.sortRequired) {
      sortApplied = await applySalesSort(page);
    }

    const seen = new Set();
    let added = 0;
    let pageIdx = 1;
    let lastTopIds = [];
    let stalePages = 0;
    const detail = { fetchDetail: !!cfg.fetchDetail };

    while (true) {
      if (state.canceled) break;
      await waitNotPaused();

      // 间隔（淘宝 3-6s，京东 2-4s）
      await sleepJitter(2000, 4500);

      // 京东需滚到底触发懒加载凑齐 60 个/页
      if (adapter.needScrollToBottom) {
        await page.evaluate('(function(){ window.scrollTo(0, document.body.scrollHeight); })()').catch(() => {});
        await sleep(900);
        await page.evaluate('(function(){ window.scrollTo(0, document.body.scrollHeight); })()').catch(() => {});
        await sleep(900);
      } else {
        await page.evaluate('(function(){ window.scrollTo(0, Math.min(document.body.scrollHeight, 800)); })()').catch(() => {});
        await sleep(400);
      }

      const risk = await page.evaluate(adapter.riskSrc()).catch(() => '');
      if (risk) {
        emit('log', { level: 'warn', msg: '⚠ 命中风控文案「' + risk + '」，停止本关键词' });
        break;
      }

      if (adapter.recheckSortEachPage && adapter.salesKindSrc) {
        const k = await page.evaluate(adapter.salesKindSrc()).catch(() => null);
        if (k && k.total >= 5 && k.pay > k.recv) {
          emit('log', { level: 'warn', msg: '本页销量排序疑似丢失（人付款=' + k.pay + ' > 人收货=' + k.recv + '），重新点击' });
          sortApplied = await applySalesSort(page);
        }
      }

      let items = await page.evaluate(adapter.parseSrc()).catch(() => []);
      // 翻页检测用：取 topK ids
      const topIds = items.slice(0, 5).map((it) => it && it.id).filter(Boolean);
      if (topIds.length && topIds.every((id, i) => id === lastTopIds[i])) stalePages++;
      else stalePages = 0;
      lastTopIds = topIds;

      const newItems = items.filter((it) => it && it.id && !seen.has(it.id));

      if (newItems.length) {
        // 详情页补采销量（如开关开启）
        if (detail.fetchDetail && !newItems[0].salesText && adapter.fetchDetailSales) {
          await Promise.allSettled(
            newItems.slice(0, 30).map((it) =>
              adapter
                .fetchDetailSales(page, it, { emit, pause: () => state.paused, canceled: () => state.canceled })
                .catch(() => {})
            )
          );
        }

        const tasks = newItems.map((it) => async () => {
          let imgFile = null;
          let imgErr = null;
          if (it.imageUrl) {
            try {
              const variants = adapter.imageVariants(it.imageUrl);
              const r = await download(state.ctx, variants[0], {
                referer: page.url(),
                cacheDir: state.imageCacheDir,
                key: it.id + (variants.length > 1 ? '_orig' : ''),
                transform: variants.length > 1 ? () => variants : null,
              });
              imgFile = r.file;
            } catch (e) {
              imgErr = e.message;
            }
          } else {
            imgErr = '无图片地址';
          }
          const salesNum = parseSales(it.salesText);
          return {
            platform: adapter.name,
            keyword: kw,
            id: it.id,
            title: it.title || '',
            shop: it.shop || '',
            price: it.price || '',
            sales: salesNum >= 0 ? salesNum : (it.salesText || ''),
            salesText: it.salesText || '',
            link: it.link || '',
            imageUrl: it.imageUrl || '',
            imageFile: imgFile,
            imageError: imgErr,
            remark: !sortApplied ? '⚠未销量排序' : '',
            time: nowStamp(),
          };
        });

        const settled = await parallelLimit(tasks, 4);
        for (let i = 0; i < settled.length; i++) {
          const s = settled[i];
          if (!s.ok) continue;
          seen.add(newItems[i].id);
          state.writer.add(s.value);
          added++;
          state.totalDone++;
        }
        state.writer.maybeFlush();
      }

      emit('progress', {
        keyword: kw,
        fetched: state.totalDone,
        target: cfg.keywords.length * topN,
        page: pageIdx,
        note: newItems.length ? '本条 +' + newItems.length : '无新增',
      });

      if (added >= topN || state.totalDone >= cfg.keywords.length * topN) break;
      if (stalePages >= 2) {
        emit('log', { level: 'info', msg: '连续 ' + stalePages + ' 页无新商品，停止翻页' });
        break;
      }

      const click = await page.evaluate(adapter.clickPageSrc(pageIdx + 1)).catch(() => 'none');
      if (click === 'none' && adapter.nextPageUrl) {
        const npu = adapter.nextPageUrl(pageIdx + 1).replace('{kw}', encodeURIComponent(kw));
        if (npu !== url) {
          await page.goto(npu, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
        }
      } else if (click === 'none') {
        emit('log', { level: 'warn', msg: '分页器点击失败且无兜底 URL，本关键词结束' });
        break;
      }

      // 等待翻页后的新内容（用同一个解析脚本，最稳）
      const waitStart = Date.now();
      while (Date.now() - waitStart < 12000) {
        await sleep(1200);
        const probe = await page.evaluate(adapter.parseSrc()).catch(() => []);
        const probeIds = probe.slice(0, 5).map((it) => it && it.id);
        if (probeIds.length && JSON.stringify(probeIds) !== JSON.stringify(lastTopIds)) break;
      }
      pageIdx++;
    }

    return { added, sortApplied };
  }

  async function applySalesSort(page) {
    for (let att = 1; att <= 3; att++) {
      const clicked = await page.evaluate(adapter.clickSortSrc()).catch(() => false);
      if (!clicked) {
        emit('log', { level: 'info', msg: '第 ' + att + ' 次未找到销量页签，等待重试' });
        await sleep(2500);
        continue;
      }
      await sleep(2500);
      if (!adapter.salesKindSrc) return true;
      const k = await page.evaluate(adapter.salesKindSrc()).catch(() => null);
      if (k && k.total >= 5 && k.recv >= 2 && k.recv > k.pay) {
        emit('log', { level: 'info', msg: '✓ 销量排序已生效（人收货=' + k.recv + '）' });
        return true;
      }
    }
    emit('log', { level: 'warn', msg: '⚠ 销量排序 3 次尝试未生效，本批可能不是爆款' });
    return false;
  }

  return {
    start,
    stop() {
      state.canceled = true;
      state.paused = false;
    },
    pause() {
      state.paused = true;
    },
    resume() {
      state.paused = false;
    },
    isRunning() {
      return !!state.ctx;
    },
  };
}

module.exports = { createCollector };