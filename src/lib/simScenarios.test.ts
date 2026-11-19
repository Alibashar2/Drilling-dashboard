// The five simulation scenarios, on a synthetic daily report written for this test (no user file needed):
// it runs the real report reader, converts its output the way the database stores it, and checks what the
// simulation shows at chosen times.
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { extractWorkbook, type Extraction } from '../import/smart/engine';
import { toSmartWorkbook } from '../import/smart/workbook';
import { prepareRecords } from './kpi';
import { DEFAULT_ALERT_CONFIG, matchProblems } from './matching';
import { OP_TYPE } from './operations';
import { currentWellAlerts, historicalTone, materialized, operationAt, sectionAt, toolsAt, type Equip } from './simContext';
import type { BhaRun, CasingString, CementingEvent, DrillingProblem, DrillingTool, HoleSection, Operation, Well } from './types';

const H = ['Start', 'End', 'Hrs', 'Depth From (ft)', 'Depth To (ft)', 'Task', 'P/NPT', 'NPT Category', 'Hole Size', 'Remarks'];
const rows: unknown[][] = [
  ['2025-05-01 06:00', '2025-05-01 09:00', 3, 5000, 5000, 'Make up BHA', 'P', '', 12.25, 'M/U & RIH 12-1/4" motor BHA.\n- 12-1/4" PDC Bit (Type: XYZ616, S/N: B123, Nozzles: 6x13)\n- 8" Motor w/ 12" sleeve stab (S/N: M771) 1.5 BH\n- 8" NMDC\n- MWD tool\n- 6-1/2" Jar (SN: J55)\n- 5" HWDP (3 stands)'],
  ['2025-05-01 09:00', '2025-05-01 21:00', 12, 5000, 5400, 'Drill to depth', 'P', '', 12.25, 'Rotary drilled 12-1/4" hole from 5000 ft to 5400 ft.\n- WOB: 25 klb, RPM: 120, TQ: 12 kft-lb, FR: 650 gpm, SPP: 2800 psi, Avg ROP: 33 ft/hr\n- Formation: Formation X'],
  ['2025-05-01 21:00', '2025-05-02 01:00', 4, 5400, 5400, 'Trip out to depth', 'NPT', 'Stuck pipe', 12.25, 'POOH on 5" DP. Pipe got stuck at 5350 ft while pulling out. Worked pipe and jarred, pipe free after 4 hrs.'],
  ['2025-05-02 01:00', '2025-05-02 05:00', 4, 5400, 5400, 'Lay down BHA', 'P', '', 12.25, 'POOH to surface and L/D BHA.\n- L/D 12-1/4" PDC Bit (S/N: B123), Dull grade: 1-1-WT-A-X-I-NO-TD'],
  ['2025-05-02 05:00', '2025-05-02 17:00', 12, 5400, 5400, 'Run in casing to depth', 'P', '', 12.25, 'RIH 9-5/8" CSG (47#, L-80, BTC) from surface to 5395 ft.\n- Float Shoe and Float Collar made up.\n- Installed centralizers as per program.'],
  ['2025-05-02 17:00', '2025-05-02 21:00', 4, 5400, 5400, 'Perform single stage cement job', 'P', '', 12.25, 'Cemented 9-5/8" casing.\n- Pumped 50 bbl spacer.\n- Mixed and pumped 300 bbl of 15.8 ppg tail slurry.\n- Displaced with 400 bbl mud. Bumped plug to 1500 psi.'],
  ['2025-05-02 21:00', '2025-05-03 09:00', 12, 5400, 5400, 'Waiting on cement', 'P', '', 12.25, 'WOC.'],
  ['2025-05-03 09:00', '2025-05-03 12:00', 3, 5400, 5400, 'Make up BHA', 'P', '', 8.5, 'M/U 8-1/2" BHA.\n- 8-1/2" PDC Bit\n- Motor\n- Jar\n- MWD tool'],
  ['2025-05-03 12:00', '2025-05-03 22:00', 10, 5400, 5600, 'Drill to depth', 'P', '', 8.5, 'Drilled 8-1/2" hole from 5400 ft to 5600 ft.'],
];
const book = () => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...rows]), 'Ops'); return toSmartWorkbook(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' }), 't.xlsx'); };
const ex: Extraction = extractWorkbook(book(), { depthUnit: 'ft', dateOrder: 'auto', learned: {}, overrides: {}, acceptNpt: [], fallbackDate: null, knownFormations: [] });

// ---- the extraction as the database stores it (ids and relations), see repo.insertEquipment
const runs: BhaRun[] = ex.bhaRuns.map(b => ({ id: `run${b.runNo}`, well_id: 'W', run_no: b.runNo, bha_type: b.bhaType, hole_size_in: b.holeSize, bit_size_in: b.bitSize, bit_type: b.bitType, bit_model: b.bitModel, bit_serial: b.bitSerial,
  bit_condition: b.bitCondition, nozzles: b.nozzles, dull_grade: b.dullGrade, start_at: b.start, end_at: b.end, depth_in_ft: b.depthIn, depth_out_ft: b.depthOut, description: b.description, source_ref: b.src }));
const casings: CasingString[] = ex.casings.map(c => ({ id: `csg${c.od}`, well_id: 'W', kind: c.kind, od_in: c.od, weights: c.weights, grades: c.grades, connections: c.connections, top_md_ft: c.topMd, shoe_md_ft: c.shoeMd, shoe_basis: c.shoeBasis,
  float_collar_md_ft: c.floatCollarMd, landing_collar_md_ft: c.landingCollarMd, hole_size_in: c.holeSize, run_start: c.start, run_end: c.end, description: c.description, source_ref: c.src }));
const ops: Operation[] = ex.operations.map(o => ({ id: `op${o.seq}`, well_id: 'W', seq: o.seq, type_code: o.code, category: o.category, start_at: o.start, end_at: o.end, duration_h: o.hours, start_md_ft: o.startMd, end_md_ft: o.endMd,
  hole_size_in: o.holeSize, bha_run_id: o.bhaRun ? `run${o.bhaRun}` : null, casing_string_id: o.casingOd ? `csg${o.casingOd}` : null, description: o.description, text: o.text, task_raw: o.task, phase_raw: o.phase, steps: o.steps,
  status: 'completed', is_npt: o.isNpt, npt_category: o.nptCategory, basis: o.basis, confidence: o.confidence, source_ref: o.src, original_type_code: null, corrected_by: null, corrected_at: null }));
const tools: DrillingTool[] = ex.tools.map((x, i) => ({ id: `t${i}`, well_id: 'W', bha_run_id: x.bhaRun ? `run${x.bhaRun}` : null, casing_string_id: x.casingOd ? `csg${x.casingOd}` : null, category: x.category, tool_type: x.type, name: x.name,
  description: x.description, od_in: x.od, id_in: x.id, length_ft: x.lengthFt, quantity: x.quantity, quantity_unit: x.quantityUnit, serial_no: x.serial, manufacturer: x.manufacturer, specs: x.specs, run_no: x.bhaRun,
  hole_size_in: x.holeSize, installed_at: x.installedAt, retrieved_at: x.retrievedAt, source_ref: x.src, source_text: x.line, entered_by: 'import' }));
const cementing: CementingEvent[] = ex.cementJobs.map((j, i) => ({ id: `cj${i}`, well_id: 'W', casing_string_id: j.casingOd ? `csg${j.casingOd}` : null, casing_od_in: j.casingOd, kind: j.kind, stages: j.stages, start_at: j.start, end_at: j.end,
  steps: j.steps, fluids: j.fluids, displacement_bbl: j.displacementBbl, fcp_psi: j.fcpPsi, bump_psi: j.bumpPsi, plugs: j.plugs, losses_text: j.lossesText, woc_hours: j.wocHours, toc_md_ft: j.tocMd, description: j.description, source_ref: j.src }));
const sections: HoleSection[] = ex.holeSections.map(s => ({ id: `s${s.no}`, well_id: 'W', section_no: s.no, hole_size_in: s.holeSize, bit_sizes_in: s.bitSizes, bit_types: s.bitTypes, casing_od_in: s.casingOd, casing_kind: s.casingKind, shoe_md_ft: s.shoeMd,
  top_md_ft: s.topMd, bottom_md_ft: s.bottomMd, formations: s.formations, bha_runs: s.bhaRuns, tools_count: s.tools, drill_start: s.drillStart, drill_end: s.drillEnd, start_at: s.start, end_at: s.end, duration_h: s.hours, avg_rop_fph: s.avgRopFph, npt_hours: s.nptHours, source_ref: s.src }));
const eq: Equip = { operations: ops, runs, tools, casings, cementing, sections };
const T = (s: string) => Date.parse(s + ':00Z');
const recs = prepareRecords(ex.records.map(r => ({ ...r, well_id: 'W' })));
const problems: DrillingProblem[] = ex.problems.map((p, i) => ({ id: `p${i}`, problem_code: `P${i}`, well_id: 'W', occurred_at: p.ts, md_top_ft: p.md ?? 0, md_bottom_ft: p.mdBottom, tvd_ft: null, formation_id: null, formation_name: p.formation,
  hole_size_in: p.holeSize, bha_number: null, activity_code: null, category_id: p.category, description: p.description, observed_params: null, root_cause: null, npt_hours: p.nptHours, severity: p.severity, status: 'suspected',
  source: 'import', notes: null, lessons_learned: null, source_ref: p.src, source_text: p.sourceText }));

describe('Scenario 1 - drilling, casing running, cementing and WOC appear at the right time', () => {
  it.each([
    ['2025-05-01T07:00', 'MU_BHA', 'Tripping'], ['2025-05-01T15:00', 'DRL_ROT', 'Drilling'], ['2025-05-01T23:00', 'TRIP_OUT', 'Tripping'], ['2025-05-02T03:00', 'BO_BHA', 'Tripping'],
    ['2025-05-02T10:00', 'CSG_RUN', 'Casing'], ['2025-05-02T19:00', 'CMT_PUMP', 'Cementing'], ['2025-05-03T03:00', 'WOC', 'Cementing'], ['2025-05-03T16:00', 'DRL_AHEAD', 'Drilling'],
  ])('%s -> %s', (time, code, cat) => {
    const op = operationAt(ops, T(time))!;
    expect(op.type_code).toBe(code);
    expect(op.category).toBe(cat);
    expect(OP_TYPE[code].category).toBe(cat);
  });
  it('the cement job lists the steps the report states, without inventing their times', () => {
    expect(operationAt(ops, T('2025-05-02T19:00'))!.steps).toEqual(['Cement Mixing', 'Spacer Pumping', 'Tail Cement Pumping', 'Displacement', 'Bumping Plug']);
  });
  it('"Drilled ... hole" without rotary / slide is "Drilling Ahead", not an assumed rotary or slide', () => {
    expect(ops.find(o => o.start_at.startsWith('2025-05-03T12'))!.type_code).toBe('DRL_AHEAD');
  });
});

describe('Scenario 2 - a stuck-pipe event recorded in the well raises a RED current-well alert', () => {
  const stuck = problems.find(p => p.category_id === 'MECH_STICK')!;
  it('the report reader records the event with its NPT', () => {
    expect(stuck).toBeTruthy();
    expect(stuck.npt_hours).toBe(4);
  });
  it('active while it happens, earlier afterwards, absent before', () => {
    expect(currentWellAlerts(problems, ops, recs, 'W', T('2025-05-01T20:00')).some(a => a.problem.id === stuck.id)).toBe(false);
    const during = currentWellAlerts(problems, ops, recs, 'W', T('2025-05-01T23:00')).find(a => a.problem.id === stuck.id)!;
    expect(during.active).toBe(true);
    expect(during.op?.type_code).toBe('TRIP_OUT');
    expect(during.params.find(x => x.label === 'WOB')).toBeTruthy();
    expect(currentWellAlerts(problems, ops, recs, 'W', T('2025-05-02T10:00')).find(a => a.problem.id === stuck.id)!.active).toBe(false);
  });
  it('another well\'s problems never appear as current-well alerts', () => {
    expect(currentWellAlerts(problems, ops, recs, 'OTHER', T('2025-05-01T23:00'))).toHaveLength(0);
  });
});

describe('Scenario 3 - approaching another well\'s lost-circulation interval raises an ORANGE / YELLOW warning only', () => {
  const well = (id: string, name: string): Well => ({ id, well_code: id, name, field: null, location: null, well_type: 'Vertical', status: 'completed', spud_date: null, planned_completion_date: null, completion_date: null, target_depth_ft: null, hole_size_in: 8.5, source_depth_unit: 'ft', is_demo: false, notes: null });
  const lossA: DrillingProblem = { ...problems[0], id: 'hA', well_id: 'A', category_id: 'LOST_CIRC', md_top_ft: 8500, md_bottom_ft: 8520, formation_name: 'Formation X', occurred_at: '2024-01-01T00:00:00Z', npt_hours: 6, status: 'confirmed' };
  const ctx = { wellId: 'B', md: 8400, tvd: null, formation: 'Formation X', upcoming: [], holeSize: 8.5, wellType: 'Vertical', activity: 'ROT', bha: 1, mudWeight: null, params: {} };
  const res = matchProblems(ctx, [{ problem: lossA, well: well('A', 'Well A'), categoryName: 'Lost Circulation' }], DEFAULT_ALERT_CONFIG, n => n?.toLowerCase() ?? null, 3);
  it('the historical engine matches it and it is shown in amber, never red', () => {
    expect(res.matches).toHaveLength(1);
    for (const level of ['yellow', 'orange', 'red'] as const) expect(historicalTone(level)).not.toBe('red');
  });
  it('the two systems stay independent: a warning is not a current-well alert until the well records the problem', () => {
    expect(currentWellAlerts([lossA], ops, recs, 'B', T('2025-05-03T16:00'))).toHaveLength(0);
    const lossB: DrillingProblem = { ...lossA, id: 'cB', well_id: 'B', md_top_ft: 8510, occurred_at: '2025-05-03T15:00:00Z', status: 'suspected' };
    const cur = currentWellAlerts([lossA, lossB], ops, recs, 'B', T('2025-05-03T15:30'));
    expect(cur.map(a => a.problem.id)).toEqual(['cB']);
    expect(materialized(lossA, cur)?.id).toBe('cB');
  });
});

describe('Scenario 4 - BHA, tools, bit and hole section follow the date and depth', () => {
  it('12-1/4" section with BHA run 1 while drilling the first interval', () => {
    const t = T('2025-05-01T15:00'), v = toolsAt(eq, operationAt(ops, t), t);
    expect(v.kind).toBe('bha');
    if (v.kind !== 'bha') return;
    expect(v.run).toMatchObject({ run_no: 1, bit_size_in: 12.25, bit_serial: 'B123', bit_model: 'XYZ616' });
    expect(v.tools.find(x => x.tool_type === 'Motor')).toMatchObject({ od_in: 8, serial_no: 'M771' });
    expect(v.tools.find(x => x.tool_type === 'Motor')!.specs).toMatchObject({ bend_deg: 1.5, stabilizer_od_in: 12 });
    expect(sectionAt(sections, t, 5200)).toMatchObject({ section_no: 1, hole_size_in: 12.25, casing_od_in: 9.625 });
  });
  it('casing string while running casing, cement job while cementing', () => {
    const tc = T('2025-05-02T10:00'), vc = toolsAt(eq, operationAt(ops, tc), tc);
    expect(vc.kind).toBe('casing');
    if (vc.kind === 'casing') { expect(vc.casing).toMatchObject({ od_in: 9.625, grades: ['L80'], connections: ['BTC'] }); expect(vc.tools.map(x => x.tool_type)).toEqual(expect.arrayContaining(['Float Shoe', 'Float Collar', 'Centralizers'])); }
    const tm = T('2025-05-02T19:00'), vm = toolsAt(eq, operationAt(ops, tm), tm);
    expect(vm.kind).toBe('cementing');
    if (vm.kind === 'cementing') expect(vm.job).toMatchObject({ bump_psi: 1500 });
  });
  it('8-1/2" section with BHA run 2 after the casing', () => {
    const t = T('2025-05-03T16:00'), v = toolsAt(eq, operationAt(ops, t), t);
    expect(v.kind === 'bha' && v.run?.run_no).toBe(2);
    expect(v.kind === 'bha' && v.run?.bit_size_in).toBe(8.5);
    expect(sectionAt(sections, t, 5500)).toMatchObject({ section_no: 2, hole_size_in: 8.5 });
    expect(recs.find(r => r.t >= t)?.bha_number).toBe(2);
  });
});

describe('Scenario 5 - missing tool dimensions stay "Not available"', () => {
  const run2 = tools.filter(x => x.bha_run_id === 'run2');
  it('motor, jar and MWD of run 2 have no OD, ID, length or serial because the report gives none', () => {
    for (const type of ['Motor', 'Jar', 'MWD Tool']) expect(run2.find(x => x.tool_type === type)).toMatchObject({ od_in: null, id_in: null, length_ft: null, serial_no: null });
    expect(run2.find(x => x.tool_type === 'PDC Bit')!.od_in).toBe(8.5);   // written in the report
    expect(tools.every(x => x.id_in == null && x.length_ft == null)).toBe(true);   // never written in this report, never filled
  });
  it('the extraction says how many tools have no dimension', () => {
    expect(ex.issues.some(i => i.type === 'tool_dimension_missing')).toBe(true);
  });
});
