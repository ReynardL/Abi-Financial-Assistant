# Abi - Personal Financial Assistant

A **privacy-first MCP-based RAG AI agent** for personal finance. Abi connects to your [Actual Budget](https://actualbudget.com/) data and uses OpenAI-compatible LLMs to answer questions, generate visualizations, forecast spending, and manage your budget—all while keeping your financial data local and secure.

**Key Highlights:**
- 🔒 **Privacy-First**: Merchant names are hashed before AI processing; your raw data never leaves your machine
- 🛠️ **MCP Tool Calling**: 13 specialized tools for querying, analyzing, and modifying your financial data
- 📊 **Local RAG**: Retrieval-augmented generation over your encrypted SQLite database
- 🤖 **Multi-Model**: Works with GPT-4o, GPT-4o-mini, o4-mini, or local LLMs (Ollama, LM Studio)

## ✅ User Prerequisites

To run Abi, you need an **Ai Key** and a Budget (from **Actual Budget**).

**1. Actual Budget (Your Financial Data)**
Abi is an assistant for [Actual Budget](https://actualbudget.org/), a free and private local budgeting app.
- **Get the App**: Download [Actual Budget](https://actualbudget.org/) and run it on your machine.
- **Connect**:
    - **Server URL**: Use your local URL (typically `http://localhost:5006`).
    - **Sync ID**: Go to **Settings** → **Show Advanced Settings** in Actual to find this.
    - **Password**: Your login password (if set).

**2. OpenAI API Key (The Brains)**
Abi uses OpenAI's intelligence to understand your questions.
- Sign up at [platform.openai.com](https://platform.openai.com/signup).
- Add $5-10 of credit (Abi is very cheap to run, but requires a funded account).
- Go to **API Keys** → **Create new secret key**.
- Copy this key (starts with `sk-...`).

## 🔧 Agent Tools

The AI agent uses MCP-style function calling with 13 tools organized by capability:

### 📖 Read (Query Data)
| Tool | Description |
|------|-------------|
| `get_account_balances` | Get current balances of all accounts and credit cards |
| `get_spending_category` | Breakdown of spending by category for a month |
| `search_transactions` | Search transactions by merchant, category, or date range |
| `get_monthly_budget` | Get budgeted amounts vs. actual spending |
| `get_all_categories` | List all available budget categories |
| `detect_recurring_payments` | Identify subscriptions and recurring charges |

### 📊 Analyze (Aggregation & Forecasting)
| Tool | Description |
|------|-------------|
| `generate_chart` | Create donut or bar chart visualizations |
| `simulate_purchase` | Check if a purchase fits within your budget |
| `forecast_expenses` | Predict future spending based on historical patterns |

### ✏️ Write (Modify Data)
| Tool | Description |
|------|-------------|
| `update_category_budget` | Set or update a category's budget amount |
| `create_transaction` | Add a new transaction (expense or income) |

### 🧠 Planning & Research
| Tool | Description |
|------|-------------|
| `create_execution_plan` | Break down complex requests into step-by-step plans |
| `web_search` | Search the web for financial context (rates, comparisons, advice) |

## 🔒 Privacy & Security

| Feature | Description |
|---------|-------------|
| **No Cloud Storage** | All financial data stays on your machine in a local encrypted database |
| **Merchant Masking** | Real merchant names are hashed (e.g., "Starbucks" → "Merchant_A1B2C3") before being sent to the AI. Unmasked only in final display. |
| **Encrypted Database** | Uses SQLCipher encryption with your Actual Budget password |
| **Local Charts** | Visualizations are generated locally and embedded as Base64 images |
| **Hybrid Web Search** | Web searches are for general knowledge only—your financial numbers are never included in queries |
| **No Credential Logging** | API keys and passwords are never logged or included in AI context |
| **Build-Time Cleaning** | The build script removes `.env` and `db.sqlite` automatically |
| **User Data Isolation** | In packaged app, user data is stored in `%AppData%/Abi Financial Assistant/`, separate from app files |

## 🏗️ Architecture

The application consists of four main components working together locally:

1.  **Frontend (Electron/React)**: Provides the chat interface, settings management, and renders interactive charts.
2.  **Backend (Python/FastAPI)**: The central intelligence that manages the AI context, executes MCP tools, and orchestrates the workflow.
3.  **Privacy Guard (Python)**: A middleware layer that hashes sensitive data (like merchant names) before it reaches the AI and unmasks it for the user.
4.  **Data Bridge (Node.js)**: A specialized service that handles synchronization and SQLCipher encryption to securely talk to your Actual Budget data.

## 🚀 Prerequisites

- **Python 3.13+** (Managed via `uv`)
- **Node.js 18+**
- **Actual Budget**: A running instance (local or hosted) and your Sync ID.
- **uv**: Fast Python package manager (`pip install uv`).

## 🛠️ Installation

### 1. Setup Backend
Navigate to the backend folder to install dependencies:
```bash
cd backend
uv sync
```

### 2. Setup Bridge
Navigate to the bridge folder:
```bash
cd bridge
npm install
```

### 3. Setup Frontend
Navigate to the frontend folder:
```bash
cd frontend
npm install
```

### 4. Environment Configuration
Create a `.env` file in the root directory (`c:\Coding\Financial Assistant\`). You can also configure these settings later via the **Settings UI** in the app.

```env
# AI Provider
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=

# Actual Budget Configuration
ACTUAL_SERVER_URL=http://localhost:5006
ACTUAL_PASSWORD=your_password
ACTUAL_SYNC_ID=your_sync_id
```

## 🏃‍♂️ Usage

### One-Click Launch
The project includes a launcher script that starts both the Python backend and the Electron frontend.

```bash
# From root directory
node launch.js
```

### Manual Launch (Legacy)
If you prefer identifying issues in specific services:
1.  **Backend**: `cd backend && uv run server.py`
2.  **Frontend**: `cd frontend && npm start`

## 📦 Building for Distribution

To create a standalone Windows installer:

```bash
# From root directory
node build.js
```

This will:
1. Build the Python backend into a standalone `.exe`
2. Install bridge dependencies
3. Build the React frontend
4. Package everything with Electron Builder

**Output**: The installer will be in `frontend/dist-electron/`.

## 🔌 API Endpoints (Backend)

- `POST /chat`: Interact with the agent.
- `GET /settings`: Retrieve current configuration (masked, no secrets exposed).
- `POST /settings`: Update API keys or Model preferences.
- `POST /sync`: Trigger a manual sync from Actual Budget.

##  License

MIT License - See LICENSE file for details.
