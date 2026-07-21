import { useState, useRef, useEffect } from 'react';
import type { ConversionResult, ToolId, Viewport, GeometryEntity } from '../types';
import { Ruler } from './Ruler';
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
  onRotateWorkspace?: (newEntities: GeometryEntity[], angleDeg: number, cx: number, cy: number) => void;
  hoveredCoord?: { x: number; y: number } | null;
  onHoverCoord?: (coord: { x: number; y: number } | null) => void;
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
  onRotateWorkspace,
  hoveredCoord = null,
  onHoverCoord,
}: DxfPreviewProps) {
  const [outerLayerEnabled, setOuterLayerEnabled] = useState(true);
  const [holeLayerEnabled, setHoleLayerEnabled] = useState(true);
  const [detailsLayerEnabled, setDetailsLayerEnabled] = useState(true);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  entities.forEach(entity => {
    if (entity.type === 'circle' && entity.cx != null && entity.cy != null && entity.r != null) {
      minX = Math.min(minX, entity.cx - entity.r);
      minY = Math.min(minY, entity.cy - entity.r);
      maxX = Math.max(maxX, entity.cx + entity.r);
      maxY = Math.max(maxY, entity.cy + entity.r);
    } else if (entity.type === 'polyline' && entity.points) {
      entity.points.forEach(pt => {
        minX = Math.min(minX, pt[0]);
        minY = Math.min(minY, pt[1]);
        maxX = Math.max(maxX, pt[0]);
        maxY = Math.max(maxY, pt[1]);
      });
    }
  });

  const hasBounds = minX !== Infinity;
  const bboxWidth = hasBounds ? (maxX - minX) : 0;
  const bboxHeight = hasBounds ? (maxY - minY) : 0;
  const bboxMinX = hasBounds ? minX : 0;
  const bboxMaxY = hasBounds ? maxY : 0;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);

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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

    const snapRadius = 6.0; 
    let bestPt = coords;
    let minD = snapRadius;

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
    return minD < snapRadius ? bestPt : null;
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
    let bestEntityIdx = -1;
    let bestSegmentIdx = -1;
    let minD = 6.0; 
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
  };

  
  const handleVertexPointerDown = (e: React.PointerEvent<SVGCircleElement>, entityIdx: number, pointIdx: number) => {
    e.stopPropagation();
    if (selectedTool === 'delete-point') {
      const ent = entities[entityIdx];
      if (ent.type === 'polyline' && ent.points) {
        if (ent.points.length > 2) {
          const newPoints = ent.points.filter((_, i) => i !== pointIdx);
          const newEntities = [...entities];
          newEntities[entityIdx] = {
            ...ent,
            points: newPoints,
          };
          onEntitiesChange(newEntities, true);
        }
      }
    } else {
      handleVertexDragStart(e, entityIdx, pointIdx);
    }
  };

  const handleVertexDragStart = (e: React.PointerEvent<SVGCircleElement>, entityIdx: number, pointIdx: number) => {
    e.stopPropagation();
    setActiveDrag({ type: 'vertex', entityIdx, pointIdx });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCircleCenterDragStart = (e: React.PointerEvent<SVGCircleElement>, entityIdx: number) => {
    e.stopPropagation();
    setActiveDrag({ type: 'center', entityIdx });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCircleRadiusDragStart = (e: React.PointerEvent<SVGCircleElement>, entityIdx: number) => {
    e.stopPropagation();
    setActiveDrag({ type: 'radius', entityIdx });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleHandlePointerUp = (e: React.PointerEvent<SVGCircleElement>) => {
    if (activeDrag) {
      e.currentTarget.releasePointerCapture(e.pointerId);
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

    if (selectedTool === 'select') {
      setIsDragging(true);
      setLastPos({ x: e.clientX, y: e.clientY });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (selectedTool === 'measure') {
      setMeasureStart(clickCoords);
      setMeasureEnd(clickCoords);
      setIsDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (selectedTool === 'brush') {
      const newEntities = applyBrushDeform(clickCoords.x, clickCoords.y, entities);
      onEntitiesChange(newEntities);
      setIsDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (selectedTool === 'line') {
      if (drawPoints.length === 0) {
        setDrawPoints([[clickCoords.x, clickCoords.y]]);
      } else {
        onEntitiesChange([...entities, {
          type: 'polyline',
          layer: 'OUTER',
          points: [drawPoints[0], [clickCoords.x, clickCoords.y]],
          closed: false
        }]);
        setDrawPoints([]);
      }
    } else if (selectedTool === 'polyline') {
      setDrawPoints([...drawPoints, [clickCoords.x, clickCoords.y]]);
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
      }
    } else if (selectedTool === 'delete') {
      const closest = findClosestEntity(clickCoords);
      if (closest.index !== -1 && closest.dist < 6.0) {
        onEntitiesChange(entities.filter((_, i) => i !== closest.index));
      }
    } else if (selectedTool === 'mark-hole') {
      const closest = findClosestEntity(clickCoords);
      if (closest.index !== -1 && closest.dist < 6.0) {
        const newEntities = [...entities];
        newEntities[closest.index] = {
          ...newEntities[closest.index],
          layer: newEntities[closest.index].layer === 'OUTER' ? 'HOLES' : 'OUTER',
        };
        onEntitiesChange(newEntities);
      }
    } else if (selectedTool === 'add-point') {
      handleAddPointClick(clickCoords);
    } else if (selectedTool === 'align') {
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

        if (closestSegment && minDistance < 15.0) {
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
            const angleDeg = -alpha * (180 / Math.PI);
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

    if (!isDragging) return;

    if (selectedTool === 'brush') {
      const coords = getModelCoords(e.clientX, e.clientY);
      if (coords) {
        const newEntities = applyBrushDeform(coords.x, coords.y, entities);
        onEntitiesChange(newEntities, false);
      }
      return;
    }
    
    if (selectedTool === 'select') {
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
    } else if (selectedTool === 'measure') {
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
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
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
        <div>
          <h2>DXF Preview</h2>
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

      <div className="layer-row">
        <label>
          <input
            type="checkbox"
            checked={outerLayerEnabled}
            onChange={(event) => setOuterLayerEnabled(event.target.checked)}
          /> OUTER
        </label>
        <label>
          <input
            type="checkbox"
            checked={holeLayerEnabled}
            onChange={(event) => setHoleLayerEnabled(event.target.checked)}
          /> HOLES
        </label>
        <label>
          <input
            type="checkbox"
            checked={detailsLayerEnabled}
            onChange={(event) => setDetailsLayerEnabled(event.target.checked)}
          /> DETAILS
        </label>
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
              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
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
                    cursor: selectedTool === 'select' ? (activeDrag ? 'move' : isDragging ? 'grabbing' : 'grab') : selectedTool === 'measure' ? 'crosshair' : selectedTool === 'brush' ? 'pointer' : 'default'
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

                  <g transform="scale(1, -1)">
                    {hoveredCoord && (
                      <g transform={`translate(${hoveredCoord.x}, ${hoveredCoord.y})`} style={{ pointerEvents: 'none' }}>
                        <circle r={Math.max(0.2, viewWidth / 250) * 3} fill="none" stroke="#ff9800" strokeWidth={Math.max(0.2, viewWidth / 250) * 0.4} />
                        <line x1={-Math.max(0.2, viewWidth / 250) * 6} y1={0} x2={Math.max(0.2, viewWidth / 250) * 6} y2={0} stroke="#ff9800" strokeWidth={Math.max(0.2, viewWidth / 250) * 0.3} />
                        <line x1={0} y1={-Math.max(0.2, viewWidth / 250) * 6} x2={0} y2={Math.max(0.2, viewWidth / 250) * 6} stroke="#ff9800" strokeWidth={Math.max(0.2, viewWidth / 250) * 0.3} />
                      </g>
                    )}
                    {}
                  {(selectedTool === 'select' || selectedTool === 'delete-point') && entities.map((entity, entityIdx) => {
                    const layer = entity.layer;
                    if (layer === 'HOLES' && !holeLayerEnabled) return null;
                    if (layer === 'OUTER' && !outerLayerEnabled) return null;
                    if (layer === 'DETAILS' && !detailsLayerEnabled) return null;

                    const handleScale = Math.max(0.2, viewWidth / 250);

                    if (entity.type === 'circle' && entity.cx != null && entity.cy != null && entity.r != null) {
                      
                      if (selectedTool === 'delete-point') return null;
                      return (
                        <g key={entityIdx}>
                          {}
                          <circle
                            cx={entity.cx}
                            cy={entity.cy}
                            r={1.2 * handleScale}
                            fill="var(--accent)"
                            stroke="white"
                            strokeWidth={0.3 * handleScale}
                            style={{ cursor: 'move' }}
                            onPointerDown={(e) => handleCircleCenterDragStart(e, entityIdx)}
                            onPointerUp={handleHandlePointerUp}
                          />
                          {}
                          <circle
                            cx={entity.cx + entity.r}
                            cy={entity.cy}
                            r={1.2 * handleScale}
                            fill="#ffcc00"
                            stroke="white"
                            strokeWidth={0.3 * handleScale}
                            style={{ cursor: 'ew-resize' }}
                            onPointerDown={(e) => handleCircleRadiusDragStart(e, entityIdx)}
                            onPointerUp={handleHandlePointerUp}
                          />
                        </g>
                      );
                    } else if (entity.type === 'polyline' && entity.points) {
                      return (
                        <g key={entityIdx}>
                          {entity.points.map((pt, ptIdx) => (
                            <circle
                              key={ptIdx}
                              cx={pt[0]}
                              cy={pt[1]}
                              r={1.2 * handleScale}
                              fill={selectedTool === 'delete-point' ? '#ff3b30' : 'var(--accent)'} 
                              stroke="white"
                              strokeWidth={0.3 * handleScale}
                              style={{ cursor: selectedTool === 'delete-point' ? 'pointer' : 'move' }}
                              onPointerDown={(e) => handleVertexPointerDown(e, entityIdx, ptIdx)}
                              onPointerUp={handleHandlePointerUp}
                            />
                          ))}
                        </g>
                      );
                    }
                    return null;
                  })}

                  {}
                  {snapPoint && (
                    <rect
                      x={snapPoint.x - 1.2}
                      y={snapPoint.y - 1.2}
                      width="2.4"
                      height="2.4"
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="0.4"
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
                      strokeWidth="0.6"
                      strokeDasharray="2,2"
                    />
                  )}
                  {drawPoints.length > 0 && cursorMm && (
                    <line
                      x1={drawPoints[drawPoints.length - 1][0]}
                      y1={drawPoints[drawPoints.length - 1][1]}
                      x2={cursorMm.x}
                      y2={cursorMm.y}
                      stroke="var(--accent)"
                      strokeWidth="0.5"
                      strokeDasharray="2,2"
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
                          dominantBaseline="middle"
                          fontWeight="bold"
                          className="tabular-nums"
                        >
                          {distance.toFixed(2)} mm
                        </text>
                      </g>
                    </g>
                  )}
                </g>
              </svg>
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

        <div className="canvas-status-bar">
          <span>
            X <strong className="tabular-nums">{cursorMm ? cursorMm.x.toFixed(2) : '—'}</strong>
          </span>
          <span>
            Y <strong className="tabular-nums">{cursorMm ? cursorMm.y.toFixed(2) : '—'}</strong>
          </span>
          {selectedTool === 'measure' && measureStart && measureEnd && (
            <span style={{ marginLeft: '16px', color: 'var(--accent)' }}>
              Distance: <strong className="tabular-nums">{distance.toFixed(2)} mm</strong>
            </span>
          )}
          {selectedTool === 'brush' && (
            <span style={{ marginLeft: '16px', color: 'var(--accent)' }}>
              Brush: <strong className="tabular-nums">{brushRadius.toFixed(1)} mm</strong> ({brushShape === 'circle' ? 'Ball' : 'Cube'})
            </span>
          )}
          <span style={{ marginLeft: 'auto' }}>
            Zoom <strong className="tabular-nums">{currentZoomPercentage}%</strong>
          </span>
          <span>
            Tool <strong>{selectedTool}</strong>
          </span>
        </div>
      </div>
    </section>
  );
}
