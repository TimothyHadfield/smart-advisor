// The flowchart's two-finger zoom maths (js/touch.js). Tim, 2026-10-23: "I figure the 1 finger drage around and
// the 2 finger to zoom in/out should probably be applied somewhere".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZOOM, clamp, pinchStart, pinchStep, widthZoom } from '../js/touch.js';

test('pinch: fingers twice as far apart = twice the zoom, and the chart point under them stays under them', () => {
  // chart scrolled to (300, 120) at 0.5x; fingers 100 px apart, midpoint at (150, 200) on screen
  const s = pinchStart(100, 0.5, 150, 200, 300, 120);
  const r = pinchStep(s, 200, 150, 200);
  assert.equal(r.k, 1);
  // the point that was under the midpoint: ((300+150)/0.5, (120+200)/0.5) = (900, 640) in chart px
  assert.equal((r.left + 150) / r.k, 900);
  assert.equal((r.top + 200) / r.k, 640);
});

test('pinch: a two-finger drag pans while it zooms (the point follows the midpoint)', () => {
  const s = pinchStart(120, 1, 100, 100, 0, 0);
  const r = pinchStep(s, 120, 60, 40); // same distance, midpoint moved up-left 40,60
  assert.equal(r.k, 1);
  assert.deepEqual([r.left, r.top], [40, 60]);
});

test('pinch: the zoom stays between the limits and the scroll never goes negative', () => {
  const s = pinchStart(100, 1, 50, 50, 0, 0);
  assert.equal(pinchStep(s, 10, 50, 50).k, ZOOM.min);
  assert.equal(pinchStep(s, 1000, 50, 50).k, ZOOM.max);
  assert.equal(pinchStep(s, 10, 50, 50, 0.2).k, 0.2); // a chart that needs a smaller fit can go lower
  const r = pinchStep(s, 50, 300, 300);
  assert.ok(r.left >= 0 && r.top >= 0);
  assert.equal(pinchStart(0, 1, 0, 0, 0, 0).d0, 1); // two fingers on one spot: no divide by zero
});

test('a phone starts with the whole chart width on screen, never above 1x and never below the floor', () => {
  assert.equal(widthZoom(393, 900, ZOOM.min), (393 - 2) / 900); // EE-sized chart: ~0.43
  assert.equal(widthZoom(393, 300, ZOOM.min), 1); // a narrow chart is not blown up
  assert.equal(widthZoom(393, 3000, ZOOM.min), ZOOM.min); // a very wide one stops at the floor (then pans)
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
});
