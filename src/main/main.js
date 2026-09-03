'use strict';

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

let baseDir;
let mainWindow = null;
let collector = null;

const paths = require('../collector/paths');
const ipc = require('./ipc');

function initBaseDir() {
  try {
    if (app.isPackaged) {
      baseDir = app.getPath('userData');
      process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright');
    } else {
      baseDir = path.join(__dirname, '..', '..', 'data');
    }
  } catch (e) {
    baseDir = path.join(__dirname, '..', '..', 'data');
  }
  paths.setBase(baseDir);
  paths.ensureDir('pw-data');
  paths.ensureDir('output');
  paths.ensureDir('images');
  paths.ensureDir('probe');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#15171d',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(() => {
  initBaseDir();
  createWindow();
  ipc.register({
    getMainWindow: () => mainWindow,
    setCollector: (c) => {
      collector = c;
    },
    getCollector: () => collector,
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (collector) collector.stop();
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (e) => {
  console.error('uncaughtException', e);
});