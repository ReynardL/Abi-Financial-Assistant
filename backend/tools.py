import os
import uuid
import subprocess
import json
from datetime import datetime, timedelta
from typing import List, Dict, Any
import io
import base64
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from privacy_guard import PrivacyGuard
from ddgs import DDGS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Support for packaged app, allow overriding paths via env vars
DATA_DIR = os.environ.get('ABI_DATA_DIR', os.path.dirname(BASE_DIR))
BRIDGE_DIR = os.environ.get('ABI_BRIDGE_DIR', os.path.join(os.path.dirname(BASE_DIR), 'bridge'))

guard = PrivacyGuard()

CHART_CACHE = {}

def execute_sql_query(sql: str, params: tuple = ()):
    """
    Executes a SQL query against the ENCRYPTED database via the Node.js bridge.
    Returns: List of rows (tuples) or raises Exception.
    """
    safe_params = list(params) 
    
    payload = {"sql": sql, "params": safe_params}
    result_json = _run_bridge_action("run_query", payload)
    
    try:
        rows = json.loads(result_json) # rows is a list of lists (tuples equivalent)
    except Exception as e:
        raise Exception(f"Bridge Error (JSON Parse): {e} | Raw: {result_json}")

    return rows

def _get_month_bounds(month_str: str):
    """
    Helper: Returns start and end INTEGER dates (YYYYMMDD) for a given month.
    """
    try:
        dt = datetime.strptime(month_str, "%Y-%m")
        start_date = int(dt.strftime("%Y%m%d"))
        next_month = dt.replace(day=28) + timedelta(days=4)
        last_day = next_month - timedelta(days=next_month.day)
        end_date = int(last_day.strftime("%Y%m%d"))
        
        return start_date, end_date
    except ValueError:
        raise ValueError("Invalid month format. Expected YYYY-MM.")

def _get_category_map_new():
    """Returns a dict mapping category ID to Name."""
    rows = execute_sql_query("SELECT id, name FROM categories WHERE hidden = 0")
    return {row[0]: row[1] for row in rows}

def _run_bridge_action(action_name: str, payload: dict):
    """
    Helper to run the Node.js bridge script.
    """
    bridge_script = os.path.join(BRIDGE_DIR, "actions.js")
    
    env = os.environ.copy()
    env['ABI_DATA_DIR'] = DATA_DIR
    env['ABI_ENV_PATH'] = os.environ.get('ABI_ENV_PATH', os.path.join(DATA_DIR, '.env'))
    
    args = ["node", bridge_script, action_name, json.dumps(payload)]
    
    try:
        result = subprocess.run(args, capture_output=True, text=True, check=True, env=env)
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        error_msg = e.stderr if e.stderr else str(e)
        raise Exception(f"Bridge Action Failed: {error_msg}")


def get_spending_category(month: str):
    """
    Returns total spending for each category in a specific month.
    Args:
        month: Format 'YYYY-MM' (e.g., '2025-11')
    """
    start_date, end_date = _get_month_bounds(month)

    query = """
    SELECT 
        c.name as category, 
        SUM(t.amount) as total_cents
    FROM transactions t
    LEFT JOIN categories c ON t.category = c.id
    WHERE t.date >= ? AND t.date <= ?
    AND t.amount < 0 
    AND t.isParent = 0 
    AND t.tombstone = 0
    AND c.hidden = 0
    GROUP BY c.name
    ORDER BY total_cents ASC
    """
    
    rows = execute_sql_query(query, (start_date, end_date))
    
    if not rows:
        return f"No spending data found for {month}."

    report = [f"--- Spending Report for {month} ---"]
    for row in rows:
        category, amount_cents = row
        if not category:
            category = "Uncategorized"
            
        amount_dollars = abs(amount_cents) / 100.0
        report.append(f"{category}: ${amount_dollars:.2f}")
            
    return "\n".join(report)

def search_transactions(keyword: str, start_date: str = None, end_date: str = None, limit: int = 5):
    """
    Searches for transactions by merchant or category, optionally filtered by date range.
    Returns ANONYMIZED data.
    """
    query = """
    SELECT t.date, t.amount, p.name, c.name 
    FROM transactions t
    LEFT JOIN categories c ON t.category = c.id
    LEFT JOIN payees p ON t.description = p.id
    WHERE (p.name LIKE ? OR c.name LIKE ?)
    AND t.isParent = 0
    AND t.tombstone = 0
    AND c.hidden = 0
    """
    params = [f"%{keyword}%", f"%{keyword}%"]
    
    if start_date:
        try:
            # Convert YYYY-MM-DD to YYYYMMDD
            s_int = int(start_date.replace("-", ""))
            query += " AND t.date >= ?"
            params.append(s_int)
        except ValueError:
            pass
            
    if end_date:
        try:
            # Convert YYYY-MM-DD to YYYYMMDD
            e_int = int(end_date.replace("-", ""))
            query += " AND t.date <= ?"
            params.append(e_int)
        except ValueError:
            pass

    query += " ORDER BY t.date DESC LIMIT ?"
    params.append(limit)
    
    rows = execute_sql_query(query, tuple(params))
    
    if not rows:
        return "No transactions found."

    # Apply Privacy Guard
    safe_results = []
    for row in rows: # row: (date, amount_cents, payee_name, category_name)
        safe_results.append(guard.sanitize_transaction(row))

    return "\n".join(safe_results)

def get_account_balances():
    """
    Returns the current balance of all open (on-budget and off-budget) accounts.
    """
    # Get List of Accounts
    accounts = execute_sql_query("""
        SELECT id, name, type, offbudget 
        FROM accounts 
        WHERE closed = 0 AND tombstone = 0
        ORDER BY offbudget, name
    """)
    
    report = ["--- Account Balances ---"]
    
    total_net_worth = 0.0
    
    for acct in accounts:
        acct_id, name, type_, offbudget = acct
        
        # Sum transactions for this account
        result = execute_sql_query("""
            SELECT SUM(amount) 
            FROM transactions 
            WHERE acct = ? AND tombstone = 0 AND isParent = 0
        """, (acct_id,))
        
        balance_cents = result[0][0] if result and result[0][0] is not None else 0
        balance_dollars = balance_cents / 100.0
        
        # Format output
        status = "(Off-Budget)" if offbudget else ""
        report.append(f"{name} {status}: ${balance_dollars:,.2f}")
        
        total_net_worth += balance_dollars

    report.append(f"------------------------")
    report.append(f"Total Net Worth: ${total_net_worth:,.2f}")
    
    return "\n".join(report)

def get_monthly_budget(month: str):
    """
    Returns the budget amounts for all categories in a specific month.
    """
    try:
        # CONVERT YYYY-MM to YYYYMM
        month_id = int(month.replace("-", "")) 
    except ValueError:
        return "Invalid month format. Use YYYY-MM."
        
    cat_map = _get_category_map_new()
    
    rows = execute_sql_query("""
        SELECT category, amount 
        FROM zero_budgets 
        WHERE month = ? AND amount > 0
    """, (month_id,))
    
    if not rows:
        return f"No budget data found for {month}."
        
    report = [f"--- Monthly Budget for {month} ---"]
    total_budget = 0
    
    for row in rows:
        cat_id, amount_cents = row
        cat_name = cat_map.get(cat_id)
        if not cat_name:
            continue
        
        amount_dollars = amount_cents / 100.0
        total_budget += amount_dollars
        report.append(f"{cat_name}: ${amount_dollars:,.2f}")
        
    report.append("----------------")
    report.append(f"Total Budgeted: ${total_budget:,.2f}")
    
    return "\n".join(report)

def get_all_categories():
    """
    Returns a list of all available categories in the budget. Use this to verify category names before updating budgets.
    """
    cat_map = _get_category_map_new()
    
    categories = sorted(list(cat_map.values()))
    return "--- Available Categories ---\n" + "\n".join(categories)

def simulate_purchase(amount_dollars: float, category_name: str):
    """
    Simulator Tool: Checks if a purchase is affordable within the current month's budget.
    """
    # Assume current month
    current_month = datetime.now().strftime("%Y-%m")
    month_id = int(current_month.replace("-", "") + "01")
    start_date, end_date = _get_month_bounds(current_month)
    
    # Find category ID
    rows_cat = execute_sql_query("SELECT id FROM categories WHERE name LIKE ?", (f"%{category_name}%",))
    if not rows_cat:
        return f"Category '{category_name}' not found."
    
    cat_id = rows_cat[0][0]
    
    # Get Budget and Spent
    rows_budget = execute_sql_query("SELECT amount FROM zero_budgets WHERE month = ? AND category = ?", (month_id, cat_id))
    budgeted = rows_budget[0][0] if rows_budget else 0
    
    rows_spent = execute_sql_query("""
        SELECT SUM(amount) FROM transactions 
        WHERE category = ? AND date >= ? AND date <= ? AND isParent = 0 AND tombstone = 0
    """, (cat_id, start_date, end_date))
    spent = rows_spent[0][0] if rows_spent and rows_spent[0][0] else 0
    
    remaining_cents = budgeted + spent # spent is negative
    purchase_cents = int(amount_dollars * 100)
    
    new_remaining = remaining_cents - purchase_cents
    
    rem_dol = remaining_cents / 100.0
    
    if new_remaining >= 0:
        return f"Affordable. You have ${rem_dol:,.2f} left. After spending ${amount_dollars:,.2f}, you will have ${new_remaining / 100.0:,.2f} remaining."
    else:
        return f"Not affordable. You only have ${rem_dol:,.2f} left. This purchase would put you ${abs(new_remaining) / 100.0:,.2f} over budget."

def forecast_expenses(category_name: str, months_ahead: int = 1):
    """
    Forecast Tool: Predicts future expenses based on average of last 6 months.
    """
    # Find category ID
    rows_cat = execute_sql_query("SELECT id FROM categories WHERE name LIKE ?", (f"%{category_name}%",))
    if not rows_cat:
        return f"Category '{category_name}' not found."
    cat_id = rows_cat[0][0]
    
    # Get last 6 months data
    today = datetime.now()
    cutoff_date = (today - timedelta(days=180)).strftime("%Y%m%d")
    
    rows_spent = execute_sql_query("""
        SELECT SUM(amount) 
        FROM transactions 
        WHERE category = ? AND date >= ? AND isParent = 0 AND tombstone = 0
    """, (cat_id, int(cutoff_date)))
    
    total_spent = rows_spent[0][0] if rows_spent and rows_spent[0][0] else 0
    
    # Average per month (approx 6 months)
    avg_monthly_cents = abs(total_spent) / 6.0
    
    predicted_cents = avg_monthly_cents * months_ahead
    
    return f"Based on the last 6 months, predicted spending for '{category_name}' over the next {months_ahead} months is approx ${predicted_cents / 100.0:,.2f} (Avg ${avg_monthly_cents/100:.2f}/mo)."

def detect_recurring_payments():
    """
    Recurring Payments Tool: Detects subscriptions based on identical amounts and merchant names.
    """
    # Look at last 6 months
    rows = execute_sql_query("""
        SELECT p.name, t.amount, COUNT(*) as cnt
        FROM transactions t
        LEFT JOIN payees p ON t.description = p.id
        WHERE t.isParent = 0 AND t.tombstone = 0 AND t.amount < 0
        GROUP BY p.name, t.amount
        HAVING cnt >= 3
        ORDER BY cnt DESC
    """)
    
    report = ["--- Detected Recurring Payments (Likely Subscriptions) ---"]
    for row in rows:
        name = row[0]
        amt = abs(row[1]) / 100.0
        freq = row[2]
        if name:
            # Apply Privacy Guard
            safe_name = guard.mask_merchant(name)
            report.append(f"- {safe_name}: ${amt:.2f} (Seen {freq} times)")
            
    return "\n".join(report)

def update_category_budget(category_name: str, month: str, amount_dollars: float):
    """
    Updates the budget amount for a specific category and month using the Actual Budget API.
    """
    payload = {
        "category_name": category_name,
        "month": month,
        "amount_dollars": amount_dollars
    }
    # Invoke Bridge Action
    return _run_bridge_action("update_category_budget", payload)

def create_transaction(
    date: str, 
    amount_dollars: float, 
    payee_name: str, 
    category_name: str, 
    account_name: str, 
    notes: str = "",
    transaction_type: str = "expense"
):
    """
    Creates a new transaction using the Actual Budget API.
    """
    # Force correct sign based on type
    final_amount = float(amount_dollars)
    if transaction_type.lower() == "expense":
        # Expenses are negative
        if final_amount > 0:
            final_amount = -final_amount
    elif transaction_type.lower() == "income":
        # Income are positive
        if final_amount < 0:
            final_amount = -final_amount
            
    payload = {
        "date": date,
        "amount_dollars": final_amount,
        "payee_name": payee_name,
        "category_name": category_name,
        "account_name": account_name,
        "notes": notes
    }
    return _run_bridge_action("create_transaction", payload)

def web_search(query: str):
    """
    Performs a web search for general questions, budgeting advice, or comparisons.
    """
    print(f"Searching the Web for: {query}")
    try:
        # region='wt-wt' gives broader results (World), 'us-en' or 'ca-en' for English.
        results = DDGS().text(query, region='wt-wt', max_results=3)
        if not results:
            return "No web results found."
        
        # Format results
        formatted = []
        for r in results:
            formatted.append(f"Title: {r['title']}\nLink: {r['href']}\nSnippet: {r['body']}\n")
        
        return "\n---\n".join(formatted)
    except Exception as e:
        return f"Web search failed: {str(e)}"

def create_execution_plan(rationale: str, steps: List[Dict[str, Any]]):
    """
    Creates a structured execution plan for complex tasks.
    """
    plan = [f"--- Execution Plan ---", f"Rationale: {rationale}", "Steps:"]
    for step in steps:
        plan.append(f"{step['step_number']}. {step['description']} (Tool: {step['tool_needed']})")
    
    return "\n".join(plan)

def generate_chart(chart_type: str, month: str = None, top_n: int = 5):
    """
    Generates a chart (donut or bar) for spending in a given month.
    """
    if not month:
        month = datetime.now().strftime("%Y-%m")

    start_date, end_date = _get_month_bounds(month)
    
    query = """
    SELECT 
        c.name as category, 
        SUM(t.amount) as total_cents
    FROM transactions t
    LEFT JOIN categories c ON t.category = c.id
    WHERE t.date >= ? AND t.date <= ?
    AND t.amount < 0 
    AND t.isParent = 0 
    AND t.tombstone = 0
    AND c.hidden = 0
    GROUP BY c.name
    ORDER BY total_cents ASC
    """
    rows = execute_sql_query(query, (start_date, end_date))
    
    if not rows:
        return f"No spending data found for {month}."

    # Process Data
    labels = []
    values = []
    
    for row in rows:
        cat_name, amount_cents = row
        if not cat_name: cat_name = "Uncategorized"
        amount = abs(amount_cents) / 100.0
        labels.append(cat_name)
        values.append(amount)

    # Top N
    if len(labels) > top_n:
        top_labels = labels[:top_n]
        top_values = values[:top_n]
        other_val = sum(values[top_n:])
        top_labels.append("Others")
        top_values.append(other_val)
        labels = top_labels
        values = top_values

    # Plot
    plt.rcParams.update({'font.size': 14})
    
    plt.figure(figsize=(10, 6))
    
    if chart_type == 'donut':
        # Donut Chart
        plt.pie(values, labels=labels, autopct='%1.1f%%', startangle=90, pctdistance=0.85, textprops={'fontsize': 14})
        centre_circle = plt.Circle((0,0),0.70,fc='white')
        fig = plt.gcf()
        fig.gca().add_artist(centre_circle)
        plt.title(f"Spending Breakdown - {month}", fontsize=18, fontweight='bold')
    else:
        # Bar Chart
        plt.bar(labels, values, color='#6200ea')
        plt.xlabel('Category', fontsize=14)
        plt.ylabel('Amount ($)', fontsize=14)
        plt.title(f"Spending by Category - {month}", fontsize=18, fontweight='bold')
        plt.xticks(rotation=45, ha='right', fontsize=12)
        plt.yticks(fontsize=12)

    plt.tight_layout()
    
    # Save to buffer
    buf = io.BytesIO()
    plt.savefig(buf, format='png')
    plt.close()
    buf.seek(0)
    
    # Encode to base64
    img_str = base64.b64encode(buf.read()).decode('utf-8')
    
    # Store in Cache instead of returning to LLM
    chart_id = str(uuid.uuid4())
    CHART_CACHE[chart_id] = img_str
    
    # Return a reference ID
    return f"Chart generated successfully. Reference ID: {chart_id}"

# List of Tools
TOOL_DEFINITIONS = [
    {
      "type": "function",
      "function": {
        "name": "generate_chart",
        "description": "Generate a chart (donut or bar) visualization of spending. Returns a Markdown image string.",
        "parameters": {
          "type": "object",
          "properties": {
             "chart_type": {"type": "string", "enum": ["donut", "bar"]},
             "month": {"type": "string", "description": "YYYY-MM"},
             "top_n": {"type": "integer"}
          },
          "required": ["chart_type"]
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "create_execution_plan",
        "description": "CRITICAL: Call this FIRST for any multi-step request (like creating budgets, planning trips, or complex analysis). Breaks the user's prompt into a step-by-step list of tools to call.",
        "parameters": {
          "type": "object",
          "properties": {
            "rationale": {
              "type": "string",
              "description": "Brief explanation of why a plan is needed."
            },
            "steps": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "step_number": { "type": "integer" },
                  "description": { "type": "string", "description": "What needs to be done in this step (e.g., 'Fetch last 3 months of spending')." },
                  "tool_needed": { "type": "string", "description": "The specific tool to use for this step." }
                },
                "required": ["step_number", "description", "tool_needed"]
              }
            }
          },
          "required": ["rationale", "steps"]
        }
      }
    },
    {"type": "function", "function": {"name": "get_account_balances", "description": "Get current balances of all checked and savings accounts and credit cards.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "get_spending_category", "description": "Get a breakdown of spending by category for a specific month.", "parameters": {"type": "object", "properties": {"month": {"type": "string", "description": "YYYY-MM"}}, "required": ["month"]}}},
    {"type": "function", "function": {"name": "search_transactions", "description": "Search for specific transactions by merchant name or category. Can filter by date range.", "parameters": {"type": "object", "properties": {"keyword": {"type": "string"}, "start_date": {"type": "string", "description": "YYYY-MM-DD"}, "end_date": {"type": "string", "description": "YYYY-MM-DD"}}, "required": ["keyword"]}}},
    {"type": "function", "function": {"name": "web_search", "description": "Search the web for general financial advice.", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "get_monthly_budget", "description": "Get the budgeted amounts for the month.", "parameters": {"type": "object", "properties": {"month": {"type": "string"}}, "required": ["month"]}}},
    {"type": "function", "function": {"name": "get_all_categories", "description": "List all available categories. Call this before updating a budget to ensure the category exists.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "simulate_purchase", "description": "Check if a purchase is affordable.", "parameters": {"type": "object", "properties": {"amount_dollars": {"type": "number"}, "category_name": {"type": "string"}}, "required": ["amount_dollars", "category_name"]}}},
    {"type": "function", "function": {"name": "forecast_expenses", "description": "Predict future expenses for a category.", "parameters": {"type": "object", "properties": {"category_name": {"type": "string"}, "months_ahead": {"type": "integer"}}, "required": ["category_name"]}}},
    {"type": "function", "function": {"name": "detect_recurring_payments", "description": "Identify recurring subscriptions."}},
    {"type": "function", "function": {"name": "update_category_budget", "description": "Update the budget for a category.", "parameters": {"type": "object", "properties": {"category_name": {"type": "string"}, "month": {"type": "string"}, "amount_dollars": {"type": "number"}}, "required": ["category_name", "month", "amount_dollars"]}}},
    {"type": "function", "function": {"name": "create_transaction", "description": "Create a new transaction.", "parameters": {"type": "object", "properties": {"date": {"type": "string", "description": "YYYY-MM-DD"}, "amount_dollars": {"type": "number", "description": "Absolute amount in dollars (e.g. 50.00)"}, "payee_name": {"type": "string"}, "category_name": {"type": "string"}, "account_name": {"type": "string"}, "notes": {"type": "string"}, "transaction_type": {"type": "string", "enum": ["expense", "income"], "description": "Defaults to expense."}}, "required": ["date", "amount_dollars", "payee_name", "category_name", "account_name"]}}}
]


# Mapping for execution
AVAILABLE_TOOLS = {
    "generate_chart": generate_chart,
    "get_spending_category": get_spending_category,
    "search_transactions": search_transactions,
    "get_account_balances": get_account_balances,
    "web_search": web_search,
    "get_monthly_budget": get_monthly_budget,
    "get_all_categories": get_all_categories,
    "simulate_purchase": simulate_purchase,
    "forecast_expenses": forecast_expenses,
    "detect_recurring_payments": detect_recurring_payments,
    "update_category_budget": update_category_budget,
    "create_transaction": create_transaction,
    "create_execution_plan": create_execution_plan
}

if __name__ == "__main__":
    print("--- Testing Tools ---")
