import { useState, useRef, useEffect } from 'react';
import type { ConversionResult, ToolId, Viewport, GeometryEntity, ActiveDrawingState } from '../types';
import { Ruler } from './Ruler';
import { CadStatusBar } from './dxf/CadStatusBar';
import { computeCircumcircle, evaluateSplinePoints, computeFilletArc, computeFilletBetweenTwoPoints, distToSegment, computeBoundingBox } from '../utils/geometryUtils';
import * as THREE from 'three';






interface DxfPreviewProps {
  result: ConversionResult | null;
  selectedTool: ToolId;
  gridEnabled: boolean;
  onToggleGrid: () => void;
  viewport: Viewport | null;
  onViewportChange: (vp: Viewport) => void;
  onFitToView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  entities: GeometryEntity[];
  onEntitiesChange: (entities: GeometryEntity[], commit?: boolean) => void;
  brushShape?: 'circle' | 'square';
  brushRadius?: number;
  onBrushRadiusChange?: (radius: number) => void;
  onBrushShapeChange?: (shape: 'circle' | 'square') => void;
  onRotateWorkspace?: (newEntities: GeometryEntity[], angleDeg: number, cx: number, cy: number) => void;
  hoveredCoord?: { x: number; y: number } | null;
  onHoverCoord?: (coord: { x: number; y: number } | null) => void;
  onActiveDrawingChange?: (drawing: ActiveDrawingState) => void;
  onSubRegionSelect?: (bbox: [number, number, number, number]) => void;
  activeHoverSource?: 'dxf' | 'image' | null;
  onHoverSourceChange?: (source: 'dxf' | 'image' | null) => void;
}





export function DxfPreview({
  result,
  selectedTool,
  gridEnabled,
  onToggleGrid,
  viewport,
  onViewportChange,
  onFitToView,
  onZoomIn,
  onZoomOut,
  entities,
  onEntitiesChange,
  brushShape = 'circle',
  brushRadius = 15,
  onBrushRadiusChange,
  onBrushShapeChange,
  onRotateWorkspace,
  hoveredCoord = null,
  onHoverCoord,
  onActiveDrawingChange,
  onSubRegionSelect,
  activeHoverSource,
  onHoverSourceChange,
}: DxfPreviewProps) {
  const [outerLayerEnabled, setOuterLayerEnabled] = useState(true);
  const [holeLayerEnabled, setHoleLayerEnabled] = useState(true);
  const [detailsLayerEnabled, setDetailsLayerEnabled] = useState(true);

  const bbox = computeBoundingBox(entities);
  const hasBounds = bbox.width > 0 || bbox.height > 0;
  const bboxWidth = bbox.width;
  const bboxHeight = bbox.height;
  const bboxMinX = bbox.minX;
  const bboxMaxY = bbox.maxY;
  const minX = bbox.minX;
  const maxX = bbox.maxX;
  const minY = bbox.minY;
  const maxY = bbox.maxY;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [cursorMm, setCursorMm] = useState<{ x: number; y: number } | null>(null);
  
  
  const [measureStart, setMeasureStart] = useState<{ x: number; y: number } | null>(null);
  const [measureEnd, setMeasureEnd] = useState<{ x: number; y: number } | null>(null);

  
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [arcStart, setArcStart] = useState<{ x: number; y: number } | null>(null);
  const [arcEnd, setArcEnd] = useState<{ x: number; y: number } | null>(null);
  const [arcStep, setArcStep] = useState<number>(0); 
  const [snapPoint, setSnapPoint] = useState<{ x: number; y: number } | null>(null);

  
  const [activeDrag, setActiveDrag] = useState<{
    type: 'vertex' | 'center' | 'radius';
    entityIdx: number;
    pointIdx?: number;
  } | null>(null);

  const [alignSelectedSegment, setAlignSelectedSegment] = useState<{
    entityIdx: number;
    ptIdx1: number;
    ptIdx2: number;
    p1: [number, number];
    p2: [number, number];
  } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  const [rect3PtPoints, setRect3PtPoints] = useState<[number, number][]>([]);
  const [circle3PtPoints, setCircle3PtPoints] = useState<[number, number][]>([]);
  const [slot4PtPoints, setSlot4PtPoints] = useState<[number, number][]>([]);
  const [splinePoints, setSplinePoints] = useState<[number, number][]>([]);
  const [cadToolSelectedPoints, setCadToolSelectedPoints] = useState<Array<{
    entityIdx: number;
    ptIdx?: number;
    segIdx?: number;
    pt: [number, number];
  }>>([]);
  const [subregionBox, setSubregionBox] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);

  const [selectedEntityIndices, setSelectedEntityIndices] = useState<number[]>([]);
  const [selectionMarquee, setSelectionMarquee] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const [transformMode, setTransformMode] = useState<'translate' | 'scale-tl' | 'scale-tr' | 'scale-bl' | 'scale-br' | 'rotate' | null>(null);
  const [transformStart, setTransformStart] = useState<{
    mouse: { x: number; y: number };
    entities: GeometryEntity[];
    center: { x: number; y: number; cx: number; cy: number };
    bbox: { minX: number; minY: number; maxX: number; maxY: number; cx: number; cy: number; width: number; height: number };
    startAngle?: number;
  } | null>(null);

  const computeBoundingBoxForIndices = (indices: number[], entityList: GeometryEntity[]) => {
    if (indices.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const idx of indices) {
      const ent = entityList[idx];
      if (!ent) continue;
      if (ent.type === 'circle' && ent.cx != null && ent.cy != null && ent.r != null) {
        minX = Math.min(minX, ent.cx - ent.r);
        minY = Math.min(minY, ent.cy - ent.r);
        maxX = Math.max(maxX, ent.cx + ent.r);
        maxY = Math.max(maxY, ent.cy + ent.r);
      } else if (ent.type === 'polyline' && ent.points && ent.points.length > 0) {
        for (const pt of ent.points) {
          minX = Math.min(minX, pt[0]);
          minY = Math.min(minY, pt[1]);
          maxX = Math.max(maxX, pt[0]);
          maxY = Math.max(maxY, pt[1]);
        }
      }
    }
    if (minX === Infinity) return null;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const width = maxX - minX;
    const height = maxY - minY;
    return { minX, minY, maxX, maxY, cx, cy, width, height };
  };

  const findEntitiesInBox = (box: { minX: number; minY: number; maxX: number; maxY: number }, entityList: GeometryEntity[]) => {
    const { minX, minY, maxX, maxY } = box;
    const selected: number[] = [];
    entityList.forEach((ent, idx) => {
      if (ent.type === 'circle' && ent.cx != null && ent.cy != null && ent.r != null) {
        const eMinX = ent.cx - ent.r;
        const eMaxX = ent.cx + ent.r;
        const eMinY = ent.cy - ent.r;
        const eMaxY = ent.cy + ent.r;
        if (eMinX >= minX && eMaxX <= maxX && eMinY >= minY && eMaxY <= maxY) {
          selected.push(idx);
        }
      } else if (ent.type === 'polyline' && ent.points && ent.points.length > 0) {
        let eMinX = Infinity, eMinY = Infinity, eMaxX = -Infinity, eMaxY = -Infinity;
        for (const pt of ent.points) {
          eMinX = Math.min(eMinX, pt[0]);
          eMinY = Math.min(eMinY, pt[1]);
          eMaxX = Math.max(eMaxX, pt[0]);
          eMaxY = Math.max(eMaxY, pt[1]);
        }
        if (eMinX >= minX && eMaxX <= maxX && eMinY >= minY && eMaxY <= maxY) {
          selected.push(idx);
        }
      }
    });
    return selected;
  };

  useEffect(() => {
    setMeasureStart(null);
    setMeasureEnd(null);
    setDrawPoints([]);
    setArcStart(null);
    setArcEnd(null);
    setArcStep(0);
    setSnapPoint(null);
    setActiveDrag(null);
    setAlignSelectedSegment(null);
    setRect3PtPoints([]);
    setCircle3PtPoints([]);
    setSlot4PtPoints([]);
    setSplinePoints([]);
    setCadToolSelectedPoints([]);
    setSubregionBox(null);
    if (selectedTool !== 'select' && selectedTool !== 'subregion-select') {
      setSelectedEntityIndices([]);
    }
    onActiveDrawingChange?.(null);
  }, [selectedTool]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawPoints([]);
        setArcStart(null);
        setArcEnd(null);
        setArcStep(0);
        setSnapPoint(null);
        setActiveDrag(null);
        setSelectedEntityIndices([]);
        setSelectionMarquee(null);
        setTransformMode(null);
        setSplinePoints([]);
        setCadToolSelectedPoints([]);
        onActiveDrawingChange?.(null);
      } else if (e.key === 'Enter') {
        if (selectedTool === 'polyline' && drawPoints.length > 1) {
          onEntitiesChange([...entities, {
            type: 'polyline',
            layer: 'OUTER',
            points: drawPoints,
            closed: false
          }]);
          setDrawPoints([]);
          onActiveDrawingChange?.(null);
        } else if (selectedTool === 'spline' && splinePoints.length >= 2) {
          const evaluated = evaluateSplinePoints(splinePoints);
          onEntitiesChange([...entities, {
            type: 'polyline',
            layer: 'OUTER',
            points: evaluated,
            closed: false
          }]);
          setSplinePoints([]);
          onActiveDrawingChange?.(null);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedEntityIndices.length > 0) {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
          return;
        }
        const newEntities = entities.filter((_, idx) => !selectedEntityIndices.includes(idx));
        onEntitiesChange(newEntities, true);
        setSelectedEntityIndices([]);
      } else if (selectedTool === 'brush' && (e.key === 'b' || e.key === 'B' || e.key === 's' || e.key === 'S')) {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
          return;
        }
        onBrushShapeChange?.(brushShape === 'circle' ? 'square' : 'circle');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [entities, selectedEntityIndices, onEntitiesChange, selectedTool, brushShape, onBrushShapeChange, drawPoints, splinePoints, onActiveDrawingChange]);

  useEffect(() => {
    return () => {
      if (rendererRef.current) {
        rendererRef.current.dispose();
      }
    };
  }, []);

  const baseMinX = (result?.report?.bboxMinXMm || 0) - 10;
  const baseMinY = result?.report?.bboxMaxYMm ? -(result.report.bboxMaxYMm + 10) : 0;
  const baseWidth = (result?.report?.bboxWidthMm || 100) + 20;
  const baseHeight = (result?.report?.bboxHeightMm || 100) + 20;

  const activeViewport = viewport || {
    x: baseMinX,
    y: baseMinY,
    w: baseWidth,
    h: baseHeight,
  };

  const viewX = activeViewport.x;
  const viewY = activeViewport.y;
  const viewWidth = activeViewport.w;
  const viewHeight = activeViewport.h;

  useEffect(() => {
    const showGeometry = entities && entities.length > 0;
    if (!showGeometry || !canvasRef.current) return;

    if (!rendererRef.current) {
      const renderer = new THREE.WebGLRenderer({
        canvas: canvasRef.current,
        antialias: true,
        alpha: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      rendererRef.current = renderer;

      const scene = new THREE.Scene();
      sceneRef.current = scene;

      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
      cameraRef.current = camera;
    }

    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera) return;

    while (scene.children.length > 0) {
      const obj = scene.children[0];
      if (obj instanceof THREE.Line) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
      scene.remove(obj);
    }

    entities.forEach(entity => {
      const layer = entity.layer;
      if (layer === 'HOLES' && !holeLayerEnabled) return;
      if (layer === 'OUTER' && !outerLayerEnabled) return;
      if (layer === 'DETAILS' && !detailsLayerEnabled) return;

      let colorHex = '#ffffff';
      if (layer === 'HOLES') colorHex = '#5b9bd5';
      else if (layer === 'DETAILS') colorHex = '#10b981';

      const color = new THREE.Color(colorHex);

      if (entity.type === 'circle' && entity.cx != null && entity.cy != null && entity.r != null) {
        const points: THREE.Vector3[] = [];
        const segments = 64;
        for (let i = 0; i <= segments; i++) {
          const theta = (i / segments) * Math.PI * 2;
          points.push(new THREE.Vector3(entity.cx + Math.cos(theta) * entity.r, entity.cy + Math.sin(theta) * entity.r, 0));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color });
        const line = new THREE.Line(geometry, material);
        scene.add(line);
      } else if (entity.type === 'polyline' && entity.points && entity.points.length > 0) {
        const points: THREE.Vector3[] = [];
        entity.points.forEach(pt => {
          points.push(new THREE.Vector3(pt[0], pt[1], 0));
        });
        if (entity.closed) {
          points.push(new THREE.Vector3(entity.points[0][0], entity.points[0][1], 0));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({ color });
        const line = new THREE.Line(geometry, material);
        scene.add(line);
      }
    });

    const updateSize = () => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const canvasWidth = rect.width;
      const canvasHeight = rect.height;
      if (canvasWidth === 0 || canvasHeight === 0) return;

      renderer.setSize(canvasWidth, canvasHeight, false);

      const canvasAspect = canvasWidth / canvasHeight;
      const viewAspect = viewWidth / viewHeight;

      let camLeft = viewX;
      let camRight = viewX + viewWidth;
      let camTop = -viewY;
      let camBottom = -(viewY + viewHeight);

      if (canvasAspect > viewAspect) {
        const targetWidth = viewHeight * canvasAspect;
        const padX = (targetWidth - viewWidth) / 2;
        camLeft = viewX - padX;
        camRight = viewX + viewWidth + padX;
      } else {
        const targetHeight = viewWidth / canvasAspect;
        const padY = (targetHeight - viewHeight) / 2;
        camTop = -(viewY - padY);
        camBottom = -(viewY + viewHeight + padY);
      }

      camera.left = camLeft;
      camera.right = camRight;
      camera.top = camTop;
      camera.bottom = camBottom;
      camera.updateProjectionMatrix();

      renderer.render(scene, camera);
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });

    if (canvasRef.current.parentElement) {
      resizeObserver.observe(canvasRef.current.parentElement);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [
    entities,
    viewport,
    outerLayerEnabled,
    holeLayerEnabled,
    detailsLayerEnabled,
    viewX,
    viewY,
    viewWidth,
    viewHeight,
  ]);
  function computeCircumcircle(p1: [number, number], p2: [number, number], p3: [number, number]) {
    const d = 2 * (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]));
    if (Math.abs(d) < 1e-6) return null;
    const p1_sq = p1[0] * p1[0] + p1[1] * p1[1];
    const p2_sq = p2[0] * p2[0] + p2[1] * p2[1];
    const p3_sq = p3[0] * p3[0] + p3[1] * p3[1];
    const cx = (p1_sq * (p2[1] - p3[1]) + p2_sq * (p3[1] - p1[1]) + p3_sq * (p1[1] - p2[1])) / d;
    const cy = (p1_sq * (p3[0] - p2[0]) + p2_sq * (p1[0] - p3[0]) + p3_sq * (p2[0] - p1[0])) / d;
    const r = Math.hypot(p1[0] - cx, p1[1] - cy);
    return { cx, cy, r };
  }

  useEffect(() => {
    if (!onActiveDrawingChange) return;

    if (!cursorMm) {
      onActiveDrawingChange(null);
      return;
    }

    if (selectedTool === 'line' && drawPoints.length === 1) {
      onActiveDrawingChange({
        type: 'polyline',
        points: [drawPoints[0], [cursorMm.x, cursorMm.y]],
        closed: false,
      });
      return;
    }

    if (selectedTool === 'polyline' && drawPoints.length >= 1) {
      onActiveDrawingChange({
        type: 'polyline',
        points: [...drawPoints, [cursorMm.x, cursorMm.y]],
        closed: false,
      });
      return;
    }

    if (selectedTool === 'spline' && splinePoints.length >= 1) {
      onActiveDrawingChange({
        type: 'polyline',
        points: evaluateSplinePoints([...splinePoints, [cursorMm.x, cursorMm.y]]),
        closed: false,
      });
      return;
    }

    if (selectedTool === 'rect-3pt') {
      if (rect3PtPoints.length === 1) {
        onActiveDrawingChange({
          type: 'polyline',
          points: [rect3PtPoints[0], [cursorMm.x, cursorMm.y]],
          closed: false,
        });
        return;
      }
      if (rect3PtPoints.length === 2) {
        const p1 = rect3PtPoints[0];
        const p2 = rect3PtPoints[1];
        const p3: [number, number] = [cursorMm.x, cursorMm.y];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len >= 0.001) {
          const nx = -dy / len;
          const ny = dx / len;
          const h = (p3[0] - p1[0]) * nx + (p3[1] - p1[1]) * ny;
          const p4: [number, number] = [p2[0] + h * nx, p2[1] + h * ny];
          const p5: [number, number] = [p1[0] + h * nx, p1[1] + h * ny];
          onActiveDrawingChange({
            type: 'polyline',
            points: [p1, p2, p4, p5],
            closed: true,
          });
          return;
        }
      }
    }

    if (selectedTool === 'circle-3pt') {
      if (circle3PtPoints.length === 1) {
        onActiveDrawingChange({
          type: 'polyline',
          points: [circle3PtPoints[0], [cursorMm.x, cursorMm.y]],
          closed: false,
        });
        return;
      }
      if (circle3PtPoints.length === 2) {
        const circle = computeCircumcircle(circle3PtPoints[0], circle3PtPoints[1], [cursorMm.x, cursorMm.y]);
        if (circle) {
          onActiveDrawingChange({
            type: 'circle',
            cx: circle.cx,
            cy: circle.cy,
            r: circle.r,
          });
          return;
        }
      }
    }

    if (selectedTool === 'slot-4pt') {
      if (slot4PtPoints.length === 1) {
        onActiveDrawingChange({
          type: 'polyline',
          points: [slot4PtPoints[0], [cursorMm.x, cursorMm.y]],
          closed: false,
        });
        return;
      }
      if (slot4PtPoints.length === 2) {
        const p1 = slot4PtPoints[0];
        const p2 = slot4PtPoints[1];
        const p3: [number, number] = [cursorMm.x, cursorMm.y];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len >= 0.001) {
          const nx = -dy / len;
          const ny = dx / len;
          const r = Math.abs((p3[0] - p1[0]) * nx + (p3[1] - p1[1]) * ny);
          const pts: [number, number][] = [];
          const ax = Math.atan2(dy, dx);
          for (let i = 0; i <= 8; i++) {
            const ang = -(Math.PI / 2) + (i / 8) * Math.PI;
            pts.push([p2[0] + r * Math.cos(ax + ang), p2[1] + r * Math.sin(ax + ang)]);
          }
          for (let i = 0; i <= 8; i++) {
            const ang = (Math.PI / 2) + (i / 8) * Math.PI;
            pts.push([p1[0] + r * Math.cos(ax + ang), p1[1] + r * Math.sin(ax + ang)]);
          }
          onActiveDrawingChange({
            type: 'polyline',
            points: pts,
            closed: true,
          });
          return;
        }
      }
    }

    if (selectedTool === 'arc') {
      if (arcStep === 1 && arcStart) {
        onActiveDrawingChange({
          type: 'polyline',
          points: [[arcStart.x, arcStart.y], [cursorMm.x, cursorMm.y]],
          closed: false,
        });
        return;
      }
      if (arcStep === 2 && arcStart && arcEnd) {
        const pts: [number, number][] = [];
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const x = (1 - t) ** 2 * arcStart.x + 2 * (1 - t) * t * cursorMm.x + t ** 2 * arcEnd.x;
          const y = (1 - t) ** 2 * arcStart.y + 2 * (1 - t) * t * cursorMm.y + t ** 2 * arcEnd.y;
          pts.push([x, y]);
        }
        onActiveDrawingChange({
          type: 'polyline',
          points: pts,
          closed: false,
        });
        return;
      }
    }

    onActiveDrawingChange(null);
  }, [
    selectedTool,
    cursorMm,
    drawPoints,
    splinePoints,
    rect3PtPoints,
    circle3PtPoints,
    slot4PtPoints,
    arcStep,
    arcStart,
    arcEnd,
    onActiveDrawingChange,
  ]);

  const getModelCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!svgRef.current) return null;
    try {
      const svg = svgRef.current;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const transformed = pt.matrixTransform(ctm.inverse());
      return {
        x: transformed.x,
        y: -transformed.y,
      };
    } catch {
      return null;
    }
  };

  const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };

  
  const applyBrushDeform = (cx: number, cy: number, currentEntities: GeometryEntity[]) => {
    return currentEntities.map((entity) => {
      if (entity.type === 'polyline' && entity.points) {
        const newPoints = entity.points.map((pt) => {
          const px = pt[0];
          const py = pt[1];
          
          if (brushShape === 'circle') {
            const d = Math.hypot(px - cx, py - cy);
            if (d < brushRadius && d > 0.01) {
              return [
                cx + ((px - cx) / d) * brushRadius,
                cy + ((py - cy) / d) * brushRadius,
              ] as [number, number];
            }
          } else {
            const dx = px - cx;
            const dy = py - cy;
            const maxD = Math.max(Math.abs(dx), Math.abs(dy));
            if (maxD < brushRadius && maxD > 0.01) {
              return [
                cx + (dx / maxD) * brushRadius,
                cy + (dy / maxD) * brushRadius,
              ] as [number, number];
            }
          }
          return pt;
        });
        return {
          ...entity,
          points: newPoints,
        };
      } else if (entity.type === 'circle' && entity.cx != null && entity.cy != null) {
        const px = entity.cx;
        const py = entity.cy;
        if (brushShape === 'circle') {
          const d = Math.hypot(px - cx, py - cy);
          if (d < brushRadius && d > 0.01) {
            return {
              ...entity,
              cx: cx + ((px - cx) / d) * brushRadius,
              cy: cy + ((py - cy) / d) * brushRadius,
            };
          }
        } else {
          const dx = px - cx;
          const dy = py - cy;
          const maxD = Math.max(Math.abs(dx), Math.abs(dy));
          if (maxD < brushRadius && maxD > 0.01) {
            return {
              ...entity,
              cx: cx + (dx / maxD) * brushRadius,
              cy: cy + (dy / maxD) * brushRadius,
            };
          }
        }
      }
      return entity;
    });
  };

  
  const getSnappedCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const coords = getModelCoords(clientX, clientY);
    if (!coords) return null;

    const handleScale = Math.max(0.005, viewWidth / 400);
    const snapRadius = Math.max(0.1, viewWidth / 80); 
    let bestPt = coords;
    let minD = snapRadius;

    // 1. Priority 1: Vertices and Circle Centers
    for (const ent of entities) {
      if (ent.type === 'circle' && ent.cx != null && ent.cy != null) {
        const d = Math.hypot(coords.x - ent.cx, coords.y - ent.cy);
        if (d < minD) {
          minD = d;
          bestPt = { x: ent.cx, y: ent.cy };
        }
      } else if (ent.type === 'polyline' && ent.points) {
        for (const pt of ent.points) {
          const d = Math.hypot(coords.x - pt[0], coords.y - pt[1]);
          if (d < minD) {
            minD = d;
            bestPt = { x: pt[0], y: pt[1] };
          }
        }
      }
    }

    if (minD < snapRadius) {
      return bestPt;
    }

    // 2. Priority 2: Edges / Segments
    let edgeMinD = snapRadius;
    let bestEdgePt: { x: number; y: number } | null = null;

    for (const ent of entities) {
      if (ent.type === 'polyline' && ent.points && ent.points.length >= 2) {
        const pts = ent.points;
        for (let i = 0; i < pts.length; i++) {
          const p1 = pts[i];
          const p2 = pts[(i + 1) % pts.length];
          if (!ent.closed && i === pts.length - 1) continue;

          const dx = p2[0] - p1[0];
          const dy = p2[1] - p1[1];
          const l2 = dx * dx + dy * dy;
          if (l2 === 0) continue;
          let t = ((coords.x - p1[0]) * dx + (coords.y - p1[1]) * dy) / l2;
          t = Math.max(0, Math.min(1, t));
          const projX = p1[0] + t * dx;
          const projY = p1[1] + t * dy;
          const d = Math.hypot(coords.x - projX, coords.y - projY);

          if (d < edgeMinD) {
            edgeMinD = d;
            bestEdgePt = { x: projX, y: projY };
          }
        }
      }
    }

    return bestEdgePt ? bestEdgePt : null;
  };

  const findClosestEntity = (pt: { x: number; y: number }) => {
    let bestIndex = -1;
    let minD = Infinity;

    for (let idx = 0; idx < entities.length; idx++) {
      const ent = entities[idx];
      if (ent.type === 'circle' && ent.cx != null && ent.cy != null && ent.r != null) {
        const d = Math.abs(Math.hypot(pt.x - ent.cx, pt.y - ent.cy) - ent.r);
        if (d < minD) {
          minD = d;
          bestIndex = idx;
        }
      } else if (ent.type === 'polyline' && ent.points && ent.points.length > 0) {
        for (let i = 0; i < ent.points.length; i++) {
          const p1 = ent.points[i];
          const p2 = ent.points[(i + 1) % ent.points.length];
          if (!ent.closed && i === ent.points.length - 1) continue;
          
          const d = distToSegment(pt.x, pt.y, p1[0], p1[1], p2[0], p2[1]);
          if (d < minD) {
            minD = d;
            bestIndex = idx;
          }
        }
      }
    }
    return { index: bestIndex, dist: minD };
  };

  const handleAddPointClick = (pt: { x: number; y: number }) => {
    const distanceScale = viewWidth / 300;
    let bestEntityIdx = -1;
    let bestSegmentIdx = -1;
    let minD = 6.0 * distanceScale; 
    let splitPoint: [number, number] = [0, 0];

    for (let idx = 0; idx < entities.length; idx++) {
      const ent = entities[idx];
      if (ent.type === 'polyline' && ent.points) {
        for (let i = 0; i < ent.points.length; i++) {
          const p1 = ent.points[i];
          const p2 = ent.points[(i + 1) % ent.points.length];
          if (!ent.closed && i === ent.points.length - 1) continue;

          const dx = p2[0] - p1[0];
          const dy = p2[1] - p1[1];
          const l2 = dx * dx + dy * dy;
          if (l2 === 0) continue;
          let t = ((pt.x - p1[0]) * dx + (pt.y - p1[1]) * dy) / l2;
          t = Math.max(0, Math.min(1, t));
          const projX = p1[0] + t * dx;
          const projY = p1[1] + t * dy;
          const d = Math.hypot(pt.x - projX, pt.y - projY);

          if (d < minD) {
            minD = d;
            bestEntityIdx = idx;
            bestSegmentIdx = i;
            splitPoint = [projX, projY];
          }
        }
      }
    }

    if (bestEntityIdx !== -1 && bestSegmentIdx !== -1) {
      const ent = entities[bestEntityIdx];
      if (ent.points) {
        const newPoints = [...ent.points];
        newPoints.splice(bestSegmentIdx + 1, 0, splitPoint);
        const newEntities = [...entities];
        newEntities[bestEntityIdx] = {
          ...ent,
          points: newPoints,
        };
        onEntitiesChange(newEntities);
      }
    }
  };

  const [hoveredNode, setHoveredNode] = useState<{ entityIdx: number; type: 'vertex' | 'center' | 'radius'; ptIdx?: number } | null>(null);

  const updateCursorFromEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    const rawCoords = getModelCoords(e.clientX, e.clientY);
    if (!rawCoords) return;

    let coords = rawCoords;
    const snapped = getSnappedCoords(e.clientX, e.clientY);
    if (snapped && selectedTool !== 'brush') {
      coords = snapped;
      setSnapPoint(snapped);
    } else {
      setSnapPoint(null);
    }

    setCursorMm(coords);

    const distanceScale = viewWidth / 300;
    const grabRadius = 5.5 * distanceScale * 2.2;
    let foundNode: { entityIdx: number; type: 'vertex' | 'center' | 'radius'; ptIdx?: number } | null = null;

    const toolsWithNodes = ['select', 'delete-point', 'add-point', 'fillet', 'chamfer', 'fuse', 'cut', 'delete'];
    if (toolsWithNodes.includes(selectedTool)) {
      const nodeHitRadius = (selectedTool === 'fillet' || selectedTool === 'chamfer' || selectedTool === 'fuse') ? grabRadius * 1.8 : grabRadius;
      for (let entityIdx = 0; entityIdx < entities.length; entityIdx++) {
        const entity = entities[entityIdx];
        const layer = entity.layer;
        if (layer === 'HOLES' && !holeLayerEnabled) continue;
        if (layer === 'OUTER' && !outerLayerEnabled) continue;
        if (layer === 'DETAILS' && !detailsLayerEnabled) continue;

        if (entity.type === 'circle' && entity.cx != null && entity.cy != null && entity.r != null) {
          if (selectedTool !== 'delete-point') {
            const dCenter = Math.hypot(coords.x - entity.cx, coords.y - entity.cy);
            if (dCenter < grabRadius) {
              foundNode = { entityIdx, type: 'center' };
              break;
            }
            const dRadius = Math.hypot(coords.x - (entity.cx + entity.r), coords.y - entity.cy);
            if (dRadius < grabRadius) {
              foundNode = { entityIdx, type: 'radius' };
              break;
            }
          }
        } else if (entity.type === 'polyline' && entity.points) {
          for (let ptIdx = 0; ptIdx < entity.points.length; ptIdx++) {
            const pt = entity.points[ptIdx];
            const dPt = Math.hypot(coords.x - pt[0], coords.y - pt[1]);
            if (dPt < nodeHitRadius) {
              foundNode = { entityIdx, type: 'vertex', ptIdx };
              break;
            }
          }
          if (foundNode) break;
        }
      }
    }
    setHoveredNode(foundNode);
  };

  
  const handleStartNodeDragOrDelete = (
    node: { entityIdx: number; type: 'vertex' | 'center' | 'radius'; ptIdx?: number },
    pointerId: number
  ) => {
    if (selectedTool === 'delete-point' || selectedTool === 'delete') {
      if (node.type === 'vertex' && node.ptIdx !== undefined) {
        const ent = entities[node.entityIdx];
        if (ent && ent.type === 'polyline' && ent.points) {
          if (ent.points.length > 2) {
            const newPoints = ent.points.filter((_, i) => i !== node.ptIdx);
            const newEntities = [...entities];
            newEntities[node.entityIdx] = { ...ent, points: newPoints };
            onEntitiesChange(newEntities, true);
          } else {
            const newEntities = entities.filter((_, i) => i !== node.entityIdx);
            onEntitiesChange(newEntities, true);
          }
          setHoveredNode(null);
          return true;
        }
      }
    }

    setActiveDrag({ type: node.type, entityIdx: node.entityIdx, pointIdx: node.ptIdx });
    if (svgRef.current) {
      try {
        svgRef.current.setPointerCapture(pointerId);
      } catch {}
    }
    return true;
  };

  const applyTwoPointFilletOrChamfer = (
    p1: { entityIdx: number; ptIdx?: number; segIdx?: number; pt: [number, number] },
    p2: { entityIdx: number; ptIdx?: number; segIdx?: number; pt: [number, number] },
    tool: ToolId
  ) => {
    let entIdx = p1.entityIdx;
    if (p1.entityIdx !== p2.entityIdx) {
      const fusedIdx = applyFuseTwoPoints(p1, p2);
      if (fusedIdx === -1) return;
      entIdx = fusedIdx;
    }

    const ent = entities[entIdx];
    if (!ent || ent.type !== 'polyline' || !ent.points || ent.points.length < 2) return;

    const pts = ent.points;
    let seg1 = p1.segIdx;
    if (seg1 == null && p1.ptIdx != null) {
      seg1 = Math.max(0, Math.min(pts.length - 2, p1.ptIdx > 0 ? p1.ptIdx - 1 : 0));
    }
    let seg2 = p2.segIdx;
    if (seg2 == null && p2.ptIdx != null) {
      seg2 = Math.max(0, Math.min(pts.length - 2, p2.ptIdx > 0 ? p2.ptIdx - 1 : 0));
    }

    if (seg1 == null || seg2 == null || seg1 === seg2) return;

    const minSeg = Math.min(seg1, seg2);
    const maxSeg = Math.max(seg1, seg2);

    const startPt = minSeg === seg1 ? p1.pt : p2.pt;
    const endPt = minSeg === seg1 ? p2.pt : p1.pt;
    if (!startPt || !endPt || startPt[0] == null || endPt[0] == null) return;

    let cornerPt: [number, number] = pts[minSeg + 1] ?? startPt;
    let maxDist = -1;
    for (let k = minSeg + 1; k <= maxSeg; k++) {
      const v = pts[k];
      if (!v || v[0] == null) continue;
      const d = distToSegment(v[0], v[1], startPt[0], startPt[1], endPt[0], endPt[1]);
      if (d > maxDist) {
        maxDist = d;
        cornerPt = v;
      }
    }

    const res = computeFilletBetweenTwoPoints(startPt, endPt, cornerPt, 16);
    const replacement = (tool === 'chamfer' || !res || res.arcPts.length === 0)
      ? [startPt, endPt]
      : [res.pStart, ...res.arcPts, res.pEnd];

    const newPts = [
      ...pts.slice(0, minSeg + 1),
      ...replacement,
      ...pts.slice(maxSeg + 1),
    ];

    const newEntities = [...entities];
    newEntities[entIdx] = { ...ent, points: newPts };
    onEntitiesChange(newEntities, true);
  };

  const applyFuseTwoPoints = (
    p1: { entityIdx: number; ptIdx?: number; pt: [number, number] },
    p2: { entityIdx: number; ptIdx?: number; pt: [number, number] }
  ): number => {
    const mid: [number, number] = [(p1.pt[0] + p2.pt[0]) / 2, (p1.pt[1] + p2.pt[1]) / 2];

    if (p1.entityIdx === p2.entityIdx) {
      const ent = entities[p1.entityIdx];
      if (ent && ent.points && ent.points.length >= 2 && p1.ptIdx != null && p2.ptIdx != null) {
        const len = ent.points.length;
        const isStartEnd = (p1.ptIdx === 0 && p2.ptIdx === len - 1) || (p2.ptIdx === 0 && p1.ptIdx === len - 1);
        const newPts = [...ent.points];
        if (isStartEnd) {
          newPts[0] = mid;
          newPts[len - 1] = mid;
          const newEntities = [...entities];
          newEntities[p1.entityIdx] = { ...ent, points: newPts, closed: true };
          onEntitiesChange(newEntities, true);
          return p1.entityIdx;
        } else if (Math.abs(p1.ptIdx - p2.ptIdx) === 1) {
          const minIdx = Math.min(p1.ptIdx, p2.ptIdx);
          newPts[minIdx] = mid;
          newPts.splice(minIdx + 1, 1);
          const newEntities = [...entities];
          newEntities[p1.entityIdx] = { ...ent, points: newPts };
          onEntitiesChange(newEntities, true);
          return p1.entityIdx;
        } else {
          newPts[p1.ptIdx] = mid;
          newPts[p2.ptIdx] = mid;
          const newEntities = [...entities];
          newEntities[p1.entityIdx] = { ...ent, points: newPts };
          onEntitiesChange(newEntities, true);
          return p1.entityIdx;
        }
      }
    } else {
      const e1 = entities[p1.entityIdx];
      const e2 = entities[p2.entityIdx];
      if (e1 && e2 && e1.type === 'polyline' && e2.type === 'polyline' && e1.points && e2.points) {
        const i1 = p1.ptIdx ?? (Math.hypot(p1.pt[0] - e1.points[0][0], p1.pt[1] - e1.points[0][1]) < Math.hypot(p1.pt[0] - e1.points[e1.points.length - 1][0], p1.pt[1] - e1.points[e1.points.length - 1][1]) ? 0 : e1.points.length - 1);
        const i2 = p2.ptIdx ?? (Math.hypot(p2.pt[0] - e2.points[0][0], p2.pt[1] - e2.points[0][1]) < Math.hypot(p2.pt[0] - e2.points[e2.points.length - 1][0], p2.pt[1] - e2.points[e2.points.length - 1][1]) ? 0 : e2.points.length - 1);

        let pts1 = [...e1.points];
        let pts2 = [...e2.points];

        if (i1 === 0) pts1.reverse();
        if (i2 === e2.points.length - 1) pts2.reverse();

        pts1[pts1.length - 1] = mid;
        pts2[0] = mid;

        const combinedPts: [number, number][] = [...pts1, ...pts2.slice(1)];
        const fusedEntity: GeometryEntity = {
          ...e1,
          points: combinedPts,
          closed: false,
        };

        const minIdx = Math.min(p1.entityIdx, p2.entityIdx);
        const maxIdx = Math.max(p1.entityIdx, p2.entityIdx);

        const newEntities = entities.filter((_, idx) => idx !== minIdx && idx !== maxIdx);
        newEntities.push(fusedEntity);
        onEntitiesChange(newEntities, true);
        return newEntities.length - 1;
      }
    }
    return -1;
  };

  const handleFuseClick = (coords: { x: number; y: number }, clickedNode?: { entityIdx: number; ptIdx: number }) => {
    const distanceScale = viewWidth / 300;
    let target: { entityIdx: number; ptIdx: number; pt: [number, number] } | null = null;

    if (clickedNode && clickedNode.entityIdx >= 0 && clickedNode.ptIdx != null) {
      const ent = entities[clickedNode.entityIdx];
      if (ent && ent.points && ent.points[clickedNode.ptIdx]) {
        target = {
          entityIdx: clickedNode.entityIdx,
          ptIdx: clickedNode.ptIdx,
          pt: ent.points[clickedNode.ptIdx],
        };
      }
    }

    if (!target) {
      let minD = 25.0 * distanceScale;
      entities.forEach((ent, entIdx) => {
        if (ent.type === 'polyline' && ent.points) {
          ent.points.forEach((pt, ptIdx) => {
            const d = Math.hypot(coords.x - pt[0], coords.y - pt[1]);
            if (d < minD) {
              minD = d;
              target = { entityIdx: entIdx, ptIdx, pt };
            }
          });
        }
      });
    }

    if (!target) return;

    if (cadToolSelectedPoints.length === 0) {
      setCadToolSelectedPoints([target]);
    } else {
      const p1 = cadToolSelectedPoints[0];
      const p2 = target;
      if (p1.entityIdx === p2.entityIdx && p1.ptIdx === p2.ptIdx) {
        return;
      }
      applyFuseTwoPoints(p1, p2);
      setCadToolSelectedPoints([]);
    }
  };

  const handleFilletOrChamferClick = (coords: { x: number; y: number }, clickedNode?: { entityIdx: number; ptIdx: number }, tool: ToolId = selectedTool) => {
    const distanceScale = viewWidth / 300;

    let target: { entityIdx: number; ptIdx?: number; segIdx?: number; pt: [number, number] } | null = null;

    if (clickedNode && clickedNode.entityIdx >= 0 && clickedNode.ptIdx != null) {
      const ent = entities[clickedNode.entityIdx];
      if (ent && ent.points && ent.points[clickedNode.ptIdx]) {
        target = {
          entityIdx: clickedNode.entityIdx,
          ptIdx: clickedNode.ptIdx,
          pt: ent.points[clickedNode.ptIdx],
        };
      }
    }

    if (!target) {
      interface BestVertexType { entityIdx: number; ptIdx: number; pt: [number, number] }
      interface BestSegType { entityIdx: number; segIdx: number; p1: [number, number]; p2: [number, number]; proj: [number, number] }

      let bestVertex: BestVertexType | null = null;
      let minVertexD = 15.0 * distanceScale;

      let bestSegment: BestSegType | null = null;
      let minSegD = 15.0 * distanceScale;

      for (let entIdx = 0; entIdx < entities.length; entIdx++) {
        const ent = entities[entIdx];
        if (ent.type === 'polyline' && ent.points && ent.points.length >= 2) {
          const pts = ent.points;
          const n = pts.length;
          const isClosed = ent.closed === true;

          for (let ptIdx = 0; ptIdx < n; ptIdx++) {
            const pt = pts[ptIdx];
            const d = Math.hypot(coords.x - pt[0], coords.y - pt[1]);
            if (d < minVertexD) {
              minVertexD = d;
              bestVertex = { entityIdx: entIdx, ptIdx, pt };
            }
          }

          for (let i = 0; i < n; i++) {
            const p1 = pts[i];
            const p2 = pts[(i + 1) % n];
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const l2 = dx * dx + dy * dy;
            if (l2 === 0) continue;
            let t = ((coords.x - p1[0]) * dx + (coords.y - p1[1]) * dy) / l2;
            t = Math.max(0, Math.min(1, t));
            const projX = p1[0] + t * dx;
            const projY = p1[1] + t * dy;
            const d = Math.hypot(coords.x - projX, coords.y - projY);
            if (d < minSegD) {
              minSegD = d;
              bestSegment = { entityIdx: entIdx, segIdx: i, p1, p2, proj: [projX, projY] };
            }
          }
        }
      }

      if (bestVertex && minVertexD <= minSegD) {
        target = { entityIdx: bestVertex.entityIdx, ptIdx: bestVertex.ptIdx, pt: bestVertex.pt };
      } else if (bestSegment) {
        target = { entityIdx: bestSegment.entityIdx, segIdx: bestSegment.segIdx, pt: bestSegment.proj };
      }
    }

    if (!target) return;

    if (cadToolSelectedPoints.length === 0) {
      setCadToolSelectedPoints([target]);
      return;
    }

    const p1 = cadToolSelectedPoints[0];
    const p2 = target;

    if (p1.entityIdx === p2.entityIdx && p1.ptIdx === p2.ptIdx && p1.segIdx === p2.segIdx && p1.ptIdx != null) {
      return;
    }

    applyTwoPointFilletOrChamfer(p1, p2, tool);
    setCadToolSelectedPoints([]);
  };

  const handleVertexPointerDown = (e: React.PointerEvent<SVGCircleElement>, entityIdx: number, pointIdx: number) => {
    e.stopPropagation();
    if (selectedTool === 'fillet' || selectedTool === 'chamfer') {
      handleFilletOrChamferClick({ x: 0, y: 0 }, { entityIdx, ptIdx: pointIdx }, selectedTool);
      return;
    }
    if (selectedTool === 'fuse') {
      handleFuseClick({ x: 0, y: 0 }, { entityIdx, ptIdx: pointIdx });
      return;
    }
    if (selectedTool === 'delete-point' || selectedTool === 'delete') {
      handleStartNodeDragOrDelete({ type: 'vertex', entityIdx, ptIdx: pointIdx }, e.pointerId);
      return;
    }
    if (selectedTool === 'select') {
      handleStartNodeDragOrDelete({ type: 'vertex', entityIdx, ptIdx: pointIdx }, e.pointerId);
      return;
    }
  };

  const handleCircleCenterDragStart = (e: React.PointerEvent<SVGCircleElement>, entityIdx: number) => {
    e.stopPropagation();
    handleStartNodeDragOrDelete({ type: 'center', entityIdx }, e.pointerId);
  };

  const handleCircleRadiusDragStart = (e: React.PointerEvent<SVGCircleElement>, entityIdx: number) => {
    e.stopPropagation();
    handleStartNodeDragOrDelete({ type: 'radius', entityIdx }, e.pointerId);
  };

  const handleHandlePointerUp = (e: React.PointerEvent<SVGCircleElement>) => {
    if (activeDrag) {
      if (svgRef.current) {
        try {
          svgRef.current.releasePointerCapture(e.pointerId);
        } catch {}
      }
      setActiveDrag(null);
      onEntitiesChange(entities, true);
    }
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const rawCoords = getModelCoords(e.clientX, e.clientY);
    if (!rawCoords) return;

    let clickCoords = rawCoords;
    const snapped = getSnappedCoords(e.clientX, e.clientY);
    if (snapped && selectedTool !== 'brush') {
      clickCoords = snapped;
    }

    if (hoveredNode) {
      handleStartNodeDragOrDelete(hoveredNode, e.pointerId);
      return;
    }

    if (selectedTool === 'select' || selectedTool === 'subregion-select') {
      const distanceScale = viewWidth / 300;
      const selectionBBox = computeBoundingBoxForIndices(selectedEntityIndices, entities);
      if (selectionBBox) {
        const { minX, minY, maxX, maxY, cx, cy } = selectionBBox;

        const rotHandleX = cx;
        const rotHandleY = maxY + 8 * distanceScale;
        if (Math.hypot(clickCoords.x - rotHandleX, clickCoords.y - rotHandleY) < 5.5 * distanceScale) {
          setTransformMode('rotate');
          setTransformStart({
            mouse: clickCoords,
            entities: JSON.parse(JSON.stringify(entities)),
            center: { x: cx, y: cy, cx, cy },
            bbox: selectionBBox,
            startAngle: Math.atan2(clickCoords.y - cy, clickCoords.x - cx),
          });
          setIsDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }

        const handleRadius = 5.5 * distanceScale;
        if (Math.hypot(clickCoords.x - minX, clickCoords.y - maxY) < handleRadius) {
          setTransformMode('scale-tl');
          setTransformStart({ mouse: clickCoords, entities: JSON.parse(JSON.stringify(entities)), center: { x: cx, y: cy, cx, cy }, bbox: selectionBBox });
          setIsDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
        if (Math.hypot(clickCoords.x - maxX, clickCoords.y - maxY) < handleRadius) {
          setTransformMode('scale-tr');
          setTransformStart({ mouse: clickCoords, entities: JSON.parse(JSON.stringify(entities)), center: { x: cx, y: cy, cx, cy }, bbox: selectionBBox });
          setIsDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
        if (Math.hypot(clickCoords.x - minX, clickCoords.y - minY) < handleRadius) {
          setTransformMode('scale-bl');
          setTransformStart({ mouse: clickCoords, entities: JSON.parse(JSON.stringify(entities)), center: { x: cx, y: cy, cx, cy }, bbox: selectionBBox });
          setIsDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
        if (Math.hypot(clickCoords.x - maxX, clickCoords.y - minY) < handleRadius) {
          setTransformMode('scale-br');
          setTransformStart({ mouse: clickCoords, entities: JSON.parse(JSON.stringify(entities)), center: { x: cx, y: cy, cx, cy }, bbox: selectionBBox });
          setIsDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }

        if (clickCoords.x >= minX && clickCoords.x <= maxX && clickCoords.y >= minY && clickCoords.y <= maxY) {
          setTransformMode('translate');
          setTransformStart({ mouse: clickCoords, entities: JSON.parse(JSON.stringify(entities)), center: { x: cx, y: cy, cx, cy }, bbox: selectionBBox });
          setIsDragging(true);
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
      }

      const closest = findClosestEntity(clickCoords);
      if (closest.index !== -1 && closest.dist < 5.5 * distanceScale) {
        if (e.shiftKey) {
          if (selectedEntityIndices.includes(closest.index)) {
            setSelectedEntityIndices(selectedEntityIndices.filter(i => i !== closest.index));
          } else {
            setSelectedEntityIndices([...selectedEntityIndices, closest.index]);
          }
        } else {
          setSelectedEntityIndices([closest.index]);
        }
        setIsDragging(true);
        setLastPos({ x: e.clientX, y: e.clientY });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }

      setSelectedEntityIndices([]);
      if (selectedTool === 'subregion-select') {
        setSelectionMarquee({ start: clickCoords, end: clickCoords });
      }
      setIsDragging(true);
      setLastPos({ x: e.clientX, y: e.clientY });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (selectedTool === 'measure') {
      if (!measureStart || (measureStart && measureEnd && (measureStart.x !== measureEnd.x || measureStart.y !== measureEnd.y))) {
        setMeasureStart(clickCoords);
        setMeasureEnd(clickCoords);
      } else {
        setMeasureEnd(clickCoords);
      }
    } else if (selectedTool === 'brush') {
      const newEntities = applyBrushDeform(clickCoords.x, clickCoords.y, entities);
      onEntitiesChange(newEntities);
      setIsDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (selectedTool === 'line') {
      if (drawPoints.length === 0) {
        const pts: [number, number][] = [[clickCoords.x, clickCoords.y]];
        setDrawPoints(pts);
        onActiveDrawingChange?.({ type: 'polyline', points: pts });
      } else {
        onEntitiesChange([...entities, {
          type: 'polyline',
          layer: 'OUTER',
          points: [drawPoints[0], [clickCoords.x, clickCoords.y]],
          closed: false
        }]);
        setDrawPoints([]);
        onActiveDrawingChange?.(null);
      }
    } else if (selectedTool === 'polyline') {
      const nextPts: [number, number][] = [...drawPoints, [clickCoords.x, clickCoords.y]];
      setDrawPoints(nextPts);
      onActiveDrawingChange?.({ type: 'polyline', points: nextPts });
    } else if (selectedTool === 'spline') {
      const nextPts: [number, number][] = [...splinePoints, [clickCoords.x, clickCoords.y]];
      setSplinePoints(nextPts);
      onActiveDrawingChange?.({ type: 'polyline', points: evaluateSplinePoints(nextPts) });
    } else if (selectedTool === 'rect-3pt') {
      if (rect3PtPoints.length === 0) {
        setRect3PtPoints([[clickCoords.x, clickCoords.y]]);
      } else if (rect3PtPoints.length === 1) {
        setRect3PtPoints([rect3PtPoints[0], [clickCoords.x, clickCoords.y]]);
      } else if (rect3PtPoints.length === 2) {
        const p1 = rect3PtPoints[0];
        const p2 = rect3PtPoints[1];
        const p3: [number, number] = [clickCoords.x, clickCoords.y];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
          const nx = -dy / len;
          const ny = dx / len;
          const h = (p3[0] - p1[0]) * nx + (p3[1] - p1[1]) * ny;
          const p4: [number, number] = [p2[0] + h * nx, p2[1] + h * ny];
          const p5: [number, number] = [p1[0] + h * nx, p1[1] + h * ny];
          onEntitiesChange([...entities, {
            type: 'polyline',
            layer: 'OUTER',
            points: [p1, p2, p4, p5],
            closed: true,
          }]);
        }
        setRect3PtPoints([]);
        onActiveDrawingChange?.(null);
      }
    } else if (selectedTool === 'circle-3pt') {
      if (circle3PtPoints.length < 2) {
        setCircle3PtPoints([...circle3PtPoints, [clickCoords.x, clickCoords.y]]);
      } else {
        const circle = computeCircumcircle(circle3PtPoints[0], circle3PtPoints[1], [clickCoords.x, clickCoords.y]);
        if (circle) {
          onEntitiesChange([...entities, {
            type: 'circle',
            layer: 'OUTER',
            cx: circle.cx,
            cy: circle.cy,
            r: circle.r,
          }]);
        }
        setCircle3PtPoints([]);
        onActiveDrawingChange?.(null);
      }
    } else if (selectedTool === 'slot-4pt') {
      if (slot4PtPoints.length < 2) {
        setSlot4PtPoints([...slot4PtPoints, [clickCoords.x, clickCoords.y]]);
      } else {
        const p1 = slot4PtPoints[0];
        const p2 = slot4PtPoints[1];
        const p3: [number, number] = [clickCoords.x, clickCoords.y];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len > 0.001) {
          const nx = -dy / len;
          const ny = dx / len;
          const r = Math.abs((p3[0] - p1[0]) * nx + (p3[1] - p1[1]) * ny);
          const pts: [number, number][] = [];
          for (let i = 0; i <= 8; i++) {
            const ang = -(Math.PI / 2) + (i / 8) * Math.PI;
            const ax = Math.atan2(dy, dx);
            pts.push([p2[0] + r * Math.cos(ax + ang), p2[1] + r * Math.sin(ax + ang)]);
          }
          for (let i = 0; i <= 8; i++) {
            const ang = (Math.PI / 2) + (i / 8) * Math.PI;
            const ax = Math.atan2(dy, dx);
            pts.push([p1[0] + r * Math.cos(ax + ang), p1[1] + r * Math.sin(ax + ang)]);
          }
          onEntitiesChange([...entities, {
            type: 'polyline',
            layer: 'OUTER',
            points: pts,
            closed: true,
          }]);
        }
        setSlot4PtPoints([]);
        onActiveDrawingChange?.(null);
      }
    } else if (selectedTool === 'centerline') {
      const distanceScale = viewWidth / 300;
      const closest = findClosestEntity(clickCoords);
      if (closest.index !== -1 && closest.dist < 15.0 * distanceScale) {
        const target = entities[closest.index];
        if (target.type === 'circle' && target.cx != null && target.cy != null && target.r != null) {
          const rExt = target.r * 1.25;
          onEntitiesChange([
            ...entities,
            { type: 'polyline', layer: 'DETAILS', points: [[target.cx - rExt, target.cy], [target.cx + rExt, target.cy]], closed: false },
            { type: 'polyline', layer: 'DETAILS', points: [[target.cx, target.cy - rExt], [target.cx, target.cy + rExt]], closed: false },
          ]);
        } else if (target.type === 'polyline' && target.points && target.points.length > 0) {
          if (target.points.length === 2 && !target.closed) {
            const [p1, p2] = target.points;
            const mx = (p1[0] + p2[0]) / 2;
            const my = (p1[1] + p2[1]) / 2;
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const len = Math.hypot(dx, dy);

            if (len > 1e-4) {
              const ux = dx / len;
              const uy = dy / len;
              const ext = (len / 2) * 1.25;
              const perpExt = Math.max(3.0, len * 0.25);

              const lineAlong: [number, number][] = [
                [mx - ux * ext, my - uy * ext],
                [mx + ux * ext, my + uy * ext],
              ];

              const linePerp: [number, number][] = [
                [mx + uy * perpExt, my - ux * perpExt],
                [mx - uy * perpExt, my + ux * perpExt],
              ];

              onEntitiesChange([
                ...entities,
                { type: 'polyline', layer: 'DETAILS', points: lineAlong, closed: false },
                { type: 'polyline', layer: 'DETAILS', points: linePerp, closed: false },
              ]);
            }
          } else {
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            for (const pt of target.points) {
              if (pt[0] < minX) minX = pt[0];
              if (pt[0] > maxX) maxX = pt[0];
              if (pt[1] < minY) minY = pt[1];
              if (pt[1] > maxY) maxY = pt[1];
            }

            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            const w = maxX - minX;
            const h = maxY - minY;

            const extX = Math.max(3.0, (w / 2) * 1.25);
            const extY = Math.max(3.0, (h / 2) * 1.25);

            onEntitiesChange([
              ...entities,
              { type: 'polyline', layer: 'DETAILS', points: [[cx - extX, cy], [cx + extX, cy]], closed: false },
              { type: 'polyline', layer: 'DETAILS', points: [[cx, cy - extY], [cx, cy + extY]], closed: false },
            ]);
          }
        }
      }
    } else if (selectedTool === 'cut') {
      const distanceScale = viewWidth / 300;
      let bestEntIdx = -1;
      let bestSegIdx = -1;
      let minD = 10.0 * distanceScale;
      let cutPt: [number, number] = [clickCoords.x, clickCoords.y];

      entities.forEach((ent, idx) => {
        if (ent.type === 'polyline' && ent.points && ent.points.length >= 2) {
          for (let i = 0; i < ent.points.length - 1; i++) {
            const p1 = ent.points[i];
            const p2 = ent.points[i + 1];
            const d = distToSegment(clickCoords.x, clickCoords.y, p1[0], p1[1], p2[0], p2[1]);
            if (d < minD) {
              minD = d;
              bestEntIdx = idx;
              bestSegIdx = i;
            }
          }
        }
      });

      if (bestEntIdx !== -1 && bestSegIdx !== -1) {
        const ent = entities[bestEntIdx];
        if (ent.points) {
          const poly1 = ent.points.slice(0, bestSegIdx + 1);
          poly1.push(cutPt);
          const poly2 = [cutPt, ...ent.points.slice(bestSegIdx + 1)];
          const newEnts = entities.filter((_, i) => i !== bestEntIdx);
          newEnts.push({ ...ent, points: poly1, closed: false });
          newEnts.push({ ...ent, points: poly2, closed: false });
          onEntitiesChange(newEnts);
        }
      }
    } else if (selectedTool === 'fuse') {
      handleFuseClick(clickCoords);
    } else if (selectedTool === 'arc') {
      if (arcStep === 0) {
        setArcStart(clickCoords);
        setArcStep(1);
      } else if (arcStep === 1) {
        setArcEnd(clickCoords);
        setArcStep(2);
      } else if (arcStep === 2) {
        if (arcStart && arcEnd) {
          const pts: [number, number][] = [];
          for (let i = 0; i <= 16; i++) {
            const t = i / 16;
            const x = (1 - t) ** 2 * arcStart.x + 2 * (1 - t) * t * clickCoords.x + t ** 2 * arcEnd.x;
            const y = (1 - t) ** 2 * arcStart.y + 2 * (1 - t) * t * clickCoords.y + t ** 2 * arcEnd.y;
            pts.push([x, y]);
          }
          onEntitiesChange([...entities, {
            type: 'polyline',
            layer: 'OUTER',
            points: pts,
            closed: false
          }]);
        }
        setArcStart(null);
        setArcEnd(null);
        setArcStep(0);
        onActiveDrawingChange?.(null);
      }
    } else if (selectedTool === 'delete') {
      const distanceScale = viewWidth / 300;
      const closest = findClosestEntity(clickCoords);
      if (closest.index !== -1 && closest.dist < 6.0 * distanceScale) {
        onEntitiesChange(entities.filter((_, i) => i !== closest.index));
      }
    } else if (selectedTool === 'mark-hole') {
      const distanceScale = viewWidth / 300;
      const closest = findClosestEntity(clickCoords);
      if (closest.index !== -1 && closest.dist < 6.0 * distanceScale) {
        const newEntities = [...entities];
        newEntities[closest.index] = {
          ...newEntities[closest.index],
          layer: newEntities[closest.index].layer === 'OUTER' ? 'HOLES' : 'OUTER',
        };
        onEntitiesChange(newEntities);
      }
    } else if (selectedTool === 'add-point') {
      handleAddPointClick(clickCoords);
    } else if (selectedTool === 'chamfer' || selectedTool === 'fillet') {
      handleFilletOrChamferClick(clickCoords, undefined, selectedTool);
    } else if (selectedTool === 'align') {
      const distanceScale = viewWidth / 300;
      if (!alignSelectedSegment) {
        let minDistance = Infinity;
        let closestSegment: {
          entityIdx: number;
          ptIdx1: number;
          ptIdx2: number;
          p1: [number, number];
          p2: [number, number];
        } | null = null;

        entities.forEach((entity, entityIdx) => {
          if (entity.type === 'polyline' && entity.points && entity.points.length >= 2) {
            const pts = entity.points;
            for (let i = 0; i < pts.length - 1; i++) {
              const d = distToSegment(clickCoords.x, clickCoords.y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
              if (d < minDistance) {
                minDistance = d;
                closestSegment = { entityIdx, ptIdx1: i, ptIdx2: i + 1, p1: pts[i], p2: pts[i+1] };
              }
            }
            if (entity.closed) {
              const lastIdx = pts.length - 1;
              const d = distToSegment(clickCoords.x, clickCoords.y, pts[lastIdx][0], pts[lastIdx][1], pts[0][0], pts[0][1]);
              if (d < minDistance) {
                minDistance = d;
                closestSegment = { entityIdx, ptIdx1: lastIdx, ptIdx2: 0, p1: pts[lastIdx], p2: pts[0] };
              }
            }
          }
        });

        if (closestSegment && minDistance < 15.0 * distanceScale) {
          setAlignSelectedSegment(closestSegment);
        }
      } else {
        const rect = svgRef.current?.getBoundingClientRect();
        if (rect) {
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;

          const dLeft = x;
          const dRight = rect.width - x;
          const dTop = y;
          const dBottom = rect.height - y;

          const minDist = Math.min(dLeft, dRight, dTop, dBottom);
          let targetOrientation: 'horizontal' | 'vertical' = 'horizontal';
          if (minDist === dLeft || minDist === dRight) {
            targetOrientation = 'vertical';
          } else {
            targetOrientation = 'horizontal';
          }

          const { p1, p2 } = alignSelectedSegment;
          const cx = (p1[0] + p2[0]) / 2;
          const cy = (p1[1] + p2[1]) / 2;

          const theta = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
          let targetTheta = 0;
          if (targetOrientation === 'horizontal') {
            targetTheta = Math.round(theta / Math.PI) * Math.PI;
          } else {
            targetTheta = Math.round((theta - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
          }

          const alpha = targetTheta - theta;

          const rotatePoint = (px: number, py: number): [number, number] => {
            const dx = px - cx;
            const dy = py - cy;
            const rx = cx + dx * Math.cos(alpha) - dy * Math.sin(alpha);
            const ry = cy + dx * Math.sin(alpha) + dy * Math.cos(alpha);
            return [rx, ry];
          };

          const rotatedEntities = entities.map(entity => {
            if (entity.type === 'circle' && entity.cx != null && entity.cy != null) {
              const [rx, ry] = rotatePoint(entity.cx, entity.cy);
              return {
                ...entity,
                cx: rx,
                cy: ry,
              };
            } else if (entity.type === 'polyline' && entity.points) {
              const rPts = entity.points.map(pt => rotatePoint(pt[0], pt[1]));
              return {
                ...entity,
                points: rPts,
              };
            }
            return entity;
          });

          if (onRotateWorkspace) {
            const angleDeg = alpha * (180 / Math.PI);
            onRotateWorkspace(rotatedEntities, angleDeg, cx, cy);
          } else {
            onEntitiesChange(rotatedEntities, true);
          }
          setAlignSelectedSegment(null);
        }
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    updateCursorFromEvent(e);

    const rawCoords = getModelCoords(e.clientX, e.clientY);
    if (rawCoords && onHoverCoord) {
      onHoverCoord(rawCoords);
    }

    
    if (activeDrag) {
      const rawCoords = getModelCoords(e.clientX, e.clientY);
      if (!rawCoords) return;

      let coords = rawCoords;
      const snapped = getSnappedCoords(e.clientX, e.clientY);
      if (snapped && activeDrag.type === 'vertex') {
        const targetEnt = entities[activeDrag.entityIdx];
        const selfPt = targetEnt.points?.[activeDrag.pointIdx!];
        if (selfPt && Math.hypot(selfPt[0] - snapped.x, selfPt[1] - snapped.y) < 1.0) {
          
        } else {
          coords = snapped;
        }
      }

      const newEntities = [...entities];
      const ent = { ...newEntities[activeDrag.entityIdx] };

      if (activeDrag.type === 'vertex' && ent.points && activeDrag.pointIdx !== undefined) {
        const newPoints = [...ent.points];
        newPoints[activeDrag.pointIdx] = [coords.x, coords.y];
        ent.points = newPoints;
        newEntities[activeDrag.entityIdx] = ent;
        onEntitiesChange(newEntities, false);
      } else if (activeDrag.type === 'center') {
        ent.cx = coords.x;
        ent.cy = coords.y;
        newEntities[activeDrag.entityIdx] = ent;
        onEntitiesChange(newEntities, false);
      } else if (activeDrag.type === 'radius' && ent.cx != null && ent.cy != null) {
        const newR = Math.max(0.5, Math.abs(coords.x - ent.cx));
        ent.r = newR;
        newEntities[activeDrag.entityIdx] = ent;
        onEntitiesChange(newEntities, false);
      }
      return;
    }

    if (selectionMarquee && isDragging && rawCoords) {
      const newMarquee = { start: selectionMarquee.start, end: rawCoords };
      setSelectionMarquee(newMarquee);

      const mMinX = Math.min(newMarquee.start.x, newMarquee.end.x);
      const mMaxX = Math.max(newMarquee.start.x, newMarquee.end.x);
      const mMinY = Math.min(newMarquee.start.y, newMarquee.end.y);
      const mMaxY = Math.max(newMarquee.start.y, newMarquee.end.y);

      if (mMaxX - mMinX > 0.5 || mMaxY - mMinY > 0.5) {
        const selected = findEntitiesInBox({ minX: mMinX, minY: mMinY, maxX: mMaxX, maxY: mMaxY }, entities);
        setSelectedEntityIndices(selected);
      }
      return;
    }

    if (transformMode && transformStart && rawCoords) {
      if (transformMode === 'translate') {
        const dx = rawCoords.x - transformStart.mouse.x;
        const dy = rawCoords.y - transformStart.mouse.y;
        const newEntities = [...entities];
        selectedEntityIndices.forEach((idx) => {
          const origEnt = transformStart.entities[idx];
          if (!origEnt) return;
          if (origEnt.type === 'circle' && origEnt.cx != null && origEnt.cy != null) {
            newEntities[idx] = { ...origEnt, cx: origEnt.cx + dx, cy: origEnt.cy + dy };
          } else if (origEnt.type === 'polyline' && origEnt.points) {
            newEntities[idx] = {
              ...origEnt,
              points: origEnt.points.map((p) => [p[0] + dx, p[1] + dy]),
            };
          }
        });
        onEntitiesChange(newEntities, false);
      } else if (transformMode === 'rotate') {
        const { cx, cy } = transformStart.center;
        const currentAngle = Math.atan2(rawCoords.y - cy, rawCoords.x - cx);
        const deltaRad = currentAngle - (transformStart.startAngle || 0);

        const cosA = Math.cos(deltaRad);
        const sinA = Math.sin(deltaRad);

        const newEntities = [...entities];
        selectedEntityIndices.forEach((idx) => {
          const origEnt = transformStart.entities[idx];
          if (!origEnt) return;
          if (origEnt.type === 'circle' && origEnt.cx != null && origEnt.cy != null) {
            const rx = origEnt.cx - cx;
            const ry = origEnt.cy - cy;
            const nx = cx + rx * cosA - ry * sinA;
            const ny = cy + rx * sinA + ry * cosA;
            newEntities[idx] = { ...origEnt, cx: nx, cy: ny };
          } else if (origEnt.type === 'polyline' && origEnt.points) {
            newEntities[idx] = {
              ...origEnt,
              points: origEnt.points.map((p) => {
                const rx = p[0] - cx;
                const ry = p[1] - cy;
                return [cx + rx * cosA - ry * sinA, cy + rx * sinA + ry * cosA];
              }),
            };
          }
        });
        onEntitiesChange(newEntities, false);
      } else if (transformMode.startsWith('scale')) {
        const { cx, cy, width: origW, height: origH } = transformStart.bbox;
        const origDistX = origW / 2;
        const origDistY = origH / 2;

        const currDistX = Math.abs(rawCoords.x - cx);
        const currDistY = Math.abs(rawCoords.y - cy);

        let scaleX = origDistX > 0.1 ? currDistX / origDistX : 1;
        let scaleY = origDistY > 0.1 ? currDistY / origDistY : 1;

        if (e.shiftKey) {
          const uniScale = (scaleX + scaleY) / 2;
          scaleX = uniScale;
          scaleY = uniScale;
        }

        const newEntities = [...entities];
        selectedEntityIndices.forEach((idx) => {
          const origEnt = transformStart.entities[idx];
          if (!origEnt) return;
          if (origEnt.type === 'circle' && origEnt.cx != null && origEnt.cy != null && origEnt.r != null) {
            const rx = origEnt.cx - cx;
            const ry = origEnt.cy - cy;
            const nx = cx + rx * scaleX;
            const ny = cy + ry * scaleY;
            const nr = Math.max(0.1, origEnt.r * ((scaleX + scaleY) / 2));
            newEntities[idx] = { ...origEnt, cx: nx, cy: ny, r: nr };
          } else if (origEnt.type === 'polyline' && origEnt.points) {
            newEntities[idx] = {
              ...origEnt,
              points: origEnt.points.map((p) => {
                const rx = p[0] - cx;
                const ry = p[1] - cy;
                return [cx + rx * scaleX, cy + ry * scaleY];
              }),
            };
          }
        });
        onEntitiesChange(newEntities, false);
      }
      return;
    }

    if (!isDragging) return;

    if (selectedTool === 'brush') {
      const coords = getModelCoords(e.clientX, e.clientY);
      if (coords) {
        const newEntities = applyBrushDeform(coords.x, coords.y, entities);
        onEntitiesChange(newEntities, false);
      }
      return;
    }
    
    if (selectedTool === 'subregion-select' && isDragging && subregionBox && rawCoords) {
      setSubregionBox({ start: subregionBox.start, end: rawCoords });
      return;
    }
    
    if (selectedTool === 'select' && !selectedEntityIndices.length) {
      const dx = e.clientX - lastPos.x;
      const dy = e.clientY - lastPos.y;
      if (svgRef.current) {
        const ctm = svgRef.current.getScreenCTM();
        if (ctm) {
          const inv = ctm.inverse();
          const dxMm = dx * inv.a;
          const dyMm = dy * inv.d;
          onViewportChange({
            x: viewX - dxMm,
            y: viewY - dyMm,
            w: viewWidth,
            h: viewHeight,
          });
        }
      }
      setLastPos({ x: e.clientX, y: e.clientY });
    } else if (selectedTool === 'measure' && measureStart) {
      const rawCoords = getModelCoords(e.clientX, e.clientY);
      if (rawCoords) {
        let coords = rawCoords;
        const snapped = getSnappedCoords(e.clientX, e.clientY);
        if (snapped) {
          coords = snapped;
        }
        setMeasureEnd(coords);
      }
    }
    if (rawCoords) {
      onHoverSourceChange?.('dxf');
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (activeDrag) {
      if (svgRef.current) {
        try {
          svgRef.current.releasePointerCapture(e.pointerId);
        } catch {}
      }
      setActiveDrag(null);
      onEntitiesChange(entities, true);
    }
    if (transformMode) {
      setTransformMode(null);
      setTransformStart(null);
      onEntitiesChange(entities, true);
    }
    if (selectionMarquee) {
      setSelectionMarquee(null);
    }
    if (selectedTool === 'subregion-select' && subregionBox) {
      const minX = Math.min(subregionBox.start.x, subregionBox.end.x);
      const maxX = Math.max(subregionBox.start.x, subregionBox.end.x);
      const minY = Math.min(subregionBox.start.y, subregionBox.end.y);
      const maxY = Math.max(subregionBox.start.y, subregionBox.end.y);
      if (maxX - minX > 1.0 && maxY - minY > 1.0) {
        onSubRegionSelect?.([minX, minY, maxX, maxY]);
      }
      setSubregionBox(null);
    }
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (selectedTool === 'brush') {
      onEntitiesChange(entities, true);
    }
  };

  const handlePointerLeave = () => {
    setIsDragging(false);
    setCursorMm(null);
    setSnapPoint(null);
    if (onHoverCoord) {
      onHoverCoord(null);
    }
    onHoverSourceChange?.(null);
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    if (selectedTool === 'brush' && e.shiftKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -1.0 : 1.0;
      const newRadius = Math.max(1.0, Math.min(150.0, brushRadius + delta));
      onBrushRadiusChange?.(newRadius);
      return;
    }

    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    if (svgRef.current) {
      const svg = svgRef.current;
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const transformed = pt.matrixTransform(ctm.inverse());

        const cx = transformed.x;
        const cy = transformed.y;

        const newW = Math.max(0.1, Math.min(5000, viewWidth / zoomFactor));
        const newH = Math.max(0.1, Math.min(5000, viewHeight / zoomFactor));

        const relX = (cx - viewX) / viewWidth;
        const relY = (cy - viewY) / viewHeight;

        const newX = cx - relX * newW;
        const newY = cy - relY * newH;

        onViewportChange({
          x: newX,
          y: newY,
          w: newW,
          h: newH,
        });
      }
    }
  };

  const handleDoubleClick = () => {
    if (selectedTool === 'polyline' && drawPoints.length > 1) {
      onEntitiesChange([...entities, {
        type: 'polyline',
        layer: 'OUTER',
        points: drawPoints,
        closed: true
      }]);
      setDrawPoints([]);
      onActiveDrawingChange?.(null);
    } else if (selectedTool === 'spline' && splinePoints.length >= 2) {
      let pts = [...splinePoints];
      if (pts.length > 2) {
        const last = pts[pts.length - 1];
        const prev = pts[pts.length - 2];
        if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) < 0.1) {
          pts = pts.slice(0, -1);
        }
      }
      if (pts.length >= 2) {
        const evaluated = evaluateSplinePoints(pts);
        onEntitiesChange([...entities, {
          type: 'polyline',
          layer: 'OUTER',
          points: evaluated,
          closed: false
        }]);
      }
      setSplinePoints([]);
      onActiveDrawingChange?.(null);
    }
  };

  
  const vRulerMin = -(viewY + viewHeight);
  const vRulerMax = -viewY;

  const currentZoomPercentage = Math.round((baseWidth / viewWidth) * 100);

  
  const distance = measureStart && measureEnd ? Math.hypot(measureEnd.x - measureStart.x, measureEnd.y - measureStart.y) : 0;
  const midX = measureStart && measureEnd ? (measureStart.x + measureEnd.x) / 2 : 0;
  const midY = measureStart && measureEnd ? (measureStart.y + measureEnd.y) / 2 : 0;

  const showGeometry = entities && entities.length > 0;

  return (
    <section className="panel dxf-panel">
      <div className="panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h2>DXF Preview</h2>
          <div style={{ display: 'flex', gap: '8px', fontSize: '11px', color: 'var(--muted)' }}>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <input type="checkbox" checked={outerLayerEnabled} onChange={(e) => setOuterLayerEnabled(e.target.checked)} /> OUTER
            </label>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <input type="checkbox" checked={holeLayerEnabled} onChange={(e) => setHoleLayerEnabled(e.target.checked)} /> HOLES
            </label>
            <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px' }}>
              <input type="checkbox" checked={detailsLayerEnabled} onChange={(e) => setDetailsLayerEnabled(e.target.checked)} /> DETAILS
            </label>
          </div>
        </div>
        <div className="mini-controls">
          <button onClick={onFitToView} title="Fit to view">Fit</button>
          <button onClick={onToggleGrid}>
            {gridEnabled ? 'Grid On' : 'Grid Off'}
          </button>
          <button onClick={onZoomIn} title="Zoom In">+</button>
          <button onClick={onZoomOut} title="Zoom Out">-</button>
        </div>
      </div>

      <div className="canvas-area">
        <div className="ruler-frame">
          <button className="ruler-corner" onClick={onFitToView} title="Reset zoom to fit">⤢</button>
          <Ruler orientation="horizontal" min={viewX} max={viewX + viewWidth} />
          <Ruler orientation="vertical" min={vRulerMin} max={vRulerMax} flip />

          <div className={`cad-preview ${gridEnabled ? 'with-grid' : ''}`}>
            <div className="viewport-label">
              {selectedTool === 'line' ? 'LINE TOOL · Click start & end' :
               selectedTool === 'polyline' ? 'POLYLINE TOOL · Click to add, double-click to close' :
               selectedTool === 'arc' ? `ARC TOOL · Click 3 points (${arcStep === 0 ? 'Start' : arcStep === 1 ? 'End' : 'Peak'})` :
               selectedTool === 'delete' ? 'DELETE TOOL · Click element to delete' :
               selectedTool === 'delete-point' ? 'DELETE POINT · Click red handle to delete vertex & bridge line' :
               selectedTool === 'mark-hole' ? 'MARK HOLE · Click element to toggle layer' :
               selectedTool === 'add-point' ? 'ADD POINT · Click segment to add vertex' :
               selectedTool === 'measure' ? 'MEASURE TOOL · Drag to measure distance' :
               selectedTool === 'select' ? 'SELECT TOOL · Click & drag nodes to edit geometry' :
               selectedTool === 'brush' ? `BRUSH TOOL · Drag to deform vertices outward (Shape: ${brushShape === 'circle' ? 'Ball' : 'Cube'}, Radius: ${brushRadius}mm)` :
               selectedTool === 'align' ? (alignSelectedSegment ? 'ALIGN TOOL · Click close to screen edge (top/bottom for horizontal, left/right for vertical)' : 'ALIGN TOOL · Click on a line segment to select it') :
               'MODEL SPACE · mm'}
            </div>

            {showGeometry ? (
              <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
                <canvas
                  ref={canvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                  }}
                />
                <svg
                  ref={svgRef}
                  viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`}
                  className="native-dxf"
                  role="img"
                  aria-label="Native DXF preview"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'transparent',
                    cursor: isDragging ? 'grabbing' : activeDrag ? 'move' : hoveredCoord ? 'none' : 'crosshair'
                  }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerLeave}
                  onDoubleClick={handleDoubleClick}
                  onWheel={handleWheel}
                >
                  {outerLayerEnabled && hasBounds && (
                    <g className="dimension-overlay" style={{ opacity: 0.6 }}>
                      <path d={`M ${bboxMinX} ${-bboxMaxY - 5} L ${bboxMinX + bboxWidth} ${-bboxMaxY - 5}`} stroke="var(--accent)" strokeWidth="0.5" strokeDasharray="2,2" fill="none" />
                      <text x={bboxMinX + bboxWidth / 2} y={-bboxMaxY - 7} fill="var(--accent)" fontSize="4" textAnchor="middle" className="tabular-nums">
                        {bboxWidth.toFixed(2)}
                      </text>
                      <path d={`M ${bboxMinX - 5} ${-bboxMaxY} L ${bboxMinX - 5} ${-bboxMaxY + bboxHeight}`} stroke="var(--accent)" strokeWidth="0.5" strokeDasharray="2,2" fill="none" />
                      <text x={bboxMinX - 7} y={-bboxMaxY + bboxHeight / 2} fill="var(--accent)" fontSize="4" textAnchor="middle" transform={`rotate(-90 ${bboxMinX - 7} ${-bboxMaxY + bboxHeight / 2})`} className="tabular-nums">
                        {bboxHeight.toFixed(2)}
                      </text>
                    </g>
                  )}
                  {(() => {
                    const distanceScale = viewWidth / 300;
                    const handleScale = distanceScale;
                    const visualRadius = 2.5 * distanceScale;
                    const grabRadius = visualRadius * 2.2;
                    const nodeStrokeWidth = visualRadius * 0.25;

                    return (
                      <g transform="scale(1, -1)">
                        {hoveredCoord && (() => {
                          const cursorColor = activeHoverSource === 'image' ? '#ff9800' : '#00e676';
                          return (
                            <g transform={`translate(${hoveredCoord.x}, ${hoveredCoord.y})`} style={{ pointerEvents: 'none' }}>
                              <circle r={visualRadius * 1.5} fill="none" stroke={cursorColor} strokeWidth={nodeStrokeWidth} />
                              <line x1={-visualRadius * 3} y1={0} x2={visualRadius * 3} y2={0} stroke={cursorColor} strokeWidth={nodeStrokeWidth} />
                              <line x1={0} y1={-visualRadius * 3} x2={0} y2={visualRadius * 3} stroke={cursorColor} strokeWidth={nodeStrokeWidth} />
                            </g>
                          );
                        })()}
                        {entities.map((entity, entityIdx) => {
                          const layer = entity.layer;
                          if (layer === 'HOLES' && !holeLayerEnabled) return null;
                          if (layer === 'OUTER' && !outerLayerEnabled) return null;
                          if (layer === 'DETAILS' && !detailsLayerEnabled) return null;

                          const isHole = layer === 'HOLES';
                          const isDetail = layer === 'DETAILS';
                          const isSelected = selectedEntityIndices.includes(entityIdx);
                          const color = isSelected ? 'var(--accent)' : isHole ? '#5b9bd5' : isDetail ? '#10b981' : '#ffffff';
                          const strokeWidth = isSelected ? nodeStrokeWidth * 2 : nodeStrokeWidth;

                          if (entity.type === 'circle' && entity.cx != null && entity.cy != null && entity.r != null) {
                            return (
                              <circle
                                key={`svg-ent-${entityIdx}`}
                                cx={entity.cx}
                                cy={entity.cy}
                                r={entity.r}
                                fill="none"
                                stroke={color}
                                strokeWidth={strokeWidth}
                              />
                            );
                          } else if (entity.type === 'polyline' && entity.points && entity.points.length > 0) {
                            const d = entity.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ') + (entity.closed ? ' Z' : '');
                            return (
                              <path
                                key={`svg-ent-${entityIdx}`}
                                d={d}
                                fill="none"
                                stroke={color}
                                strokeWidth={strokeWidth}
                              />
                            );
                          }
                          return null;
                        })}

                        {['select', 'delete-point', 'add-point', 'fillet', 'chamfer', 'fuse', 'cut', 'delete'].includes(selectedTool) && entities.map((entity, entityIdx) => {
                          const layer = entity.layer;
                          if (layer === 'HOLES' && !holeLayerEnabled) return null;
                          if (layer === 'OUTER' && !outerLayerEnabled) return null;
                          if (layer === 'DETAILS' && !detailsLayerEnabled) return null;

                          if (entity.type === 'circle' && entity.cx != null && entity.cy != null && entity.r != null) {
                            if (selectedTool === 'delete-point') return null;
                            const isCenterHovered = hoveredNode?.entityIdx === entityIdx && hoveredNode?.type === 'center';
                            const isRadiusHovered = hoveredNode?.entityIdx === entityIdx && hoveredNode?.type === 'radius';

                            return (
                              <g key={entityIdx}>
                                {isCenterHovered && (
                                  <circle
                                    cx={entity.cx}
                                    cy={entity.cy}
                                    r={visualRadius * 2.5}
                                    fill="none"
                                    stroke="#ffcc00"
                                    strokeWidth={nodeStrokeWidth * 1.5}
                                    style={{ pointerEvents: 'none' }}
                                  />
                                )}
                                <circle
                                  cx={entity.cx}
                                  cy={entity.cy}
                                  r={isCenterHovered ? visualRadius * 1.6 : visualRadius}
                                  fill={isCenterHovered ? '#ffcc00' : 'var(--accent)'}
                                  stroke="#ffffff"
                                  strokeWidth={isCenterHovered ? nodeStrokeWidth * 1.8 : nodeStrokeWidth}
                                  style={{ pointerEvents: 'none', transition: 'r 0.15s ease, fill 0.15s ease' }}
                                />
                                <circle
                                  cx={entity.cx}
                                  cy={entity.cy}
                                  r={grabRadius * 1.3}
                                  fill="transparent"
                                  style={{ cursor: 'move', pointerEvents: 'all' }}
                                  onPointerDown={(e) => handleCircleCenterDragStart(e, entityIdx)}
                                  onPointerUp={handleHandlePointerUp}
                                />

                                {isRadiusHovered && (
                                  <circle
                                    cx={entity.cx + entity.r}
                                    cy={entity.cy}
                                    r={visualRadius * 2.5}
                                    fill="none"
                                    stroke="#ffcc00"
                                    strokeWidth={nodeStrokeWidth * 1.5}
                                    style={{ pointerEvents: 'none' }}
                                  />
                                )}
                                <circle
                                  cx={entity.cx + entity.r}
                                  cy={entity.cy}
                                  r={isRadiusHovered ? visualRadius * 1.6 : visualRadius}
                                  fill={isRadiusHovered ? '#ffcc00' : '#ffcc00'}
                                  stroke="#ffffff"
                                  strokeWidth={isRadiusHovered ? nodeStrokeWidth * 1.8 : nodeStrokeWidth}
                                  style={{ pointerEvents: 'none', transition: 'r 0.15s ease, fill 0.15s ease' }}
                                />
                                <circle
                                  cx={entity.cx + entity.r}
                                  cy={entity.cy}
                                  r={grabRadius * 1.3}
                                  fill="transparent"
                                  style={{ cursor: 'ew-resize', pointerEvents: 'all' }}
                                  onPointerDown={(e) => handleCircleRadiusDragStart(e, entityIdx)}
                                  onPointerUp={handleHandlePointerUp}
                                />
                              </g>
                            );
                          } else if (entity.type === 'polyline' && entity.points) {
                            return (
                              <g key={entityIdx}>
                                {entity.points.map((pt, ptIdx) => {
                                  const isVertexHovered = hoveredNode?.entityIdx === entityIdx && hoveredNode?.type === 'vertex' && hoveredNode?.ptIdx === ptIdx;

                                  let nodeColor = 'var(--accent)';
                                  if (selectedTool === 'delete-point' || selectedTool === 'delete') nodeColor = '#ff3b30';
                                  else if (selectedTool === 'fillet') nodeColor = '#00e676';
                                  else if (selectedTool === 'chamfer') nodeColor = '#ff9800';
                                  else if (selectedTool === 'fuse') nodeColor = '#00bcd4';
                                  else if (selectedTool === 'add-point') nodeColor = '#2196f3';
                                  if (isVertexHovered) nodeColor = '#ffcc00';

                                  return (
                                    <g key={ptIdx}>
                                      <circle
                                        cx={pt[0]}
                                        cy={pt[1]}
                                        r={isVertexHovered ? visualRadius * 2.0 : visualRadius * 1.2}
                                        fill={nodeColor}
                                        stroke="#ffffff"
                                        strokeWidth={isVertexHovered ? nodeStrokeWidth * 2.0 : nodeStrokeWidth * 1.2}
                                        style={{ pointerEvents: 'none', transition: 'r 0.15s ease, fill 0.15s ease' }}
                                      />
                                      {isVertexHovered && (
                                        <circle
                                          cx={pt[0]}
                                          cy={pt[1]}
                                          r={visualRadius * 3.0}
                                          fill="none"
                                          stroke="#ffcc00"
                                          strokeWidth={nodeStrokeWidth * 2.0}
                                          strokeDasharray={`${nodeStrokeWidth * 2},${nodeStrokeWidth * 2}`}
                                          style={{ pointerEvents: 'none' }}
                                        />
                                      )}
                                      <circle
                                        cx={pt[0]}
                                        cy={pt[1]}
                                        r={grabRadius * 1.5}
                                        fill="transparent"
                                        style={{ cursor: 'pointer', pointerEvents: 'all' }}
                                        onPointerDown={(e) => handleVertexPointerDown(e, entityIdx, ptIdx)}
                                        onPointerUp={handleHandlePointerUp}
                                      />
                                    </g>
                                  );
                                })}
                              </g>
                            );
                          }
                          return null;
                        })}

                        {/* Live 2-Point Fillet/Chamfer Preview */}
                        {(selectedTool === 'fillet' || selectedTool === 'chamfer') && cadToolSelectedPoints.length === 1 && (cursorMm || hoveredNode) && (() => {
                          const p1 = cadToolSelectedPoints[0];
                          const ent = entities[p1.entityIdx];
                          if (!ent || !ent.points) return null;

                          const pts = ent.points;
                          const n = pts.length;

                          let seg1 = p1.segIdx;
                          if (seg1 == null && p1.ptIdx != null) {
                            seg1 = Math.max(0, Math.min(n - 2, p1.ptIdx > 0 ? p1.ptIdx - 1 : 0));
                          }

                          let targetPt: [number, number] = cursorMm ? [cursorMm.x, cursorMm.y] : p1.pt;
                          let seg2: number | undefined = hoveredNode?.ptIdx != null ? Math.max(0, Math.min(n - 2, hoveredNode.ptIdx > 0 ? hoveredNode.ptIdx - 1 : 0)) : undefined;

                          if (seg2 == null && cursorMm) {
                            let minD = Infinity;
                            for (let i = 0; i < n - 1; i++) {
                              const d = distToSegment(cursorMm.x, cursorMm.y, pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
                              if (d < minD) {
                                minD = d;
                                seg2 = i;
                              }
                            }
                          }
                          if (seg1 == null || seg2 == null || seg1 === seg2) return null;

                          const minSeg = Math.min(seg1, seg2);
                          const maxSeg = Math.max(seg1, seg2);

                          const startPt = minSeg === seg1 ? p1.pt : targetPt;
                          const endPt = minSeg === seg1 ? targetPt : p1.pt;
                          if (!startPt || !endPt || startPt[0] == null || endPt[0] == null) return null;

                          let cornerPt: [number, number] = pts[minSeg + 1] ?? startPt;
                          let maxDist = -1;
                          for (let k = minSeg + 1; k <= maxSeg; k++) {
                            const v = pts[k];
                            if (!v || v[0] == null) continue;
                            const d = distToSegment(v[0], v[1], startPt[0], startPt[1], endPt[0], endPt[1]);
                            if (d > maxDist) {
                              maxDist = d;
                              cornerPt = v;
                            }
                          }

                          const color = selectedTool === 'fillet' ? '#00e676' : '#ff9800';

                          if (selectedTool === 'chamfer') {
                            return (
                              <g style={{ pointerEvents: 'none' }}>
                                <line
                                  x1={startPt[0]}
                                  y1={startPt[1]}
                                  x2={endPt[0]}
                                  y2={endPt[1]}
                                  stroke={color}
                                  strokeWidth={nodeStrokeWidth * 3}
                                  strokeDasharray={`${nodeStrokeWidth * 2},${nodeStrokeWidth * 2}`}
                                />
                                <circle cx={startPt[0]} cy={startPt[1]} r={visualRadius * 1.6} fill={color} />
                                <circle cx={endPt[0]} cy={endPt[1]} r={visualRadius * 1.6} fill={color} />
                              </g>
                            );
                          } else {
                            const res = computeFilletBetweenTwoPoints(startPt, endPt, cornerPt, 16);
                            if (!res || res.arcPts.length === 0) {
                              return (
                                <g style={{ pointerEvents: 'none' }}>
                                  <line x1={startPt[0]} y1={startPt[1]} x2={endPt[0]} y2={endPt[1]} stroke={color} strokeWidth={nodeStrokeWidth * 3} strokeDasharray={`${nodeStrokeWidth * 2},${nodeStrokeWidth * 2}`} />
                                  <circle cx={startPt[0]} cy={startPt[1]} r={visualRadius * 1.6} fill={color} />
                                  <circle cx={endPt[0]} cy={endPt[1]} r={visualRadius * 1.6} fill={color} />
                                </g>
                              );
                            }
                            const dStr = `M ${res.pStart[0]} ${res.pStart[1]} ` + res.arcPts.map(p => `L ${p[0]} ${p[1]}`).join(' ') + ` L ${res.pEnd[0]} ${res.pEnd[1]}`;
                            return (
                              <g style={{ pointerEvents: 'none' }}>
                                <path d={dStr} fill="none" stroke={color} strokeWidth={nodeStrokeWidth * 3} strokeDasharray={`${nodeStrokeWidth * 2},${nodeStrokeWidth * 2}`} />
                                <circle cx={res.pStart[0]} cy={res.pStart[1]} r={visualRadius * 1.6} fill={color} />
                                <circle cx={res.pEnd[0]} cy={res.pEnd[1]} r={visualRadius * 1.6} fill={color} />
                              </g>
                            );
                          }
                        })()}

                        {/* Live Fuse Preview */}
                        {selectedTool === 'fuse' && cursorMm && (() => {
                          const distanceScale = viewWidth / 300;
                          let closestPts: Array<{ entIdx: number; ptIdx: number; pt: [number, number]; dist: number }> = [];
                          entities.forEach((ent, entIdx) => {
                            if (ent.type === 'polyline' && ent.points) {
                              ent.points.forEach((pt, ptIdx) => {
                                const d = Math.hypot(cursorMm.x - pt[0], cursorMm.y - pt[1]);
                                if (d < 25.0 * distanceScale) {
                                  closestPts.push({ entIdx, ptIdx, pt, dist: d });
                                }
                              });
                            }
                          });
                          closestPts.sort((a, b) => a.dist - b.dist);
                          if (closestPts.length < 2) return null;
                          const p1 = closestPts[0];
                          const p2 = closestPts[1];
                          const mid: [number, number] = [(p1.pt[0] + p2.pt[0]) / 2, (p1.pt[1] + p2.pt[1]) / 2];

                          return (
                            <g style={{ pointerEvents: 'none' }}>
                              <line
                                x1={p1.pt[0]}
                                y1={p1.pt[1]}
                                x2={p2.pt[0]}
                                y2={p2.pt[1]}
                                stroke="#00bcd4"
                                strokeWidth={nodeStrokeWidth * 3}
                                strokeDasharray={`${nodeStrokeWidth * 2},${nodeStrokeWidth * 2}`}
                              />
                              <circle cx={p1.pt[0]} cy={p1.pt[1]} r={visualRadius * 1.8} fill="none" stroke="#00bcd4" strokeWidth={nodeStrokeWidth * 2} />
                              <circle cx={p2.pt[0]} cy={p2.pt[1]} r={visualRadius * 1.8} fill="none" stroke="#00bcd4" strokeWidth={nodeStrokeWidth * 2} />
                              <circle cx={mid[0]} cy={mid[1]} r={visualRadius * 1.4} fill="#00bcd4" />
                            </g>
                          );
                        })()}

                        {measureStart && measureEnd && (() => {
                          const distance = Math.hypot(measureEnd.x - measureStart.x, measureEnd.y - measureStart.y);
                          const midX = (measureStart.x + measureEnd.x) / 2;
                          const midY = (measureStart.y + measureEnd.y) / 2;
                          const textScale = Math.max(0.005, viewWidth / 150);
                          const boxW = 32 * textScale;
                          const boxH = 6 * textScale;
                          return (
                            <g className="measure-overlay">
                              <line
                                x1={measureStart.x}
                                y1={measureStart.y}
                                x2={measureEnd.x}
                                y2={measureEnd.y}
                                stroke="var(--accent)"
                                strokeWidth={0.6 * handleScale}
                                strokeDasharray={`${2 * handleScale},${2 * handleScale}`}
                              />
                              <circle cx={measureStart.x} cy={measureStart.y} r={1.5 * handleScale} fill="none" stroke="var(--accent)" strokeWidth={0.4 * handleScale} />
                              <circle cx={measureEnd.x} cy={measureEnd.y} r={1.5 * handleScale} fill="none" stroke="var(--accent)" strokeWidth={0.4 * handleScale} />

                              <g transform={`translate(${midX}, ${midY}) scale(1, -1)`}>
                                <rect
                                  x={-boxW / 2}
                                  y={-boxH / 2}
                                  width={boxW}
                                  height={boxH}
                                  fill="var(--panel)"
                                  stroke="var(--accent)"
                                  strokeWidth={0.4 * handleScale}
                                  rx={1 * textScale}
                                />
                                <text
                                  x="0"
                                  y={0.2 * textScale}
                                  fill="var(--accent)"
                                  fontSize={4.2 * textScale}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  fontWeight="bold"
                                  className="tabular-nums"
                                >
                                  {distance.toFixed(2)} mm
                                </text>
                              </g>
                            </g>
                          );
                        })()}
                        {snapPoint && (
                          <rect
                            x={snapPoint.x - 1.2 * handleScale}
                            y={snapPoint.y - 1.2 * handleScale}
                            width={2.4 * handleScale}
                            height={2.4 * handleScale}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth={0.4 * handleScale}
                          />
                        )}

                        {alignSelectedSegment && (
                          <line
                            x1={alignSelectedSegment.p1[0]}
                            y1={alignSelectedSegment.p1[1]}
                            x2={alignSelectedSegment.p2[0]}
                            y2={alignSelectedSegment.p2[1]}
                            stroke="#ff9f0a"
                            strokeWidth={2.5 * handleScale}
                            strokeLinecap="round"
                            opacity="0.85"
                          />
                        )}

                        {selectedTool === 'brush' && cursorMm && (
                          <g style={{ opacity: 0.85 }}>
                            {brushShape === 'circle' ? (
                              <circle
                                cx={cursorMm.x}
                                cy={cursorMm.y}
                                r={brushRadius}
                                fill="var(--accent-soft)"
                                style={{ pointerEvents: 'none' }}
                              />
                            ) : (
                              <rect
                                x={cursorMm.x - brushRadius}
                                y={cursorMm.y - brushRadius}
                                width={2 * brushRadius}
                                height={2 * brushRadius}
                                fill="var(--accent-soft)"
                                style={{ pointerEvents: 'none' }}
                              />
                            )}
                          </g>
                        )}

                        {drawPoints.length > 0 && (
                          <polyline
                            points={drawPoints.map(p => `${p[0]},${p[1]}`).join(' ')}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth={0.8 * handleScale}
                          />
                        )}
                        {drawPoints.length > 0 && cursorMm && (
                          <line
                            x1={drawPoints[drawPoints.length - 1][0]}
                            y1={drawPoints[drawPoints.length - 1][1]}
                            x2={cursorMm.x}
                            y2={cursorMm.y}
                            stroke="var(--accent)"
                            strokeWidth={0.8 * handleScale}
                          />
                        )}

                        {rect3PtPoints.length === 1 && cursorMm && (
                          <line
                            x1={rect3PtPoints[0][0]}
                            y1={rect3PtPoints[0][1]}
                            x2={cursorMm.x}
                            y2={cursorMm.y}
                            stroke="var(--accent)"
                            strokeWidth={0.8 * handleScale}
                          />
                        )}

                        {slot4PtPoints.length === 1 && cursorMm && (
                          <line
                            x1={slot4PtPoints[0][0]}
                            y1={slot4PtPoints[0][1]}
                            x2={cursorMm.x}
                            y2={cursorMm.y}
                            stroke="var(--accent)"
                            strokeWidth={0.8 * handleScale}
                          />
                        )}
                        {slot4PtPoints.length === 2 && cursorMm && (
                          <path
                            d={(() => {
                              const p1 = slot4PtPoints[0];
                              const p2 = slot4PtPoints[1];
                              const p3: [number, number] = [cursorMm.x, cursorMm.y];
                              const dx = p2[0] - p1[0];
                              const dy = p2[1] - p1[1];
                              const len = Math.hypot(dx, dy);
                              if (len < 0.001) return '';
                              const nx = -dy / len;
                              const ny = dx / len;
                              const r = Math.abs((p3[0] - p1[0]) * nx + (p3[1] - p1[1]) * ny);
                              const pts: [number, number][] = [];
                              for (let i = 0; i <= 8; i++) {
                                const ang = -(Math.PI / 2) + (i / 8) * Math.PI;
                                const ax = Math.atan2(dy, dx);
                                pts.push([p2[0] + r * Math.cos(ax + ang), p2[1] + r * Math.sin(ax + ang)]);
                              }
                              for (let i = 0; i <= 8; i++) {
                                const ang = (Math.PI / 2) + (i / 8) * Math.PI;
                                const ax = Math.atan2(dy, dx);
                                pts.push([p1[0] + r * Math.cos(ax + ang), p1[1] + r * Math.sin(ax + ang)]);
                              }
                              return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ') + ' Z';
                            })()}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth={0.8 * handleScale}
                          />
                        )}
                        {rect3PtPoints.length === 2 && cursorMm && (
                          <path
                            d={(() => {
                              const p1 = rect3PtPoints[0];
                              const p2 = rect3PtPoints[1];
                              const dx = p2[0] - p1[0];
                              const dy = p2[1] - p1[1];
                              const len = Math.hypot(dx, dy);
                              if (len < 0.001) return '';
                              const nx = -dy / len;
                              const ny = dx / len;
                              const h = (cursorMm.x - p1[0]) * nx + (cursorMm.y - p1[1]) * ny;
                              const p4 = [p2[0] + h * nx, p2[1] + h * ny];
                              const p5 = [p1[0] + h * nx, p1[1] + h * ny];
                              return `M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} L ${p4[0]} ${p4[1]} L ${p5[0]} ${p5[1]} Z`;
                            })()}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth={0.8 * handleScale}
                          />
                        )}

                        {/* 2-Step Fuse Selection Indicator */}
                        {selectedTool === 'fuse' && cadToolSelectedPoints.length === 1 && (() => {
                          const p1 = cadToolSelectedPoints[0];
                          return (
                            <g style={{ pointerEvents: 'none' }}>
                              <circle cx={p1.pt[0]} cy={p1.pt[1]} r={visualRadius * 3.0} fill="none" stroke="#00bcd4" strokeWidth={nodeStrokeWidth * 2.5} />
                              <circle cx={p1.pt[0]} cy={p1.pt[1]} r={visualRadius * 1.5} fill="#00bcd4" />
                              {cursorMm && (
                                <line
                                  x1={p1.pt[0]}
                                  y1={p1.pt[1]}
                                  x2={cursorMm.x}
                                  y2={cursorMm.y}
                                  stroke="#00bcd4"
                                  strokeWidth={nodeStrokeWidth * 2}
                                  strokeDasharray={`${nodeStrokeWidth * 2},${nodeStrokeWidth * 2}`}
                                />
                              )}
                            </g>
                          );
                        })()}

                        {/* 2-Step Fillet/Chamfer Selection Indicator */}
                        {(selectedTool === 'fillet' || selectedTool === 'chamfer') && cadToolSelectedPoints.length === 1 && (() => {
                          const target = cadToolSelectedPoints[0];
                          const color = selectedTool === 'fillet' ? '#00e676' : '#ff9800';
                          return (
                            <g style={{ pointerEvents: 'none' }}>
                              <circle cx={target.pt[0]} cy={target.pt[1]} r={visualRadius * 3.0} fill="none" stroke={color} strokeWidth={nodeStrokeWidth * 2.5} />
                              <circle cx={target.pt[0]} cy={target.pt[1]} r={visualRadius * 1.5} fill={color} />
                              {cursorMm && (
                                <line
                                  x1={target.pt[0]}
                                  y1={target.pt[1]}
                                  x2={cursorMm.x}
                                  y2={cursorMm.y}
                                  stroke={color}
                                  strokeWidth={nodeStrokeWidth * 2}
                                  strokeDasharray={`${nodeStrokeWidth * 2},${nodeStrokeWidth * 2}`}
                                />
                              )}
                            </g>
                          );
                        })()}

                        {circle3PtPoints.length > 0 && (
                          <polyline
                            points={circle3PtPoints.map(p => `${p[0]},${p[1]}`).join(' ')}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth={0.8 * handleScale}
                          />
                        )}
                        {circle3PtPoints.length === 2 && cursorMm && (
                          <path
                            d={(() => {
                              const circle = computeCircumcircle(circle3PtPoints[0], circle3PtPoints[1], [cursorMm.x, cursorMm.y]);
                              if (!circle) return '';
                              return `M ${circle.cx + circle.r} ${circle.cy} A ${circle.r} ${circle.r} 0 1 0 ${circle.cx - circle.r} ${circle.cy} A ${circle.r} ${circle.r} 0 1 0 ${circle.cx + circle.r} ${circle.cy}`;
                            })()}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth={0.8 * handleScale}
                          />
                        )}

                        {splinePoints.length > 0 && (
                          <polyline
                            points={evaluateSplinePoints(cursorMm ? [...splinePoints, [cursorMm.x, cursorMm.y]] : splinePoints).map(p => `${p[0]},${p[1]}`).join(' ')}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth={0.8 * handleScale}
                          />
                        )}

                        {selectionMarquee && (() => {
                          const mMinX = Math.min(selectionMarquee.start.x, selectionMarquee.end.x);
                          const mMaxX = Math.max(selectionMarquee.start.x, selectionMarquee.end.x);
                          const mMinY = Math.min(selectionMarquee.start.y, selectionMarquee.end.y);
                          const mMaxY = Math.max(selectionMarquee.start.y, selectionMarquee.end.y);
                          return (
                            <rect
                              x={mMinX}
                              y={mMinY}
                              width={mMaxX - mMinX}
                              height={mMaxY - mMinY}
                              fill="var(--accent-soft)"
                              stroke="var(--accent)"
                              strokeWidth={1.2 * handleScale}
                              strokeDasharray="4,4"
                            />
                          );
                        })()}

                        {selectedEntityIndices.length > 0 && (() => {
                          const bbox = computeBoundingBoxForIndices(selectedEntityIndices, entities);
                          if (!bbox) return null;
                          const { minX, minY, maxX, maxY, cx, cy, width, height } = bbox;
                          const rotStemY = maxY + 18 * handleScale;
                          const cornerR = 5 * handleScale;

                          return (
                            <g style={{ pointerEvents: 'auto' }}>
                              <rect
                                x={minX}
                                y={minY}
                                width={width}
                                height={height}
                                fill="rgba(227, 148, 64, 0.05)"
                                stroke="var(--accent)"
                                strokeWidth={1.2 * handleScale}
                                strokeDasharray="5,5"
                                style={{ cursor: 'move' }}
                              />

                              <line
                                x1={cx}
                                y1={maxY}
                                x2={cx}
                                y2={rotStemY}
                                stroke="var(--accent)"
                                strokeWidth={1.2 * handleScale}
                              />
                              <circle
                                cx={cx}
                                cy={rotStemY}
                                r={cornerR * 1.2}
                                fill="var(--accent)"
                                stroke="var(--panel-dark)"
                                strokeWidth={1.5 * handleScale}
                                style={{ cursor: 'grab' }}
                              />

                              <circle cx={cx} cy={cy} r={2.5 * handleScale} fill="var(--accent)" />

                              <rect x={minX - cornerR} y={maxY - cornerR} width={cornerR * 2} height={cornerR * 2} fill="var(--panel-header)" stroke="var(--accent)" strokeWidth={1.5 * handleScale} style={{ cursor: 'nwse-resize' }} />
                              <rect x={maxX - cornerR} y={maxY - cornerR} width={cornerR * 2} height={cornerR * 2} fill="var(--panel-header)" stroke="var(--accent)" strokeWidth={1.5 * handleScale} style={{ cursor: 'nesw-resize' }} />
                              <rect x={minX - cornerR} y={minY - cornerR} width={cornerR * 2} height={cornerR * 2} fill="var(--panel-header)" stroke="var(--accent)" strokeWidth={1.5 * handleScale} style={{ cursor: 'nesw-resize' }} />
                              <rect x={maxX - cornerR} y={minY - cornerR} width={cornerR * 2} height={cornerR * 2} fill="var(--panel-header)" stroke="var(--accent)" strokeWidth={1.5 * handleScale} style={{ cursor: 'nwse-resize' }} />
                            </g>
                          );
                        })()}

                        {arcStart && arcEnd && cursorMm && (
                          <path
                            d={(() => {
                              const pts: [number, number][] = [];
                              for (let i = 0; i <= 16; i++) {
                                const t = i / 16;
                                const x = (1 - t) ** 2 * arcStart.x + 2 * (1 - t) * t * cursorMm.x + t ** 2 * arcEnd.x;
                                const y = (1 - t) ** 2 * arcStart.y + 2 * (1 - t) * t * cursorMm.y + t ** 2 * arcEnd.y;
                                pts.push([x, y]);
                              }
                              return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ');
                            })()}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth={0.6 * handleScale}
                          />
                        )}

                  {alignSelectedSegment && (
                    <line
                      x1={alignSelectedSegment.p1[0]}
                      y1={alignSelectedSegment.p1[1]}
                      x2={alignSelectedSegment.p2[0]}
                      y2={alignSelectedSegment.p2[1]}
                      stroke="#ff9f0a"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      opacity="0.85"
                    />
                  )}

                  {}
                  {selectedTool === 'brush' && cursorMm && (
                    <g style={{ opacity: 0.85 }}>
                      {brushShape === 'circle' ? (
                        <circle
                          cx={cursorMm.x}
                          cy={cursorMm.y}
                          r={brushRadius}
                          fill="var(--accent-soft)"
                          style={{ pointerEvents: 'none' }}
                        />
                      ) : (
                        <rect
                          x={cursorMm.x - brushRadius}
                          y={cursorMm.y - brushRadius}
                          width={2 * brushRadius}
                          height={2 * brushRadius}
                          fill="var(--accent-soft)"
                          style={{ pointerEvents: 'none' }}
                        />
                      )}
                    </g>
                  )}

                  {}
                  {drawPoints.length > 0 && (
                    <polyline
                      points={drawPoints.map(p => `${p[0]},${p[1]}`).join(' ')}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={0.8 * handleScale}
                    />
                  )}
                  {drawPoints.length > 0 && cursorMm && (
                    <line
                      x1={drawPoints[drawPoints.length - 1][0]}
                      y1={drawPoints[drawPoints.length - 1][1]}
                      x2={cursorMm.x}
                      y2={cursorMm.y}
                      stroke="var(--accent)"
                      strokeWidth={0.8 * handleScale}
                    />
                  )}

                  {rect3PtPoints.length === 1 && cursorMm && (
                    <line
                      x1={rect3PtPoints[0][0]}
                      y1={rect3PtPoints[0][1]}
                      x2={cursorMm.x}
                      y2={cursorMm.y}
                      stroke="var(--accent)"
                      strokeWidth={0.8 * handleScale}
                    />
                  )}

                  {slot4PtPoints.length === 1 && cursorMm && (
                    <line
                      x1={slot4PtPoints[0][0]}
                      y1={slot4PtPoints[0][1]}
                      x2={cursorMm.x}
                      y2={cursorMm.y}
                      stroke="var(--accent)"
                      strokeWidth={0.8 * handleScale}
                    />
                  )}
                  {slot4PtPoints.length === 2 && cursorMm && (
                    <path
                      d={(() => {
                        const p1 = slot4PtPoints[0];
                        const p2 = slot4PtPoints[1];
                        const p3: [number, number] = [cursorMm.x, cursorMm.y];
                        const dx = p2[0] - p1[0];
                        const dy = p2[1] - p1[1];
                        const len = Math.hypot(dx, dy);
                        if (len < 0.001) return '';
                        const nx = -dy / len;
                        const ny = dx / len;
                        const r = Math.abs((p3[0] - p1[0]) * nx + (p3[1] - p1[1]) * ny);
                        const pts: [number, number][] = [];
                        for (let i = 0; i <= 8; i++) {
                          const ang = -(Math.PI / 2) + (i / 8) * Math.PI;
                          const ax = Math.atan2(dy, dx);
                          pts.push([p2[0] + r * Math.cos(ax + ang), p2[1] + r * Math.sin(ax + ang)]);
                        }
                        for (let i = 0; i <= 8; i++) {
                          const ang = (Math.PI / 2) + (i / 8) * Math.PI;
                          const ax = Math.atan2(dy, dx);
                          pts.push([p1[0] + r * Math.cos(ax + ang), p1[1] + r * Math.sin(ax + ang)]);
                        }
                        return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ') + ' Z';
                      })()}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={0.8 * handleScale}
                    />
                  )}
                  {rect3PtPoints.length === 2 && cursorMm && (
                    <path
                      d={(() => {
                        const p1 = rect3PtPoints[0];
                        const p2 = rect3PtPoints[1];
                        const dx = p2[0] - p1[0];
                        const dy = p2[1] - p1[1];
                        const len = Math.hypot(dx, dy);
                        if (len < 0.001) return '';
                        const nx = -dy / len;
                        const ny = dx / len;
                        const h = (cursorMm.x - p1[0]) * nx + (cursorMm.y - p1[1]) * ny;
                        const p4 = [p2[0] + h * nx, p2[1] + h * ny];
                        const p5 = [p1[0] + h * nx, p1[1] + h * ny];
                        return `M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} L ${p4[0]} ${p4[1]} L ${p5[0]} ${p5[1]} Z`;
                      })()}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={0.8 * handleScale}
                    />
                  )}

                  {circle3PtPoints.length > 0 && (
                    <polyline
                      points={circle3PtPoints.map(p => `${p[0]},${p[1]}`).join(' ')}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={0.8 * handleScale}
                    />
                  )}
                  {circle3PtPoints.length === 2 && cursorMm && (
                    <path
                      d={(() => {
                        const circle = computeCircumcircle(circle3PtPoints[0], circle3PtPoints[1], [cursorMm.x, cursorMm.y]);
                        if (!circle) return '';
                        return `M ${circle.cx + circle.r} ${circle.cy} A ${circle.r} ${circle.r} 0 1 0 ${circle.cx - circle.r} ${circle.cy} A ${circle.r} ${circle.r} 0 1 0 ${circle.cx + circle.r} ${circle.cy}`;
                      })()}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={0.8 * handleScale}
                    />
                  )}

                  {splinePoints.length > 0 && (
                    <polyline
                      points={evaluateSplinePoints(cursorMm ? [...splinePoints, [cursorMm.x, cursorMm.y]] : splinePoints).map(p => `${p[0]},${p[1]}`).join(' ')}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={0.8 * handleScale}
                    />
                  )}

                  {subregionBox && (
                    <rect
                      x={Math.min(subregionBox.start.x, subregionBox.end.x)}
                      y={Math.min(subregionBox.start.y, subregionBox.end.y)}
                      width={Math.abs(subregionBox.end.x - subregionBox.start.x)}
                      height={Math.abs(subregionBox.end.y - subregionBox.start.y)}
                      fill="rgba(255, 152, 0, 0.15)"
                      stroke="#ff9800"
                      strokeWidth={1.2 * handleScale}
                      strokeDasharray="4,4"
                    />
                  )}

                  {arcStart && arcEnd && cursorMm && (
                    <path
                      d={(() => {
                        const pts: [number, number][] = [];
                        for (let i = 0; i <= 16; i++) {
                          const t = i / 16;
                          const x = (1 - t) ** 2 * arcStart.x + 2 * (1 - t) * t * cursorMm.x + t ** 2 * arcEnd.x;
                          const y = (1 - t) ** 2 * arcStart.y + 2 * (1 - t) * t * cursorMm.y + t ** 2 * arcEnd.y;
                          pts.push([x, y]);
                        }
                        return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ');
                      })()}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="0.6"
                      strokeDasharray="2,2"
                    />
                  )}
                  {arcStart && arcStep === 1 && cursorMm && (
                    <line
                      x1={arcStart.x}
                      y1={arcStart.y}
                      x2={cursorMm.x}
                      y2={cursorMm.y}
                      stroke="var(--accent)"
                      strokeWidth="0.5"
                      strokeDasharray="2,2"
                    />
                  )}

                  {}
                  {measureStart && measureEnd && (
                    <g className="measure-overlay">
                      <line
                        x1={measureStart.x}
                        y1={measureStart.y}
                        x2={measureEnd.x}
                        y2={measureEnd.y}
                        stroke="var(--accent)"
                        strokeWidth="0.6"
                        strokeDasharray="2,2"
                      />
                      <circle cx={measureStart.x} cy={measureStart.y} r="1.5" fill="none" stroke="var(--accent)" strokeWidth="0.5" />
                      <circle cx={measureEnd.x} cy={measureEnd.y} r="1.5" fill="none" stroke="var(--accent)" strokeWidth="0.5" />

                      <g transform={`translate(${midX}, ${midY}) scale(1, -1)`}>
                        <rect
                          x="-20"
                          y="-3.5"
                          width="40"
                          height="7"
                          fill="var(--panel)"
                          stroke="var(--accent)"
                          strokeWidth="0.4"
                          rx="1"
                        />
                        <text
                          x="0"
                          y="1.2"
                          fill="var(--accent)"
                          fontSize="4.2"
                          textAnchor="middle"
                          className="tabular-nums"
                        >
                          {distance.toFixed(2)} mm
                        </text>
                      </g>
                    </g>
                  )}
              </g>
            );
          })()}
        </svg>

                {selectedEntityIndices.length > 0 && (() => {
                  const bbox = computeBoundingBoxForIndices(selectedEntityIndices, entities);
                  if (!bbox) return null;
                  const containerW = containerRef.current?.clientWidth || 600;
                  const containerH = containerRef.current?.clientHeight || 400;

                  const rawX = ((bbox.cx - viewX) / viewWidth) * containerW;
                  const rawY = ((-bbox.maxY - viewY) / viewHeight) * containerH;

                  const barX = Math.max(140, Math.min(containerW - 140, rawX));
                  const barY = Math.max(16, Math.min(containerH - 45, rawY - 45));

                  return (
                    <div
                      style={{
                        position: 'absolute',
                        left: `${barX}px`,
                        top: `${barY}px`,
                        transform: 'translate(-50%, 0)',
                        zIndex: 20,
                        pointerEvents: 'auto',
                      }}
                    >
                      <div className="selection-action-bar">
                        <span className="item-count">
                          {selectedEntityIndices.length} {selectedEntityIndices.length === 1 ? 'item' : 'items'}
                        </span>
                        <button
                          type="button"
                          className="btn-reprocess"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSubRegionSelect?.([bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]);
                          }}
                          title="Rerun conversion on this selected area"
                        >
                          Reprocess Region
                        </button>
                        <button
                          type="button"
                          className="btn-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            const newEntities = entities.filter((_, idx) => !selectedEntityIndices.includes(idx));
                            onEntitiesChange(newEntities, true);
                            setSelectedEntityIndices([]);
                          }}
                          title="Delete selected elements"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          className="btn-clear"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEntityIndices([]);
                          }}
                          title="Clear Selection"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
          ) : result ? (
              <div className="empty-state">
                <strong>Processing DXF</strong>
                <span>Waiting for geometry...</span>
              </div>
            ) : (
              <div className="empty-state">
                <strong>No DXF yet</strong>
                <span>Run conversion to populate this review panel.</span>
              </div>
            )}
          </div>
        </div>

        <CadStatusBar
          cursorMm={cursorMm}
          selectedTool={selectedTool}
          measureStart={measureStart}
          measureEnd={measureEnd}
          brushRadius={brushRadius}
          brushShape={brushShape}
          onBrushShapeChange={onBrushShapeChange}
          currentZoomPercentage={currentZoomPercentage}
        />
      </div>
    </section>
  );
}
