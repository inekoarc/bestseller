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
  btnRecheck: document.getElementById('btn-recheck'),
  btnCancelLogin: document.getElementById('btn-cancel-login'),
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
      '<div class="desc">' + escape(p.experimental ? (p.reason || '暂未启用') : '已支持') + '</div>';
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
  if (p.phase === 'login-check') {
    showPanel('login'); setStep(2); setStatus('登录检测中', 'busy');
    els.loginStatusLine.textContent = '正在打开登录页...';
    els.loginStatusLine.className = 'status-line wait';
  } else if (p.phase === 'login') {
    showPanel('login'); setStep(2); setStatus('等待扫码', 'busy');
    els.loginStatusLine.textContent = '等待扫码...';
    els.loginStatusLine.className = 'status-line wait';
  } else if (p.phase === 'logged-in') {
    els.loginStatusLine.textContent = '✓ 登录成功，准备开始采集';
    els.loginStatusLine.className = 'status-line ok';
  } else if (p.phase === 'collecting') {
    showPanel('collect'); setStep(4); setStatus('采集中', 'busy');
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