import { useRef, useState } from 'react';
import type { ConversionResult, PreviewTab } from '../types';

interface ImagePreviewProps {
  result: ConversionResult | null;
  originalImageUrl: string | null;
  uploadedFilename: string | null;
  selectedTab: PreviewTab;
  onUpload: (file: File) => void;
  onTabChange: (tab: PreviewTab) => void;
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

export function ImagePreview({
  result,
  originalImageUrl,
  uploadedFilename,
  selectedTab,
  onUpload,
  onTabChange,
}: ImagePreviewProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
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

  const acceptUpload = (file: File | undefined) => {
    if (file?.type.startsWith('image/')) onUpload(file);
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
        {activeImage ? (
          <img src={activeImage} alt={`${title} preview`} />
        ) : selectedTab === 'original' ? (
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
    </section>
  );
}
