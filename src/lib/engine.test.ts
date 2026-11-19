import { describe, expect, it } from 'vitest';
import { detectAnomalies } from './anomaly';
import { statisticalEstimator, offsetSectionStats } from './estimate';
import { breakdown, dailyReports, deriveFormationIntervals, deriveSections, prepareRecords, runPerf } from './kpi';
import { DEFAULT_ALERT_CONFIG, matchProblems, type CurrentContext, type HistProblem } from './matching';
import { interpAtMd, minCurvature } from './survey';
import type { DrillingProblem, DrillingRecord, Well } from './types';
import { detectUnit, makeUnits, toCanonical } from './units';
import { generateDemoWells, sampleImportSheets } from '../demo/generate';
import { autoConfig, detectDateOrder, extractProblems, parseDate, parseNum, processDrillingSheet, processSurveySheet } from '../import/parse';

const well = (over: Partial<Well> = {}): Well => ({
  id: 'w1', well_code: 'W1', name: 'W1', field: null, location: null, well_type: 'Vertical', status: 'completed', spud_date: null, planned_completion_date: null,
  completion_date: null, target_depth_ft: 10000, hole_size_in: 8.5, source_depth_unit: 'ft', is_demo: false, notes: null, ...over,
});
const problem = (over: Partial<DrillingProblem> = {}): DrillingProblem => ({
  id: 'p1', problem_code: 'P1', well_id: 'wA', occurred_at: null, md_top_ft: 8500, md_bottom_ft: 8530, tvd_ft: null, formation_id: null, formation_name: 'Formation X',
  hole_size_in: 8.5, bha_number: 3, activity_code: 'ROT', category_id: 'c1', description: '', observed_params: null, root_cause: null, npt_hours: 12, severity: 'high',
  status: 'confirmed', source: 'manual', notes: null, lessons_learned: null, ...over,
});
const ctx = (over: Partial<CurrentContext> = {}): CurrentContext => ({
  wellId: 'wB', md: 7000, tvd: null, formation: 'Formation Q', upcoming: [], holeSize: 8.5, wellType: 'Vertical', activity: 'ROT', bha: 3, mudWeight: null, params: {}, ...over,
});
const hist = (p: DrillingProblem): HistProblem => ({ problem: p, well: well({ id: p.well_id, name: 'Well A' }), categoryName: 'Differential Sticking' });
const canon = (n: string | null | undefined) => (n ? n.toLowerCase() : null);
const run = (c: CurrentContext, ps: DrillingProblem[], cfg = DEFAULT_ALERT_CONFIG, cn = canon) => matchProblems(c, ps.map(hist), cfg, cn, 3);

describe('units', () => {
  it('converts metric to canonical units', () => {
    expect(toCanonical(1000, 'depth', 'm')).toBeCloseTo(3280.84, 1);
    expect(toCanonical(1.2, 'density', 'sg')).toBeCloseTo(10.01, 1);
    expect(toCanonical(100, 'force', 'kN')).toBeCloseTo(22.48, 1);
    expect(toCanonical(20000, 'pressure', 'kPa')).toBeCloseTo(2900.8, 0);
  });
  it('detects units from headers', () => {
    expect(detectUnit('Measured Depth (m)', 'depth')).toBe('m');
    expect(detectUnit('ROP [m/hr]', 'rop')).toBe('m/h');
    expect(detectUnit('Depth_ft', 'depth')).toBe('ft');
    expect(detectUnit('Mud Density (sg)', 'density')).toBe('sg');
    expect(detectUnit('Measured Depth', 'depth')).toBeNull();
  });
  it('round-trips display units', () => {
    const U = makeUnits('m');
    expect(U.toFt(U.d(8500)!)).toBeCloseTo(8500, 6);
  });
});

describe('survey', () => {
  it('vertical well: TVD equals MD', () => {
    const t = minCurvature([{ md: 0, inc: 0, azi: 0 }, { md: 5000, inc: 0, azi: 0 }]);
    expect(t[1].tvd).toBeCloseTo(5000); expect(t[1].hd).toBeCloseTo(0);
  });
  it('90 degree hold: TVD stays constant', () => {
    const t = minCurvature([{ md: 0, inc: 90, azi: 90 }, { md: 1000, inc: 90, azi: 90 }]);
    expect(t[1].tvd).toBeCloseTo(0); expect(t[1].east).toBeCloseTo(1000);
  });
  it('build section gives TVD below MD and interpolates', () => {
    const t = minCurvature([{ md: 0, inc: 0, azi: 0 }, { md: 1000, inc: 0, azi: 0 }, { md: 2000, inc: 30, azi: 0 }]);
    expect(t[2].tvd).toBeLessThan(2000); expect(t[2].tvd).toBeGreaterThan(1900);
    expect(interpAtMd(t, 1500)!.tvd).toBeGreaterThan(1450);
  });
});

describe('matching', () => {
  it('no alert far from depth and in a different formation', () => {
    const r = run(ctx({ md: 7000 }), [problem()]);
    expect(r.matches).toHaveLength(0); expect(r.panelColor).toBe('green');
  });
  it('early / medium / critical depth warnings before the historical depth', () => {
    expect(run(ctx({ md: 8050 }), [problem()]).matches[0].depthLevel).toBe('early');
    expect(run(ctx({ md: 8350 }), [problem()]).matches[0].depthLevel).toBe('medium');
    const c = run(ctx({ md: 8460 }), [problem()]);
    expect(c.matches[0].depthLevel).toBe('critical'); expect(c.panelColor).toBe('red');
  });
  it('is critical inside the interval and clears after passing it', () => {
    expect(run(ctx({ md: 8510 }), [problem()]).matches[0].depthLevel).toBe('critical');
    expect(run(ctx({ md: 8700 }), [problem()]).matches).toHaveLength(0);
  });
  it('respects configurable distances', () => {
    const cfg = { ...DEFAULT_ALERT_CONFIG, earlyFt: 1000 };
    expect(run(ctx({ md: 7600 }), [problem()], cfg).matches[0].depthLevel).toBe('early');
  });
  it('formation match fires independently of depth', () => {
    const r = run(ctx({ md: 3000, formation: 'Formation X' }), [problem()]);
    expect(r.matches).toHaveLength(1); expect(r.matches[0].formationMatch).toBe('current'); expect(r.matches[0].depthLevel).toBeNull();
    expect(r.panelColor).toBe('yellow');
  });
  it('formation match uses the equivalence mapping and prognosed tops', () => {
    const mapped = (n: string | null | undefined) => (n ? (n === 'Fm X (local name)' ? 'formation x' : n.toLowerCase()) : null);
    expect(run(ctx({ md: 3000, formation: 'Fm X (local name)' }), [problem()], DEFAULT_ALERT_CONFIG, mapped).matches[0].formationMatch).toBe('current');
    expect(run(ctx({ md: 3000, upcoming: [{ name: 'Formation X', topMd: 3300 }] }), [problem()]).matches[0].formationMatch).toBe('upcoming');
    expect(run(ctx({ md: 3000, upcoming: [{ name: 'Formation X', topMd: 5000 }] }), [problem()]).matches).toHaveLength(0);
  });
  it('several similar problems escalate to orange', () => {
    const r = run(ctx({ md: 8100 }), [problem(), problem({ id: 'p2', well_id: 'wC', md_top_ft: 8550, md_bottom_ft: 8560 })]);
    expect(r.matches).toHaveLength(2); expect(r.panelColor).toBe('orange');
  });
  it('ignores anomalies, dismissed problems and the well itself by default', () => {
    expect(run(ctx({ md: 8400 }), [problem({ status: 'anomaly' }), problem({ id: 'p2', status: 'dismissed' }), problem({ id: 'p3', well_id: 'wB' })]).matches).toHaveLength(0);
    expect(run(ctx({ md: 8400 }), [problem({ status: 'anomaly' })], { ...DEFAULT_ALERT_CONFIG, includeAnomalies: true }).matches).toHaveLength(1);
  });
  it('similarity is 0-100, higher for closer matches, and skips missing components', () => {
    const near = run(ctx({ md: 8480, formation: 'Formation X' }), [problem()]).matches[0];
    const far = run(ctx({ md: 8050, holeSize: 12.25 }), [problem()]).matches[0];
    expect(near.similarity).toBeGreaterThan(far.similarity); expect(near.similarity).toBeLessThanOrEqual(100); expect(far.similarity).toBeGreaterThanOrEqual(0);
    expect(near.components.find(c => c.key === 'mud')!.score).toBeNull();
    expect(near.reasons.length).toBeGreaterThan(0);
  });
  it('uses TVD only when both sides have it', () => {
    const cfg = { ...DEFAULT_ALERT_CONFIG, depthBasis: 'tvd' as const };
    expect(run(ctx({ md: 9000, tvd: 7900 }), [problem({ tvd_ft: 8000 })], cfg).matches[0].depthBasis).toBe('tvd');
    expect(run(ctx({ md: 8400, tvd: 7900 }), [problem()], cfg).matches[0].depthBasis).toBe('md');
  });
  it('flags a limited assessment with few historical wells', () => {
    expect(matchProblems(ctx(), [], DEFAULT_ALERT_CONFIG, canon, 1).limited).toBe(true);
  });
});

describe('sample data + KPI engine', () => {
  const demo = generateDemoWells();
  const a = demo[0], recs = prepareRecords(a.records.map(r => ({ ...r, well_id: 'a' })));
  it('generates deterministic, complete sample wells', () => {
    expect(demo).toHaveLength(4);
    expect(generateDemoWells()[0].records.length).toBe(a.records.length);
    expect(recs[recs.length - 1].hole).toBeCloseTo(12500, 0);
    expect(demo[3].well.status).toBe('active'); expect(demo[3].prognosis.length).toBeGreaterThan(0);
    expect(demo[2].survey).toHaveLength(0);
    expect(demo.every(d => d.well.is_demo)).toBe(true);
  });
  it('time breakdown is exclusive and sums to total time', () => {
    const b = breakdown(recs);
    expect(b.drillHours + b.connHours + b.circHours + b.tripHours + b.reamHours + b.otherHours + b.nptHours).toBeCloseTo(b.totalHours, 4);
    expect(b.footage).toBeCloseTo(12500 - recs[0].hole, 0);   // new hole made after the first record
    expect(b.nptHours).toBeCloseTo(20, 0);   // 12 h + 8 h scheduled problems
    expect(b.rop!).toBeGreaterThan(30); expect(b.rop!).toBeLessThan(200);
  });
  it('daily reports add up to the well totals', () => {
    const d = dailyReports({ id: 'a' }, recs);
    expect(d.reduce((s, x) => s + x.footage_ft, 0)).toBeCloseTo(12500 - recs[0].hole, 0); expect(d[d.length - 1].end_md_ft).toBeCloseTo(12500, 0);
    expect(d[0].day_number).toBe(1);
  });
  it('derives sections, formation intervals and BHA run performance', () => {
    const secs = deriveSections(recs, { hole_size_in: 8.5 });
    expect(secs.map(s => s.hole_size_in)).toEqual([17.5, 12.25, 8.5]);
    const iv = deriveFormationIntervals(recs);
    expect(iv[0].formation_name).toBe('Alpha Shale'); expect(iv.length).toBe(7);
    const rp = runPerf(recs.filter(r => r.bha_number === 3))!;
    expect(rp.depthIn).toBeCloseTo(7200, 0); expect(rp.depthOut).toBeCloseTo(12500, 0); expect(rp.wob.avg).toBeGreaterThan(0);
  });
  it('anomaly rules find candidates near the scheduled problems but never confirm them', () => {
    const c = detectAnomalies(recs);
    expect(c.some(x => Math.abs(x.mdTop - 8500) < 150)).toBe(true);
  });
  it('estimates drilling time from offsets with ordered scenarios', () => {
    const offsets = demo.slice(0, 3).flatMap((d, i) => offsetSectionStats(well({ id: `o${i}`, name: d.well.name, well_type: d.well.well_type }), prepareRecords(d.records.map(r => ({ ...r, well_id: `o${i}` })))));
    const res = statisticalEstimator.estimate({ sections: [{ holeSize: 17.5, top: 0, bottom: 2600 }, { holeSize: 12.25, top: 2600, bottom: 7300 }, { holeSize: 8.5, top: 7300, bottom: 12800 }], wellType: 'Directional (J-type)', spudDate: '2026-01-01', offsets, weighting: 'similarity' });
    expect(res.complete).toBe(true);
    expect(res.totalDays!.optimistic).toBeLessThanOrEqual(res.totalDays!.likely);
    expect(res.totalDays!.likely).toBeLessThanOrEqual(res.totalDays!.pessimistic);
    expect(res.totalDays!.likely).toBeGreaterThan(8); expect(res.totalDays!.likely).toBeLessThan(25);
    expect(res.wellsUsed).toHaveLength(3); expect(res.completion!.likely > '2026-01-01').toBe(true);
    const none = statisticalEstimator.estimate({ sections: [{ holeSize: 26, top: 0, bottom: 500 }], wellType: null, spudDate: null, offsets, weighting: 'equal' });
    expect(none.totalDays).toBeNull(); expect(none.confidence).toBe('Insufficient data');
  });
});

describe('import pipeline', () => {
  it('parses numbers and dates', () => {
    expect(parseNum('1,234.5')).toBe(1234.5); expect(parseNum('12,5')).toBe(12.5); expect(parseNum('N/A')).toBeNull(); expect(parseNum('abc')).toBeNaN();
    expect(parseDate('2025-02-03 06:05', 'MDY')).toBe(Date.UTC(2025, 1, 3, 6, 5));
    expect(parseDate('03/02/2025 06:05', 'DMY')).toBe(Date.UTC(2025, 1, 3, 6, 5));
    expect(parseDate('02/03/2025 6:05 PM', 'MDY')).toBe(Date.UTC(2025, 1, 3, 18, 5));
    expect(parseDate(45691.25, 'MDY')).toBe(Date.UTC(2025, 1, 3, 6, 0));
    expect(parseDate('31/31/2025', 'DMY')).toBeNaN();
    expect(detectDateOrder(['13/02/2025', '01/02/2025']).order).toBe('DMY');
    expect(detectDateOrder(['01/02/2025']).ambiguous).toBe(true);
  });
  it('maps, converts and validates the metric sample workbook', () => {
    const { drilling, survey } = sampleImportSheets();
    const sheet = { name: 'Drilling Data', rows: drilling as unknown[][] };
    const cfg = autoConfig(sheet);
    expect(cfg.role).toBe('drilling');
    expect(cfg.mapping.ts).toBe(0); expect(cfg.mapping.md_ft).toBe(1); expect(cfg.mapping.bit_depth_ft).toBe(3); expect(cfg.mapping.hole_depth_ft).toBe(4);
    expect(cfg.units.md_ft).toBe('m'); expect(cfg.units.wob_klb).toBe('kN'); expect(cfg.units.mud_weight_ppg).toBe('sg'); expect(cfg.units.torque_ftlb).toBe('kN-m');
    const res = processDrillingSheet(sheet, cfg, { dateOrder: 'auto', dropDuplicates: true, declaredDepthUnit: 'm' });
    expect(res.stats.duplicates).toBe(1);
    expect(res.issues.some(i => i.type === 'bad_date' && i.severity === 'error')).toBe(true);
    expect(res.issues.some(i => i.type === 'bad_number')).toBe(true);
    expect(res.badCells.length).toBe(2);
    expect(res.stats.imported).toBe(res.stats.rows - 2);
    const last = res.records[res.records.length - 1];
    expect(last.hole_depth_ft!).toBeCloseTo(9000, 0);                       // metres converted back to feet
    expect(res.records.find(r => r.mud_weight_ppg != null)!.mud_weight_ppg!).toBeGreaterThan(8);
    expect(res.records.some(r => r.activity_code === 'SLD')).toBe(true);
    const probs = extractProblems(res.records);
    expect(probs).toHaveLength(1); expect(probs[0].categoryCode).toBe('DIFF_STICK');
    const sv = autoConfig({ name: 'Survey', rows: survey as unknown[][] });
    expect(sv.role).toBe('survey');
    expect(processSurveySheet({ name: 'Survey', rows: survey as unknown[][] }, sv).stations.length).toBe(survey.length - 1);
  });
  it('blocks import when required columns are not mapped and flags unit problems', () => {
    const rows = [['Foo', 'Bar'], [1, 2]];
    const res = processDrillingSheet({ name: 's', rows }, autoConfig({ name: 's', rows }), { dateOrder: 'auto', dropDuplicates: true });
    expect(res.issues.filter(i => i.type === 'missing_required')).toHaveLength(2);
    const r2: unknown[][] = [['Date Time', 'MD', 'Mud Weight'], ['2025-01-01 00:00', 100, 1.2], ['2025-01-01 01:00', 110, 1.2], ['2025-01-01 02:00', 120, 1.2], ['2025-01-01 03:00', 130, 1.2], ['2025-01-01 04:00', 900, 1.2]];
    const res2 = processDrillingSheet({ name: 's', rows: r2 }, autoConfig({ name: 's', rows: r2 }), { dateOrder: 'auto', dropDuplicates: true });
    expect(res2.issues.some(i => i.type === 'unit_inconsistent')).toBe(true);   // 1.2 "ppg" is really SG
    expect(res2.issues.some(i => i.type === 'depth_gap')).toBe(true);
  });
});

// keep the DrillingRecord import used for typing of fixtures
export type _T = DrillingRecord;
