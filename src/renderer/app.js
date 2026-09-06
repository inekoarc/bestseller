'use strict';

const bapi = window.api;

const state = {
  platforms: [],
  platform: null,
  phase: 'pick',     // pick | login | config | collecting | done
  paused: false,
  lastOutput: null,
  totalDone: 0,
  totalTarget: 0,
};

const els = {
  status: document.getElementById('status'),
  steps: document.getElementById('steps'),
  platforms: document.getElementById('platforms'),
  panelPick: document.getElementById('panel-pick'),
  panelLogin: document.getElementById('panel-login'),
  panelConfig: document.getElementById('panel-config'),
  panelCollect: document.getElementById('panel-collect'),
  qrImg: document.getElementById('qr-img'),
  qrPlaceholder: document.getElementById('qr-placeholder'),
  loginAppName: document.getElementById('login-app-name'),
  loginStatusLine: document.getElementById('login-status-line'),
  qrInfo: document.getElementById('qr-info'),
  loginLog: document.getElementById('login-log'),
  btnRecheck: document.getElementById('btn-recheck'),
  btnCancelLogin: document.getElementById('btn-cancel-login'),
  btnSwitchSms: document.getElementById('btn-switch-sms'),
  btnResetLogin: document.getElementById('btn-reset-login'),
  qrWrap: document.getElementById('qr-wrap'),
  smsForm: document.getElementById('sms-form'),
  btnSmsSend: document.getElementById('btn-sms-send'),
  smsPhone: document.getElementById('sms-phone'),
  btnSmsLogin: document.getElementById('btn-sms-login'),
  smsCode: document.getElementById('sms-code'),
  btnCancelSms: document.getElementById('btn-cancel-sms'),
  kw: document.getElementById('kw'),
  topN: document.getElementById('topN'),
  outputDir: document.getElementById('outputDir'),
  splitByKeyword: document.getElementById('splitByKeyword'),
  fetchDetail: document.getElementById('fetchDetail'),
  rowExperimental: document.getElementById('row-experimental'),
  allowExperimental: document.getElementById('allowExperimental'),
  experimentalText: document.getElementById('experimental-text'),
  btnStart: document.getElementById('btn-start'),
  btnPickDir: document.getElementById('btn-pick-dir'),
  btnBackPick: document.getElementById('btn-back-pick'),
  progressFill: document.getElementById('progress-fill'),
  progressText: document.getElementById('progress-text'),
  btnPause: document.getElementById('btn-pause'),
  btnStop: document.getElementById('btn-stop'),
  logBox: document.getElementById('log-box'),
  doneArea: document.getElementById('done-area'),
  donePath: document.getElementById('done-path'),
  btnOpenFile: document.getElementById('btn-open-file'),
  btnOpenFolder: document.getElementById('btn-open-folder'),
  btnNewTask: document.getElementById('btn-new-task'),
};

function $(id) { return document.getElementById(id); }

function showPanel(name) {
  ['pick', 'login', 'config', 'collect'].forEach((k) => {
    const p = els['panel' + k.charAt(0).toUpperCase() + k.slice(1)];
    if (p) p.classList.toggle('hidden', k !== name);
  });
}

function setStep(active) {
  const steps = els.steps.querySelectorAll('.step');
  steps.forEach((s) => {
    const n = Number(s.dataset.step);
    s.classList.toggle('active', n === active);
    s.classList.toggle('done', n < active);
  });
}

function setStatus(text, cls) {
  els.status.textContent = text;
  els.status.className = 'status ' + (cls || '');
}

function logLine(level, msg) {
  const d = document.createElement('div');
  d.className = 'log-line ' + level;
  const lv = document.createElement('span');
  lv.className = 'lvl';
  lv.textContent = level.toUpperCase();
  const t = document.createElement('span');
  t.textContent = msg;
  d.appendChild(lv);
  d.appendChild(t);
  els.logBox.appendChild(d);
  els.logBox.scrollTop = els.logBox.scrollHeight;
}

function renderPlatforms(platforms) {
  state.platforms = platforms;
  els.platforms.innerHTML = '';
  platforms.forEach((p) => {
    const c = document.createElement('div');
    c.className = 'platform-card' + (p.experimental ? ' disabled' : '');
    c.dataset.id = p.id;
    c.innerHTML =
      '<div class="name">' + escape(p.name) +
        (p.experimental ? '<span class="badge">实验</span>' : '') +
      '</div>' +
      '<div class="desc">' + escape(p.desc || (p.experimental ? (p.reason || '暂未启用') : '已支持')) + '</div>';
    if (!p.experimental) {
      c.addEventListener('click', () => pickPlatform(p.id));
    }
    els.platforms.appendChild(c);
  });
}

function pickPlatform(id) {
  state.platform = id;
  els.platforms.querySelectorAll('.platform-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.id === id);
  });
  showPanel('config');
  setStep(3);
  setStatus('配置参数', '');
  const appName = (state.platforms.find((p) => p.id === id) || {}).name || '对应 APP';
  els.loginAppName.textContent = appName;
  // experimental toggle
  const p = state.platforms.find((pp) => pp.id === id);
  if (p && p.experimental) {
    els.rowExperimental.hidden = false;
    els.allowExperimental.checked = false;
    els.experimentalText.textContent = '启用实验性平台：' + p.name + '（' + (p.reason || '页面结构待验证') + '）';
  } else {
    els.rowExperimental.hidden = true;
    els.allowExperimental.checked = false;
  }
}

function escape(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

async function startCollect() {
  const kw = (els.kw.value || '').trim();
  const keywords = kw.split(/[\n,，]+/).map((s) => s.trim()).filter(Boolean);
  if (!state.platform) {
    alert('请先选择平台');
    showPanel('pick'); setStep(1); return;
  }
  if (!keywords.length) {
    alert('请填写至少一个关键词');
    showPanel('config'); setStep(3); return;
  }
  els.logBox.innerHTML = '';
  showPanel('collect');
  setStep(4);
  setStatus('启动中', 'busy');
  els.doneArea.classList.add('hidden');
  els.progressFill.style.width = '0%';
  els.progressText.textContent = '0 / 0';

  const cfg = {
    platform: state.platform,
    keywords,
    topN: Number(els.topN.value) || 50,
    fetchDetail: !!els.fetchDetail.checked,
    splitByKeyword: !!els.splitByKeyword.checked,
    imageMode: 'embed',
    allowExperimental: !!els.allowExperimental.checked,
    outputDir: (els.outputDir.value || '').trim(),
  };

  try {
    await bapi.start(cfg);
  } catch (e) {
    setStatus('启动失败', 'err');
    logLine('error', '启动失败：' + (e.message || e));
  }
}

// ── IPC handlers ──────────────────────────────────────
bapi.onState((p) => {
  if (!p) return;
  state.phase = p.phase;
  if (p.phase === 'login-check') {
    showPanel('login'); setStep(2); setStatus('登录检测中', 'busy');
    els.loginStatusLine.textContent = '正在打开登录页...';
    els.loginStatusLine.className = 'status-line wait';
  } else if (p.phase === 'login') {
    showPanel('login'); setStep(2);
    const sms = p.loginMode === 'sms';
    if (els.qrWrap) els.qrWrap.classList.toggle('hidden', sms);
    if (els.smsForm) els.smsForm.classList.toggle('hidden', !sms);
    if (els.btnSwitchSms) els.btnSwitchSms.classList.toggle('hidden', sms || !p.smsFallback);
    // 短信模式下隐藏扫码专属按钮（刷新/取消在短信表单里已有）
    if (els.btnRecheck) els.btnRecheck.classList.toggle('hidden', sms);
    if (els.btnCancelLogin) els.btnCancelLogin.classList.toggle('hidden', sms);
    if (els.loginLog) els.loginLog.innerHTML = '';
    if (els.btnSmsLogin) els.btnSmsLogin.disabled = false;
    setStatus(sms ? '短信登录' : '等待扫码', 'busy');
    els.loginStatusLine.textContent = sms ? '请输入手机号获取验证码' : '等待扫码...';
    els.loginStatusLine.className = 'status-line wait';
  } else if (p.phase === 'logged-in') {
    els.loginStatusLine.textContent = '✓ 登录成功，准备开始采集';
    els.loginStatusLine.className = 'status-line ok';
    els.btnSmsLogin.disabled = false;
  } else if (p.phase === 'collecting') {
    showPanel('collect'); setStep(4); setStatus('采集中', 'busy');
    els.btnSmsLogin.disabled = false;
  } else if (p.phase === 'done') {
    state.lastOutput = p.output;
    state.totalDone = p.total;
    setStatus('完成', 'done');
    showPanel('collect'); setStep(4);
    els.doneArea.classList.remove('hidden');
    els.donePath.textContent = p.output;
    logLine('success', '✓ 采集完成，共 ' + p.total + ' 条，已保存到：' + p.output);
  }
});

bapi.onQr((q) => {
  if (!q) return;
  els.qrImg.src = q.dataUrl;
  els.qrPlaceholder.style.display = 'none';
  els.loginStatusLine.textContent = '请用手机扫码';
  els.loginStatusLine.className = 'status-line wait';
  if (q.file) {
    const t = '二维码图片：' + q.file + '（若 APP 扫不到，可打开此图手动扫）';
    els.qrInfo.textContent = t;
  }
});

bapi.onLog((l) => {
  if (!l) return;
  logLine(l.level || 'info', l.msg || '');
  // 登录阶段：把引擎日志镜像到登录面板，让短信登录的每步结果（含页面提示）可见
  if (state.phase === 'login' && els.loginLog) {
    const d = document.createElement('div');
    d.className = 'login-log-line ' + (l.level || 'info');
    d.textContent = l.msg || '';
    els.loginLog.appendChild(d);
    while (els.loginLog.children.length > 6) els.loginLog.removeChild(els.loginLog.firstChild);
  }
  // 短信登录失败后恢复按钮，允许用户修改验证码重试
  if (state.phase === 'login' && l.msg && /登录未成功|提交验证码未完成|发送验证码未完成/.test(l.msg) && els.btnSmsLogin) {
    els.btnSmsLogin.disabled = false;
    els.loginStatusLine.className = 'status-line err';
  }
});

bapi.onProgress((p) => {
  if (!p) return;
  state.totalDone = p.fetched || 0;
  state.totalTarget = p.target || 0;
  const pct = state.totalTarget ? Math.min(100, Math.round((state.totalDone / state.totalTarget) * 100)) : 0;
  els.progressFill.style.width = pct + '%';
  els.progressText.textContent = state.totalDone + ' / ' + state.totalTarget + '  ·  ' + pct + '%';
});

bapi.onDone((p) => {
  state.lastOutput = p.output;
  state.totalDone = p.total;
  setStatus('完成', 'done');
  els.doneArea.classList.remove('hidden');
  els.donePath.textContent = p.output;
});

bapi.onError((p) => {
  setStatus('错误', 'err');
  logLine('error', p && p.message ? p.message : '未知错误');
});

// ── buttons ───────────────────────────────────────────
els.btnStart.addEventListener('click', startCollect);

els.btnPickDir.addEventListener('click', async () => {
  const dir = await bapi.pickOutputDir();
  if (dir) els.outputDir.value = dir;
});

els.btnBackPick.addEventListener('click', async () => {
  if (state.phase === 'collecting') await bapi.stop();
  state.platform = null;
  showPanel('pick'); setStep(1); setStatus('未启动', '');
});

els.btnRecheck.addEventListener('click', async () => {
  // Force a re-check by stopping and starting over: easiest is to trigger a state-poll via main; here we just give a hint.
  logLine('info', '正在检测登录态...');
});

els.btnCancelLogin.addEventListener('click', async () => {
  await bapi.stop();
  state.platform = null;
  showPanel('pick'); setStep(1); setStatus('已取消', '');
});

// ── 短信登录（扫码备用路径） ─────────────────────────
els.btnSwitchSms.addEventListener('click', async () => {
  els.loginStatusLine.textContent = '正在切换到短信验证码登录...';
  els.loginStatusLine.className = 'status-line wait';
  try {
    await bapi.smsAction({ type: 'use-sms' });
  } catch (e) {
    els.loginStatusLine.textContent = '切换失败：' + (e.message || e);
    els.loginStatusLine.className = 'status-line err';
  }
});

let smsCountdown = null;
els.btnSmsSend.addEventListener('click', async () => {
  const phone = (els.smsPhone.value || '').trim();
  if (!/^1\d{10}$/.test(phone)) {
    els.loginStatusLine.textContent = '请输入 11 位手机号';
    els.loginStatusLine.className = 'status-line err';
    return;
  }
  els.btnSmsSend.disabled = true;
  els.loginStatusLine.textContent = '正在发送验证码...';
  els.loginStatusLine.className = 'status-line wait';
  try {
    const r = await bapi.smsAction({ type: 'send-code', phone });
    if (r && r.ok) {
      els.loginStatusLine.textContent = '验证码已发送，请查收短信';
      let n = 60;
      clearInterval(smsCountdown);
      smsCountdown = setInterval(() => {
        els.btnSmsSend.textContent = --n > 0 ? n + 's 后重发' : '发送验证码';
        if (n <= 0) { clearInterval(smsCountdown); els.btnSmsSend.disabled = false; }
      }, 1000);
    } else {
      els.loginStatusLine.textContent = '发送失败：' + ((r && r.error) || '未知原因');
      els.loginStatusLine.className = 'status-line err';
      els.btnSmsSend.disabled = false;
    }
  } catch (e) {
    els.loginStatusLine.textContent = '发送失败：' + (e.message || e);
    els.loginStatusLine.className = 'status-line err';
    els.btnSmsSend.disabled = false;
  }
});

els.btnSmsLogin.addEventListener('click', async () => {
  const code = (els.smsCode.value || '').trim();
  if (!/^\d{4,8}$/.test(code)) {
    els.loginStatusLine.textContent = '请输入短信验证码';
    els.loginStatusLine.className = 'status-line err';
    return;
  }
  els.btnSmsLogin.disabled = true;
  els.loginStatusLine.textContent = '验证码已提交，等待登录...';
  els.loginStatusLine.className = 'status-line wait';
  try {
    await bapi.smsAction({ type: 'submit', code });
  } catch (e) {
    els.loginStatusLine.textContent = '提交失败：' + (e.message || e);
    els.loginStatusLine.className = 'status-line err';
    els.btnSmsLogin.disabled = false;
  }
});

els.btnCancelSms.addEventListener('click', async () => {
  clearInterval(smsCountdown);
  await bapi.stop();
  state.platform = null;
  showPanel('pick'); setStep(1); setStatus('已取消', '');
  els.btnSmsLogin.disabled = false;
});

// 重置登录配置：清除被拼多多风控标记的浏览器数据，用全新未标记上下文重新登录
els.btnResetLogin.addEventListener('click', async () => {
  if (!state.platform) return;
  const name = (state.platforms.find((p) => p.id === state.platform) || {}).name || '该平台';
  if (!confirm('确定重置「' + name + '」的本地登录数据？\n将清除被风控标记的浏览器缓存，之后请优先用手机扫码登录。')) return;
  try {
    await bapi.stop().catch(() => {});
    els.btnResetLogin.disabled = true;
    const r = await bapi.resetLogin(state.platform);
    if (r && r.ok) {
      logLine('success', '✓ 已重置登录配置，正在用全新浏览器数据重新登录...');
      // 复用已填的配置重新发起（先回到登录流程，优先扫码）
      await startCollect();
    } else {
      logLine('error', '重置失败：' + ((r && r.error) || '未知原因'));
    }
  } catch (e) {
    logLine('error', '重置失败：' + (e.message || e));
  } finally {
    els.btnResetLogin.disabled = false;
  }
});

els.btnPause.addEventListener('click', async () => {
  if (!state.paused) {
    await bapi.pause(); state.paused = true;
    els.btnPause.textContent = '继续';
  } else {
    await bapi.resume(); state.paused = false;
    els.btnPause.textContent = '暂停';
  }
});

els.btnStop.addEventListener('click', async () => {
  await bapi.stop();
  logLine('warn', '已请求停止...');
});

els.btnOpenFile.addEventListener('click', () => state.lastOutput && bapi.openFile(state.lastOutput));
els.btnOpenFolder.addEventListener('click', () => state.lastOutput && bapi.showInFolder(state.lastOutput));

els.btnNewTask.addEventListener('click', () => {
  state.platform = null;
  state.lastOutput = null;
  showPanel('pick'); setStep(1); setStatus('未启动', '');
  els.progressFill.style.width = '0%';
  els.progressText.textContent = '0 / 0';
});

// ── init ─────────────────────────────────────────────
(async () => {
  try {
    const list = await bapi.platforms();
    renderPlatforms(list);
    logLine('info', '就绪。当前仅采集公开展示的商品信息，遵守平台服务协议。');
  } catch (e) {
    logLine('error', '初始化失败：' + (e.message || e));
  }
})();