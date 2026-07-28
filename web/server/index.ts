import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, unlink, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';

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

// --- Python Worker Lifecycle & Auto-Restart Management ---
let workerProcess: ChildProcess | null = null;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 5;
let isShuttingDown = false;

function startPythonWorker() {
  if (isMockMode || isShuttingDown) return;
  const pythonExec = path.resolve(repoRoot, 'dxferpy', 'venv', 'bin', 'python3');
  const workerScript = path.resolve(repoRoot, 'dxferpy', 'pipeline_worker.py');

  console.log(`[dxfer-server] Spawning Python worker: ${pythonExec} ${workerScript}`);
  workerProcess = spawn(pythonExec, [workerScript], {
    cwd: path.resolve(repoRoot, 'dxferpy'),
    env: { ...process.env, DXFERPY_PORT: '8788' },
  });

  workerProcess.stdout?.on('data', (data) => {
    console.log(`[worker-stdout] ${data.toString().trim()}`);
  });

  workerProcess.stderr?.on('data', (data) => {
    console.error(`[worker-stderr] ${data.toString().trim()}`);
  });

  workerProcess.on('exit', (code) => {
    workerProcess = null;
    console.log(`[dxfer-server] Python worker exited with code ${code}`);
    if (!isShuttingDown && code !== 0) {
      if (restartAttempts < MAX_RESTART_ATTEMPTS) {
        restartAttempts++;
        const delayMs = Math.min(1000 * Math.pow(2, restartAttempts - 1), 10000);
        console.warn(`[dxfer-server] Restarting Python worker in ${delayMs}ms (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`);
        setTimeout(startPythonWorker, delayMs);
      } else {
        console.error(`[dxfer-server] Python worker failed permanently after ${MAX_RESTART_ATTEMPTS} restart attempts.`);
      }
    }
  });
}

startPythonWorker();

const cleanUp = () => {
  isShuttingDown = true;
  if (workerProcess) {
    console.log('[dxfer-server] Killing Python worker process...');
    workerProcess.kill();
    workerProcess = null;
  }
};

process.on('exit', cleanUp);
process.on('SIGINT', () => { cleanUp(); process.exit(); });
process.on('SIGTERM', () => { cleanUp(); process.exit(); });
process.on('uncaughtException', (err) => { console.error('[dxfer-server] Uncaught exception:', err); cleanUp(); process.exit(1); });

// --- Expiry Job Sweeping Scheduler ---
async function sweepExpiredJobs() {
  try {
    const folders = await readdir(jobsRoot);
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    for (const folder of folders) {
      const jobFolder = path.join(jobsRoot, folder);
      const folderStat = await stat(jobFolder).catch((err) => {
        console.warn(`[cleanup-cron] Could not stat ${jobFolder}: ${err.message}`);
        return null;
      });
      if (!folderStat) continue;

      const ageMs = now - folderStat.mtime.getTime();
      if (ageMs > oneDayMs) {
        console.log(`[cleanup-cron] Deleting expired job folder: ${jobFolder} (age: ${(ageMs / 3600000).toFixed(1)} hours)`);
        await rm(jobFolder, { recursive: true, force: true }).catch((err) => {
          console.error(`[cleanup-cron] Failed to delete ${jobFolder}:`, err.message);
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cleanup-cron] Error sweeping jobs:', message);
  }
}

setInterval(sweepExpiredJobs, 60 * 60 * 1000);
sweepExpiredJobs();

// --- Inference Concurrency Queue ---
const queue: Array<{
  fn: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}> = [];
let processingQueue = false;

async function processQueue() {
  if (processingQueue || queue.length === 0) return;
  processingQueue = true;

  const item = queue.shift();
  if (!item) {
    processingQueue = false;
    return;
  }
  const { fn, resolve, reject } = item;
  try {
    const result = await fn();
    resolve(result);
  } catch (error) {
    reject(error);
  } finally {
    processingQueue = false;
    processQueue();
  }
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    processQueue();
  });
}

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const upload = multer({
  dest: incomingRoot,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG and PNG are allowed.'));
    }
  },
});

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function safeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'uploaded-image';
}

function jobFolderFor(jobId: string): string | null {
  if (!uuidPattern.test(jobId)) return null;
  const resolvedJobsRoot = path.resolve(jobsRoot);
  const resolvedJobFolder = path.resolve(resolvedJobsRoot, jobId);
  if (!resolvedJobFolder.startsWith(resolvedJobsRoot + path.sep)) return null;
  return resolvedJobFolder;
}

function jobFile(jobId: string, filename: string): string | null {
  const jobFolder = jobFolderFor(jobId);
  if (!jobFolder) return null;
  if (filename !== path.basename(filename)) return null;

  const resolved = path.resolve(jobFolder, filename);
  if (!resolved.startsWith(jobFolder + path.sep)) return null;
  return resolved;
}

async function collectJobFiles(jobId: string): Promise<Record<string, string>> {
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

const placeholderPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAYAAAByNR6YAAAABmJLR0QA/wD/AP+gvaeTAAAGbElEQVR4nO3WwQ3DMAwDQYb//2a3oAslS5KJBRx4k0SWGJ1zFwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4HvX2gMAAADwXSYBAAAwCwAAgFkAAADMAgAA4ABeznC9jvV+Xed4t9Y9AAAAwN8mAQAAcAsAAIBZAAAAzAIAAOCWb0mS5Lquc7zneQAAAMCvTQIAAGAWAAAAswAAAJgFAADAATy9r7UHAACAbzYJAACAWQAAAMwCAABgFgAAALf8fH6/1x4AAAC+2SQAAABmAQAAzAIAAGAWAAAAt3xLkiQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALgGkJfVn4GZy+YAAAAASUVORK5CYII=',
  'base64',
);

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

async function callPipelineWorker(
  inputPath: string,
  outputDir: string,
  paperSize: string,
  processingParams: Record<string, any> = {},
) {
  const url = `${workerUrl}/process`;
  console.log(`[dxferpy] POST ${url} inputPath=${inputPath} paperSize=${paperSize}`);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inputPath,
      outputDir,
      paperSize,
      ...processingParams,
    }),
  });

  const body = (await resp.json()) as {
    success: boolean;
    report?: unknown;
    message?: string;
    traceback?: string;
  };

  if (!resp.ok || !body.success) {
    const message = (body.message as string) || `Worker returned ${resp.status}`;
    throw new Error(message);
  }

  return body.report;
}

async function checkWorkerHealth(): Promise<boolean> {
  try {
    const resp = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const body = (await resp.json()) as { ok: boolean };
    if (body.ok) {
      restartAttempts = 0; // Reset restart counter on successful health ping
    }
    return body.ok === true;
  } catch {
    return false;
  }
}

app.post('/api/convert', upload.single('image'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No image provided.' });
  }

  const tempFilePath = req.file.path;

  try {
    const jobId = randomUUID();
    const jobFolder = jobFolderFor(jobId);
    if (!jobFolder) {
      return res.status(500).json({ success: false, message: 'Could not create job folder.' });
    }
    await mkdir(jobFolder, { recursive: true });

    const inputName = `uploaded-${safeFilename(req.file.originalname || 'image')}`;
    const inputPath = path.join(jobFolder, inputName);
    const previewPath = path.join(jobFolder, 'result.preview.png');
    await copyFile(tempFilePath, inputPath);

    let report: unknown;

    if (isMockMode) {
      report = await writeMockJob(jobFolder);
    } else {
      const paperSize = asString(req.body.sheetSize, 'a4');

      const paramKeys = [
        'maskThreshold',
        'erosionKernel',
        'erosionIterations',
        'minHoleArea',
        'minOuterArea',
        'circleRatio',
        'epsilonMin',
        'epsilonMax',
        'snapAngle',
        'snapMinLength',
        'markerOffsetX',
        'markerOffsetY',
        'markerClearRadius',
        'detailsThreshold1',
        'detailsThreshold2',
      ] as const;
      const processingParams: Record<string, any> = {};
      for (const key of paramKeys) {
        const raw = req.body[key];
        if (raw !== undefined && raw !== null && raw !== '') {
          const num = Number(raw);
          if (!isNaN(num)) processingParams[key] = num;
        }
      }
      if (req.body.detectDetails !== undefined && req.body.detectDetails !== null && req.body.detectDetails !== '') {
        processingParams.detectDetails =
          req.body.detectDetails === 'true' || req.body.detectDetails === '1' || req.body.detectDetails === true;
      }
      if (req.body.curveStrategy !== undefined && req.body.curveStrategy !== null && req.body.curveStrategy !== '') {
        processingParams.curveStrategy = String(req.body.curveStrategy);
      }

      const healthy = await checkWorkerHealth();
      if (!healthy) {
        return res.status(503).json({
          success: false,
          message: 'Python pipeline worker is not running. Start it with: cd dxferpy && venv/bin/python3 pipeline_worker.py',
        });
      }

      report = await enqueue(() => callPipelineWorker(inputPath, jobFolder, paperSize, processingParams));
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
    await unlink(tempFilePath).catch(() => undefined);
  }
});

app.post('/api/convert-region', async (req: Request, res: Response) => {
  const { jobId, bbox, curveStrategy, sheetSize } = req.body;
  if (!jobId || !bbox) {
    return res.status(400).json({ success: false, message: 'jobId and bbox are required.' });
  }

  const jobFolder = jobFolderFor(jobId);
  if (!jobFolder || !existsSync(jobFolder)) {
    return res.status(404).json({ success: false, message: 'Job not found.' });
  }

  const filesInJob = await readdir(jobFolder);
  const uploadedName = filesInJob.find((f: string) => f.startsWith('uploaded-'));
  if (!uploadedName) {
    return res.status(404).json({ success: false, message: 'Source image not found for job.' });
  }

  const inputPath = path.join(jobFolder, uploadedName);
  try {
    const result = await enqueue(async () => {
      const url = `${workerUrl}/process_region`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputPath,
          outputDir: jobFolder,
          bbox,
          paperSize: sheetSize || 'a4',
          curveStrategy: curveStrategy || 'current',
        }),
      });

      const body = (await resp.json()) as { success: boolean; entities?: unknown; message?: string };
      if (!resp.ok || !body.success) {
        throw new Error(body.message || 'Sub-region processing failed.');
      }
      return body.entities;
    });

    return res.json({ success: true, entities: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sub-region processing error';
    return res.status(500).json({ success: false, message });
  }
});

app.get('/api/jobs/:jobId/:filename', (req: Request, res: Response) => {
  const jobId = req.params.jobId as string;
  const filename = req.params.filename as string;
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

app.get('/api/health', async (_req: Request, res: Response) => {
  const workerOk = await checkWorkerHealth();
  res.json({
    ok: true,
    mock: isMockMode,
    workerUrl,
    workerOk,
  });
});

// Error handling middleware for Multer and custom validation errors
app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof Error) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`DXFify API listening on http://localhost:${port}`);

  checkWorkerHealth().then((ok) => {
    if (ok) {
      console.log(`[dxferpy] Python worker at ${workerUrl} is ready`);
    } else {
      console.warn(`[dxferpy] WARNING: Python worker at ${workerUrl} is not responding. Start it separately.`);
    }
  });
});
