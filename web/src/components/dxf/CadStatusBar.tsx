import type { ToolId } from '../../types';

interface CadStatusBarProps {
  cursorMm: { x: number; y: number } | null;
  selectedTool: ToolId;
  measureStart: { x: number; y: number } | null;
  measureEnd: { x: number; y: number } | null;
  brushRadius: number;
  brushShape: 'circle' | 'square';
  onBrushShapeChange?: (shape: 'circle' | 'square') => void;
  currentZoomPercentage: number;
}

/**
 * Status bar component rendering realtime cursor mm coordinates, zoom level, and active CAD tool metrics.
 */
export function CadStatusBar({
  cursorMm,
  selectedTool,
  measureStart,
  measureEnd,
  brushRadius,
  brushShape,
  onBrushShapeChange,
  currentZoomPercentage,
}: CadStatusBarProps) {
  const distance =
    measureStart && measureEnd
      ? Math.hypot(measureEnd.x - measureStart.x, measureEnd.y - measureStart.y)
      : 0;

  return (
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
        <span style={{ marginLeft: '16px', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          Brush: <strong className="tabular-nums">{brushRadius.toFixed(1)} mm</strong>
          <button
            type="button"
            onClick={() => onBrushShapeChange?.(brushShape === 'circle' ? 'square' : 'circle')}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid var(--accent)',
              borderRadius: '3px',
              color: '#fff',
              fontSize: '11px',
              padding: '1px 6px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            title="Click to toggle brush shape (Ball / Cube) or press 'B'"
          >
            {brushShape === 'circle' ? '● Ball' : '■ Cube'}
          </button>
        </span>
      )}
      <span style={{ marginLeft: 'auto' }}>
        Zoom <strong className="tabular-nums">{currentZoomPercentage}%</strong>
      </span>
      <span>
        Tool <strong>{selectedTool}</strong>
      </span>
    </div>
  );
}
