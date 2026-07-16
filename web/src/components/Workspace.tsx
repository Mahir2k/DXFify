import type {
  ConversionErrorDetails,
  ConversionResult,
  ConversionSettings,
  PreviewTab,
  ToolId,
} from '../types';
import { ArtifactList } from './ArtifactList';
import { DxfPreview } from './DxfPreview';
import { ImagePreview } from './ImagePreview';
import { ReportPanel } from './ReportPanel';
import { SettingsPanel } from './SettingsPanel';
import { Toolbar } from './Toolbar';

interface WorkspaceProps {
  result: ConversionResult | null;
  reportError: ConversionErrorDetails | null;
  originalImageUrl: string | null;
  uploadedFilename: string | null;
  selectedPreviewTab: PreviewTab;
  selectedTool: ToolId;
  settings: ConversionSettings;
  onUpload: (file: File) => void;
  onPreviewTabChange: (tab: PreviewTab) => void;
  onToolChange: (tool: ToolId) => void;
  onSettingsChange: (settings: ConversionSettings) => void;
}

export function Workspace({
  result,
  reportError,
  originalImageUrl,
  uploadedFilename,
  selectedPreviewTab,
  selectedTool,
  settings,
  onUpload,
  onPreviewTabChange,
  onToolChange,
  onSettingsChange,
}: WorkspaceProps) {
  return (
    <section className="workspace-grid">
      <div className="preview-row">
        <DxfPreview result={result} selectedTool={selectedTool} showGrid />
        <ImagePreview
          result={result}
          originalImageUrl={originalImageUrl}
          uploadedFilename={uploadedFilename}
          selectedTab={selectedPreviewTab}
          onUpload={onUpload}
          onTabChange={onPreviewTabChange}
        />
      </div>

      <div className="bottom-row">
        <ReportPanel result={result} error={reportError} />
        <SettingsPanel settings={settings} onChange={onSettingsChange} />
        <ArtifactList result={result} />
      </div>
    </section>
  );
}
