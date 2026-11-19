// Shared page-level data loading.
import * as repo from '../db/repo';
import { summarize, type WellSummary } from './kpi';
import type { DailyReport, DrillingProblem, ProblemCategory, Well } from './types';
import { PALETTE } from '../components/EChart';

export interface Core {
  wells: Well[]; reports: DailyReport[]; problems: DrillingProblem[]; categories: ProblemCategory[];
  summaries: WellSummary[]; cat: Map<string, ProblemCategory>; well: Map<string, Well>; color: (wellId: string) => string;
}

export async function loadCore(): Promise<Core> {
  const [wells, reports, problems, categories] = await Promise.all([repo.listWells(), repo.listDailyReports(), repo.listProblems(), repo.listCategories()]);
  const order = new Map(wells.map((w, i) => [w.id, i]));
  return {
    wells, reports, problems, categories,
    summaries: wells.map(w => summarize(w, reports, problems)),
    cat: new Map(categories.map(c => [c.id, c])),
    well: new Map(wells.map(w => [w.id, w])),
    // colour follows the well (its position in the well list), not its rank; beyond the palette wells fold to grey
    color: id => PALETTE[order.get(id) ?? 99] ?? '#64748b',
  };
}

/** Problems that count as recorded drilling problems (not dismissed, not unreviewed anomalies). */
export const counted = (p: DrillingProblem) => p.status === 'confirmed' || p.status === 'suspected';
