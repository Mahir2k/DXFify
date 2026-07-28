"""PyQt6 Dock Widget providing AI pipeline configuration, paper specs, and threshold sliders."""

from typing import Dict, Any, Optional
from PyQt6.QtCore import pyqtSignal
from PyQt6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDockWidget,
    QDoubleSpinBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSlider,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)


class SettingsDock(QDockWidget):
    """Sidebar dock widget managing conversion parameters and AI pipeline controls."""

    runPipelineRequested = pyqtSignal(dict)
    reprocessRegionRequested = pyqtSignal(str)

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__("Pipeline & Layer Settings", parent)
        self.setAllowedAreas(self.dockWidgetArea().RightDockWidgetArea | self.dockWidgetArea().LeftDockWidgetArea)

        content = QWidget()
        main_layout = QVBoxLayout(content)
        main_layout.setContentsMargins(12, 12, 12, 12)
        main_layout.setSpacing(12)

        # 1. Paper Calibration Group
        paper_group = QGroupBox("Paper Calibration")
        paper_layout = QFormLayout(paper_group)

        self.paper_combo = QComboBox()
        self.paper_combo.addItems(["A4 (210x297mm)", "A3 (297x420mm)", "A5 (148x210mm)", "Letter (216x279mm)", "Legal (216x356mm)"])
        paper_layout.addRow("Paper Size:", self.paper_combo)

        main_layout.addWidget(paper_group)

        # 2. AI Segmentation Thresholds Group
        seg_group = QGroupBox("AI Segmentation & Cleanup")
        seg_layout = QFormLayout(seg_group)

        self.thresh_slider = QSlider()
        self.thresh_slider.setOrientation(self.thresh_slider.orientation().Horizontal)
        self.thresh_slider.setRange(100, 255)
        self.thresh_slider.setValue(240)
        self.thresh_label = QLabel("240")
        self.thresh_slider.valueChanged.connect(lambda v: self.thresh_label.setText(str(v)))

        thresh_box = QHBoxLayout()
        thresh_box.addWidget(self.thresh_slider)
        thresh_box.addWidget(self.thresh_label)
        seg_layout.addRow("Mask Threshold:", thresh_box)

        self.erosion_kernel_spin = QSpinBox()
        self.erosion_kernel_spin.setRange(1, 15)
        self.erosion_kernel_spin.setSingleStep(2)
        self.erosion_kernel_spin.setValue(3)
        seg_layout.addRow("Erosion Kernel:", self.erosion_kernel_spin)

        self.erosion_iter_spin = QSpinBox()
        self.erosion_iter_spin.setRange(0, 10)
        self.erosion_iter_spin.setValue(1)
        seg_layout.addRow("Erosion Passes:", self.erosion_iter_spin)

        main_layout.addWidget(seg_group)

        # 3. Vectorization Geometry Group
        vec_group = QGroupBox("Vector Geometry Fitting")
        vec_layout = QFormLayout(vec_group)

        self.curve_strategy_combo = QComboBox()
        self.curve_strategy_combo.addItems([
            "current (Histogram Ortho Snap)",
            "pratt (Pratt Circle Arc Fit)",
            "spline (Periodic Cubic B-Spline)",
            "gaussian (1D Gaussian Blurring)",
            "ransac (RANSAC CAD Reconstruction)"
        ])
        vec_layout.addRow("Curve Strategy:", self.curve_strategy_combo)

        self.epsilon_min_spin = QDoubleSpinBox()
        self.epsilon_min_spin.setRange(0.1, 10.0)
        self.epsilon_min_spin.setSingleStep(0.1)
        self.epsilon_min_spin.setValue(0.5)
        vec_layout.addRow("Min Epsilon:", self.epsilon_min_spin)

        self.epsilon_max_spin = QDoubleSpinBox()
        self.epsilon_max_spin.setRange(0.5, 20.0)
        self.epsilon_max_spin.setSingleStep(0.5)
        self.epsilon_max_spin.setValue(2.5)
        vec_layout.addRow("Max Epsilon:", self.epsilon_max_spin)

        main_layout.addWidget(vec_group)

        # 4. Surface Detail Extraction Group
        detail_group = QGroupBox("Surface Detail Engravings")
        detail_layout = QFormLayout(detail_group)

        self.detail_check = QCheckBox("Extract Surface Details")
        self.detail_check.setChecked(False)
        detail_layout.addRow(self.detail_check)

        main_layout.addWidget(detail_group)

        # 5. Action Buttons
        self.run_btn = QPushButton("🚀 Run AI Pipeline")
        self.run_btn.setStyleSheet("""
            QPushButton {
                background-color: #6366f1;
                color: #ffffff;
                border: none;
                border-radius: 6px;
                padding: 10px;
                font-size: 13px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #4f46e5;
            }
        """)
        self.run_btn.clicked.connect(self._on_run_clicked)
        main_layout.addWidget(self.run_btn)

        main_layout.addStretch()
        self.setWidget(content)

    def get_pipeline_params(self) -> Dict[str, Any]:
        """Collects current sidebar parameters into a dictionary."""
        paper_text = self.paper_combo.currentText().split()[0].lower()
        strategy_text = self.curve_strategy_combo.currentText().split()[0].lower()

        return {
            "paperSize": paper_text,
            "maskThreshold": self.thresh_slider.value(),
            "erosionKernel": self.erosion_kernel_spin.value(),
            "erosionIterations": self.erosion_iter_spin.value(),
            "curveStrategy": strategy_text,
            "epsilonMin": self.epsilon_min_spin.value(),
            "epsilonMax": self.epsilon_max_spin.value(),
            "detectDetails": self.detail_check.isChecked(),
        }

    def _on_run_clicked(self) -> None:
        self.runPipelineRequested.emit(self.get_pipeline_params())
