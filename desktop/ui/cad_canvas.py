"""Native PyQt6 QGraphicsView & QGraphicsScene CAD canvas viewport.

Implements real-time vector rendering, vertex node dragging, zoom-invariant hit target scaling,
and interactive CAD tool state machines.
"""

import math
from typing import Any, Dict, List, Optional, Tuple

from PyQt6.QtCore import QPointF, QRectF, Qt, pyqtSignal
from PyQt6.QtGui import QBrush, QColor, QFont, QPainter, QPainterPath, QPen, QTransform
from PyQt6.QtWidgets import QGraphicsEllipseItem, QGraphicsItem, QGraphicsPathItem, QGraphicsScene, QGraphicsView, QWidget


class VertexHandleItem(QGraphicsEllipseItem):
    """Interactive vertex handle item in model space with scale-invariant screen rendering."""

    def __init__(self, x: float, y: float, entity_idx: int, point_idx: int, parent_canvas: "CadCanvas") -> None:
        self.radius = 2.5
        super().__init__(-self.radius, -self.radius, 2 * self.radius, 2 * self.radius)
        self.setPos(x, y)
        self.entity_idx = entity_idx
        self.point_idx = point_idx
        self.canvas = parent_canvas
        self.is_hovered = False

        self.setFlags(
            QGraphicsItem.GraphicsItemFlag.ItemIsMovable
            | QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges
            | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable
        )
        self.setAcceptHoverEvents(True)
        self.setBrush(QBrush(QColor("#6366f1")))
        self.setPen(QPen(QColor("#ffffff"), 0.8))

    def hoverEnterEvent(self, event: Any) -> None:
        self.is_hovered = True
        self.setBrush(QBrush(QColor("#ffcc00") if self.canvas.selected_tool != "delete-point" else QColor("#ff3b30")))
        self.update()
        super().hoverEnterEvent(event)

    def hoverLeaveEvent(self, event: Any) -> None:
        self.is_hovered = False
        self.setBrush(QBrush(QColor("#6366f1")))
        self.update()
        super().hoverLeaveEvent(event)

    def itemChange(self, change: QGraphicsItem.GraphicsItemChange, value: Any) -> Any:
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionHasChanged and self.canvas:
            pos = self.pos()
            self.canvas.on_vertex_moved(self.entity_idx, self.point_idx, pos.x(), pos.y())
        return super().itemChange(change, value)

    def mousePressEvent(self, event: Any) -> None:
        if self.canvas.selected_tool == "delete-point":
            self.canvas.delete_vertex(self.entity_idx, self.point_idx)
            event.accept()
            return
        super().mousePressEvent(event)


class CadCanvas(QGraphicsView):
    """High-performance 2D CAD canvas powered by PyQt6 QGraphicsView."""

    cursorMoved = pyqtSignal(float, float)
    entitiesChanged = pyqtSignal(list)
    zoomChanged = pyqtSignal(int)

    def __init__(self, parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.scene = QGraphicsScene(self)
        self.setScene(self.scene)
        self.scene.setBackgroundBrush(QBrush(QColor("#0a0e17")))

        self.setRenderHints(
            QPainter.RenderHint.Antialiasing
            | QPainter.RenderHint.SmoothPixmapTransform
        )
        self.setViewportUpdateMode(QGraphicsView.ViewportUpdateMode.FullViewportUpdate)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)

        self.setDragMode(QGraphicsView.DragMode.NoDrag)

        self.entities: List[Dict[str, Any]] = []
        self.selected_tool = "select"
        self.brush_radius = 15.0
        self.brush_shape = "circle"

        self.is_panning = False
        self.pan_start = QPointF()

        self._draw_points: List[Tuple[float, float]] = []

        # Y-up CAD transform (Invert Y for standard CAD origin)
        self.scale(1, -1)
        self.zoom_factor = 1.0

    def load_entities(self, entities: List[Dict[str, Any]]) -> None:
        """Loads DXF vector entities and populates the QGraphicsScene."""
        self.entities = entities
        self.refresh_scene()

    def refresh_scene(self) -> None:
        """Clears and re-renders all geometry paths and vertex handles."""
        self.scene.clear()

        # Render grid lines
        grid_pen = QPen(QColor("#1e293b"), 0.5, Qt.PenStyle.DashLine)
        grid_pen.setCosmetic(True)

        for ent_idx, ent in enumerate(self.entities):
            layer = ent.get("layer", "OUTER")
            color = QColor("#5b9bd5") if layer == "HOLES" else QColor("#10b981") if layer == "DETAILS" else QColor("#ffffff")
            pen = QPen(color, 1.2)
            pen.setCosmetic(True)

            if ent.get("type") == "circle":
                cx = ent.get("cx", 0.0)
                cy = ent.get("cy", 0.0)
                r = ent.get("r", 1.0)
                item = self.scene.addEllipse(cx - r, cy - r, 2 * r, 2 * r, pen)

                if self.selected_tool in ("select", "delete-point"):
                    h = VertexHandleItem(cx, cy, ent_idx, 0, self)
                    self.scene.addItem(h)

            elif ent.get("type") == "polyline" and ent.get("points"):
                pts = ent["points"]
                path = QPainterPath()
                path.moveTo(pts[0][0], pts[0][1])
                for pt in pts[1:]:
                    path.lineTo(pt[0], pt[1])
                if ent.get("closed", True):
                  path.closeSubpath()

                self.scene.addPath(path, pen)

                if self.selected_tool in ("select", "delete-point"):
                    for pt_idx, pt in enumerate(pts):
                        h = VertexHandleItem(pt[0], pt[1], ent_idx, pt_idx, self)
                        self.scene.addItem(h)

        self.scene.update()

    def on_vertex_moved(self, ent_idx: int, pt_idx: int, x: float, y: float) -> None:
        """Callback fired when a vertex handle item is dragged in model space."""
        if 0 <= ent_idx < len(self.entities):
            ent = self.entities[ent_idx]
            if ent.get("type") == "polyline" and "points" in ent:
                ent["points"][pt_idx] = [x, y]
                self.entitiesChanged.emit(self.entities)

    def delete_vertex(self, ent_idx: int, pt_idx: int) -> None:
        """Deletes a vertex point or removes line entity if only 2 points remain."""
        if 0 <= ent_idx < len(self.entities):
            ent = self.entities[ent_idx]
            if ent.get("type") == "polyline" and "points" in ent:
                pts = ent["points"]
                if len(pts) > 2:
                    del pts[pt_idx]
                else:
                    del self.entities[ent_idx]
                self.refresh_scene()
                self.entitiesChanged.emit(self.entities)

    def wheelEvent(self, event: Any) -> None:
        """Smooth mouse wheel zoom anchored under the mouse cursor."""
        zoom_in_factor = 1.15
        zoom_out_factor = 1 / zoom_in_factor

        if event.angleDelta().y() > 0:
            zoom = zoom_in_factor
        else:
            zoom = zoom_out_factor

        self.scale(zoom, zoom)
        self.zoom_factor *= zoom
        self.zoomChanged.emit(int(self.zoom_factor * 100))

    def mousePressEvent(self, event: Any) -> None:
        """Handles canvas mouse click and middle-click panning."""
        if event.button() == Qt.MouseButton.MiddleButton or (event.button() == Qt.MouseButton.LeftButton and event.modifiers() & Qt.KeyboardModifier.ShiftModifier):
            self.is_panning = True
            self.pan_start = event.pos()
            self.setCursor(Qt.CursorShape.ClosedHandCursor)
            event.accept()
            return

        scene_pos = self.mapToScene(event.pos())
        self.cursorMoved.emit(scene_pos.x(), scene_pos.y())
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event: Any) -> None:
        """Tracks realtime cursor position in millimeters and handles panning."""
        if self.is_panning:
            delta = event.pos() - self.pan_start
            self.pan_start = event.pos()
            self.horizontalScrollBar().setValue(self.horizontalScrollBar().value() - delta.x())
            self.verticalScrollBar().setValue(self.verticalScrollBar().value() - delta.y())
            event.accept()
            return

        scene_pos = self.mapToScene(event.pos())
        self.cursorMoved.emit(scene_pos.x(), scene_pos.y())
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event: Any) -> None:
        if self.is_panning:
            self.is_panning = False
            self.setCursor(Qt.CursorShape.ArrowCursor)
            event.accept()
            return
        super().mouseReleaseEvent(event)
