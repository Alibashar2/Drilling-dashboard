// Drilling time estimation from offset wells. Transparent statistics only (weighted averages and spread of
// comparable offset hole sections). `TimeEstimator` is the seam where a machine-learning model can be added.
import type { Rec, Well } from './types';
import { breakdown, groupBy, type Breakdown } from './kpi';

export interface PlannedSection { holeSize: number; top: number; bottom: number }
export interface OffsetSectionStat { wellId: string; wellName: string; wellType: string | null; holeSize: number; b: Breakdown }

/** Time and footage of every hole size drilled in an offset well. */
export function offsetSectionStats(well: Well, recs: Rec[]): OffsetSectionStat[] {
  const m = groupBy(recs.filter(r => (r.hole_size_in ?? well.hole_size_in) != null), r => (r.hole_size_in ?? well.hole_size_in)!);
  return [...m.entries()].map(([holeSize, rs]) => ({ wellId: well.id, wellName: well.name, wellType: well.well_type, holeSize, b: breakdown(rs) }))
    .filter(s => s.b.footage > 0 && s.b.drillHours > 0);
}

export interface EstimateInput {
  sections: PlannedSection[]; wellType: string | null; spudDate: string | null;
  offsets: OffsetSectionStat[]; weighting: 'equal' | 'similarity';
}
export interface Scenario { optimistic: number; likely: number; pessimistic: number }
export interface SectionEstimate {
  section: PlannedSection; footage: number; comparable: number;
  expectedRop: number | null;
  hours: { drilling: number; connection: number; circulation: number; tripping: number; other: number; npt: number } | null;
  total: Scenario | null;
  used: { wellName: string; holeSize: number; weight: number; rop: number; impliedHours: number }[];
}
export interface EstimateResult {
  estimator: string; sections: SectionEstimate[]; complete: boolean;
  totalHours: Scenario | null; totalDays: Scenario | null;
  completion: { optimistic: string; likely: string; pessimistic: string } | null;
  breakdown: SectionEstimate['hours'];
  expectedRop: number | null;
  confidence: 'High' | 'Medium' | 'Low' | 'Insufficient data';
  confidenceReasons: string[];
  wellsUsed: { wellName: string; sections: number; weightShare: number }[];
  assumptions: string[];
}
export interface TimeEstimator { id: string; name: string; estimate(input: EstimateInput): EstimateResult }

const HOLE_TOL_IN = 1.5;
const wmean = (xs: { v: number; w: number }[]) => { const w = xs.reduce((s, x) => s + x.w, 0); return w > 0 ? xs.reduce((s, x) => s + x.v * x.w, 0) / w : 0; };
function wquantile(xs: { v: number; w: number }[], q: number): number {
  const s = [...xs].sort((a, b) => a.v - b.v), tot = s.reduce((a, x) => a + x.w, 0);
  let acc = 0;
  for (const x of s) { acc += x.w; if (acc / tot >= q) return x.v; }
  return s[s.length - 1].v;
}
const addDays = (date: string, days: number) => new Date(new Date(date + 'T00:00:00Z').getTime() + days * 86400000).toISOString().slice(0, 10);

function estimate(input: EstimateInput): EstimateResult {
  const secs: SectionEstimate[] = input.sections.map(section => {
    const footage = Math.max(0, section.bottom - section.top);
    const cands = input.offsets.filter(o => Math.abs(o.holeSize - section.holeSize) <= HOLE_TOL_IN).map(o => {
      const b = o.b;
      let weight = 1;
      if (input.weighting === 'similarity') {
        const sizeW = Math.abs(o.holeSize - section.holeSize) <= 0.13 ? 1 : 0.5;
        const overlap = Math.max(0, Math.min(b.bottom, section.bottom) - Math.max(b.top, section.top));
        const depthW = Math.max(0.2, footage > 0 ? overlap / footage : 0);
        const typeW = input.wellType && o.wellType ? (input.wellType === o.wellType ? 1 : 0.7) : 0.85;
        weight = sizeW * depthW * typeW;
      }
      // this offset's own rates applied to the planned interval
      const rop = b.footage / b.drillHours;
      const per = (h: number) => (h / b.footage) * footage;                    // scales with footage
      const hours = {
        drilling: footage / rop,
        connection: per(b.connHours),
        circulation: per(b.circHours),
        tripping: b.bottom > 0 ? (b.tripHours / b.bottom) * section.bottom : 0, // scales with section bottom depth
        other: b.otherHours + b.reamHours,                                       // flat time (casing, cement, ...) per section
        npt: 0,
      };
      const productive = hours.drilling + hours.connection + hours.circulation + hours.tripping + hours.other;
      const offsetProductive = Math.max(b.totalHours - b.nptHours, 1e-6);
      hours.npt = productive * (b.nptHours / offsetProductive);                 // NPT as a fraction of productive time
      return { o, weight, rop, hours, implied: productive + hours.npt };
    });
    if (!cands.length || footage <= 0) return { section, footage, comparable: 0, expectedRop: null, hours: null, total: null, used: [] };
    const wm = (f: (c: (typeof cands)[number]) => number) => wmean(cands.map(c => ({ v: f(c), w: c.weight })));
    const hours = {
      drilling: wm(c => c.hours.drilling), connection: wm(c => c.hours.connection), circulation: wm(c => c.hours.circulation),
      tripping: wm(c => c.hours.tripping), other: wm(c => c.hours.other), npt: wm(c => c.hours.npt),
    };
    const likely = Object.values(hours).reduce((s, v) => s + v, 0);
    const imp = cands.map(c => ({ v: c.implied, w: c.weight }));
    // with fewer than 5 comparable sections the spread is the observed best / worst, otherwise P10 / P90
    const lo = cands.length >= 5 ? wquantile(imp, 0.1) : Math.min(...imp.map(x => x.v));
    const hi = cands.length >= 5 ? wquantile(imp, 0.9) : Math.max(...imp.map(x => x.v));
    return {
      section, footage, comparable: cands.length, expectedRop: footage / hours.drilling, hours,
      total: { optimistic: Math.min(lo, likely), likely, pessimistic: Math.max(hi, likely) },
      used: cands.map(c => ({ wellName: c.o.wellName, holeSize: c.o.holeSize, weight: c.weight, rop: c.rop, impliedHours: c.implied })),
    };
  });

  const ok = secs.filter(s => s.total);
  const complete = ok.length === secs.length && secs.length > 0;
  const tot = (k: keyof Scenario) => ok.reduce((s, x) => s + x.total![k], 0);
  const totalHours = ok.length ? { optimistic: tot('optimistic'), likely: tot('likely'), pessimistic: tot('pessimistic') } : null;
  const totalDays = totalHours && { optimistic: totalHours.optimistic / 24, likely: totalHours.likely / 24, pessimistic: totalHours.pessimistic / 24 };
  const bk = ok.length ? {
    drilling: ok.reduce((s, x) => s + x.hours!.drilling, 0), connection: ok.reduce((s, x) => s + x.hours!.connection, 0),
    circulation: ok.reduce((s, x) => s + x.hours!.circulation, 0), tripping: ok.reduce((s, x) => s + x.hours!.tripping, 0),
    other: ok.reduce((s, x) => s + x.hours!.other, 0), npt: ok.reduce((s, x) => s + x.hours!.npt, 0),
  } : null;
  const footage = ok.reduce((s, x) => s + x.footage, 0);

  const wells = new Map<string, { sections: number; w: number }>();
  for (const s of ok) for (const u of s.used) { const e = wells.get(u.wellName) ?? { sections: 0, w: 0 }; e.sections++; e.w += u.weight; wells.set(u.wellName, e); }
  const wTot = [...wells.values()].reduce((s, e) => s + e.w, 0) || 1;
  const nWells = wells.size;
  const minComparable = ok.length ? Math.min(...ok.map(s => s.comparable)) : 0;
  const spread = totalHours && totalHours.likely > 0 ? (totalHours.pessimistic - totalHours.optimistic) / totalHours.likely : 0;
  let confidence: EstimateResult['confidence'] = 'Insufficient data';
  const reasons: string[] = [];
  if (ok.length) {
    confidence = nWells >= 5 && minComparable >= 5 && spread < 0.35 ? 'High' : nWells >= 3 && minComparable >= 3 && spread < 0.6 ? 'Medium' : 'Low';
    reasons.push(`${nWells} offset well(s) contributed; the least-supported section has ${minComparable} comparable offset section(s).`);
    reasons.push(`Spread between optimistic and pessimistic is ${Math.round(spread * 100)}% of the most likely time.`);
    if (!complete) { confidence = 'Low'; reasons.push('At least one planned section has no comparable offset data and is excluded from the total.'); }
  } else reasons.push('No offset hole section within ±1.5 in of any planned hole size.');

  return {
    estimator: 'Offset statistics (weighted average)', sections: secs, complete, totalHours, totalDays,
    completion: totalDays && input.spudDate ? {
      optimistic: addDays(input.spudDate, totalDays.optimistic), likely: addDays(input.spudDate, totalDays.likely), pessimistic: addDays(input.spudDate, totalDays.pessimistic),
    } : null,
    breakdown: bk, expectedRop: bk && bk.drilling > 0 ? footage / bk.drilling : null,
    confidence, confidenceReasons: reasons,
    wellsUsed: [...wells.entries()].map(([wellName, e]) => ({ wellName, sections: e.sections, weightShare: e.w / wTot })).sort((a, b) => b.weightShare - a.weightShare),
    assumptions: [
      'Offset hole sections are comparable when their hole size is within ±1.5 in of the planned hole size.',
      'Expected on-bottom ROP = offset footage ÷ offset on-bottom drilling hours, averaged across comparable sections' + (input.weighting === 'similarity' ? ', weighted by hole-size match, depth-interval overlap and well type.' : ' with equal weights.'),
      'Connection and circulation time scale with planned footage; tripping time scales with the planned section bottom depth.',
      'Other operations (casing, cementing, logging, reaming) are taken as the average flat time per offset section.',
      'NPT is estimated as each offset section\'s NPT ÷ productive time, applied to the planned productive time.',
      'Optimistic / pessimistic = best / worst implied offset result per section (P10 / P90 when five or more comparable sections exist), summed over sections.',
      'Limitations: no allowance for geology, bit, BHA, mud or rig differences beyond what the offsets contain; results with few offsets are indicative only; this is not a prediction.',
    ],
  };
}

export const statisticalEstimator: TimeEstimator = { id: 'offset-stats', name: 'Offset statistics (weighted average)', estimate };
/** Registry for future estimators (e.g. a trained regression model served by an API). */
export const ESTIMATORS: TimeEstimator[] = [statisticalEstimator];
