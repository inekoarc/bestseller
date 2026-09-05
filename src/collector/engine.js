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

const browserMod = require('./browser');
const { launchOptions } = browserMod;
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
    // 短信登录动作队列（renderer → ipc → handleSmsAction 推入，doSmsLogin 消费）
    smsQueue: [],
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

    // 适配器可指定移动端视口 / UA（拼多多 H5 需要）
    const lo = launchOptions();
    if (adapter.viewport) lo.viewport = adapter.viewport;
    if (adapter.isMobile) {
      lo.isMobile = true;
      lo.hasTouch = true;
    }
    if (adapter.userAgent) lo.userAgent = adapter.userAgent;
    state.ctx = await chromiumLazy().launchPersistentContext(userDataDir, lo);
    const page = state.ctx.pages()[0] || (await state.ctx.newPage());
    await browserMod.scrubHeadlessUa(page);

    emit('state', { phase: 'login-check' });
    await page.goto(adapter.homeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(3000);

    let loggedIn = await page.evaluate(adapter.isLoggedInSrc).catch(() => false);
    if (!loggedIn) {
      if (adapter.loginMode === 'sms') {
        await doSmsLogin(page);
      } else {
        const r = await doLogin(page);
        // 扫码被风控/扫不出时，UI 可请求切换到短信验证码登录
        if (r === 'switch-sms') await doSmsLogin(page);
      }
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
    state.ctx = null;
  }

  async function doLogin(page) {
    emit('state', { phase: 'login', smsFallback: !!adapter.smsFallback });
    emit('log', { level: 'info', msg: '等待扫码登录...（请用手机 ' + adapter.name + ' 扫二维码）' });
    await page.goto(adapter.loginUrl, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await sleep(2000);

    // 适配器钩子：部分登录页（如拼多多）落地默认是其他登录方式，需先点「扫码登录」页签
    if (adapter.enterQrLogin) {
      await adapter.enterQrLogin(page).catch(() => {});
    }

    let qr = await grabQR(page, 15000);
    if (!qr) {
      if (adapter.smsFallback) {
        // 拼多多实测：设备短时间反复触发登录后，服务端会收起扫码入口（_x_no_login_launch=1）。
        // 此时不打扰用户，自动降级到短信验证码登录（备用路径已验证可用）。
        emit('log', {
          level: 'warn',
          msg: '扫码入口未出现或二维码未渲染（可能被风控临时收起），自动切换短信验证码登录',
        });
        return 'switch-sms';
      }
      emit('log', { level: 'warn', msg: '未自动定位二维码，请在浏览器窗口内手动扫码' });
    } else {
      pushQR(qr);
    }

    const deadline = Date.now() + 180000;
    let lastRefresh = Date.now();
    while (Date.now() < deadline) {
      if (state.canceled) throw new Error('用户取消');
      // UI 可请求切换到短信验证码登录（扫码被风控/扫不出时的备用路径）
      const sw = state.smsQueue.findIndex((a) => a.type === 'use-sms');
      if (sw >= 0) {
        state.smsQueue.splice(sw, 1);
        emit('log', { level: 'info', msg: '切换到短信验证码登录' });
        return 'switch-sms';
      }
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

  /**
   * 短信验证码登录（备用路径：拼多多扫码被风控/扫不出时由 UI 切换进入）。
   * 交互由 renderer 完成：输入手机号/验证码 → ipc 'collect:sms-action' → smsQueue，
   * 本循环每 2 秒消费队列并轮询登录态。
   */
  async function doSmsLogin(page) {
    emit('state', { phase: 'login', loginMode: 'sms' });
    emit('log', { level: 'info', msg: '【' + adapter.name + '】H5 仅支持短信验证码登录，请在界面输入手机号' });
    await page.goto(adapter.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(2500);

    if (await page.evaluate(adapter.isLoggedInSrc).catch(() => false)) return true;

    const deadline = Date.now() + 300000; // 5 分钟
    while (Date.now() < deadline) {
      if (state.canceled) throw new Error('用户取消');
      const act = state.smsQueue.length ? state.smsQueue.shift() : null;
      if (act && act.type === 'use-sms') {
        // 切换请求已在 doLogin 中消费，此处残留则静默忽略
        continue;
      }
      if (act && act.type === 'send-code') {
        const masked = String(act.phone || '').replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
        emit('log', { level: 'info', msg: '发送验证码到 ' + masked });
        try {
          const r = await adapter.smsFillPhone(page, act.phone);
          if (/^ok/.test(r)) {
            const toast = String(r).includes('｜') ? '（' + String(r).split('｜')[1] + '）' : '';
            emit('log', { level: 'info', msg: '✓ 已点击发送验证码，请查收短信' + toast });
          } else {
            emit('log', {
              level: 'warn',
              msg: '发送验证码未完成（' + r + '），请重试；若页面出现滑块验证，请设 BESTSELLER_HEADLESS=false 用有头模式手动过一次',
            });
          }
        } catch (e) {
          emit('log', { level: 'error', msg: '发送验证码失败：' + e.message });
        }
      } else if (act && act.type === 'submit') {
        try {
          const r = await adapter.smsSubmitCode(page, act.code);
          if (/^ok/.test(r)) {
            const toast = String(r).includes('｜') ? '（' + String(r).split('｜')[1] + '）' : '';
            emit('log', { level: 'info', msg: '✓ 已提交验证码，等待登录结果...' + toast });
          } else {
            emit('log', {
              level: 'warn',
              msg: '提交验证码未完成（' + r + '），请重试；若页面出现滑块验证，请设 BESTSELLER_HEADLESS=false 用有头模式手动过一次',
            });
          }
        } catch (e) {
          emit('log', { level: 'error', msg: '提交验证码失败：' + e.message });
        }
      } else if (act) {
        emit('log', { level: 'warn', msg: '未知登录操作：' + act.type });
      }

      await sleep(2000);
      if (await page.evaluate(adapter.isLoggedInSrc).catch(() => false)) return true;
    }
    throw new Error('短信登录超时（5 分钟）');
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
      if (adapter.waitCardsSrc) {
        // 适配器自定义等卡逻辑（如拼多多按价格叶子+rawData计数，不依赖卡片类名）
        const ok = await page.evaluate(adapter.waitCardsSrc(5)).catch(() => false);
        if (ok) break;
      } else {
        const n = await page
          .evaluate(
            '(function (s){ try { return document.querySelectorAll(s).length; } catch (e) { return 0; } })(' +
              JSON.stringify(findPlatformSearchSelector(adapter)) +
              ')'
          )
          .catch(() => 0);
        if (n >= 5) break;
      }
      await sleep(1500);
    }

    // 首屏等待超时兜底：适配器可提供交互式修复（如拼多多改走首页搜索链路）
    if (adapter.fixupSearch) {
      await adapter.fixupSearch(page, kw, { emit }).catch(() => {});
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

      let newItems = items.filter((it) => it && it.id && !seen.has(it.id));

      // 只保留还需要的条数，避免整页全采导致超出 topN（进度 >100%）
      const remain = topN - added;
      if (remain <= 0) {
        emit('log', { level: 'info', msg: '已采满 ' + topN + ' 条，停止翻页' });
        break;
      }
      if (newItems.length > remain) newItems = newItems.slice(0, remain);

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
          const remarks = [];
          if (!sortApplied) remarks.push('⚠未销量排序');
          if (it.isAd) remarks.push('广告位');
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
            remark: remarks.join(' / '),
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

      if (adapter.infiniteScroll) {
        // 无分页器（如拼多多 H5）：下一轮滚到底触发加载更多，靠 stalePages 判定结束
        pageIdx++;
        continue;
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
    /** renderer → ipc 推入登录动作（{ type: 'send-code'|'submit'|'use-sms', phone, code }） */
    handleSmsAction(action) {
      if (!action || !action.type) return { ok: false, error: '无效操作' };
      if (action.type !== 'send-code' && action.type !== 'submit' && action.type !== 'use-sms') {
        return { ok: false, error: '未知操作类型' };
      }
      if (action.type === 'send-code' && !/^1\d{10}$/.test(String(action.phone || ''))) {
        return { ok: false, error: '手机号格式不正确' };
      }
      if (action.type === 'submit' && !/^\d{4,8}$/.test(String(action.code || ''))) {
        return { ok: false, error: '验证码格式不正确' };
      }
      state.smsQueue.push(action);
      return { ok: true };
    },
  };
}

module.exports = { createCollector };