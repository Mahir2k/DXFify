import React, { useState, useEffect } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onShowToast?: (message: string, type?: 'success' | 'error') => void;
}

const PAPER_SIZES: Record<string, { w: number; h: number; label: string }> = {
  A4: { w: 210, h: 297, label: 'A4 (210 × 297 mm)' },
  A3: { w: 297, h: 420, label: 'A3 (297 × 420 mm)' },
  A5: { w: 148, h: 210, label: 'A5 (148 × 210 mm)' },
  Letter: { w: 215.9, h: 279.4, label: 'Letter (215.9 × 279.4 mm)' },
  Legal: { w: 215.9, h: 355.6, label: 'Legal (215.9 × 355.6 mm)' },
  Custom: { w: 200, h: 200, label: 'Custom (User Defined)' },
};

export const ArucoPaperGeneratorModal: React.FC<Props> = ({ isOpen, onClose, onShowToast }) => {
  const [paperType, setPaperType] = useState<string>('A4');
  const [customW, setCustomW] = useState<number>(210);
  const [customH, setCustomH] = useState<number>(297);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [hoveredOrientationBtn, setHoveredOrientationBtn] = useState<'portrait' | 'landscape' | null>(null);
  const [markerSizeMm, setMarkerSizeMm] = useState<number>(30);
  const [marginXMm, setMarginXMm] = useState<number>(32.2);
  const [marginYMm, setMarginYMm] = useState<number>(34.2);
  const [showRuler, setShowRuler] = useState<boolean>(true);
  const [showHeaderText, setShowHeaderText] = useState<boolean>(false);
  const [svgPreview, setSvgPreview] = useState<string>('');
  const [isLoadingPreview, setIsLoadingPreview] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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

    setIsLoadingPreview(true);
    const query = new URLSearchParams({
      paper_type: paperType,
      custom_w: customW.toString(),
      custom_h: customH.toString(),
      orientation,
      marker_size_mm: markerSizeMm.toString(),
      margin_x_mm: marginXMm.toString(),
      margin_y_mm: marginYMm.toString(),
      show_ruler: showRuler ? 'true' : 'false',
      show_header_text: showHeaderText ? 'true' : 'false',
      format: 'svg',
    });

    fetch(`/api/generate-aruco-paper?${query.toString()}`)
      .then((res) => res.text())
      .then((svg) => {
        setSvgPreview(svg);
        setIsLoadingPreview(false);
      })
      .catch((err) => {
        console.error('Failed to load ArUco SVG preview:', err);
        setIsLoadingPreview(false);
      });
  }, [isOpen, paperType, customW, customH, orientation, markerSizeMm, marginXMm, marginYMm, showRuler, showHeaderText]);

  if (!isOpen) return null;

  const handleDownload = async (format: 'pdf' | 'svg') => {
    const query = new URLSearchParams({
      paper_type: paperType,
      custom_w: customW.toString(),
      custom_h: customH.toString(),
      orientation,
      marker_size_mm: markerSizeMm.toString(),
      margin_x_mm: marginXMm.toString(),
      margin_y_mm: marginYMm.toString(),
      show_ruler: showRuler ? 'true' : 'false',
      show_header_text: showHeaderText ? 'true' : 'false',
      format,
    });
    try {
      const res = await fetch(`/api/save-aruco-paper?${query.toString()}`);
      const result = await res.json();
      if (result.success) {
        const msg = `Saved ${result.filename || 'ArUco target'} to ${result.path}`;
        setStatusMessage(msg);
        onShowToast?.(msg, 'success');
      } else if (!result.cancelled) {
        const msg = `Save failed: ${result.message}`;
        setStatusMessage(msg);
        onShowToast?.(msg, 'error');
      }
    } catch (err) {
      console.error('Save error:', err);
      const msg = 'Failed to save file';
      setStatusMessage(msg);
      onShowToast?.(msg, 'error');
    }
  };

  const getOrientationBtnStyle = (type: 'portrait' | 'landscape') => {
    const isSelected = orientation === type;
    const isHovered = hoveredOrientationBtn === type;

    if (isSelected) {
      return {
        flex: 1,
        padding: '8px 10px',
        fontSize: '11px',
        fontWeight: 'bold' as const,
        borderRadius: '3px',
        cursor: 'pointer',
        border: '1px solid #4a8d5a',
        backgroundColor: isHovered ? '#468656' : '#3b744b',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column' as const,
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background-color 0.15s ease, border-color 0.15s ease',
        boxSizing: 'border-box' as const,
      };
    }

    return {
      flex: 1,
      padding: '8px 10px',
      fontSize: '11px',
      fontWeight: 'normal' as const,
      borderRadius: '3px',
      cursor: 'pointer',
      border: isHovered ? '1px solid #606060' : '1px solid #3c3c3c',
      backgroundColor: isHovered ? '#363636' : '#242424',
      color: isHovered ? '#ffffff' : '#b0b0b0',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background-color 0.15s ease, border-color 0.15s ease',
      boxSizing: 'border-box' as const,
    };
  };

  return (
    <div className="gimp-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="aruco-modal-title">
      <div className="gimp-modal-box gimp-aruco-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="gimp-modal-header">
          <span id="aruco-modal-title">ArUco Target Calibration Paper Generator</span>
          <button className="gimp-close-btn" onClick={onClose} aria-label="Close dialog">×</button>
        </div>

        <div className="gimp-modal-body gimp-aruco-modal-body">
          {/* Left Controls Column (Fixed 320px width) */}
          <div style={{ width: '320px', minWidth: '320px', maxWidth: '320px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '12px', boxSizing: 'border-box', overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', boxSizing: 'border-box' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', boxSizing: 'border-box' }}>
                <span style={{ fontSize: '11px', color: '#b0b0b0' }}>Paper Preset / Type</span>
                <select
                  value={paperType}
                  onChange={(e) => setPaperType(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box', background: '#1b1b1b', border: '1px solid #3c3c3c', color: '#e1e1e1', padding: '5px 8px', fontSize: '12px', borderRadius: '2px', outline: 'none' }}
                >
                  {Object.entries(PAPER_SIZES).map(([key, val]) => (
                    <option key={key} value={key}>{val.label}</option>
                  ))}
                </select>
              </label>

              {paperType === 'Custom' && (
                <div style={{ display: 'flex', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                  <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#b0b0b0' }}>Width (mm)</span>
                    <input type="number" value={customW} onChange={(e) => setCustomW(Math.max(50, parseFloat(e.target.value) || 100))} style={{ width: '100%', boxSizing: 'border-box', background: '#1b1b1b', border: '1px solid #3c3c3c', color: '#e1e1e1', padding: '5px 8px', fontSize: '12px' }} />
                  </label>
                  <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#b0b0b0' }}>Height (mm)</span>
                    <input type="number" value={customH} onChange={(e) => setCustomH(Math.max(50, parseFloat(e.target.value) || 100))} style={{ width: '100%', boxSizing: 'border-box', background: '#1b1b1b', border: '1px solid #3c3c3c', color: '#e1e1e1', padding: '5px 8px', fontSize: '12px' }} />
                  </label>
                </div>
              )}

              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', boxSizing: 'border-box' }}>
                <span style={{ fontSize: '11px', color: '#b0b0b0' }}>Orientation</span>
                <div style={{ display: 'flex', gap: '8px', marginTop: '4px', width: '100%', boxSizing: 'border-box' }}>
                  <button
                    type="button"
                    style={getOrientationBtnStyle('portrait')}
                    onClick={() => setOrientation('portrait')}
                    onMouseEnter={() => setHoveredOrientationBtn('portrait')}
                    onMouseLeave={() => setHoveredOrientationBtn(null)}
                  >
                    <span>Portrait</span>
                    <span style={{ fontSize: '10px', opacity: 0.8 }}>({Math.min(pw, ph)} × {Math.max(pw, ph)} mm)</span>
                  </button>
                  <button
                    type="button"
                    style={getOrientationBtnStyle('landscape')}
                    onClick={() => setOrientation('landscape')}
                    onMouseEnter={() => setHoveredOrientationBtn('landscape')}
                    onMouseLeave={() => setHoveredOrientationBtn(null)}
                  >
                    <span>Landscape</span>
                    <span style={{ fontSize: '10px', opacity: 0.8 }}>({Math.max(pw, ph)} × {Math.min(pw, ph)} mm)</span>
                  </button>
                </div>
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', boxSizing: 'border-box' }}>
                <span style={{ fontSize: '11px', color: '#b0b0b0' }}>ArUco Marker Size: {markerSizeMm} mm</span>
                <input type="range" min="15" max="80" step="1" value={markerSizeMm} onChange={(e) => setMarkerSizeMm(parseFloat(e.target.value))} style={{ width: '100%', boxSizing: 'border-box' }} />
              </label>

              <div style={{ display: 'flex', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#b0b0b0' }}>Margin X Offset (mm)</span>
                  <input type="number" step="0.1" value={marginXMm} onChange={(e) => setMarginXMm(parseFloat(e.target.value) || 30)} style={{ width: '100%', boxSizing: 'border-box', background: '#1b1b1b', border: '1px solid #3c3c3c', color: '#e1e1e1', padding: '5px 8px', fontSize: '12px' }} />
                </label>
                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ fontSize: '11px', color: '#b0b0b0' }}>Margin Y Offset (mm)</span>
                  <input type="number" step="0.1" value={marginYMm} onChange={(e) => setMarginYMm(parseFloat(e.target.value) || 30)} style={{ width: '100%', boxSizing: 'border-box', background: '#1b1b1b', border: '1px solid #3c3c3c', color: '#e1e1e1', padding: '5px 8px', fontSize: '12px' }} />
                </label>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px', width: '100%', boxSizing: 'border-box' }}>
                <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: '#e1e1e1' }}>
                  <input type="checkbox" checked={showRuler} onChange={(e) => setShowRuler(e.target.checked)} style={{ width: 'auto' }} />
                  <span>Include Metric Scale Ruler (mm / cm)</span>
                </label>

                <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px', color: '#e1e1e1' }}>
                  <input type="checkbox" checked={showHeaderText} onChange={(e) => setShowHeaderText(e.target.checked)} style={{ width: 'auto' }} />
                  <span>Include Header & Scale Info Text</span>
                </label>
              </div>
            </div>

            <div className="gimp-info-text" style={{ marginTop: 'auto', padding: '10px', background: '#1b1b1b', border: '1px solid #323232', borderRadius: '3px', fontSize: '11px', lineHeight: '1.4', width: '100%', boxSizing: 'border-box' }}>
              <strong>IMPORTANT:</strong> Always print at <strong>100% Scale (Actual Size)</strong>. Do NOT enable "Fit to Page" in your printer dialog.
            </div>
          </div>

          {/* Right Live SVG Preview Column */}
          <div style={{ flex: 1, minWidth: 0, height: '100%', background: '#161616', border: '1px solid #333333', borderRadius: '4px', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxSizing: 'border-box' }}>
            <div
              className="gimp-aruco-preview-wrapper"
              style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
              dangerouslySetInnerHTML={{ __html: svgPreview }}
            />
          </div>
        </div>

        <div className="gimp-modal-footer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ fontSize: '12px', color: statusMessage?.startsWith('Save failed') ? '#ef4444' : '#10b981', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: '12px' }}>
            {statusMessage}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="gimp-btn-secondary" onClick={() => handleDownload('svg')}>Download SVG Vector</button>
            <button className="gimp-btn-primary" onClick={() => handleDownload('pdf')}>Download Printable PDF</button>
          </div>
        </div>
      </div>
    </div>
  );
};
