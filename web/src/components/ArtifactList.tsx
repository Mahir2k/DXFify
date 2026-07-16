import type { ConversionResult } from '../types';

interface ArtifactListProps {
  result: ConversionResult | null;
}

function filenameFromUrl(url: string) {
  const lastPart = url.split('/').pop() ?? url;
  return decodeURIComponent(lastPart);
}

export function ArtifactList({ result }: ArtifactListProps) {
  const artifacts = result
    ? Object.values(result.files)
      .filter((url): url is string => Boolean(url))
      .map((url) => ({ url, filename: filenameFromUrl(url) }))
      .filter((artifact, index, all) => all.findIndex((item) => item.url === artifact.url) === index)
      .sort((left, right) => left.filename.localeCompare(right.filename))
    : [];

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
                <a href={artifact.url} download={artifact.filename}>Download</a>
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
