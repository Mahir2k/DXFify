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
  error: ConversionErrorDetails | null,
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
  const [error, setError] = useState<ConversionErrorDetails | null>(null);

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
      setError(err instanceof ConversionApiError
        ? err.details
        : { message: err instanceof Error ? err.message : 'Conversion failed.' });
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

      <Workspace
        result={conversionResult}
        reportError={error}
        originalImageUrl={originalImageUrl}
        uploadedFilename={uploadedFile?.name ?? null}
        selectedPreviewTab={selectedPreviewTab}
        selectedTool={selectedTool}
        settings={conversionSettings}
        onUpload={handleUpload}
        onPreviewTabChange={setSelectedPreviewTab}
        onToolChange={setSelectedTool}
        onSettingsChange={setConversionSettings}
      />
    </main>
  );
}
