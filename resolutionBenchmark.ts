/**
 * Resolution Benchmark Diagnostic Test
 *
 * Runs an objective 60-frame benchmark comparing 160px, 320px, and 640px processing widths.
 * Computes:
 * - Actual width & height
 * - Measured detection FPS
 * - Average processing time (ms)
 * - Corner Jitter & Aim Stability:
 *     Jitter X (standard deviation)
 *     Jitter Y (standard deviation)
 *     Total RMS Jitter: sqrt(JitterX^2 + JitterY^2)
 * - Screen-detection success rate (%)
 */

import { detectFixedTvBorder, type BorderQuad } from './borderTracker';

export interface ResolutionBenchmarkResult {
  targetWidth: number;
  actualWidth: number;
  actualHeight: number;
  testedFrames: number;
  successFrames: number;
  successRatePercent: number;
  avgProcessingTimeMs: number;
  minProcessingTimeMs: number;
  maxProcessingTimeMs: number;
  estimatedFps: number;
  jitterX: number;
  jitterY: number;
  totalRmsJitter: number;
  cornerJitter: number;
}

export class ResolutionBenchmarkRunner {
  public static async runBenchmarkOnVideo(
    video: HTMLVideoElement,
    targetWidth: number,
    frameCount: number = 60,
    onProgress?: (frame: number, total: number) => void
  ): Promise<ResolutionBenchmarkResult> {
    const aspect = video.videoWidth / (video.videoHeight || 1) || 4 / 3;
    const actualWidth = targetWidth;
    const actualHeight = Math.max(30, Math.round(targetWidth / aspect));

    const canvas = document.createElement('canvas');
    canvas.width = actualWidth;
    canvas.height = actualHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Could not acquire 2D context for benchmark canvas');
    }

    const times: number[] = [];
    const aimXs: number[] = [];
    const aimYs: number[] = [];
    const cornerDeltas: number[] = [];
    let prevCorners: BorderQuad | null = null;
    let successCount = 0;

    for (let f = 0; f < frameCount; f++) {
      // Draw scaled frame
      ctx.drawImage(video, 0, 0, actualWidth, actualHeight);
      const imgData = ctx.getImageData(0, 0, actualWidth, actualHeight);

      const t0 = performance.now();
      const res = detectFixedTvBorder(imgData.data, actualWidth, actualHeight, { autoThreshold: true });
      const elapsed = performance.now() - t0;
      times.push(elapsed);

      if (res.detected) {
        successCount++;
        // Aim center point estimate
        const cx = (res.corners.tl.x + res.corners.tr.x + res.corners.br.x + res.corners.bl.x) / 4;
        const cy = (res.corners.tl.y + res.corners.tr.y + res.corners.br.y + res.corners.bl.y) / 4;
        aimXs.push(cx);
        aimYs.push(cy);

        if (prevCorners) {
          const dTL = Math.hypot(res.corners.tl.x - prevCorners.tl.x, res.corners.tl.y - prevCorners.tl.y);
          const dTR = Math.hypot(res.corners.tr.x - prevCorners.tr.x, res.corners.tr.y - prevCorners.tr.y);
          const dBR = Math.hypot(res.corners.br.x - prevCorners.br.x, res.corners.br.y - prevCorners.br.y);
          const dBL = Math.hypot(res.corners.bl.x - prevCorners.bl.x, res.corners.bl.y - prevCorners.bl.y);
          cornerDeltas.push((dTL + dTR + dBR + dBL) / 4);
        }
        prevCorners = res.corners;
      }

      if (onProgress) {
        onProgress(f + 1, frameCount);
      }

      // Small tick between frames to let browser breathe
      await new Promise(r => setTimeout(r, 16));
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const estimatedFps = avgTime > 0 ? 1000 / avgTime : 0;

    // Objective standard deviation / RMS variation
    let jitterX = 0;
    let jitterY = 0;
    let totalRmsJitter = 0;

    if (aimXs.length > 1) {
      const meanX = aimXs.reduce((a, b) => a + b, 0) / aimXs.length;
      const meanY = aimYs.reduce((a, b) => a + b, 0) / aimYs.length;

      const varX = aimXs.reduce((acc, val) => acc + (val - meanX) ** 2, 0) / aimXs.length;
      const varY = aimYs.reduce((acc, val) => acc + (val - meanY) ** 2, 0) / aimYs.length;

      jitterX = Math.sqrt(varX);
      jitterY = Math.sqrt(varY);
      totalRmsJitter = Math.sqrt(varX + varY);
    }

    const cornerJitter = cornerDeltas.length > 0
      ? cornerDeltas.reduce((a, b) => a + b, 0) / cornerDeltas.length
      : 0;

    return {
      targetWidth,
      actualWidth,
      actualHeight,
      testedFrames: frameCount,
      successFrames: successCount,
      successRatePercent: (successCount / frameCount) * 100,
      avgProcessingTimeMs: avgTime,
      minProcessingTimeMs: minTime,
      maxProcessingTimeMs: maxTime,
      estimatedFps,
      jitterX,
      jitterY,
      totalRmsJitter,
      cornerJitter
    };
  }
}
