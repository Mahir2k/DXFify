import type { ConversionErrorDetails, ConversionResult } from '../types';

interface ReportPanelProps {
  result: ConversionResult | null;
  error: ConversionErrorDetails | null;
}

function formatNumber(value: number | undefined, digits = 4) {
  return typeof value === 'number' ? value.toFixed(digits) : '—';
}

export function ReportPanel({ result, error }: ReportPanelProps) {
  const report = result?.report ?? null;
  
  const warnings: Array<{ message: string; severity: 'critical' | 'warning' | 'info' }> = [];
  const markers = report?.markersDetected;
  const reprojectionError = report?.reprojectionErrorPx;
  const pixelsPerMm = report?.pixelsPerMm;
  const holes = report?.holeContours;

  let toleranceMm: number | null = null;
  if (typeof reprojectionError === 'number' && typeof pixelsPerMm === 'number' && pixelsPerMm > 0) {
    toleranceMm = reprojectionError / pixelsPerMm;
  }

  if (typeof markers === 'number') {
    if (markers === 0) {
      warnings.push({ message: '0/4 ArUco markers detected. Calibration failed.', severity: 'critical' });
    } else if (markers < 4) {
      warnings.push({ message: `Only ${markers}/4 ArUco markers detected. Caution advised.`, severity: 'warning' });
    }
  }

  if (typeof reprojectionError === 'number' && reprojectionError > 1.5) {
    warnings.push({ message: `High reprojection error (${reprojectionError.toFixed(2)}px). Dimensions may be inaccurate.`, severity: 'warning' });
  }

  if (typeof holes === 'number' && holes === 0) {
    warnings.push({ message: 'No holes detected. Ensure this matches expectations.', severity: 'info' });
  }

  const formatWithTolerance = (val: number | undefined, tol: number | null) => {
    if (val === undefined) return '—';
    return tol ? `${val.toFixed(2)} ±${tol.toFixed(2)}` : val.toFixed(2);
  };

  return (
    <section className="panel report-panel">
      <div className="panel-header">
        <div>
          <h2>Conversion Report</h2>
        </div>
      </div>

      {error ? (
        <details className="error-box" open>
          <summary>{error.message}</summary>
          {error.detail ? <pre>{error.detail}</pre> : null}
          {error.command ? <pre>command: {error.command}</pre> : null}
          {typeof error.code !== 'undefined' ? <pre>exit code: {error.code ?? 'spawn error'}</pre> : null}
          {error.stderr ? <pre>stderr: {error.stderr}</pre> : null}
          {error.stdout ? <pre>stdout: {error.stdout}</pre> : null}
        </details>
      ) : null}

      {report ? (
        <>
          <dl className="report-grid">
            <div><dt>Markers</dt><dd className="tabular-nums">{report.markersDetected ?? '—'}/4</dd></div>
            <div><dt>Pixels/mm</dt><dd className="tabular-nums">{formatNumber(report.pixelsPerMm)}</dd></div>
            <div><dt>Reprojection</dt><dd className="tabular-nums">{formatNumber(report.reprojectionErrorPx)} px</dd></div>
            <div><dt>Tolerance</dt><dd className="tabular-nums" title="Derived from reprojection error">{toleranceMm ? `±${toleranceMm.toFixed(2)} mm` : '—'}</dd></div>
            <div><dt>Outer contours</dt><dd className="tabular-nums">{report.outerContours ?? '—'}</dd></div>
            <div><dt>Hole contours</dt><dd className="tabular-nums">{report.holeContours ?? '—'}</dd></div>
            <div style={{ gridColumn: 'span 2' }}>
              <dt>Bounds</dt>
              <dd className="tabular-nums">
                {formatWithTolerance(report.bboxWidthMm, toleranceMm)} × {formatWithTolerance(report.bboxHeightMm, toleranceMm)} mm
              </dd>
            </div>
            <div><dt>Perimeter</dt><dd className="tabular-nums">{formatNumber(report.perimeterMm, 2)} mm</dd></div>
          </dl>
          
          <div style={{ padding: '0 10px 10px', fontSize: '10px', color: 'var(--muted)' }}>
            Job ID: <span className="tabular-nums">{result?.jobId ?? '—'}</span>
          </div>

          {warnings.length > 0 ? (
            <div className="warning-list" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {warnings.map((w, i) => (
                <div key={i} className={`warning-item warning-${w.severity}`}>
                  {w.message}
                </div>
              ))}
            </div>
          ) : (
            <p className="clean-run">No report warnings.</p>
          )}
        </>
      ) : (
        <div className="empty-state compact">
          <strong>No report yet</strong>
          <span>Conversion metrics appear here after a run.</span>
        </div>
      )}
    </section>
  );
}
