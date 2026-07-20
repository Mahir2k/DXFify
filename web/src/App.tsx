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
