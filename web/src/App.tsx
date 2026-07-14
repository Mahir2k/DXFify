import { useMemo, useState } from 'react';
import { runConversion } from './api/convertClient';
import { DxfPreview } from './components/DxfPreview';
import { ImagePreview } from './components/ImagePreview';
import { ReportPanel } from './components/ReportPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Toolbar } from './components/Toolbar';
import { TopBar } from './components/TopBar';
import type {
  ConversionReport,
  ConversionResult,
  ConversionSettings,
  PreviewTab,
  StatusMessage,
  ToolId,
} from './types';

const defaultSettings: ConversionSettings = {
  segmentationMethod: 'gradient',
  pixelsPerMm: 4,
  markerSize: 40,
  sheetSize: 'a4',
  fitArcs: false,
  snapRightAngles: false,
  simplificationStrength: 'medium',
  holeSensitivity: 50,
};

function getStatus(
  uploadedFile: File | null,
  isConverting: boolean,
  result: ConversionResult | null,
  report: ConversionReport | null,
  error: string | null,
): StatusMessage {
  if (isConverting) return 'Converting...';
  if (error) return 'Conversion failed';
  if (report && (report.markersDetected ?? 4) < 4) return 'Bad calibration, recapture recommended';
  if (result) return 'Conversion successful';
  if (uploadedFile) return 'Ready to convert';
  return 'Waiting for upload';
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
  const [error, setError] = useState<string | null>(null);

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
  };

  const handleConvert = async () => {
    if (!uploadedFile || isConverting) return;
    setIsConverting(true);
    setError(null);
    setConversionResult(null);
    setReport(null);
    setSelectedPreviewTab('debug');

    try {
      const result = await runConversion(uploadedFile, conversionSettings);
      setConversionResult(result);
      setReport(result.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed.');
      setSelectedPreviewTab('original');
    } finally {
      setIsConverting(false);
    }
  };

  return (
    <main className="app-shell">
      <TopBar
        status={status}
        canRun={Boolean(uploadedFile) && !isConverting}
        canDownload={Boolean(conversionResult?.files.dxf)}
        isConverting={isConverting}
        dxfUrl={conversionResult?.files.dxf ?? null}
        onUpload={handleUpload}
        onRun={handleConvert}
        onReset={handleReset}
      />

      <section className="workspace-grid">
        <div className="preview-row">
          <DxfPreview result={conversionResult} showGrid />
          <ImagePreview
            originalImageUrl={originalImageUrl}
            debugImageUrl={conversionResult?.files.debug ?? null}
            selectedTab={selectedPreviewTab}
            onTabChange={setSelectedPreviewTab}
          />
        </div>

        <div className="bottom-row">
          <ReportPanel report={report} error={error} />
          <SettingsPanel settings={conversionSettings} onChange={setConversionSettings} />
        </div>

        <Toolbar selectedTool={selectedTool} onSelectTool={setSelectedTool} />
      </section>
    </main>
  );
}
