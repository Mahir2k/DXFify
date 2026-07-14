import express from 'express';
import multer from 'multer';
import { spawn } from 'node:child_process';
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
const configuredDxferBinary = process.env.DXFER_BIN ?? './build/dxfer';
const dxferBinary = path.isAbsolute(configuredDxferBinary)
  ? configuredDxferBinary
  : path.resolve(repoRoot, configuredDxferBinary);
const isMockMode = process.env.DXFER_MOCK === '1';
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

const simplificationMap: Record<string, number> = {
  low: 0.08,
  medium: 0.15,
  high: 0.3,
};

const placeholderPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAlgAAAGQCAYAAAByNR6YAAAABmJLR0QA/wD/AP+gvaeTAAAGbElEQVR4nO3WwQ3DMAwDQYb//2a3oAslS5KJBRx4k0SWGJ1zFwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4HvX2gMAAADwXSYBAAAwCwAAgFkAAADMAgAA4ABeznC9jvV+Xed4t9Y9AAAAwN8mAQAAcAsAAIBZAAAAzAIAAOCWb0mS5Lquc7zneQAAAMCvTQIAAGAWAAAAswAAAJgFAADAATy9r7UHAACAbzYJAACAWQAAAMwCAABgFgAAALf8fH6/1x4AAAC+2SQAAABmAQAAzAIAAGAWAAAAt3xLkiQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALgGkJfVn4GZy+YAAAAASUVORK5CYII=',
  'base64',
);

function asString(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown) {
  return value === 'true' || value === true;
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

function quoteArg(arg: string) {
  return /\s|["'\\$`]/.test(arg) ? JSON.stringify(arg) : arg;
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

class DxferRunError extends Error {
  stdout: string;
  stderr: string;
  code: number | null;
  command: string;

  constructor(message: string, command: string, stdout: string, stderr: string, code: number | null) {
    super(message);
    this.name = 'DxferRunError';
    this.command = command;
    this.stdout = stdout;
    this.stderr = stderr;
    this.code = code;
  }
}

function runDxfer(args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const command = [dxferBinary, ...args].map(quoteArg).join(' ');
    console.log(`[dxfer] ${command}`);

    const child = spawn(dxferBinary, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(new DxferRunError(error.message, command, stdout, stderr, null));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new DxferRunError(
          stderr || stdout || `dxfer exited with code ${code}`,
          command,
          stdout,
          stderr,
          code,
        ));
      }
    });
  });
}

async function tryRenderDxfPreview(dxfPath: string, previewPath: string) {
  const renderScript = path.join(repoRoot, 'dxferpy', 'render_dxf.py');
  if (!existsSync(renderScript)) return;

  const code = [
    'import sys',
    'from dxferpy.render_dxf import render_dxf_to_png',
    'render_dxf_to_png(sys.argv[1], sys.argv[2])',
  ].join('; ');
  const args = ['-c', code, dxfPath, previewPath];
  const command = ['python3', ...args].map(quoteArg).join(' ');
  console.log(`[dxf-preview] ${command}`);

  await new Promise<void>((resolve) => {
    const child = spawn('python3', args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      console.warn(`[dxf-preview] preview render skipped: ${error.message}`);
      resolve();
    });
    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[dxf-preview] preview render failed with code ${code}: ${stderr || stdout}`);
      }
      resolve();
    });
  });
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
  const outputPath = path.join(jobFolder, 'result.dxf');
  const debugPath = path.join(jobFolder, 'result.dbg.png');
  const previewPath = path.join(jobFolder, 'result.preview.png');
  const reportPath = path.join(jobFolder, 'result.json');
  await copyFile(req.file.path, inputPath);

  try {
    if (!isMockMode && !existsSync(dxferBinary)) {
      return res.status(500).json({
        success: false,
        message: 'dxfer binary not found. Build the C++ project first.',
        detail: `Tried to run ${dxferBinary}. Set DXFER_BIN to override the converter path.`,
      });
    }

    let report: unknown;

    if (isMockMode) {
      report = await writeMockJob(jobFolder);
    } else {
      const segmentationMethod = asString(req.body.segmentationMethod, 'gradient');
      const pixelsPerMm = asNumber(req.body.pixelsPerMm, 4);
      const markerSize = asNumber(req.body.markerSize, 40);
      const sheetSize = sheetSizes[asString(req.body.sheetSize, 'a4')] ?? sheetSizes.a4;
      const simplification = simplificationMap[asString(req.body.simplificationStrength, 'medium')] ?? 0.15;

      const args = [
        '--input', inputPath,
        '--output', outputPath,
        '--debug', debugPath,
        '--report', reportPath,
        '--seg-method', segmentationMethod,
        '--pixels-per-mm', String(pixelsPerMm),
        '--marker-size-mm', String(markerSize),
        '--sheet-width-mm', String(sheetSize.width),
        '--sheet-height-mm', String(sheetSize.height),
        '--simplify-mm', String(simplification),
      ];

      if (asBoolean(req.body.fitArcs)) args.push('--fit-arcs');
      if (asBoolean(req.body.snapRightAngles)) args.push('--snap-right-angles');

      // TODO: map holeSensitivity when the C++ CLI exposes a hole sensitivity option.
      await runDxfer(args);
      await tryRenderDxfPreview(outputPath, previewPath);
      report = JSON.parse(await readFile(reportPath, 'utf8'));
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
        report: `/api/jobs/${jobId}/result.json`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Conversion failed.';
    const isDxferError = error instanceof DxferRunError;
    const stdout = isDxferError ? error.stdout : undefined;
    const stderr = isDxferError ? error.stderr : undefined;
    const code = isDxferError ? error.code : undefined;
    const command = isDxferError ? error.command : undefined;

    return res.status(500).json({
      success: false,
      message: message.includes('Fewer than 4 markers')
        ? 'Bad calibration, recapture recommended. Fewer than 4 ArUco markers were detected.'
        : 'Conversion failed. Check the image and conversion settings.',
      detail: message,
      dxfer: isDxferError ? { code, command, stdout, stderr } : undefined,
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

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mock: isMockMode,
    dxferBinary,
    dxferFound: existsSync(dxferBinary),
  });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`DXFify API listening on http://localhost:${port}`);
});
