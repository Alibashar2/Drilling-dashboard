// SAMPLE DATA ONLY. Everything produced here is synthetic, generated from a seeded random model so the
// application can be evaluated without real well data. Sample wells are flagged is_demo = true, carry
// "DEMO" in their Well ID and "(Sample)" in their name, and can be removed in Settings.
import type { DrillingRecord, Severity, Well } from '../lib/types';
import { interpAtMd, minCurvature, type TrajPoint } from '../lib/survey';

type Rec = Omit<DrillingRecord, 'well_id'>;
interface DemoProblem {
  md: number; category: string; hours: number; severity: Severity; description: string; rootCause: string;
  actions: string[]; lesson: string;
}
interface DemoSpec {
  code: string; name: string; type: string; spud: string; td: number; target: number; stopAt?: number; seed: number;
  sections: { size: number; bottom: number; bha: number }[];
  tops: { name: string; top: number }[];
  /** inclination (deg) as a function of MD, or null when the well has no survey (schematic is illustrative) */
  inc: ((md: number) => number) | null;
  problems: DemoProblem[];
}
export interface DemoWell {
  well: Omit<Well, 'id' | 'created_at'>; records: Rec[]; survey: { md: number; inc: number; azi: number }[];
  problems: (DemoProblem & { code: string; ts: string; formation: string; holeSize: number; bha: number; tvd: number | null; observed: Record<string, number> })[];
  prognosis: { formation_name: string; top_md_ft: number; bottom_md_ft: number }[];
}

const build = (kop: number, rate: number, max: number) => (md: number) => Math.max(0, Math.min(max, ((md - kop) / 100) * rate));

const SPECS: DemoSpec[] = [
  {
    code: 'DEMO-A', name: 'Well A (Sample)', type: 'Directional (J-type)', spud: '2025-02-03', td: 12500, target: 12500, seed: 11,
    sections: [{ size: 17.5, bottom: 2500, bha: 1 }, { size: 12.25, bottom: 7200, bha: 2 }, { size: 8.5, bottom: 12500, bha: 3 }],
    tops: [{ name: 'Alpha Shale', top: 0 }, { name: 'Bravo Sandstone', top: 2300 }, { name: 'Charlie Limestone', top: 4900 }, { name: 'Delta Shale', top: 6800 }, { name: 'Echo Sandstone', top: 8200 }, { name: 'Foxtrot Carbonate', top: 9900 }, { name: 'Golf Shale', top: 11600 }],
    inc: build(3000, 2.5, 35),
    problems: [
      { md: 8500, category: 'DIFF_STICK', hours: 12, severity: 'high', description: 'Differential sticking during drilling. String stuck after a connection with full circulation and no rotation.', rootCause: 'High overbalance across permeable sandstone with thick filter cake; pipe stationary during a slow connection.', actions: ['Worked pipe with torque and slump-down weight', 'Spotted pipe-release pill and soaked for 6 hours', 'Reduced mud weight by 0.3 ppg after freeing the string'], lesson: 'Keep the string moving in Echo Sandstone, minimise connection time and control fluid loss before entering the sand.' },
      { md: 10400, category: 'LOST_CIRC', hours: 8, severity: 'high', description: 'Partial to severe losses (up to 120 bbl/h) while drilling fractured carbonate.', rootCause: 'Natural fractures combined with high equivalent circulating density.', actions: ['Reduced flow rate and pumped LCM pill', 'Lowered ROP to reduce cuttings loading and ECD'], lesson: 'Pre-treat with LCM and reduce flow rate before drilling the upper Foxtrot Carbonate.' },
    ],
  },
  {
    code: 'DEMO-B', name: 'Well B (Sample)', type: 'Horizontal', spud: '2025-04-14', td: 14800, target: 14800, seed: 23,
    sections: [{ size: 17.5, bottom: 2600, bha: 1 }, { size: 12.25, bottom: 7400, bha: 2 }, { size: 8.5, bottom: 14800, bha: 3 }],
    tops: [{ name: 'Alpha Shale', top: 0 }, { name: 'Bravo Sandstone', top: 2450 }, { name: 'Charlie Limestone', top: 5050 }, { name: 'Delta Shale', top: 6700 }, { name: 'Echo Sandstone', top: 8350 }, { name: 'Foxtrot Carbonate', top: 10300 }],
    inc: build(7500, 3, 90),
    problems: [
      { md: 6950, category: 'TIGHT_HOLE', hours: 5, severity: 'medium', description: 'Tight hole with 40 klb overpull on connections; back-reaming required.', rootCause: 'Reactive shale swelling with insufficient inhibition.', actions: ['Back-reamed the interval twice', 'Increased KCl concentration in the mud system'], lesson: 'Raise inhibition before the Delta Shale and plan a wiper trip at the section midpoint.' },
      { md: 8620, category: 'DIFF_STICK', hours: 9, severity: 'high', description: 'Differential sticking while sliding in the build section; no pipe movement for 25 minutes.', rootCause: 'Long stationary slide across depleted sandstone with high overbalance.', actions: ['Jarred down and applied torque', 'Spotted pipe-release pill', 'Changed to rotary-steerable practice of short slides'], lesson: 'Limit slide length in Echo Sandstone and rotate between slides.' },
      { md: 12900, category: 'TORQUE_DRAG', hours: 6, severity: 'medium', description: 'Excessive torque and drag in the lateral; unable to transfer weight to the bit.', rootCause: 'Cuttings bed build-up in the lateral and high tortuosity.', actions: ['Circulated bottoms-up three times with pipe rotation', 'Added lubricant to the mud system'], lesson: 'Schedule regular clean-up cycles and add lubricant early in the lateral.' },
    ],
  },
  {
    code: 'DEMO-C', name: 'Well C (Sample)', type: 'Vertical', spud: '2025-06-09', td: 11000, target: 11000, seed: 37,
    sections: [{ size: 17.5, bottom: 2400, bha: 1 }, { size: 12.25, bottom: 7000, bha: 2 }, { size: 8.5, bottom: 11000, bha: 3 }],
    // one formation is deliberately named differently to demonstrate the formation-mapping tool
    tops: [{ name: 'Alpha Shale', top: 0 }, { name: 'Bravo Sandstone', top: 2200 }, { name: 'Charlie Limestone', top: 4800 }, { name: 'Delta Shale', top: 6600 }, { name: 'Echo Sandstone', top: 8100 }, { name: 'Foxtrot Carb.', top: 9700 }],
    inc: null,
    problems: [
      { md: 7000, category: 'INSTABILITY', hours: 10, severity: 'high', description: 'Wellbore instability: cavings at the shakers and fill on bottom after the casing-point trip.', rootCause: 'Mud weight below the shale collapse gradient.', actions: ['Raised mud weight by 0.5 ppg', 'Reamed and circulated the hole clean'], lesson: 'Drill the Delta Shale with mud weight at or above the collapse gradient.' },
      { md: 10250, category: 'LOST_CIRC', hours: 14, severity: 'critical', description: 'Total losses while drilling; no returns for 3 hours.', rootCause: 'Vugular carbonate; ECD above the fracture gradient.', actions: ['Pumped two LCM pills', 'Set a cement plug and re-drilled'], lesson: 'Have LCM and cement contingency ready before the carbonate; monitor pit volume closely.' },
    ],
  },
  {
    code: 'DEMO-D', name: 'Well D (Sample, active)', type: 'Directional (J-type)', spud: '2025-09-01', td: 12800, target: 12800, stopAt: 8060, seed: 53,
    sections: [{ size: 17.5, bottom: 2600, bha: 1 }, { size: 12.25, bottom: 7300, bha: 2 }, { size: 8.5, bottom: 12800, bha: 3 }],
    tops: [{ name: 'Alpha Shale', top: 0 }, { name: 'Bravo Sandstone', top: 2350 }, { name: 'Charlie Limestone', top: 4950 }, { name: 'Delta Shale', top: 6900 }, { name: 'Echo Sandstone', top: 8300 }, { name: 'Foxtrot Carbonate', top: 10000 }, { name: 'Golf Shale', top: 11700 }],
    inc: build(3200, 2.5, 32),
    problems: [
      { md: 4400, category: 'HOLE_CLEAN', hours: 3, severity: 'low', description: 'Poor hole cleaning: erratic torque and reduced cuttings return.', rootCause: 'Flow rate too low for the 12¼ in hole at high ROP.', actions: ['Increased flow rate and circulated bottoms-up'], lesson: 'Match flow rate to ROP in the 12¼ in section.' },
    ],
  },
];

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FORM_ROP: Record<string, number> = { Alpha: 125, Bravo: 105, Charlie: 62, Delta: 80, Echo: 72, Foxtrot: 48, Golf: 66 };
const SIZE: Record<number, { rop: number; wob: number; rpm: number; tq: number; flow: number; spp: number }> = {
  17.5: { rop: 1.0, wob: 28, rpm: 110, tq: 7000, flow: 950, spp: 2200 },
  12.25: { rop: 1.0, wob: 36, rpm: 130, tq: 11000, flow: 800, spp: 3000 },
  8.5: { rop: 0.95, wob: 30, rpm: 90, tq: 12500, flow: 610, spp: 3350 },
};
const STEP_H = 5 / 60, STAND = 95;
const r1 = (v: number) => Math.round(v * 10) / 10;

export function generateDemoWell(spec: DemoSpec): DemoWell {
  const rnd = mulberry32(spec.seed);
  const noise = (amp: number) => 1 + (rnd() + rnd() + rnd() - 1.5) * (amp / 0.75);
  const end = spec.stopAt ?? spec.td;
  const stations = spec.inc ? Array.from({ length: Math.floor(end / STAND) + 2 }, (_, i) => { const md = Math.min(i * STAND, end); return { md, inc: r1(spec.inc!(md)), azi: 135 }; }) : [];
  const traj: TrajPoint[] = minCurvature(stations);
  const tvdAt = (md: number) => (traj.length ? Math.round(interpAtMd(traj, md)!.tvd * 10) / 10 : null);
  const formAt = (md: number) => [...spec.tops].reverse().find(t => md >= t.top)!.name;

  const recs: Rec[] = [];
  const problems: DemoWell['problems'] = [];
  let t = Date.parse(spec.spud + 'T06:00:00Z'), hole = 0, bit = 0;
  const pending = [...spec.problems].sort((a, b) => a.md - b.md);

  const push = (code: string, sec: DemoSpec['sections'][number], p: Partial<Rec> = {}) => {
    const mw = r1(8.8 + Math.floor(hole / 1000) * 0.27);
    recs.push({
      ts: new Date(t).toISOString(), md_ft: r1(hole), hole_depth_ft: r1(hole), bit_depth_ft: r1(bit), tvd_ft: tvdAt(hole),
      rop_fph: 0, wob_klb: 0, rpm: 0, torque_ftlb: 0, spp_psi: 0, diff_pressure_psi: 0, flow_gpm: 0, mud_weight_ppg: mw,
      hook_load_klb: Math.round(110 + bit * 0.014 * noise(0.03)), drilling_hours: null, circulating_hours: null, connection_time_min: null,
      npt_hours: 0, activity_code: code, activity_raw: null, formation_name: formAt(hole), bha_number: sec.bha, hole_size_in: sec.size, problem_text: null, ...p,
    });
    t += STEP_H * 3600000;
  };
  const repeat = (hours: number, fn: (i: number, n: number) => void) => { const n = Math.max(1, Math.round(hours / STEP_H)); for (let i = 0; i < n; i++) fn(i, n); };
  const circ = (sec: DemoSpec['sections'][number], hours: number, extra: Partial<Rec> = {}) => {
    const s = SIZE[sec.size];
    repeat(hours, () => push('CIR', sec, { rpm: Math.round(40 * noise(0.1)), flow_gpm: Math.round(s.flow * noise(0.02)), spp_psi: Math.round(s.spp * 0.85 * noise(0.02)), torque_ftlb: Math.round(s.tq * 0.3 * noise(0.1)), ...extra }));
  };
  const trip = (sec: DemoSpec['sections'][number], from: number, to: number) => {
    repeat(Math.max(0.5, (Math.abs(to - from) / 1000) * 0.6), (i, n) => { bit = from + ((to - from) * (i + 1)) / n; push('TRP', sec); });
  };

  outer: for (let si = 0; si < spec.sections.length; si++) {
    const sec = spec.sections[si], s = SIZE[sec.size], secEnd = Math.min(sec.bottom, end);
    if (hole > 0) trip(sec, 0, hole);
    let standLeft = STAND, standNo = 0;
    while (hole < secEnd - 0.01) {
      const prob = pending[0];
      // precursor trend in the 80 ft before a scheduled problem
      const stress = prob && prob.md - hole < 80 && prob.md - hole >= 0;
      const inBuild = spec.inc ? spec.inc(hole) > 0 && spec.inc(hole + 300) > spec.inc(hole) : false;
      const slide = inBuild && standNo % 3 === 2 && standLeft > STAND - 40;
      const form = formAt(hole).split(' ')[0];
      let rop = (FORM_ROP[form] ?? 70) * s.rop * noise(0.22) * (slide ? 0.5 : 1) * (stress ? 0.45 : 1);
      rop = Math.max(8, rop);
      const made = Math.min(rop * STEP_H, secEnd - hole, standLeft);
      hole += made; bit = hole; standLeft -= made;
      const tq = (s.tq + hole * 0.32) * noise(0.07) * (stress && /STICK|TORQUE|TIGHT|CLEAN|INSTAB/.test(prob!.category) ? 1.45 : 1);
      push(slide ? 'SLD' : 'ROT', sec, {
        rop_fph: r1(made / STEP_H), wob_klb: r1(s.wob * noise(0.1) * (slide ? 0.8 : 1)), rpm: slide ? 0 : Math.round(s.rpm * noise(0.05)),
        torque_ftlb: Math.round(slide ? tq * 0.35 : tq), flow_gpm: Math.round(s.flow * noise(0.015)),
        spp_psi: Math.round((s.spp + hole * 0.02) * noise(0.02) * (stress && /PACK|CLEAN|INSTAB/.test(prob!.category) ? 1.2 : 1)),
        diff_pressure_psi: Math.round((260 + rop * 3.4 + (slide ? 160 : 0)) * noise(0.08)),
        hook_load_klb: Math.round(110 + hole * 0.014 - s.wob * 0.6),
      });
      if (prob && hole >= prob.md) {
        pending.shift();
        const last = recs[recs.length - 1];
        const win = recs.slice(-10).filter(r => r.activity_code === 'ROT' || r.activity_code === 'SLD');
        const avg = (k: keyof Rec) => Math.round((win.reduce((a, r) => a + ((r[k] as number) ?? 0), 0) / Math.max(win.length, 1)) * 10) / 10;
        problems.push({
          ...prob, code: `PRB-${spec.code}-${String(problems.length + 1).padStart(2, '0')}`, ts: last.ts, formation: formAt(hole), holeSize: sec.size, bha: sec.bha, tvd: tvdAt(hole),
          observed: { rop_fph: avg('rop_fph'), wob_klb: avg('wob_klb'), rpm: avg('rpm'), torque_ftlb: avg('torque_ftlb'), spp_psi: avg('spp_psi'), flow_gpm: avg('flow_gpm'), diff_pressure_psi: avg('diff_pressure_psi'), mud_weight_ppg: last.mud_weight_ppg! },
        });
        const label = { DIFF_STICK: 'Differential sticking', LOST_CIRC: 'Lost circulation', TIGHT_HOLE: 'Tight hole', TORQUE_DRAG: 'Excessive torque and drag', INSTABILITY: 'Wellbore instability', HOLE_CLEAN: 'Hole cleaning problem' }[prob.category] ?? prob.category;
        repeat(prob.hours, () => push('WOO', sec, { npt_hours: STEP_H, problem_text: label, flow_gpm: prob.category === 'LOST_CIRC' ? Math.round(s.flow * 0.4) : Math.round(s.flow * 0.7), spp_psi: Math.round(s.spp * 0.5) }));
        circ(sec, 1);
        repeat(0.75, () => push('REA', sec, { rpm: Math.round(s.rpm * 0.7), flow_gpm: s.flow, spp_psi: Math.round(s.spp * 0.9), torque_ftlb: Math.round(s.tq * 0.6 * noise(0.1)) }));
      }
      if (standLeft <= 0.01 && hole < secEnd - 0.01) { standNo++; standLeft = STAND; repeat(rnd() < 0.35 ? 0.25 : 0.1667, () => push('CON', sec)); }
      if (spec.stopAt && hole >= spec.stopAt - 0.01) break outer;
    }
    circ(sec, 1.5 + rnd());
    trip(sec, hole, 0);
    if (si < spec.sections.length - 1) repeat(20 + rnd() * 8, () => push('OTH', sec, { activity_raw: 'Run casing / cement / WOC' }));
  }

  const drilled = recs[recs.length - 1].hole_depth_ft!;
  const prognosis = spec.stopAt
    ? spec.tops.map((tp, i) => ({ formation_name: tp.name, top_md_ft: tp.top, bottom_md_ft: spec.tops[i + 1]?.top ?? spec.target })).filter(p => p.bottom_md_ft > drilled).map(p => ({ ...p, top_md_ft: Math.max(p.top_md_ft, drilled) }))
    : [];
  const lastDay = recs[recs.length - 1].ts.slice(0, 10);
  return {
    well: {
      well_code: spec.code, name: spec.name, field: 'Sample Field', location: 'Sample Basin (synthetic)', well_type: spec.type,
      status: spec.stopAt ? 'active' : 'completed', spud_date: spec.spud,
      planned_completion_date: new Date(Date.parse(spec.spud) + 16 * 86400000).toISOString().slice(0, 10),
      completion_date: spec.stopAt ? null : lastDay, target_depth_ft: spec.target, hole_size_in: spec.sections[spec.sections.length - 1].size,
      source_depth_unit: 'ft', is_demo: true, notes: 'SAMPLE DATA - synthetic well generated for demonstration. Not real drilling data.',
    },
    records: recs, survey: stations, problems, prognosis,
  };
}

export const generateDemoWells = (): DemoWell[] => SPECS.map(generateDemoWell);

/**
 * A small synthetic workbook in METRIC units with non-standard column names, for trying the import wizard:
 * sheet 1 = drilling data (m, m/h, kN, kN-m, kPa, L/min, sg), sheet 2 = directional survey.
 */
export function sampleImportSheets(): { drilling: (string | number | null)[][]; survey: (string | number)[][] } {
  const w = generateDemoWell({ ...SPECS[0], code: 'IMPORT-TEST', seed: 71, td: 9000, target: 9000, sections: [{ size: 17.5, bottom: 2500, bha: 1 }, { size: 12.25, bottom: 7200, bha: 2 }, { size: 8.5, bottom: 9000, bha: 3 }], problems: [{ ...SPECS[0].problems[0], md: 8480, hours: 4 }] });
  const m = (ft: number | null) => (ft == null ? null : Math.round((ft / 3.280839895) * 100) / 100);
  const names: Record<string, string> = { ROT: 'Rotary drilling', SLD: 'Slide drilling', CON: 'Connection', TRP: 'Tripping', CIR: 'Circulating', REA: 'Reaming', WOO: 'Waiting on operations', OTH: 'Other' };
  const drilling: (string | number | null)[][] = [[
    'Date Time', 'Measured Depth (m)', 'TVD (m)', 'Bit Depth (m)', 'Hole Depth (m)', 'ROP (m/h)', 'Weight on Bit (kN)', 'Rotary Speed', 'Torque (kN-m)',
    'Standpipe Pressure (kPa)', 'Diff Pressure (kPa)', 'Flow Rate (L/min)', 'Mud Density (sg)', 'Hookload (kN)', 'NPT (h)', 'Formation', 'Rig Activity', 'BHA No', 'Hole Size (in)', 'Problem',
  ]];
  for (const r of w.records) drilling.push([
    r.ts.slice(0, 16).replace('T', ' '), m(r.md_ft), m(r.tvd_ft), m(r.bit_depth_ft), m(r.hole_depth_ft), m(r.rop_fph), Math.round(r.wob_klb! / 0.2248089 * 10) / 10, r.rpm,
    Math.round(r.torque_ftlb! / 737.5621 * 100) / 100, Math.round(r.spp_psi! / 0.1450377), Math.round(r.diff_pressure_psi! / 0.1450377), Math.round(r.flow_gpm! / 0.2641721),
    Math.round(r.mud_weight_ppg! / 8.3454 * 1000) / 1000, Math.round(r.hook_load_klb! / 0.2248089), r.npt_hours, r.formation_name, names[r.activity_code!], r.bha_number, r.hole_size_in, r.problem_text,
  ]);
  // deliberate defects so the validation step has something to report
  drilling.splice(40, 0, [...drilling[39]]);            // duplicate row
  drilling[120][5] = 'n.a.?';                           // invalid number
  drilling[200][0] = 'not a date';                      // invalid date
  const survey: (string | number)[][] = [['MD (m)', 'Inclination', 'Azimuth'], ...w.survey.map(s => [m(s.md)!, s.inc, s.azi])];
  return { drilling, survey };
}
