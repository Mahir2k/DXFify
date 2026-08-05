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
  const [loading, setLoading] = useState<boolean>(false);

  // Compute active page dimensions
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

  // Fetch SVG Preview
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const fetchSvg = async () => {
      setLoading(true);
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
      } finally {
        if (isMounted) setLoading(false);
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
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        backgroundColor: '#1e1e24',
        borderRadius: '12px',
        border: '1px solid #333340',
        width: '900px',
        maxWidth: '95vw',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        color: '#e0e0e0',
        fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden',
      }}>
        {/* Modal Header */}
        <div style={{
          padding: '16px 24px',
          borderBottom: '1px solid #2d2d38',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#18181c',
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#00e676' }}>
              🖨 ArUco Target Calibration Paper Generator
            </h3>
            <span style={{ fontSize: '12px', color: '#888' }}>
              Generate & print 1:1 metric scale calibration targets for any standard or custom paper size
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: '#aaa', fontSize: '20px', cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body: Left Controls, Right Live Preview */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: '550px' }}>
          {/* Left Controls Panel */}
          <div style={{
            width: '340px',
            padding: '20px',
            borderRight: '1px solid #2d2d38',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            backgroundColor: '#1a1a20',
          }}>
            {/* Paper Size Preset */}
            <div>
              <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: '6px' }}>
                Paper Preset / Type
              </label>
              <select
                value={paperType}
                onChange={(e) => setPaperType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#262630',
                  border: '1px solid #3d3d50',
                  borderRadius: '6px',
                  color: '#fff',
                  fontSize: '13px',
                }}
              >
                {Object.entries(PAPER_SIZES).map(([key, val]) => (
                  <option key={key} value={key}>{val.label}</option>
                ))}
              </select>
            </div>

            {/* Custom Dimensions */}
            {paperType === 'Custom' && (
              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#aaa' }}>Width (mm)</label>
                  <input
                    type="number"
                    value={customW}
                    onChange={(e) => setCustomW(Math.max(50, parseFloat(e.target.value) || 100))}
                    style={{
                      width: '100%', padding: '6px', backgroundColor: '#262630', border: '1px solid #3d3d50', borderRadius: '4px', color: '#fff', fontSize: '13px',
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '11px', color: '#aaa' }}>Height (mm)</label>
                  <input
                    type="number"
                    value={customH}
                    onChange={(e) => setCustomH(Math.max(50, parseFloat(e.target.value) || 100))}
                    style={{
                      width: '100%', padding: '6px', backgroundColor: '#262630', border: '1px solid #3d3d50', borderRadius: '4px', color: '#fff', fontSize: '13px',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Orientation */}
            <div>
              <label style={{ fontSize: '12px', color: '#aaa', display: 'block', marginBottom: '6px' }}>
                Orientation
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setOrientation('portrait')}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: '6px',
                    border: orientation === 'portrait' ? '1px solid #00e676' : '1px solid #3d3d50',
                    backgroundColor: orientation === 'portrait' ? 'rgba(0,230,118,0.15)' : '#262630',
                    color: orientation === 'portrait' ? '#00e676' : '#ccc',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  📱 Portrait ({Math.min(pw, ph)} × {Math.max(pw, ph)} mm)
                </button>
                <button
                  type="button"
                  onClick={() => setOrientation('landscape')}
                  style={{
                    flex: 1,
                    padding: '8px',
                    borderRadius: '6px',
                    border: orientation === 'landscape' ? '1px solid #00e676' : '1px solid #3d3d50',
                    backgroundColor: orientation === 'landscape' ? 'rgba(0,230,118,0.15)' : '#262630',
                    color: orientation === 'landscape' ? '#00e676' : '#ccc',
                    fontSize: '12px',
                    cursor: 'pointer',
                  }}
                >
                  🖥 Landscape ({Math.max(pw, ph)} × {Math.min(pw, ph)} mm)
                </button>
              </div>
            </div>

            {/* Marker Size */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <label style={{ fontSize: '12px', color: '#aaa' }}>ArUco Marker Size</label>
                <span style={{ fontSize: '12px', color: '#00e676', fontWeight: 600 }}>{markerSizeMm} mm</span>
              </div>
              <input
                type="range"
                min="15"
                max="80"
                step="1"
                value={markerSizeMm}
                onChange={(e) => setMarkerSizeMm(parseFloat(e.target.value))}
                style={{ width: '100%', accentColor: '#00e676' }}
              />
            </div>

            {/* Offsets X and Y */}
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', color: '#aaa' }}>Margin X Offset (mm)</label>
                <input
                  type="number"
                  step="0.1"
                  value={marginXMm}
                  onChange={(e) => setMarginXMm(parseFloat(e.target.value) || 30)}
                  style={{
                    width: '100%', padding: '6px', backgroundColor: '#262630', border: '1px solid #3d3d50', borderRadius: '4px', color: '#fff', fontSize: '13px',
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '11px', color: '#aaa' }}>Margin Y Offset (mm)</label>
                <input
                  type="number"
                  step="0.1"
                  value={marginYMm}
                  onChange={(e) => setMarginYMm(parseFloat(e.target.value) || 30)}
                  style={{
                    width: '100%', padding: '6px', backgroundColor: '#262630', border: '1px solid #3d3d50', borderRadius: '4px', color: '#fff', fontSize: '13px',
                  }}
                />
              </div>
            </div>

            {/* Include Ruler Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
              <input
                type="checkbox"
                id="showRuler"
                checked={showRuler}
                onChange={(e) => setShowRuler(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#00e676', cursor: 'pointer' }}
              />
              <label htmlFor="showRuler" style={{ fontSize: '12px', color: '#ccc', cursor: 'pointer' }}>
                Include Metric Scale Ruler (mm / cm)
              </label>
            </div>

            {/* Scale Warning Box */}
            <div style={{
              marginTop: 'auto',
              padding: '10px 12px',
              backgroundColor: 'rgba(211, 47, 47, 0.1)',
              border: '1px solid rgba(211, 47, 47, 0.3)',
              borderRadius: '6px',
              color: '#ff8a80',
              fontSize: '11px',
              lineHeight: '1.4',
            }}>
              <strong>⚠️ Printing Instructions:</strong><br />
              Always print at <strong>100% Scale / Actual Size</strong>. Do NOT enable "Fit to Page" in your printer dialog, or homography scaling will be altered.
            </div>
          </div>

          {/* Right Live SVG Preview */}
          <div style={{
            flex: 1,
            backgroundColor: '#121215',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}>
            {loading && (
              <div style={{
                position: 'absolute', top: '10px', right: '10px', fontSize: '12px', color: '#00e676',
              }}>
                Rendering Preview...
              </div>
            )}
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                filter: 'drop-shadow(0 10px 25px rgba(0,0,0,0.6))',
              }}
              dangerouslySetInnerHTML={{ __html: svgPreview }}
            />
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid #2d2d38',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#18181c',
        }}>
          <span style={{ fontSize: '12px', color: '#888' }}>
            Current Sheet: <strong>{paperType}</strong> ({pw.toFixed(1)} × {ph.toFixed(1)} mm)
          </span>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => handleDownload('svg')}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid #3d3d50',
                backgroundColor: '#262630',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Download SVG Vector
            </button>
            <button
              onClick={() => handleDownload('pdf')}
              style={{
                padding: '8px 20px',
                borderRadius: '6px',
                border: 'none',
                backgroundColor: '#00e676',
                color: '#000',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0,230,118,0.3)',
              }}
            >
              📥 Download Printable PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
