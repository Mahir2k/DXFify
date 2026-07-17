import type {
  ConversionErrorDetails,
  ConversionResult,
  ConversionSettings,
  PreviewTab,
  ToolId,
  Viewport,
  GeometryEntity,
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
  gridEnabled: boolean;
  showToolbox: boolean;
  showBottomPanels: boolean;
  viewport: Viewport | null;
  onViewportChange: (vp: Viewport) => void;
  onImgNaturalSizeChange: (size: { width: number; height: number }) => void;
  onFitToView: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onUpload: (file: File) => void;
  onPreviewTabChange: (tab: PreviewTab) => void;
  onToolChange: (tool: ToolId) => void;
  onSettingsChange: (settings: ConversionSettings) => void;
  onToggleGrid: () => void;
  entities: GeometryEntity[];
  onEntitiesChange: (entities: GeometryEntity[], commit?: boolean) => void;
  brushShape?: 'circle' | 'square';
  brushRadius?: number;
  onBrushShapeChange?: (shape: 'circle' | 'square') => void;
  onBrushRadiusChange?: (radius: number) => void;
}

export function Workspace({
  result,
  reportError,
  originalImageUrl,
  uploadedFilename,
  selectedPreviewTab,
  selectedTool,
  settings,
  gridEnabled,
  showToolbox,
  showBottomPanels,
  viewport,
  onViewportChange,
  onImgNaturalSizeChange,
  onFitToView,
  onZoomIn,
  onZoomOut,
  onUpload,
  onPreviewTabChange,
  onToolChange,
  onSettingsChange,
  onToggleGrid,
  entities,
  onEntitiesChange,
  brushShape,
  brushRadius,
  onBrushShapeChange,
  onBrushRadiusChange,
}: WorkspaceProps) {
  const gridClass = [
    'workspace-grid',
    !showToolbox && 'no-toolbox',
    !showBottomPanels && 'no-bottom',
  ].filter(Boolean).join(' ');

  return (
    <section className={gridClass}>
      {showToolbox && (
        <Toolbar
          selectedTool={selectedTool}
          onSelectTool={onToolChange}
          brushShape={brushShape}
          brushRadius={brushRadius}
          onBrushShapeChange={onBrushShapeChange}
        />
      )}

      <div className="preview-row">
        <DxfPreview
          result={result}
          selectedTool={selectedTool}
          gridEnabled={gridEnabled}
          onToggleGrid={onToggleGrid}
          viewport={viewport}
          onViewportChange={onViewportChange}
          onFitToView={onFitToView}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          entities={entities}
          onEntitiesChange={onEntitiesChange}
          brushShape={brushShape}
          brushRadius={brushRadius}
          onBrushRadiusChange={onBrushRadiusChange}
        />
        <ImagePreview
          result={result}
          originalImageUrl={originalImageUrl}
          uploadedFilename={uploadedFilename}
          selectedTab={selectedPreviewTab}
          onUpload={onUpload}
          onTabChange={onPreviewTabChange}
          viewport={viewport}
          onViewportChange={onViewportChange}
          onImgNaturalSizeChange={onImgNaturalSizeChange}
          entities={entities}
        />
      </div>

      {showBottomPanels && (
        <div className="bottom-row">
          <ReportPanel result={result} error={reportError} />
          <SettingsPanel settings={settings} onChange={onSettingsChange} />
          <ArtifactList result={result} />
        </div>
      )}
    </section>
  );
}
