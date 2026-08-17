import type { ConversionResult } from '../types';
import { saveUrlToDisk } from '../utils/fileSaver';

interface ArtifactListProps {
  result: ConversionResult | null;
  onShowToast?: (message: string, type?: 'success' | 'error') => void;
  onDownloadDxf?: () => void;
}

function filenameFromUrl(url: string) {
  const lastPart = url.split('/').pop() ?? url;
  return decodeURIComponent(lastPart);
}

export function ArtifactList({ result, onShowToast, onDownloadDxf }: ArtifactListProps) {
  const artifacts = result
    ? Object.values(result.files)
      .filter((url): url is string => Boolean(url))
      .map((url) => ({ url, filename: filenameFromUrl(url) }))
      .filter((artifact, index, all) => all.findIndex((item) => item.url === artifact.url) === index)
      .sort((left, right) => left.filename.localeCompare(right.filename))
    : [];

  const handleDownload = async (url: string, filename: string, e: React.MouseEvent) => {
    e.preventDefault();
    if (filename.toLowerCase().endsWith('.dxf') && onDownloadDxf) {
      onDownloadDxf();
      return;
    }
    const res = await saveUrlToDisk(url, filename);
    if (res.success && res.message) {
      onShowToast?.(res.message, 'success');
    } else {
      onShowToast?.(res.message || 'Download failed', 'error');
    }
  };

  return (
    <section className="panel artifact-panel">
      <div className="panel-header">
        <div>
          <h2>Generated Files</h2>
        </div>
      </div>

      {artifacts.length > 0 ? (
        <ul className="artifact-list">
          {artifacts.map((artifact) => (
            <li key={artifact.url}>
              <span>{artifact.filename}</span>
              <div>
                <a href={artifact.url} target="_blank" rel="noreferrer">Open</a>
                <button
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#3b82f6',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontSize: '12px',
                    padding: 0,
                  }}
                  onClick={(e) => handleDownload(artifact.url, artifact.filename, e)}
                >
                  Download
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state compact">
          <strong>No files yet</strong>
          <span>Generated artifacts appear after conversion.</span>
        </div>
      )}
    </section>
  );
}
