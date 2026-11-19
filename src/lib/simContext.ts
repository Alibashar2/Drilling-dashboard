// What the simulation shows at the playhead: the operation in progress, the hole section, the BHA in the hole and the
// equipment that belongs to the operation, and the two independent alert systems:
//   - CURRENT WELL: problems recorded in this well's own reports (red) - facts, not predictions;
//   - HISTORICAL OFFSET: problems of other wells near the current depth / formation (amber) - warnings only.
import type { AlertColor, BhaRun, CasingString, CementingEvent, DrillingProblem, DrillingTool, HoleSection, Operation, Rec } from './types';

export interface Equip { operations: Operation[]; runs: BhaRun[]; tools: DrillingTool[]; casings: CasingString[]; cementing: CementingEvent[]; sections: HoleSection[] }
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

/** The operation in progress at time t; null when the report records no operation at that moment. */
export function operationAt(ops: Operation[], t: number): Operation | null {
  let lo = 0, hi = ops.length - 1, found: Operation | null = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ms(ops[m].start_at) <= t) { found = ops[m]; lo = m + 1; } else hi = m - 1; }
  return found && t < ms(found.end_at) ? found : null;
}
export function sectionAt(sections: HoleSection[], t: number, holeDepth: number | null): HoleSection | null {
  return sections.find(s => ms(s.start_at) <= t && t < ms(s.end_at))
    ?? (holeDepth != null ? sections.find(s => s.top_md_ft != null && s.bottom_md_ft != null && holeDepth >= s.top_md_ft && holeDepth <= s.bottom_md_ft) ?? null : null);
}
/** The BHA run in the hole at time t (between its make-up and lay-down). */
export function bhaAt(runs: BhaRun[], t: number): BhaRun | null {
  return runs.find(r => ms(r.start_at) <= t && (r.end_at == null || t < ms(r.end_at))) ?? null;
}

export type ToolView =
  | { kind: 'bha'; title: string; run: BhaRun | null; tools: DrillingTool[] }
  | { kind: 'casing'; title: string; casing: CasingString | null; tools: DrillingTool[] }
  | { kind: 'cementing'; title: string; job: CementingEvent | null; casing: CasingString | null; tools: DrillingTool[] }
  | { kind: 'wellcontrol'; title: string; tools: DrillingTool[] }
  | { kind: 'none'; title: string };

/** The equipment that belongs to the operation at the playhead. Nothing is filled in that the report does not give. */
export function toolsAt(eq: Equip, op: Operation | null, t: number): ToolView {
  const runOf = (id: string | null) => (id ? eq.runs.find(r => r.id === id) ?? null : null);
  const casingAt = () => (op?.casing_string_id ? eq.casings.find(c => c.id === op.casing_string_id) : null)
    ?? [...eq.casings].filter(c => ms(c.run_start) <= t).sort((a, b) => ms(b.run_start) - ms(a.run_start))[0] ?? null;
  const cat = op?.category;
  if (cat === 'Casing' && !/^(SHOE_DRILL|DO_CMT|DO_FLOAT)$/.test(op!.type_code)) {
    const cs = casingAt();
    return { kind: 'casing', title: 'Casing string', casing: cs, tools: eq.tools.filter(x => cs && x.casing_string_id === cs.id && x.category === 'Casing Equipment') };
  }
  if (cat === 'Cementing' && op!.type_code !== 'CBL') {
    const cs = casingAt();
    const job = (cs ? eq.cementing.find(j => j.casing_string_id === cs.id) : null) ?? eq.cementing.find(j => ms(j.start_at) <= t && t <= ms(j.end_at)) ?? null;
    return { kind: 'cementing', title: 'Cementing', job, casing: cs, tools: eq.tools.filter(x => x.category === 'Cementing Equipment' && cs && x.casing_string_id === cs.id) };
  }
  if (cat === 'Well Control' && /^BOP_|WELLHEAD|PRESS_TEST/.test(op!.type_code)) {
    // the latest installed item of each kind up to now
    const wc = eq.tools.filter(x => x.category === 'Well Control' && ms(x.installed_at) <= ms(op!.end_at));
    const latest = new Map<string, DrillingTool>(); for (const x of wc) latest.set(x.tool_type, x);
    return { kind: 'wellcontrol', title: 'Well control equipment', tools: [...latest.values()] };
  }
  const run = runOf(op?.bha_run_id ?? null) ?? bhaAt(eq.runs, t);
  if (run) return { kind: 'bha', title: `BHA run ${run.run_no}`, run, tools: eq.tools.filter(x => x.bha_run_id === run.id) };
  return { kind: 'none', title: 'No BHA in the hole according to the report' };
}

// ------------------------------------------------------------------ current-well problem alerts (red)
export interface CurrentAlert {
  problem: DrillingProblem; start: number; end: number; active: boolean;
  op: Operation | null; params: { label: string; value: number | null; unit: string }[]; holeDepth: number | null;
}
const firstCell = (src: string | null | undefined) => (src ?? '').split(/;\s*/)[0].replace(/:([A-Z]+)\d+$/, '');
/**
 * Problems recorded in THIS well up to time t. A problem is "active" from the time it is recorded until the end of the
 * report entry it came from, or its NPT if longer (at least 1 h). Parameters are the drilling record at that moment.
 */
export function currentWellAlerts(problems: DrillingProblem[], ops: Operation[], recs: Rec[], wellId: string, t: number): CurrentAlert[] {
  const out: CurrentAlert[] = [];
  for (const p of problems) {
    if (p.well_id !== wellId || !p.occurred_at || p.status === 'dismissed') continue;
    const start = ms(p.occurred_at);
    if (!(start <= t)) continue;
    const src = firstCell(p.source_ref);
    const op = (src ? ops.find(o => o.source_ref === src) : null) ?? operationAt(ops, start);
    const end = Math.max(op ? ms(op.end_at) : start, start + Math.max(1, p.npt_hours || 0) * 3600000);
    let r: Rec | undefined; for (const x of recs) { if (x.t > start) break; r = x; }
    out.push({
      problem: p, start, end, active: t < end, op, holeDepth: r?.hole ?? null,
      params: r ? [
        { label: 'WOB', value: r.wob_klb, unit: 'klb' }, { label: 'RPM', value: r.rpm, unit: 'rpm' }, { label: 'Torque', value: r.torque_ftlb, unit: 'ft-lb' },
        { label: 'SPP', value: r.spp_psi, unit: 'psi' }, { label: 'Flow', value: r.flow_gpm, unit: 'gpm' }, { label: 'ROP', value: r.rop_fph, unit: 'ft/h' }, { label: 'Mud weight', value: r.mud_weight_ppg, unit: 'ppg' },
      ] : [],
    });
  }
  return out.sort((a, b) => b.start - a.start);
}

// ------------------------------------------------------------------ historical offset warnings (amber, never red)
/** Historical warnings are shown in yellow / orange only; red is reserved for actual problems of the current well. */
export const historicalTone = (level: AlertColor): 'yellow' | 'orange' | 'critical' => (level === 'red' ? 'critical' : level === 'orange' ? 'orange' : 'yellow');
/** Did the historical risk materialise in the current well? (same problem category recorded nearby, up to now) */
export function materialized(hist: DrillingProblem, current: CurrentAlert[], depthTolFt = 500): DrillingProblem | null {
  return current.find(c => c.problem.category_id === hist.category_id && (Math.abs((c.problem.md_top_ft ?? 0) - hist.md_top_ft) <= depthTolFt ||
    (!!c.problem.formation_name && !!hist.formation_name && c.problem.formation_name.toLowerCase() === hist.formation_name.toLowerCase())))?.problem ?? null;
}
