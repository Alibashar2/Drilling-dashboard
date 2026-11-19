// Generalisation tests that do not need the user's file: other column names, other layouts, values scattered
// in random cells, and engineer corrections flowing into the records.
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { extractWorkbook } from './engine';
import { toSmartWorkbook } from './workbook';

const OPTS = { depthUnit: 'ft' as const, dateOrder: 'auto' as const, learned: {}, overrides: {}, acceptNpt: [], fallbackDate: null, knownFormations: [] };
const book = (sheets: Record<string, unknown[][]>) => {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  return toSmartWorkbook(XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' }), 'test.xlsx');
};

describe('operations log with different headers and in-cell parameters', () => {
  // day-first dates (25/03/2025 can only be day-first), feet, different header words, NPT flagged "NPT"
  const wb = book({
    'Ops': [
      ['Well No', 'Date From', 'Date To', 'Hrs', 'Depth Start (ft)', 'Depth End (ft)', 'Sub Activity', 'P/NPT', 'NPT Cause', 'Remarks'],
      ['W-9', '24/03/2025 06:00', '24/03/2025 12:00', 6, 8000, 8240, 'Drilling ahead', 'P', '', 'Drilled 8-1/2" hole from 8000 ft to 8240 ft.\n- WOB = 25-30 klb, RPM 120, Torque: 12 kft-lbs\n- Flow Rate: 550 gpm; SPP: 3100 psi\n- Avg ROP 40 ft/hr, On-bottom ROP 55 ft/hr\n- Mud Wt: 10.4 ppg\n- Formation: Shuaiba'],
      ['W-9', '24/03/2025 12:00', '24/03/2025 15:00', 3, 8240, 8240, 'Wait on weather', 'NPT', 'Weather', 'Waiting on weather, high winds. No losses.'],
      ['W-9', '24/03/2025 15:00', '25/03/2025 01:00', 10, 8240, 8600, 'Drilling ahead', 'P', '', 'Drilled from 8240 ft to 8600 ft. WOB: 30 klb, RPM: 130, SPP 3250 psi, GPM 560, ROP 36 ft/hr'],
    ],
  });
  const ex = extractWorkbook(wb, OPTS);
  it('reads the table, the dates and the NPT flag', () => {
    expect(ex.recordMode).toBe('operations log');
    expect(ex.dateOrder.order).toBe('DMY');
    expect(ex.records.reduce((s, r) => s + (r.npt_hours ?? 0), 0)).toBeCloseTo(3, 3);
    expect(ex.problems.some(p => p.nptHours === 3)).toBe(true);
    expect(ex.wellInfo.well_name.value).toBe('W-9');
  });
  it('puts each operation\'s own parameters into its records', () => {
    const first = ex.records.find(r => r.source_ref === 'Ops!J2')!, third = ex.records.find(r => r.source_ref === 'Ops!J4')!;
    expect(first).toMatchObject({ wob_klb: 27.5, rpm: 120, torque_ftlb: 12000, flow_gpm: 550, spp_psi: 3100, rop_fph: 40, mud_weight_ppg: 10.4, formation_name: 'Shuaiba', activity_code: 'ROT' });
    expect(third).toMatchObject({ wob_klb: 30, rpm: 130, spp_psi: 3250, rop_fph: 36 });
    expect(third.mud_weight_ppg).toBe(10.4);   // carried from the previous report entry in the same hole section
    expect(ex.records.find(r => r.source_ref === 'Ops!J3')!.wob_klb).toBeNull();
  });
  it('engineer corrections and rejections change what is saved', () => {
    const wobId = ex.cellParams.find(h => h.src === 'Ops!J2' && h.key === 'wob')!.id, rpmId = ex.cellParams.find(h => h.src === 'Ops!J2' && h.key === 'rpm')!.id;
    const ex2 = extractWorkbook(wb, { ...OPTS, corrections: { [wobId]: { value: 22 }, [rpmId]: { reject: true } } });
    const r = ex2.records.find(x => x.source_ref === 'Ops!J2')!;
    expect(r.wob_klb).toBe(22); expect(r.rpm).toBeNull();
    expect(ex2.cellParams.find(h => h.id === wobId)).toMatchObject({ review: 'corrected', status: 'confirmed', confidence: 1, original: { key: 'wob', value: 27.5 } });
    expect(ex2.cellParams.find(h => h.id === rpmId)).toMatchObject({ review: 'rejected', status: 'rejected', use: false });
  });
});

describe('values scattered in random cells of a daily report', () => {
  const wb = book({
    'DDR': [
      ['Daily Drilling Report', null, null, null, 'Date: 2025-04-02'],
      [],
      [null, 'Well: K-5'],
      [null, null, null, 'ROP: 45.6 ft/hr'],
      ['WOB = 32.5 klb, RPM 120', null, null, null, null, null, 'Torque: 15.8 klb-ft'],
      [],
      [null, null, 'NPT - 4.5 hrs', null, 'MD: 9,850 ft'],
      [null, 'Mud Weight 10.2 ppg / ECD = 10.6 ppg'],
    ],
  });
  const ex = extractWorkbook(wb, OPTS);
  const f = ex.days[0]?.fields ?? {};
  it('finds every parameter wherever it is, with its cell', () => {
    expect(f.rop).toMatchObject({ value: 45.6, src: 'DDR!D4' });
    expect(f.wob).toMatchObject({ value: 32.5, src: 'DDR!A5' });
    expect(f.rpm).toMatchObject({ value: 120, src: 'DDR!A5' });
    expect(f.torque).toMatchObject({ value: 15800, src: 'DDR!G5' });
    expect(f.npt).toMatchObject({ value: 4.5, src: 'DDR!C7' });
    expect(f.mud_weight).toMatchObject({ value: 10.2 });
    expect(f.ecd).toMatchObject({ value: 10.6 });
    expect(ex.wellInfo.well_name.value).toBe('K-5');
  });
  it('builds a daily record from them', () => {
    const r = ex.records[ex.records.length - 1];
    expect(r).toMatchObject({ md_ft: 9850, wob_klb: 32.5, rpm: 120, torque_ftlb: 15800, npt_hours: 4.5, mud_weight_ppg: 10.2 });
  });
});
