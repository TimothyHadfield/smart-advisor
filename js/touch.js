// Touch helpers for the phone (Tim, 2026-10-23: "I figure the 1 finger drage around and the 2 finger to zoom
// in/out should probably be applied somewhere"). The flowchart pans with one finger (the chart's own native
// scrolling, momentum included) and zooms with two (pinchStep, anchored under the fingers). A tap on a box
// still opens it; a drag never does (dragGuard). The class details on a phone are a bottom sheet that can be
// dragged up (taller) or down (closed) by its handle (sheetDrag).
// The top half is pure (Node tests); the rest wires elements.

// zoom range for a pinch; a phone starts with the chart's whole width on screen (never smaller than min)
export const ZOOM = { min: 0.4, max: 2.5, floor: 0.15 };
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// two-finger pinch. start = { d0, k0, cx, cy }: the fingers' distance and the zoom when the pinch began, and
// the chart point (unscaled px) that was under their midpoint. d = the fingers' distance now, (mx, my) = their
// midpoint now (relative to the chart's top-left corner). -> { k, left, top }: the new zoom and the scroll
// position that keeps that chart point under the fingers (a two-finger drag pans while it zooms)
export function pinchStart(d0, k0, mx, my, scrollLeft, scrollTop) {
  return { d0: Math.max(1, d0), k0, cx: (scrollLeft + mx) / k0, cy: (scrollTop + my) / k0 };
}
export function pinchStep(start, d, mx, my, minK = ZOOM.min, maxK = ZOOM.max) {
  const k = clamp(start.k0 * d / start.d0, minK, maxK);
  return { k, left: Math.max(0, start.cx * k - mx), top: Math.max(0, start.cy * k - my) };
}

// the zoom a phone starts at: the chart's whole width on screen, but never below ZOOM.min; never above 1
export const widthZoom = (screenW, chartW, floor) => Math.min(1, Math.max(floor, (screenW - 2) / Math.max(1, chartW)));

// a tap that moved more than `slop` px (finger or the scroller itself), or that was part of a two-finger
// gesture, is a drag, not a tap. Returns moved(event): true when that click came from a drag. A keyboard
// click (detail 0) is never a drag.
export function dragGuard(scroller, slop = 10) {
  let x = 0, y = 0, sl = 0, st = 0, moved = false, down = 0;
  scroller.addEventListener('pointerdown', (e) => {
    down++;
    if (down > 1) { moved = true; return; } // a second finger: a pinch
    x = e.clientX; y = e.clientY; sl = scroller.scrollLeft; st = scroller.scrollTop; moved = false;
  }, true);
  scroller.addEventListener('pointermove', (e) => { if (down && Math.hypot(e.clientX - x, e.clientY - y) > slop) moved = true; }, true);
  const up = () => { down = Math.max(0, down - 1); };
  scroller.addEventListener('pointerup', up, true);
  scroller.addEventListener('pointercancel', (e) => { up(e); moved = true; }, true); // the browser took it as a scroll
  scroller.addEventListener('touchstart', (e) => { if (e.touches.length > 1) moved = true; }, { passive: true, capture: true });
  return (e) => (e && e.detail === 0 ? false : moved || Math.abs(scroller.scrollLeft - sl) > slop || Math.abs(scroller.scrollTop - st) > slop);
}

// a bottom sheet's handle: drag down past 70 px closes it, drag up makes it tall, a tap on the handle switches
// tall / normal. The sheet follows the finger while dragging.
export function sheetDrag(sheet, handle, { close }) {
  let y0 = null, dy = 0, id = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    y0 = e.clientY; dy = 0; id = e.pointerId;
    try { handle.setPointerCapture(id); } catch {}
    sheet.style.transition = 'none';
  });
  handle.addEventListener('pointermove', (e) => {
    if (y0 === null || e.pointerId !== id) return;
    dy = e.clientY - y0;
    sheet.style.transform = `translateY(${Math.max(-24, dy)}px)`;
  });
  const end = (e) => {
    if (y0 === null || e.pointerId !== id) return;
    y0 = null;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 70) close();
    else if (dy < -30) sheet.classList.add('tall');
    else if (dy > 30) sheet.classList.remove('tall');
    else if (Math.abs(dy) < 6) sheet.classList.toggle('tall');
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}
