// Directional survey calculations (minimum curvature method).

export interface TrajPoint { md: number; inc: number; azi: number; tvd: number; north: number; east: number; hd: number }

const rad = (d: number) => (d * Math.PI) / 180;

/** Compute TVD / northing / easting / horizontal displacement for survey stations (MD ft, inc/azi degrees). */
export function minCurvature(stations: { md: number; inc: number; azi: number }[]): TrajPoint[] {
  const s = stations.filter(x => isFinite(x.md) && isFinite(x.inc)).map(x => ({ ...x, azi: isFinite(x.azi) ? x.azi : 0 })).sort((a, b) => a.md - b.md);
  if (!s.length) return [];
  if (s[0].md > 0) s.unshift({ md: 0, inc: 0, azi: s[0].azi });
  const out: TrajPoint[] = [{ ...s[0], tvd: s[0].md, north: 0, east: 0, hd: 0 }];
  for (let i = 1; i < s.length; i++) {
    const a = s[i - 1], b = s[i], p = out[i - 1];
    const dmd = b.md - a.md;
    const i1 = rad(a.inc), i2 = rad(b.inc), a1 = rad(a.azi), a2 = rad(b.azi);
    const cosDl = Math.cos(i2 - i1) - Math.sin(i1) * Math.sin(i2) * (1 - Math.cos(a2 - a1));
    const dl = Math.acos(Math.max(-1, Math.min(1, cosDl)));
    const rf = dl < 1e-7 ? 1 : (2 / dl) * Math.tan(dl / 2);
    const north = p.north + (dmd / 2) * (Math.sin(i1) * Math.cos(a1) + Math.sin(i2) * Math.cos(a2)) * rf;
    const east = p.east + (dmd / 2) * (Math.sin(i1) * Math.sin(a1) + Math.sin(i2) * Math.sin(a2)) * rf;
    const tvd = p.tvd + (dmd / 2) * (Math.cos(i1) + Math.cos(i2)) * rf;
    out.push({ ...b, tvd, north, east, hd: Math.hypot(north, east) });
  }
  return out;
}

/** Linear interpolation of the trajectory at a measured depth. Extrapolates along the last inclination. */
export function interpAtMd(traj: TrajPoint[], md: number): { tvd: number; hd: number; inc: number } | null {
  if (!traj.length) return null;
  if (md <= traj[0].md) return { tvd: traj[0].tvd, hd: traj[0].hd, inc: traj[0].inc };
  const last = traj[traj.length - 1];
  if (md >= last.md) {
    const extra = md - last.md, i = rad(last.inc);
    return { tvd: last.tvd + extra * Math.cos(i), hd: last.hd + extra * Math.sin(i), inc: last.inc };
  }
  let lo = 0, hi = traj.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (traj[mid].md <= md) lo = mid; else hi = mid; }
  const a = traj[lo], b = traj[hi], f = (md - a.md) / (b.md - a.md || 1);
  return { tvd: a.tvd + f * (b.tvd - a.tvd), hd: a.hd + f * (b.hd - a.hd), inc: a.inc + f * (b.inc - a.inc) };
}
