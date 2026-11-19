// Well Comparison point analysis: selection modes, depth / time matching between wells, before-and-after windows, recorded
// events, historical problems and an evidence-classified interpretation of a parameter change.
//
// Rules this module keeps:
//   - wells are matched by MD or elapsed time, never by array index;
//   - a well without a record at the selected key gets its NEAREST actual record, with the real difference stated;
//     nothing is interpolated or estimated;
//   - every statement carries its evidence class: confirmed (written in the report), data (observed in the records) or
//     possible (an engineering interpretation that the report does not confirm). With too little data it says so.
import { mean, median, onBottom } from './kpi';
import { OP_TYPE } from './operations';
import { bhaAt, operationAt, sectionAt } from './simContext';
import { actName } from './types';
import type { BhaRun, CorrectiveAction, DrillingProblem, DrillingRecord, DrillingTool, HoleSection, Operation, Rec, Well } from './types';

// ------------------------------------------------------------------ parameters
export const CMP_PARAMS = [
  { key: 'rop', field: 'rop_fph', label: 'ROP', unit: 'ft/h' },
  { key: 'wob', field: 'wob_klb', label: 'WOB', unit: 'klb' },
  { key: 'rpm', field: 'rpm', label: 'RPM', unit: 'rpm' },
  { key: 'torque', field: 'torque_ftlb', label: 'Torque', unit: 'ft-lb' },
  { key: 'diff', field: 'diff_pressure_psi', label: 'Differential Pressure', unit: 'psi' },
  { key: 'spp', field: 'spp_psi', label: 'SPP', unit: 'psi' },
  { key: 'flow', field: 'flow_gpm', label: 'Flow Rate', unit: 'gpm' },
  { key: 'mw', field: 'mud_weight_ppg', label: 'Mud Weight', unit: 'ppg' },
  { key: 'hook', field: 'hook_load_klb', label: 'Hook Load', unit: 'klb' },
] as const satisfies readonly { key: string; field: keyof DrillingRecord; label: string; unit: string }[];
export type ParamKey = (typeof CMP_PARAMS)[number]['key'];
export type ParamDef = (typeof CMP_PARAMS)[number];
export const PARAM = Object.fromEntries(CMP_PARAMS.map(p => [p.key, p])) as Record<ParamKey, ParamDef>;
export const ALL_PARAMS = CMP_PARAMS.map(p => p.key) as ParamKey[];
export const DEFAULT_VISIBLE: ParamKey[] = ['rop', 'wob', 'rpm', 'torque', 'diff'];
export const val = (r: DrillingRecord, p: ParamKey): number | null => { const v = r[PARAM[p].field] as number | null; return v != null && isFinite(v) ? v : null; };

/** A change smaller than this (in % of the previous value) is not treated as a change; below STABLE_PCT it is "stable". */
export const SIG_PCT = 10, STABLE_PCT = 5;

// ------------------------------------------------------------------ selection modes
export type SelMode = 'all' | 'independent' | 'custom';
export interface PointSel { key: number; wellId: string; origin: ParamKey; seq: number }
export type SelState = Partial<Record<ParamKey, PointSel>>;

/** Charts that receive a selection made on `origin`. */
export function syncTargets(origin: ParamKey, mode: SelMode, custom: ParamKey[], all: ParamKey[] = ALL_PARAMS): ParamKey[] {
  if (mode === 'all') return [...all];
  if (mode === 'custom' && custom.includes(origin)) return all.filter(p => custom.includes(p));
  return [origin];
}
/** Apply a selection made on one chart; charts outside the sync group keep their own selection. */
export function applySelection(state: SelState, sel: PointSel, mode: SelMode, custom: ParamKey[], all: ParamKey[] = ALL_PARAMS): SelState {
  const out = { ...state };
  for (const p of syncTargets(sel.origin, mode, custom, all)) out[p] = sel;
  return out;
}
/** Clear the selection of one chart (and of its sync group). */
export function clearSelection(state: SelState, origin: ParamKey, mode: SelMode, custom: ParamKey[], all: ParamKey[] = ALL_PARAMS): SelState {
  const out = { ...state };
  for (const p of syncTargets(origin, mode, custom, all)) delete out[p];
  return out;
}
/** When the mode or the custom set changes, the latest selection of the new sync group is propagated at once. */
export function resync(state: SelState, mode: SelMode, custom: ParamKey[], all: ParamKey[] = ALL_PARAMS): SelState {
  if (mode === 'independent') return { ...state };
  const group = mode === 'all' ? all : all.filter(p => custom.includes(p));
  const latest = group.map(p => state[p]).filter((s): s is PointSel => !!s).sort((a, b) => b.seq - a.seq)[0];
  if (!latest) return { ...state };
  const out = { ...state };
  for (const p of group) out[p] = latest;
  return out;
}
/** Charts whose horizontal zoom / pan follows `origin` (all charts share the same depth or time axis). */
export function navTargets(origin: ParamKey, sync: boolean, navSet: ParamKey[], visible: ParamKey[]): ParamKey[] {
  if (!sync || !navSet.includes(origin)) return [];
  return visible.filter(p => p !== origin && navSet.includes(p));
}

// ------------------------------------------------------------------ per-well series on a depth or time axis
export type AxisMode = 'depth' | 'time';
export interface WellSeries {
  wellId: string; name: string; color: string; axis: AxisMode;
  /** all records of the well in time order */
  recs: Rec[];
  /** on-bottom (drilling) records sorted by the axis key */
  on: Rec[]; keys: number[];
  t0: number;
  /** median spacing of the on-bottom records on this axis (ft or h) */
  spacing: number | null;
}
export const axisKey = (r: Rec, axis: AxisMode, t0: number) => (axis === 'depth' ? r.hole : (r.t - t0) / 3600000);

export function buildWellSeries(well: Pick<Well, 'id' | 'name'>, color: string, recs: Rec[], axis: AxisMode): WellSeries {
  const t0 = recs.length ? recs[0].t : 0;
  const on = recs.filter(onBottom).map(r => ({ r, k: axisKey(r, axis, t0) })).filter(x => isFinite(x.k)).sort((a, b) => a.k - b.k || a.r.t - b.r.t);
  const keys = on.map(x => x.k);
  const gaps: number[] = []; for (let i = 1; i < keys.length; i++) if (keys[i] > keys[i - 1]) gaps.push(keys[i] - keys[i - 1]);
  return { wellId: well.id, name: well.name, color, axis, recs, on: on.map(x => x.r), keys, t0, spacing: median(gaps) };
}

export interface Pt { x: number; y: number; rec: Rec }
/** On-bottom records of one well that have a value for the parameter, ordered by the axis key. */
export function paramPoints(ws: WellSeries, p: ParamKey): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < ws.on.length; i++) { const y = val(ws.on[i], p); if (y != null) out.push({ x: ws.keys[i], y, rec: ws.on[i] }); }
  return out;
}

/** Index of the element of a sorted array closest to x (-1 when empty). */
export function nearestIndex(xs: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (!n) return -1;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < x) lo = m + 1; else hi = m; }
  return lo > 0 && Math.abs(xs[lo - 1] - x) <= Math.abs(xs[lo] - x) ? lo - 1 : lo;
}

/** Matching tolerance of a well: the user's value, or three sampling intervals of that well. */
export function tolerance(ws: Pick<WellSeries, 'spacing' | 'axis'>, override: number | null = null): number {
  if (override != null) return override;
  return Math.max((ws.spacing ?? 0) * 3, ws.axis === 'depth' ? 1 : 1 / 60);
}

export interface Match {
  rec: Rec | null; key: number | null;
  /** record key minus selected key (ft or h); null when the well has no drilling record at all */
  diff: number | null;
  status: 'exact' | 'nearest' | 'far' | 'none';
  /** the selected key is outside the range this well covers */
  outside: boolean;
}
const EXACT = { depth: 0.05, time: 1 / 3600 };
export function matchKey(keys: number[], items: Rec[], key: number, tol: number, axis: AxisMode): Match {
  const i = nearestIndex(keys, key);
  if (i < 0) return { rec: null, key: null, diff: null, status: 'none', outside: true };
  const diff = keys[i] - key, ad = Math.abs(diff);
  return { rec: items[i], key: keys[i], diff, status: ad <= EXACT[axis] ? 'exact' : ad <= tol ? 'nearest' : 'far', outside: key < keys[0] - tol || key > keys[keys.length - 1] + tol };
}
export const matchWell = (ws: WellSeries, key: number, tol: number) => matchKey(ws.keys, ws.on, key, tol, ws.axis);
export function matchPoint(pts: Pt[], key: number, tol: number, axis: AxisMode): (Match & { pt: Pt | null }) {
  const m = matchKey(pts.map(p => p.x), pts.map(p => p.rec), key, tol, axis);
  const i = m.rec ? pts.findIndex(p => p.rec === m.rec) : -1;
  return { ...m, pt: i >= 0 ? pts[i] : null };
}

// ------------------------------------------------------------------ report entries and analysis windows
/**
 * One reported entry. A report line that spans several hours is stored as several records with the same source cell and
 * the same reported values (depth spread across the interval), so "the previous drilling record" is the previous ENTRY.
 */
export interface Entry { idx: number; recs: Rec[]; t0: number; t1: number; md0: number; md1: number; src: string | null; onBottom: boolean; interpolated: boolean }
export function entries(recs: Rec[]): Entry[] {
  const out: Entry[] = [];
  for (const r of recs) {
    const last = out[out.length - 1];
    if (last && r.source_ref && last.src === r.source_ref && last.onBottom === onBottom(r)) {
      last.recs.push(r); last.t1 = r.t + r.dt * 3600000; last.md1 = r.hole; last.interpolated ||= r.data_quality === 'interpolated';
    } else out.push({ idx: out.length, recs: [r], t0: r.t, t1: r.t + r.dt * 3600000, md0: r.hole - r.ft, md1: r.hole, src: r.source_ref ?? null, onBottom: onBottom(r), interpolated: r.data_quality === 'interpolated' });
  }
  return out;
}
export const entryValue = (e: Entry, p: ParamKey) => mean(e.recs.map(r => val(r, p)).filter((v): v is number => v != null));

export type WindowKind = 'rec1' | 'rec5' | 'min10' | 'min30' | 'h1';
export const WINDOWS: { id: WindowKind; label: string; records?: number; minutes?: number }[] = [
  { id: 'rec1', label: 'Previous / next drilling record', records: 1 },
  { id: 'rec5', label: 'Previous / next 5 drilling records', records: 5 },
  { id: 'min10', label: 'Previous / next 10 minutes', minutes: 10 },
  { id: 'min30', label: 'Previous / next 30 minutes', minutes: 30 },
  { id: 'h1', label: 'Previous / next 1 hour', minutes: 60 },
];
export interface Window {
  kind: WindowKind; sel: Entry; before: Entry[]; after: Entry[];
  /** time span actually analysed (ms) and its depth range */
  t0: number; t1: number; md0: number; md1: number;
  /** median time between drilling entries of this well, hours */
  entryGapH: number | null;
}
/** Drilling entries before and after the entry that contains `rec`. */
export function analysisWindow(all: Entry[], rec: Rec, kind: WindowKind): Window | null {
  const drill = all.filter(e => e.onBottom);
  const si = drill.findIndex(e => e.recs.includes(rec));
  if (si < 0) return null;
  const sel = drill[si], w = WINDOWS.find(x => x.id === kind)!;
  let before: Entry[], after: Entry[];
  if (w.records) { before = drill.slice(Math.max(0, si - w.records), si); after = drill.slice(si + 1, si + 1 + w.records); }
  else {
    const span = w.minutes! * 60000;
    before = drill.slice(0, si).filter(e => e.t1 >= sel.t0 - span);
    after = drill.slice(si + 1).filter(e => e.t0 <= sel.t1 + span);
  }
  const gaps: number[] = []; for (let i = 1; i < drill.length; i++) gaps.push((drill[i].t0 - drill[i - 1].t0) / 3600000);
  const span = [...before, sel, ...after];
  return {
    kind, sel, before, after, t0: Math.min(...span.map(e => e.t0)), t1: Math.max(...span.map(e => e.t1)),
    md0: Math.min(...span.map(e => e.md0)), md1: Math.max(...span.map(e => e.md1)), entryGapH: median(gaps.filter(g => g > 0)),
  };
}

export interface Change {
  param: ParamKey; prev: number | null; cur: number | null; next: number | null;
  /** value of the immediately preceding / following drilling entry */
  prevRec: number | null; nextRec: number | null;
  abs: number | null; pct: number | null; nextAbs: number | null; nextPct: number | null;
  min: number | null; max: number | null; nBefore: number; nAfter: number;
}
const pctOf = (a: number | null, b: number | null) => (a == null || b == null || Math.abs(a) < 1e-9 ? null : ((b - a) / Math.abs(a)) * 100);
/** Previous = mean of the drilling entries before; current = the selected entry; next = mean of the entries after. */
export function paramChange(w: Window, p: ParamKey): Change {
  const b = w.before.map(e => entryValue(e, p)).filter((v): v is number => v != null);
  const a = w.after.map(e => entryValue(e, p)).filter((v): v is number => v != null);
  const cur = entryValue(w.sel, p), prev = mean(b), next = mean(a);
  const all = [...b, ...a, ...(cur == null ? [] : [cur])];
  return {
    param: p, prev, cur, next, prevRec: w.before.length ? entryValue(w.before[w.before.length - 1], p) : null, nextRec: w.after.length ? entryValue(w.after[0], p) : null,
    abs: prev != null && cur != null ? cur - prev : null, pct: pctOf(prev, cur), nextAbs: next != null && cur != null ? next - cur : null, nextPct: pctOf(cur, next),
    min: all.length ? Math.min(...all) : null, max: all.length ? Math.max(...all) : null, nBefore: b.length, nAfter: a.length,
  };
}
export const allChanges = (w: Window) => Object.fromEntries(ALL_PARAMS.map(p => [p, paramChange(w, p)])) as Record<ParamKey, Change>;

// ------------------------------------------------------------------ context at a record (operation, section, BHA, tools)
export interface WellEquip { operations: Operation[]; runs: BhaRun[]; tools: DrillingTool[]; sections: HoleSection[] }
export interface PointContext {
  op: Operation | null; opName: string; opCategory: string | null; opSource: 'operations log' | 'activity code';
  section: HoleSection | null; holeSize: number | null;
  run: BhaRun | null; bhaNumber: number | null; tools: DrillingTool[];
}
export function contextAt(rec: Rec, eq: WellEquip | null): PointContext {
  const op = eq ? operationAt(eq.operations, rec.t) : null;
  const section = eq ? sectionAt(eq.sections, rec.t, rec.hole) : null;
  const byOp = eq && op?.bha_run_id ? eq.runs.find(r => r.id === op.bha_run_id) : undefined;
  const byNo = eq && rec.bha_number != null ? eq.runs.find(r => r.run_no === rec.bha_number) : undefined;
  const run = eq ? byOp ?? bhaAt(eq.runs, rec.t) ?? byNo ?? null : null;
  return {
    op, opName: op ? OP_TYPE[op.type_code]?.name ?? op.type_code : actName(rec.activity_code), opCategory: op ? op.category : null, opSource: op ? 'operations log' : 'activity code',
    section, holeSize: rec.hole_size_in ?? section?.hole_size_in ?? run?.hole_size_in ?? null,
    run, bhaNumber: rec.bha_number ?? run?.run_no ?? null, tools: run && eq ? eq.tools.filter(x => x.bha_run_id === run.id) : [],
  };
}

// ------------------------------------------------------------------ recorded events of the selected well
export type EventKind = 'bha' | 'bit' | 'formation' | 'hole' | 'activity' | 'operation' | 'npt' | 'problem' | 'text' | 'dull';
export interface WellEvent {
  kind: EventKind; t: number | null; md: number | null; text: string; src: string | null;
  /** parameters the report text explicitly mentions together with a change word */
  mentions: ParamKey[]; quote: string | null;
  /** inside the analysis window (or about the selected run). Problems recorded near the depth at another time are context only. */
  inWindow: boolean;
  problem?: DrillingProblem; actions?: CorrectiveAction[];
}
/** "a; b; c; d; e" -> "a; b; c +2 more" for long lists of source cells */
export const shortSrc = (s: string | null, n = 3) => { if (!s) return s; const a = s.split(/;\s*/); return a.length <= n ? s : `${a.slice(0, n).join('; ')} +${a.length - n} more`; };
const MENTION: Record<ParamKey, RegExp> = {
  rop: /\b(rop|rate of penetration|penetration rate)\b/i, wob: /\b(wob|weight on bit)\b/i, rpm: /\brpm\b|\brotary speed\b/i, torque: /\btorque\b/i,
  diff: /\b(diff(erential)?\.? ?(pressure|press|p)|delta ?p)\b/i, spp: /\b(spp|standpipe|stand pipe|pump pressure)\b/i, flow: /\b(flow ?rate|gpm|lpm|pump rate)\b/i,
  mw: /\b(mud weight|mw|ppg|sg)\b/i, hook: /\b(hook ?load|overpull|drag)\b/i,
};
const CHANGE_WORD = /\b(reduc\w*|increas\w*|decreas\w*|low(er|ered)?|high(er)?|control\w*|limit\w*|restrict\w*|optimi[sz]\w*|erratic|drop\w*|spik\w*|fluctuat\w*|vari\w*|slow\w*|poor|improv\w*|stall\w*)\b/i;
/** Sentences of a report text that mention a parameter together with a change word, e.g. "drilled with reduced WOB due to vibration". */
export function mentions(text: string | null | undefined): { params: ParamKey[]; quote: string | null } {
  if (!text) return { params: [], quote: null };
  const params = new Set<ParamKey>(); let quote: string | null = null;
  for (const s of text.split(/(?<=[.;!?\n])\s+/)) {
    if (!CHANGE_WORD.test(s)) continue;
    for (const p of ALL_PARAMS) if (MENTION[p].test(s)) { params.add(p); quote ??= s.trim().slice(0, 220); }
  }
  return { params: [...params], quote };
}

export interface EventInputs {
  recs: Rec[]; eq: WellEquip | null; problems: DrillingProblem[]; actions: Map<string, CorrectiveAction[]>;
  catName: (id: string) => string; proximityFt: number;
}
const runOf = (r: Rec, eq: WellEquip | null) => r.bha_number ?? (eq ? bhaAt(eq.runs, r.t)?.run_no ?? null : null);
const bitDesc = (run: BhaRun | undefined) => (run ? [run.bit_size_in != null ? `${run.bit_size_in}"` : null, run.bit_type, run.bit_model].filter(Boolean).join(' ') || null : null);

/** What the report records in the analysis window of the selected well. Facts only; nothing here is a conclusion. */
export function recordedEvents(w: Window, x: EventInputs): WellEvent[] {
  const out: WellEvent[] = [];
  const last = w.before[w.before.length - 1], selR = w.sel.recs[0], nextE = w.after[0];
  const pairs: [Entry, Entry][] = [...(last ? [[last, w.sel] as [Entry, Entry]] : []), ...(nextE ? [[w.sel, nextE] as [Entry, Entry]] : [])];
  for (const [a, b] of pairs) {
    const ra = a.recs[a.recs.length - 1], rb = b.recs[0];
    const at = { t: rb.t, md: rb.hole - rb.ft, src: rb.source_ref ?? null, mentions: [] as ParamKey[], quote: null, inWindow: true };
    const bhaA = runOf(ra, x.eq), bhaB = runOf(rb, x.eq);
    if (bhaA != null && bhaB != null && bhaA !== bhaB) {
      out.push({ kind: 'bha', ...at, text: `BHA changed from run ${bhaA} to run ${bhaB}` });
      const ba = bitDesc(x.eq?.runs.find(r => r.run_no === bhaA)), bb = bitDesc(x.eq?.runs.find(r => r.run_no === bhaB));
      if (ba && bb && ba !== bb) out.push({ kind: 'bit', ...at, text: `Bit changed: ${ba} → ${bb}` });
    }
    if (ra.formation_name && rb.formation_name && ra.formation_name !== rb.formation_name) out.push({ kind: 'formation', ...at, text: `Formation changed from ${ra.formation_name} to ${rb.formation_name}` });
    if (ra.hole_size_in != null && rb.hole_size_in != null && ra.hole_size_in !== rb.hole_size_in) out.push({ kind: 'hole', ...at, text: `Hole size changed from ${ra.hole_size_in}" to ${rb.hole_size_in}"` });
    if (ra.activity_code && rb.activity_code && ra.activity_code !== rb.activity_code) out.push({ kind: 'activity', ...at, text: `Drilling mode changed from ${actName(ra.activity_code)} to ${actName(rb.activity_code)}` });
  }
  // operations between the drilling entries of the window (trips, circulation, reaming, NPT ...) and the report text of the entries
  if (x.eq) {
    for (const op of x.eq.operations) {
      const s = Date.parse(op.start_at), e = Date.parse(op.end_at);
      if (!(e > w.t0 && s < w.t1)) continue;
      const m = mentions(op.text);
      const inSel = op.source_ref != null && op.source_ref === w.sel.src;
      if (op.category === 'Drilling' && !op.is_npt && !m.params.length) continue;
      const name = OP_TYPE[op.type_code]?.name ?? op.type_code;
      out.push({ kind: op.is_npt ? 'npt' : 'operation', t: s, md: op.start_md_ft, src: op.source_ref, mentions: m.params, quote: m.quote, inWindow: true,
        text: `${inSel ? 'Selected entry: ' : ''}${name}${op.is_npt ? ` (NPT${op.npt_category ? `: ${op.npt_category}` : ''}, ${op.duration_h.toFixed(1)} h)` : ` (${op.duration_h.toFixed(1)} h)`}` });
    }
  } else {
    const npt = w.before.concat(w.sel, w.after).flatMap(e => e.recs).reduce((s, r) => s + r.npt, 0);
    if (npt > 0) out.push({ kind: 'npt', t: w.t0, md: null, src: null, mentions: [], quote: null, inWindow: true, text: `${npt.toFixed(1)} h NPT recorded in the window` });
  }
  for (const r of x.recs) {
    if (r.t < w.t0 || r.t >= w.t1 || !r.activity_raw) continue;
    if (x.eq?.operations.some(o => o.source_ref && o.source_ref === r.source_ref)) continue;   // the operation already carries its text
    const m = mentions(r.activity_raw);
    if (m.params.length) out.push({ kind: 'text', t: r.t, md: r.hole, src: r.source_ref ?? null, mentions: m.params, quote: m.quote, inWindow: true, text: 'Report text mentions a parameter change' });
  }
  // problems of this well in the window or near the selected depth
  const md = selR.hole;
  for (const p of x.problems) {
    if (p.status === 'dismissed' || p.status === 'anomaly') continue;
    const t = p.occurred_at ? Date.parse(p.occurred_at) : NaN;
    const bottom = Math.max(p.md_bottom_ft ?? p.md_top_ft, p.md_top_ft);
    const dd = md >= p.md_top_ft && md <= bottom ? 0 : Math.min(Math.abs(md - p.md_top_ft), Math.abs(md - bottom));
    const inWindow = t >= w.t0 && t < w.t1;
    if (!(inWindow || dd <= x.proximityFt)) continue;
    const m = mentions(`${p.description}. ${p.source_text ?? ''}`);
    out.push({ kind: 'problem', t: isFinite(t) ? t : null, md: p.md_top_ft, src: p.source_ref ?? null, mentions: m.params, quote: m.quote, inWindow, problem: p, actions: x.actions.get(p.id) ?? [],
      text: `${x.catName(p.category_id)} (${p.status})${dd > 0 ? ` ${Math.round(dd)} ft from the selected depth` : ' at the selected depth'}${p.npt_hours ? `, ${p.npt_hours} h NPT` : ''}` });
  }
  // documented bit wear of the run the selected record belongs to
  const run = x.eq?.runs.find(r => r.run_no === runOf(selR, x.eq));
  if (run?.dull_grade) out.push({ kind: 'dull', t: run.end_at ? Date.parse(run.end_at) : null, md: run.depth_out_ft, src: run.source_ref, mentions: [], quote: null, inWindow: true, text: `Dull grade recorded when the run ${run.run_no} bit was pulled: ${run.dull_grade}` });
  return out.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}

// ------------------------------------------------------------------ historical problems of other wells
export interface HistItem { problem: DrillingProblem; well: Well | null; category: string; depthDiff: number; sameFormation: boolean; actions: CorrectiveAction[] }
export function historicalAt(
  problems: DrillingProblem[], wellId: string, md: number, formation: string | null, canon: (n: string | null | undefined) => string | null,
  proximityFt: number, wells: Map<string, Well>, catName: (id: string) => string, actions: Map<string, CorrectiveAction[]>,
): HistItem[] {
  const f = canon(formation);
  const out: HistItem[] = [];
  for (const p of problems) {
    if (p.well_id === wellId || (p.status !== 'confirmed' && p.status !== 'suspected')) continue;
    const bottom = Math.max(p.md_bottom_ft ?? p.md_top_ft, p.md_top_ft);
    const depthDiff = md >= p.md_top_ft && md <= bottom ? 0 : md < p.md_top_ft ? p.md_top_ft - md : bottom - md;
    const sameFormation = !!f && canon(p.formation_name) === f;
    if (Math.abs(depthDiff) > proximityFt && !sameFormation) continue;
    out.push({ problem: p, well: wells.get(p.well_id) ?? null, category: catName(p.category_id), depthDiff, sameFormation, actions: actions.get(p.id) ?? [] });
  }
  return out.sort((a, b) => Math.abs(a.depthDiff) - Math.abs(b.depthDiff));
}

// ------------------------------------------------------------------ interpretation
export type EvidenceClass = 'confirmed' | 'data' | 'possible' | 'insufficient';
export interface Finding { cls: EvidenceClass; text: string; evidence: string[] }
export interface Explanation { param: ParamKey; direction: 'increase' | 'decrease' | 'stable' | 'unknown'; summary: string; findings: Finding[] }

/** Parameters examined for each target, with the direction of change that would be consistent with it (0 = no direction claimed). */
const DRIVERS: Record<ParamKey, { q: ParamKey; rel: 1 | -1 | 0 }[]> = {
  rop: [{ q: 'wob', rel: 1 }, { q: 'rpm', rel: 1 }, { q: 'diff', rel: 1 }, { q: 'flow', rel: 1 }, { q: 'mw', rel: -1 }, { q: 'torque', rel: 0 }],
  torque: [{ q: 'wob', rel: 1 }, { q: 'rpm', rel: 0 }, { q: 'rop', rel: 0 }, { q: 'mw', rel: 0 }],
  diff: [{ q: 'flow', rel: 1 }, { q: 'wob', rel: 1 }, { q: 'spp', rel: 1 }, { q: 'mw', rel: 0 }],
  spp: [{ q: 'flow', rel: 1 }, { q: 'mw', rel: 1 }, { q: 'diff', rel: 1 }],
  wob: [{ q: 'rop', rel: 0 }, { q: 'torque', rel: 0 }, { q: 'diff', rel: 0 }],
  rpm: [{ q: 'torque', rel: 0 }, { q: 'rop', rel: 0 }],
  flow: [{ q: 'spp', rel: 0 }, { q: 'diff', rel: 0 }],
  mw: [{ q: 'spp', rel: 0 }, { q: 'rop', rel: 0 }],
  hook: [{ q: 'wob', rel: -1 }],
};
export type ValueFmt = (p: ParamKey, v: number | null) => string;
const defaultFmt: ValueFmt = (p, v) => (v == null ? '—' : `${Math.round(v * 10) / 10} ${PARAM[p].unit}`);
const pctTxt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
const absPct = (v: number) => `${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
const listTxt = (a: string[]) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

export function explain(p: ParamKey, ch: Record<ParamKey, Change>, allEvents: WellEvent[], fv: ValueFmt = defaultFmt): Explanation {
  // only what happened in the analysis window can explain the change; problems near the depth at another time are context only
  const events = allEvents.filter(e => e.inWindow);
  const c = ch[p], L = PARAM[p].label, findings: Finding[] = [];
  const ev = (k: EventKind) => events.filter(e => e.kind === k);
  const evid = (e: WellEvent) => [e.src ? `report ${shortSrc(e.src)}` : 'report', ...(e.quote ? [`"${e.quote}"`] : [])];
  // facts written in the report (confirmed). Causation is confirmed only where the text itself ties the parameter to a change.
  const explicit = events.filter(e => e.mentions.includes(p));
  for (const e of explicit) findings.push({ cls: 'confirmed', text: `The report explicitly mentions ${L} in this window: "${e.quote}"`, evidence: evid(e) });
  for (const e of events.filter(e => !e.mentions.includes(p) && e.kind !== 'text')) findings.push({ cls: 'confirmed', text: `Recorded: ${e.text}. The report does not state that this changed ${L}.`, evidence: evid(e) });

  if (c.cur == null || c.prev == null || c.pct == null) {
    const why = c.cur == null ? `${L} is not recorded at the selected point` : `no previous drilling record with ${L} in the analysis window`;
    return { param: p, direction: 'unknown', summary: `Insufficient data to determine the cause of this change: ${why}.`, findings: [...findings, { cls: 'insufficient', text: `Insufficient data to determine the cause of this change (${why}).`, evidence: [] }] };
  }
  const dir = Math.abs(c.pct) < SIG_PCT ? 'stable' : c.pct > 0 ? 'increase' : 'decrease';
  const head = `${L} ${dir === 'increase' ? 'increased' : dir === 'decrease' ? 'decreased' : 'changed'} by ${dir === 'stable' ? pctTxt(c.pct) : absPct(c.pct)} (${fv(p, c.prev)} → ${fv(p, c.cur)})`;
  if (dir === 'stable') {
    return { param: p, direction: 'stable', findings,
      summary: `${head}, which is within ±${SIG_PCT}% of the previous window: no significant change to explain.${events.length ? ' Recorded events in the window are listed for context.' : ''}` };
  }
  const s = dir === 'increase' ? 1 : -1;
  const consistent: string[] = [], consistentLabels: string[] = [], against: string[] = [], stable: string[] = [], concurrent: string[] = [];
  for (const { q, rel } of DRIVERS[p]) {
    const d = ch[q];
    if (d.pct == null) continue;
    const ql = PARAM[q].label, txt = `${ql} ${d.pct > 0 ? 'increased' : 'decreased'} by ${absPct(d.pct)} (${fv(q, d.prev)} → ${fv(q, d.cur)})`, evq = [`${ql}: previous ${fv(q, d.prev)}, current ${fv(q, d.cur)} (${d.nBefore} previous entr${d.nBefore === 1 ? 'y' : 'ies'})`];
    if (Math.abs(d.pct) < STABLE_PCT) { stable.push(`${ql} remained relatively stable (${pctTxt(d.pct)})`); findings.push({ cls: 'data', text: `${ql} remained relatively stable (${pctTxt(d.pct)}), so it does not explain the ${dir} in ${L}.`, evidence: evq }); continue; }
    if (Math.abs(d.pct) < SIG_PCT) continue;
    const dd = d.pct > 0 ? 1 : -1;
    if (rel === 0) { concurrent.push(txt); findings.push({ cls: 'data', text: `${txt} at the same time; the records alone do not show which change drove the other.`, evidence: evq }); }
    else if (dd * rel === s) { consistent.push(`${ql} ${d.pct > 0 ? 'increased' : 'decreased'} by ${absPct(d.pct)}`); consistentLabels.push(ql); findings.push({ cls: 'data', text: `${txt} in the same window, which is consistent with the ${dir} in ${L}.`, evidence: evq }); }
    else { against.push(txt); findings.push({ cls: 'data', text: `${txt}, which would normally move ${L} the other way; it does not explain the ${dir}.`, evidence: evq }); }
  }
  // engineering interpretations that the report does not confirm
  const possible = (text: string, evidence: string[] = []) => findings.push({ cls: 'possible', text, evidence });
  const form = ev('formation')[0], bha = ev('bha')[0], bit = ev('bit')[0], act = ev('activity')[0], dull = ev('dull')[0];
  const dTorque = ch.torque.pct, dWob = ch.wob.pct;
  if (p === 'rop') {
    if (form) possible(`A ${dir === 'decrease' ? 'harder' : 'softer'} or different formation may have ${dir === 'decrease' ? 'slowed' : 'sped up'} drilling (${form.text.toLowerCase()}); rock strength is not recorded.`, evid(form));
    if (bha || bit) possible(`The ${bit ? 'new bit' : 'new BHA'} may drill differently in this interval (${(bit ?? bha)!.text.toLowerCase()}).`, evid((bit ?? bha)!));
    if (act) possible(`${act.text}; sliding usually drills slower than rotary drilling.`, evid(act));
    if (dir === 'decrease' && dTorque != null && dTorque >= SIG_PCT && !(dWob != null && dWob >= SIG_PCT)) possible(`Torque rose ${absPct(dTorque)} without more WOB, which can indicate bit wear, bit balling or another drilling dysfunction; the report does not confirm this.`, [`Torque ${fv('torque', ch.torque.prev)} → ${fv('torque', ch.torque.cur)}`]);
    if (dir === 'decrease' && dull) possible(`Bit wear is documented for this run (${dull.text.split(': ').pop()}); when the wear developed is not recorded.`, evid(dull));
  } else if (p === 'torque') {
    if (form) possible(`The formation change may have changed the torque response (${form.text.toLowerCase()}).`, evid(form));
    if (dir === 'increase' && !(dWob != null && dWob >= SIG_PCT)) possible('Torque rose without more WOB. Hole cleaning, a tight hole or mechanical friction can do this; none of these is recorded at this point unless listed above.');
    if (dir === 'decrease' && events.some(e => e.kind === 'operation' && /ream|circulat|wiper|short trip/i.test(e.text))) possible('Reaming, circulating or a wiper trip recorded in the window may have improved hole condition.');
    if (bha || bit) possible(`The BHA / bit change may have changed the torque response (${(bit ?? bha)!.text.toLowerCase()}).`, evid((bit ?? bha)!));
  } else if (p === 'diff' || p === 'spp') {
    if (!consistent.length && !concurrent.length) possible('A change in motor loading or pump conditions that the records do not capture.');
    if (bha) possible(`The BHA change (motor / bit nozzles) may have changed the pressure response (${bha.text.toLowerCase()}).`, evid(bha));
  } else if (p === 'wob' || p === 'rpm' || p === 'flow' || p === 'mw') {
    if (act) possible(`${act.text}; the driller sets ${L} differently for sliding and rotating.`, evid(act));
    if (!explicit.length) possible(`${L} is set by the rig crew; the change may be a deliberate parameter change. The report does not state the reason.`);
  }

  // one-paragraph summary in the order: change, consistent factors, stable factors, conclusion
  let summary = `${head}${consistent.length ? ` while ${listTxt(consistent)}` : ''}.`;
  if (stable.length) summary += ` ${listTxt(stable)}.`;
  if (explicit.length) summary += ` The report explicitly mentions ${L} in this window ("${explicit[0].quote}").`;
  else if (consistent.length) summary += ` This suggests that the ${listTxt(consistentLabels)} change${consistentLabels.length > 1 ? 's' : ''} may have contributed to the ${dir === 'increase' ? 'increase' : 'decrease'}. The drilling report does not explicitly confirm the cause.`;
  else if (events.length) summary += ` Recorded events in the window (${listTxt(events.slice(0, 3).map(e => e.text.toLowerCase()))}) may be related, but the report does not state the cause.`;
  else summary += ' Insufficient data to determine the cause of this change.';
  if (!consistent.length && !explicit.length && events.length && !findings.some(f => f.cls === 'possible')) findings.push({ cls: 'insufficient', text: 'The recorded parameters do not explain this change.', evidence: [] });
  if (!consistent.length && !explicit.length && !events.length) findings.push({ cls: 'insufficient', text: 'Insufficient data to determine the cause of this change.', evidence: [] });
  if (against.length && !consistent.length && !explicit.length) summary += ` (${listTxt(against)}: not consistent with this change.)`;
  return { param: p, direction: dir, summary, findings };
}
