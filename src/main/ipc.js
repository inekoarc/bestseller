'use strict';

const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');

const platforms = require('../collector/platforms');
const { createCollector } = require('../collector/engine');

function register(deps) {
  const { getMainWindow, setCollector, getCollector } = deps;
  const emit = (channel, payload) => {
    const w = getMainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  };

  ipcMain.handle('platforms:list', () => platforms.list());

  ipcMain.handle('collect:start', async (_e, cfg) => {
    if (getCollector() && getCollector().isRunning()) {
      throw new Error('已有任务运行中');
    }
    const adapter = platforms.get(cfg.platform);
    if (!adapter) throw new Error('未知平台');
    if (adapter.experimental && !cfg.allowExperimental) {
      throw new Error('平台 ' + adapter.name + ' 为实验性，需要在配置中开启');
    }
    const c = createCollector(adapter, cfg, (channel, payload) => emit('collector:' + channel, payload));
    setCollector(c);
    c.start().catch((e) => {
      emit('collector:error', { message: e && e.message ? e.message : String(e) });
    });
    return { ok: true };
  });

  ipcMain.handle('collect:stop', () => {
    const c = getCollector();
    if (c) c.stop();
    return { ok: true };
  });

  ipcMain.handle('collect:pause', () => {
    const c = getCollector();
    if (c) c.pause();
    return { ok: true };
  });

  ipcMain.handle('collect:resume', () => {
    const c = getCollector();
    if (c) c.resume();
    return { ok: true };
  });

  ipcMain.handle('dialog:pickOutputDir', async () => {
    const w = getMainWindow();
    const res = await dialog.showOpenDialog(w, { properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('shell:openFile', async (_e, p) => {
    if (!p) return { ok: false, error: 'path 为空' };
    if (!fs.existsSync(p)) return { ok: false, error: '文件不存在' };
    const err = await shell.openPath(p);
    if (err) return { ok: false, error: err };
    return { ok: true };
  });

  ipcMain.handle('shell:showInFolder', async (_e, p) => {
    if (p) shell.showItemInFolder(p);
    return { ok: true };
  });
}

module.exports = { register };