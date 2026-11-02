/** Gauge face radius of the charge ring, in SVG units (the viewBox is 100 × 100). */
export const RING_R = 38;
export const RING_LENGTH = 2 * Math.PI * RING_R;
/** The needle sweeps 270°, from 7:30 (−135°, empty) to 4:30 (+135°, full), like a pressure gauge. */
export const NEEDLE_SWEEP = 270;

/**
 * Where the charge ring and needle sit for a charge of 0–100: the ring's dash offset (it
 * fills clockwise from 12 o'clock) and the needle angle in degrees from 12 o'clock.
 */
export function ultGaugeGeometry(charge: number): { dashOffset: number; needleDeg: number } {
  const f = Math.max(0, Math.min(100, charge)) / 100;
  return { dashOffset: RING_LENGTH * (1 - f), needleDeg: -NEEDLE_SWEEP / 2 + NEEDLE_SWEEP * f };
}
