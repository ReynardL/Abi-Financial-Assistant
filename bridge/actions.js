const api = require('@actual-app/api');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3-multiple-ciphers'); // Use Cipher version

// Support for packaged app: allow overriding paths via env vars
const ENV_PATH = process.env.ABI_ENV_PATH || path.join(__dirname, '../.env');
const DATA_DIR = process.env.ABI_DATA_DIR || path.join(__dirname, '..');

require('dotenv').config({ path: ENV_PATH });

const SERVER_URL = process.env.ACTUAL_SERVER_URL;
const PASSWORD = process.env.ACTUAL_PASSWORD;
const SYNC_ID = process.env.ACTUAL_SYNC_ID;

// Define DB Path - use configurable data directory
const DB_PATH = path.join(DATA_DIR, 'actual-data/db.sqlite');
// Temp Cache for Write Ops (will be deleted)
const TEMP_CACHE_DIR = path.join(__dirname, 'temp-write-cache');

// Helper to find ID by name
function findIdByName(list, name, typeName) {
  const norm = name.toLowerCase().trim();
  const item = list.find(i => i.name.toLowerCase().trim() === norm);
  if (!item) {
    throw new Error(`${typeName} '${name}' not found.`);
  }
  return item.id;
}

// === READ OPERATIONS (Direct Encrypted DB Access) ===
async function runQuery(payload) {
  const { sql, params } = payload;
  
  // Open Encrypted DB
  const db = new Database(DB_PATH);
  db.pragma(`key = '${PASSWORD}'`);
  
  try {
    const stmt = db.prepare(sql);
    let rows;
    if (sql.trim().toLowerCase().startsWith('select')) {
      // Return raw arrays (tuples) to match Python's sqlite3 behavior
      stmt.raw(true);
      rows = stmt.all(params || []);
    } else {
      stmt.raw(true);
      rows = stmt.all(params || []);
    }
    console.log(JSON.stringify(rows));
  } catch (err) {
    console.error("SQL Error:", err.message);
    throw err;
  } finally {
    db.close();
  }
}

// === WRITE OPERATIONS (User Action via API) ===
async function updateCategoryBudget(payload) {
  const { category_name, month, amount_dollars } = payload;
  
  const categories = await api.getCategories();
  // Categories structure is often grouped. Flat list might be needed or API returns flat.
  // api.getCategories returns { data: [...] } or [...]?
  // Assuming array.
  
  const catId = findIdByName(categories, category_name, 'Category');
  const amountCents = Math.round(amount_dollars * 100);
  
  await api.setBudgetAmount(month, catId, amountCents);
  console.log(`Updated budget for ${category_name} in ${month} to $${amount_dollars}`);
}

async function createTransaction(payload) {
  const { date, amount_dollars, payee_name, category_name, account_name, notes } = payload;
  
  // 1. Resolve Account
  const accounts = await api.getAccounts();
  const acctId = findIdByName(accounts, account_name, 'Account');
  
  // 2. Resolve Category
  const categories = await api.getCategories();
  const catId = findIdByName(categories, category_name, 'Category');
  
  // 3. Resolve Payee
  const payees = await api.getPayees();
  let payeeId = payees.find(p => p.name.toLowerCase() === payee_name.toLowerCase())?.id;
  
  if (!payeeId) {
    console.log(`Creating new payee: ${payee_name}`);
    payeeId = await api.createPayee({ name: payee_name });
  }
  
  const amountCents = Math.round(amount_dollars * 100);
  
  const transaction = {
    date,
    amount: amountCents,
    payee: payeeId,
    category: catId,
    notes,
    cleared: false
  };
  
  await api.addTransactions(acctId, [transaction]);
  console.log(`Transaction created.`);
}

async function adjustAccountBalance(payload) {
  const { account_name, new_balance_dollars } = payload;
  
  const accounts = await api.getAccounts();
  const acctId = findIdByName(accounts, account_name, 'Account');
  
  // Calculate current balance
  // api.getTransactions returns all transactions for account
  const transactions = await api.getTransactions(acctId);
  const currentBalanceCents = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
  
  const targetCents = Math.round(new_balance_dollars * 100);
  const diffCents = targetCents - currentBalanceCents;
  
  if (diffCents === 0) {
    console.log("Balance is already correct.");
    return;
  }
  
  // Get/Create Payee for Adjustment
  const payees = await api.getPayees();
  const adjPayeeName = "Manual Balance Adjustment";
  let payeeId = payees.find(p => p.name === adjPayeeName)?.id;
  if (!payeeId) {
    payeeId = await api.createPayee({ name: adjPayeeName });
  }
  
  await api.addTransactions(acctId, [{
    date: new Date().toISOString().slice(0, 10),
    amount: diffCents,
    payee: payeeId,
    notes: "Balance Adjustment via Agent",
    cleared: true
  }]);
  
  console.log(`Adjusted balance by $${diffCents / 100}.`);
}

async function main() {
  const action = process.argv[2];
  const payloadStr = process.argv[3];
  
  if (!action || !payloadStr) {
    console.error("Usage: node actions.js <action> <json_payload>");
    process.exit(1);
  }

  const payload = JSON.parse(payloadStr);

  try {
    // Branch: If it's a READ query, don't init API (saves time/memory)
    if (action === 'run_query') {
      await runQuery(payload);
      return;
    }

    // console.log("Connecting to Actual Budget...");
    // Ensure temp dir exists
    if (!fs.existsSync(TEMP_CACHE_DIR)) {
        fs.mkdirSync(TEMP_CACHE_DIR);
    }

    await api.init({
      serverURL: SERVER_URL,
      password: PASSWORD,
      dataDir: TEMP_CACHE_DIR, 
    });
    
    await api.downloadBudget(SYNC_ID);
    
    if (action === 'update_category_budget') {
      await updateCategoryBudget(payload);
    } else if (action === 'create_transaction') {
      await createTransaction(payload);
    } else if (action === 'adjust_account_balance') {
      await adjustAccountBalance(payload);
    } else {
        throw new Error(`Unknown action: ${action}`);
    }
    
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  } finally {
    if (action !== 'run_query') {
      await api.shutdown();
      // SECURITY: Cleanup unencrypted cache
      try {
        if (fs.existsSync(TEMP_CACHE_DIR)) {
            fs.rmSync(TEMP_CACHE_DIR, { recursive: true, force: true });
        }
      } catch (cleanupErr) {
          console.error("Warning: Failed to cleanup temp cache:", cleanupErr.message);
      }
    }
  }
}

main();
