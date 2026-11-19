// Historical problem matching: turns the problem register of previous wells into risk indicators
// for the well being drilled. Depth matching and formation matching are independent of each other.
import type { AlertColor, DrillingProblem, Well } from './types';

export interface SimilarityWeights {
  formation: number; depth: number; holeSize: number; wellType: number;
  activity: number; bha: number; mud: number; params: number;
}
export interface AlertConfig {
  earlyFt: number; mediumFt: number; criticalFt: number;
  /** matches below this similarity (%) are hidden */
  minSimilarity: number;
  includeSuspected: boolean;   // use "suspected" problems as well as engineer-confirmed ones
  includeAnomalies: boolean;   // use rule-detected anomalies (off by default)
  /** below this many other wells with drilling history the assessment is flagged as limited */
  minHistoricalWells: number;
  depthBasis: 'md' | 'tvd';
  weights: SimilarityWeights;
}
export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  earlyFt: 500, mediumFt: 200, criticalFt: 50, minSimilarity: 0,
  includeSuspected: true, includeAnomalies: false, minHistoricalWells: 3, depthBasis: 'md',
  weights: { formation: 30, depth: 25, holeSize: 15, wellType: 5, activity: 5, bha: 5, mud: 5, params: 10 },
};

export interface CurrentContext {
  wellId: string;
  md: number;                       // current hole MD, ft
  tvd: number | null;
  formation: string | null;
  /** formations expected ahead of the bit (prognosis or known intervals) */
  upcoming: { name: string; topMd: number }[];
  holeSize: number | null; wellType: string | null; activity: string | null; bha: number | null;
  mudWeight: number | null;
  params: Record<string, number>;   // recent on-bottom averages
}
export interface HistProblem { problem: DrillingProblem; well: Well; categoryName: string }

export interface Component { key: keyof SimilarityWeights; label: string; score: number | null; weight: number; detail: string }
export type DepthLevel = 'critical' | 'medium' | 'early';
export interface Match extends HistProblem {
  depthLevel: DepthLevel | null;
  /** historical problem top minus current depth; positive = still ahead of the bit */
  distanceFt: number;
  depthBasis: 'md' | 'tvd';
  formationMatch: 'current' | 'upcoming' | null;
  similarity: number;               // 0-100
  components: Component[];
  reasons: string[];
  color: Exclude<AlertColor, 'green'>;
}
export interface MatchResult { matches: Match[]; panelColor: AlertColor; limited: boolean; historicalWells: number; consideredProblems: number }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const PARAM_KEYS = ['wob_klb', 'rpm', 'torque_ftlb', 'spp_psi', 'flow_gpm', 'diff_pressure_psi'];
const PARAM_LABEL: Record<string, string> = {
  rop_fph: 'ROP', wob_klb: 'WOB', rpm: 'RPM', torque_ftlb: 'Torque', spp_psi: 'SPP', flow_gpm: 'Flow rate',
  diff_pressure_psi: 'Differential pressure', mud_weight_ppg: 'Mud weight', hook_load_klb: 'Hook load',
};
export const paramLabel = (k: string) => PARAM_LABEL[k] ?? k;

export function eligible(p: DrillingProblem, cfg: AlertConfig): boolean {
  if (p.status === 'confirmed') return true;
  if (p.status === 'suspected') return cfg.includeSuspected;
  if (p.status === 'anomaly') return cfg.includeAnomalies;
  return false;
}

/**
 * @param canon maps a formation name to its canonical (equivalence-mapped) name
 * @param historicalWells number of OTHER wells that have drilling history, for the "limited data" flag
 */
export function matchProblems(
  ctx: CurrentContext, history: HistProblem[], cfg: AlertConfig,
  canon: (name: string | null | undefined) => string | null, historicalWells: number,
): MatchResult {
  const pool = history.filter(h => h.problem.well_id !== ctx.wellId && eligible(h.problem, cfg));
  const curForm = canon(ctx.formation);
  const matches: Match[] = [];

  for (const h of pool) {
    const p = h.problem;
    // ---- A. depth-based matching (MD by default; TVD only when both sides have it)
    const useTvd = cfg.depthBasis === 'tvd' && ctx.tvd != null && p.tvd_ft != null;
    const cur = useTvd ? ctx.tvd! : ctx.md;
    const top = useTvd ? p.tvd_ft! : p.md_top_ft;
    const bottom = useTvd ? p.tvd_ft! : Math.max(p.md_bottom_ft ?? p.md_top_ft, p.md_top_ft);
    const ahead = top - cur;
    const inside = cur >= top && cur <= bottom;
    const passed = cur > bottom + cfg.criticalFt;
    let depthLevel: DepthLevel | null = null;
    if (inside || (!passed && ahead <= cfg.criticalFt)) depthLevel = 'critical';
    else if (!passed && ahead <= cfg.mediumFt) depthLevel = 'medium';
    else if (!passed && ahead <= cfg.earlyFt) depthLevel = 'early';

    // ---- B. formation-based matching (independent of depth)
    const pForm = canon(p.formation_name);
    let formationMatch: Match['formationMatch'] = null;
    let upcomingTop: number | null = null;
    if (pForm) {
      if (curForm && curForm === pForm) formationMatch = 'current';
      else {
        const up = ctx.upcoming.find(u => canon(u.name) === pForm && u.topMd > ctx.md && u.topMd - ctx.md <= cfg.earlyFt);
        if (up) { formationMatch = 'upcoming'; upcomingTop = up.topMd; }
      }
    }
    if (!depthLevel && !formationMatch) continue;

    // ---- similarity score
    const w = cfg.weights;
    const comps: Component[] = [];
    comps.push({
      key: 'formation', label: 'Formation', weight: w.formation,
      score: pForm && (curForm || ctx.upcoming.length) ? (formationMatch ? 1 : 0) : null,
      detail: !pForm ? 'Historical formation not recorded' : formationMatch === 'current' ? `Same formation (${p.formation_name})`
        : formationMatch === 'upcoming' ? `${p.formation_name} is expected ${Math.round(upcomingTop! - ctx.md)} ft ahead`
        : curForm ? `Different formation (${ctx.formation} vs ${p.formation_name})` : 'Current formation not recorded',
    });
    const dist = inside ? 0 : Math.abs(ahead);
    comps.push({
      key: 'depth', label: `Depth proximity (${useTvd ? 'TVD' : 'MD'})`, weight: w.depth,
      score: clamp01(1 - dist / (2 * Math.max(cfg.earlyFt, 1))),
      detail: inside ? 'Currently inside the historical problem interval' : ahead >= 0 ? `${Math.round(ahead)} ft ahead of the bit` : `${Math.round(-ahead)} ft behind the bit`,
    });
    const hs = ctx.holeSize != null && p.hole_size_in != null ? Math.abs(ctx.holeSize - p.hole_size_in) : null;
    comps.push({
      key: 'holeSize', label: 'Hole size', weight: w.holeSize,
      score: hs == null ? null : hs <= 0.13 ? 1 : clamp01(1 - hs / 4),
      detail: hs == null ? 'Not available' : `${ctx.holeSize}" now vs ${p.hole_size_in}" then`,
    });
    comps.push({
      key: 'wellType', label: 'Well type', weight: w.wellType,
      score: ctx.wellType && h.well.well_type ? (ctx.wellType === h.well.well_type ? 1 : 0) : null,
      detail: ctx.wellType && h.well.well_type ? `${ctx.wellType} vs ${h.well.well_type}` : 'Not available',
    });
    comps.push({
      key: 'activity', label: 'Drilling activity', weight: w.activity,
      score: ctx.activity && p.activity_code ? (ctx.activity === p.activity_code ? 1 : 0) : null,
      detail: ctx.activity && p.activity_code ? `${ctx.activity} now vs ${p.activity_code} then` : 'Not available',
    });
    comps.push({
      key: 'bha', label: 'BHA run number (proxy for BHA configuration)', weight: w.bha,
      score: ctx.bha != null && p.bha_number != null ? (ctx.bha === p.bha_number ? 1 : 0) : null,
      detail: ctx.bha != null && p.bha_number != null ? `BHA #${ctx.bha} now vs BHA #${p.bha_number} then` : 'Not available',
    });
    const pMw = p.observed_params?.mud_weight_ppg;
    comps.push({
      key: 'mud', label: 'Mud weight', weight: w.mud,
      score: ctx.mudWeight != null && pMw != null ? clamp01(1 - Math.abs(ctx.mudWeight - pMw) / 2) : null,
      detail: ctx.mudWeight != null && pMw != null ? `${ctx.mudWeight.toFixed(1)} ppg now vs ${pMw.toFixed(1)} ppg then` : 'Not available',
    });
    const pp: number[] = [];
    for (const k of PARAM_KEYS) {
      const a = ctx.params[k], b = p.observed_params?.[k];
      if (a != null && b != null && Math.abs(b) > 1e-6) pp.push(clamp01(1 - Math.abs(a - b) / Math.abs(b) / 0.5));
    }
    comps.push({
      key: 'params', label: 'Drilling parameter pattern', weight: w.params,
      score: pp.length >= 2 ? pp.reduce((s, v) => s + v, 0) / pp.length : null,
      detail: pp.length >= 2 ? `${pp.length} parameters compared (within 50% counts as similar)` : 'Not enough observed parameters to compare',
    });
    // components without data are excluded and the remaining weights renormalised
    const used = comps.filter(c => c.score != null && c.weight > 0);
    const wsum = used.reduce((s, c) => s + c.weight, 0);
    const similarity = wsum > 0 ? Math.round((used.reduce((s, c) => s + c.weight * c.score!, 0) / wsum) * 100) : 0;
    if (similarity < cfg.minSimilarity) continue;

    const reasons: string[] = [];
    if (depthLevel) {
      reasons.push(inside
        ? `Current ${useTvd ? 'TVD' : 'MD'} is inside the interval where this problem occurred (${Math.round(top)}–${Math.round(bottom)} ft).`
        : ahead >= 0
          ? `The historical problem depth (${Math.round(top)} ft ${useTvd ? 'TVD' : 'MD'}) is ${Math.round(ahead)} ft ahead — inside the ${depthLevel} warning distance.`
          : `The historical problem depth (${Math.round(top)} ft ${useTvd ? 'TVD' : 'MD'}) was passed ${Math.round(-ahead)} ft ago — still inside the critical window.`);
    }
    if (formationMatch === 'current') reasons.push(`The well is currently in ${ctx.formation}, the formation where this problem occurred${p.formation_name !== ctx.formation ? ` (recorded there as ${p.formation_name})` : ''}.`);
    if (formationMatch === 'upcoming') reasons.push(`${p.formation_name} is expected about ${Math.round(upcomingTop! - ctx.md)} ft ahead of the bit.`);
    for (const c of used) if (c.key !== 'formation' && c.key !== 'depth' && c.score! >= 0.8) reasons.push(`${c.label}: ${c.detail}.`);

    matches.push({ ...h, depthLevel, distanceFt: ahead, depthBasis: useTvd ? 'tvd' : 'md', formationMatch, similarity, components: comps, reasons, color: 'yellow' });
  }

  // colour: red = critical proximity, orange = several similar (same category) problems, yellow = single nearby problem
  const byCat = new Map<string, number>();
  for (const m of matches) byCat.set(m.problem.category_id, (byCat.get(m.problem.category_id) ?? 0) + 1);
  for (const m of matches) m.color = m.depthLevel === 'critical' ? 'red' : (byCat.get(m.problem.category_id) ?? 0) >= 2 ? 'orange' : 'yellow';
  const rank = { red: 3, orange: 2, yellow: 1 } as const;
  matches.sort((a, b) => rank[b.color] - rank[a.color] || b.similarity - a.similarity);
  const panelColor: AlertColor = matches.length ? matches[0].color : 'green';
  return { matches, panelColor, limited: historicalWells < cfg.minHistoricalWells, historicalWells, consideredProblems: pool.length };
}

export const matchTypes = (m: Match): string[] => [
  ...(m.depthLevel ? [`depth:${m.depthLevel}`] : []),
  ...(m.formationMatch ? [`formation:${m.formationMatch}`] : []),
];
export const colorRank = (c: AlertColor) => ({ green: 0, yellow: 1, orange: 2, red: 3 })[c];
