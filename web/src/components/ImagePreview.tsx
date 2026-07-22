import { useEffect, useRef, useState } from 'react';
import type { ConversionResult, PreviewTab, Viewport, GeometryEntity } from '../types';
import { Ruler } from './Ruler';

interface ImagePreviewProps {
  result: ConversionResult | null;
  originalImageUrl: string | null;
  uploadedFilename: string | null;
  selectedTab: PreviewTab;
  onUpload: (file: File) => void;
  onTabChange: (tab: PreviewTab) => void;
  viewport: Viewport | null;
  onViewportChange: (vp: Viewport) => void;
  onImgNaturalSizeChange: (size: { width: number; height: number }) => void;
  entities?: GeometryEntity[];
  rotationTransforms?: Array<{ angle: number; cx: number; cy: number }>;
  hoveredCoord?: { x: number; y: number } | null;
  onHoverCoord?: (coord: { x: number; y: number } | null) => void;
  activeDrawing?: any;
}

const tabs: Array<{ id: PreviewTab; label: string }> = [
  { id: 'original', label: 'Original' },
  { id: 'debug', label: 'Debug Overlay' },
  { id: 'mask', label: 'Mask' },
  { id: 'holes', label: 'Holes' },
];

function findArtifact(files: ConversionResult['files'] | undefined, predicate: (name: string, url: string) => boolean) {
  if (!files) return null;
  const match = Object.values(files)
    .filter((url): url is string => Boolean(url))
    .find((url) => {
      const filename = decodeURIComponent(url.split('/').pop() ?? '').toLowerCase();
      return predicate(filename, url.toLowerCase());
    });
  return match ?? null;
}

function filenameFromUrl(url: string) {
  return decodeURIComponent(url.split('/').pop() ?? url);
}

function solveHomography(src: [number, number][], dst: [number, number][]): number[] | null {
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    B.push(v);
  }
  for (let i = 0; i < 8; i++) {
    let maxRow = i;
    for (let k = i + 1; k < 8; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [B[i], B[maxRow]] = [B[maxRow], B[i]];
    if (Math.abs(A[i][i]) < 1e-8) return null;
    for (let k = i + 1; k < 8; k++) {
      const c = -A[k][i] / A[i][i];
      for (let j = i; j < 8; j++) {
        if (i === j) A[k][j] = 0;
        else A[k][j] += c * A[i][j];
      }
      B[k] += c * B[i];
    }
  }
  const H = new Array(9);
  H[8] = 1;
  for (let i = 7; i >= 0; i--) {
    let sum = B[i];
    for (let j = i + 1; j < 8; j++) {
      sum -= A[i][j] * H[j];
    }
    H[i] = sum / A[i][i];
  }
  return H;
}

function transformHomography(H: number[], x: number, y: number): [number, number] {
  const w = H[6] * x + H[7] * y + H[8];
  if (Math.abs(w) < 1e-6) return [x, y];
  const u = (H[0] * x + H[1] * y + H[2]) / w;
  const v = (H[3] * x + H[4] * y + H[5]) / w;
  return [u, v];
}

export function ImagePreview({
  result,
  originalImageUrl,
  uploadedFilename,
  selectedTab,
  onUpload,
  onTabChange,
  viewport,
  onViewportChange,
  onImgNaturalSizeChange,
  entities = [],
  rotationTransforms = [],
  hoveredCoord = null,
  onHoverCoord,
  activeDrawing = null,
}: ImagePreviewProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  const files = result?.files;
  const sourceImageUrl = files?.original ?? originalImageUrl;
  const debugImageUrl = files?.debug ?? findArtifact(files, (name) => name === 'result.dbg.png');
  const maskImageUrl = findArtifact(files, (name) => name.includes('mask') && !name.includes('hole'));
  const holeImageUrl = findArtifact(files, (name) => name.includes('hole'));
  const activeImage =
    selectedTab === 'debug'
      ? debugImageUrl
      : selectedTab === 'mask'
        ? maskImageUrl
        : selectedTab === 'holes'
          ? holeImageUrl
          : sourceImageUrl;

  const title = tabs.find((tab) => tab.id === selectedTab)?.label ?? 'Image Preview';
  const displayFilename = activeImage ? filenameFromUrl(activeImage) : uploadedFilename;
  
  const emptyCopy = {
    original: {
      title: 'No upload yet',
      body: 'Click or drop an image here. Use a calibrated ArUco sheet photo.',
    },
    debug: {
      title: 'No debug image yet',
      body: 'Run conversion to inspect the backend overlay.',
    },
    mask: {
      title: 'No mask artifact',
      body: 'This conversion did not return a mask image.',
    },
    holes: {
      title: 'No hole mask artifact',
      body: 'This conversion did not return a hole mask image.',
    },
  }[selectedTab];

  
  useEffect(() => {
    if (!activeImage) {
      setNaturalSize(null);
      return;
    }
    const img = new Image();
    img.src = activeImage;
    img.onload = () => {
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      setNaturalSize(size);
      onImgNaturalSizeChange(size);
    };
  }, [activeImage, onImgNaturalSizeChange]);

  const scale = result?.report?.pixelsPerMm || 1;
  const paperW = 210.0;
  const paperH = 297.0;
  const height = naturalSize?.height || 100;
  const width = naturalSize?.width || 100;

  const markerCx = 32.2;
  const markerCy = 34.2;

  const markerCenters = result?.report?.markerCenters;

  const homographyH = (() => {
    if (selectedTab !== 'original' || !markerCenters || !markerCenters['0'] || !markerCenters['1'] || !markerCenters['2'] || !markerCenters['3']) {
      return null;
    }
    const src: [number, number][] = [
      [markerCx * scale, (paperH - markerCy) * scale],
      [(paperW - markerCx) * scale, (paperH - markerCy) * scale],
      [markerCx * scale, markerCy * scale],
      [(paperW - markerCx) * scale, markerCy * scale],
    ];
    const dst: [number, number][] = [
      markerCenters['1'] as [number, number],
      markerCenters['0'] as [number, number],
      markerCenters['2'] as [number, number],
      markerCenters['3'] as [number, number],
    ];
    return solveHomography(src, dst);
  })();

  const homographyH_inv = (() => {
    if (selectedTab !== 'original' || !markerCenters || !markerCenters['0'] || !markerCenters['1'] || !markerCenters['2'] || !markerCenters['3']) {
      return null;
    }
    const src: [number, number][] = [
      [markerCx * scale, (paperH - markerCy) * scale],
      [(paperW - markerCx) * scale, (paperH - markerCy) * scale],
      [markerCx * scale, markerCy * scale],
      [(paperW - markerCx) * scale, markerCy * scale],
    ];
    const dst: [number, number][] = [
      markerCenters['1'] as [number, number],
      markerCenters['0'] as [number, number],
      markerCenters['2'] as [number, number],
      markerCenters['3'] as [number, number],
    ];
    return solveHomography(dst, src);
  })();

  const mapPoint = (px: number, py: number): [number, number] => {
    if (homographyH) {
      return transformHomography(homographyH, px, py);
    }
    return [px, py];
  };

  const activeViewport = viewport || {
    x: 0,
    y: -height,
    w: width,
    h: height,
  };

  const x = activeViewport.x;
  const y = activeViewport.y;
  const w = activeViewport.w;
  const h = activeViewport.h;

  
  const imgX = x * scale;
  const imgY = height + y * scale;
  const imgW = w * scale;
  const imgH = h * scale;

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    setIsDragging(true);
    setLastPos({ x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (isDragging) {
      const dx = e.clientX - lastPos.x;
      const dy = e.clientY - lastPos.y;

      if (svgRef.current) {
        const ctm = svgRef.current.getScreenCTM();
        if (ctm) {
          const inv = ctm.inverse();
          const dxPx = dx * inv.a;
          const dyPx = dy * inv.d;

          const newImgX = imgX - dxPx;
          const newImgY = imgY - dyPx;

          onViewportChange({
            x: newImgX / scale,
            y: (newImgY - height) / scale,
            w: w,
            h: h,
          });
        }
      }
      setLastPos({ x: e.clientX, y: e.clientY });
    }

    if (svgRef.current && onHoverCoord) {
      const svg = svgRef.current;
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const transformed = pt.matrixTransform(ctm.inverse());
        let px = transformed.x;
        let py = transformed.y;

        for (let i = rotationTransforms.length - 1; i >= 0; i--) {
          const t = rotationTransforms[i];
          const pivotX = t.cx * scale;
          const pivotY = height - t.cy * scale;
          const rad = -t.angle * (Math.PI / 180);
          const dx = px - pivotX;
          const dy = py - pivotY;
          px = pivotX + dx * Math.cos(rad) - dy * Math.sin(rad);
          py = pivotY + dx * Math.sin(rad) + dy * Math.cos(rad);
        }

        if (homographyH_inv) {
          const [unWarpX, unWarpY] = transformHomography(homographyH_inv, px, py);
          px = unWarpX;
          py = unWarpY;
        }

        const x_mm = px / scale;
        const y_mm = (height - py) / scale;
        onHoverCoord({ x: x_mm, y: y_mm });
      }
    }
  };

  const handlePointerLeave = () => {
    setIsDragging(false);
    if (onHoverCoord) {
      onHoverCoord(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;

    if (svgRef.current) {
      const svg = svgRef.current;
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const transformed = pt.matrixTransform(ctm.inverse());

        const cxPx = transformed.x;
        const cyPx = transformed.y;

        const newW = Math.max(10, Math.min(100000, imgW / zoomFactor));
        const newH = Math.max(10, Math.min(100000, imgH / zoomFactor));

        const relX = (cxPx - imgX) / imgW;
        const relY = (cyPx - imgY) / imgH;

        const newX = cxPx - relX * newW;
        const newY = cyPx - relY * newH;

        onViewportChange({
          x: newX / scale,
          y: (newY - height) / scale,
          w: newW / scale,
          h: newH / scale,
        });
      }
    }
  };

  const acceptUpload = (file: File | undefined) => {
    if (file?.type.startsWith('image/')) onUpload(file);
  };

  const currentZoomPercentage = Math.round((width / imgW) * 100);

  return (
    <section className="panel image-panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
        </div>
        <div className="tab-row">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={selectedTab === tab.id ? 'active' : ''}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeImage ? (
        <div className="canvas-area">
          <div className="ruler-frame">
            <div className="ruler-corner" aria-hidden="true">px</div>
            <Ruler orientation="horizontal" min={imgX} max={imgX + imgW} />
            <Ruler orientation="vertical" min={imgY} max={imgY + imgH} />
            <div className="image-canvas">
              <svg
                ref={svgRef}
                viewBox={`${imgX} ${imgY} ${imgW} ${imgH}`}
                style={{ width: '100%', height: '100%', cursor: isDragging ? 'grabbing' : 'grab' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
                onWheel={handleWheel}
              >
                <g transform={rotationTransforms.map(t => `rotate(${t.angle}, ${t.cx * scale}, ${height - t.cy * scale})`).join(' ')}>
                  <image
                    href={activeImage}
                    x={0}
                    y={0}
                    width={width}
                    height={height}
                  />

                  {activeImage === sourceImageUrl && result?.report?.markerCenters && (
                    <g style={{ pointerEvents: 'none' }}>
                      {result.report.markerCenters['0'] && result.report.markerCenters['1'] && result.report.markerCenters['2'] && result.report.markerCenters['3'] && (
                        <polygon
                          points={`${result.report.markerCenters['0'][0]},${result.report.markerCenters['0'][1]} ${result.report.markerCenters['1'][0]},${result.report.markerCenters['1'][1]} ${result.report.markerCenters['2'][0]},${result.report.markerCenters['2'][1]} ${result.report.markerCenters['3'][0]},${result.report.markerCenters['3'][1]}`}
                          fill="rgba(76, 217, 100, 0.15)"
                          stroke="#4cd964"
                          strokeWidth={Math.max(1, 2 * (imgW / 400))}
                        />
                      )}
                      {Object.entries(result.report.markerCenters).map(([id, pt]) => {
                        const [mx, my] = pt as [number, number];
                        return (
                          <g key={id}>
                            <circle
                              cx={mx}
                              cy={my}
                              r={Math.max(3, 6 * (imgW / 400))}
                              fill="#4cd964"
                              stroke="#ffffff"
                              strokeWidth={Math.max(0.5, 1.5 * (imgW / 400))}
                            />
                            <text
                              x={mx}
                              y={my + Math.max(8, 18 * (imgW / 400))}
                              fill="#4cd964"
                              fontSize={Math.max(6, 12 * (imgW / 400))}
                              fontWeight="bold"
                              textAnchor="middle"
                              style={{ filter: 'drop-shadow(1px 1px 1px rgba(0,0,0,0.8))' }}
                            >
                              ID {id}
                            </text>
                          </g>
                        );
                      })}
                    </g>
                  )}
                </g>

                <g style={{ opacity: 0.8, pointerEvents: 'none' }}>
                  {entities.map((entity, idx) => {
                    const isHole = entity.layer === 'HOLES';
                    const color = isHole ? '#ff3b30' : '#00e5ff';
                    if (entity.type === 'circle' && entity.cx != null && entity.cy != null && entity.r != null) {
                      if (homographyH) {
                        const numPts = 32;
                        const pts: string[] = [];
                        for (let i = 0; i < numPts; i++) {
                          const theta = (i * 2 * Math.PI) / numPts;
                          const rx = (entity.cx + entity.r * Math.cos(theta)) * scale;
                          const ry = height - (entity.cy + entity.r * Math.sin(theta)) * scale;
                          const [mx, my] = mapPoint(rx, ry);
                          pts.push(`${mx.toFixed(2)},${my.toFixed(2)}`);
                        }
                        return (
                          <polygon
                            key={idx}
                            points={pts.join(' ')}
                            fill="none"
                            stroke={color}
                            strokeWidth={1.2 * (imgW / 400)}
                          />
                        );
                      }
                      return (
                        <circle
                          key={idx}
                          cx={entity.cx * scale}
                          cy={height - entity.cy * scale}
                          r={entity.r * scale}
                          fill="none"
                          stroke={color}
                          strokeWidth={1.2 * (imgW / 400)}
                        />
                      );
                    } else if (entity.type === 'polyline' && entity.points) {
                      const d = entity.points.map((p, i) => {
                        const px = p[0] * scale;
                        const py = height - p[1] * scale;
                        const [mx, my] = mapPoint(px, py);
                        return `${i === 0 ? 'M' : 'L'}${mx.toFixed(2)} ${my.toFixed(2)}`;
                      }).join(' ') + (entity.closed ? ' Z' : '');
                      return (
                        <path
                          key={idx}
                          d={d}
                          fill="none"
                          stroke={color}
                          strokeWidth={1.2 * (imgW / 400)}
                        />
                      );
                    }
                    return null;
                  })}
                  {hoveredCoord && (() => {
                    const [hx, hy] = mapPoint(hoveredCoord.x * scale, height - hoveredCoord.y * scale);
                    return (
                      <g transform={`translate(${hx}, ${hy})`} style={{ pointerEvents: 'none' }}>
                        <circle r={6 * (imgW / 400)} fill="none" stroke="#ff9800" strokeWidth={1.5 * (imgW / 400)} />
                        <line x1={-12 * (imgW / 400)} y1={0} x2={12 * (imgW / 400)} y2={0} stroke="#ff9800" strokeWidth={1.2 * (imgW / 400)} />
                        <line x1={0} y1={-12 * (imgW / 400)} x2={0} y2={12 * (imgW / 400)} stroke="#ff9800" strokeWidth={1.2 * (imgW / 400)} />
                      </g>
                    );
                  })()}
                </g>
              </svg>
            </div>
          </div>

          <div className="canvas-status-bar">
            <span className="tabular-nums" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {displayFilename ?? '—'}
            </span>
            <span style={{ marginLeft: 'auto' }}>
              Zoom <strong className="tabular-nums">{currentZoomPercentage}%</strong>
            </span>
            <span style={{ marginLeft: '16px' }}>
              <strong className="tabular-nums">
                {naturalSize ? `${naturalSize.width} × ${naturalSize.height}` : '—'}
              </strong> px
            </span>
            <span>Tab <strong>{title}</strong></span>
          </div>
        </div>
      ) : (
        <div className="image-stage">
          {selectedTab === 'original' ? (
            <button
              className={`upload-dropzone ${isDragging ? 'dragging' : ''}`}
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                acceptUpload(event.dataTransfer.files[0]);
              }}
            >
              <strong>{emptyCopy.title}</strong>
              <span>{emptyCopy.body}</span>
              <em>{uploadedFilename ?? 'No file selected'}</em>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                onChange={(event) => acceptUpload(event.target.files?.[0])}
              />
            </button>
          ) : (
            <div className="empty-state">
              <strong>{emptyCopy.title}</strong>
              <span>{emptyCopy.body}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
