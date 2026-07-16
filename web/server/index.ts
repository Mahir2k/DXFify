import express from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '..');
const jobsRoot = path.join(webRoot, 'uploads', 'jobs');
const incomingRoot = path.join(webRoot, 'uploads', 'incoming');
const isMockMode = process.env.DXFER_MOCK === '1';
const workerUrl = process.env.DXFERPY_URL ?? 'http://127.0.0.1:8788';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

await mkdir(jobsRoot, { recursive: true });
await mkdir(incomingRoot, { recursive: true });

const app = express();
const upload = multer({
  dest: incomingRoot,
  limits: {
    fileSize: 30 * 1024 * 1024,
  },
});

const sheetSizes: Record<string, { width: number; height: number }> = {
  a4: { width: 210, height: 297 },
  a3: { width: 297, height: 420 },
  a5: { width: 148, height: 210 },
  letter: { width: 215.9, height: 279.4 },
  legal: { width: 215.9, height: 355.6 },
};

const placeholderPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAYAAAByNR6YAAAABmJLR0QA/wD/AP+gvaeTAAAGbElEQVR4nO3WwQ3DMAwDQYb//2a3oAslS5KJBRx4k0SWGJ1zFwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4HvX2gMAAADwXSYBAAAwCwAAgFkAAADMAgAA4ABeznC9jvV+Xed4t9Y9AAAAwN8mAQAAcAsAAIBZAAAAzAIAAOCWb0mS5Lquc7zneQAAAMCvTQIAAGAWAAAAswAAAJgFAADAATy9r7UHAACAbzYJAACAWQAAAMwCAABgFgAAALf8fH6/1x4AAAC+2SQAAABmAQAAzAIAAGAWAAAAt3xLkiQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALgGkJfVn4GZy+YAAAAASUVORK5CYII=',
  'base64',
);

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function safeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'uploaded-image';
}

function jobFolderFor(jobId: string) {
  if (!uuidPattern.test(jobId)) return null;
  const resolvedJobsRoot = path.resolve(jobsRoot);
  const resolvedJobFolder = path.resolve(resolvedJobsRoot, jobId);
  if (!resolvedJobFolder.startsWith(resolvedJobsRoot + path.sep)) return null;
  return resolvedJobFolder;
}

function jobFile(jobId: string, filename: string) {
  const jobFolder = jobFolderFor(jobId);
  if (!jobFolder) return null;
  if (filename !== path.basename(filename)) return null;

  const resolved = path.resolve(jobFolder, filename);
  if (!resolved.startsWith(jobFolder + path.sep)) return null;
  return resolved;
}

async function collectJobFiles(jobId: string) {
  const jobFolder = jobFolderFor(jobId);
  if (!jobFolder) return {};

  const names = await readdir(jobFolder);
  const files: Record<string, string> = {};
  for (const name of names) {
    if (name !== path.basename(name)) continue;
    const key = name
      .replace(/^result\./, '')
      .replace(/\./g, '_')
      .replace(/_png$/, '')
      .replace(/_json$/, '')
      .replace(/_dxf$/, '');
    files[key || name] = `/api/jobs/${jobId}/${encodeURIComponent(name)}`;
  }

  return files;
}

async function writeMockJob(jobFolder: string) {
  const report = {
    success: true,
    markersDetected: 4,
    pixelsPerMm: 4,
    reprojectionErrorPx: 0.12,
    outerContours: 1,
    holeContours: 2,
    bboxWidthMm: 82.4,
    bboxHeightMm: 134.9,
    perimeterMm: 422.5,
  };

  await writeFile(path.join(jobFolder, 'result.dbg.png'), placeholderPng);
  await writeFile(path.join(jobFolder, 'result.preview.png'), placeholderPng);
  await writeFile(path.join(jobFolder, 'result.json'), JSON.stringify(report, null, 2));
  await writeFile(
    path.join(jobFolder, 'result.dxf'),
    '0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nOUTER\n90\n4\n70\n1\n10\n0\n20\n0\n10\n80\n20\n0\n10\n80\n20\n120\n10\n0\n20\n120\n0\nENDSEC\n0\nEOF\n',
  );

  return report;
}

// ---------------------------------------------------------------------------
// Python worker communication
// ---------------------------------------------------------------------------

async function callPipelineWorker(inputPath: string, outputDir: string, paperSize: string) {
  const url = `${workerUrl}/process`;
  console.log(`[dxferpy] POST ${url} inputPath=${inputPath} paperSize=${paperSize}`);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputPath,
      outputDir,
      paperSize,
    }),
  });

  const body = await resp.json() as { success: boolean; report?: unknown; message?: string; traceback?: string };

  if (!resp.ok || !body.success) {
    const message = (body.message as string) || `Worker returned ${resp.status}`;
    throw new Error(message);
  }

  return body.report;
}

async function checkWorkerHealth() {
  try {
    const resp = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const body = await resp.json() as { ok: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.post('/api/convert', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No image provided.' });
  }

  const jobId = randomUUID();
  const jobFolder = jobFolderFor(jobId);
  if (!jobFolder) {
    return res.status(500).json({ success: false, message: 'Could not create job folder.' });
  }
  await mkdir(jobFolder, { recursive: true });

  const inputName = `uploaded-${safeFilename(req.file.originalname || 'image')}`;
  const inputPath = path.join(jobFolder, inputName);
  const previewPath = path.join(jobFolder, 'result.preview.png');
  await copyFile(req.file.path, inputPath);

  try {
    let report: unknown;

    if (isMockMode) {
      report = await writeMockJob(jobFolder);
    } else {
      const paperSize = asString(req.body.sheetSize, 'a4');

      // Check worker is alive
      const healthy = await checkWorkerHealth();
      if (!healthy) {
        return res.status(503).json({
          success: false,
          message: 'Python pipeline worker is not running. Start it with: cd dxferpy && venv/bin/python3 pipeline_worker.py',
        });
      }

      report = await callPipelineWorker(inputPath, jobFolder, paperSize);
    }

    const files = await collectJobFiles(jobId);

    return res.json({
      success: true,
      jobId,
      report,
      files: {
        ...files,
        original: `/api/jobs/${jobId}/${encodeURIComponent(inputName)}`,
        preview: existsSync(previewPath) ? `/api/jobs/${jobId}/result.preview.png` : undefined,
        dxf: `/api/jobs/${jobId}/result.dxf`,
        debug: `/api/jobs/${jobId}/result.dbg.png`,
        mask: existsSync(path.join(jobFolder, 'result.mask.png')) ? `/api/jobs/${jobId}/result.mask.png` : undefined,
        holes: existsSync(path.join(jobFolder, 'result.holes.png')) ? `/api/jobs/${jobId}/result.holes.png` : undefined,
        report: `/api/jobs/${jobId}/result.json`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Conversion failed.';

    return res.status(500).json({
      success: false,
      message: message.includes('markers')
        ? 'Bad calibration, recapture recommended. ArUco markers were not detected.'
        : 'Conversion failed. Check the image and conversion settings.',
      detail: message,
    });
  } finally {
    await unlink(req.file.path).catch(() => undefined);
  }
});

app.get('/api/jobs/:jobId/:filename', (req, res) => {
  const { jobId, filename } = req.params;
  const filePath = jobFile(jobId, filename);
  if (!filePath || !existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'File not found.' });
  }

  if (filename.endsWith('.dxf')) {
    res.download(filePath, 'result.dxf');
  } else {
    res.sendFile(filePath);
  }
});

app.get('/api/health', async (_req, res) => {
  const workerOk = await checkWorkerHealth();
  res.json({
    ok: true,
    mock: isMockMode,
    workerUrl,
    workerOk,
  });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`DXFify API listening on http://localhost:${port}`);
  // Check worker on startup
  checkWorkerHealth().then((ok) => {
    if (ok) {
      console.log(`[dxferpy] Python worker at ${workerUrl} is ready`);
    } else {
      console.warn(`[dxferpy] WARNING: Python worker at ${workerUrl} is not responding. Start it separately.`);
    }
  });
});
