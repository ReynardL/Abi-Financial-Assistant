const { spawn, spawnSync } = require('child_process');
const path = require('path');

// Paths
const backendDir = path.join(__dirname, 'backend');
const frontendDir = path.join(__dirname, 'frontend');
const bridgeDir = path.join(__dirname, 'bridge');

console.log("Starting Sentinel Finance System...");

// 0. Sync Data
console.log("Syncing Actual Budget Data...");
const sync = spawnSync('node', ['sync.js'], {
    cwd: bridgeDir,
    shell: true,
    stdio: 'inherit'
});

if (sync.error) {
    console.error("Sync failed to start:", sync.error);
} else if (sync.status !== 0) {
    console.error("Sync failed with exit code:", sync.status);
} else {
    console.log("Data Synced Successfully.");
}

// 1. Start Python Backend
console.log("Launching Backend Server...");
const backend = spawn('uv', ['run', 'server.py'], {
    cwd: backendDir,
    shell: true,
    stdio: 'inherit' 
});

// 2. Start Electron Frontend
console.log("Launching Frontend...");
const frontend = spawn('npm', ['start'], {
    cwd: frontendDir,
    shell: true,
    stdio: 'inherit'
});

// Cleanup Logic
function cleanup() {
    console.log("\nShutting down services...");
    
    if (backend) {
        console.log("   Killing Backend...");
        backend.kill(); 
        if (process.platform === 'win32') {
             spawn("taskkill", ["/pid", backend.pid, '/f', '/t']);
        }
    }
    
    process.exit();
}

// Handle Exit Signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

// If Electron closes (controlled via npm start process usually), we exit.
frontend.on('close', (code) => {
    console.log(`Frontend exited with code ${code}`);
    cleanup();
});

backend.on('close', (code) => {
    console.log(`Backend exited unexpectedly with code ${code}`);
    cleanup();
});
