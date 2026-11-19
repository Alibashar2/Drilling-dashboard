import { describe, expect, it } from 'vitest';
import { finalizeHits, readUnit, scanCell, type InCellHit } from './incell';

const scan = (t: string, ctx: Parameters<typeof scanCell>[3] = 'general') => { const h = scanCell(t, 'S', 'A1', ctx); finalizeHits(h, 'ft'); return h; };
const one = (hits: InCellHit[], key: string) => hits.filter(h => h.key === key);

describe('in-cell parameter grammar (spec notations)', () => {
  it.each([
    ['ROP 45.6', 'rop', 45.6], ['ROP: 45.6', 'rop', 45.6], ['ROP = 45.6', 'rop', 45.6], ['Rate of Penetration 45.6 ft/hr', 'rop', 45.6],
    ['WOB (klb): 32.5', 'wob', 32.5], ['RPM-120', 'rpm', 120], ['Torque: 15.8 klb-ft', 'torque', 15.8], ['NPT - 4.5 hrs', 'npt', 4.5],
    ['WOB = 32.5 klb', 'wob', 32.5], ['RPM 120', 'rpm', 120], ['Average ROP: 12 m/hr', 'rop_avg', 12], ['Overall ROP 30 ft/h', 'rop_avg', 30],
    ['Instantaneous ROP = 80 fph', 'rop_inst', 80], ['Footage Drilled: 90 ft', 'footage', 90], ['Measured Depth: 8,510 ft', 'md', 8510], ['TVD 8,402 ft', 'tvd', 8402],
    ['Bit Depth: 8,500 ft', 'bit_depth', 8500], ['Hole Depth = 8,510 ft', 'hole_depth', 8510], ['SPP: 3,150 psi', 'spp', 3150], ['Differential Pressure: 250 psi', 'diff_pressure', 250],
    ['Flow Rate: 650 gpm', 'flow', 650], ['Mud Weight: 10.2 ppg', 'mud_weight', 10.2], ['Hook Load 210 klb', 'hook_load', 210], ['ECD = 1.35 sg', 'ecd', 1.35],
    ['Drilling Hours: 14.5 hrs', 'drilling_hours', 14.5], ['Connection Time: 12 min', 'connection_time', 12], ['Circulating Time 2.5 hrs', 'circ_hours', 2.5],
    ['Tripping Time: 6 hrs', 'tripping_hours', 6], ['Rotating Hours 10', 'rotating_hours', 10], ['Operating Hours: 24', 'operating_hours', 24],
    ['Formation Top: 8,420 ft', 'fm_top', 8420], ['Formation Bottom = 9,100 ft', 'fm_bottom', 9100],
  ])('%s', (text, key, value) => {
    const h = scan(text);
    expect(h.map(x => x.key)).toContain(key);
    expect(one(h, key)[0].value).toBe(value);
    expect(one(h, key)[0].text.length).toBeGreaterThan(0);
  });
  it('keeps the original text, source and units; converts to database units', () => {
    const [h] = scan('Torque: 15.8 klb-ft');
    expect(h).toMatchObject({ src: 'S!A1', unit: 'kft-lb', unitBasis: 'written', canonical: 15800, canonicalUnit: 'ft-lb', status: 'confirmed' });
    expect(h.text).toBe('Torque: 15.8 klb-ft');
  });
  it('text parameters', () => {
    const h = scan('Formation: Dibdibba.\nLithology at 280 m: 100 % Sand & Gravel.\nHole Section: 12 1/4"');
    expect(one(h, 'formation')[0].value).toBe('Dibdibba');
    expect(one(h, 'lithology')[0]).toMatchObject({ value: '100% Sand & Gravel', depth: [{ value: 280, unit: 'm' }] });
  });
});

describe('real report notation (XX-1 comments)', () => {
  const cell = 'Drill 23" Surface hole Sec. from 58 m to 183 m.\n- WOB: 1-5 Ton, RPM: 60-70, T.RPM: 90-110 ,TQ: 2-12 kft.lb.\n- F.R: 1000-1500 lpm, SPP: 170-480 psi.\n- On BTM ROP: 37.09 m/hr, Avg ROP: 23.81 m/hr.\n- Formation: Dibdibba.\n- No DHL.';
  const h = scan(cell, 'drilling');
  it('finds every parameter with its range and unit', () => {
    expect(one(h, 'wob')[0]).toMatchObject({ value: 3, min: 1, max: 5, unit: 'tonne', status: 'inferred', context: 'drilling' });
    expect(one(h, 'wob')[0].canonical).toBeCloseTo(3 * 2.20462, 3);
    expect(one(h, 'rpm')[0]).toMatchObject({ min: 60, max: 70 });
    expect(one(h, 'rpm_total')[0]).toMatchObject({ min: 90, max: 110 });
    expect(one(h, 'torque')[0]).toMatchObject({ min: 2, max: 12, unit: 'kft-lb', canonical: 7000 });
    expect(one(h, 'flow')[0]).toMatchObject({ min: 1000, max: 1500, unit: 'L/min' });
    expect(one(h, 'spp')[0]).toMatchObject({ min: 170, max: 480, unit: 'psi' });
    expect(one(h, 'rop_inst')[0]).toMatchObject({ value: 37.09, unit: 'm/h', status: 'confirmed' });
    expect(one(h, 'rop_avg')[0]).toMatchObject({ value: 23.81, unit: 'm/h' });
    expect(one(h, 'rop')).toHaveLength(0);                       // "ROP" inside "Avg ROP" is not a second value
    expect(one(h, 'loss_rate')[0]).toMatchObject({ value: 0, method: 'negative statement' });
    expect(one(h, 'formation')[0].value).toBe('Dibdibba');
  });
  it('context of a line overrides the operation context', () => {
    const r = scan('POOH 23" Motor BHA from 257 m to surface.\n- Observed overpull of 10 ton at depth: 254 m, Ream up from 257 m to 173 m with FR: 1460-1535 lpm, SPP: 280-360 psi, SRPM: 30, TRPM:75, TQ: 3-11 kft.lb.', 'tripping');
    expect(one(r, 'flow')[0].context).toBe('reaming');
    expect(one(r, 'rpm_surface')[0]).toMatchObject({ value: 30, context: 'reaming' });
    expect(one(r, 'overpull')[0]).toMatchObject({ value: 10, unit: 'tonne', depth: [{ value: 254, unit: 'm' }] });
  });
  it('survey stations, projections and an impossible TVD', () => {
    const r = scan('** Last Survey: 577.96 mMD, 577.89 mTVD, inc:2.98°, Azm:145.77°, Ct-Ct:5.82 m, 0 below, 2.52 mL\n** Projection to Bit: 1547.00 mMD, 15533.41 mTVD, inc:16.50°, Azm:190°');
    const md = one(r, 'survey_md');
    expect(md[0]).toMatchObject({ value: 577.96, unit: 'm', qualifier: 'survey', status: 'confirmed' });
    expect(one(r, 'inc')[0].value).toBe(2.98);
    expect(one(r, 'azi')[0].value).toBe(145.77);
    expect(one(r, 'ct_ct')[0].value).toBe(5.82);
    expect(md[1].qualifier).toBe('projection');
    expect(one(r, 'survey_tvd')[1].status).toBe('suspected');
  });
  it('pairs, jar hours, mud weight without unit, losses with depth', () => {
    const r = scan('- Recorded string Up/Down weight: 138/115 Ton.\n** Daily Jar Hr: 2.63 hr\n** Total Jar hours for 17.5\'\' : 35.25 hr,\n- MW IN/OUT: 1.12 SG.\n- Current Mw In/Out: 1.21 (gradually increased MW to 1.25 sg)\n- At 735 m, observe losses rate:10 m3/hr, started pump low conc LCM.\n- DHL: 2 m3/hr.');
    expect(one(r, 'pickup_wt')[0].value).toBe(138);
    expect(one(r, 'slackoff_wt')[0].value).toBe(115);
    expect(one(r, 'jar_hours').map(x => [x.qualifier, x.value])).toEqual([['daily', 2.63], ['total', 35.25]]);
    const mw = one(r, 'mud_weight');
    expect(mw[0]).toMatchObject({ value: 1.12, unit: 'sg', qualifier: 'in/out' });
    expect(mw[1]).toMatchObject({ value: 1.21, unit: 'sg', unitBasis: 'report', status: 'inferred' });
    const lr = one(r, 'loss_rate');
    expect(lr[0]).toMatchObject({ value: 10, unit: 'm3/h', depth: [{ value: 735, unit: 'm' }] });
    expect(lr[1].value).toBe(2);
  });
  it('identifiers are recognised but not used; unit typos are read', () => {
    const r = scan('- 2 Joints 8" DC\'s c/w 8" WFD Jar (SN: 17625029) .\n- RPM: 40-60, TQ:3-20 klbf.ft.\n- SRPM 120/120 RPM. Torque: 14-16 KIbf.ft.');
    expect(one(r, 'serial')[0]).toMatchObject({ value: '17625029', use: false });
    expect(r.filter(x => x.use && typeof x.value === 'number' && x.value === 17625029)).toHaveLength(0);
    expect(one(r, 'torque').map(x => x.unit)).toEqual(['kft-lb', 'kft-lb']);
    expect(readUnit('KIbf.ft')?.unit).toBe('kft-lb');
  });
  it('kick drills are not drilling; formation top markers carry their depth', () => {
    const r = scan('Performed Kick drill while drilling, FR: 2650 lpm\nRotary drilling 17-1/2" hole section from 706 m to 813 m (Top of RUS FM)');
    expect(one(r, 'flow')[0].context).toBe('drilling');   // "while drilling": the last verb before the value
    const k = scan('Performed Kick drill. SPP: 850 psi');
    expect(one(k, 'spp')[0].context).toBe('well control');
    expect(one(r, 'fm_top_marker')[0]).toMatchObject({ value: 'RUS', depth: [{ value: 813, unit: 'm' }] });
  });
});
