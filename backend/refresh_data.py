import subprocess
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Support for packaged app, allow overriding paths via env vars
DATA_DIR = os.environ.get('ABI_DATA_DIR', os.path.dirname(BASE_DIR))
BRIDGE_DIR = os.environ.get('ABI_BRIDGE_DIR', os.path.join(os.path.dirname(BASE_DIR), 'bridge'))
ENV_PATH = os.environ.get('ABI_ENV_PATH', os.path.join(DATA_DIR, '.env'))

BRIDGE_SCRIPT = os.path.join(BRIDGE_DIR, "sync.js")

def refresh_data():
    print("Triggering Data Sync...")
    print(f"  Bridge script: {BRIDGE_SCRIPT}")
    print(f"  Data dir: {DATA_DIR}")
    
    try:
        subprocess.run(["node", "-v"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        env = os.environ.copy()
        env['ABI_DATA_DIR'] = DATA_DIR
        env['ABI_ENV_PATH'] = ENV_PATH
        
        result = subprocess.run(["node", BRIDGE_SCRIPT], check=True, capture_output=True, text=True, env=env)
        print(result.stdout)
        print("Sync execution completed.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"Sync Failed: {e.stderr}")
        return False
    except FileNotFoundError:
        print("Node.js not found. Please install Node.js to use the sync bridge.")
        return False

if __name__ == "__main__":
    refresh_data()
