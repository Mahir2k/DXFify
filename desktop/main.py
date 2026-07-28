"""Primary entry point for the DXFify PyQt6 Native CAD Desktop Application."""

import os
import sys
from typing import Any

# Ensure project root is in sys.path
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

DXFERPY_DIR = os.path.join(REPO_ROOT, "dxferpy")
if DXFERPY_DIR not in sys.path:
    sys.path.insert(0, DXFERPY_DIR)

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QColor, QFont, QPalette
from PyQt6.QtWidgets import QApplication

from desktop.ui.main_window import MainWindow
from segment_object import create_birefnet_session


def set_dark_theme(app: QApplication) -> None:
    """Applies modern dark slate palette and custom typography."""
    app.setStyle("Fusion")

    palette = QPalette()
    palette.setColor(QPalette.ColorRole.Window, QColor("#0a0e17"))
    palette.setColor(QPalette.ColorRole.WindowText, QColor("#e2e8f0"))
    palette.setColor(QPalette.ColorRole.Base, QColor("#12161f"))
    palette.setColor(QPalette.ColorRole.AlternateBase, QColor("#1e293b"))
    palette.setColor(QPalette.ColorRole.ToolTipBase, QColor("#1e293b"))
    palette.setColor(QPalette.ColorRole.ToolTipText, QColor("#ffffff"))
    palette.setColor(QPalette.ColorRole.Text, QColor("#e2e8f0"))
    palette.setColor(QPalette.ColorRole.Button, QColor("#1e293b"))
    palette.setColor(QPalette.ColorRole.ButtonText, QColor("#ffffff"))
    palette.setColor(QPalette.ColorRole.BrightText, QColor("#ff3b30"))
    palette.setColor(QPalette.ColorRole.Link, QColor("#6366f1"))
    palette.setColor(QPalette.ColorRole.Highlight, QColor("#6366f1"))
    palette.setColor(QPalette.ColorRole.HighlightedText, QColor("#ffffff"))

    app.setPalette(palette)

    font = QFont("Inter", 10)
    font.setHintingPreference(QFont.HintingPreference.PreferFullHinting)
    app.setFont(font)


def main() -> None:
    """Main application loop."""
    app = QApplication(sys.argv)
    app.setApplicationName("DXFify")
    app.setOrganizationName("DXFify")

    set_dark_theme(app)

    print("Preloading BiRefNet neural segmentation model...")
    session: Any = None
    try:
        session = create_birefnet_session()
        print("BiRefNet model loaded successfully.")
    except Exception as err:
        print(f"Warning: Could not preload BiRefNet model: {err}")

    window = MainWindow(rembg_session=session)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
