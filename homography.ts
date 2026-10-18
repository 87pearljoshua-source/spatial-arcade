/**
 * Projective Homography Module (Requirement 2)
 *
 * Maps camera-frame coordinates (center + aim offset) to normalized TV coordinates [0, 1].
 * Includes mathematical self-test on known square and skewed quad.
 */

import type { Point, QuadCorners } from './borderDetection';

export interface HomographyResult {
  rawU: number;
  rawV: number;
  clampedU: number;
  clampedV: number;
  isInside: boolean;
}

export interface SelfTestResult {
  passed: boolean;
  squarePassed: boolean;
  skewedPassed: boolean;
  timestamp: number;
  logs: string[];
}

/**
 * Computes the 3x3 homography matrix that maps from camera space (x, y) to unit TV space (u, v)
 * where:
 *   tl -> (0, 0)
 *   tr -> (1, 0)
 *   br -> (1, 1)
 *   bl -> (0, 1)
 */
export function computeHomographyMatrix(corners: QuadCorners): number[] | null {
  // Ordered corners:
  // p0=(0,0) -> tl
  // p1=(1,0) -> tr
  // p2=(1,1) -> br
  // p3=(0,1) -> bl
  const x0 = corners.tl.x, y0 = corners.tl.y;
  const x1 = corners.tr.x, y1 = corners.tr.y;
  const x2 = corners.br.x, y2 = corners.br.y;
  const x3 = corners.bl.x, y3 = corners.bl.y;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;

  // Exact Heckbert 1989 formulas:
  // g * dx1 + h * dx2 = deltaX
  // g * dy1 + h * dy2 = deltaY
  const deltaX = x0 - x1 + x2 - x3;
  const deltaY = y0 - y1 + y2 - y3;

  let a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number;

  if (Math.abs(deltaX) < 1e-9 && Math.abs(deltaY) < 1e-9) {
    // Parallelogram / Affine
    a = x1 - x0;
    b = x3 - x0;
    c = x0;
    d = y1 - y0;
    e = y3 - y0;
    f = y0;
    g = 0;
    h = 0;
  } else {
    // General Quad Projective
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-9) return null; // Degenerate

    g = (deltaX * dy2 - deltaY * dx2) / denom;
    h = (dx1 * deltaY - dy1 * deltaX) / denom;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    c = x0;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
    f = y0;
  }

  // M maps from unit square (u, v) -> quad (x, y)
  // Inverse matrix H = M^-1 maps quad (x, y) -> unit square (u, v)
  const A = e - f * h;
  const B = f * g - d;
  const C = d * h - e * g;
  const D = c * h - b;
  const E = a - c * g;
  const F = b * g - a * h;
  const G = b * f - c * e;
  const H_term = c * d - a * f;
  const K = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1.0 / det;

  return [
    A * invDet, D * invDet, G * invDet,
    B * invDet, E * invDet, H_term * invDet,
    C * invDet, F * invDet, K * invDet
  ];
}

/**
 * Maps a camera coordinate (x, y) to TV coordinates (u, v) using 4 corner homography
 */
export function mapCameraToTv(point: Point, corners: QuadCorners): HomographyResult {
  const H = computeHomographyMatrix(corners);

  if (!H) {
    // Fallback if degenerate
    return {
      rawU: 0.5,
      rawV: 0.5,
      clampedU: 0.5,
      clampedV: 0.5,
      isInside: true
    };
  }

  const px = point.x;
  const py = point.y;

  const uPrime = H[0] * px + H[1] * py + H[2];
  const vPrime = H[3] * px + H[4] * py + H[5];
  const wPrime = H[6] * px + H[7] * py + H[8];

  if (Math.abs(wPrime) < 1e-9) {
    return {
      rawU: 0.5,
      rawV: 0.5,
      clampedU: 0.5,
      clampedV: 0.5,
      isInside: false
    };
  }

  const rawU = uPrime / wPrime;
  const rawV = vPrime / wPrime;

  const clampedU = Math.min(1.0, Math.max(0.0, rawU));
  const clampedV = Math.min(1.0, Math.max(0.0, rawV));
  const isInside = rawU >= 0.0 && rawU <= 1.0 && rawV >= 0.0 && rawV <= 1.0;

  return {
    rawU,
    rawV,
    clampedU,
    clampedV,
    isInside
  };
}

/**
 * Self-test function verifying homography on known square and skewed quad
 */
export function runHomographySelfTest(): SelfTestResult {
  const logs: string[] = [];

  // TEST 1: Known Square
  // Corners centered in unit frame from 0.2 to 0.8
  const squareCorners: QuadCorners = {
    tl: { x: 0.2, y: 0.2 },
    tr: { x: 0.8, y: 0.2 },
    br: { x: 0.8, y: 0.8 },
    bl: { x: 0.2, y: 0.8 }
  };

  const centerRes = mapCameraToTv({ x: 0.5, y: 0.5 }, squareCorners);
  const tlRes = mapCameraToTv({ x: 0.2, y: 0.2 }, squareCorners);
  const brRes = mapCameraToTv({ x: 0.8, y: 0.8 }, squareCorners);
  const outRes = mapCameraToTv({ x: 0.1, y: 0.5 }, squareCorners);

  const squareCenterOk = Math.abs(centerRes.rawU - 0.5) < 1e-4 && Math.abs(centerRes.rawV - 0.5) < 1e-4;
  const squareTlOk = Math.abs(tlRes.rawU - 0.0) < 1e-4 && Math.abs(tlRes.rawV - 0.0) < 1e-4;
  const squareBrOk = Math.abs(brRes.rawU - 1.0) < 1e-4 && Math.abs(brRes.rawV - 1.0) < 1e-4;
  const squareOutOk = outRes.rawU < 0.0 && !outRes.isInside;

  const squarePassed = squareCenterOk && squareTlOk && squareBrOk && squareOutOk;
  logs.push(`Square Test: ${squarePassed ? 'PASS' : 'FAIL'} (Center: [${centerRes.rawU.toFixed(3)}, ${centerRes.rawV.toFixed(3)}], Off-screen raw: ${outRes.rawU.toFixed(3)})`);

  // TEST 2: Known Skewed Trapezoid Quad
  // TL=(0.25, 0.20), TR=(0.75, 0.20), BR=(0.90, 0.80), BL=(0.10, 0.80)
  const skewedCorners: QuadCorners = {
    tl: { x: 0.25, y: 0.20 },
    tr: { x: 0.75, y: 0.20 },
    br: { x: 0.90, y: 0.80 },
    bl: { x: 0.10, y: 0.80 }
  };

  // The projective center (u=0.5, v=0.5) is precisely the intersection of diagonals:
  // D1: (0.25, 0.2) -> (0.9, 0.8) => y - 0.2 = (0.6 / 0.65) * (x - 0.25)
  // D2: (0.75, 0.2) -> (0.1, 0.8) => y - 0.2 = (-0.6 / 0.65) * (x - 0.75)
  // Intersection is x = 0.5, y = 0.2 + (0.6 / 0.65) * 0.25 = 0.43076923
  const projectiveCenterPoint = { x: 0.5, y: 0.2 + (0.6 / 0.65) * 0.25 };
  const skewCenterRes = mapCameraToTv(projectiveCenterPoint, skewedCorners);
  const skewTlRes = mapCameraToTv(skewedCorners.tl, skewedCorners);
  const skewTrRes = mapCameraToTv(skewedCorners.tr, skewedCorners);
  const skewBrRes = mapCameraToTv(skewedCorners.br, skewedCorners);
  const skewBlRes = mapCameraToTv(skewedCorners.bl, skewedCorners);

  const skewCenterOk = Math.abs(skewCenterRes.rawU - 0.5) < 1e-4 && Math.abs(skewCenterRes.rawV - 0.5) < 1e-4;
  const skewCornersOk =
    Math.hypot(skewTlRes.rawU - 0, skewTlRes.rawV - 0) < 1e-4 &&
    Math.hypot(skewTrRes.rawU - 1, skewTrRes.rawV - 0) < 1e-4 &&
    Math.hypot(skewBrRes.rawU - 1, skewBrRes.rawV - 1) < 1e-4 &&
    Math.hypot(skewBlRes.rawU - 0, skewBlRes.rawV - 1) < 1e-4;

  const skewedPassed = skewCenterOk && skewCornersOk;
  logs.push(`Skewed Quad Test: ${skewedPassed ? 'PASS' : 'FAIL'} (Projective center map: [${skewCenterRes.rawU.toFixed(4)}, ${skewCenterRes.rawV.toFixed(4)}])`);

  const passed = squarePassed && skewedPassed;

  return {
    passed,
    squarePassed,
    skewedPassed,
    timestamp: Date.now(),
    logs
  };
}
