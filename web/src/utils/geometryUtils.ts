import type { GeometryEntity } from '../types';

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Computes the 2D bounding box for a set of geometry entities.
 */
export function computeBoundingBox(entities: GeometryEntity[]): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  entities.forEach((entity) => {
    if (entity.type === 'circle' && entity.cx != null && entity.cy != null && entity.r != null) {
      minX = Math.min(minX, entity.cx - entity.r);
      minY = Math.min(minY, entity.cy - entity.r);
      maxX = Math.max(maxX, entity.cx + entity.r);
      maxY = Math.max(maxY, entity.cy + entity.r);
    } else if (entity.type === 'polyline' && entity.points) {
      entity.points.forEach((pt) => {
        minX = Math.min(minX, pt[0]);
        minY = Math.min(minY, pt[1]);
        maxX = Math.max(maxX, pt[0]);
        maxY = Math.max(maxY, pt[1]);
      });
    }
  });

  const width = isFinite(maxX - minX) ? Math.max(0, maxX - minX) : 0;
  const height = isFinite(maxY - minY) ? Math.max(0, maxY - minY) : 0;

  return {
    minX: isFinite(minX) ? minX : 0,
    minY: isFinite(minY) ? minY : 0,
    maxX: isFinite(maxX) ? maxX : 0,
    maxY: isFinite(maxY) ? maxY : 0,
    width,
    height,
  };
}

/**
 * Computes shortest distance from point (px, py) to line segment (x1, y1)-(x2, y2).
 */
export function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
}

/**
 * Computes center and radius of circumcircle passing through 3 points.
 */
export function computeCircumcircle(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
): { cx: number; cy: number; r: number } | null {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const D = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  if (Math.abs(D) < 1e-6) return null;

  const sq1 = x1 * x1 + y1 * y1;
  const sq2 = x2 * x2 + y2 * y2;
  const sq3 = x3 * x3 + y3 * y3;

  const cx = (sq1 * (y2 - y3) + sq2 * (y3 - y1) + sq3 * (y1 - y2)) / D;
  const cy = (sq1 * (x3 - x2) + sq2 * (x1 - x3) + sq3 * (x2 - x1)) / D;
  const r = Math.hypot(x1 - cx, y1 - cy);

  return { cx, cy, r };
}

/**
 * Evaluates points along a Catmull-Rom spline interpolating given control points.
 */
export function evaluateSplinePoints(
  pts: [number, number][],
  numPerSeg = 16,
  alpha = 0.5,
): [number, number][] {
  if (pts.length < 2) return [...pts];
  if (pts.length === 2) return [...pts];

  const cleanPts: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const prev = cleanPts[cleanPts.length - 1];
    const curr = pts[i];
    if (Math.hypot(curr[0] - prev[0], curr[1] - prev[1]) > 1e-4) {
      cleanPts.push(curr);
    }
  }

  if (cleanPts.length < 2) return [...pts];
  if (cleanPts.length === 2) return [...cleanPts];

  const result: [number, number][] = [];
  const p = [cleanPts[0], ...cleanPts, cleanPts[cleanPts.length - 1]];

  for (let i = 0; i < p.length - 3; i++) {
    const p0 = p[i];
    const p1 = p[i + 1];
    const p2 = p[i + 2];
    const p3 = p[i + 3];

    let t0 = 0;
    let d01 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    let t1 = t0 + Math.pow(d01, alpha);
    if (t1 === t0) t1 += 1e-4;

    let d12 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    let t2 = t1 + Math.pow(d12, alpha);
    if (t2 === t1) t2 += 1e-4;

    let d23 = Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    let t3 = t2 + Math.pow(d23, alpha);
    if (t3 === t2) t3 += 1e-4;

    for (let st = 0; st <= numPerSeg; st++) {
      if (i > 0 && st === 0) continue;
      const t = t1 + (st / numPerSeg) * (t2 - t1);

      const a1x = ((t1 - t) * p0[0] + (t - t0) * p1[0]) / (t1 - t0);
      const a1y = ((t1 - t) * p0[1] + (t - t0) * p1[1]) / (t1 - t0);

      const a2x = ((t2 - t) * p1[0] + (t - t1) * p2[0]) / (t2 - t1);
      const a2y = ((t2 - t) * p1[1] + (t - t1) * p2[1]) / (t2 - t1);

      const a3x = ((t3 - t) * p2[0] + (t - t2) * p3[0]) / (t3 - t2);
      const a3y = ((t3 - t) * p2[1] + (t - t2) * p3[1]) / (t3 - t2);

      const b1x = ((t2 - t) * a1x + (t - t0) * a2x) / (t2 - t0);
      const b1y = ((t2 - t) * a1y + (t - t0) * a2y) / (t2 - t0);

      const b2x = ((t3 - t) * a2x + (t - t1) * a3x) / (t3 - t1);
      const b2y = ((t3 - t) * a2y + (t - t1) * a3y) / (t3 - t1);

      const cx = ((t2 - t) * b1x + (t - t1) * b2x) / (t2 - t1);
      const cy = ((t2 - t) * b1y + (t - t1) * b2y) / (t2 - t1);

      result.push([cx, cy]);
    }
  }

  return result;
}

/**
 * Computes sampled points for a circular fillet arc between segments (pPrev, pCurr) and (pCurr, pNext).
 */
export function computeFilletArc(
  pPrev: [number, number],
  pCurr: [number, number],
  pNext: [number, number],
  ratio = 0.25,
  numArcPts = 8,
): { pStart: [number, number]; pEnd: [number, number]; arcPts: [number, number][] } | null {
  const d1 = Math.hypot(pCurr[0] - pPrev[0], pCurr[1] - pPrev[1]);
  const d2 = Math.hypot(pNext[0] - pCurr[0], pNext[1] - pCurr[1]);
  if (d1 < 1e-6 || d2 < 1e-6) return null;

  const trimDist = Math.min(d1, d2) * ratio;
  if (trimDist < 1e-4) return null;

  const u1: [number, number] = [(pPrev[0] - pCurr[0]) / d1, (pPrev[1] - pCurr[1]) / d1];
  const u2: [number, number] = [(pNext[0] - pCurr[0]) / d2, (pNext[1] - pCurr[1]) / d2];

  const pStart: [number, number] = [pCurr[0] + u1[0] * trimDist, pCurr[1] + u1[1] * trimDist];
  const pEnd: [number, number] = [pCurr[0] + u2[0] * trimDist, pCurr[1] + u2[1] * trimDist];

  const uSum: [number, number] = [u1[0] + u2[0], u1[1] + u2[1]];
  const uSumLen = Math.hypot(uSum[0], uSum[1]);
  if (uSumLen < 1e-6) {
    return { pStart, pEnd, arcPts: [] };
  }

  const uBis: [number, number] = [uSum[0] / uSumLen, uSum[1] / uSumLen];
  const cosHalf = u1[0] * uBis[0] + u1[1] * uBis[1];
  if (Math.abs(cosHalf) < 1e-6) {
    return { pStart, pEnd, arcPts: [] };
  }

  const distC = trimDist / cosHalf;
  const cx = pCurr[0] + uBis[0] * distC;
  const cy = pCurr[1] + uBis[1] * distC;
  const rSq = distC * distC - trimDist * trimDist;
  if (rSq < 0) return { pStart, pEnd, arcPts: [] };
  const r = Math.sqrt(rSq);

  const a1 = Math.atan2(pStart[1] - cy, pStart[0] - cx);
  const a2 = Math.atan2(pEnd[1] - cy, pEnd[0] - cx);

  let da = a2 - a1;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;

  const arcPts: [number, number][] = [];
  for (let i = 1; i < numArcPts; i++) {
    const t = i / numArcPts;
    const angle = a1 + t * da;
    arcPts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }

  return { pStart, pEnd, arcPts };
}

/**
 * Computes a circular fillet arc directly connecting pStart (Point 1) to pEnd (Point 2)
 * while trimming away the intermediate cornerPt.
 */
export function computeFilletBetweenTwoPoints(
  pStart: [number, number],
  pEnd: [number, number],
  cornerPt?: [number, number],
  numArcPts = 16,
): { pStart: [number, number]; pEnd: [number, number]; arcPts: [number, number][] } {
  if (!cornerPt) {
    return { pStart, pEnd, arcPts: [] };
  }

  const arcPts: [number, number][] = [];
  for (let i = 1; i < numArcPts; i++) {
    const t = i / numArcPts;
    const mt = 1 - t;
    const x = mt * mt * pStart[0] + 2 * mt * t * cornerPt[0] + t * t * pEnd[0];
    const y = mt * mt * pStart[1] + 2 * mt * t * cornerPt[1] + t * t * pEnd[1];
    arcPts.push([x, y]);
  }

  return { pStart, pEnd, arcPts };
}

