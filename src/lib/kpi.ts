// KPI engine: every figure shown in the app is derived here from stored drilling records.
import type { DailyReport, DrillingProblem, DrillingRecord, Rec, Well } from './types';
import { localDay } from './time';

export const isDrillingCode = (c: string | null) => c === 'ROT' || c === 'SLD';
/** On-bottom drilling: by activity when recorded, otherwise by positive ROP. */
export const onBottom = (r: DrillingRecord) => (r.activity_code ? isDrillingCode(r.activity_code) : (r.rop_fph ?? 0) > 0);

export const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
export const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
export function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const nums = (recs: DrillingRecord[], k: keyof DrillingRecord) =>
  recs.map(r => r[k] as number | null).filter((v): v is number => v != null && isFinite(v));

/**
 * Sort records by time and attach derived fields.
 * Effective hole depth = running maximum of hole depth; when a file has no hole-depth column the MD column is
 * used, and bit depth only as a last resort (bit depth is never used when hole depth or MD exist).
 */
export function prepareRecords(raw: DrillingRecord[]): Rec[] {
  const rows = raw.map(r => ({ r, t: new Date(r.ts).getTime() })).filter(x => isFinite(x.t)).sort((a, b) => a.t - b.t);
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) gaps.push((rows[i].t - rows[i - 1].t) / 3600000);
  const med = median(gaps.filter(g => g > 0)) ?? 1;
  const cap = Math.max(med * 4, med + 1 / 60);
  let hole = -Infinity;
  const out: Rec[] = [];
  for (let i = 0; i < rows.length; i++) {
    const { r, t } = rows[i];
    const gap = i < rows.length - 1 ? (rows[i + 1].t - t) / 3600000 : med;
    const dt = Math.min(Math.max(gap, 0), cap);
    const depth = r.hole_depth_ft ?? r.md_ft ?? r.bit_depth_ft;
    const prev = hole;
    if (depth != null && isFinite(depth)) hole = Math.max(hole, depth);
    const h = isFinite(hole) ? hole : 0;
    const ft = i === 0 || !isFinite(prev) ? 0 : Math.max(0, h - prev);
    const npt = r.npt_hours != null ? Math.min(Math.max(r.npt_hours, 0), dt) : r.activity_code === 'WOO' ? dt : 0;
    out.push({ ...r, t, dt, hole: h, ft, npt });
  }
  return out;
}

export function depthBasis(recs: DrillingRecord[]): 'hole depth' | 'MD' | 'bit depth' | 'none' {
  if (recs.some(r => r.hole_depth_ft != null)) return 'hole depth';
  if (recs.some(r => r.md_ft != null)) return 'MD';
  if (recs.some(r => r.bit_depth_ft != null)) return 'bit depth';
  return 'none';
}

export interface Breakdown {
  top: number; bottom: number; footage: number; totalHours: number;
  drillHours: number; connHours: number; circHours: number; tripHours: number; reamHours: number;
  otherHours: number; nptHours: number; rop: number | null;
}

/** Exclusive time split: NPT first, the remainder of each record goes to its activity bucket. */
export function breakdown(recs: Rec[]): Breakdown {
  const b: Breakdown = { top: 0, bottom: 0, footage: 0, totalHours: 0, drillHours: 0, connHours: 0, circHours: 0, tripHours: 0, reamHours: 0, otherHours: 0, nptHours: 0, rop: null };
  if (!recs.length) return b;
  b.top = recs[0].hole - recs[0].ft; b.bottom = recs[recs.length - 1].hole;
  for (const r of recs) {
    b.footage += r.ft; b.totalHours += r.dt; b.nptHours += r.npt;
    const rest = Math.max(0, r.dt - r.npt);
    // explicit per-record hour columns (daily-style data) take precedence over the activity code
    const explicit = r.drilling_hours != null || r.circulating_hours != null || r.connection_time_min != null;
    if (explicit) {
      const dr = Math.min(r.drilling_hours ?? 0, rest), ci = r.circulating_hours ?? 0, co = (r.connection_time_min ?? 0) / 60;
      b.drillHours += dr; b.circHours += ci; b.connHours += co;
      b.otherHours += Math.max(0, rest - dr - ci - co);
    } else if (onBottom(r)) b.drillHours += rest;
    else if (r.activity_code === 'CON') b.connHours += rest;
    else if (r.activity_code === 'CIR') b.circHours += rest;
    else if (r.activity_code === 'TRP') b.tripHours += rest;
    else if (r.activity_code === 'REA') b.reamHours += rest;
    else b.otherHours += rest;
  }
  b.rop = b.drillHours > 0 ? b.footage / b.drillHours : null;
  return b;
}

export function activityHours(recs: Rec[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const r of recs) { const c = r.activity_code ?? 'OTH'; o[c] = (o[c] ?? 0) + r.dt; }
  return o;
}

export interface Segment { code: string; t0: number; t1: number; md0: number; md1: number }
/** Merge consecutive records with the same activity into rig-state segments. */
export function segments(recs: Rec[]): Segment[] {
  const out: Segment[] = [];
  for (const r of recs) {
    const code = r.activity_code ?? 'OTH', end = r.t + r.dt * 3600000, last = out[out.length - 1];
    if (last && last.code === code && r.t - last.t1 < 60000) { last.t1 = end; last.md1 = r.hole; }
    else out.push({ code, t0: r.t, t1: end, md0: r.hole - r.ft, md1: r.hole });
  }
  return out;
}

export function groupBy<T, K>(items: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of items) { const k = key(x); const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); }
  return m;
}

const avgOn = (recs: Rec[], k: keyof DrillingRecord) => mean(nums(recs.filter(onBottom), k));

export function dailyReports(well: Pick<Well, 'id'>, recs: Rec[]): DailyReport[] {
  // a report day is the rig's local calendar day (Asia/Baghdad), from the stored UTC instants
  const days = [...groupBy(recs, r => localDay(r.t)).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return days.map(([date, rs], i) => {
    const b = breakdown(rs), ah = activityHours(rs);
    const forms = [...new Set(rs.map(r => r.formation_name).filter(Boolean))].join(', ');
    const top = Object.entries(ah).sort((a, c) => c[1] - a[1])[0]?.[0];
    const probs = [...new Set(rs.map(r => r.problem_text).filter(Boolean))];
    const summary = `Made ${b.footage.toFixed(0)} ft of new hole (${b.top.toFixed(0)} to ${b.bottom.toFixed(0)} ft MD).` +
      (b.rop ? ` On-bottom ROP ${b.rop.toFixed(1)} ft/h over ${b.drillHours.toFixed(1)} drilling hours.` : ' No on-bottom drilling recorded.') +
      (b.nptHours > 0 ? ` NPT ${b.nptHours.toFixed(1)} h.` : '') + (probs.length ? ` Reported: ${probs.join('; ')}.` : '') +
      (top ? ` Main activity code: ${top}.` : '');
    return {
      well_id: well.id, report_date: date, day_number: i + 1,
      start_md_ft: b.top, end_md_ft: b.bottom, footage_ft: b.footage, total_hours: b.totalHours,
      drilling_hours: b.drillHours, connection_hours: b.connHours, circulating_hours: b.circHours,
      tripping_hours: b.tripHours, other_hours: b.otherHours + b.reamHours, npt_hours: b.nptHours,
      avg_rop_fph: b.rop, avg_wob_klb: avgOn(rs, 'wob_klb'), avg_rpm: avgOn(rs, 'rpm'), avg_torque_ftlb: avgOn(rs, 'torque_ftlb'),
      avg_spp_psi: avgOn(rs, 'spp_psi'), avg_flow_gpm: avgOn(rs, 'flow_gpm'), avg_diff_psi: avgOn(rs, 'diff_pressure_psi'),
      mud_weight_ppg: mean(nums(rs, 'mud_weight_ppg')), activity_hours: ah, formations: forms || null, summary,
    };
  });
}

/** Contiguous formation intervals from the per-record formation column. */
export function deriveFormationIntervals(recs: Rec[]) {
  const out: { formation_name: string; top_md_ft: number; bottom_md_ft: number; top_tvd_ft: number | null; bottom_tvd_ft: number | null }[] = [];
  for (const r of recs) {
    if (!r.formation_name || r.ft <= 0 && out.length) { if (out.length && r.formation_name === out[out.length - 1].formation_name) out[out.length - 1].bottom_tvd_ft = r.tvd_ft ?? out[out.length - 1].bottom_tvd_ft; continue; }
    const last = out[out.length - 1];
    if (last && last.formation_name === r.formation_name) { last.bottom_md_ft = r.hole; if (r.tvd_ft != null) last.bottom_tvd_ft = r.tvd_ft; }
    else {
      if (last) last.bottom_md_ft = Math.max(last.bottom_md_ft, r.hole - r.ft);
      out.push({ formation_name: r.formation_name, top_md_ft: r.hole - r.ft, bottom_md_ft: r.hole, top_tvd_ft: r.tvd_ft, bottom_tvd_ft: r.tvd_ft });
    }
  }
  return out.filter(x => x.bottom_md_ft > x.top_md_ft);
}

/** Hole sections from the per-record hole size / BHA columns (falls back to the well's hole size). */
export function deriveSections(recs: Rec[], well: Pick<Well, 'hole_size_in'>) {
  const out: { name: string; hole_size_in: number | null; bha_number: number | null; top_md_ft: number; bottom_md_ft: number }[] = [];
  for (const r of recs) {
    if (r.ft <= 0) continue;
    const size = r.hole_size_in ?? well.hole_size_in ?? null, bha = r.bha_number ?? null, last = out[out.length - 1];
    if (last && last.hole_size_in === size && last.bha_number === bha) last.bottom_md_ft = r.hole;
    else out.push({ name: size != null ? `${size}" section` : 'Section', hole_size_in: size, bha_number: bha, top_md_ft: r.hole - r.ft, bottom_md_ft: r.hole });
  }
  return out;
}

export interface ParamStat { avg: number | null; min: number | null; max: number | null }
const stat = (recs: Rec[], k: keyof DrillingRecord): ParamStat => {
  const v = nums(recs, k);
  return { avg: mean(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
};
export interface RunPerf {
  bha: number | null; holeSize: number | null; rop: number | null; ropOverall: number | null; footage: number;
  runHours: number; depthIn: number; depthOut: number;
  wob: ParamStat; torque: ParamStat; rpm: ParamStat; diff: ParamStat; flow: ParamStat;
}
/** Performance of one BHA run, from the records belonging to it (already cut at the playhead). */
export function runPerf(runRecs: Rec[]): RunPerf | null {
  if (!runRecs.length) return null;
  const b = breakdown(runRecs), on = runRecs.filter(onBottom), last = runRecs[runRecs.length - 1];
  return {
    bha: last.bha_number, holeSize: last.hole_size_in, rop: b.rop, ropOverall: b.totalHours > 0 ? b.footage / b.totalHours : null,
    footage: b.footage, runHours: b.totalHours, depthIn: b.top, depthOut: b.bottom,
    wob: stat(on, 'wob_klb'), torque: stat(on, 'torque_ftlb'), rpm: stat(on, 'rpm'), diff: stat(on, 'diff_pressure_psi'), flow: stat(on, 'flow_gpm'),
  };
}

/** Average on-bottom parameters per depth bin; used by the depth-synchronised comparison charts. */
export function depthBins(recs: Rec[], binFt: number) {
  const m = groupBy(recs.filter(onBottom), r => Math.floor(r.hole / binFt) * binFt);
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([depth, rs]) => {
    const b = breakdown(rs);
    return {
      depth, rop: b.rop ?? mean(nums(rs, 'rop_fph')), wob: mean(nums(rs, 'wob_klb')), rpm: mean(nums(rs, 'rpm')),
      torque: mean(nums(rs, 'torque_ftlb')), diff: mean(nums(rs, 'diff_pressure_psi')), spp: mean(nums(rs, 'spp_psi')), flow: mean(nums(rs, 'flow_gpm')),
    };
  });
}

/** Days-vs-depth curve, thinned to at most `maxPts` points. */
export function progressCurve(recs: Rec[], maxPts = 400): [number, number][] {
  if (!recs.length) return [];
  const t0 = recs[0].t, step = Math.max(1, Math.floor(recs.length / maxPts)), out: [number, number][] = [];
  for (let i = 0; i < recs.length; i += step) out.push([(recs[i].t - t0) / 86400000, recs[i].hole]);
  const l = recs[recs.length - 1];
  out.push([(l.t - t0) / 86400000, l.hole]);
  return out;
}

/** Average of recent on-bottom parameters around an index, used as "current conditions". */
export function paramSnapshot(recs: Rec[], idx: number, lookback = 12): Record<string, number> {
  const win = recs.slice(Math.max(0, idx - lookback + 1), idx + 1).filter(onBottom);
  const o: Record<string, number> = {};
  for (const k of ['rop_fph', 'wob_klb', 'rpm', 'torque_ftlb', 'spp_psi', 'flow_gpm', 'diff_pressure_psi', 'mud_weight_ppg', 'hook_load_klb'] as const) {
    const m = mean(nums(win, k));
    if (m != null) o[k] = Math.round(m * 100) / 100;
  }
  return o;
}

export interface WellSummary {
  well: Well; finalDepth: number | null; days: number; totalHours: number; footage: number; drillHours: number;
  avgRop: number | null; nptHours: number; problems: number; lastDate: string | null; progress: number | null;
}
/** Well-level KPIs from the stored daily reports and problem records. */
export function summarize(well: Well, reports: DailyReport[], problems: DrillingProblem[]): WellSummary {
  const rs = reports.filter(r => r.well_id === well.id);
  const totalHours = sum(rs.map(r => r.total_hours)), footage = sum(rs.map(r => r.footage_ft)), drillHours = sum(rs.map(r => r.drilling_hours));
  const depths = rs.map(r => r.end_md_ft).filter((v): v is number => v != null);
  const finalDepth = depths.length ? Math.max(...depths) : null;
  return {
    well, finalDepth, days: totalHours / 24, totalHours, footage, drillHours,
    avgRop: drillHours > 0 ? footage / drillHours : null,
    nptHours: sum(rs.map(r => r.npt_hours)),
    problems: problems.filter(p => p.well_id === well.id && p.status !== 'dismissed' && p.status !== 'anomaly').length,
    lastDate: rs.length ? rs.map(r => String(r.report_date).slice(0, 10)).sort().pop()! : null,
    progress: finalDepth != null && well.target_depth_ft ? Math.min(100, (finalDepth / well.target_depth_ft) * 100) : null,
  };
}
