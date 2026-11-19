import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { messyReportBuffer } from '../../demo/messyReport';
import { breakdown, prepareRecords } from '../../lib/kpi';
import { classify, normLabel } from './dictionary';
import { extractWorkbook, findDate, type SmartOptions } from './engine';
import { activityFromText, analyzeNarrative } from './narrative';
import { analyzeSheet } from './structure';
import { readSmart, toSmartWorkbook } from './workbook';

const OPTS: SmartOptions = { depthUnit: 'ft', dateOrder: 'auto', learned: {}, overrides: {}, acceptNpt: [], fallbackDate: null, knownFormations: [] };
const fromAoa = (sheets: Record<string, unknown[][]>) => { const wb = XLSX.utils.book_new(); for (const [n, a] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a), n); return toSmartWorkbook(wb, 't.xlsx'); };

describe('drilling dictionary', () => {
  it('recognises names, abbreviations and synonyms', () => {
    const k = (s: string) => classify(s)?.concept.key;
    expect(k('Measured Depth (ft)')).toBe('md'); expect(k('TVD')).toBe('tvd'); expect(k('Bit Depth')).toBe('bit_depth'); expect(k('Hole Depth')).toBe('hole_depth');
    expect(k('Depth In')).toBe('depth_in'); expect(k('Depth Out')).toBe('depth_out');
    expect(k('Avg ROP')).toBe('rop_avg'); expect(k('Inst. ROP')).toBe('rop_inst'); expect(k('Rate of Penetration')).toBe('rop'); expect(k('Footage Drilled')).toBe('footage');
    expect(k('Rotating Hrs')).toBe('rotating_hours'); expect(k('Non-Productive Time')).toBe('npt'); expect(k('Downtime')).toBe('npt'); expect(k('Tripping Time')).toBe('tripping_hours');
    expect(k('Weight on Bit')).toBe('wob'); expect(k('Stand Pipe Pressure')).toBe('spp'); expect(k('Diff. Pressure')).toBe('diff_pressure'); expect(k('M.Wt')).toBe('mud_weight');
    expect(k('ECD')).toBe('ecd'); expect(k('EGT')).toBe('egt'); expect(k('Lithology')).toBe('lithology'); expect(k('Casing Shoe')).toBe('casing_shoe');
    expect(k('Operations Summary')).toBe('description'); expect(k('Problems Encountered')).toBe('problem'); expect(k('Corrective Actions')).toBe('corrective');
    expect(classify('Pump Liner Wear Index')).toBeNull();
  });
  it('applies terms learned from the user', () => {
    expect(classify('Bottoms Reading', { [normLabel('Bottoms Reading')]: 'hole_depth' })?.concept.key).toBe('hole_depth');
  });
});

describe('narrative understanding', () => {
  it("extracts the reference sentence exactly as specified", () => {
    const f = analyzeNarrative('Drilled from 8,420 ft to 8,510 ft with an average ROP of 45 ft/hr. Experienced partial losses in Formation X and spent 4 hours treating the losses.');
    expect(f.intervals[0]).toMatchObject({ from: 8420, to: 8510, unit: 'ft', kind: 'drill' });
    expect(f.intervals[0].to - f.intervals[0].from).toBe(90);
    expect(f.rop).toMatchObject({ value: 45, unit: 'ft/h', kind: 'average' });
    expect(f.problems[0]).toMatchObject({ category: 'LOST_CIRC', label: 'Partial Lost Circulation', negated: false });
    expect(f.formation?.name).toBe('Formation X');
    expect(f.durations[0]).toMatchObject({ hours: 4, npt: 'problem-related' });   // not NPT unless the context confirms it
    expect(f.activity).toBe('ROT');
  });
  it('counts NPT only when the text says so, and flags candidates', () => {
    expect(analyzeNarrative('Pipe stuck at 8,790 ft. Worked pipe and jarred free. 3.5 hrs NPT.').durations[0].npt).toBe('explicit');
    expect(analyzeNarrative('Waited on weather for 6 hours.').durations[0].npt).toBe('candidate');
    expect(analyzeNarrative('Circulated for 2 hours prior to trip.').durations[0].npt).toBe('none');
  });
  it('handles negation, planned text, metric and shorthand', () => {
    expect(analyzeNarrative('Drilled ahead. No losses observed and no drag.').problems.every(p => p.negated)).toBe(true);
    expect(analyzeNarrative('Plan to drill ahead to 9,200 ft. Expect losses in Formation X.').planned).toBe(true);
    expect(analyzeNarrative("Drill f/ 8510' t/ 8790' w/ ROP 50.9 fph.").intervals[0]).toMatchObject({ from: 8510, to: 8790, unit: 'ft' });
    const m = analyzeNarrative('Drilled 2565 m to 2594 m at 8.5 m/hr.');
    expect(m.intervals[0]).toMatchObject({ from: 2565, to: 2594, unit: 'm' }); expect(m.rop).toMatchObject({ value: 8.5, unit: 'm/h' });
    expect(analyzeNarrative('POOH from 8,510 ft to 2,000 ft.').intervals[0].kind).toBe('trip');
    expect(activityFromText('POOH to surface, then drilled cement.')).toBe('TRP');
    expect(findDate('Daily Drilling Report - 13-Mar-2025', 'DMY')).toBe(Date.UTC(2025, 2, 13));
  });
});

describe('structure detection', () => {
  it('finds a table that does not start at the top, with metadata above it', () => {
    const wb = fromAoa({ S: [[], ['Well Name:', 'A-1', null, 'Report Date:', '2025-01-05'], [], [], [null, 'Date Time', 'Depth (ft)', 'ROP (ft/hr)', 'WOB'], [null, '2025-01-05 00:00', 100, 50, 20], [null, '2025-01-05 01:00', 150, 50, 22]] });
    const st = analyzeSheet(wb.sheets[0]);
    expect(st.tables).toHaveLength(1);
    expect(st.tables[0]).toMatchObject({ headerRow: 4, r0: 5, r1: 6 });
    expect(st.tables[0].cols.map(c => c.header)).toEqual(['Date Time', 'Depth (ft)', 'ROP (ft/hr)', 'WOB']);
    expect(st.kvs.map(k => k.label)).toEqual(['Well Name', 'Report Date']);
  });
  it('splits side-by-side tables and reads a horizontal table', () => {
    const wb = fromAoa({ S: [['Parameter', 'Min', 'Max', 'Avg', null, 'Property', 'Value', 'Unit'], ['WOB (klbs)', 20, 28, 25, null, 'Mud Weight', 9.8, 'ppg'], ['RPM', 80, 100, 90, null, 'ECD', 10.4, 'ppg'], ['Torque', 11000, 14500, 12800], ['SPP (psi)', 3300, 3500, 3400]] });
    const st = analyzeSheet(wb.sheets[0]);
    expect(st.ttables).toHaveLength(1); expect(st.ttables[0].rows.map(r => r.label)).toContain('SPP (psi)');
    expect(st.kvs.map(k => k.label)).toEqual(['Mud Weight', 'ECD']); expect(st.kvs[0].unit).toBe('ppg');
  });
});

describe('end to end on the messy multi-sheet report', () => {
  const { smart } = readSmart(messyReportBuffer(), 'messy.xlsx');
  const ex = extractWorkbook(smart, OPTS);
  const day = (d: string) => ex.days.find(x => x.date === d)!;

  it('inspects every worksheet, including the hidden one, and does not merge another well', () => {
    expect(ex.sheets).toHaveLength(7);
    const old = ex.sheets.find(s => s.name === 'old-KH02')!;
    expect(old.hidden).toBe(true); expect(old.excluded).toMatch(/different well/);
    expect(ex.days.map(d => d.date)).toEqual(['2025-03-12', '2025-03-13']);     // nothing from the 2024 KH-02 sheet
    expect(ex.sheets.find(s => s.name === 'DDR 13')!.hiddenRows).toBe(1);
  });
  it('classifies each table by what it contains', () => {
    const kinds = Object.fromEntries(ex.sheets.flatMap(s => s.tables.map(t => [`${s.name}:${t.kind}`, t])));
    expect(kinds['DDR 12:operations log']).toBeTruthy(); expect(kinds['DDR 13:operations log']).toBeTruthy();
    expect(kinds['Formation Tops:formations'].columns.map(c => c.concept)).toEqual(['Formation', 'Formation top', 'True vertical depth (TVD)', 'Formation bottom', 'Lithology']);   // two-level merged header
    expect(kinds['NPT Log:npt events']).toBeTruthy(); expect(kinds['Survey:survey']).toBeTruthy();
  });
  it('reads header metadata with units, fractions and text dates', () => {
    expect(ex.wellInfo.well_name.value).toBe('KH-07 (SAMPLE)'); expect(ex.wellInfo.target_depth.value).toBe(12400);
    const d1 = day('2025-03-12').fields, d2 = day('2025-03-13').fields;
    expect(d1.md).toMatchObject({ value: 8510, status: 'confirmed', src: 'DDR 12!B5' });
    expect(d1.hole_size.value).toBe(8.5);            // 8 1/2"
    expect(d1.mud_weight.value).toBe(9.8); expect(d1.ecd.value).toBe(10.4);
    expect(d1.wob.value).toBe(25); expect(d1.spp.value).toBe(3400);              // "Avg" column of the horizontal table
    expect(d1.hook_load.value).toBe(245); expect(d2.hook_load.value).toBe(251);  // joined from another sheet by date
    expect(d2.md.value).toBe(8790); expect(d2.rop_avg.value).toBe(50.9);         // date taken from the sheet title
  });
  it('turns operations text into intervals, ROP, rig state and formations', () => {
    const ops = day('2025-03-12').ops;
    expect(ops).toHaveLength(6);
    expect(ops[2]).toMatchObject({ activity: 'ROT', rop: 45, formation: 'Formation X', hours: 2, src: 'DDR 12!E12' });
    expect(ops[2].interval).toMatchObject({ from: 8420, to: 8510, status: 'confirmed' });
    expect(ops.map(o => o.activity)).toEqual(['ROT', 'CIR', 'ROT', 'OTH', 'WOO', 'TRP']);
    expect(day('2025-03-13').ops[1].interval).toMatchObject({ from: 8510, to: 8790 });   // "Drill f/ 8510' t/ 8790'" with a clock range in one cell
    expect(ex.formations.map(f => f.name)).toEqual(['Upper Shale', 'Formation W', 'Formation X', 'Formation Y']);
  });
  it('records problems as suspected, with source text and location, and never counts unverified time as NPT', () => {
    const loss = ex.problems.find(p => p.category === 'LOST_CIRC')!;
    expect(loss).toMatchObject({ label: 'Partial Lost Circulation', md: 8420, formation: 'Formation X', nptHours: 0, reportedHours: 4, status: 'suspected' });
    expect(loss.sourceText).toContain('spent 4 hours treating the losses'); expect(loss.src).toContain('DDR 12!E12');
    expect(loss.actions.join(' ')).toMatch(/LCM/);
    const stuck = ex.problems.filter(p => p.category === 'MECH_STICK');
    expect(stuck).toHaveLength(1);                                                // time log + NPT table merged, not duplicated
    expect(stuck[0].nptHours).toBe(3.5); expect(stuck[0].src).toMatch(/DDR 13!C10.*NPT Log/);
    expect(ex.negatedMentions).toBeGreaterThan(0);                                // "No losses observed", "No drag"
    expect(ex.problems.some(p => /9,200/.test(p.sourceText))).toBe(false);        // planned operations are not problems
  });
  it('does not double count NPT across the time log and the NPT table', () => {
    const recs = prepareRecords(ex.records.map(r => ({ ...r, well_id: 'w' })));
    expect(breakdown(recs).nptHours).toBeCloseTo(14, 1);                          // 2.5 + 3.5 + 8
    expect(ex.nptCandidates).toHaveLength(0);                                     // both waits are classified by the report's NPT table
  });
  it('builds simulation-ready, traceable records', () => {
    expect(ex.recordMode).toBe('operations log'); expect(ex.records).toHaveLength(96);
    const recs = prepareRecords(ex.records.map(r => ({ ...r, well_id: 'w' })));
    const b = breakdown(recs);
    expect(recs[recs.length - 1].hole).toBe(8790);
    expect(b.totalHours).toBeCloseTo(48, 1); expect(b.drillHours).toBeCloseTo(13.5, 1);
    expect(b.footage).toBeCloseTo(8790 - recs[0].hole, 0);
    expect(ex.records.every(r => /^DDR 1[23]![A-Z]+\d+$/.test(r.source_ref ?? ''))).toBe(true);
    expect(ex.records.find(r => r.ts === '2025-03-12T07:00:00.000Z')).toMatchObject({ activity_code: 'ROT', rop_fph: 45, wob_klb: 25, formation_name: 'Formation X', mud_weight_ppg: 9.8, hole_size_in: 8.5, data_quality: 'interpolated' });
    expect(ex.records.filter(r => r.activity_code === 'TRP').every(r => r.bit_depth_ft == null && r.wob_klb == null)).toBe(true);   // nothing invented off bottom
    expect(ex.stations).toHaveLength(12);
  });
  it('reports confidence, status, missing parameters and what it could not classify', () => {
    const p = (k: string) => ex.params.find(x => x.key === k)!;
    expect(p('md')).toMatchObject({ status: 'confirmed' }); expect(p('md').confidence).toBeGreaterThan(0.9);
    expect(p('problem').status).toBe('suspected');
    expect(p('bit_depth').status).toBe('inferred');   // equal to the hole depth while drilling; never "confirmed" - the report does not give it
    expect(p('egt').status).toBe('missing');
    expect(ex.unresolved.map(u => u.header)).toEqual(['Pump Liner Wear Index']);
    // "Funnel Viscosity 48 sec/qt" beside the table is now read as a value (it used to be listed as unclassified)
    expect(ex.cellParams.some(h => h.key === 'funnel_vis' && h.value === 48) || ex.unclassified.some(u => /Funnel Viscosity/.test(u.text))).toBe(true);
    expect(extractWorkbook(smart, { ...OPTS, overrides: { 'pump liner wear index': 'ignore' } }).unresolved).toHaveLength(0);
  });
});

describe('other report shapes', () => {
  it('reads a time-based table wherever it is and keeps cell references', () => {
    const rows: unknown[][] = [['Well Name:', 'T-1'], [], ['Date Time', 'Hole Depth (m)', 'Bit Depth (m)', 'ROP (m/hr)', 'WOB (kN)', 'Rig Activity']];
    for (let i = 0; i < 30; i++) rows.push([`2025-01-05 ${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`, 1000 + i * 5, 1000 + i * 5, 10, 100, 'Drilling']);
    const ex = extractWorkbook(fromAoa({ Data: rows }), OPTS);
    expect(ex.recordMode).toBe('time series'); expect(ex.records).toHaveLength(30);
    expect(ex.records[0]).toMatchObject({ source_ref: 'Data!4', data_quality: 'reported', activity_code: 'ROT' });
    expect(ex.records[29].hole_depth_ft!).toBeCloseTo(1145 * 3.28084, 0);        // metres converted
    expect(ex.records[0].wob_klb!).toBeCloseTo(22.48, 1);
  });
  it('builds daily records from a one-row-per-day summary and infers nothing it was not given', () => {
    const ex = extractWorkbook(fromAoa({ Summary: [['Date', 'Depth (ft)', 'Footage', 'Drilling Hrs', 'NPT (hrs)', 'Avg ROP', 'Remarks'],
      ['2025-02-01', 5200, 200, 8, 0, 25, 'Drilled ahead without problems.'], ['2025-02-02', 5350, 150, 6, 4, 25, 'Lost 4 hrs NPT due to mud pump repair.']] }), OPTS);
    expect(ex.recordMode).toBe('daily summary');
    const b = breakdown(prepareRecords(ex.records.map(r => ({ ...r, well_id: 'w' }))));
    expect(b.footage).toBe(350); expect(b.drillHours).toBe(14); expect(b.nptHours).toBe(4);
    expect(ex.records.every(r => r.wob_klb == null && r.bit_depth_ft == null)).toBe(true);
  });
  it('asks for the date only when the report has none, then uses it', () => {
    const sheets = { Log: [['From', 'To', 'Operations'], ['00:00', '12:00', 'Drilled from 100 ft to 400 ft.'], ['12:00', '24:00', 'Circulated and POOH.']] };
    expect(extractWorkbook(fromAoa(sheets), OPTS).needsDate).toBe(true);
    const ex = extractWorkbook(fromAoa(sheets), { ...OPTS, fallbackDate: '2025-05-01' });
    expect(ex.needsDate).toBe(false); expect(ex.records[0].ts.slice(0, 10)).toBe('2025-05-01'); expect(ex.records.at(-1)!.hole_depth_ft).toBe(400);
  });
  it('lets the engineer accept an unclassified wait as NPT', () => {
    const sheets = { 'DDR 2025-06-01': [['From', 'To', 'Operations'], ['00:00', '06:00', 'Drilled from 100 ft to 400 ft.'], ['06:00', '10:00', 'Waiting on cement crew.'], ['10:00', '24:00', 'Drilled from 400 ft to 900 ft.']] };
    const a = extractWorkbook(fromAoa(sheets), OPTS);
    expect(a.nptCandidates).toHaveLength(1); expect(a.records.reduce((s, r) => s + (r.npt_hours ?? 0), 0)).toBe(0);
    const b = extractWorkbook(fromAoa(sheets), { ...OPTS, acceptNpt: [a.nptCandidates[0].id] });
    expect(b.records.reduce((s, r) => s + (r.npt_hours ?? 0), 0)).toBeCloseTo(4, 5);
  });
});
