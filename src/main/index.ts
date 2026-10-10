// 主进程：开一个窗口，开世界库，暴露四个 IPC 方法。结算与世界都不在这里。
import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_PARAMS } from '../engine/params.ts';
import type { World } from '../engine/types.ts';
import { IPC } from '../shared/ipc.ts';
import { loadParams, loadWorld, openWorldDb, saveParams, saveWorld, writeSnapshot } from './db.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

let db: DatabaseSync | null = null;
let dbFile = '';

/**
 * 世界库放哪：一个固定的位置，开发与打包都一样——用户主目录下的 .settlement-sandbox/。
 * 环境变量 SETTLEMENT_SANDBOX_DATA 可以盖过它。最终路径会打到控制台，界面上也显示。
 */
function resolveDataDir(): string {
  const fromEnv = process.env['SETTLEMENT_SANDBOX_DATA'];
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(app.getPath('home'), '.settlement-sandbox');
}

function ensureDb(): DatabaseSync {
  if (db) return db;
  const dir = resolveDataDir();
  fs.mkdirSync(dir, { recursive: true });
  dbFile = path.join(dir, 'world.db');
  db = openWorldDb(dbFile);
  if (!loadParams(db)) saveParams(db, DEFAULT_PARAMS);
  console.log('[sandbox] 世界库：' + dbFile);
  return db;
}

/** preload 的产物名随构建配置可能是 .mjs / .js / .cjs，挨个试，别去猜。 */
function resolvePreload(): string | undefined {
  const names = ['../preload/index.mjs', '../preload/index.js', '../preload/index.cjs'];
  return names.map((n) => path.join(here, n)).find((p) => fs.existsSync(p));
}

function createWindow(): void {
  const preload = resolvePreload();
  if (!preload) console.warn('[sandbox] 没找到 preload 产物，界面上的四个方法会不可用');

  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    title: '据点沙盘',
    backgroundColor: '#0f1317',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(here, '../renderer/index.html'));
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.dataPath, () => {
    ensureDb();
    return dbFile;
  });
  ipcMain.handle(IPC.loadWorld, () => {
    const w = loadWorld(ensureDb());
    return w.sites.length === 0 ? null : w;
  });
  ipcMain.handle(IPC.saveWorld, (_e, world: World) => {
    saveWorld(ensureDb(), world);
    return true;
  });
  ipcMain.handle(IPC.snapshot, async (_e, label: string) => {
    const d = ensureDb();
    const dir = path.join(path.dirname(dbFile), 'snapshots');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'snap-' + label.replace(/[^\w.-]+/g, '-') + '.db');
    await writeSnapshot(d, target);
    console.log('[sandbox] 快照：' + target);
    return target;
  });
}

app.whenReady().then(() => {
  registerIpc();
  ensureDb();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  console.log('[sandbox] before-quit：关闭世界库');
  if (db) {
    db.close();
    db = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
