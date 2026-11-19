// Rule-based anomaly detection. Output is ALWAYS a "detected anomaly" candidate: it is never stored as a
// confirmed problem. An engineer decides whether it becomes a suspected or confirmed event.
import type { Rec } from './types';
import { median, onBottom, paramSnapshot } from './kpi';

export interface AnomalyCandidate {
  rule: string;
  suggestedCategory: string;   // problem_categories.code - a suggestion only
  t0: number; t1: number; mdTop: number; mdBottom: number;
  evidence: string;
  idx: number;                 // index of first record
  observed: Record<string, number>;
}

interface Rule {
  name: string; category: string; minRun: number;
  /** returns evidence text when record i is anomalous against the trailing baseline */
  test(r: Rec, base: Record<string, number | null>): string | null;
}

const pct = (a: number, b: number) => `${Math.round((a / b - 1) * 100)}%`;
const RULES: Rule[] = [
  {
    name: 'Sustained low ROP', category: 'LOW_ROP', minRun: 6,
    test: (r, b) => (r.rop_fph != null && b.rop_fph && r.rop_fph > 0 && r.rop_fph < 0.4 * b.rop_fph
      ? `ROP ${r.rop_fph.toFixed(0)} ft/h vs trailing median ${b.rop_fph.toFixed(0)} ft/h (${pct(r.rop_fph, b.rop_fph)})` : null),
  },
  {
    name: 'High torque', category: 'TORQUE_DRAG', minRun: 3,
    test: (r, b) => (r.torque_ftlb != null && b.torque_ftlb && r.torque_ftlb > 1.3 * b.torque_ftlb
      ? `Torque ${r.torque_ftlb.toFixed(0)} ft-lb vs trailing median ${b.torque_ftlb.toFixed(0)} ft-lb (+${pct(r.torque_ftlb, b.torque_ftlb)})` : null),
  },
  {
    name: 'Standpipe pressure increase at steady flow', category: 'PACK_OFF', minRun: 3,
    test: (r, b) => (r.spp_psi != null && b.spp_psi && r.flow_gpm != null && b.flow_gpm && r.spp_psi > 1.15 * b.spp_psi && Math.abs(r.flow_gpm / b.flow_gpm - 1) < 0.08
      ? `SPP ${r.spp_psi.toFixed(0)} psi vs ${b.spp_psi.toFixed(0)} psi (+${pct(r.spp_psi, b.spp_psi)}) with flow unchanged` : null),
  },
  {
    name: 'Standpipe pressure drop at steady flow', category: 'OTHER', minRun: 3,
    test: (r, b) => (r.spp_psi != null && b.spp_psi && r.flow_gpm != null && b.flow_gpm && r.spp_psi < 0.8 * b.spp_psi && Math.abs(r.flow_gpm / b.flow_gpm - 1) < 0.08
      ? `SPP ${r.spp_psi.toFixed(0)} psi vs ${b.spp_psi.toFixed(0)} psi (${pct(r.spp_psi, b.spp_psi)}) with flow unchanged` : null),
  },
];

/**
 * Compare each on-bottom record against the median of the preceding `window` on-bottom records in the same
 * hole section. A rule fires only when it holds for `minRun` consecutive on-bottom records.
 */
export function detectAnomalies(recs: Rec[], window = 36): AnomalyCandidate[] {
  const out: AnomalyCandidate[] = [];
  const on = recs.map((r, i) => ({ r, i })).filter(x => onBottom(x.r));
  const keys = ['rop_fph', 'torque_ftlb', 'spp_psi', 'flow_gpm'] as const;
  for (const rule of RULES) {
    let run: { r: Rec; i: number; ev: string }[] = [];
    const flush = () => {
      if (run.length >= rule.minRun) {
        const a = run[0], z = run[run.length - 1];
        out.push({
          rule: rule.name, suggestedCategory: rule.category, t0: a.r.t, t1: z.r.t + z.r.dt * 3600000,
          mdTop: a.r.hole, mdBottom: z.r.hole, evidence: `${a.ev}; held for ${run.length} consecutive on-bottom records`,
          idx: a.i, observed: paramSnapshot(recs, z.i, run.length),
        });
      }
      run = [];
    };
    for (let k = 0; k < on.length; k++) {
      const { r, i } = on[k];
      // baseline excludes the current anomalous run so a long event does not normalise itself
      const end = k - run.length, start = Math.max(0, end - window);
      const hist = on.slice(start, end).filter(x => x.r.hole_size_in === r.hole_size_in).map(x => x.r);
      if (hist.length < 12) { flush(); continue; }
      const base: Record<string, number | null> = {};
      for (const key of keys) base[key] = median(hist.map(h => h[key]).filter((v): v is number => v != null && v > 0));
      const ev = rule.test(r, base);
      if (ev) run.push({ r, i, ev }); else flush();
    }
    flush();
  }
  return out.sort((a, b) => a.t0 - b.t0);
}
