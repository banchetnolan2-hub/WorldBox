// ELECTRON — processus principal : fenêtre Windows + sauvegarde locale (IPC)
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
// musique générée : lecture sans geste préalable
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// secours logiciel si la carte graphique est indisponible ou bloquée (le globe reste affichable)
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const path = require('path');
const fs = require('fs');

const SMOKE_TEST = process.argv.includes('--smoke-test');
const SMOKE_URL = (process.argv.find((a) => a.startsWith('--smoke-page=')) || '').split('=')[1] || 'index.html';

function savesFile() {
  return path.join(app.getPath('userData'), 'sauvegardes.json');
}

function readSaves() {
  try {
    const raw = fs.readFileSync(savesFile(), 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') return data;
  } catch (_) { /* fichier absent ou corrompu */ }
  return { version: 1, last: null, slots: [] };
}

function writeSaves(data) {
  const file = savesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return true;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#0b1220',
    title: 'World Simulator',
    icon: path.join(__dirname, '..', 'app', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'app', SMOKE_TEST ? SMOKE_URL : 'index.html'));
  win.once('ready-to-show', () => {
    if (!SMOKE_TEST) win.maximize();
    win.show();
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  if (SMOKE_TEST) {
    // Test automatique : lance une partie, capture l'écran, quitte.
    const out = process.env.SMOKE_OUT || path.join(process.cwd(), 'smoke.png');
    win.webContents.on('console-message', (e, _level, message) => {
      const msg = e && e.message !== undefined ? e.message : message;
      console.log('[renderer]', msg);
    });
    win.webContents.once('did-finish-load', async () => {
      try {
        await win.webContents.executeJavaScript('window.__game && window.__game.debugStart && void window.__game.debugStart(), 1');
      } catch (err) { console.log('debugStart error', err.message); }
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(out, img.toPNG());
        const state = await win.webContents.executeJavaScript('JSON.stringify(window.__game ? window.__game.debugState() : null)');
        console.log('SMOKE_STATE', state);
        app.quit();
      }, Number(process.env.SMOKE_WAIT || 6000));
    });
  }
}

// ---- stockage V3 : mondes (.simworld), parties, paramètres (un fichier par élément) ----
// %APPDATA%/WorldSimulator/worlds/MonMonde.simworld ; anciens mondes : mondes/*.json (lecture)
const CATS = { worlds: '.simworld', mondes: '.json', parties: '.json', reglages: '.json', scenarios: '.json' };
function storeDir(cat) {
  if (!CATS[cat]) throw new Error('catégorie inconnue');
  const d = path.join(app.getPath('userData'), cat);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const safeId = (id) => String(id).replace(/[^a-zA-Z0-9_\-À-ÿ ]/g, '').trim().slice(0, 80) || 'sans-nom';
const fileOf = (cat, id) => path.join(storeDir(cat), safeId(id) + CATS[cat]);
ipcMain.handle('store:list', (_e, cat) => {
  const d = storeDir(cat);
  const ext = CATS[cat];
  return fs.readdirSync(d).filter((f) => f.endsWith(ext)).map((f) => {
    const full = path.join(d, f);
    let meta = null;
    try {
      // lecture partielle : les métadonnées sont en tête de fichier
      const fd = fs.openSync(full, 'r');
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      const head = buf.slice(0, n).toString('utf8');
      const m = head.match(/"meta":(\{[^{}]*\})/);
      if (m) meta = JSON.parse(m[1]);
      else {
        const data = JSON.parse(fs.readFileSync(full, 'utf8'));
        meta = data.meta || { name: data.name, year: data.year, updatedAt: data.updatedAt };
      }
    } catch (_) { meta = { name: f, broken: true }; }
    return { id: f.slice(0, -ext.length), meta, mtime: fs.statSync(full).mtimeMs };
  }).sort((a, b) => b.mtime - a.mtime);
});
ipcMain.handle('store:read', (_e, cat, id) => {
  const f = fileOf(cat, id);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
});
ipcMain.handle('store:write', (_e, cat, id, data) => {
  const f = fileOf(cat, id);
  // métadonnées en premier (liste rapide)
  const ordered = data && data.meta ? { meta: data.meta, ...data } : data;
  fs.writeFileSync(f + '.tmp', JSON.stringify(ordered), 'utf8');
  fs.renameSync(f + '.tmp', f);
  return true;
});
ipcMain.handle('store:delete', (_e, cat, id) => {
  const f = fileOf(cat, id);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  return true;
});
ipcMain.handle('store:folder', (_e, cat) => storeDir(cat));

ipcMain.handle('saves:read', () => readSaves());
ipcMain.handle('saves:write', (_e, data) => writeSaves(data));
ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:fullscreen', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setFullScreen(!win.isFullScreen());
});

// ---- multijoueur : serveur TCP local (réseau local, Tailscale, ZeroTier, Radmin VPN…) ----
// Messages JSON séparés par des retours à la ligne ; relayés vers l'interface par IPC.
const net = require('net');
const os = require('os');
let netServer = null;
const netConns = new Map();
let netConnId = 0;
function netEmit(e, payload) { if (e && !e.isDestroyed()) e.send('net:event', payload); }
function netAttach(sock, sender) {
  const id = ++netConnId;
  netConns.set(id, sock);
  sock.setNoDelay(true);
  sock.setEncoding('utf8');
  let buf = '';
  sock.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line) netEmit(sender, { type: 'data', id, data: line }); }
  });
  sock.on('close', () => { netConns.delete(id); netEmit(sender, { type: 'close', id }); });
  sock.on('error', () => {});
  return id;
}
function localAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  return out;
}
ipcMain.handle('net:listen', (e, port) => new Promise((resolve) => {
  if (netServer) { resolve({ ok: true, port: netServer.address().port, addresses: localAddresses() }); return; }
  const sender = e.sender;
  const srv = net.createServer((sock) => { const id = netAttach(sock, sender); netEmit(sender, { type: 'open', id, remote: sock.remoteAddress }); });
  srv.on('error', (err) => { netServer = null; resolve({ ok: false, error: err.message }); });
  srv.listen(port || 47615, '0.0.0.0', () => { netServer = srv; resolve({ ok: true, port: srv.address().port, addresses: localAddresses() }); });
}));
ipcMain.handle('net:stop', () => { if (netServer) { netServer.close(); netServer = null; } for (const s of netConns.values()) s.destroy(); netConns.clear(); return true; });
ipcMain.handle('net:connect', (e, host, port) => new Promise((resolve) => {
  const sender = e.sender;
  const sock = net.connect({ host, port: port || 47615, timeout: 8000 });
  let done = false;
  sock.once('connect', () => { done = true; sock.setTimeout(0); const id = netAttach(sock, sender); resolve({ ok: true, id }); });
  sock.once('timeout', () => { if (!done) { done = true; sock.destroy(); resolve({ ok: false, error: 'délai dépassé' }); } });
  sock.once('error', (err) => { if (!done) { done = true; resolve({ ok: false, error: err.message }); } });
}));
ipcMain.handle('net:send', (_e, id, data) => { const s = netConns.get(id); if (!s) return false; s.write(data + '\n'); return true; });
ipcMain.handle('net:close', (_e, id) => { const s = netConns.get(id); if (s) s.destroy(); return true; });
ipcMain.handle('net:addresses', () => localAddresses());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
