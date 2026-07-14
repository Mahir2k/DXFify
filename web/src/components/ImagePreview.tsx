import type { PreviewTab } from '../types';

interface ImagePreviewProps {
  originalImageUrl: string | null;
  debugImageUrl: string | null;
  selectedTab: PreviewTab;
  onTabChange: (tab: PreviewTab) => void;
}

const tabs: Array<{ id: PreviewTab; label: string }> = [
  { id: 'original', label: 'Original' },
  { id: 'debug', label: 'Debug Overlay' },
  { id: 'mask', label: 'Mask' },
  { id: 'holes', label: 'Holes' },
];

export function ImagePreview({
  originalImageUrl,
  debugImageUrl,
  selectedTab,
  onTabChange,
}: ImagePreviewProps) {
  const activeImage = selectedTab === 'debug' ? debugImageUrl : originalImageUrl;
  const title = tabs.find((tab) => tab.id === selectedTab)?.label ?? 'Image Preview';
  const isPlaceholderTab = selectedTab === 'mask' || selectedTab === 'holes';
  const emptyCopy =
    selectedTab === 'debug'
      ? {
          title: 'No debug image yet',
          body: 'Run conversion to inspect the backend overlay.',
        }
      : {
          title: 'No upload yet',
          body: 'Upload a calibrated photo to begin.',
        };

  return (
    <section className="panel image-panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>Capture and conversion visual checks</p>
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

      <div className="image-stage">
        {isPlaceholderTab ? (
          <div className="empty-state">
            <strong>{title} preview pending</strong>
            <span>This tab is reserved for backend mask outputs.</span>
          </div>
        ) : activeImage ? (
          <img src={activeImage} alt={`${title} preview`} />
        ) : (
          <div className="empty-state">
            <strong>{emptyCopy.title}</strong>
            <span>{emptyCopy.body}</span>
          </div>
        )}
      </div>
    </section>
  );
}
