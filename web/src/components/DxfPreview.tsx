import { useState } from 'react';
import type { ConversionResult } from '../types';

interface DxfPreviewProps {
  result: ConversionResult | null;
  showGrid: boolean;
}

export function DxfPreview({ result, showGrid }: DxfPreviewProps) {
  const [gridEnabled, setGridEnabled] = useState(showGrid);

  return (
    <section className="panel dxf-panel">
      <div className="panel-header">
        <div>
          <h2>DXF Preview</h2>
          <p>OUTER and HOLES review surface</p>
        </div>
        <div className="mini-controls">
          <button>Fit</button>
          <button onClick={() => setGridEnabled((current) => !current)}>
            {gridEnabled ? 'Grid On' : 'Grid Off'}
          </button>
          <button>+</button>
          <button>-</button>
        </div>
      </div>

      <div className="layer-row">
        <label><input type="checkbox" defaultChecked /> OUTER</label>
        <label><input type="checkbox" defaultChecked /> HOLES</label>
      </div>

      <div className={`cad-preview ${gridEnabled ? 'with-grid' : ''}`}>
        <div className="viewport-label">MODEL SPACE · mm</div>
        {result ? (
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
            <path className="outer-line" d="M118 70 L390 70 L422 122 L392 286 L130 286 L96 210 Z" />
            <circle className="hole-line" cx="326" cy="164" r="28" />
            <circle className="hole-line" cx="336" cy="236" r="20" />
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
