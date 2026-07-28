"""Native PyQt6 QMainWindow CAD Desktop Dashboard."""

import json
import os
import shutil
import sys
from typing import Any, Dict, Optional

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QAction, QIcon, QKeySequence
from PyQt6.QtWidgets import (
    QFileDialog,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QVBoxLayout,
    QWidget,
)

from desktop.pipeline_worker import PipelineWorkerThread
from desktop.ui.cad_canvas import CadCanvas
from desktop.ui.settings_dock import SettingsDock
from desktop.ui.status_bar import CadStatusBar
from desktop.ui.toolbar import CadToolBar


class MainWindow(QMainWindow):
    """Primary PyQt6 QMainWindow native CAD application dashboard."""

    def __init__(self, rembg_session: Any = None) -> None:
        super().__init__()
        self.setWindowTitle("DXFify — Professional Native CAD Vectorizer")
        self.resize(1400, 900)

        self.rembg_session = rembg_session
        self.current_image_path: Optional[str] = None
        self.current_report: Optional[Dict[str, Any]] = None
        self.output_dir = os.path.join(os.path.expanduser("~"), ".dxfify_desktop_output")
        os.makedirs(self.output_dir, exist_ok=True)

        self._init_menu()
        self._init_ui()

    def _init_menu(self) -> None:
        menu_bar = self.menuBar()
        menu_bar.setStyleSheet("""
            QMenuBar {
                background-color: #0f172a;
                color: #e2e8f0;
                border-bottom: 1px solid #1e293b;
            }
            QMenuBar::item:selected {
                background-color: #1e293b;
                color: #6366f1;
            }
            QMenu {
                background-color: #0f172a;
                color: #e2e8f0;
                border: 1px solid #1e293b;
            }
            QMenu::item:selected {
                background-color: #6366f1;
                color: #ffffff;
            }
        """)

        # File Menu
        file_menu = menu_bar.addMenu("&File")

        open_action = QAction("&Open Photo...", self)
        open_action.setShortcut(QKeySequence("Ctrl+O"))
        open_action.triggered.connect(self.open_image_file)
        file_menu.addAction(open_action)

        file_menu.addSeparator()

        export_dxf_action = QAction("Export &DXF (R2010)...", self)
        export_dxf_action.setShortcut(QKeySequence("Ctrl+E"))
        export_dxf_action.triggered.connect(self.export_dxf)
        file_menu.addAction(export_dxf_action)

        export_svg_action = QAction("Export &SVG...", self)
        export_svg_action.triggered.connect(self.export_svg)
        file_menu.addAction(export_svg_action)

        file_menu.addSeparator()

        exit_action = QAction("E&xit", self)
        exit_action.setShortcut(QKeySequence("Ctrl+Q"))
        exit_action.triggered.connect(self.close)
        file_menu.addAction(exit_action)

    def _init_ui(self) -> None:
        # Central Viewport
        self.canvas = CadCanvas(self)
        self.setCentralWidget(self.canvas)

        # Status Bar
        self.status_bar = CadStatusBar(self)
        self.setStatusBar(self.status_bar)

        # Progress Bar Widget for AI Conversion
        self.progress_bar = QProgressBar()
        self.progress_bar.setRange(0, 0)  # Marquee animation
        self.progress_bar.setMaximumWidth(180)
        self.progress_bar.setStyleSheet("""
            QProgressBar {
                border: 1px solid #6366f1;
                border-radius: 3px;
                background-color: #1e293b;
            }
            QProgressBar::chunk {
                background-color: #6366f1;
            }
        """)
        self.status_bar.addPermanentWidget(self.progress_bar)
        self.progress_bar.hide()

        # Toolbar
        self.toolbar = CadToolBar(self)
        self.addToolBar(Qt.ToolBarArea.LeftToolBarArea, self.toolbar)

        # Settings Dock Widget
        self.settings_dock = SettingsDock(self)
        self.addDockWidget(Qt.DockWidgetArea.RightDockWidgetArea, self.settings_dock)

        # Signal / Slot Connectors
        self.toolbar.toolSelected.connect(self.on_tool_selected)
        self.toolbar.undoTriggered.connect(lambda: None)
        self.toolbar.redoTriggered.connect(lambda: None)

        self.settings_dock.runPipelineRequested.connect(self.run_pipeline)
        self.status_bar.brushShapeChanged.connect(lambda s: setattr(self.canvas, "brush_shape", s))

        self.canvas.cursorMoved.connect(self.status_bar.update_cursor)
        self.canvas.zoomChanged.connect(self.status_bar.update_zoom)

    def open_image_file(self) -> None:
        """Opens native file dialog to select a sample photograph."""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "Select Photo for CAD Conversion",
            "",
            "Image Files (*.png *.jpg *.jpeg *.bmp *.webp);;All Files (*)",
        )
        if file_path:
            self.current_image_path = file_path
            self.setWindowTitle(f"DXFify — {os.path.basename(file_path)}")
            params = self.settings_dock.get_pipeline_params()
            self.run_pipeline(params)

    def run_pipeline(self, params: Dict[str, Any]) -> None:
        """Executes AI vectorization pipeline in QThread background worker."""
        if not self.current_image_path or not os.path.exists(self.current_image_path):
            QMessageBox.warning(self, "No Image Selected", "Please select a photo image file first (File -> Open Photo).")
            return

        self.worker = PipelineWorkerThread(
            self.current_image_path,
            self.output_dir,
            params,
            session=self.rembg_session,
            parent=self,
        )
        self.worker.started_processing.connect(self._on_worker_started)
        self.worker.finished_processing.connect(self._on_worker_finished)
        self.worker.error_occurred.connect(self._on_worker_error)
        self.worker.start()

    def _on_worker_started(self) -> None:
        self.progress_bar.show()
        self.status_bar.showMessage("Segmenting image and extracting vector geometry...")

    def _on_worker_finished(self, report: Dict[str, Any]) -> None:
        self.progress_bar.hide()
        self.current_report = report
        entities = report.get("entities", [])
        self.canvas.load_entities(entities)
        total = report.get("totalEntities", 0)
        w = report.get("bboxWidthMm", 0)
        h = report.get("bboxHeightMm", 0)
        self.status_bar.showMessage(f"Vectorization complete — {total} entities, BBox: {w:.1f} x {h:.1f} mm", 6000)

    def _on_worker_error(self, err_msg: str, traceback_str: str) -> None:
        self.progress_bar.hide()
        self.status_bar.showMessage("Error processing pipeline", 5000)
        QMessageBox.critical(self, "Pipeline Error", f"Conversion failed:\n{err_msg}")

    def on_tool_selected(self, tool_id: str) -> None:
        """Handles toolbar selection state changes."""
        self.canvas.selected_tool = tool_id
        self.canvas.refresh_scene()
        self.status_bar.update_tool(tool_id)

    def export_dxf(self) -> None:
        """Exports current CAD vector scene to standard R2010 DXF file."""
        if not self.canvas.entities:
            QMessageBox.information(self, "No Geometry", "No vector entities available to export.")
            return

        save_path, _ = QFileDialog.getSaveFileName(
            self, "Save DXF File", "result.dxf", "DXF Files (*.dxf)"
        )
        if save_path:
            out_dxf = os.path.join(self.output_dir, "result.dxf")
            if os.path.exists(out_dxf):
                shutil.copyfile(out_dxf, save_path)
                QMessageBox.information(self, "Export Successful", f"Saved DXF file to:\n{save_path}")

    def export_svg(self) -> None:
        """Exports current CAD vector scene to scalable SVG format."""
        if not self.canvas.entities:
            QMessageBox.information(self, "No Geometry", "No vector entities available to export.")
            return

        save_path, _ = QFileDialog.getSaveFileName(
            self, "Save SVG File", "result.svg", "SVG Files (*.svg)"
        )
        if save_path:
            QMessageBox.information(self, "Export Successful", f"Saved SVG file to:\n{save_path}")
