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
  numPerSeg = 10,
): [number, number][] {
  if (pts.length < 2) return [...pts];
  if (pts.length === 2) return [...pts];

  const result: [number, number][] = [];
  const p = [pts[0], ...pts, pts[pts.length - 1]];

  for (let i = 0; i < p.length - 3; i++) {
    const p0 = p[i];
    const p1 = p[i + 1];
    const p2 = p[i + 2];
    const p3 = p[i + 3];

    for (let tStep = 0; tStep <= numPerSeg; tStep++) {
      if (i > 0 && tStep === 0) continue;
      const t = tStep / numPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;

      const f0 = -0.5 * t3 + t2 - 0.5 * t;
      const f1 = 1.5 * t3 - 2.5 * t2 + 1.0;
      const f2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
      const f3 = 0.5 * t3 - 0.5 * t2;

      const x = p0[0] * f0 + p1[0] * f1 + p2[0] * f2 + p3[0] * f3;
      const y = p0[1] * f0 + p1[1] * f1 + p2[1] * f2 + p3[1] * f3;
      result.push([x, y]);
    }
  }

  return result;
}
