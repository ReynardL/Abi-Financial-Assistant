/**
 * Abi Financial Assistant - Build Script
 * 
 * This script builds all components and packages them into a single installer.
 * 
 * Prerequisites:
 * - Python 3.13+ with uv installed
 * - Node.js 18+
 * - PyInstaller (installed via uv)
 * 
 * Usage: node build.js
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const BACKEND_DIR = path.join(ROOT, 'backend');
const BRIDGE_DIR = path.join(ROOT, 'bridge');
const FRONTEND_DIR = path.join(ROOT, 'frontend');

// Helper to run commands
function run(cmd, cwd = ROOT, options = {}) {
    console.log(`\n📦 Running: ${cmd}`);
    console.log(`   in: ${cwd}\n`);
    
    try {
        execSync(cmd, { 
            cwd, 
            stdio: 'inherit', 
            shell: true,
            ...options 
        });
        return true;
    } catch (error) {
        console.error(`❌ Command failed: ${cmd}`);
        return false;
    }
}

// Clean sensitive files before build
function cleanSensitiveFiles() {
    console.log('\n🧹 Cleaning sensitive files...');
    
    // Remove .env from backend if accidentally copied
    const backendEnv = path.join(BACKEND_DIR, '.env');
    if (fs.existsSync(backendEnv)) {
        fs.unlinkSync(backendEnv);
        console.log('   Removed backend/.env');
    }
    
    // Remove actual-data db
    const actualDb = path.join(ROOT, 'actual-data', 'db.sqlite');
    if (fs.existsSync(actualDb)) {
        fs.unlinkSync(actualDb);
        console.log('   Removed actual-data/db.sqlite');
    }
    
    console.log('   ✅ Sensitive files cleaned');
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('    Abi Financial Assistant - Build Process');
    console.log('═══════════════════════════════════════════════════════════');
    
    // Step 0: Clean sensitive files
    cleanSensitiveFiles();
    
    // Step 1: Build Python Backend
    console.log('\n══ Step 1/4: Building Python Backend ══');
    if (!run('uv run pyinstaller abi_backend.spec --clean --noconfirm', BACKEND_DIR)) {
        console.error('❌ Backend build failed');
        process.exit(1);
    }
    
    // Verify backend exe exists
    const backendExe = path.join(BACKEND_DIR, 'dist', 'abi_backend.exe');
    if (!fs.existsSync(backendExe)) {
        console.error('❌ Backend exe not found at:', backendExe);
        process.exit(1);
    }
    console.log('   ✅ Backend built:', backendExe);
    
    // Step 2: Install Bridge Dependencies
    console.log('\n══ Step 2/4: Installing Bridge Dependencies ══');
    if (!run('npm install', BRIDGE_DIR)) {
        console.error('❌ Bridge npm install failed');
        process.exit(1);
    }
    console.log('   ✅ Bridge dependencies installed');
    
    // Step 3: Install Frontend Dependencies & Build React
    console.log('\n══ Step 3/4: Building Frontend ══');
    if (!run('npm install', FRONTEND_DIR)) {
        console.error('❌ Frontend npm install failed');
        process.exit(1);
    }
    
    // Step 4: Package with Electron Builder
    console.log('\n══ Step 4/4: Packaging Electron App ══');
    if (!run('npm run dist', FRONTEND_DIR)) {
        console.error('❌ Electron packaging failed');
        process.exit(1);
    }
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('    ✅ BUILD COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\nOutput location: frontend/dist-electron/');
    console.log('Look for the .exe installer or the "win-unpacked" folder.\n');
}

main().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
