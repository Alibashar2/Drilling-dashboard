// Well Comparison: selection modes, depth / time matching, before-and-after analysis, recorded events, historical problems,
// evidence-classified interpretation and missing data. Synthetic records with known values.
import { describe, expect, it } from 'vitest';
import { prepareRecords } from './kpi';
import {
  allChanges, analysisWindow, applySelection, buildWellSeries, clearSelection, contextAt, entries, explain, historicalAt, matchPoint, matchWell,
  mentions, navTargets, paramPoints, recordedEvents, resync, syncTargets, tolerance, type PointSel, type SelState, type WellEquip,
} from './pointAnalysis';
import type { BhaRun, CorrectiveAction, DrillingProblem, DrillingRecord, Operation, Well } from './types';

const T0 = Date.parse('2025-03-01T00:00:00Z');
const blank = (well_id: string): DrillingRecord => ({
  well_id, ts: '', md_ft: null, tvd_ft: null, bit_depth_ft: null, hole_depth_ft: null, rop_fph: null, wob_klb: null, rpm: null, torque_ftlb: null, spp_psi: null,
  diff_pressure_psi: null, flow_gpm: null, mud_weight_ppg: null, hook_load_klb: null, drilling_hours: null, circulating_hours: null, connection_time_min: null, npt_hours: null,
  activity_code: null, activity_raw: null, formation_name: null, bha_number: null, hole_size_in: null, problem_text: null, source_ref: null, data_quality: 'reported', extra: null,
});
const well = (id: string, name: string): Well => ({ id, well_code: id, name, field: null, location: null, well_type: null, status: 'completed', spud_date: null, planned_completion_date: null, completion_date: null, target_depth_ft: null, hole_size_in: 12.25, source_depth_unit: 'ft', is_demo: false, notes: null });

// Well A: a record every 10 ft (15 min) from 1010 to 2000 ft. Below 1500 ft ROP 35, WOB 12, RPM 120; deeper ROP 55, WOB 13.8, RPM 122.
// The formation changes at 1510 ft. A circulation (not drilling) entry sits between 1500 and 1510 ft.
function wellA() {
  const rows: DrillingRecord[] = [];
  let t = T0;
  for (let d = 1010; d <= 2000; d += 10) {
    const deep = d > 1500;
    rows.push({ ...blank('A'), ts: new Date(t).toISOString(), md_ft: d, hole_depth_ft: d, activity_code: 'ROT', source_ref: `Ops!Q${d}`,
      rop_fph: deep ? 55 : 35, wob_klb: deep ? 13.8 : 12, rpm: deep ? 122 : 120, torque_ftlb: deep ? 9000 : 8900, flow_gpm: 800, mud_weight_ppg: 10.2,
      formation_name: d >= 1510 ? 'Shuaiba' : 'Nahr Umr', bha_number: d >= 1510 ? 3 : 2, hole_size_in: 12.25 });
    t += 15 * 60000;
    if (d === 1500) { rows.push({ ...blank('A'), ts: new Date(t).toISOString(), md_ft: 1500, hole_depth_ft: 1500, activity_code: 'CIR', source_ref: 'Ops!Q1505', activity_raw: 'Circulated bottoms up' }); t += 60 * 60000; }
  }
  return prepareRecords(rows);
}
// Well B: sampled every 100 ft (2 h) from 1000 to 1800 ft; WOB missing at 1300 and 1500 ft.
function wellB() {
  const rows: DrillingRecord[] = [];
  for (let i = 0, d = 1000; d <= 1800; d += 100, i++) {
    rows.push({ ...blank('B'), ts: new Date(T0 + 86400000 + i * 2 * 3600000).toISOString(), md_ft: d, hole_depth_ft: d, activity_code: 'ROT', source_ref: `Data!${i + 2}`,
      rop_fph: 40 + i, wob_klb: d === 1300 || d === 1500 ? null : 15, rpm: 100, formation_name: 'Nahr Umr' });
  }
  return prepareRecords(rows);
}
const A = buildWellSeries(well('A', 'Well A'), '#0ea5c4', wellA(), 'depth');
const B = buildWellSeries(well('B', 'Well B'), '#d97706', wellB(), 'depth');
const sel = (origin: PointSel['origin'], key: number, seq = 1): PointSel => ({ key, wellId: 'A', origin, seq });

describe('Test 1 - All Parameters mode', () => {
  it('a point selected on ROP is selected at the same depth on every parameter chart', () => {
    const st = applySelection({}, sel('rop', 1510), 'all', []);
    for (const p of ['rop', 'wob', 'rpm', 'torque', 'diff', 'spp', 'flow', 'mw', 'hook'] as const) expect(st[p]?.key).toBe(1510);
    // the corresponding point of each chart is the record of that chart at that depth, not the same array index
    const wobA = matchPoint(paramPoints(A, 'wob'), 1510, tolerance(A), 'depth');
    expect(wobA.pt!.rec.hole).toBe(1510);
    expect(wobA.pt!.y).toBe(13.8);
  });
});

describe('Test 2 - Independent mode', () => {
  it('only the chart that was clicked changes', () => {
    const before: SelState = { wob: sel('wob', 1200) };
    const st = applySelection(before, sel('rop', 1510, 2), 'independent', []);
    expect(st.rop?.key).toBe(1510);
    expect(st.wob?.key).toBe(1200);
    expect(st.rpm).toBeUndefined();
    expect(syncTargets('rop', 'independent', [])).toEqual(['rop']);
    expect(clearSelection(st, 'rop', 'independent', []).wob?.key).toBe(1200);
  });
});

describe('Test 3 - Custom selection mode', () => {
  const custom = ['rop', 'wob', 'rpm'] as const;
  it('synchronises only ROP, WOB and RPM', () => {
    const st = applySelection({ torque: sel('torque', 1100) }, sel('rop', 1510, 2), 'custom', [...custom]);
    expect([st.rop?.key, st.wob?.key, st.rpm?.key]).toEqual([1510, 1510, 1510]);
    expect(st.torque?.key).toBe(1100);
    expect(st.diff).toBeUndefined();
  });
  it('a click on a chart outside the custom set stays on that chart', () => {
    const st = applySelection({}, sel('torque', 1300), 'custom', [...custom]);
    expect(Object.keys(st)).toEqual(['torque']);
  });
  it('changing the mode or the set updates the selection immediately', () => {
    const st: SelState = { rop: sel('rop', 1510, 5), torque: sel('torque', 1100, 3) };
    expect(resync(st, 'all', []).diff?.key).toBe(1510);
    const c = resync(st, 'custom', ['rop', 'flow']);
    expect(c.flow?.key).toBe(1510);
    expect(c.torque?.key).toBe(1100);
    expect(resync(st, 'independent', [])).toEqual(st);
  });
});

describe('Test 4 - point analysis for every compared well', () => {
  it('uses the nearest actual record of each well and states the real difference', () => {
    const a = matchWell(A, 1505, tolerance(A)), b = matchWell(B, 1505, tolerance(B));
    expect(a.rec!.hole === 1500 || a.rec!.hole === 1510).toBe(true);
    expect(Math.abs(a.diff!)).toBe(5);
    expect(a.status).toBe('nearest');
    expect(b.rec!.hole).toBe(1500);
    expect(b.diff).toBe(-5);
    expect(b.rec!.rop_fph).toBe(45);         // the record's own value, not an interpolation
    expect(matchWell(A, 1510, tolerance(A)).status).toBe('exact');
  });
  it('the operation, BHA run, bit and tools at the point come from the stored operations and runs', () => {
    const r = matchWell(A, 1600, tolerance(A)).rec!;
    const runs: BhaRun[] = [{ id: 'run3', well_id: 'A', run_no: 3, bha_type: 'motor', hole_size_in: 12.25, bit_size_in: 12.25, bit_type: 'PDC', bit_model: 'MM65', bit_serial: 'X1', bit_condition: 'new', nozzles: null, dull_grade: '2-3-WT-A-X-I-CT-TD', start_at: new Date(r.t - 3600000).toISOString(), end_at: null, depth_in_ft: 1510, depth_out_ft: 2000, description: null, source_ref: 'Ops!Q1510' }];
    const ops: Operation[] = [{ id: 'o1', well_id: 'A', seq: 1, type_code: 'DRL_ROT', category: 'Drilling', start_at: new Date(r.t - 60000).toISOString(), end_at: new Date(r.t + 600000).toISOString(), duration_h: 0.2, start_md_ft: 1590, end_md_ft: 1600, hole_size_in: 12.25, bha_run_id: 'run3', casing_string_id: null, description: null, text: null, task_raw: null, phase_raw: null, steps: [], status: 'completed', is_npt: false, npt_category: null, basis: 'task code', confidence: 0.92, source_ref: r.source_ref!, original_type_code: null, corrected_by: null, corrected_at: null }];
    const tools = [{ id: 't1', well_id: 'A', bha_run_id: 'run3', casing_string_id: null, category: 'BHA', tool_type: 'motor', name: 'Mud motor', description: null, od_in: 9.625, id_in: null, length_ft: null, quantity: 1, quantity_unit: null, serial_no: 'M1', manufacturer: null, specs: {}, run_no: 3, hole_size_in: 12.25, installed_at: null, retrieved_at: null, source_ref: null, source_text: null, entered_by: 'import' as const }];
    const c = contextAt(r, { operations: ops, runs, tools, sections: [] });
    expect(c.opName).toBe('Drilling Rotary');
    expect(c.run?.bit_type).toBe('PDC');
    expect(c.bhaNumber).toBe(3);
    expect(c.tools.map(x => x.name)).toEqual(['Mud motor']);
    // without an operations log the activity code is named, and nothing is invented
    const bare = contextAt(r, null);
    expect(bare.opName).toBe('Drilling Rotary');
    expect(bare.opSource).toBe('activity code');
    expect(bare.run).toBeNull();
  });
});

describe('Test 5 - engineering explanation', () => {
  const ents = entries(A.recs);
  const rec = A.recs.find(r => r.hole === 1510 && r.activity_code === 'ROT')!;
  it('compares previous, selected and next records and computes the change', () => {
    const w = analysisWindow(ents, rec, 'rec5')!;
    expect(w.before).toHaveLength(5);
    expect(w.before.every(e => e.onBottom)).toBe(true);        // the circulation entry is not a drilling record
    const ch = allChanges(w);
    expect(ch.rop).toMatchObject({ prev: 35, cur: 55, abs: 20, min: 35, max: 55 });
    expect(ch.rop.pct).toBeCloseTo(57.14, 1);
    expect(ch.wob.pct).toBeCloseTo(15, 5);
    expect(ch.rpm.pct).toBeCloseTo(1.67, 1);
    // time windows use the actual timestamps: the hour of circulation leaves no drilling entry in the previous 30 minutes,
    // and the previous hour reaches only the 1500 ft entry
    expect(analysisWindow(ents, rec, 'min30')!.before).toEqual([]);
    expect(analysisWindow(ents, rec, 'h1')!.before.map(e => e.md1)).toEqual([1500]);
  });
  it('examines surrounding records and recorded events before explaining, and classifies the evidence', () => {
    const w = analysisWindow(ents, rec, 'rec5')!;
    const circ = A.recs.find(r => r.activity_code === 'CIR')!;
    const eq: WellEquip = { operations: [{ id: 'c', well_id: 'A', seq: 2, type_code: 'CIRC', category: 'Other Operations', start_at: new Date(circ.t).toISOString(), end_at: new Date(circ.t + 3600000).toISOString(), duration_h: 1, start_md_ft: 1500, end_md_ft: 1500, hole_size_in: 12.25, bha_run_id: null, casing_string_id: null, description: null, text: 'Circulated bottoms up', task_raw: null, phase_raw: null, steps: [], status: 'completed', is_npt: false, npt_category: null, basis: 'task code', confidence: 0.9, source_ref: 'Ops!Q1505', original_type_code: null, corrected_by: null, corrected_at: null }], runs: [], tools: [], sections: [] };
    const evs = recordedEvents(w, { recs: A.recs, eq, problems: [], actions: new Map(), catName: () => 'x', proximityFt: 100 });
    expect(evs.map(e => e.kind)).toEqual(expect.arrayContaining(['formation', 'bha', 'operation']));
    const ex = explain('rop', allChanges(w), evs);
    expect(ex.direction).toBe('increase');
    expect(ex.summary).toContain('ROP increased by 57%');
    expect(ex.summary).toContain('WOB increased by 15%');
    expect(ex.summary).toContain('RPM remained relatively stable');
    expect(ex.summary).toContain('may have contributed');
    expect(ex.summary).toContain('does not explicitly confirm the cause');
    const cls = (c: string) => ex.findings.filter(f => f.cls === c).map(f => f.text).join(' | ');
    expect(cls('confirmed')).toContain('Formation changed from Nahr Umr to Shuaiba');
    expect(cls('confirmed')).toContain('does not state that this changed ROP');
    expect(cls('data')).toContain('WOB increased by 15%');
    expect(cls('possible')).toMatch(/softer or different formation/);
    // every finding carries evidence or is a stated limitation
    for (const f of ex.findings.filter(f => f.cls === 'confirmed')) expect(f.evidence.join(' ')).toMatch(/report/);
  });
  it('a cause written in the report is reported as confirmed', () => {
    expect(mentions('Drilled ahead with reduced WOB due to vibrations.').params).toEqual(['wob']);
    expect(mentions('Drilled ahead to 1500 m.').params).toEqual([]);
    const w = analysisWindow(ents, rec, 'rec1')!;
    const ex = explain('wob', allChanges(w), [{ kind: 'operation', t: rec.t, md: 1510, text: 'Drilling Rotary', src: 'Ops!Q1510', mentions: ['wob'], quote: 'Drilled ahead with increased WOB to improve ROP.', inWindow: true }]);
    expect(ex.findings[0]).toMatchObject({ cls: 'confirmed' });
    expect(ex.summary).toContain('explicitly mentions WOB');
  });
  it('says so when the data are insufficient', () => {
    const first = A.recs.find(r => r.activity_code === 'ROT')!;
    const ex = explain('rop', allChanges(analysisWindow(ents, first, 'rec1')!), []);
    expect(ex.direction).toBe('unknown');
    expect(ex.summary).toMatch(/^Insufficient data to determine the cause of this change/);
    // a change with no supporting parameter and no recorded event
    const w = analysisWindow(entries(B.recs), B.recs[3], 'rec1')!;
    const exB = explain('rop', allChanges(w), []);
    expect(exB.direction).toBe('stable');            // 42 -> 43 ft/h: +2.4 %, below the change threshold
  });
});

describe('Test 6 - historical problems', () => {
  const p = (id: string, well_id: string, md: number, extra: Partial<DrillingProblem> = {}): DrillingProblem => ({ id, problem_code: id, well_id, occurred_at: null, md_top_ft: md, md_bottom_ft: md, tvd_ft: null, formation_id: null, formation_name: null, hole_size_in: null, bha_number: null, activity_code: null, category_id: 'LC', description: `Problem ${id}`, observed_params: null, root_cause: null, npt_hours: 4, severity: 'high', status: 'confirmed', source: 'import', notes: null, lessons_learned: null, ...extra });
  it('shows the original well, the problem and its corrective actions; the selected well and dismissed problems are excluded', () => {
    const probs = [p('h1', 'B', 1520), p('h2', 'A', 1510), p('h3', 'B', 1530, { status: 'dismissed' }), p('h4', 'B', 3000, { formation_name: 'Shuaiba' }), p('h5', 'B', 3000)];
    const actions = new Map<string, CorrectiveAction[]>([['h1', [{ id: 'a', problem_id: 'h1', action_text: 'Pumped LCM pill', outcome: 'losses cured' }]]]);
    const wells = new Map([['B', well('B', 'Well B')]]);
    const h = historicalAt(probs, 'A', 1510, 'Shuaiba', n => n?.toLowerCase() ?? null, 100, wells, () => 'Lost Circulation', actions);
    expect(h.map(x => x.problem.id)).toEqual(['h1', 'h4']);
    expect(h[0]).toMatchObject({ depthDiff: 10, sameFormation: false, category: 'Lost Circulation' });
    expect(h[0].well?.name).toBe('Well B');
    expect(h[0].actions[0].action_text).toBe('Pumped LCM pill');
    expect(h[1].sameFormation).toBe(true);
  });
  it('problems of the selected well appear as its own recorded events, with corrective actions', () => {
    const rec = A.recs.find(r => r.hole === 1510 && r.activity_code === 'ROT')!;
    const w = analysisWindow(entries(A.recs), rec, 'rec1')!;
    const evs = recordedEvents(w, { recs: A.recs, eq: null, problems: [p('own', 'A', 1520, { description: 'Torque spikes and erratic torque while drilling' })], actions: new Map([['own', [{ id: 'b', problem_id: 'own', action_text: 'Reduced RPM', outcome: null }]]]), catName: () => 'Vibration', proximityFt: 50 });
    const own = evs.find(e => e.kind === 'problem')!;
    expect(own.text).toContain('Vibration');
    expect(own.actions![0].action_text).toBe('Reduced RPM');
    expect(own.mentions).toContain('torque');
    expect(own.inWindow).toBe(false);                 // no time recorded inside the window: context, not evidence
    expect(explain('torque', allChanges(w), evs).findings.some(f => f.text.includes('Vibration'))).toBe(false);
  });
});

describe('Test 7 - navigation sync', () => {
  const visible = ['rop', 'wob', 'rpm', 'torque'] as const;
  it('independent navigation unless synchronisation is on; then only the chosen, visible charts follow', () => {
    expect(navTargets('rop', false, ['rop', 'wob'], [...visible])).toEqual([]);
    expect(navTargets('rop', true, ['rop', 'wob', 'diff'], [...visible])).toEqual(['wob']);
    expect(navTargets('torque', true, ['rop', 'wob'], [...visible])).toEqual([]);
  });
});

describe('Test 8 - different sampling intervals and missing data', () => {
  it('each well has its own tolerance from its own sampling interval', () => {
    expect(A.spacing).toBe(10);
    expect(B.spacing).toBe(100);
    expect(tolerance(A)).toBe(30);
    expect(tolerance(B)).toBe(300);
    expect(tolerance(B, 50)).toBe(50);
  });
  it('missing measurements are skipped in a chart and reported as missing in the record', () => {
    const pts = paramPoints(B, 'wob');
    expect(pts.map(p => p.x)).not.toContain(1300);
    const m = matchPoint(pts, 1300, tolerance(B), 'depth');
    expect(m.pt!.x === 1200 || m.pt!.x === 1400).toBe(true);
    expect(matchWell(B, 1300, tolerance(B)).rec!.wob_klb).toBeNull();
  });
  it('a depth the well never reached is flagged, not filled in', () => {
    const m = matchWell(B, 1990, tolerance(B, 100));
    expect(m).toMatchObject({ status: 'far', outside: true });
    expect(m.rec!.hole).toBe(1800);
    const empty = buildWellSeries(well('C', 'Well C'), '#000', prepareRecords([{ ...blank('C'), ts: new Date(T0).toISOString(), md_ft: 100, activity_code: 'TRP' }]), 'depth');
    expect(matchWell(empty, 1500, tolerance(empty)).status).toBe('none');
  });
  it('time axis: wells are matched by elapsed time since their own first record', () => {
    const At = buildWellSeries(well('A', 'Well A'), '#0ea5c4', A.recs, 'time'), Bt = buildWellSeries(well('B', 'Well B'), '#d97706', B.recs, 'time');
    expect(At.keys[0]).toBe(0);
    expect(Bt.keys[0]).toBe(0);           // B starts a day later in calendar time
    const m = matchWell(Bt, 4.1, tolerance(Bt));
    expect(m.rec!.hole).toBe(1200);       // 2 h per record: 4 h after its first record
    expect(m.diff).toBeCloseTo(-0.1, 5);
  });
  it('a report entry split into several records is one entry; its depth is marked as spread', () => {
    const recs = prepareRecords([0, 1, 2].map(i => ({ ...blank('D'), ts: new Date(T0 + i * 3600000).toISOString(), md_ft: 100 + i * 10, activity_code: 'ROT', rop_fph: 10, source_ref: 'Ops!Q9', data_quality: 'interpolated' })));
    const e = entries(recs);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ src: 'Ops!Q9', interpolated: true, md1: 120 });
  });
});
