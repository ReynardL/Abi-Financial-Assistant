const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');

let backendProcess = null;
let mainWindow = null;

// PATH CONFIGURATION
function getResourcesPath() {
  if (app.isPackaged) {
    return process.resourcesPath;
  } else {
    return path.join(__dirname, '../../');
  }
}

function getUserDataPath() {
  // Use Electron's standard userData path for user-specific data (C:\Users\<user>\AppData\Roaming\Abi Financial Assistant)
  return app.getPath('userData');
}

function ensureUserDataStructure() {
  const userDataPath = getUserDataPath();
  const actualDataDir = path.join(userDataPath, 'actual-data');
  
  // Create directories if they don't exist
  if (!fs.existsSync(actualDataDir)) {
    fs.mkdirSync(actualDataDir, { recursive: true });
  }
  
  // Create empty .env if it doesn't exist
  const envPath = path.join(userDataPath, '.env');
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, '# Abi Financial Assistant Configuration\n');
  }
  
  return {
    userDataPath,
    actualDataDir,
    envPath
  };
}

// SYNC FUNCTIONALITY 
function runSync() {
  const resourcesPath = getResourcesPath();
  const { userDataPath, envPath } = ensureUserDataStructure();
  
  const bridgeDir = app.isPackaged 
    ? path.join(resourcesPath, 'bridge')
    : path.join(resourcesPath, 'bridge');
  
  const syncScript = path.join(bridgeDir, 'sync.js');
  
  // Check if sync script exists
  if (!fs.existsSync(syncScript)) {
    console.log('Sync script not found at:', syncScript);
    return false;
  }
  
  // Check if credentials are configured
  require('dotenv').config({ path: envPath });
  if (!process.env.ACTUAL_PASSWORD || !process.env.ACTUAL_SYNC_ID) {
    console.log('Sync skipped: Actual Budget credentials not configured');
    return false;
  }
  
  console.log('Running data sync...');
  
  try {
    const result = spawnSync('node', [syncScript], {
      cwd: bridgeDir,
      env: {
        ...process.env,
        ABI_ENV_PATH: envPath,
        ABI_DATA_DIR: userDataPath
      },
      stdio: 'inherit',
      timeout: 120000 // 2 minute timeout
    });
    
    if (result.error) {
      console.error('Sync error:', result.error);
      return false;
    }
    
    if (result.status !== 0) {
      console.error('Sync failed with exit code:', result.status);
      return false;
    }
    
    console.log('Data sync completed successfully');
    return true;
  } catch (error) {
    console.error('Sync exception:', error);
    return false;
  }
}

// BACKEND MANAGEMENT
function startBackend() {
  const resourcesPath = getResourcesPath();
  const { userDataPath, envPath } = ensureUserDataStructure();
  
  const bridgeDir = app.isPackaged 
    ? path.join(resourcesPath, 'bridge')
    : path.join(resourcesPath, 'bridge');
  
  const backendExe = app.isPackaged 
    ? path.join(resourcesPath, 'backend', 'abi_backend.exe')
    : null;
  
  if (app.isPackaged && backendExe && fs.existsSync(backendExe)) {
    console.log('Starting backend from:', backendExe);
    console.log('User data path:', userDataPath);
    
    backendProcess = spawn(backendExe, [], {
      cwd: userDataPath,
      env: {
        ...process.env,
        ABI_ENV_PATH: envPath,
        ABI_DATA_DIR: userDataPath,
        ABI_BRIDGE_DIR: bridgeDir
      },
      stdio: 'pipe',
      windowsHide: true,
      detached: false,
      shell: false
    });
    
    backendProcess.stdout.on('data', (data) => {
      console.log(`Backend: ${data}`);
    });
    
    backendProcess.stderr.on('data', (data) => {
      console.error(`Backend Error: ${data}`);
    });
    
    backendProcess.on('error', (err) => {
      console.error('Failed to start backend:', err);
    });
    
    backendProcess.on('exit', (code, signal) => {
      console.log(`Backend exited with code ${code}, signal ${signal}`);
      backendProcess = null;
    });
    
  } else {
    console.log('Development mode: Backend should be started manually with "uv run server.py"');
  }
}

function stopBackend() {
  if (backendProcess) {
    console.log('Stopping backend...');
    
    // On Windows, we need to kill the process tree
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', backendProcess.pid, '/f', '/t'], { windowsHide: true });
    } else {
      backendProcess.kill('SIGTERM');
    }
    
    backendProcess = null;
  }
}

// WINDOW MANAGEMENT
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 450,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: "Abi - Financial Assistant",
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f7',
    icon: path.join(__dirname, 'icon.ico')
  });

  // In production, load the index.html from the dist folder
  const isDev = !app.isPackaged;
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// BACKEND HEALTH CHECK
function waitForBackend(url, timeoutMs = 60000, intervalMs = 1000) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const req = http.get(url, (res) => {
        if (res.statusCode === 200) {
          console.log('Backend is ready!');
          resolve(true);
        } else {
          retry();
        }
      });
      req.on('error', () => retry());
      req.setTimeout(2000, () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() >= deadline) {
        console.warn('Backend did not become ready within timeout, opening window anyway.');
        resolve(false);
      } else {
        setTimeout(check, intervalMs);
      }
    };
    check();
  });
}

// APP LIFECYCLE
app.whenReady().then(async () => {
  // 1. Ensure user data structure exists
  const { userDataPath } = ensureUserDataStructure();
  console.log('User data directory:', userDataPath);
  
  // 2. Run sync if credentials are configured
  runSync();
  
  // 3. Start backend
  startBackend();
  
  // 4. Wait for backend to actually be ready, then show window
  if (app.isPackaged) {
    console.log('Waiting for backend to start...');
    await waitForBackend('http://localhost:8000/health', 60000, 1000);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend();
});
