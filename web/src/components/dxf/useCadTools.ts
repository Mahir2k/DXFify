import { useState, useCallback } from 'react';
import type { ToolId, GeometryEntity, ActiveDrawingState } from '../../types';
import { computeCircumcircle, evaluateSplinePoints } from '../../utils/geometryUtils';

interface UseCadToolsProps {
  selectedTool: ToolId;
  entities: GeometryEntity[];
  onEntitiesChange: (entities: GeometryEntity[], commit?: boolean) => void;
  onActiveDrawingChange?: (drawing: ActiveDrawingState) => void;
  onSubRegionSelect?: (bbox: [number, number, number, number]) => void;
}

export function useCadTools({
  selectedTool,
  entities,
  onEntitiesChange,
  onActiveDrawingChange,
  onSubRegionSelect,
}: UseCadToolsProps) {
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [arcStep, setArcStep] = useState<number>(0);
  const [rectPoints, setRectPoints] = useState<[number, number][]>([]);
  const [circle3Points, setCircle3Points] = useState<[number, number][]>([]);
  const [slotPoints, setSlotPoints] = useState<[number, number][]>([]);
  const [splinePoints, setSplinePoints] = useState<[number, number][]>([]);
  const [selectedEntityIndices, setSelectedEntityIndices] = useState<number[]>([]);
  const [alignSelectedSegment, setAlignSelectedSegment] = useState<{
    entIdx: number;
    segIdx: number;
    p1: [number, number];
    p2: [number, number];
  } | null>(null);

  const resetToolState = useCallback(() => {
    setDrawPoints([]);
    setArcStep(0);
    setRectPoints([]);
    setCircle3Points([]);
    setSlotPoints([]);
    setSplinePoints([]);
    setAlignSelectedSegment(null);
    if (onActiveDrawingChange) onActiveDrawingChange(null);
  }, [onActiveDrawingChange]);

  const handleToolPointClick = useCallback(
    (pt: [number, number]) => {
      if (selectedTool === 'line') {
        if (drawPoints.length === 0) {
          setDrawPoints([pt]);
        } else if (drawPoints.length === 1) {
          const newEntity: GeometryEntity = {
            type: 'polyline',
            layer: 'OUTER',
            points: [drawPoints[0], pt],
            closed: false,
          };
          onEntitiesChange([...entities, newEntity], true);
          setDrawPoints([]);
          if (onActiveDrawingChange) onActiveDrawingChange(null);
        }
      } else if (selectedTool === 'polyline') {
        const nextPts = [...drawPoints, pt];
        setDrawPoints(nextPts);
      } else if (selectedTool === 'arc') {
        if (arcStep === 0) {
          setDrawPoints([pt]);
          setArcStep(1);
        } else if (arcStep === 1) {
          setDrawPoints([drawPoints[0], pt]);
          setArcStep(2);
        } else if (arcStep === 2) {
          const circle = computeCircumcircle(drawPoints[0], drawPoints[1], pt);
          if (circle) {
            const newEntity: GeometryEntity = {
              type: 'circle',
              layer: 'OUTER',
              cx: circle.cx,
              cy: circle.cy,
              r: circle.r,
            };
            onEntitiesChange([...entities, newEntity], true);
          }
          resetToolState();
        }
      }
    },
    [selectedTool, drawPoints, arcStep, entities, onEntitiesChange, onActiveDrawingChange, resetToolState],
  );

  return {
    drawPoints,
    setDrawPoints,
    arcStep,
    setArcStep,
    rectPoints,
    setRectPoints,
    circle3Points,
    setCircle3Points,
    slotPoints,
    setSlotPoints,
    splinePoints,
    setSplinePoints,
    selectedEntityIndices,
    setSelectedEntityIndices,
    alignSelectedSegment,
    setAlignSelectedSegment,
    resetToolState,
    handleToolPointClick,
  };
}
