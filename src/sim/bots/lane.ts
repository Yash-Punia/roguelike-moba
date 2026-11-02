import { segmentDistSq } from '../../data/map-geometry';
import { len } from '../math';

/**
 * A lane centre line as a track (D-042): distance along it (`s`, metres from the Blue end)
 * for any point, and the point at any `s`. Bots navigate by `s`.
 */
export class LaneTrack {
  /** Cumulative length at each polyline vertex. */
  private readonly cum: Float64Array;
  readonly length: number;
  /** Squared distance from the last `project`ed point to the lane centre line. */
  lastDistSq = 0;

  constructor(private readonly pts: Float64Array) {
    const n = pts.length / 2;
    this.cum = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      this.cum[i] = this.cum[i - 1]! + len(pts[i * 2]! - pts[i * 2 - 2]!, pts[i * 2 + 1]! - pts[i * 2 - 1]!);
    }
    this.length = this.cum[n - 1]!;
  }

  /** Distance along the lane of the nearest lane point to (x, y). */
  project(x: number, y: number): number {
    let best = Infinity;
    let s = 0;
    for (let i = 0; i + 3 < this.pts.length; i += 2) {
      const r = segmentDistSq(x, y, this.pts[i]!, this.pts[i + 1]!, this.pts[i + 2]!, this.pts[i + 3]!);
      if (r.distSq < best) {
        best = r.distSq;
        const k = i / 2;
        s = this.cum[k]! + (this.cum[k + 1]! - this.cum[k]!) * r.t;
      }
    }
    this.lastDistSq = best;
    return s;
  }

  /** The lane point `s` metres from the Blue end (clamped to the lane). */
  pointAt(s: number, out: { x: number; y: number }) {
    const n = this.cum.length;
    if (s <= 0) {
      out.x = this.pts[0]!;
      out.y = this.pts[1]!;
      return out;
    }
    let i = 1;
    while (i < n - 1 && this.cum[i]! < s) i++;
    const a = this.cum[i - 1]!;
    const b = this.cum[i]!;
    const t = b > a ? Math.min(1, (s - a) / (b - a)) : 0;
    out.x = this.pts[i * 2 - 2]! + (this.pts[i * 2]! - this.pts[i * 2 - 2]!) * t;
    out.y = this.pts[i * 2 - 1]! + (this.pts[i * 2 + 1]! - this.pts[i * 2 - 1]!) * t;
    return out;
  }
}
