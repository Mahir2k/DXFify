"""PyQt6 status bar widget rendering cursor coordinates, zoom %, and tool metrics."""

from typing import Optional
from PyQt6.QtCore import Qt, pyqtSignal
from PyQt6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QStatusBar, QWidget


class CadStatusBar(QStatusBar):
    """Native PyQt6 status bar for the DXFify CAD viewport."""

    brushShapeChanged = pyqtSignal(str)

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.setStyleSheet("""
            QStatusBar {
                background-color: #12161f;
                color: #a0aec0;
                border-top: 1px solid #2d3748;
                font-family: monospace;
                font-size: 12px;
            }
        """)

        container = QWidget()
        layout = QHBoxLayout(container)
        layout.setContentsMargins(12, 2, 12, 2)
        layout.setSpacing(16)

        self.coord_label = QLabel("X —  Y —")
        self.coord_label.setStyleSheet("color: #e2e8f0; font-weight: bold;")
        layout.addWidget(self.coord_label)

        self.measure_label = QLabel("")
        self.measure_label.setStyleSheet("color: #00e676; font-weight: bold;")
        self.measure_label.hide()
        layout.addWidget(self.measure_label)

        self.brush_container = QWidget()
        b_layout = QHBoxLayout(self.brush_container)
        b_layout.setContentsMargins(0, 0, 0, 0)
        b_layout.setSpacing(6)

        self.brush_label = QLabel("Brush: 15.0 mm")
        self.brush_label.setStyleSheet("color: #6366f1; font-weight: bold;")
        b_layout.addWidget(self.brush_label)

        self.shape_btn = QPushButton("● Ball")
        self.shape_btn.setStyleSheet("""
            QPushButton {
                background-color: #1e293b;
                border: 1px solid #6366f1;
                border-radius: 3px;
                color: #ffffff;
                padding: 1px 6px;
                font-size: 11px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #334155;
            }
        """)
        self.shape_btn.clicked.connect(self._toggle_brush_shape)
        b_layout.addWidget(self.shape_btn)

        self.brush_container.hide()
        layout.addWidget(self.brush_container)

        layout.addStretch()

        self.zoom_label = QLabel("Zoom 100%")
        self.zoom_label.setStyleSheet("color: #cbd5e1;")
        layout.addWidget(self.zoom_label)

        self.tool_label = QLabel("Tool: select")
        self.tool_label.setStyleSheet("color: #00e676; font-weight: bold;")
        layout.addWidget(self.tool_label)

        self.addPermanentWidget(container, 1)
        self._current_brush_shape = "circle"

    def update_cursor(self, x_mm: Optional[float], y_mm: Optional[float]) -> None:
        """Updates cursor coordinate display in millimeters."""
        if x_mm is not None and y_mm is not None:
            self.coord_label.setText(f"X {x_mm:8.2f} mm   Y {y_mm:8.2f} mm")
        else:
            self.coord_label.setText("X —        Y —")

    def update_measure(self, distance_mm: Optional[float]) -> None:
        """Updates measurement distance readout."""
        if distance_mm is not None:
            self.measure_label.setText(f"Distance: {distance_mm:.2f} mm")
            self.measure_label.show()
        else:
            self.measure_label.hide()

    def update_brush(self, radius_mm: float, shape: str, active: bool) -> None:
        """Updates brush size and shape indicators."""
        self._current_brush_shape = shape
        if active:
            self.brush_label.setText(f"Brush: {radius_mm:.1f} mm")
            self.shape_btn.setText("● Ball" if shape == "circle" else "■ Cube")
            self.brush_container.show()
        else:
            self.brush_container.hide()

    def update_zoom(self, zoom_percentage: int) -> None:
        """Updates zoom level percentage readout."""
        self.zoom_label.setText(f"Zoom {zoom_percentage}%")

    def update_tool(self, tool_id: str) -> None:
        """Updates active tool name display."""
        self.tool_label.setText(f"Tool: {tool_id}")

    def _toggle_brush_shape(self) -> None:
        new_shape = "square" if self._current_brush_shape == "circle" else "circle"
        self._current_brush_shape = new_shape
        self.shape_btn.setText("● Ball" if new_shape == "circle" else "■ Cube")
        self.brushShapeChanged.emit(new_shape)
