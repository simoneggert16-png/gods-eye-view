const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

let mainWindow = null;
let serverProcess = null;
let activePort = 4173;

// Check if server is already running on the given port
function isServerRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/`, (res) => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Find active port if already running
async function findRunningPort() {
  if (await isServerRunning(4173)) return 4173;
  if (await isServerRunning(5173)) return 5173;
  return null;
}

// Wait until the server responds
async function waitForServer(port, maxAttempts = 35) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isServerRunning(port)) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

// Start the local Vite server if not already active
async function ensureServer() {
  const existing = await findRunningPort();
  if (existing) {
    activePort = existing;
    console.log(`[God's Eye Desktop] Existing server detected on port ${activePort}.`);
    return `http://localhost:${activePort}`;
  }

  activePort = 4173;
  console.log(`[God's Eye Desktop] Starting local Vite server on port ${activePort}...`);
  const isWin = process.platform === 'win32';
  const npmCmd = isWin ? 'npm.cmd' : 'npm';

  serverProcess = spawn(npmCmd, ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(activePort)], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
  });

  serverProcess.on('error', (err) => {
    console.error('[God\'s Eye Desktop] Failed to start server process:', err);
  });

  const ready = await waitForServer(activePort, 40);
  if (!ready) {
    console.warn('[God\'s Eye Desktop] Server startup timed out, proceeding to load window...');
  }
  return `http://localhost:${activePort}`;
}

function createWindow(serverUrl) {
  const iconPath = path.join(__dirname, '../public/icon-512.png');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    title: "God's Eye View · Situation Room",
    icon: iconPath,
    backgroundColor: '#060a12',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      allowRunningInsecureContent: true,
    },
  });

  // Open external links in default OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.loadURL(serverUrl || `http://localhost:${activePort}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Setup custom keyboard accelerators (F11 Fullscreen, Ctrl+R Reload, etc.)
function setupMenu() {
  const template = [
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden (F5)' },
        { role: 'forceReload', label: 'Vollständig neu laden' },
        { role: 'toggleDevTools', label: 'Entwicklertools umschalten' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbildmodus (F11)' },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(async () => {
  setupMenu();
  const serverUrl = await ensureServer();
  createWindow(serverUrl);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(serverUrl);
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch (e) {}
  }
});
