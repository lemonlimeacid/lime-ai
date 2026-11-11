/* Supernova IA — enveloppe desktop Electron.
 * Lance le serveur Node embarqué sur un port libre, stocke les données dans
 * le dossier utilisateur de l'application, puis ouvre l'interface.
 */
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

let mainWindow = null;
let serverProcess = null;
let serverPort = 0;
let externalServer = false;
let quitting = false;

// In a packaged build, keep the app root as a real directory. A previous
// build pointed spawn() at resources/app.asar, which is a file, causing
// `spawn ENOTDIR` on AppImage startup.
const APP_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'app')
  : path.join(__dirname, '..');

function bindProbe(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => {
      const actual = probe.address().port;
      probe.close(() => resolve(actual));
    });
  });
}

async function pickPort() {
  // Préfère 3000 pour que le site ouvert sur localhost:3000 utilise le même serveur et la même sauvegarde.
  try {
    return await bindProbe(3000);
  } catch {
    return bindProbe(0);
  }
}

function waitForServer(port, timeoutMs = 25000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(
        { host: '127.0.0.1', port, path: '/api/health', timeout: 1500 },
        (response) => {
          response.resume();
          if (response.statusCode === 200) return resolve();
          retry();
        }
      );
      request.on('timeout', () => request.destroy());
      request.on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        return reject(new Error('The Supernova server is not responding.'));
      }
      setTimeout(attempt, 220);
    };
    attempt();
  });
}

function probeServer(port) {
  return new Promise((resolve) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/api/config', timeout: 1400 },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          try {
            resolve(response.statusCode === 200 && JSON.parse(body).app === 'Supernova AI');
          } catch {
            resolve(false);
          }
        });
      }
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

/** Si le site tourne déjà, on s'y connecte : les deux interfaces partagent la même sauvegarde. */
async function useExistingSite() {
  const sitePort = Number(process.env.SUPERNOVA_SITE_PORT || 3000);
  if (!Number.isInteger(sitePort) || sitePort <= 0) return false;
  if (!(await probeServer(sitePort))) return false;
  serverPort = sitePort;
  externalServer = true;
  return true;
}

async function startServer() {
  const userData = app.getPath('userData');
  const dataDir = process.env.SUPERNOVA_DATA
    ? path.resolve(process.env.SUPERNOVA_DATA)
    : path.join(userData, 'data');
  const workspacesDir = process.env.SUPERNOVA_WORKSPACES
    ? path.resolve(process.env.SUPERNOVA_WORKSPACES)
    : path.join(userData, 'workspaces');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(workspacesDir, { recursive: true });

  serverPort = await pickPort();
  const logPath = path.join(userData, 'supernova-server.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  logStream.write(`\n--- ${new Date().toISOString()} · port ${serverPort} ---\n`);

  const serverEntry = path.join(APP_ROOT, 'server', 'index.js');
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server entry not found: ${serverEntry}`);
  }

  const env = {
    ...process.env,
    PORT: String(serverPort),
    HOST: '127.0.0.1',
    SUPERNOVA_DATA: dataDir,
    SUPERNOVA_WORKSPACES: workspacesDir,
    SUPERNOVA_DESKTOP: '1',
    ELECTRON_RUN_AS_NODE: '1',
  };

  serverProcess = spawn(process.execPath, [serverEntry], {
    // cwd must be a real directory, never a file such as app.asar.
    cwd: userData,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const spawned = new Promise((resolve, reject) => {
    serverProcess.once('spawn', resolve);
    serverProcess.once('error', reject);
  });

  serverProcess.stdout.pipe(logStream);
  serverProcess.stderr.pipe(logStream);

  serverProcess.on('error', (error) => {
    logStream.write(`[desktop] startup failed: ${error.message}\n`);
  });

  serverProcess.on('exit', (code, signal) => {
    logStream.write(`[desktop] server stopped (${code ?? signal ?? 'unknown'})\n`);
    if (!quitting) {
      dialog.showErrorBox(
        'Supernova AI',
        `The local server stopped (${code ?? signal ?? 'unknown'}).\n\nCheck the log:\n${logPath}`
      );
      app.quit();
    }
  });

  try {
    await spawned;
    await waitForServer(serverPort);
  } catch (error) {
    logStream.write(`[desktop] ${error.message}\n`);
    throw error;
  }
}

function isLocalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === '127.0.0.1' && Number(parsed.port) === serverPort;
  } catch {
    return false;
  }
}

ipcMain.handle('supernova:choose-project-folder', async (event, requestedPath) => {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!isLocalUrl(senderUrl)) return null;

  const options = {
    title: 'Choose project folder',
    buttonLabel: 'Choose folder',
    properties: ['openDirectory', 'createDirectory'],
  };
  const startPath = typeof requestedPath === 'string' ? requestedPath.trim() : '';
  if (startPath && path.isAbsolute(startPath)) options.defaultPath = startPath;

  const owner = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const result = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] || null;
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0e0e0d',
    title: 'Supernova AI',
    autoHideMenuBar: true,
    icon: path.join(APP_ROOT, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocalUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocalUrl(url)) return;
    event.preventDefault();
    shell.openExternal(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
}

function stopServer() {
  if (externalServer || !serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  try {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 1200).unref();
  } catch {
    /* déjà terminé */
  }
}

const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    if (process.platform !== 'darwin') {
      Menu.setApplicationMenu(null);
    } else {
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          { role: 'appMenu' },
          { role: 'editMenu' },
          { role: 'viewMenu' },
          { role: 'windowMenu' },
        ])
      );
    }

    try {
      if (!(await useExistingSite())) await startServer();
      createWindow();
    } catch (error) {
      dialog.showErrorBox('Supernova AI', error.message);
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverPort) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    stopServer();
  });

  process.on('exit', stopServer);
}
