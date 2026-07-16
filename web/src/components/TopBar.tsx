import type { StatusMessage } from '../types';

interface TopBarProps {
  status: StatusMessage;
  canRun: boolean;
  canDownload: boolean;
  isConverting: boolean;
  dxfUrl: string | null;
  onUpload: (file: File) => void;
  onRun: () => void;
  onReset: () => void;
}

export function TopBar({
  status,
  canRun,
  canDownload,
  isConverting,
  dxfUrl,
  onUpload,
  onRun,
  onReset,
}: TopBarProps) {
  const statusClass = status.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return (
    <header className="top-bar">
      <div className="brand-block">
        <span className="brand-mark">DXFify</span>
      </div>

      <div className={`status-pill status-${statusClass}`}>
        {status}
      </div>

      <div className="top-actions">
        <label className="button button-secondary">
          Upload
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.currentTarget.value = '';
            }}
          />
        </label>
        <button className="button" disabled={!canRun} onClick={onRun}>
          {isConverting ? 'Running...' : 'Run Conversion'}
        </button>
        <a
          className={`button ${canDownload ? '' : 'disabled-link'}`}
          href={dxfUrl ?? undefined}
          download="result.dxf"
          aria-disabled={!canDownload}
        >
          Download DXF
        </a>
        <button className="button button-secondary" onClick={onReset}>
          Reset
        </button>
      </div>
    </header>
  );
}
