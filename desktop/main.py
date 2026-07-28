"""Primary entry point for the DXFify Standalone Desktop Application."""

import multiprocessing
import os
import sys
import threading
import time
import urllib.request
import webview

# Call freeze_support immediately for PyInstaller binary safety
multiprocessing.freeze_support()

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

DXFERPY_DIR = os.path.join(REPO_ROOT, "dxferpy")
if DXFERPY_DIR not in sys.path:
    sys.path.insert(0, DXFERPY_DIR)

from desktop.desktop_server import run_server


def wait_for_server(url: str, timeout: int = 15) -> bool:
    """Waits for local server to start responding."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.1)
    return False


def main() -> None:
    """Launches embedded server and native pywebview desktop window."""
    port = 3001
    server_thread = threading.Thread(target=run_server, args=(port,), daemon=True)
    server_thread.start()

    target_url = f"http://127.0.0.1:{port}"
    wait_for_server(target_url, timeout=10)

    # Create native standalone desktop app window (0 external browser dependency)
    window = webview.create_window(
        title="DXFify — Professional CAD Vectorizer",
        url=target_url,
        width=1400,
        height=900,
        min_size=(900, 600),
        resizable=True,
        text_select=False,
    )

    webview.start(gui="qt", private_mode=False)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
