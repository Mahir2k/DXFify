"""PyQt6 CAD tool bar widget providing 20+ CAD creation, editing, and modification tools."""

from typing import Dict, Optional
from PyQt6.QtCore import QSize, pyqtSignal
from PyQt6.QtGui import QAction, QActionGroup
from PyQt6.QtWidgets import QToolBar, QWidget


TOOL_META: Dict[str, Dict[str, str]] = {
    "select": {"label": "Move & Edit Nodes (Pan canvas on drag)", "glyph": "↖"},
    "snap": {"label": "Snap Grid / Vertex", "glyph": "⌖"},
    "measure": {"label": "Measure Distance", "glyph": "📏"},
    "brush": {"label": "Proportional Brush", "glyph": "🖌"},
    "align": {"label": "Align Parallel", "glyph": "⇄"},
    "subregion-select": {"label": "Selection Area Box", "glyph": "⬚"},
    "line": {"label": "Line", "glyph": "╱"},
    "arc": {"label": "3-Point Arc", "glyph": "⌒"},
    "polyline": {"label": "Polyline", "glyph": "⌁"},
    "spline": {"label": "B-Spline", "glyph": "∿"},
    "rect-3pt": {"label": "3-Point Rectangle", "glyph": "▭"},
    "circle-3pt": {"label": "3-Point Circle", "glyph": "◯"},
    "slot-4pt": {"label": "4-Point Slot", "glyph": "🕳"},
    "centerline": {"label": "Centerlines", "glyph": "┼"},
    "chamfer": {"label": "Sketch Chamfer", "glyph": "⎎"},
    "fillet": {"label": "Sketch Fillet", "glyph": "╭"},
    "add-point": {"label": "Add Point", "glyph": "+"},
    "cut": {"label": "Scissors Cut Line", "glyph": "✂"},
    "fuse": {"label": "Fuse / Merge Vertices", "glyph": "🔗"},
    "delete": {"label": "Delete Element", "glyph": "⌫"},
    "delete-point": {"label": "Delete Point", "glyph": "−"},
    "mark-hole": {"label": "Mark Hole", "glyph": "○"},
    "undo": {"label": "Undo", "glyph": "↶"},
    "redo": {"label": "Redo", "glyph": "↷"},
}

TOOL_GROUPS = [
    ["select", "snap", "measure", "brush", "align", "subregion-select"],
    ["line", "arc", "polyline", "spline", "rect-3pt", "circle-3pt", "slot-4pt", "centerline", "chamfer", "fillet"],
    ["cut", "fuse", "add-point", "delete-point", "delete", "mark-hole"],
    ["undo", "redo"],
]


class CadToolBar(QToolBar):
    """Vertical native PyQt6 toolbar hosting CAD tool action buttons."""

    toolSelected = pyqtSignal(str)
    undoTriggered = pyqtSignal()
    redoTriggered = pyqtSignal()

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__("CAD Tools", parent)
        self.setIconSize(QSize(28, 28))
        self.setStyleSheet("""
            QToolBar {
                background-color: #0f172a;
                border-right: 1px solid #1e293b;
                spacing: 4px;
                padding: 4px;
            }
            QToolButton {
                background-color: #1e293b;
                color: #e2e8f0;
                border: 1px solid #334155;
                border-radius: 4px;
                padding: 6px;
                font-size: 14px;
                font-weight: bold;
            }
            QToolButton:hover {
                background-color: #334155;
                border-color: #6366f1;
            }
            QToolButton:checked {
                background-color: #6366f1;
                color: #ffffff;
                border-color: #818cf8;
            }
        """)

        self.action_group = QActionGroup(self)
        self.action_group.setExclusive(True)
        self.actions_map: Dict[str, QAction] = {}

        for group_idx, group in enumerate(TOOL_GROUPS):
            if group_idx > 0:
                self.addSeparator()
            for tool_id in group:
                meta = TOOL_META[tool_id]
                action = QAction(meta["glyph"], self)
                action.setToolTip(meta["label"])
                action.setStatusTip(meta["label"])
                action.setData(tool_id)

                if tool_id in ("undo", "redo"):
                    if tool_id == "undo":
                        action.triggered.connect(self.undoTriggered.emit)
                    else:
                        action.triggered.connect(self.redoTriggered.emit)
                else:
                    action.setCheckable(True)
                    self.action_group.addAction(action)
                    action.triggered.connect(lambda checked, tid=tool_id: self.toolSelected.emit(tid))
                    if tool_id == "select":
                        action.setChecked(True)

                self.addAction(action)
                self.actions_map[tool_id] = action

    def select_tool(self, tool_id: str) -> None:
        """Programmatically checks specified tool action."""
        if tool_id in self.actions_map and self.actions_map[tool_id].isCheckable():
            self.actions_map[tool_id].setChecked(True)
            self.toolSelected.emit(tool_id)
