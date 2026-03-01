import subprocess
import sys
import os
import logging

# Fix stdout/stderr for PyInstaller console=False
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Support for packaged app, allow overriding paths via env vars
DATA_DIR = os.environ.get('ABI_DATA_DIR', os.path.dirname(BASE_DIR))
BRIDGE_DIR = os.environ.get('ABI_BRIDGE_DIR', os.path.join(os.path.dirname(BASE_DIR), 'bridge'))
ENV_PATH = os.environ.get('ABI_ENV_PATH', os.path.join(DATA_DIR, '.env'))

BRIDGE_SCRIPT = os.path.join(BRIDGE_DIR, "sync.js")

def refresh_data():
    logger.info("Triggering Data Sync...")
    logger.info(f"  Bridge script: {BRIDGE_SCRIPT}")
    logger.info(f"  Data dir: {DATA_DIR}")
    
    # On Windows, prevent a CMD window from flashing
    kwargs = {}
    if sys.platform == 'win32':
        kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
    
    try:
        subprocess.run(["node", "-v"], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
        
        env = os.environ.copy()
        env['ABI_DATA_DIR'] = DATA_DIR
        env['ABI_ENV_PATH'] = ENV_PATH
        
        result = subprocess.run(["node", BRIDGE_SCRIPT], check=True, capture_output=True, text=True, env=env, timeout=120, **kwargs)
        logger.info(result.stdout)
        logger.info("Sync execution completed.")
        return (True, "Data synced successfully.")
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or '').strip()
        logger.error(f"Sync Failed: {stderr}")
        # Extract the user-friendly error message
        if 'Could not connect' in stderr or 'ECONNREFUSED' in stderr:
            return (False, "Could not connect to Actual Budget server. Make sure Actual Budget is running, then try again.")
        return (False, f"Sync failed: {stderr or 'Unknown error'}")
    except subprocess.TimeoutExpired:
        logger.error("Sync timed out after 120 seconds.")
        return (False, "Sync timed out. The Actual Budget server may be unresponsive.")
    except FileNotFoundError:
        logger.error("Node.js not found. Please install Node.js to use the sync bridge.")
        return (False, "Node.js not found. It is required for syncing.")

if __name__ == "__main__":
    refresh_data()
