"""Primary entry point for the DXFify Standalone Desktop Application using pywebview."""

import multiprocessing
import os
import sys
import time
import urllib.request
import webview

# Call freeze_support immediately for PyInstaller binary safety
multiprocessing.freeze_support()

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)


def wait_for_server(url: str, timeout: int = 15) -> bool:
    """Waits for local gateway server to become responsive."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url) as response:
                if response.status == 200:
                    return True
        except Exception:
            time.sleep(0.2)
    return False


def main() -> None:
    """Launches standalone native desktop window rendering exact React CAD dashboard."""
    target_url = "http://127.0.0.1:3001"

    # Wait up to 10 seconds for local web server
    wait_for_server(target_url, timeout=10)

    # Create native standalone desktop app window (0 browser dependency)
    window = webview.create_window(
        title="DXFify — Professional CAD Vectorizer",
        url=target_url,
        width=1400,
        height=900,
        min_size=(900, 600),
        resizable=True,
        text_select=False,
    )

    webview.start(private_mode=False)


if __name__ == "__main__":
    multiprocessing.freeze_support()
    main()
