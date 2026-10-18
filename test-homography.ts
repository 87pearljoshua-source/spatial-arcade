import { runHomographySelfTest } from '../src/cv/homography.js';

const res = runHomographySelfTest();
console.log('Self-Test Result:', res);
if (!res.passed) {
  process.exit(1);
}
console.log('HOMOGRAPHY SELF TEST VERIFIED PASS!');
