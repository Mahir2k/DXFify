import express from 'express';
import multer from 'multer';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webRoot, '..');
const jobsRoot = path.join(webRoot, 'uploads', 'jobs');
const incomingRoot = path.join(webRoot, 'uploads', 'incoming');
const dxferBinary = process.env.DXFER_BIN ?? path.join(repoRoot, 'build', 'dxfer');
const isMockMode = process.env.DXFER_MOCK === '1';

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

function jobFile(jobId: string, filename: string) {
  if (!/^[a-f0-9-]+$/i.test(jobId)) return null;
  return path.join(jobsRoot, jobId, filename);
}

function runDxfer(args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
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
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `dxfer exited with code ${code}`));
      }
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
  const jobFolder = path.join(jobsRoot, jobId);
  await mkdir(jobFolder, { recursive: true });

  const inputPath = path.join(jobFolder, path.basename(req.file.originalname || 'uploaded-image'));
  const outputPath = path.join(jobFolder, 'result.dxf');
  const debugPath = path.join(jobFolder, 'result.dbg.png');
  const reportPath = path.join(jobFolder, 'result.json');
  await writeFile(inputPath, await readFile(req.file.path));

  try {
    if (!isMockMode && !existsSync(dxferBinary)) {
      return res.status(500).json({
        success: false,
        message: 'dxfer binary not found. Build the C++ project first.',
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
      report = JSON.parse(await readFile(reportPath, 'utf8'));
    }

    return res.json({
      success: true,
      jobId,
      report,
      files: {
        dxf: `/api/jobs/${jobId}/result.dxf`,
        debug: `/api/jobs/${jobId}/result.dbg.png`,
        report: `/api/jobs/${jobId}/result.json`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Conversion failed.';
    return res.status(500).json({
      success: false,
      message: message.includes('Fewer than 4 markers')
        ? 'Bad calibration, recapture recommended. Fewer than 4 ArUco markers were detected.'
        : 'Conversion failed. Check the image and conversion settings.',
      detail: message,
    });
  }
});

app.get('/api/jobs/:jobId/:filename', (req, res) => {
  const { jobId, filename } = req.params;
  if (!['result.dxf', 'result.dbg.png', 'result.json'].includes(filename)) {
    return res.status(404).json({ success: false, message: 'File not found.' });
  }

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
