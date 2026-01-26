const fs = require('fs');
const path = require('path');

// Support for packaged app: allow overriding paths via env vars
const ENV_PATH = process.env.ABI_ENV_PATH || path.join(__dirname, '../.env');
const DATA_DIR = process.env.ABI_DATA_DIR || path.join(__dirname, '..');

require('dotenv').config({ path: ENV_PATH });

const api = require('@actual-app/api');

const SERVER_URL = process.env.ACTUAL_SERVER_URL || 'http://localhost:5007';
const PASSWORD = process.env.ACTUAL_PASSWORD;
const SYNC_ID = process.env.ACTUAL_SYNC_ID;

const OUTPUT_DIR = path.join(DATA_DIR, 'actual-data');
const OUTPUT_DB_PATH = path.join(OUTPUT_DIR, 'db.sqlite');

async function findDatabase(startPath) {
  if (!fs.existsSync(startPath)) return null;
  
  // Recursive search
  const files = fs.readdirSync(startPath);
  
  for (const file of files) {
    const fullPath = path.join(startPath, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      // Check if db.sqlite exists directly in this subdirectory
      const directDbPath = path.join(fullPath, 'db.sqlite');
      if (fs.existsSync(directDbPath)) {
          return directDbPath;
      }
      
      const result = await findDatabase(fullPath);
      if (result) return result;
    }
  }
  return null;
}

async function run() {
  // 1. Validation
  if (!PASSWORD || !SYNC_ID) {
    console.error('Error: Missing ACTUAL_PASSWORD or ACTUAL_SYNC_ID in .env file');
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)){
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const CACHE_DIR = path.join(__dirname, 'temp-cache');
  
  if (fs.existsSync(CACHE_DIR)) {
      try {
        fs.rmSync(CACHE_DIR, { recursive: true, force: true });
      } catch (e) {
          // ignore errors if any
      }
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  await api.init({ 
    dataDir: CACHE_DIR, 
    serverURL: SERVER_URL,
    password: PASSWORD 
  });

  try {
    console.log(`1. Downloading Budget (ID: ${SYNC_ID})...`);
    
    await api.downloadBudget(SYNC_ID);
    
    console.log('2. Sync Complete. Exporting SQL Data...');
    
    await api.shutdown();

    const srcDbPath = await findDatabase(CACHE_DIR);
    
    if (srcDbPath) {
        console.log(`   Found database at: ${srcDbPath}`);
        
        if (fs.existsSync(OUTPUT_DB_PATH)) {
            fs.unlinkSync(OUTPUT_DB_PATH);
        }
        
        const Database = require('better-sqlite3-multiple-ciphers');
        
        const db = new Database(OUTPUT_DB_PATH);
        
        db.pragma(`key = '${PASSWORD}'`); // Use the Actual Budget password as key
        
        db.prepare(`ATTACH DATABASE '${srcDbPath}' AS plaintext KEY ''`).run();
        
        const tables = db.prepare("SELECT name FROM plaintext.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
        
        console.log(`Encrypting ${tables.length} tables...`);
        
        db.pragma('foreign_keys = OFF'); 
        db.exec("BEGIN");
        for (const table of tables) {
            const tableName = table.name;
            const schemaObj = db.prepare(`SELECT sql FROM plaintext.sqlite_schema WHERE name = ?`).get(tableName);
            
            if (!schemaObj || !schemaObj.sql) {
                console.warn(`Skipping ${tableName}: No SQL schema found.`);
                continue;
            }
            
            const schema = schemaObj.sql;
            
            try {
                db.exec(schema); 
                db.exec(`INSERT INTO main."${tableName}" SELECT * FROM plaintext."${tableName}"`);
            } catch (err) {
                 console.error(`Error processing table ${tableName}:`, err.message);
                 throw err;
            }
        }
        db.exec("COMMIT");
        db.pragma('foreign_keys = ON');
        
        db.prepare("DETACH DATABASE plaintext").run();
        db.close();
        
        console.log(`Encrypted & Exported to: ${OUTPUT_DB_PATH}`);
        
        console.log('Cleaning up unencrypted cache...');
        fs.rmSync(CACHE_DIR, { recursive: true, force: true });
        
    } else {
        console.error('Error: Could not find downloaded .sqlite file in cache.');
    }

  } catch (error) {
    console.error('Error during sync:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}
