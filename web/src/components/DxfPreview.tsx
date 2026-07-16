import { useState, useRef } from 'react';
import type { ConversionResult, ToolId } from '../types';

interface DxfPreviewProps {
  result: ConversionResult | null;
  selectedTool: ToolId;
  showGrid: boolean;
}

export function DxfPreview({ result, selectedTool, showGrid }: DxfPreviewProps) {
  const [gridEnabled, setGridEnabled] = useState(showGrid);
  const [outerLayerEnabled, setOuterLayerEnabled] = useState(true);
  const [holeLayerEnabled, setHoleLayerEnabled] = useState(true);
  
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const baseMinX = (result?.report?.bboxMinXMm || 0) - 10;
  const baseMinY = result?.report?.bboxMaxYMm ? -(result.report.bboxMaxYMm + 10) : 0;
  const baseWidth = (result?.report?.bboxWidthMm || 100) + 20;
  const baseHeight = (result?.report?.bboxHeightMm || 100) + 20;

  const viewWidth = baseWidth / zoom;
  const viewHeight = baseHeight / zoom;
  const viewX = baseMinX - pan.x * (baseWidth / zoom) + (baseWidth - viewWidth) / 2;
  const viewY = baseMinY - pan.y * (baseHeight / zoom) + (baseHeight - viewHeight) / 2;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (selectedTool !== 'select') return;
    setIsDragging(true);
    setLastPos({ x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!isDragging || selectedTool !== 'select') return;
    const dx = e.clientX - lastPos.x;
    const dy = e.clientY - lastPos.y;
    
    if (svgRef.current) {
      const rect = svgRef.current.getBoundingClientRect();
      const scaleX = 1 / rect.width;
      const scaleY = 1 / rect.height;
      setPan(p => ({ x: p.x + dx * scaleX, y: p.y + dy * scaleY }));
    }
    
    setLastPos({ x: e.clientX, y: e.clientY });
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.1, Math.min(50, z * zoomFactor)));
  };

  const handleFit = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <section className="panel dxf-panel">
      <div className="panel-header">
        <div>
          <h2>DXF Preview</h2>
        </div>
        <div className="mini-controls">
          <button onClick={handleFit} title="Fit to view">Fit</button>
          <button onClick={() => setGridEnabled((current) => !current)}>
            {gridEnabled ? 'Grid On' : 'Grid Off'}
          </button>
          <button onClick={() => setZoom(z => z * 1.2)} title="Zoom In">+</button>
          <button onClick={() => setZoom(z => z / 1.2)} title="Zoom Out">-</button>
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
        <span className="selected-tool" style={{ color: 'var(--muted)', fontStyle: 'italic', visibility: 'hidden' }}>
          {selectedTool === 'select' ? 'Pan active' : 'Tool inactive'}
        </span>
      </div>

      <div className={`cad-preview ${gridEnabled ? 'with-grid' : ''}`}>
        <div className="viewport-label">MODEL SPACE · mm</div>
        
        {gridEnabled && (
          <div className="viewport-grid-label" style={{ position: 'absolute', top: 10, left: 160, color: 'var(--muted)', fontSize: '11px', pointerEvents: 'none', zIndex: 2 }}>
            GRID: 10mm
          </div>
        )}

        {result?.report?.entities ? (
          <>
            <svg 
              ref={svgRef}
              viewBox={`${viewX} ${viewY} ${viewWidth} ${viewHeight}`} 
              className="native-dxf" 
              role="img" 
              aria-label="Native DXF preview"
              style={{ width: '100%', height: '100%', cursor: selectedTool === 'select' ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              onWheel={handleWheel}
            >
              {/* Bounding box dimensions overlay (drawn outside the flipped scale so text is upright) */}
              {outerLayerEnabled && result.report.bboxWidthMm != null && result.report.bboxHeightMm != null && (
                <g className="dimension-overlay" style={{ opacity: 0.6 }}>
                  {/* Width dimension */}
                  <path d={`M ${result.report.bboxMinXMm || 0} ${-(result.report.bboxMaxYMm || 0) - 5} L ${(result.report.bboxMinXMm || 0) + result.report.bboxWidthMm} ${-(result.report.bboxMaxYMm || 0) - 5}`} stroke="var(--accent)" strokeWidth="0.5" strokeDasharray="2,2" fill="none" />
                  <text x={(result.report.bboxMinXMm || 0) + result.report.bboxWidthMm / 2} y={-(result.report.bboxMaxYMm || 0) - 7} fill="var(--accent)" fontSize="4" textAnchor="middle" className="tabular-nums">
                    {result.report.bboxWidthMm.toFixed(2)}
                  </text>
                  
                  {/* Height dimension */}
                  <path d={`M ${(result.report.bboxMinXMm || 0) - 5} ${-(result.report.bboxMaxYMm || 0)} L ${(result.report.bboxMinXMm || 0) - 5} ${-(result.report.bboxMaxYMm || 0) + result.report.bboxHeightMm}`} stroke="var(--accent)" strokeWidth="0.5" strokeDasharray="2,2" fill="none" />
                  <text x={(result.report.bboxMinXMm || 0) - 7} y={-(result.report.bboxMaxYMm || 0) + result.report.bboxHeightMm / 2} fill="var(--accent)" fontSize="4" textAnchor="middle" transform={`rotate(-90 ${(result.report.bboxMinXMm || 0) - 7} ${-(result.report.bboxMaxYMm || 0) + result.report.bboxHeightMm / 2})`} className="tabular-nums">
                    {result.report.bboxHeightMm.toFixed(2)}
                  </text>
                </g>
              )}

              <g transform="scale(1, -1)">
                {result.report.entities.map((entity, idx) => {
                  const isHole = entity.layer === 'HOLES';
                  if (isHole && !holeLayerEnabled) return null;
                  if (!isHole && !outerLayerEnabled) return null;
                  
                  const className = isHole ? 'hole-line' : 'outer-line';
                  
                  if (entity.type === 'circle') {
                    return (
                      <circle 
                        key={idx} 
                        className={className} 
                        cx={entity.cx} 
                        cy={entity.cy} 
                        r={entity.r} 
                        fill="none"
                        strokeWidth="0.5"
                      />
                    );
                  } else if (entity.type === 'polyline' && entity.points) {
                    const d = entity.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ') + (entity.closed ? ' Z' : '');
                    return (
                      <path 
                        key={idx} 
                        className={className} 
                        d={d}
                        fill="none"
                        strokeWidth="0.5"
                      />
                    );
                  }
                  return null;
                })}
              </g>
            </svg>
            
            {/* Scale Bar Overlay */}
            <div style={{ position: 'absolute', bottom: 20, right: 20, width: '100px', pointerEvents: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <div style={{ color: 'var(--text)', opacity: 0.6, fontSize: '10px', marginBottom: '2px' }} className="tabular-nums">
                {svgRef.current ? Math.round((100 / svgRef.current.clientWidth) * viewWidth) : 10} mm
              </div>
              <div style={{ borderBottom: '2px solid var(--text)', borderLeft: '2px solid var(--text)', borderRight: '2px solid var(--text)', opacity: 0.4, height: '6px', width: '100px' }} />
            </div>
          </>
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
    </section>
  );
}
