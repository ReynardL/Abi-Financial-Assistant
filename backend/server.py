import os
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from openai import OpenAI
from dotenv import load_dotenv, set_key
import json
from datetime import datetime

# Support for packaged app, allow overriding paths via env vars
ENV_PATH = os.environ.get('ABI_ENV_PATH', os.path.join(os.path.dirname(__file__), '../.env'))
DATA_DIR = os.environ.get('ABI_DATA_DIR', os.path.dirname(os.path.dirname(__file__)))

load_dotenv(ENV_PATH) 

from tools import TOOL_DEFINITIONS, AVAILABLE_TOOLS, guard, CHART_CACHE
from refresh_data import refresh_data

app = FastAPI(title="Abi Financial Assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_safe_base_url(url: Optional[str]) -> str:
    if not url or not url.strip():
        return "https://api.openai.com/v1"
    url = url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        if "localhost" in url or "127.0.0.1" in url:
            return f"http://{url}"
        return f"https://{url}"
    return url

client = None

def get_client():
    global client
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    if client is None:
        client = OpenAI(
            api_key=api_key,
            base_url=get_safe_base_url(os.getenv("OPENAI_BASE_URL"))
        )
    return client

def reset_client():
    global client
    client = None

class ChatRequest(BaseModel):
    history: Optional[List[Dict[str, Any]]] = []
    message: str

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    today = datetime.now().strftime("%Y-%m-%d")

    system_prompt = f"""
    You are Abi, a friendly, helpful, and privacy-focused financial assistant. 
    
    YOUR STYLE:
    - Friendly, concise, and encouraging.
    - If the user saves money, celebrate!
    - PERSONAL ASSISTANT MODE: You are a personal assistant. For any request (e.g., creating a budget), personalize the results based on the user's spending habits or history.
    
    YOUR TOOLKIT:
    1. Local Database: Use 'get_spending_category', 'search_transactions', or 'get_account_balances' for questions about history, spending, or accounts.
    2. Visualization: Use 'generate_chart' to create visual reports (donut or bar charts) of spending.
    3. Web Search: Use 'web_search' for general financial advice or comparisons.
    4. Planning: Use 'create_execution_plan' for complex, multi-step requests.
    
    PRIVACY & DATA:
    - Merchant names are automatically MASKED (e.g., "Merchant_A1B2") to protect privacy. You will see these masked names. Treat them as normal payees.
    - Never put specific transaction details into the 'web_search' query.
    
    OUTPUT FORMAT:
    - STRICTLY PLAIN TEXT.
    - NO Markdown formatting allowed (no **bold**, no *italics*, no headers).
    - For lists, use a simple '•' or '-' character.
    - Do not format numbers with code blocks.

    RULES:
    - If the user asks a "Hybrid" question (e.g., "Is my grocery spending high?"), FIRST retrieve their spending, THEN search for the average, AND FINALLY synthesize the answer.
    - FOR MULTI-STEP REQUESTS: Do not guess. You MUST use 'create_execution_plan' first to break down the task.
    - CHARTS: If a user asks for a chart or visualization, use 'generate_chart'. The chart will appear in the chat automatically; you do not need to generate a link.
    - CHECK DATE: Today is {today}. Use this for relative date queries (this month, last month).
    """

    messages = [{"role": "system", "content": system_prompt}]

    # Add History if provided (limit to last 20 messages)
    if request.history:
        messages.extend(request.history[-20:])

    messages.append({"role": "user", "content": request.message})

    openai_client = get_client()
    if openai_client is None:
        return {"reply": "Please configure your OpenAI API key in Settings before using the assistant."}

    # Message Loop
    max_steps = 15
    model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    try:
        for _ in range(max_steps):
            response = openai_client.chat.completions.create(
                model=model_name, 
                messages=messages,
                tools=TOOL_DEFINITIONS,
                tool_choice="auto"
            )

            response_message = response.choices[0].message
            tool_calls = response_message.tool_calls

            if not tool_calls: # No more tools needed, return the final response
                final_reply = guard.unmask_text(response_message.content)
                
                # Post-processing: Strip Markdown that leaks through
                final_reply = final_reply.replace("**", "").replace("##", "").replace("```", "")
            
                # Check for generated charts in the conversation history
                import re
                found_charts = []
                
                # Scan recent messages for tool outputs (which are dicts in our loop)
                for msg in messages:
                    if isinstance(msg, dict) and msg.get("role") == "tool":
                        content = str(msg.get("content", ""))
                        if "Reference ID:" in content:
                            match = re.search(r"Reference ID: ([a-f0-9\-]+)", content)
                            if match:
                                chart_id = match.group(1)
                                if chart_id in CHART_CACHE:
                                    found_charts.append(CHART_CACHE.pop(chart_id))
                
                if found_charts:
                    # If the LLM already hallucinated a markdown link (text between square brackets followed by parens), remove it.
                    # e.g. ![Spending Chart](...)
                    final_reply = re.sub(r'!\[.*?\]\(.*?\)', '', final_reply)
                    
                    # Append the real chart at the end
                    final_reply += "\n\n"
                    for img_data in found_charts:
                        final_reply += f"![Chart](data:image/png;base64,{img_data})\n\n"

                return {"reply": final_reply}

            # Otherwise, process the tools
            messages.append(response_message)

            for tool_call in tool_calls:
                function_name = tool_call.function.name
                try:
                    function_args = json.loads(tool_call.function.arguments)
                except json.JSONDecodeError:
                    function_args = {}
                
                print(f"🤖 Agent Calling: {function_name} with {function_args}")
                
                function_to_call = AVAILABLE_TOOLS.get(function_name)
                if function_to_call:
                    try:
                        tool_result = function_to_call(**function_args)
                    except Exception as e:
                        tool_result = f"Error executing tool: {str(e)}"
                else:
                    tool_result = "Error: Tool not found."

                messages.append({
                    "tool_call_id": tool_call.id,
                    "role": "tool",
                    "name": function_name,
                    "content": str(tool_result),
                })
            
        return {"reply": "I'm sorry, I reached the maximum number of steps (15) for this request and had to stop."}
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"❌ Chat Error: {error_trace}")
        return {"reply": f"An error occurred: {str(e)}"}

@app.post("/sync")
async def trigger_sync():
    try:
        success = refresh_data()
        if success:
            return {"status": "Data synced successfully"}
        else:
            raise HTTPException(status_code=500, detail="Sync failed. Check logs for details.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class SettingsModel(BaseModel):
    openai_key: Optional[str] = None
    actual_url: Optional[str] = None
    actual_password: Optional[str] = None
    actual_sync_id: Optional[str] = None
    openai_model: Optional[str] = None
    openai_base_url: Optional[str] = None

@app.get("/settings")
async def get_settings():
    return {
        "has_openai": bool(os.getenv("OPENAI_API_KEY")),
        "actual_url": os.getenv("ACTUAL_SERVER_URL", ""),
        "has_password": bool(os.getenv("ACTUAL_PASSWORD")),
        "actual_sync_id": os.getenv("ACTUAL_SYNC_ID", ""),
        "openai_model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "openai_base_url": os.getenv("OPENAI_BASE_URL", "")
    }

@app.post("/settings")
async def update_settings(settings: SettingsModel):
    updated = False
    needs_client_reset = False
    
    if settings.openai_key:
        os.environ["OPENAI_API_KEY"] = settings.openai_key
        set_key(ENV_PATH, "OPENAI_API_KEY", settings.openai_key)
        needs_client_reset = True
        updated = True
        
    if settings.actual_url:
        os.environ["ACTUAL_SERVER_URL"] = settings.actual_url
        set_key(ENV_PATH, "ACTUAL_SERVER_URL", settings.actual_url)
        updated = True
        
    if settings.actual_password:
        os.environ["ACTUAL_PASSWORD"] = settings.actual_password
        set_key(ENV_PATH, "ACTUAL_PASSWORD", settings.actual_password)
        updated = True
        
    if settings.actual_sync_id:
        os.environ["ACTUAL_SYNC_ID"] = settings.actual_sync_id
        set_key(ENV_PATH, "ACTUAL_SYNC_ID", settings.actual_sync_id)
        updated = True

    if settings.openai_model:
        os.environ["OPENAI_MODEL"] = settings.openai_model
        set_key(ENV_PATH, "OPENAI_MODEL", settings.openai_model)
        updated = True
        
    if settings.openai_base_url is not None:
        val = settings.openai_base_url
        os.environ["OPENAI_BASE_URL"] = val 
        set_key(ENV_PATH, "OPENAI_BASE_URL", val)
        needs_client_reset = True
        updated = True
    
    # Reset client if API key or base URL changed
    if needs_client_reset:
        reset_client()
    
    if updated:
        return {"status": "Settings updated successfully"}
    return {"status": "No changes made"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)