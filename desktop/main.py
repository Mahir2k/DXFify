"""Primary entry point for the DXFify Standalone Desktop Application."""

import multiprocessing
import os
import sys

# Force unbuffered stdout & stderr for immediate terminal log output
sys.stdout.reconfigure(line_buffering=True) if hasattr(sys.stdout, 'reconfigure') else None
sys.stderr.reconfigure(line_buffering=True) if hasattr(sys.stderr, 'reconfigure') else None

# Enable Chromium GPU hardware acceleration for 60FPS smooth rendering
os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (
    "--enable-gpu-rasterization "
    "--enable-zero-copy "
    "--ignore-gpu-blocklist "
    "--enable-accelerated-2d-canvas "
    "--enable-webgl"
)

# Call freeze_support immediately for PyInstaller binary safety
multiprocessing.freeze_support()

import logging
import threading
import time
import urllib.request
import webview

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s desktop-main] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("desktop_main")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

DXFERPY_DIR = os.path.join(REPO_ROOT, "dxferpy")
if DXFERPY_DIR not in sys.path:
    sys.path.insert(0, DXFERPY_DIR)

from desktop.desktop_server import run_server, get_rembg_session


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
    logger.info("Initializing DXFify Standalone Desktop Application...")
    sys.stdout.flush()

    # Pre-warm ONNX session in background thread so conversion is instant
    threading.Thread(target=get_rembg_session, daemon=True).start()

    port = 3001
    server_thread = threading.Thread(target=run_server, args=(port,), daemon=True)
    server_thread.start()

    target_url = f"http://127.0.0.1:{port}"
    logger.info(f"Connecting to embedded server at {target_url}...")
    sys.stdout.flush()
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

    logger.info("Opening desktop application window...")
    sys.stdout.flush()
    webview.start(gui="qt", private_mode=False)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
