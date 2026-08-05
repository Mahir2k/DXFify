import React, { useState, useEffect } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const PAPER_SIZES: Record<string, { w: number; h: number; label: string }> = {
  A4: { w: 210, h: 297, label: 'A4 (210 × 297 mm)' },
  A3: { w: 297, h: 420, label: 'A3 (297 × 420 mm)' },
  A5: { w: 148, h: 210, label: 'A5 (148 × 210 mm)' },
  Letter: { w: 215.9, h: 279.4, label: 'Letter (215.9 × 279.4 mm)' },
  Legal: { w: 215.9, h: 355.6, label: 'Legal (215.9 × 355.6 mm)' },
  Custom: { w: 200, h: 200, label: 'Custom (User Defined)' },
};

export const ArucoPaperGeneratorModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [paperType, setPaperType] = useState<string>('A4');
  const [customW, setCustomW] = useState<number>(210);
  const [customH, setCustomH] = useState<number>(297);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [markerSizeMm, setMarkerSizeMm] = useState<number>(30);
  const [marginXMm, setMarginXMm] = useState<number>(32.2);
  const [marginYMm, setMarginYMm] = useState<number>(34.2);
  const [showRuler, setShowRuler] = useState<boolean>(true);
  const [svgPreview, setSvgPreview] = useState<string>('');

  let pw = paperType in PAPER_SIZES && paperType !== 'Custom' ? PAPER_SIZES[paperType].w : customW;
  let ph = paperType in PAPER_SIZES && paperType !== 'Custom' ? PAPER_SIZES[paperType].h : customH;

  if (orientation === 'landscape') {
    const maxDim = Math.max(pw, ph);
    const minDim = Math.min(pw, ph);
    pw = maxDim;
    ph = minDim;
  } else {
    const maxDim = Math.max(pw, ph);
    const minDim = Math.min(pw, ph);
    pw = minDim;
    ph = maxDim;
  }

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const fetchSvg = async () => {
      try {
        const query = new URLSearchParams({
          paper_type: paperType,
          custom_w: customW.toString(),
          custom_h: customH.toString(),
          orientation,
          marker_size_mm: markerSizeMm.toString(),
          margin_x_mm: marginXMm.toString(),
          margin_y_mm: marginYMm.toString(),
          show_ruler: showRuler ? 'true' : 'false',
          format: 'svg',
        });
        const res = await fetch(`/api/generate-aruco-paper?${query.toString()}`);
        if (res.ok) {
          const text = await res.text();
          if (isMounted) setSvgPreview(text);
        }
      } catch (err) {
        console.error('Error fetching ArUco SVG preview:', err);
      }
    };

    fetchSvg();
    return () => { isMounted = false; };
  }, [isOpen, paperType, customW, customH, orientation, markerSizeMm, marginXMm, marginYMm, showRuler]);

  if (!isOpen) return null;

  const handleDownload = (format: 'pdf' | 'svg') => {
    const query = new URLSearchParams({
      paper_type: paperType,
      custom_w: customW.toString(),
      custom_h: customH.toString(),
      orientation,
      marker_size_mm: markerSizeMm.toString(),
      margin_x_mm: marginXMm.toString(),
      margin_y_mm: marginYMm.toString(),
      show_ruler: showRuler ? 'true' : 'false',
      format,
    });
    window.open(`/api/generate-aruco-paper?${query.toString()}`, '_blank');
  };

  return (
    <div className="gimp-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="aruco-modal-title">
      <div className="gimp-modal-box" onClick={(e) => e.stopPropagation()} style={{ minWidth: '780px', maxWidth: '840px' }}>
        <div className="gimp-modal-header">
          <span id="aruco-modal-title">ArUco Target Calibration Paper Generator</span>
          <button className="gimp-close-btn" onClick={onClose} aria-label="Close dialog">×</button>
        </div>

        <div className="gimp-modal-body" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '16px', height: '480px' }}>
          {/* Left Controls */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div className="gimp-settings-grid" style={{ gridTemplateColumns: '1fr' }}>
              <label>
                <span>Paper Preset / Type</span>
                <select value={paperType} onChange={(e) => setPaperType(e.target.value)}>
                  {Object.entries(PAPER_SIZES).map(([key, val]) => (
                    <option key={key} value={key}>{val.label}</option>
                  ))}
                </select>
              </label>

              {paperType === 'Custom' && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <label style={{ flex: 1 }}>
                    <span>Width (mm)</span>
                    <input type="number" value={customW} onChange={(e) => setCustomW(Math.max(50, parseFloat(e.target.value) || 100))} />
                  </label>
                  <label style={{ flex: 1 }}>
                    <span>Height (mm)</span>
                    <input type="number" value={customH} onChange={(e) => setCustomH(Math.max(50, parseFloat(e.target.value) || 100))} />
                  </label>
                </div>
              )}

              <label>
                <span>Orientation</span>
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                  <button
                    type="button"
                    className={orientation === 'portrait' ? 'gimp-btn-primary' : 'gimp-btn-secondary'}
                    onClick={() => setOrientation('portrait')}
                    style={{ flex: 1, padding: '6px', fontSize: '11px' }}
                  >
                    Portrait ({Math.min(pw, ph)} × {Math.max(pw, ph)} mm)
                  </button>
                  <button
                    type="button"
                    className={orientation === 'landscape' ? 'gimp-btn-primary' : 'gimp-btn-secondary'}
                    onClick={() => setOrientation('landscape')}
                    style={{ flex: 1, padding: '6px', fontSize: '11px' }}
                  >
                    Landscape ({Math.max(pw, ph)} × {Math.min(pw, ph)} mm)
                  </button>
                </div>
              </label>

              <label>
                <span>ArUco Marker Size: {markerSizeMm} mm</span>
                <input type="range" min="15" max="80" step="1" value={markerSizeMm} onChange={(e) => setMarkerSizeMm(parseFloat(e.target.value))} />
              </label>

              <div style={{ display: 'flex', gap: '8px' }}>
                <label style={{ flex: 1 }}>
                  <span>Margin X Offset (mm)</span>
                  <input type="number" step="0.1" value={marginXMm} onChange={(e) => setMarginXMm(parseFloat(e.target.value) || 30)} />
                </label>
                <label style={{ flex: 1 }}>
                  <span>Margin Y Offset (mm)</span>
                  <input type="number" step="0.1" value={marginYMm} onChange={(e) => setMarginYMm(parseFloat(e.target.value) || 30)} />
                </label>
              </div>

              <label style={{ flexDirection: 'row', alignItems: 'center', gap: '8px', cursor: 'pointer', marginTop: '4px' }}>
                <input type="checkbox" checked={showRuler} onChange={(e) => setShowRuler(e.target.checked)} />
                <span>Include Metric Scale Ruler (mm / cm)</span>
              </label>
            </div>

            <div className="gimp-info-text" style={{ marginTop: 'auto', padding: '10px', background: '#1b1b1b', border: '1px solid #323232', borderRadius: '3px', fontSize: '11px', lineHeight: '1.4' }}>
              <strong>IMPORTANT:</strong> Always print at <strong>100% Scale (Actual Size)</strong>. Do NOT enable "Fit to Page" in your printer dialog.
            </div>
          </div>

          {/* Right Live SVG Preview */}
          <div style={{ background: '#121212', border: '1px solid #282828', borderRadius: '3px', padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} dangerouslySetInnerHTML={{ __html: svgPreview }} />
          </div>
        </div>

        <div className="gimp-modal-footer">
          <button className="gimp-btn-secondary" onClick={() => handleDownload('svg')}>Download SVG Vector</button>
          <button className="gimp-btn-primary" onClick={() => handleDownload('pdf')}>Download Printable PDF</button>
        </div>
      </div>
    </div>
  );
};
