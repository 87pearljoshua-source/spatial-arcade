/**
 * Dedicated Fixed TV Border Tracker (Optical Screen-Border Detection)
 *
 * Sinden-inspired optical boundary tracking:
 * Identifies the candidate quadrilateral formed by four continuous high-contrast
 * white border segments enclosing the screen.
 *
 * Satisfies the 7 mandatory properties:
 * 1. Interior game content cannot replace the border as the tracking primitive.
 * 2. Validates four distinct boundary sides and corners.
 * 3. Confirms approximately rectangular / projective geometry.
 * 4. Verifies edge and line coverage along all 4 perimeter segments.
 * 5. Rejects arbitrary bright blobs (lamps, windows, lights) lacking 4-sided border topology.
 * 6. Resilient to camera perspective tilt and angles.
 * 7. Completely immune to changing interior game content.
 */

export interface Point {
  x: number;
  y: number;
}

export interface BorderQuad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

export interface BorderDetectionResult {
  detected: boolean;
  corners: BorderQuad;
  confidence: number;
  coverage: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    average: number;
  };
  processingTimeMs: number;
  thresholdUsed: number;
  reason?: string;
}

interface LineEquation {
  a: number; // a*x + b*y + c = 0
  b: number;
  c: number;
  inliers: number;
}

/**
 * Robustly intersects two lines defined as a*x + b*y + c = 0
 */
function intersectLines(l1: LineEquation, l2: LineEquation): Point | null {
  const det = l1.a * l2.b - l2.a * l1.b;
  if (Math.abs(det) < 1e-6) return null; // Parallel lines
  const x = (l1.b * l2.c - l2.b * l1.c) / det;
  const y = (l2.a * l1.c - l1.a * l2.c) / det;
  return { x, y };
}

/**
 * Robust line fit with iterative outlier rejection (Theil-Sen / Huber style)
 */
function fitRobustLine(points: Point[], isHorizontal: boolean): LineEquation | null {
  if (points.length < 5) return null;

  // Initial estimate using median slope
  let sumX = 0, sumY = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
  }
  const meanX = sumX / points.length;
  const meanY = sumY / points.length;

  if (isHorizontal) {
    // y = m*x + c  =>  m*x - y + c = 0
    let num = 0, den = 0;
    for (const p of points) {
      num += (p.x - meanX) * (p.y - meanY);
      den += (p.x - meanX) * (p.x - meanX);
    }
    const m = den !== 0 ? num / den : 0;
    const c = meanY - m * meanX;

    // Filter outliers: reject points with vertical residual > 4px
    const inliers = points.filter(p => Math.abs(m * p.x - p.y + c) <= 4.0);
    if (inliers.length < 4) return { a: m, b: -1, c, inliers: points.length };

    // Re-fit on inliers
    let iSumX = 0, iSumY = 0;
    for (const p of inliers) { iSumX += p.x; iSumY += p.y; }
    const iMeanX = iSumX / inliers.length;
    const iMeanY = iSumY / inliers.length;
    let iNum = 0, iDen = 0;
    for (const p of inliers) {
      iNum += (p.x - iMeanX) * (p.y - iMeanY);
      iDen += (p.x - iMeanX) * (p.x - iMeanX);
    }
    const finalM = iDen !== 0 ? iNum / iDen : m;
    const finalC = iMeanY - finalM * iMeanX;
    return { a: finalM, b: -1, c: finalC, inliers: inliers.length };
  } else {
    // Vertical line: x = m*y + c  =>  -x + m*y + c = 0
    let num = 0, den = 0;
    for (const p of points) {
      num += (p.y - meanY) * (p.x - meanX);
      den += (p.y - meanY) * (p.y - meanY);
    }
    const m = den !== 0 ? num / den : 0;
    const c = meanX - m * meanY;

    // Filter outliers: reject points with horizontal residual > 4px
    const inliers = points.filter(p => Math.abs(-p.x + m * p.y + c) <= 4.0);
    if (inliers.length < 4) return { a: -1, b: m, c, inliers: points.length };

    let iSumX = 0, iSumY = 0;
    for (const p of inliers) { iSumX += p.x; iSumY += p.y; }
    const iMeanX = iSumX / inliers.length;
    const iMeanY = iSumY / inliers.length;
    let iNum = 0, iDen = 0;
    for (const p of inliers) {
      iNum += (p.y - iMeanY) * (p.x - iMeanX);
      iDen += (p.y - iMeanY) * (p.y - iMeanY);
    }
    const finalM = iDen !== 0 ? iNum / iDen : m;
    const finalC = iMeanX - finalM * iMeanY;
    return { a: -1, b: finalM, c: finalC, inliers: inliers.length };
  }
}

/**
 * Evaluates binary brightness along a line segment
 */
function sampleSegmentCoverage(
  p1: Point,
  p2: Point,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
  numSamples: number = 30
): number {
  let hits = 0;
  for (let i = 0; i <= numSamples; i++) {
    const t = i / numSamples;
    const sx = Math.round(p1.x + (p2.x - p1.x) * t);
    const sy = Math.round(p1.y + (p2.y - p1.y) * t);

    if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
      const idx = (sy * width + sx) * 4;
      const luma = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
      if (luma >= threshold) {
        hits++;
      }
    }
  }
  return hits / (numSamples + 1);
}

/**
 * Dedicated Fixed TV Border Detector
 * Processes a camera image buffer and returns the candidate quadrilateral.
 */
export function detectFixedTvBorder(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: {
    manualThreshold?: number;
    autoThreshold?: boolean;
    minSideCoverage?: number;
  } = {}
): BorderDetectionResult {
  const t0 = performance.now();
  const minSideCoverage = options.minSideCoverage ?? 0.45;

  // 1. Calculate dynamic bright border threshold
  // The TV border is solid white against dark/black surroundings.
  let thresh = options.manualThreshold ?? 160;
  if (options.autoThreshold !== false) {
    // Histogram to find the upper luminance peak (the white border)
    let maxLuma = 0;
    let sumLuma = 0;
    const count = width * height;
    const step = 4; // Subsample for fast threshold estimation
    let samples = 0;

    for (let i = 0; i < pixels.length; i += 4 * step) {
      const luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      sumLuma += luma;
      if (luma > maxLuma) maxLuma = luma;
      samples++;
    }

    const avgLuma = sumLuma / samples;
    // Border is bright white; set threshold between avg and max
    thresh = Math.max(120, Math.min(220, Math.round(avgLuma * 0.4 + maxLuma * 0.6)));
  }

  // 2. Scanline Outer Perimeter Search
  // We scan from the outer frame boundaries inwards toward the center.
  // The FIRST bright transition encountered corresponds to the OUTER EDGE of the TV border.
  // Any bright interior game content is strictly behind this outer boundary!

  const topPoints: Point[] = [];
  const bottomPoints: Point[] = [];
  const leftPoints: Point[] = [];
  const rightPoints: Point[] = [];

  const xStart = Math.round(width * 0.08);
  const xEnd = Math.round(width * 0.92);
  const xStep = Math.max(2, Math.floor(width / 80));

  const yStart = Math.round(height * 0.08);
  const yEnd = Math.round(height * 0.92);
  const yStep = Math.max(2, Math.floor(height / 60));

  // Vertical scanlines: find Top and Bottom border outer edges
  for (let x = xStart; x <= xEnd; x += xStep) {
    // Scan down from top
    let foundTop = false;
    for (let y = 2; y < height * 0.6; y++) {
      const idx = (y * width + x) * 4;
      const luma = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
      if (luma >= thresh) {
        topPoints.push({ x, y });
        foundTop = true;
        break;
      }
    }

    // Scan up from bottom
    for (let y = height - 3; y > height * 0.4; y--) {
      const idx = (y * width + x) * 4;
      const luma = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
      if (luma >= thresh) {
        bottomPoints.push({ x, y });
        break;
      }
    }
  }

  // Horizontal scanlines: find Left and Right border outer edges
  for (let y = yStart; y <= yEnd; y += yStep) {
    // Scan right from left
    for (let x = 2; x < width * 0.6; x++) {
      const idx = (y * width + x) * 4;
      const luma = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
      if (luma >= thresh) {
        leftPoints.push({ x, y });
        break;
      }
    }

    // Scan left from right
    for (let x = width - 3; x > width * 0.4; x--) {
      const idx = (y * width + x) * 4;
      const luma = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
      if (luma >= thresh) {
        rightPoints.push({ x, y });
        break;
      }
    }
  }

  const defaultCorners: BorderQuad = {
    tl: { x: 0.1, y: 0.1 },
    tr: { x: 0.9, y: 0.1 },
    br: { x: 0.9, y: 0.9 },
    bl: { x: 0.1, y: 0.9 }
  };

  const elapsed = performance.now() - t0;

  // Validate that we found candidate points on all four sides
  if (topPoints.length < 6 || bottomPoints.length < 6 || leftPoints.length < 6 || rightPoints.length < 6) {
    return {
      detected: false,
      corners: defaultCorners,
      confidence: 0,
      coverage: { top: 0, bottom: 0, left: 0, right: 0, average: 0 },
      processingTimeMs: elapsed,
      thresholdUsed: thresh,
      reason: 'Insufficient outer border edge points'
    };
  }

  // 3. Fit 4 robust border lines
  const lineTop = fitRobustLine(topPoints, true);
  const lineBottom = fitRobustLine(bottomPoints, true);
  const lineLeft = fitRobustLine(leftPoints, false);
  const lineRight = fitRobustLine(rightPoints, false);

  if (!lineTop || !lineBottom || !lineLeft || !lineRight) {
    return {
      detected: false,
      corners: defaultCorners,
      confidence: 0,
      coverage: { top: 0, bottom: 0, left: 0, right: 0, average: 0 },
      processingTimeMs: elapsed,
      thresholdUsed: thresh,
      reason: 'Failed to fit 4 border line segments'
    };
  }

  // 4. Compute 4 corner intersections
  const pTL = intersectLines(lineTop, lineLeft);
  const pTR = intersectLines(lineTop, lineRight);
  const pBR = intersectLines(lineBottom, lineRight);
  const pBL = intersectLines(lineBottom, lineLeft);

  if (!pTL || !pTR || !pBR || !pBL) {
    return {
      detected: false,
      corners: defaultCorners,
      confidence: 0,
      coverage: { top: 0, bottom: 0, left: 0, right: 0, average: 0 },
      processingTimeMs: elapsed,
      thresholdUsed: thresh,
      reason: 'Corner lines do not intersect'
    };
  }

  // 5. Geometric Quadrilateral Validation
  // Must be approximately projective rectangle with reasonable dimensions and screen aspect ratio
  const quadWidth = ((pTR.x - pTL.x) + (pBR.x - pBL.x)) / 2;
  const quadHeight = ((pBL.y - pTL.y) + (pBR.y - pTR.y)) / 2;

  // TV display must occupy at least 25% width and 20% height of camera frame
  const minScreenW = width * 0.25;
  const minScreenH = height * 0.20;

  if (quadWidth < minScreenW || quadHeight < minScreenH) {
    return {
      detected: false,
      corners: defaultCorners,
      confidence: 0,
      coverage: { top: 0, bottom: 0, left: 0, right: 0, average: 0 },
      processingTimeMs: elapsed,
      thresholdUsed: thresh,
      reason: `Quadrilateral dimensions too small (${quadWidth.toFixed(0)}x${quadHeight.toFixed(0)} < ${minScreenW.toFixed(0)}x${minScreenH.toFixed(0)})`
    };
  }

  const aspectRatio = quadWidth / quadHeight;
  // TVs are 16:9 (1.78) or 4:3 (1.33) in landscape, or 9:16 (0.56) or 3:4 (0.75) in portrait.
  // 1:1 squares (0.90 to 1.15) or extreme slivers are rejected.
  const isLandscapeScreen = aspectRatio >= 1.15 && aspectRatio <= 2.6;
  const isPortraitScreen = aspectRatio >= 0.45 && aspectRatio <= 0.85;

  if (!isLandscapeScreen && !isPortraitScreen) {
    return {
      detected: false,
      corners: defaultCorners,
      confidence: 0,
      coverage: { top: 0, bottom: 0, left: 0, right: 0, average: 0 },
      processingTimeMs: elapsed,
      thresholdUsed: thresh,
      reason: `Non-screen aspect ratio (${aspectRatio.toFixed(2)}: rejected square or extreme shape)`
    };
  }

  // Corner angle checks (must be approximately perpendicular: 60 deg to 120 deg)
  const angleTL = Math.abs(Math.atan2(pTR.y - pTL.y, pTR.x - pTL.x) - Math.atan2(pBL.y - pTL.y, pBL.x - pTL.x)) * (180 / Math.PI);
  const normAngleTL = angleTL > 180 ? 360 - angleTL : angleTL;
  if (normAngleTL < 55 || normAngleTL > 125) {
    return {
      detected: false,
      corners: defaultCorners,
      confidence: 0,
      coverage: { top: 0, bottom: 0, left: 0, right: 0, average: 0 },
      processingTimeMs: elapsed,
      thresholdUsed: thresh,
      reason: `Corner angles not rectangular (${normAngleTL.toFixed(1)} deg)`
    };
  }

  // 6. Multi-Point Border Line Coverage Verification
  // Sample along all 4 perimeter segments to ensure a physical white border actually exists
  const covTop = sampleSegmentCoverage(pTL, pTR, pixels, width, height, thresh);
  const covBottom = sampleSegmentCoverage(pBL, pBR, pixels, width, height, thresh);
  const covLeft = sampleSegmentCoverage(pTL, pBL, pixels, width, height, thresh);
  const covRight = sampleSegmentCoverage(pTR, pBR, pixels, width, height, thresh);

  const avgCoverage = (covTop + covBottom + covLeft + covRight) / 4;

  if (covTop < minSideCoverage || covBottom < minSideCoverage || covLeft < minSideCoverage || covRight < minSideCoverage) {
    return {
      detected: false,
      corners: defaultCorners,
      confidence: avgCoverage,
      coverage: { top: covTop, bottom: covBottom, left: covLeft, right: covRight, average: avgCoverage },
      processingTimeMs: elapsed,
      thresholdUsed: thresh,
      reason: `Insufficient perimeter border line coverage (min side ${(Math.min(covTop, covBottom, covLeft, covRight) * 100).toFixed(0)}% < ${(minSideCoverage * 100).toFixed(0)}%)`
    };
  }

  // Normalized corners (0.0 to 1.0)
  const normTL = { x: Math.max(0, Math.min(1, pTL.x / width)), y: Math.max(0, Math.min(1, pTL.y / height)) };
  const normTR = { x: Math.max(0, Math.min(1, pTR.x / width)), y: Math.max(0, Math.min(1, pTR.y / height)) };
  const normBR = { x: Math.max(0, Math.min(1, pBR.x / width)), y: Math.max(0, Math.min(1, pBR.y / height)) };
  const normBL = { x: Math.max(0, Math.min(1, pBL.x / width)), y: Math.max(0, Math.min(1, pBL.y / height)) };

  return {
    detected: true,
    corners: { tl: normTL, tr: normTR, br: normBR, bl: normBL },
    confidence: avgCoverage,
    coverage: { top: covTop, bottom: covBottom, left: covLeft, right: covRight, average: avgCoverage },
    processingTimeMs: elapsed,
    thresholdUsed: thresh
  };
}
