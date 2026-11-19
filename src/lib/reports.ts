// Report documents: one neutral structure rendered on screen, to PDF and to Excel.
import type { Core } from './data';
import { counted } from './data';
import type { EstimateResult } from './estimate';
import { breakdown, groupBy, segments, sum, type WellSummary } from './kpi';
import { actName, STATUS_LABEL, type CorrectiveAction, type DailyReport, type DrillingProblem, type FormationInterval, type Rec, type Well, type WellSection } from './types';
import { fmt, fmtDateTime, fmtTime, type Units } from './units';

type Cell = string | number | null;
export interface ReportTable { heading: string; columns: string[]; rows: Cell[][]; note?: string }
export interface ReportChart { title: string; categories: string[]; series: { name: string; data: (number | null)[] }[]; unit?: string }
export interface ReportDoc { title: string; subtitle?: string; meta: [string, string][]; tables: ReportTable[]; notes?: string[]; chart?: ReportChart }

const r1 = (v: number | null | undefined, d = 1) => (v == null || !isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const stamp = () => `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const sampleNote = (wells: Well[]) => (wells.some(w => w.is_demo) ? ['Includes SAMPLE (synthetic) wells - not real drilling data.'] : []);

export function summaryRow(s: WellSummary, U: Units): Cell[] {
  return [s.well.name, s.well.well_code, s.well.field, s.well.well_type, s.well.status, r1(U.d(s.finalDepth), 0), r1(s.days), r1(U.r(s.avgRop)), r1(s.nptHours), s.problems];
}
export const summaryCols = (U: Units) => ['Well', 'Well ID', 'Field', 'Type', 'Status', `Final depth (${U.dl})`, 'Days', `Avg ROP (${U.rl})`, 'NPT (h)', 'Problems'];

export const problemCols = (U: Units) => ['Problem ID', 'Well', 'Date/time', `MD (${U.dl})`, `TVD (${U.dl})`, 'Formation', 'Hole (in)', 'BHA', 'Activity', 'Category', 'Classification', 'Severity', 'NPT (h)', 'Description', 'Root cause', 'Corrective actions', 'Lessons learned'];
export function problemRow(p: DrillingProblem, core: Core, actions: CorrectiveAction[], U: Units): Cell[] {
  return [p.problem_code, core.well.get(p.well_id)?.name ?? '', fmtDateTime(p.occurred_at), r1(U.d(p.md_top_ft), 0), r1(U.d(p.tvd_ft), 0), p.formation_name, p.hole_size_in, p.bha_number,
    p.activity_code ? actName(p.activity_code) : null, core.cat.get(p.category_id)?.name ?? '', STATUS_LABEL[p.status], p.severity, r1(p.npt_hours), p.description, p.root_cause,
    actions.filter(a => a.problem_id === p.id).map(a => a.action_text).join('; ') || null, p.lessons_learned];
}

export const dailyCols = (U: Units) => ['Day', 'Date', `From (${U.dl})`, `To (${U.dl})`, `Footage (${U.dl})`, `ROP (${U.rl})`, 'Drilling h', 'Connection h', 'Circulating h', 'Tripping h', 'Other h', 'NPT h', 'WOB klb', 'RPM', 'Torque ft-lb', 'SPP psi', 'Flow gpm', 'MW ppg', 'Formations'];
export const dailyRow = (d: DailyReport, U: Units): Cell[] => [d.day_number, String(d.report_date).slice(0, 10), r1(U.d(d.start_md_ft), 0), r1(U.d(d.end_md_ft), 0), r1(U.d(d.footage_ft), 0), r1(U.r(d.avg_rop_fph)),
  r1(d.drilling_hours), r1(d.connection_hours), r1(d.circulating_hours), r1(d.tripping_hours), r1(d.other_hours), r1(d.npt_hours), r1(d.avg_wob_klb), r1(d.avg_rpm, 0), r1(d.avg_torque_ftlb, 0), r1(d.avg_spp_psi, 0), r1(d.avg_flow_gpm, 0), r1(d.mud_weight_ppg), d.formations];

/** On-bottom performance grouped by an arbitrary key (formation, hole size...). */
export function perfBy(recs: Rec[], key: (r: Rec) => string | null) {
  return [...groupBy(recs.filter(r => key(r) != null), r => key(r)!).entries()].map(([k, rs]) => ({ key: k, b: breakdown(rs) })).filter(x => x.b.footage > 0);
}
const perfCols = (first: string, U: Units) => [first, `Top (${U.dl})`, `Bottom (${U.dl})`, `Footage (${U.dl})`, 'Drilling h', `ROP (${U.rl})`, 'NPT h', 'Total h'];
const perfRow = (k: string, b: ReturnType<typeof breakdown>, U: Units): Cell[] => [k, r1(U.d(b.top), 0), r1(U.d(b.bottom), 0), r1(U.d(b.footage), 0), r1(b.drillHours), r1(U.r(b.rop)), r1(b.nptHours), r1(b.totalHours)];

export function buildWellReport(a: { well: Well; summary: WellSummary; core: Core; recs: Rec[]; actions: CorrectiveAction[]; intervals: FormationInterval[]; sections: WellSection[]; U: Units }): ReportDoc {
  const { well, summary: s, core, recs, actions, intervals, sections, U } = a;
  const reports = core.reports.filter(r => r.well_id === well.id), problems = core.problems.filter(p => p.well_id === well.id);
  return {
    title: `Well Report - ${well.name}`, subtitle: `${well.well_code} · ${well.field ?? ''}`,
    meta: [['Well ID', well.well_code], ['Field', well.field ?? '-'], ['Location', well.location ?? '-'], ['Well type', well.well_type ?? '-'], ['Status', well.status],
      ['Spud date', String(well.spud_date ?? '-').slice(0, 10)], ['Completion date', String(well.completion_date ?? '-').slice(0, 10)], ['Target depth', U.fdu(well.target_depth_ft)],
      ['Final depth (MD)', U.fdu(s.finalDepth)], ['Total drilling days', fmt(s.days, 1)], ['Average on-bottom ROP', `${U.fr(s.avgRop)} ${U.rl}`], ['Total NPT', `${fmt(s.nptHours, 1)} h`], ['Recorded problems', String(s.problems)], ['Report', stamp()]],
    tables: [
      { heading: 'Daily drilling performance', columns: dailyCols(U), rows: reports.map(d => dailyRow(d, U)) },
      { heading: 'Hole sections', columns: ['Section', 'Hole size (in)', 'BHA', `Top (${U.dl})`, `Bottom (${U.dl})`], rows: sections.map(x => [x.name, x.hole_size_in, x.bha_number, r1(U.d(x.top_md_ft), 0), r1(U.d(x.bottom_md_ft), 0)]) },
      { heading: 'Performance by hole section', columns: perfCols('Hole size (in)', U), rows: perfBy(recs, r => (r.hole_size_in ?? well.hole_size_in)?.toString() ?? null).map(x => perfRow(x.key, x.b, U)) },
      { heading: 'Formation intervals', columns: ['Formation', `Top MD (${U.dl})`, `Bottom MD (${U.dl})`, `Top TVD (${U.dl})`, `Bottom TVD (${U.dl})`, 'Source'], rows: intervals.map(i => [i.formation_name, r1(U.d(i.top_md_ft), 0), r1(U.d(i.bottom_md_ft), 0), r1(U.d(i.top_tvd_ft), 0), r1(U.d(i.bottom_tvd_ft), 0), i.is_prognosis ? 'Prognosis' : 'Drilled']) },
      { heading: 'Performance by formation', columns: perfCols('Formation', U), rows: perfBy(recs, r => r.formation_name).map(x => perfRow(x.key, x.b, U)) },
      { heading: 'Drilling problems, NPT events and corrective actions', columns: problemCols(U), rows: problems.map(p => problemRow(p, core, actions, U)) },
      { heading: 'Lessons learned', columns: ['Category', `MD (${U.dl})`, 'Formation', 'Lesson'], rows: problems.filter(p => p.lessons_learned).map(p => [core.cat.get(p.category_id)?.name ?? '', r1(U.d(p.md_top_ft), 0), p.formation_name, p.lessons_learned]) },
    ],
    notes: sampleNote([well]),
    chart: { title: `Daily footage (${U.dl})`, categories: reports.map(d => `D${d.day_number}`), series: [{ name: 'Footage', data: reports.map(d => r1(U.d(d.footage_ft), 0)) }], unit: U.dl },
  };
}

export function buildDDR(well: Well, d: DailyReport, dayRecs: Rec[], core: Core, actions: CorrectiveAction[], U: Units): ReportDoc {
  const date = String(d.report_date).slice(0, 10);
  const probs = core.problems.filter(p => p.well_id === well.id && String(p.occurred_at ?? '').slice(0, 10) === date);
  const ah = Object.entries(d.activity_hours ?? {}).sort((a, b) => b[1] - a[1]);
  return {
    title: `Daily Drilling Report - ${well.name}`, subtitle: `${date} · Day ${d.day_number}`,
    meta: [['Well', `${well.name} (${well.well_code})`], ['Date', date], ['Day number', String(d.day_number)], ['Depth start (MD)', U.fdu(d.start_md_ft)], ['Depth end (MD)', U.fdu(d.end_md_ft)], ['Footage', U.fdu(d.footage_ft)],
      ['On-bottom ROP', `${U.fr(d.avg_rop_fph)} ${U.rl}`], ['Drilling hours', fmt(d.drilling_hours, 1)], ['NPT', `${fmt(d.npt_hours, 1)} h`], ['Mud weight', `${fmt(d.mud_weight_ppg, 1)} ppg`], ['Formations', d.formations ?? '-'], ['Summary', d.summary ?? '-'], ['Report', stamp()]],
    tables: [
      { heading: 'Time breakdown', columns: ['Activity', 'Hours', '% of day'], rows: ah.map(([c, h]) => [actName(c), r1(h, 2), r1((h / (d.total_hours || 1)) * 100)]) },
      { heading: 'Operations log', columns: ['From', 'To', 'Hours', 'Activity', `Depth from (${U.dl})`, `Depth to (${U.dl})`], rows: segments(dayRecs).map(s => [fmtTime(s.t0), fmtTime(s.t1), r1((s.t1 - s.t0) / 3600000, 2), actName(s.code), r1(U.d(s.md0), 0), r1(U.d(s.md1), 0)]) },
      { heading: 'Average on-bottom drilling parameters', columns: ['WOB klb', 'RPM', 'Torque ft-lb', 'SPP psi', 'Flow gpm', 'Diff. pressure psi'], rows: [[r1(d.avg_wob_klb), r1(d.avg_rpm, 0), r1(d.avg_torque_ftlb, 0), r1(d.avg_spp_psi, 0), r1(d.avg_flow_gpm, 0), r1(d.avg_diff_psi, 0)]] },
      { heading: 'Problems recorded on this day', columns: problemCols(U), rows: probs.map(p => problemRow(p, core, actions, U)) },
    ],
    notes: sampleNote([well]),
    chart: { title: 'Hours by activity', categories: ah.map(([c]) => actName(c)), series: [{ name: 'Hours', data: ah.map(([, h]) => r1(h, 2)) }], unit: 'h' },
  };
}

const pick = (core: Core, ids: string[]) => core.summaries.filter(s => ids.includes(s.well.id));

export function buildPerformance(core: Core, ids: string[], U: Units): ReportDoc {
  const ss = pick(core, ids);
  return {
    title: 'Well Performance Report', meta: [['Wells', ss.map(s => s.well.name).join(', ')], ['Report', stamp()]],
    tables: [{ heading: 'Well summary', columns: summaryCols(U), rows: ss.map(s => summaryRow(s, U)) },
      ...ss.map(s => ({ heading: `Daily performance - ${s.well.name}`, columns: dailyCols(U), rows: core.reports.filter(r => r.well_id === s.well.id).map(d => dailyRow(d, U)) }))],
    notes: sampleNote(ss.map(s => s.well)),
    chart: { title: `Average on-bottom ROP (${U.rl})`, categories: ss.map(s => s.well.name), series: [{ name: 'Avg ROP', data: ss.map(s => r1(U.r(s.avgRop))) }], unit: U.rl },
  };
}

export function buildNpt(core: Core, ids: string[], actions: CorrectiveAction[], U: Units): ReportDoc {
  const ss = pick(core, ids), probs = core.problems.filter(p => ids.includes(p.well_id) && counted(p) && p.npt_hours > 0);
  const byCat = [...groupBy(probs, p => core.cat.get(p.category_id)?.name ?? 'Other').entries()].map(([k, ps]) => [k, ps.length, r1(sum(ps.map(p => p.npt_hours)))] as Cell[]).sort((a, b) => (b[2] as number) - (a[2] as number));
  return {
    title: 'Non-Productive Time (NPT) Report', meta: [['Wells', ss.map(s => s.well.name).join(', ')], ['Total NPT (from drilling records)', `${fmt(sum(ss.map(s => s.nptHours)), 1)} h`], ['Report', stamp()]],
    tables: [
      { heading: 'NPT by well', columns: ['Well', 'Total hours', 'NPT h', 'NPT % of time', 'NPT linked to recorded problems (h)'], rows: ss.map(s => [s.well.name, r1(s.totalHours), r1(s.nptHours), r1(s.totalHours ? (s.nptHours / s.totalHours) * 100 : null), r1(sum(probs.filter(p => p.well_id === s.well.id).map(p => p.npt_hours)))]) },
      { heading: 'NPT by problem category', columns: ['Category', 'Events', 'NPT h'], rows: byCat },
      { heading: 'NPT events', columns: problemCols(U), rows: [...probs].sort((a, b) => b.npt_hours - a.npt_hours).map(p => problemRow(p, core, actions, U)) },
    ],
    notes: sampleNote(ss.map(s => s.well)),
    chart: { title: 'NPT by problem category (h)', categories: byCat.map(r => String(r[0])), series: [{ name: 'NPT h', data: byCat.map(r => r[2] as number) }], unit: 'h' },
  };
}

export function buildProblems(core: Core, ids: string[], actions: CorrectiveAction[], U: Units): ReportDoc {
  const probs = core.problems.filter(p => ids.includes(p.well_id) && p.status !== 'dismissed');
  const byCat = [...groupBy(probs.filter(counted), p => core.cat.get(p.category_id)?.name ?? 'Other').entries()].sort((a, b) => b[1].length - a[1].length);
  return {
    title: 'Drilling Problems Report', meta: [['Wells', pick(core, ids).map(s => s.well.name).join(', ')], ['Engineer-confirmed', String(probs.filter(p => p.status === 'confirmed').length)], ['Suspected', String(probs.filter(p => p.status === 'suspected').length)], ['Detected anomalies (unreviewed)', String(probs.filter(p => p.status === 'anomaly').length)], ['Report', stamp()]],
    tables: [{ heading: 'Problem register', columns: problemCols(U), rows: probs.map(p => problemRow(p, core, actions, U)) }],
    notes: ['Detected anomalies are rule-based observations and are not confirmed drilling problems.', ...sampleNote(pick(core, ids).map(s => s.well))],
    chart: { title: 'Confirmed and suspected problems by category', categories: byCat.map(c => c[0]), series: [{ name: 'Problems', data: byCat.map(c => c[1].length) }] },
  };
}

export function buildOffset(core: Core, ids: string[], recsByWell: Map<string, Rec[]>, U: Units): ReportDoc {
  const ss = pick(core, ids);
  const sec: Cell[][] = [];
  for (const s of ss) for (const x of perfBy(recsByWell.get(s.well.id) ?? [], r => (r.hole_size_in ?? s.well.hole_size_in)?.toString() ?? null)) sec.push([s.well.name, ...perfRow(x.key, x.b, U)]);
  return {
    title: 'Offset Well Analysis', meta: [['Wells compared', ss.map(s => s.well.name).join(', ')], ['Report', stamp()]],
    tables: [{ heading: 'Offset summary', columns: summaryCols(U), rows: ss.map(s => summaryRow(s, U)) }, { heading: 'Performance by hole section', columns: ['Well', ...perfCols('Hole size (in)', U)], rows: sec }],
    notes: sampleNote(ss.map(s => s.well)),
    chart: { title: 'Drilling days', categories: ss.map(s => s.well.name), series: [{ name: 'Days', data: ss.map(s => r1(s.days)) }], unit: 'days' },
  };
}

export function buildFormationRisk(core: Core, ids: string[], canon: (n: string | null | undefined) => string | null, U: Units): ReportDoc {
  const probs = core.problems.filter(p => ids.includes(p.well_id) && counted(p) && p.formation_name);
  const g = [...groupBy(probs, p => canon(p.formation_name)!).entries()].map(([, ps]) => ({
    name: ps[0].formation_name!, n: ps.length, wells: new Set(ps.map(p => p.well_id)).size, npt: sum(ps.map(p => p.npt_hours)),
    cats: [...new Set(ps.map(p => core.cat.get(p.category_id)?.name ?? ''))].join(', '), min: Math.min(...ps.map(p => p.md_top_ft)), max: Math.max(...ps.map(p => p.md_top_ft)),
  })).sort((a, b) => b.npt - a.npt);
  const wellsWithData = pick(core, ids).filter(s => s.finalDepth != null).length;
  return {
    title: 'Formation Risk Analysis', meta: [['Wells analysed', String(wellsWithData)], ['Problems with a recorded formation', String(probs.length)], ['Report', stamp()]],
    tables: [{ heading: 'Historical problems by formation (equivalent formation names merged)', columns: ['Formation', 'Problems', 'Wells affected', 'Total NPT (h)', 'Problem categories', `Shallowest MD (${U.dl})`, `Deepest MD (${U.dl})`], rows: g.map(x => [x.name, x.n, x.wells, r1(x.npt), x.cats, r1(U.d(x.min), 0), r1(U.d(x.max), 0)]) }],
    notes: [wellsWithData < 3 ? `Limited assessment: only ${wellsWithData} well(s) with data. A formation with no recorded problems is not necessarily low risk.` : 'Counts reflect recorded history only; a formation with no recorded problems is not necessarily low risk.', ...sampleNote(pick(core, ids).map(s => s.well))],
    chart: { title: 'NPT by formation (h)', categories: g.map(x => x.name), series: [{ name: 'NPT h', data: g.map(x => r1(x.npt)) }], unit: 'h' },
  };
}

export function buildRop(core: Core, ids: string[], recsByWell: Map<string, Rec[]>, U: Units): ReportDoc {
  const ss = pick(core, ids), form: Cell[][] = [], sec: Cell[][] = [];
  for (const s of ss) {
    const recs = recsByWell.get(s.well.id) ?? [];
    for (const x of perfBy(recs, r => r.formation_name)) form.push([s.well.name, ...perfRow(x.key, x.b, U)]);
    for (const x of perfBy(recs, r => (r.hole_size_in ?? s.well.hole_size_in)?.toString() ?? null)) sec.push([s.well.name, ...perfRow(x.key, x.b, U)]);
  }
  return {
    title: 'ROP Performance Analysis', meta: [['Wells', ss.map(s => s.well.name).join(', ')], ['ROP definition', 'new hole footage ÷ on-bottom drilling hours'], ['Report', stamp()]],
    tables: [{ heading: 'ROP by well', columns: ['Well', `Footage (${U.dl})`, 'Drilling h', `Avg ROP (${U.rl})`], rows: ss.map(s => [s.well.name, r1(U.d(s.footage), 0), r1(s.drillHours), r1(U.r(s.avgRop))]) },
      { heading: 'ROP by hole section', columns: ['Well', ...perfCols('Hole size (in)', U)], rows: sec }, { heading: 'ROP by formation', columns: ['Well', ...perfCols('Formation', U)], rows: form }],
    notes: sampleNote(ss.map(s => s.well)),
    chart: { title: `Average on-bottom ROP (${U.rl})`, categories: ss.map(s => s.well.name), series: [{ name: 'Avg ROP', data: ss.map(s => r1(U.r(s.avgRop))) }], unit: U.rl },
  };
}

export function buildEstimateReport(res: EstimateResult, label: string, spud: string | null, U: Units): ReportDoc {
  const ok = res.sections.filter(s => s.total);
  return {
    title: 'Drilling Time Estimation Report', subtitle: label,
    meta: [['Method', res.estimator], ['Spud date', spud ?? '-'], ['Most likely', res.totalDays ? `${fmt(res.totalDays.likely, 1)} days` : 'n/a'], ['Optimistic', res.totalDays ? `${fmt(res.totalDays.optimistic, 1)} days` : 'n/a'],
      ['Pessimistic', res.totalDays ? `${fmt(res.totalDays.pessimistic, 1)} days` : 'n/a'], ['Expected completion (most likely)', res.completion?.likely ?? 'n/a'], ['Expected on-bottom ROP', `${U.fr(res.expectedRop)} ${U.rl}`],
      ['Confidence', `${res.confidence} - ${res.confidenceReasons.join(' ')}`], ['Report', stamp()]],
    tables: [
      { heading: 'Estimate by hole section', columns: ['Hole size (in)', `From (${U.dl})`, `To (${U.dl})`, 'Comparable offsets', `Expected ROP (${U.rl})`, 'Drilling h', 'Connection h', 'Circulation h', 'Tripping h', 'Other h', 'NPT h', 'Optimistic h', 'Most likely h', 'Pessimistic h'],
        rows: res.sections.map(s => [s.section.holeSize, r1(U.d(s.section.top), 0), r1(U.d(s.section.bottom), 0), s.comparable, r1(U.r(s.expectedRop)), r1(s.hours?.drilling), r1(s.hours?.connection), r1(s.hours?.circulation), r1(s.hours?.tripping), r1(s.hours?.other), r1(s.hours?.npt), r1(s.total?.optimistic), r1(s.total?.likely), r1(s.total?.pessimistic)]) },
      { heading: 'Historical wells used', columns: ['Well', 'Sections used', 'Share of weight %'], rows: res.wellsUsed.map(w => [w.wellName, w.sections, r1(w.weightShare * 100)]) },
      { heading: 'Assumptions and limitations', columns: ['#', 'Statement'], rows: res.assumptions.map((a, i) => [i + 1, a]) },
    ],
    notes: res.complete ? [] : ['The total excludes planned sections that have no comparable offset data.'],
    chart: { title: 'Most likely hours by section', categories: ok.map(s => `${s.section.holeSize}"`), series: [{ name: 'Most likely h', data: ok.map(s => r1(s.total!.likely)) }], unit: 'h' },
  };
}

// ------------------------------------------------------------------ exporters
const fileName = (doc: ReportDoc) => `${doc.title}${doc.subtitle ? ' ' + doc.subtitle : ''}`.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80);
/** jsPDF's built-in fonts are Latin-1 only; reports are produced in English. */
const latin = (v: Cell) => (v == null ? '' : String(v).replace(/[–—]/g, '-').replace(/[≤]/g, '<=').replace(/[^\x00-\xff]/g, '?'));

export async function exportPdf(doc: ReportDoc, chartPng?: string | null) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  pdf.setFontSize(16); pdf.text(latin(doc.title), 40, 44);
  if (doc.subtitle) { pdf.setFontSize(11); pdf.setTextColor(90); pdf.text(latin(doc.subtitle), 40, 62); pdf.setTextColor(0); }
  autoTable(pdf, { startY: 76, theme: 'plain', styles: { fontSize: 9, cellPadding: 2 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 190 } }, body: doc.meta.map(([k, v]) => [latin(k), latin(v)]) });
  let y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;
  if (chartPng) {
    const h = 190;
    if (y + h > pdf.internal.pageSize.getHeight() - 40) { pdf.addPage(); y = 40; }
    pdf.setFontSize(11); pdf.text(latin(doc.chart?.title ?? ''), 40, y + 4);
    pdf.addImage(chartPng, 'PNG', 40, y + 10, Math.min(W - 80, 560), h);
    y += h + 26;
  }
  for (const tb of doc.tables) {
    if (y > pdf.internal.pageSize.getHeight() - 90) { pdf.addPage(); y = 40; }
    pdf.setFontSize(11); pdf.text(latin(tb.heading), 40, y + 4);
    autoTable(pdf, {
      startY: y + 10, head: [tb.columns.map(latin)], body: tb.rows.length ? tb.rows.map(r => r.map(latin)) : [[{ content: 'No data', colSpan: tb.columns.length }]],
      styles: { fontSize: tb.columns.length > 12 ? 6 : 8, cellPadding: 2.5, overflow: 'linebreak' }, headStyles: { fillColor: [14, 38, 60], textColor: 255 }, margin: { left: 40, right: 40 },
    });
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
  }
  if (doc.notes?.length) {
    if (y > pdf.internal.pageSize.getHeight() - 60) { pdf.addPage(); y = 40; }
    pdf.setFontSize(8); pdf.setTextColor(90);
    pdf.text(pdf.splitTextToSize(doc.notes.map(latin).join('  |  '), W - 80), 40, y);
  }
  pdf.save(`${fileName(doc)}.pdf`);
}

export async function exportExcel(doc: ReportDoc, extraSheets: { name: string; columns: string[]; rows: Cell[][] }[] = []) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const add = (name: string, aoa: Cell[][]) => {
    let n = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 28) || 'Sheet';
    for (let i = 2; used.has(n); i++) n = `${n.slice(0, 26)} ${i}`;
    used.add(n);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n);
  };
  add('Summary', [[doc.title], [doc.subtitle ?? ''], [], ...doc.meta, [], ...(doc.notes ?? []).map(n => [n])]);
  for (const tb of doc.tables) add(tb.heading, [tb.columns, ...tb.rows]);
  for (const s of extraSheets) add(s.name, [s.columns, ...s.rows]);
  XLSX.writeFile(wb, `${fileName(doc)}.xlsx`);
}
