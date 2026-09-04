import { app, BrowserWindow, ipcMain, net, protocol, session, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SettingsStore } from './services/settings';
import { SapiService } from './services/sapi';

const IS_DEV = !!process.env.KYCELIUS_DEV || process.env.NODE_ENV === 'development';

// Must run before app ready: registers 'app' as a standard, secure,
// fetch-capable scheme so packaged builds serve the renderer from
// app://bundle/ instead of file:// (which breaks AudioWorklet, fetch
// and blob URLs due to its null origin).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

let mainWindow: BrowserWindow | null = null;

// Single-instance lock (voice apps should never run twice — two mic captures fight)
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#020409',
    show: false,
    autoHideMenuBar: true,
    title: 'Kycelius Voice',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // AudioWorklet + WASM (Transformers.js) need it
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Open external links (docs, GitHub) in the default browser — never in-app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (IS_DEV) {
    mainWindow.loadURL('http://127.0.0.1:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL('app://bundle/index.html');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // ── Microphone permissions (required for getUserMedia in Electron) ──
  const allowedPermissions = new Set(['media', 'audioCapture', 'notifications']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission) => allowedPermissions.has(permission),
  );

  // ── Serve the packaged renderer over app:// ──────────────────────────
  // Maps app://bundle/<path> -> dist/<path> with correct MIME types and
  // a standard origin, so AudioWorklet/blob/fetch/WASM all work.
  protocol.handle('app', (request) => {
    try {
      const { pathname } = new URL(request.url);
      const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
      const distDir = path.join(__dirname, '../dist');
      const filePath = path.join(distDir, path.normalize(rel));
      if (!filePath.startsWith(distDir)) {
        return new Response('Forbidden', { status: 403 });
      }
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      return new Response(`Protocol error: ${String(err)}`, { status: 500 });
    }
  });

  const settings = new SettingsStore();
  const sapi = new SapiService();

  // Settings persistence
  ipcMain.handle('kycelius:settings:get', () => settings.all());
  ipcMain.handle('kycelius:settings:set', (_e, patch: Record<string, unknown>) => {
    settings.set(patch);
    return settings.all();
  });

  // Offline Windows SAPI TTS
  ipcMain.handle('kycelius:sapi:voices', () => sapi.listVoices());
  ipcMain.handle(
    'kycelius:sapi:speak',
    async (_e, req: { text: string; voice?: string; rate?: number; pitch?: number }) => {
      return sapi.synthesize(req.text, req.voice, req.rate, req.pitch); // Buffer -> renderer
    },
  );

  // Meta
  ipcMain.handle('kycelius:app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    isDev: IS_DEV,
  }));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
