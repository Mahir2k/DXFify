import { useState } from 'react';
import type { ConversionResult, ToolId } from '../types';

interface DxfPreviewProps {
  result: ConversionResult | null;
  selectedTool: ToolId;
  showGrid: boolean;
}

const toolLabels: Record<ToolId, string> = {
  select: 'Select / Move',
  line: 'Line',
  arc: 'Arc / Curve',
  polyline: 'Polyline',
  'add-point': 'Add Point',
  delete: 'Delete',
  snap: 'Snap',
  'mark-hole': 'Mark Hole',
  undo: 'Undo',
  redo: 'Redo',
};

export function DxfPreview({ result, selectedTool, showGrid }: DxfPreviewProps) {
  const [gridEnabled, setGridEnabled] = useState(showGrid);
  const [outerLayerEnabled, setOuterLayerEnabled] = useState(true);
  const [holeLayerEnabled, setHoleLayerEnabled] = useState(true);
  const previewUrl = result?.files.preview ?? null;

  return (
    <section className="panel dxf-panel">
      <div className="panel-header">
        <div>
          <h2>DXF Preview</h2>
          <p>OUTER and HOLES review surface</p>
        </div>
        <div className="mini-controls">
          <button title="TODO: connect to real DXF camera fitting">Fit</button>
          <button onClick={() => setGridEnabled((current) => !current)}>
            {gridEnabled ? 'Grid On' : 'Grid Off'}
          </button>
          <button title="TODO: connect to real DXF zoom">+</button>
          <button title="TODO: connect to real DXF zoom">-</button>
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
        <span className="selected-tool">Tool: {toolLabels[selectedTool]}</span>
      </div>

      <div className={`cad-preview ${gridEnabled ? 'with-grid' : ''}`}>
        <div className="viewport-label">MODEL SPACE · mm</div>
        {previewUrl ? (
          <img className="dxf-preview-image" src={previewUrl} alt="Rendered DXF preview" />
        ) : result ? (
          <svg viewBox="0 0 520 360" className="mock-dxf" role="img" aria-label="DXF preview placeholder">
            <defs>
              <filter id="cad-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.4" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <text className="placeholder-label" x="260" y="34">DXF preview placeholder</text>
            {outerLayerEnabled ? (
              <path className="outer-line" d="M118 70 L390 70 L422 122 L392 286 L130 286 L96 210 Z" />
            ) : null}
            {holeLayerEnabled ? (
              <>
                <circle className="hole-line" cx="326" cy="164" r="28" />
                <circle className="hole-line" cx="336" cy="236" r="20" />
              </>
            ) : null}
            <polyline className="axis-line" points="64,320 464,320" />
            <polyline className="axis-line" points="64,320 64,36" />
          </svg>
        ) : (
          <div className="empty-state">
            <strong>No DXF yet</strong>
            <span>Run conversion to populate this review panel.</span>
          </div>
        )}
        <div className="viewport-scale">0,0</div>
      </div>
    </section>
  );
}
