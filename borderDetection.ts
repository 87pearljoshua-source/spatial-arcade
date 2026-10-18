/**
 * Dedicated Fixed TV Border Detector (Requirement 1)
 *
 * - Analyzes at 320x240 (CV_WIDTH x CV_HEIGHT).
 * - Thresholds bright pixels, finds largest connected component.
 * - Finds 4 OUTER corners as extreme points along diagonals (ignores interior).
 * - Rejects if: area < 3% of frame, outer quad is not convex, or opposite sides differ by >3x in length.
 */

export const CV_WIDTH = 320;
export const CV_HEIGHT = 240;

export interface Point {
  x: number;
  y: number;
}

export interface QuadCorners {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

export interface DetectionResult {
  detected: boolean;
  corners: QuadCorners | null;
  rejectReason?: string;
  area: number;
  thresholdMask: Uint8Array;
}

/**
 * Checks whether 4 ordered corners form a strictly convex polygon
 */
export function isConvex(corners: QuadCorners): boolean {
  const pts = [corners.tl, corners.tr, corners.br, corners.bl];
  let sign: number | null = null;

  for (let i = 0; i < 4; i++) {
    const p1 = pts[i];
    const p2 = pts[(i + 1) % 4];
    const p3 = pts[(i + 2) % 4];

    const dx1 = p2.x - p1.x;
    const dy1 = p2.y - p1.y;
    const dx2 = p3.x - p2.x;
    const dy2 = p3.y - p2.y;

    const cross = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(cross) < 1e-6) return false; // Collinear edges

    const curSign = cross > 0 ? 1 : -1;
    if (sign === null) {
      sign = curSign;
    } else if (sign !== curSign) {
      return false; // Sign flip => non-convex
    }
  }

  return true;
}

/**
 * Checks whether opposite sides differ by more than 3x in length
 */
export function checkSideRatio(corners: QuadCorners): boolean {
  const topLen = Math.hypot(corners.tr.x - corners.tl.x, corners.tr.y - corners.tl.y);
  const bottomLen = Math.hypot(corners.br.x - corners.bl.x, corners.br.y - corners.bl.y);
  const leftLen = Math.hypot(corners.bl.x - corners.tl.x, corners.bl.y - corners.tl.y);
  const rightLen = Math.hypot(corners.br.x - corners.tr.x, corners.br.y - corners.tr.y);

  const minHoriz = Math.min(topLen, bottomLen);
  const maxHoriz = Math.max(topLen, bottomLen);
  const minVert = Math.min(leftLen, rightLen);
  const maxVert = Math.max(leftLen, rightLen);

  if (minHoriz <= 1e-4 || minVert <= 1e-4) return false;

  const ratioHoriz = maxHoriz / minHoriz;
  const ratioVert = maxVert / minVert;

  return ratioHoriz <= 3.0 && ratioVert <= 3.0;
}

/**
 * Core Fixed Border Detection Pipeline
 */
export function detectBorderQuad(
  pixels: Uint8ClampedArray,
  threshold: number
): DetectionResult {
  const totalPixels = CV_WIDTH * CV_HEIGHT;
  const binaryMask = new Uint8Array(totalPixels);

  // 1. Threshold bright pixels
  for (let i = 0; i < pixels.length; i += 4) {
    const luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    if (luma >= threshold) {
      binaryMask[i / 4] = 1;
    }
  }

  // 2. Find largest connected component using queue-based BFS
  const visited = new Uint8Array(totalPixels);
  const queue = new Int32Array(totalPixels);

  let largestArea = 0;
  let bestTL: Point = { x: 0, y: 0 };
  let bestTR: Point = { x: 0, y: 0 };
  let bestBR: Point = { x: 0, y: 0 };
  let bestBL: Point = { x: 0, y: 0 };

  for (let y = 0; y < CV_HEIGHT; y++) {
    for (let x = 0; x < CV_WIDTH; x++) {
      const startIndex = y * CV_WIDTH + x;
      if (binaryMask[startIndex] === 1 && visited[startIndex] === 0) {
        // Start BFS
        visited[startIndex] = 1;
        queue[0] = startIndex;
        let head = 0;
        let tail = 1;

        let compArea = 0;
        let minSum = Infinity;   // TL: min(x + y)
        let maxSum = -Infinity;  // BR: max(x + y)
        let maxDiff = -Infinity; // TR: max(x - y)
        let minDiff = Infinity;  // BL: min(x - y)

        let tlPt = { x, y };
        let trPt = { x, y };
        let brPt = { x, y };
        let blPt = { x, y };

        while (head < tail) {
          const curr = queue[head++];
          compArea++;

          const cx = curr % CV_WIDTH;
          const cy = (curr / CV_WIDTH) | 0;

          const sum = cx + cy;
          const diff = cx - cy;

          // Extreme points along diagonals
          if (sum < minSum) {
            minSum = sum;
            tlPt = { x: cx, y: cy };
          }
          if (diff > maxDiff) {
            maxDiff = diff;
            trPt = { x: cx, y: cy };
          }
          if (sum > maxSum) {
            maxSum = sum;
            brPt = { x: cx, y: cy };
          }
          if (diff < minDiff) {
            minDiff = diff;
            blPt = { x: cx, y: cy };
          }

          // 4-connected neighbors
          const neighbors = [
            curr - CV_WIDTH, // up
            curr + CV_WIDTH, // down
            cx > 0 ? curr - 1 : -1, // left
            cx < CV_WIDTH - 1 ? curr + 1 : -1 // right
          ];

          for (let n = 0; n < 4; n++) {
            const nIdx = neighbors[n];
            if (nIdx >= 0 && nIdx < totalPixels && binaryMask[nIdx] === 1 && visited[nIdx] === 0) {
              visited[nIdx] = 1;
              queue[tail++] = nIdx;
            }
          }
        }

        if (compArea > largestArea) {
          largestArea = compArea;
          bestTL = tlPt;
          bestTR = trPt;
          bestBR = brPt;
          bestBL = blPt;
        }
      }
    }
  }

  // 3. Rejection checks
  // A. Area < 3% of frame
  const minArea = totalPixels * 0.03; // 2304 px
  if (largestArea < minArea) {
    return {
      detected: false,
      corners: null,
      rejectReason: `Area too small (${largestArea} < ${minArea.toFixed(0)} px, ${(largestArea / totalPixels * 100).toFixed(1)}% < 3%)`,
      area: largestArea,
      thresholdMask: binaryMask
    };
  }

  // Normalize corners to 0..1 relative to camera frame
  const normalizedCorners: QuadCorners = {
    tl: { x: bestTL.x / CV_WIDTH, y: bestTL.y / CV_HEIGHT },
    tr: { x: bestTR.x / CV_WIDTH, y: bestTR.y / CV_HEIGHT },
    br: { x: bestBR.x / CV_WIDTH, y: bestBR.y / CV_HEIGHT },
    bl: { x: bestBL.x / CV_WIDTH, y: bestBL.y / CV_HEIGHT }
  };

  // B. Convexity check
  if (!isConvex(normalizedCorners)) {
    return {
      detected: false,
      corners: null,
      rejectReason: 'Outer quad is not convex',
      area: largestArea,
      thresholdMask: binaryMask
    };
  }

  // C. Opposite side length ratio check (differ by > 3x)
  if (!checkSideRatio(normalizedCorners)) {
    return {
      detected: false,
      corners: null,
      rejectReason: 'Opposite sides differ by more than 3x in length',
      area: largestArea,
      thresholdMask: binaryMask
    };
  }

  return {
    detected: true,
    corners: normalizedCorners,
    area: largestArea,
    thresholdMask: binaryMask
  };
}
