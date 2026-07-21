import { useMemo, useState } from 'react';
import { ConversionApiError, runConversion } from './api/convertClient';
import { TopBar } from './components/TopBar';
import { Workspace } from './components/Workspace';
import type {
  ConversionErrorDetails,
  ConversionReport,
  ConversionResult,
  ConversionSettings,
  PreviewTab,
  StatusMessage,
  ToolId,
  Viewport,
  GeometryEntity,
} from './types';

const defaultSettings: ConversionSettings = {
  sheetSize: 'a4',
};

function getStatus(
  uploadedFile: File | null,
  isConverting: boolean,
  result: ConversionResult | null,
  report: ConversionReport | null,
  error: ConversionErrorDetails | null,
): StatusMessage {
  if (isConverting) return 'Converting...';
  if (error) return 'Conversion failed';
  if (report && (report.markersDetected ?? 4) < 4) return 'Bad calibration, recapture recommended';
  if (result) return 'Conversion successful';
  if (uploadedFile) return 'Ready to convert';
  return 'Waiting for upload';
}

function getDefaultViewport(
  result: ConversionResult | null,
  imgSize: { width: number; height: number } | null
): Viewport {
  if (result?.report?.bboxWidthMm != null) {
    const baseMinX = (result.report.bboxMinXMm || 0) - 10;
    const baseMinY = result.report.bboxMaxYMm ? -(result.report.bboxMaxYMm + 10) : 0;
    const baseWidth = (result.report.bboxWidthMm || 100) + 20;
    const baseHeight = (result.report.bboxHeightMm || 100) + 20;
    return { x: baseMinX, y: baseMinY, w: baseWidth, h: baseHeight };
  }
  if (imgSize) {
    return { x: 0, y: -imgSize.height, w: imgSize.width, h: imgSize.height };
  }
  return { x: 0, y: -100, w: 120, h: 120 };
}

function generateDxfString(entities: GeometryEntity[]): string {
  let out = '';
  
  out += '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n';
  out += '0\nSECTION\n2\nTABLES\n0\nLTYPE\n72\n65\n70\n64\n3\nContinuous\n73\n0\n40\n0.0\n0\nENDSEC\n';
  out += '0\nSECTION\n2\nENTITIES\n';

  for (const ent of entities) {
    if (ent.type === 'circle' && ent.cx != null && ent.cy != null && ent.r != null) {
      out += '0\nCIRCLE\n';
      out += `8\n${ent.layer}\n`;
      out += `10\n${ent.cx.toFixed(4)}\n`;
      out += `20\n${ent.cy.toFixed(4)}\n`;
      out += `40\n${ent.r.toFixed(4)}\n`;
    } else if (ent.type === 'polyline' && ent.points && ent.points.length > 0) {
      out += '0\nLWPOLYLINE\n';
      out += `8\n${ent.layer}\n`;
      out += `90\n${ent.points.length}\n`;
      out += `70\n${ent.closed ? 1 : 0}\n`;
      for (const pt of ent.points) {
        out += `10\n${pt[0].toFixed(4)}\n`;
        out += `20\n${pt[1].toFixed(4)}\n`;
      }
    }
  }

  out += '0\nENDSEC\n0\nEOF\n';
  return out;
}

function generateSvgString(entities: GeometryEntity[]): string {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ent of entities) {
    if (ent.type === 'circle' && ent.cx != null && ent.cy != null && ent.r != null) {
      minX = Math.min(minX, ent.cx - ent.r);
      minY = Math.min(minY, ent.cy - ent.r);
      maxX = Math.max(maxX, ent.cx + ent.r);
      maxY = Math.max(maxY, ent.cy + ent.r);
    } else if (ent.type === 'polyline' && ent.points) {
      for (const pt of ent.points) {
        minX = Math.min(minX, pt[0]);
        minY = Math.min(minY, pt[1]);
        maxX = Math.max(maxX, pt[0]);
        maxY = Math.max(maxY, pt[1]);
      }
    }
  }

  if (minX === Infinity) {
    minX = 0; minY = 0; maxX = 100; maxY = 100;
  } else {
    minX -= 5; minY -= 5; maxX += 5; maxY += 5;
  }

  const w = maxX - minX;
  const h = maxY - minY;

  let out = `<?xml version="1.0" encoding="utf-8"?>\n`;
  out += `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${-maxY} ${w} ${h}" width="100%" height="100%">\n`;
  out += `  <rect width="100%" height="100%" fill="#1c1c1e" />\n`;
  out += `  <g transform="scale(1, -1)">\n`;

  for (const ent of entities) {
    const isHole = ent.layer === 'HOLES';
    const isDetails = ent.layer === 'DETAILS';
    const color = isHole ? '#5b9bd5' : isDetails ? '#10b981' : '#ffffff';

    if (ent.type === 'circle' && ent.cx != null && ent.cy != null && ent.r != null) {
      out += `    <circle cx="${ent.cx}" cy="${ent.cy}" r="${ent.r}" fill="none" stroke="${color}" stroke-width="0.5" />\n`;
    } else if (ent.type === 'polyline' && ent.points && ent.points.length > 0) {
      const d = ent.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]} ${p[1]}`).join(' ') + (ent.closed ? ' Z' : '');
      out += `    <path d="${d}" fill="none" stroke="${color}" stroke-width="0.5" />\n`;
    }
  }

  out += `  </g>\n`;
  out += `</svg>\n`;
  return out;
}

function generatePdfBlob(entities: GeometryEntity[]): Blob {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ent of entities) {
    if (ent.type === 'circle' && ent.cx != null && ent.cy != null && ent.r != null) {
      minX = Math.min(minX, ent.cx - ent.r);
      minY = Math.min(minY, ent.cy - ent.r);
      maxX = Math.max(maxX, ent.cx + ent.r);
      maxY = Math.max(maxY, ent.cy + ent.r);
    } else if (ent.type === 'polyline' && ent.points) {
      for (const pt of ent.points) {
        minX = Math.min(minX, pt[0]);
        minY = Math.min(minY, pt[1]);
        maxX = Math.max(maxX, pt[0]);
        maxY = Math.max(maxY, pt[1]);
      }
    }
  }

  if (minX === Infinity) {
    minX = 0; minY = 0; maxX = 100; maxY = 100;
  } else {
    minX -= 5; minY -= 5; maxX += 5; maxY += 5;
  }

  const w = maxX - minX;
  const h = maxY - minY;

  const mmToPt = 2.834645;
  const pageW = w * mmToPt;
  const pageH = h * mmToPt;

  let stream = '';
  stream += '0.5 w\n';

  for (const ent of entities) {
    const isHole = ent.layer === 'HOLES';
    const isDetails = ent.layer === 'DETAILS';
    if (isHole) {
      stream += '0.35 0.61 0.84 RG\n';
    } else if (isDetails) {
      stream += '0.06 0.72 0.50 RG\n';
    } else {
      stream += '0 0 0 RG\n';
    }

    if (ent.type === 'circle' && ent.cx != null && ent.cy != null && ent.r != null) {
      const cx = (ent.cx - minX) * mmToPt;
      const cy = (ent.cy - minY) * mmToPt;
      const r = ent.r * mmToPt;
      
      const segments = 32;
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const px = cx + Math.cos(theta) * r;
        const py = cy + Math.sin(theta) * r;
        if (i === 0) {
          stream += `${px.toFixed(2)} ${py.toFixed(2)} m\n`;
        } else {
          stream += `${px.toFixed(2)} ${py.toFixed(2)} l\n`;
        }
      }
      stream += 'S\n';
    } else if (ent.type === 'polyline' && ent.points && ent.points.length > 0) {
      ent.points.forEach((pt, idx) => {
        const px = (pt[0] - minX) * mmToPt;
        const py = (pt[1] - minY) * mmToPt;
        if (idx === 0) {
          stream += `${px.toFixed(2)} ${py.toFixed(2)} m\n`;
        } else {
          stream += `${px.toFixed(2)} ${py.toFixed(2)} l\n`;
        }
      });
      if (ent.closed) {
        stream += 'h\n';
      }
      stream += 'S\n';
    }
  }

  const objects: string[] = [];
  const addObject = (content: string) => {
    objects.push(`${objects.length + 1} 0 obj\n${content}\nendobj`);
    return objects.length;
  };

  const pageObj = `<<
  /Type /Page
  /Parent 2 0 R
  /Resources << >>
  /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}]
  /Contents 4 0 R
>>`;

  const pagesObj = `<<
  /Type /Pages
  /Kids [3 0 R]
  /Count 1
>>`;

  const catalogObj = `<<
  /Type /Catalog
  /Pages 2 0 R
>>`;

  const contentStreamObj = `<<
  /Length ${stream.length}
>>
stream
${stream}endstream`;

  addObject(catalogObj);
  addObject(pagesObj);
  addObject(pageObj);
  addObject(contentStreamObj);

  let pdfText = `%PDF-1.4\n`;
  const offsets: number[] = [];
  
  objects.forEach((obj, idx) => {
    offsets.push(pdfText.length);
    pdfText += `${idx + 1} 0 obj\n` + obj.substring(obj.indexOf('\n') + 1) + '\n';
  });

  const xrefOffset = pdfText.length;
  pdfText += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(offset => {
    const padded = ('0000000000' + offset).slice(-10);
    pdfText += `${padded} 00000 n \n`;
  });

  pdfText += `trailer\n<<\n  /Size ${objects.length + 1}\n  /Root 1 0 R\n>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const buf = new ArrayBuffer(pdfText.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0; i < pdfText.length; i++) {
    bufView[i] = pdfText.charCodeAt(i);
  }
  return new Blob([buf], { type: 'application/pdf' });
}


export default function App() {
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const [selectedPreviewTab, setSelectedPreviewTab] = useState<PreviewTab>('original');
  const [selectedTool, setSelectedTool] = useState<ToolId>('select');
  const [conversionSettings, setConversionSettings] = useState<ConversionSettings>(defaultSettings);
  const [isConverting, setIsConverting] = useState(false);
  const [conversionResult, setConversionResult] = useState<ConversionResult | null>(null);
  const [report, setReport] = useState<ConversionReport | null>(null);
  const [error, setError] = useState<ConversionErrorDetails | null>(null);

  
  const [gridEnabled, setGridEnabled] = useState(true);
  const [showToolbox, setShowToolbox] = useState(true);
  const [showBottomPanels, setShowBottomPanels] = useState(true);
  const [imgNaturalSize, setImgNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [viewport, setViewport] = useState<Viewport | null>(null);

  
  const [entities, setEntities] = useState<GeometryEntity[]>([]);
  const [history, setHistory] = useState<GeometryEntity[][]>([]);
  const [redoStack, setRedoStack] = useState<GeometryEntity[][]>([]);

  
  const [brushShape, setBrushShape] = useState<'circle' | 'square'>('circle');
  const [brushRadius, setBrushRadius] = useState<number>(15);

  const status = useMemo(
    () => getStatus(uploadedFile, isConverting, conversionResult, report, error),
    [uploadedFile, isConverting, conversionResult, report, error],
  );

  const handleUpload = (file: File) => {
    if (originalImageUrl) URL.revokeObjectURL(originalImageUrl);
    setUploadedFile(file);
    setOriginalImageUrl(URL.createObjectURL(file));
    setSelectedPreviewTab('original');
    setConversionResult(null);
    setReport(null);
    setError(null);
    setImgNaturalSize(null);
    setViewport(null);
    setEntities([]);
    setHistory([]);
    setRedoStack([]);
  };

  const handleReset = () => {
    if (originalImageUrl) URL.revokeObjectURL(originalImageUrl);
    setUploadedFile(null);
    setOriginalImageUrl(null);
    setSelectedPreviewTab('original');
    setSelectedTool('select');
    setConversionSettings(defaultSettings);
    setConversionResult(null);
    setReport(null);
    setError(null);
    setIsConverting(false);
    setImgNaturalSize(null);
    setViewport(null);
    setEntities([]);
    setHistory([]);
    setRedoStack([]);
  };

  const handleConvert = async () => {
    if (!uploadedFile || isConverting) return;
    setIsConverting(true);
    setError(null);
    setConversionResult(null);
    setReport(null);
    setSelectedPreviewTab('debug');
    setEntities([]);
    setHistory([]);
    setRedoStack([]);

    try {
      const result = await runConversion(uploadedFile, conversionSettings);
      setConversionResult(result);
      setReport(result.report);
      if (result.report?.entities) {
        setEntities(result.report.entities);
        setHistory([result.report.entities]);
        setRedoStack([]);
      }
      setViewport(getDefaultViewport(result, imgNaturalSize));
    } catch (err) {
      setError(err instanceof ConversionApiError
        ? err.details
        : { message: err instanceof Error ? err.message : 'Conversion failed.' });
      setSelectedPreviewTab('original');
    } finally {
      setIsConverting(false);
    }
  };

  const toggleGrid = () => setGridEnabled((g) => !g);
  const toggleToolbox = () => setShowToolbox((v) => !v);
  const toggleBottomPanels = () => setShowBottomPanels((v) => !v);

  const handleImgNaturalSizeChange = (size: { width: number; height: number }) => {
    setImgNaturalSize(size);
    setViewport((prev) => {
      if (prev) return prev;
      return getDefaultViewport(conversionResult, size);
    });
  };

  const handleZoomIn = () => {
    setViewport((vp) => {
      if (!vp) return null;
      const newW = vp.w / 1.2;
      const newH = vp.h / 1.2;
      const newX = vp.x + (vp.w - newW) / 2;
      const newY = vp.y + (vp.h - newH) / 2;
      return { x: newX, y: newY, w: newW, h: newH };
    });
  };

  const handleZoomOut = () => {
    setViewport((vp) => {
      if (!vp) return null;
      const newW = vp.w * 1.2;
      const newH = vp.h * 1.2;
      const newX = vp.x + (vp.w - newW) / 2;
      const newY = vp.y + (vp.h - newH) / 2;
      return { x: newX, y: newY, w: newW, h: newH };
    });
  };

  const handleFitToView = () => {
    setViewport(getDefaultViewport(conversionResult, imgNaturalSize));
  };

  
  const updateEntities = (newEntities: GeometryEntity[], commitToHistory: boolean = true) => {
    setEntities(newEntities);
    if (commitToHistory) {
      setHistory((prev) => {
        
        if (prev.length > 0 && prev[prev.length - 1] === newEntities) {
          return prev;
        }
        return [...prev, newEntities];
      });
      setRedoStack([]);
    }
  };

  const handleUndo = () => {
    if (history.length <= 1) return;
    const current = history[history.length - 1];
    const prev = history[history.length - 2];
    setHistory((h) => h.slice(0, -1));
    setEntities(prev);
    setRedoStack((r) => [current, ...r]);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[0];
    setRedoStack((r) => r.slice(1));
    setHistory((h) => [...h, next]);
    setEntities(next);
  };

  const handleToolChange = (tool: ToolId) => {
    if (tool === 'undo') {
      handleUndo();
    } else if (tool === 'redo') {
      handleRedo();
    } else {
      setSelectedTool(tool);
    }
  };

  const handleDownloadDxf = () => {
    if (entities.length === 0) return;
    const dxfText = generateDxfString(entities);
    const blob = new Blob([dxfText], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'result.dxf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadSvg = () => {
    if (entities.length === 0) return;
    const svgText = generateSvgString(entities);
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'result.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPdf = () => {
    if (entities.length === 0) return;
    const blob = generatePdfBlob(entities);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'result.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <TopBar
        status={status}
        canRun={Boolean(uploadedFile) && !isConverting}
        canDownload={entities.length > 0}
        isConverting={isConverting}
        dxfUrl={conversionResult?.files.dxf ?? null}
        onUpload={handleUpload}
        onRun={handleConvert}
        onReset={handleReset}
        selectedTool={selectedTool}
        onToolChange={handleToolChange}
        gridEnabled={gridEnabled}
        onToggleGrid={toggleGrid}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFitToView={handleFitToView}
        selectedPreviewTab={selectedPreviewTab}
        onPreviewTabChange={setSelectedPreviewTab}
        settings={conversionSettings}
        onSettingsChange={setConversionSettings}
        showToolbox={showToolbox}
        onToggleToolbox={toggleToolbox}
        showBottomPanels={showBottomPanels}
        onToggleBottomPanels={toggleBottomPanels}
        onDownload={handleDownloadDxf}
        onExportSvg={handleDownloadSvg}
        onExportPdf={handleDownloadPdf}
      />

      <Workspace
        result={conversionResult}
        reportError={error}
        originalImageUrl={originalImageUrl}
        uploadedFilename={uploadedFile?.name ?? null}
        selectedPreviewTab={selectedPreviewTab}
        selectedTool={selectedTool}
        settings={conversionSettings}
        gridEnabled={gridEnabled}
        showToolbox={showToolbox}
        showBottomPanels={showBottomPanels}
        viewport={viewport}
        onViewportChange={setViewport}
        onImgNaturalSizeChange={handleImgNaturalSizeChange}
        onFitToView={handleFitToView}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onUpload={handleUpload}
        onPreviewTabChange={setSelectedPreviewTab}
        onToolChange={handleToolChange}
        onSettingsChange={setConversionSettings}
        onToggleGrid={toggleGrid}
        entities={entities}
        onEntitiesChange={updateEntities}
        brushShape={brushShape}
        brushRadius={brushRadius}
        onBrushShapeChange={setBrushShape}
        onBrushRadiusChange={setBrushRadius}
      />
    </main>
  );
}
