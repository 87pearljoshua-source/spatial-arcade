import { detectBorderQuad, CV_WIDTH, CV_HEIGHT } from '../src/cv/borderDetection.js';

function createBlank(): Uint8ClampedArray {
  return new Uint8ClampedArray(CV_WIDTH * CV_HEIGHT * 4);
}

function drawRect(pixels: Uint8ClampedArray, rx: number, ry: number, rw: number, rh: number, r: number, g: number, b: number) {
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      if (x >= 0 && x < CV_WIDTH && y >= 0 && y < CV_HEIGHT) {
        const idx = (y * CV_WIDTH + x) * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
      }
    }
  }
}

function drawHollowBorder(pixels: Uint8ClampedArray, rx: number, ry: number, rw: number, rh: number, thick: number) {
  // Top
  drawRect(pixels, rx, ry, rw, thick, 255, 255, 255);
  // Bottom
  drawRect(pixels, rx, ry + rh - thick, rw, thick, 255, 255, 255);
  // Left
  drawRect(pixels, rx, ry, thick, rh, 255, 255, 255);
  // Right
  drawRect(pixels, rx + rw - thick, ry, thick, rh, 255, 255, 255);
}

console.log('Testing Border Detection:');

// Test 1: TV border (3.5% height = ~8px on 240p) with interior game content
const img1 = createBlank();
const bx = 40, by = 30, bw = 240, bh = 180, thick = 8;
drawHollowBorder(img1, bx, by, bw, bh, thick);
// Add interior colored game
drawRect(img1, bx + 50, by + 40, 60, 50, 255, 50, 50); // Red sprite
drawRect(img1, bx + 120, by + 90, 40, 40, 255, 255, 255); // White explosion inside!

const res1 = detectBorderQuad(img1, 140);
console.log('Test 1 (Border + game content):', res1.detected, res1.rejectReason || '');
if (!res1.detected || !res1.corners) {
  throw new Error('Test 1 failed to detect border');
}
console.log('  Corners:', res1.corners);
console.log('  Target TL:', bx / CV_WIDTH, by / CV_HEIGHT);
console.log('  Target BR:', (bx + bw - 1) / CV_WIDTH, (by + bh - 1) / CV_HEIGHT);

// Verify corners match outer bounds
const errTL = Math.hypot(res1.corners.tl.x - bx / CV_WIDTH, res1.corners.tl.y - by / CV_HEIGHT);
if (errTL > 0.02) {
  throw new Error(`Test 1 TL corner error too large: ${errTL}`);
}

// Test 2: Area < 3% rejection
const img2 = createBlank();
drawHollowBorder(img2, 100, 100, 30, 20, 2); // Tiny box (~150 px < 2304 px)
const res2 = detectBorderQuad(img2, 140);
console.log('Test 2 (Area < 3% rejection):', !res2.detected, res2.rejectReason);
if (res2.detected) {
  throw new Error('Test 2 should have rejected tiny area');
}

// Test 3: Side ratio > 3x rejection
const img3 = createBlank();
// Extreme thin strip (width 200, height 10)
drawHollowBorder(img3, 20, 100, 250, 12, 3);
const res3 = detectBorderQuad(img3, 140);
console.log('Test 3 (Side ratio > 3x rejection):', !res3.detected, res3.rejectReason);
if (res3.detected) {
  throw new Error('Test 3 should have rejected extreme aspect strip');
}

console.log('ALL BORDER DETECTION TESTS PASSED!');
