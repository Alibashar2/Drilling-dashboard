// Layer 3b - parameters written together with their value inside one cell.
//   "WOB: 2-4 Ton, FR:1000 lpm, SPP:330-350 psi; S.RPM: 30, T.RPM:65 Torque: 10 -11 klbs.ft"
//   "ROP 45.6", "ROP = 45.6", "Rate of Penetration 45.6 ft/hr", "WOB (klb): 32.5", "RPM-120", "NPT - 4.5 hrs"
// Cells are scanned wherever they are; nothing depends on a column or a cell position. A number is taken only
// when a recognised parameter name (or, for flow and RPM, an unmistakable unit) says what it is. Every hit keeps
// the exact text it came from, the worksheet!cell, the method, a confidence and the operational context of the line
// (drilling, reaming, circulating...) so that e.g. a reaming flow rate is never used as a drilling flow rate.
import { UNITS, type Dim } from '../../lib/units';

export type HitStatus = 'confirmed' | 'inferred' | 'suspected' | 'rejected';
export type Context = 'drilling' | 'reaming' | 'circulating' | 'tripping' | 'testing' | 'cementing' | 'casing' | 'logging' | 'well control' | 'scr' | 'general';
type PDim = Dim | 'text' | 'angle' | 'percent' | 'count' | 'speed' | 'temperature';

export interface InCellHit {
  id: string; key: string; label: string; group: string; qualifier: string | null;
  rawLabel: string;            // the parameter name exactly as written
  text: string;                // the matched text, e.g. "On BTM ROP: 37.09 m/hr"
  line: string;                // the whole line of the cell it was found in
  value: number | string; min: number | null; max: number | null;
  unitRaw: string | null;      // unit as written ("Ton", "kft.lb")
  unit: string | null;         // recognised unit ("tonne", "kft-lb")
  unitBasis: 'written' | 'report' | 'range' | 'default' | 'none';
  canonical: number | null; canonicalUnit: string | null;   // value in the database unit (klb, ft-lb, psi, gpm, ppg, ft ...)
  depth: { value: number; unit: 'ft' | 'm' | null }[];     // depth(s) the statement refers to ("At 735 m, ...")
  context: Context;
  sheet: string; cell: string; src: string;
  confidence: number; method: string; status: HitStatus; notes: string[];
  use: boolean;                // false for identifiers (serial numbers...): recognised, never used as drilling data
  span: [number, number];      // position of `text` inside `line`
  review?: 'confirmed' | 'corrected' | 'rejected';
  original?: { key: string; value: number | string };
}
export interface Correction { key?: string; value?: number | string; reject?: boolean; confirm?: boolean }

interface Param {
  key: string; label: string; group: string; dim: PDim; re: string;
  range?: [number, number];    // plausible range, canonical units
  pair?: [string, string];     // "138/115 Ton" -> two parameters
  amb?: boolean;               // short / ambiguous abbreviation
}
const S = String.raw`[\s._-]*`;
const H = String.raw`(?:hrs?|hours?)`;
const p = (key: string, label: string, group: string, dim: PDim, re: string, range?: [number, number], extra: Partial<Param> = {}): Param => ({ key, label, group, dim, re, range, ...extra });

/** Parameter lexicon. Learned from real reports (XX-1) and the usual DDR vocabulary; extend it here. */
export const PARAMS: Param[] = [
  // performance
  p('rop_inst', 'Instantaneous (on-bottom) ROP', 'Performance', 'rop', String.raw`on${S}(?:btm|bottom)${S}rop|inst\w*\.?${S}rop|rop${S}on${S}(?:btm|bottom)`, [0, 3000]),
  p('rop_avg', 'Average ROP', 'Performance', 'rop', String.raw`(?:avg|avr|aver|average|overall|mean|net|gross)\.?${S}rop|rop${S}\(?(?:avg|average)\)?`, [0, 3000]),
  p('rop', 'ROP', 'Performance', 'rop', String.raw`rop|rate${S}of${S}penetration|penetration${S}rate`, [0, 3000]),
  p('footage', 'Footage drilled', 'Performance', 'depth', String.raw`footage(?:${S}drilled)?|meterage|total${S}drilled|drilled${S}(?:length|footage|interval)|progress`, [0, 30000]),
  // depth
  p('md', 'Measured depth (MD)', 'Depth', 'depth', String.raw`md|measured${S}depth|depth${S}\(?md\)?`, [0, 45000]),
  p('tvd', 'True vertical depth (TVD)', 'Depth', 'depth', String.raw`tvd|true${S}vertical${S}depth`, [0, 45000]),
  p('bit_depth', 'Bit depth', 'Depth', 'depth', String.raw`bit${S}depth|bit${S}pos\w*`, [0, 45000]),
  p('hole_depth', 'Hole depth', 'Depth', 'depth', String.raw`hole${S}depth|total${S}depth|depth${S}of${S}hole`, [0, 45000]),
  p('shoe_depth', 'Casing / conductor shoe depth', 'Depth', 'depth', String.raw`(?:conductor|casing|csg)?${S}shoe(?:${S}depth)?`, [0, 45000]),
  p('toc', 'Top of cement', 'Depth', 'depth', String.raw`toc|top${S}of${S}cement`, [0, 45000]),
  p('ct_ct', 'Centre-to-centre distance (anti-collision)', 'Survey', 'depth', String.raw`c${S}t${S}c${S}t|ct${S}ct|c${S}ct|cent(?:re|er)${S}to${S}cent(?:re|er)`, [0, 30000]),
  // drilling parameters
  p('wob', 'WOB', 'Drilling', 'force', String.raw`wob|w\.o\.b\.?|weight${S}on${S}bit`, [0, 150]),
  p('rpm_surface', 'Surface (string) RPM', 'Drilling', 'count', String.raw`s${S}rpm|surface${S}rpm|string${S}rpm|rotary${S}rpm|top${S}drive${S}rpm|td${S}rpm`, [0, 400]),
  p('rpm_total', 'Total (bit) RPM', 'Drilling', 'count', String.raw`t${S}rpm|total${S}rpm|bit${S}rpm`, [0, 600]),
  p('rpm_motor', 'Motor RPM', 'Drilling', 'count', String.raw`m${S}rpm|motor${S}rpm|mud${S}motor${S}rpm`, [0, 600]),
  p('rpm', 'RPM', 'Drilling', 'count', String.raw`rpm|rotary${S}speed`, [0, 400]),
  p('torque', 'Torque', 'Drilling', 'torque', String.raw`torque|torq|trq|tq`, [0, 80000]),
  p('spp', 'Standpipe pressure (SPP)', 'Drilling', 'pressure', String.raw`spp|ssp|s\.p\.p\.?|stand${S}pipe(?:${S}press(?:ure)?)?|pump${S}press(?:ure)?`, [0, 10000]),
  p('diff_pressure', 'Differential pressure', 'Drilling', 'pressure', String.raw`diff(?:erential)?\.?${S}p(?:ress(?:ure)?)?|delta${S}p|Δ${S}p`, [0, 3000]),
  p('flow', 'Flow rate', 'Drilling', 'flow', String.raw`f\.?\s?r|flow${S}rate|flow${S}in|flow|fl|pump${S}rate`, [0, 3000], { amb: true }),
  p('spm', 'Pump strokes (SPM)', 'Drilling', 'count', String.raw`spm|strokes?${S}per${S}min\w*`, [0, 300]),
  p('hook_load', 'Hook load', 'Drilling', 'force', String.raw`hook${S}load|hkld`, [0, 1500]),
  p('updown', 'Pick-up / slack-off weight', 'Drilling', 'force', String.raw`(?:string${S})?(?:up${S}\/${S}down|p${S}\/${S}u${S}\/${S}s${S}\/${S}o)${S}(?:wt|weight)s?(?:${S}with${S}last${S}joint)?|(?:wt|weight)\.?${S}up${S}\/${S}down(?:${S}prior${S}(?:to${S})?sting(?:ing)?${S}in)?`, [0, 1500], { pair: ['pickup_wt', 'slackoff_wt'] }),
  p('pickup_wt', 'Pick-up weight', 'Drilling', 'force', String.raw`p${S}\/?${S}u${S}(?:wt|weight)\.?|pick${S}up${S}(?:wt|weight)|up${S}(?:wt|weight)`, [0, 1500]),
  p('slackoff_wt', 'Slack-off weight', 'Drilling', 'force', String.raw`s${S}\/?${S}o${S}(?:wt|weight)\.?|slack${S}off${S}(?:wt|weight)|down${S}(?:wt|weight)`, [0, 1500]),
  p('rot_wt', 'Rotating / neutral weight', 'Drilling', 'force', String.raw`rot(?:ating)?${S}(?:wt|weight)\.?|neutral${S}(?:wt|weight)\.?`, [0, 1500]),
  p('overpull', 'Overpull', 'Drilling', 'force', String.raw`over${S}pull(?:${S}of)?`, [0, 500]),
  p('bha_weight', 'BHA weight', 'Drilling', 'force', String.raw`bha${S}(?:wt|weight)`, [0, 500]),
  p('wt_below_jar', 'Weight below jar', 'Drilling', 'force', String.raw`(?:wt|weight)\.?${S}below${S}jar|wbj`, [0, 500]),
  // mud
  p('mw_inout', 'Mud weight in / out', 'Mud', 'density', String.raw`(?:mw|mud${S}(?:weight|wt)\.?|brine${S}(?:weight|wt)\.?)${S}in${S}\/${S}out`, [6, 25], { pair: ['mud_weight', 'mud_weight_out'] }),
  p('mud_weight', 'Mud weight', 'Mud', 'density', String.raw`m\.?w(?:t)?(?:${S}in)?|mud${S}(?:weight|wt|density)(?:${S}in)?|brine${S}weight`, [6, 25], { amb: true }),
  p('mud_weight_out', 'Mud weight out', 'Mud', 'density', String.raw`m\.?w${S}out|mud${S}weight${S}out`, [6, 25]),
  p('ecd', 'ECD', 'Mud', 'density', String.raw`ecd|equiv\w*${S}circ\w*${S}dens\w*`, [6, 25]),
  p('yp', 'Yield point (YP)', 'Mud', 'count', String.raw`yp|yield${S}point`, [0, 150]),
  p('pv', 'Plastic viscosity (PV)', 'Mud', 'count', String.raw`pv|plastic${S}visc\w*`, [0, 200]),
  p('funnel_vis', 'Funnel viscosity', 'Mud', 'count', String.raw`f${S}v|funnel${S}vis\w*|mfv`, [10, 400]),
  p('loss_rate', 'Downhole loss rate', 'Mud', 'lossrate', String.raw`dhl(?:${S}rate)?|d\.h\.l\.?|down${S}hole${S}loss(?:es)?(?:${S}rate)?(?:${S}while${S}\w+)?|loss(?:es)?${S}rate|dynamic${S}loss(?:es)?|static${S}loss(?:es)?|loss(?:es)?(?=\s*(?:\+\/-|±|~)?\s*\d[\d.,\s-]*(?:m3|m³|bbl)s?\/h)`, [0, 3000]),
  p('loss_volume', 'Mud lost (volume)', 'Mud', 'volume', String.raw`total${S}loss(?:es)?(?:${S}during${S}the${S}job)?|cum\w*${S}loss(?:es)?|mud${S}lost`, [0, 100000]),
  // time
  p('npt', 'NPT', 'Time', 'hours', String.raw`npt|non${S}productive${S}time|down${S}time|lost${S}time`, [0, 2000]),
  p('drilling_hours', 'Drilling hours', 'Time', 'hours', String.raw`(?:drilling|drlg)${S}(?:${H}|time)|on${S}bottom${S}(?:${H}|time)`, [0, 2000]),
  p('rotating_hours', 'Rotating hours', 'Time', 'hours', String.raw`rotating${S}(?:${H}|time)|rot${S}${H}`, [0, 2000]),
  p('sliding_hours', 'Sliding hours', 'Time', 'hours', String.raw`slid(?:e|ing)${S}(?:${H}|time)`, [0, 2000]),
  p('circ_hours', 'Circulating time', 'Time', 'hours', String.raw`circ\w*${S}(?:${H}|time)`, [0, 2000]),
  p('tripping_hours', 'Tripping time', 'Time', 'hours', String.raw`trip\w*${S}(?:${H}|time)`, [0, 2000]),
  p('connection_time', 'Connection time', 'Time', 'minutes', String.raw`conn\w*${S}(?:time|duration)`, [0, 600]),
  p('operating_hours', 'Operating hours', 'Time', 'hours', String.raw`operat\w*${S}(?:${H}|time)`, [0, 2000]),
  p('jar_hours', 'Jar hours', 'BHA', 'hours', String.raw`jar${S}${H}(?:${S}(?:for${S}[^:\n]{1,25}|\([^)\n]{1,25}\)))?`, [0, 5000]),
  p('pbl_hours', 'PBL sub hours', 'BHA', 'hours', String.raw`pbl(?:${S}sub\.?)?(?:${S}circulating)?${S}${H}\.?`, [0, 5000]),
  p('krev', 'Bit revolutions (K-Rev)', 'BHA', 'count', String.raw`k${S}revs?(?:${S}for${S}[^:\n]{1,30})?`, [0, 1e6]),
  // cementing / testing
  p('fcp', 'Final circulating / displacement pressure', 'Cementing', 'pressure', String.raw`fcp|fdp|final${S}(?:circ|disp)\w*${S}press\w*`, [0, 10000]),
  p('icp', 'Initial circulating pressure', 'Cementing', 'pressure', String.raw`icp|initial${S}circ\w*${S}press\w*`, [0, 10000]),
  p('bump_pressure', 'Plug bump pressure', 'Cementing', 'pressure', String.raw`bump(?:ed)?${S}(?:the${S})?plug(?:${S}(?:to|with|at))?`, [0, 15000]),
  p('casing_pressure', 'Casing pressure', 'Cementing', 'pressure', String.raw`csg${S}press(?:ure)?\.?|casing${S}press(?:ure)?`, [0, 15000]),
  p('displacement', 'Displacement volume', 'Cementing', 'volume', String.raw`(?:total${S})?disp(?:lacement)?\.?(?:${S}vol(?:ume)?)?`, [0, 100000]),
  // geometry
  p('hole_size', 'Hole size', 'Geology', 'diameter', String.raw`hole${S}size|bit${S}size|hole${S}section|section${S}size`, [3, 40]),
  p('fm_top', 'Formation top', 'Geology', 'depth', String.raw`(?:formation|fm)${S}top|top${S}of${S}formation`, [0, 45000]),
  p('fm_bottom', 'Formation bottom', 'Geology', 'depth', String.raw`(?:formation|fm)${S}(?:bottom|base)|base${S}of${S}formation`, [0, 45000]),
  p('trip_speed', 'Running / pulling speed', 'Operations', 'speed', String.raw`(?:rih|pooh|running|pulling|tripping|log(?:ging)?(?:${S}(?:up|down))?)${S}speed(?:${S}in${S}(?:ch|oh|cased${S}hole|open${S}hole))?`),
  p('formation_pressure', 'Formation pressure (pretest)', 'Geology', 'pressure', String.raw`f\.p\.?|form\w*${S}press\w*|pore${S}press\w*|res\w*${S}press\w*`, [0, 30000], { amb: true }),
  p('temperature', 'Temperature', 'Geology', 'temperature', String.raw`temp(?:erature)?\.?|bht|bhst|circ\w*${S}temp\w*`, [-50, 400]),
  p('block_weight', 'Block / top drive weight', 'Drilling', 'force', String.raw`(?:tds|top${S}drive|block|travel\w*${S}block)${S}(?:wt|weight)`, [0, 200]),
];
PARAMS.push(
  p('setdown_wt', 'Set-down / slack-off amount', 'Drilling', 'force', String.raw`slack${S}off|set${S}down|s\/o(?=\s+\d)`, [0, 500]),
  p('fluid_density', 'Pumped fluid density (slurry / spacer)', 'Cementing', 'density', String.raw`slurry${S}(?:density|weight)|spacer${S}(?:density|weight)`, [6, 25]),
  p('test_pressure', 'Test pressure', 'Cementing', 'pressure', String.raw`test${S}press(?:ure)?`, [0, 20000]),
  p('tag_weight', 'Tag weight', 'Drilling', 'force', String.raw`tag${S}(?:wt|weight)`, [0, 200]),
);
// labels that may be followed by a few words and "to / at / of" before their value
const CHANGE: [string, string][] = [
  ['rop', String.raw`rop`], ['loss_rate', String.raw`dhl(?:${S}rate)?|loss(?:es)?(?:${S}rate)?`], ['mud_weight', String.raw`m\.?w|mud${S}weight`],
  ['ecd', 'ecd'], ['spp', String.raw`spp|ssp|stand${S}pipe${S}press\w*`], ['flow', String.raw`flow${S}rate|f\.?r`], ['bump_pressure', String.raw`bump(?:ed)?${S}(?:the${S})?plug`],
];
const PARAM: Record<string, Param> = Object.fromEntries(PARAMS.map(x => [x.key, x]));
/** Labels of the special (text / survey) parameters. */
const SPECIAL: Record<string, { label: string; group: string }> = {
  survey_md: { label: 'Survey MD', group: 'Survey' }, survey_tvd: { label: 'Survey TVD', group: 'Survey' }, inc: { label: 'Inclination', group: 'Survey' }, azi: { label: 'Azimuth', group: 'Survey' },
  dls: { label: 'Dogleg severity', group: 'Survey' },
  formation: { label: 'Formation', group: 'Geology' }, fm_top_marker: { label: 'Formation top (marker)', group: 'Geology' }, lithology: { label: 'Lithology', group: 'Geology' },
  dull_grade: { label: 'Bit dull grading', group: 'BHA' }, nozzles: { label: 'Bit nozzles / jets', group: 'BHA' }, serial: { label: 'Serial / part number (identifier)', group: 'Identifiers' },
};
export const paramLabel = (key: string) => PARAM[key]?.label ?? SPECIAL[key]?.label ?? key;
export const paramGroup = (key: string) => PARAM[key]?.group ?? SPECIAL[key]?.group ?? 'Other';
/** Every parameter key the scanner can produce (for the correction menu). */
export const PARAM_KEYS = [...new Set([...PARAMS.filter(x => !x.pair).map(x => x.key), ...Object.keys(SPECIAL)])];
export const paramDim = (key: string): PDim => PARAM[key]?.dim ?? ({ survey_md: 'depth', survey_tvd: 'depth', inc: 'angle', azi: 'angle', dls: 'angle' } as Record<string, PDim>)[key] ?? 'text';

// ------------------------------------------------------------------ units
const U: [RegExp, PDim, string][] = [
  [/^(m|mtrs?|meters?|metres?|mmd|mtvd)$/, 'depth', 'm'], [/^(ft|feet|foot|'|ftmd|fttvd)$/, 'depth', 'ft'],
  [/^(m\/hr?|m\/hour|mph|mtr\/hr)$/, 'rop', 'm/h'], [/^(ft\/hr?|fph|ft\/hour)$/, 'rop', 'ft/h'],
  [/^(tons?|tonnes?|t|mt)$/, 'force', 'tonne'], [/^(klbs?|klbf|kips?|k-?lbs?)$/, 'force', 'klb'], [/^(lbs?|lbf)$/, 'force', 'lb'], [/^kn$/, 'force', 'kN'], [/^kdan$/, 'force', 'kdaN'],
  [/^(kft[.-]?lbs?f?|k\.?ft[.-]?lbs?|klbs?f?[.-]?ft|klbft|klbf[.-]ft|kftlbs?)$/, 'torque', 'kft-lb'], [/^(ft[.-]?lbs?f?|lbs?f?[.-]?ft)$/, 'torque', 'ft-lb'],
  [/^(n[.-]?m|nm)$/, 'torque', 'N-m'], [/^(kn[.-]?m|knm)$/, 'torque', 'kN-m'],
  [/^(psi|psig)$/, 'pressure', 'psi'], [/^(bar|barg)$/, 'pressure', 'bar'], [/^kpa$/, 'pressure', 'kPa'], [/^mpa$/, 'pressure', 'MPa'],
  [/^(lpm|l\/min|lit\/min)$/, 'flow', 'L/min'], [/^(gpm|gal\/min)$/, 'flow', 'gpm'], [/^(bpm|bbl\/min)$/, 'flow', 'bbl/min'], [/^m3\/min$/, 'flow', 'm3/min'],
  [/^(sg|s\.g|g\/cc|g\/cm3)$/, 'density', 'sg'], [/^(ppg|lb\/gal)$/, 'density', 'ppg'], [/^(pcf|lb\/ft3)$/, 'density', 'pcf'], [/^kg\/m3$/, 'density', 'kg/m3'],
  [/^(m3\/hr?|m3\/hour|cum\/hr?)$/, 'lossrate', 'm3/h'], [/^(bbls?\/hr?|bph)$/, 'lossrate', 'bbl/h'],
  [/^(m3|cum)$/, 'volume', 'm3'], [/^(bbls?)$/, 'volume', 'bbl'], [/^(l|ltrs?|litres?|liters?)$/, 'volume', 'L'],
  [/^(hrs?|hours?|h)$/, 'hours', 'h'], [/^(mins?|minutes?)$/, 'minutes', 'min'], [/^(secs?|seconds?|s)$/, 'minutes', 's'],
  [/^(in|inch|inches|")$/, 'diameter', 'in'], [/^mm$/, 'diameter', 'mm'],
  [/^(°|deg|degs|degrees?)$/, 'angle', '°'], [/^%$/, 'percent', '%'],
  [/^(rpm|rev\/min)$/, 'count', 'rpm'], [/^spm$/, 'count', 'spm'], [/^(lb\/100ft2|lbs\/100ft2|lb\/100sqft)$/, 'count', 'lb/100ft2'], [/^(cp|cps)$/, 'count', 'cP'],
  [/^(min\/std|mins?\/stand|jo?i?n?ts?\/min|joint\/min|ft\/min|m\/min)$/, 'speed', ''],
  [/^(°c|degc|deg\.c|c)$/, 'temperature', '°C'], [/^(°f|degf|deg\.f|f)$/, 'temperature', '°F'],
];
/** Recognise a unit token as written ("Ton", "kft.lb.", "KIbf.ft", "m³/hr"). */
export function readUnit(tok: string | null | undefined): { dim: PDim; unit: string } | null {
  if (!tok) return null;
  const s = tok.toLowerCase().replace(/[³]/g, '3').replace(/[²]/g, '2').replace(/[´’`]/g, "'").replace(/[”“]/g, '"').replace(/\s+/g, '').replace(/[.,;:)]+$/, '').replace(/^ki(?=b)/, 'kl');
  for (const [re, dim, unit] of U) if (re.test(s)) return { dim, unit: unit || s };
  return null;
}
const compatible = (pd: PDim, ud: PDim) => pd === ud || (pd === 'hours' && ud === 'minutes') || (pd === 'minutes' && ud === 'hours') || (pd === 'lossrate' && ud === 'flow') || (pd === 'speed' && ud === 'rop');
/** Value in the database unit. Returns null when the dimension has no conversion (text, angle, rpm ...). */
function canonical(v: number, pd: PDim, unit: string | null): { v: number; unit: string } | null {
  if (unit == null) return null;
  if (pd === 'count' || pd === 'angle' || pd === 'percent' || pd === 'speed' || pd === 'temperature') return { v, unit };
  if (pd === 'text') return null;
  const dim = pd as Dim;
  const table = UNITS[dim];
  if (!table) return null;
  let f = table[unit];
  if (f == null && dim === 'hours' && unit === 's') f = 1 / 3600;
  if (f == null && dim === 'minutes' && unit === 'h') f = 60;
  if (f == null && dim === 'lossrate' && UNITS.flow[unit] != null) f = (UNITS.flow[unit] / 42) * 60;   // gpm-family -> bbl/h
  return f == null ? null : { v: v * f, unit: Object.keys(table)[0] };
}
export const CANONICAL_LABEL: Partial<Record<PDim, string>> = { depth: 'ft', rop: 'ft/h', force: 'klb', torque: 'ft-lb', pressure: 'psi', flow: 'gpm', density: 'ppg', diameter: 'in', hours: 'h', minutes: 'min', volume: 'bbl', lossrate: 'bbl/h' };

// ------------------------------------------------------------------ operational context of a line
const CTX: [RegExp, Context][] = [
  [/\b(?:kick|choke|well\s+control|stripping|pit)\s+drills?\b|\bchoke\s+drill/i, 'well control'],
  [/\bscrs?\b|slow\s+(?:circ\w*|pump\w*)\s+rates?/i, 'scr'],
  [/\b(?:back[- ]?ream\w*|ream(?:ed|ing)?|wash(?:ed|ing)?\s+(?:up|down)|wash\s+up|soft\s+back)/i, 'reaming'],
  [/(?<!\b(?:kick|choke|pit|control|stripping|fire|h2s|evacuation|trip|abandon\w*)\s+)\b(?:drill(?:ed|ing)?|drlg|slid(?:e|ing))\b(?!\s+(?:out|pipe|string|collars?|floor|crew|dual|shoe|cement|float|line|bha|drills?))/i, 'drilling'],
  [/\b(?:circ\w*|chc|cbu|swept|sweep|spot(?:ted)?|pump(?:ed|ing)?\s+[^,.]{0,25}(?:pill|sweep|slug|lcm))/i, 'circulating'],
  [/\b(?:pooh|rih|tih|toh|trip(?:ped|ping)?|pull(?:ed|ing)?\s+out|run(?:ning)?\s+in|ran\s+in)\b/i, 'tripping'],
  [/\b(?:p\/t|pressure\s+test\w*|test(?:ed|ing)?|cit|fit|lot|shallow\s+(?:hole\s+)?test)\b/i, 'testing'],
  [/\b(?:cement\w*|cmt|bump\w*|fcp|slurry|spacer|displac\w*)\b/i, 'cementing'],
  [/\b(?:log(?:ging)?|wireline|w\/l)\b/i, 'logging'],
];
/** Context from the last operational verb before position `pos` in the line; null if the line has none. */
export function lineContext(line: string, pos = line.length): Context | null {
  const head = line.slice(0, pos);
  let best: { i: number; c: Context } | null = null;
  for (const [re, c] of CTX) {
    const g = new RegExp(re.source, 'gi');
    for (const m of head.matchAll(g)) if (!best || m.index! > best.i) best = { i: m.index!, c };
  }
  if (best && (best.c === 'tripping' || best.c === 'circulating') && /\b(?:csg|casing|liner)\b/i.test(head)) return 'casing';
  return best?.c ?? null;
}
/** Context implied by an activity / task code such as "Drill to depth" or "Trip out to depth (OH)". */
export function taskContext(task: string | null | undefined): Context {
  const s = (task ?? '').toLowerCase();
  if (!s) return 'general';
  if (/casing|liner|tubing/.test(s)) return 'casing';
  if (/wireline|log/.test(s)) return 'logging';
  if (/cement|woc/.test(s)) return 'cementing';
  if (/ream|wash/.test(s)) return 'reaming';
  if (/drill/.test(s) && !/drill pipe|choke|kick/.test(s)) return 'drilling';
  if (/circ|condition|pump|displace/.test(s)) return 'circulating';
  if (/trip|pull out|run in|rih|pooh/.test(s)) return 'tripping';
  if (/test|cit|fit|lot|sht/.test(s)) return 'testing';
  if (/choke|kick|well control/.test(s)) return 'well control';
  return 'general';
}

// ------------------------------------------------------------------ the scanner
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+`;
const QUAL = String.raw`(?:(daily|total|cum(?:ulative)?|current|last|max(?:imum)?|min(?:imum)?|initial|final|stabili[sz]ed|managed|normal|recorded)\s+)?`;
const SEP = String.raw`(?:[:=]+|-(?=\s*[+~±]?\s*\d)|\bof\b|@|\bis\b|\bwas\b)?`;
const UNIT_TOKEN = String.raw`(?:\s*([A-Za-z°%"'´’”][A-Za-z0-9°%"'\/.\-²³]{0,13}))?`;
const num = (s: string) => Number(s.replace(/,/g, ''));
const clean = (s: string) => s.replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/[³]/g, '3').replace(/[“”]/g, '"').replace(/[´’]/g, "'");
const DEPTH_BEFORE = new RegExp(String.raw`(?:\bat|@)\s*(?:depth\s*:?\s*)?(${NUM})\s*(m|ft|')(?![a-z])[^.;]{0,40}$`, 'i');
const DEPTHS_AFTER = new RegExp(String.raw`^\s*(?:(?:at|@)\s*(?:depth\s*:?\s*)?)((?:(?:${NUM})\s*(?:m|ft|')?\s*(?:,|and|&)?\s*)+)`, 'i');
const depthUnit = (u?: string): 'ft' | 'm' | null => (!u ? null : /^m/i.test(u) ? 'm' : 'ft');

interface Raw { start: number; end: number; key: string; rawLabel: string; qualifier: string | null; text: string; value: number | string; min: number | null; max: number | null; unitRaw: string | null; method: string; sep: boolean; depth: InCellHit['depth']; use?: boolean; notes?: string[]; dimOverride?: PDim }

/**
 * Scan one cell. `defaultContext` is the context of the operation the cell describes (from its task code);
 * a line's own verb ("Ream up ... with FR: 1460 lpm") overrides it.
 */
export function scanCell(rawText: string, sheet: string, cell: string, defaultContext: Context = 'general'): InCellHit[] {
  const text = clean(String(rawText ?? ''));
  if (!/\d/.test(text) && !/formation|fm\b|lith|\bno\s+(dhl|down)/i.test(text)) return [];
  const src = `${sheet}!${cell}`;
  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  const head = lines[0] ? lineContext(lines[0]) : null;
  const cellCtx: Context = head ?? defaultContext;
  const out: InCellHit[] = [];
  for (const line of lines) {
    const raws: Raw[] = [];
    const taken: [number, number][] = [];
    const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
    const take = (r: Raw) => { if (!free(r.start, r.end)) return false; taken.push([r.start, r.end]); raws.push(r); return true; };

    // 1 survey stations / projections: "Last Survey: 577.96 mMD, 577.89 mTVD, inc:2.98°, Azm:145.77°"
    //   "Last Survey @ 1863m MD:1863 m TVD, Inc: 2.53, Azm: 31.85", "Last survey @ 2544.34m . incl: 12.10 , Azimuth : 117.21",
    //   "Last Survey at 3280 m: Inc: 12.06°, Azm: 114.98°, DLS: 0.18 °/30m", "Last Survey: MD= 3631.74m, Inc= 1.69, Azi= 124.12, TVD= 3601.53m"
    const sv = /(last\s+survey|survey(?:\s+(?:at|@))?|projection\s+(?:to|@|at)\s+(?:td|bit|plan)|proj\.?\s+(?:to|@|at)\s+\w+)\s*/i.exec(line);
    if (sv && /\binc/i.test(line.slice(sv.index)) && /\baz/i.test(line.slice(sv.index))) {
      const q = /proj/i.test(sv[1]) ? 'projection' : 'survey', at = sv.index + sv[0].length, rest = line.slice(at);
      const add = (key: string, res: RegExp[], unit?: string) => {
        for (const re of res) {
          const m = re.exec(rest); if (!m) continue;
          const s0 = at + m.index;
          if (take({ start: s0, end: s0 + m[0].length, key, rawLabel: sv[1], qualifier: q, text: m[0].trim(), value: num(m[1]), min: null, max: null, unitRaw: unit ?? m[2] ?? null, method: q === 'projection' ? 'survey projection (not a measured station)' : 'survey statement', sep: true, depth: [] })) return;
        }
      };
      add('survey_md', [new RegExp(String.raw`\bMD\s*[:=]\s*(${NUM})\s*(m|ft)?`, 'i'), new RegExp(String.raw`(${NUM})\s*(m|ft)?\s*MD\b`, 'i'), new RegExp(String.raw`^(?:[:=]\s*)?(?:@|at)\s*(${NUM})\s*(m|ft)?`, 'i')]);
      add('survey_tvd', [new RegExp(String.raw`\bTVD\s*[:=]\s*(${NUM})\s*(m|ft)?`, 'i'), new RegExp(String.raw`(${NUM})\s*(m|ft)?\s*TVD\b`, 'i')]);
      add('inc', [new RegExp(String.raw`\binc\w*\.?\s*[:=]?\s*(${NUM})\s*°?`, 'i')], '°');
      add('azi', [new RegExp(String.raw`\baz\w*\.?\s*[:=]?\s*(${NUM})\s*°?`, 'i')], '°');
      add('dls', [new RegExp(String.raw`\bdls\s*[:=]?\s*(${NUM})`, 'i')], '°');
    }
    // 2 lithology with depth: "Lithology at 280 m: 100 % Sand & Gravel."
    const li = new RegExp(String.raw`(?<![A-Za-z])lith(?:ology)?\.?\s*(?:(?:at|@)\s*(${NUM})\s*(m|ft|')?\s*)?[:=-]\s*(.+?)\s*\.?\s*$`, 'i').exec(line);
    if (li && /[a-z]/i.test(li[3])) {
      const comps = [...li[3].matchAll(/(\d+(?:\.\d+)?)\s*%\s*([A-Za-z][A-Za-z.&\s-]*?)(?=\s*(?:,|;|\.(?=\s|\d|$)|$|\d))/g)].map(m => ({ pct: Number(m[1]), rock: m[2].trim().replace(/\.$/, '') }));
      const sum = comps.reduce((s, c) => s + c.pct, 0);
      const notes = comps.length && Math.abs(sum - 100) > 0.5 ? [`percentages add up to ${sum}%`] : [];
      take({ start: li.index, end: li.index + li[0].length, key: 'lithology', rawLabel: 'Lithology', qualifier: null, text: li[0].trim(), value: comps.length ? comps.map(c => `${c.pct}% ${c.rock}`).join(', ') : li[3].trim(), min: null, max: null, unitRaw: null, method: 'label: text', sep: true, depth: li[1] ? [{ value: num(li[1]), unit: depthUnit(li[2]) }] : [], notes });
    }
    // 3 formation named in the line: "Formation: Dibdibba."
    for (const m of line.matchAll(/(?<![A-Za-z])(?:formation|fmn?)\s*[:=]\s*([A-Za-z][A-Za-z0-9 '\-/.]{1,40}?)\s*(?=\.(?:\s|$)|,|;|\(|$)/gi)) {
      const name = m[1].replace(/\s+(fm|formation)\.?$/i, '').trim();
      if (name) take({ start: m.index!, end: m.index! + m[0].length, key: 'formation', rawLabel: 'Formation', qualifier: null, text: m[0].trim(), value: name, min: null, max: null, unitRaw: null, method: 'label: text', sep: true, depth: [] });
    }
    // 4 formation tops stated at the end of a drilled interval: "(Top of lower Fars)", "(Dammam Fm Top)"
    for (const m of line.matchAll(/\(\s*(?:top\s+of\s+([A-Za-z][\w' \-.]{1,40}?)(?:\s+(?:fm|formation))?|([A-Za-z][\w' \-.]{1,30}?)\s+(?:fm\.?\s+|formation\s+)?top)\s*\)|\btop\s+of\s+([A-Za-z][\w'\-]*(?:\s+[A-Za-z][\w'\-]*){0,2})\s+(?:fm|formation)\b/gi)) {
      const name = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\s+(fm|formation)\.?$/i, '').trim();
      // equipment has tops too ("Top of L. Collar", "top of liner", "top of fish"): those are not formations
      if (!name || /^(hole|the|it|tag)$/i.test(name) || /cement|cmt|collar|\bl\.?\s?c\b|shoe|float|liner|plug|hanger|window|fish|junk|\bbha\b|stand|packer|\bdv\b|tool|string|pipe|casing|csg|stinger|whipstock|sleeve|stage/i.test(name)) continue;
      const before = [...line.slice(0, m.index).matchAll(new RegExp(String.raw`(${NUM})\s*(m|ft|')(?![a-z])`, 'gi'))].pop();
      take({ start: m.index!, end: m.index! + m[0].length, key: 'fm_top_marker', rawLabel: 'Top of', qualifier: null, text: m[0].trim(), value: name, min: null, max: null, unitRaw: null, method: 'formation top marker', sep: true, depth: before ? [{ value: num(before[1]), unit: depthUnit(before[2]) }] : [] });
    }
    // 5 bit dull grading, nozzles, identifiers
    const dg = /(?:bit\s+)?dull(?:\s+grad(?:e|ing))?\s*[:=]?\s*\(?\s*([0-8I]\s*-\s*[0-8I](?:\s*-\s*[A-Z0-9/]{1,4}){6})\s*\)?/i.exec(line);
    if (dg) take({ start: dg.index, end: dg.index + dg[0].length, key: 'dull_grade', rawLabel: 'Dull grading', qualifier: null, text: dg[0].trim(), value: dg[1].replace(/\s+/g, '').toUpperCase(), min: null, max: null, unitRaw: null, method: 'IADC dull grade pattern', sep: true, depth: [] });
    for (const m of line.matchAll(/(?<![A-Za-z])(?:nozzles?(?:\s+size)?|jets)\s*[:=]\s*([^),;]{2,40})/gi)) take({ start: m.index!, end: m.index! + m[0].length, key: 'nozzles', rawLabel: 'Nozzles', qualifier: null, text: m[0].trim().replace(/[.,;]+$/, ''), value: m[1].trim().replace(/[.,;]+$/, ''), min: null, max: null, unitRaw: null, method: 'label: text', sep: true, depth: [] });
    for (const m of line.matchAll(/(?<![A-Za-z])(?:s\s*\/\s*n|s\.n\.?|sn|serial(?:\s+no\.?)?|part\s+no\.?)\s*[:#]\s*(?:(?:s\s*\/\s*n|sn)\s*[:#]\s*)?(?!s\s*\/\s*n\b)([A-Z0-9][A-Z0-9\-/.]{2,25})/gi)) take({ start: m.index!, end: m.index! + m[0].length, key: 'serial', rawLabel: m[0].split(/[:#]/)[0].trim(), qualifier: null, text: m[0].trim(), value: m[1].replace(/[.,]$/, ''), min: null, max: null, unitRaw: null, method: 'identifier (not a drilling parameter)', sep: true, depth: [], use: false });
    // 6 "No DHL", "No downhole losses": a stated absence of losses
    for (const m of line.matchAll(/\bno\s+(?:dhl|d\.h\.l|down\s*hole\s+loss(?:es)?|(?:mud\s+)?loss(?:es)?)\b/gi)) take({ start: m.index!, end: m.index! + m[0].length, key: 'loss_rate', rawLabel: m[0], qualifier: 'none stated', text: m[0], value: 0, min: null, max: null, unitRaw: null, method: 'negative statement', sep: true, depth: [] });

    // 6b slow circulating rates / pump tables: "Pump1 (30-40SPM), 115-140psi", "3 BPM (480 lpm) ---- SPP: 190 psi", "** 4 bpm (636 lpm): 610 psi."
    for (const m of line.matchAll(new RegExp(String.raw`(?<![\w.])(${NUM})(?:\s*-\s*(${NUM}))?\s*(spm|bpm|lpm|gpm)\s*(?:\(\s*(${NUM})\s*(lpm|gpm)\s*\))?\s*\)?\s*[,:_]?\s*(?:-{2,}\s*)?(?:spp\s*:?\s*)?(${NUM})(?:\s*-\s*(${NUM}))?\s*psi\b`, 'gi'))) {
      // a labelled rate ("FR: 1000 lpm, SPP: 330 psi", "with 1400 lpm, SPP ...") is an ordinary parameter list, not a pump table
      if (/(?:f\.?\s?r|flow(?:\s*rate)?|fl|q|with|@|at)\s*[:=]?\s*$/i.test(line.slice(Math.max(0, m.index! - 14), m.index!))) continue;
      // only a pump table: slow circulating rates, a line per pump ("MP#2:", "Pump1"), or a line that starts with the rate
      const lead = line.slice(0, m.index!).replace(/[\s*•\-(]/g, '');
      if (!(/\bscrs?\b|slow\s+circ/i.test(text) || /^(?:m\.?p\.?|pump)\s*#?\s*\d/i.test(lead) || lead === '' || /spm/i.test(m[3]))) continue;
      const rateKey = /spm/i.test(m[3]) ? 'spm' : 'flow', a = num(m[1]), b = m[2] != null ? num(m[2]) : null, pa = num(m[6]), pb = m[7] != null ? num(m[7]) : null;
      const s0 = m.index!, s1 = s0 + m[0].length;
      if (!free(s0, s1)) continue;
      taken.push([s0, s1]);
      const ctx = /\bscrs?\b|slow\s+circ/i.test(text) ? 'scr pump rate' : 'pump rate / pressure step';
      raws.push({ start: s0, end: s1, key: rateKey, rawLabel: m[3], qualifier: ctx, text: m[0].trim(), value: b == null ? a : (a + b) / 2, min: b == null ? null : Math.min(a, b), max: b == null ? null : Math.max(a, b), unitRaw: m[3], method: 'rate / pressure pair', sep: true, depth: [] });
      if (m[4]) raws.push({ start: s0 + 0.25, end: s1, key: 'flow', rawLabel: m[5], qualifier: ctx, text: m[0].trim(), value: num(m[4]), min: null, max: null, unitRaw: m[5], method: 'rate / pressure pair', sep: true, depth: [] });
      raws.push({ start: s0 + 0.5, end: s1, key: 'spp', rawLabel: 'psi', qualifier: ctx.replace('rate', 'pressure'), text: m[0].trim(), value: pb == null ? pa : (pa + pb) / 2, min: pb == null ? null : Math.min(pa, pb), max: pb == null ? null : Math.max(pa, pb), unitRaw: 'psi', method: 'rate / pressure pair', sep: true, depth: [] });
    }
    // 6c off-bottom torque at a given RPM: "** 10 RPM: 8 KIb.ft."
    for (const m of line.matchAll(new RegExp(String.raw`(?<![\w.])(${NUM})\s*rpm\s*[:=]\s*(${NUM})\s*([A-Za-z][A-Za-z.\-]{1,10})`, 'gi'))) {
      if (readUnit(m[3])?.dim !== 'torque') continue;
      const s0 = m.index!, s1 = s0 + m[0].length;
      if (!free(s0, s1)) continue;
      taken.push([s0, s1]);
      raws.push({ start: s0, end: s1, key: 'rpm', rawLabel: 'RPM', qualifier: 'torque test', text: m[0].trim(), value: num(m[1]), min: null, max: null, unitRaw: 'rpm', method: 'rpm / torque pair', sep: true, depth: [] });
      raws.push({ start: s0 + 0.5, end: s1, key: 'torque', rawLabel: m[3], qualifier: 'torque test', text: m[0].trim(), value: num(m[2]), min: null, max: null, unitRaw: m[3], method: 'rpm / torque pair', sep: true, depth: [] });
    }
    // 6d fluids pumped with their density: "601.0 bbl of 1.50 SG lead slurry", "displace well with 1.12 SG mud", "Max density 1.36 sg"
    for (const m of line.matchAll(new RegExp(String.raw`(?<![\w.])(${NUM})\s*(sg|s\.g|ppg)\b\.?\s*(?:\(\s*${NUM}\s*ppg\s*\)\s*)?((?:[A-Za-z#-]+\s+){0,4}?)(mud|slurry|spacer|scavenger|pill|brine|cement|cmt|water)\b`, 'gi'))) {
      const s0 = m.index!, s1 = s0 + m[0].length;
      if (!free(s0, s1)) continue;
      taken.push([s0, s1]);
      const fluid = `${m[3]}${m[4]}`.trim().toLowerCase(), isMud = /^(mud|brine)$/.test(m[4].toLowerCase()) && !/spacer|contaminat/.test(fluid);
      raws.push({ start: s0, end: s1, key: isMud ? 'mud_weight' : 'fluid_density', rawLabel: fluid, qualifier: isMud ? 'pumped / displaced' : fluid, text: m[0].trim(), value: num(m[1]), min: null, max: null, unitRaw: m[2], method: 'value unit fluid', sep: true, depth: [] });
    }
    // the fluid named before its density: "Displace hole to mud 1.10 SG", "Displace well W/ 1.19 SG", "slug pipe with 9 m3 of 1.52 SG"
    for (const m of line.matchAll(new RegExp(String.raw`(?<![A-Za-z])(displac\w*|mud|slug\w*|pill|spacer|slurry|brine|cement|cmt)\b((?:\s+(?:hole|well|pipe|to|with|w\/|new|of|the|by|\d[\d.]*\s*(?:m3|bbls?)))*?)\s*(?:wt\.?|weight|density)?\s*[:=]?\s*(${NUM})\s*(sg|s\.g|ppg)\b`, 'gi'))) {
      const s0 = m.index!, s1 = s0 + m[0].length;
      if (!free(s0, s1)) continue;
      taken.push([s0, s1]);
      const w = m[1].toLowerCase(), isMud = /^(displac|mud|brine)/.test(w);
      raws.push({ start: s0, end: s1, key: isMud ? 'mud_weight' : 'fluid_density', rawLabel: m[1], qualifier: isMud ? 'pumped / displaced' : w.replace(/ging$|ged$/, ''), text: m[0].trim(), value: num(m[3]), min: null, max: null, unitRaw: m[4], method: 'fluid value unit', sep: true, depth: [] });
    }
    for (const m of line.matchAll(new RegExp(String.raw`(?<![A-Za-z])(max(?:imum)?\.?\s+(?:density|wt\.?|weight))\s*[:=]?\s*(${NUM})\s*(sg|ppg)\b`, 'gi'))) {
      const s0 = m.index!, s1 = s0 + m[0].length;
      if (!free(s0, s1)) continue;
      taken.push([s0, s1]);
      raws.push({ start: s0, end: s1, key: 'fluid_density', rawLabel: m[1], qualifier: 'maximum (returns)', text: m[0].trim(), value: num(m[2]), min: null, max: null, unitRaw: m[3], method: 'label: value', sep: true, depth: [] });
    }
    // 6e pressure tests: "P/T 18-5/8" CSG to 700 psi for 15 min", "Pressure tested to 500 / 7500 psi for 5/10 min"
    for (const m of line.matchAll(new RegExp(String.raw`(?<![A-Za-z])(p\/t|pressure\s+test(?:ed)?|tested|test(?:ed)?)\b([^.;]{0,70}?)\bto\s+(${NUM})(?:\s*\/\s*(${NUM}))?\s*psi\b(?:\s*(?:for|\/)\s*(${NUM})(?:\s*\/\s*${NUM})?\s*min)?`, 'gi'))) {
      const s0 = m.index!, s1 = s0 + m[0].length;
      if (!free(s0, s1)) continue;
      taken.push([s0, s1]);
      const what = m[2].trim().replace(/\s+/g, ' ') || null;
      if (m[4]) raws.push({ start: s0, end: s1, key: 'test_pressure', rawLabel: m[1], qualifier: `low${what ? ' - ' + what : ''}`, text: m[0].trim(), value: num(m[3]), min: null, max: null, unitRaw: 'psi', method: 'pressure test statement', sep: true, depth: [] });
      raws.push({ start: s0 + 0.5, end: s1, key: 'test_pressure', rawLabel: m[1], qualifier: `${m[4] ? 'high' : 'test'}${what ? ' - ' + what : ''}`, text: m[0].trim(), value: num(m[4] ?? m[3]), min: null, max: null, unitRaw: 'psi', method: 'pressure test statement', sep: true, depth: [], notes: m[5] ? [`held ${m[5]} min`] : [] });
    }
    // 6f weight used to confirm cement: "Confirmed TOC with 5 Ton"
    for (const m of line.matchAll(new RegExp(String.raw`(?<![A-Za-z])((?:confirm(?:ed)?)\s+(?:toc|top\s+of\s+cement|cement))(?:\s+(?:at|@)\s*(${NUM})\s*(m|ft|'))?\s+(?:with|w\/)\s*(${NUM})\s*(tons?|tonnes?|klbs?|t)\b`, 'gi'))) {
      const s0 = m.index!, s1 = s0 + m[0].length;
      if (!free(s0, s1)) continue;
      taken.push([s0, s1]);
      raws.push({ start: s0, end: s1, key: 'tag_weight', rawLabel: m[1], qualifier: 'cement tag', text: m[0].trim(), value: num(m[4]), min: null, max: null, unitRaw: m[5], method: 'value unit statement', sep: true, depth: m[2] ? [{ value: num(m[2]), unit: depthUnit(m[3]) }] : [] });
      if (m[2]) raws.push({ start: s0 + 0.5, end: s1, key: 'toc', rawLabel: m[1], qualifier: 'tagged', text: m[0].trim(), value: num(m[2]), min: null, max: null, unitRaw: m[3], method: 'value unit statement', sep: true, depth: [] });
    }

    // 6g weights stated before the word: "10 ton overpull", "+ 15 tons Overpull @ 3600 m", "15 ton S/O at depth: 58 m"
    for (const m of line.matchAll(new RegExp(String.raw`(?<![\d.])(${NUM})\s*(tons?|tonnes?|klbs?|t)\s+(?:of\s+)?(over\s*pull|o\/p|s\/o|set\s*down|drag)\b`, 'gi'))) {
      const key = /s\/o|set|drag/i.test(m[3]) ? 'setdown_wt' : 'overpull';
      take({ start: m.index!, end: m.index! + m[0].length, key, rawLabel: m[3], qualifier: null, text: m[0], value: num(m[1]), min: null, max: null, unitRaw: m[2], method: 'value unit label', sep: true, depth: [] });
    }
    // 6h tight spots with the weight it took: "Observed tight spot on 464 m, 367 m, 362 m with 15 tons"
    for (const m of line.matchAll(new RegExp(String.raw`(?<![A-Za-z])(tight\s+(?:spots?|hole|pull)|over\s*pull|drag)\b((?:\s+(?:on|at|@)\s*|\s*,\s*)(?:${NUM})\s*(?:m|ft|')?(?:\s*(?:,|and|&)\s*(?:${NUM})\s*(?:m|ft|')?)*)?[^.;]{0,30}?\bwith\s+(\+\/-|±|~)?\s*(${NUM})(?:\s*-\s*(${NUM}))?\s*(tons?|tonnes?|klbs?|t)\b`, 'gi'))) {
      const a = num(m[4]), b = m[5] != null ? num(m[5]) : null;
      const depths = m[2] ? [...m[2].matchAll(new RegExp(String.raw`(${NUM})\s*(m|ft|')?`, 'g'))].map(x => ({ value: num(x[1]), unit: depthUnit(x[2]) ?? depthUnit(/(m|ft)\b/.exec(m[2]!)?.[1]) })) : [];
      take({ start: m.index!, end: m.index! + m[0].length, key: 'overpull', rawLabel: m[1], qualifier: /drag/i.test(m[1]) ? 'drag' : 'tight spot', text: m[0].trim(), value: b == null ? a : (a + b) / 2, min: b == null ? null : Math.min(a, b), max: b == null ? null : Math.max(a, b), unitRaw: m[6], method: 'statement with depths', sep: true, depth: depths });
    }
    // 6i losses with a rate later in the sentence: "DHL started from 688 m to 716 m with rate= 5 m3/hr", "DHL rat= 5 m3/hr"
    for (const m of line.matchAll(new RegExp(String.raw`(?<![A-Za-z])(dhl|d\.h\.l|(?:down\s*hole\s+)?loss(?:es)?)\b([^.;]{0,70}?)\brat(?:e)?\s*[:=]?\s*(\+\/-|±|~)?\s*(${NUM})(?:\s*(?:-|–|to)\s*(${NUM}))?\s*(m3\/hr?|m³\/hr?|bbls?\/hr?|bph)`, 'gi'))) {
      const a = num(m[4]), b = m[5] != null ? num(m[5]) : null;
      const iv = new RegExp(String.raw`from\s*(${NUM})\s*(m|ft|')?(?:\s*to\s*(${NUM})\s*(m|ft|')?)?`, 'i').exec(m[2]);
      take({ start: m.index!, end: m.index! + m[0].length, key: 'loss_rate', rawLabel: m[1], qualifier: /increas/i.test(m[2]) ? 'increased' : /decreas|reduc/i.test(m[2]) ? 'decreased' : /start/i.test(m[2]) ? 'started' : null, text: m[0].trim(), value: b == null ? a : (a + b) / 2, min: b == null ? null : Math.min(a, b), max: b == null ? null : Math.max(a, b), unitRaw: m[6], method: 'statement with rate', sep: true,
        depth: iv ? [{ value: num(iv[1]), unit: depthUnit(iv[2] ?? iv[4]) }, ...(iv[3] ? [{ value: num(iv[3]), unit: depthUnit(iv[4] ?? iv[2]) }] : [])] : [] });
    }
    // 6j weight used to tag something: "Tag L.C Twice @ 3610 m with 4-5 Ton", "Confirm Tag TOC at 596 m W/ 5 Ton"
    for (const m of line.matchAll(new RegExp(String.raw`(?<![A-Za-z])((?:confirm(?:ed)?\s+)?tag(?:ged)?\s+(?:the\s+)?(toc|top\s+of\s+cement|cement|l\.?\s?c\.?|landing\s+collar|float\s+collar|f\.?\s?c\.?|shoe|plug|fish|bottom|btm|td)(?:\s+twice)?)(?:\s+(?:at|@|on)\s*(${NUM})\s*(m|ft|'))?\s+(?:with|w\/)\s*(${NUM})(?:\s*-\s*(${NUM}))?\s*(tons?|tonnes?|klbs?|t)\b`, 'gi'))) {
      if (!free(m.index!, m.index! + m[0].length)) continue;
      const a = num(m[5]), b = m[6] != null ? num(m[6]) : null, what = m[2].toLowerCase();
      take({ start: m.index!, end: m.index! + m[0].length, key: 'tag_weight', rawLabel: m[1], qualifier: `tag ${what}`, text: m[0].trim(), value: b == null ? a : (a + b) / 2, min: b == null ? null : Math.min(a, b), max: b == null ? null : Math.max(a, b), unitRaw: m[7], method: 'value unit statement', sep: true, depth: m[3] ? [{ value: num(m[3]), unit: depthUnit(m[4]) }] : [] });
      if (m[3] && /toc|cement/.test(what)) raws.push({ start: m.index! + 0.5, end: m.index! + m[0].length, key: 'toc', rawLabel: m[1], qualifier: 'tagged', text: m[0].trim(), value: num(m[3]), min: null, max: null, unitRaw: m[4], method: 'value unit statement', sep: true, depth: [] });
    }

    // 7 labelled numeric parameters (all labels at once; the longest match wins an overlap)
    const cands: (Raw & { labelLen: number })[] = [];
    for (const par of PARAMS) {
      // label, optional "off/on bottom" qualifier, optional (unit) or (condition), separator, value / range / pair, unit
      const re = new RegExp(String.raw`(?<![A-Za-z0-9])${QUAL}(${par.re})(?![A-Za-z])(?:\s+(?:off\s*\/\s*on|on\s*\/\s*off|off|on)[\s-]*(?:bottom|btm)|\s+up\s*\/\s*down)?\s*(?:[(\[]\s*([^)\]]{1,40}?)\s*[)\]])?\s*(${SEP})\s*` +
        (par.pair ? String.raw`(?:(${NUM})\s*\/\s*(${NUM})|([+~±]|\+\/-)?\s*(${NUM})(?:\s*(?:-|–|to|~)\s*(${NUM})(?![\d\/]))?)` : String.raw`(?:)()()([+~±]|\+\/-)?\s*(${NUM})(?:\s*(?:-|–|to|~)\s*(${NUM})(?![\d\/]))?`) + UNIT_TOKEN, 'gi');
      for (const m of line.matchAll(re)) {
        const [all, qual, label, bracket, sep, pa, pb, , v1, v2, unitTok] = m;
        const hdrUnit = bracket && readUnit(bracket) ? bracket : undefined;
        const tokUnit = unitTok ? readUnit(unitTok) : null;
        const fits = (u: { dim: PDim } | null) => !!u && compatible(par.dim, u.dim);
        // "fl 12" without ':' is too weak - unless a fitting unit follows ("F.P 3457 psi")
        if (!sep && !hdrUnit && /^[a-z]{1,2}$/i.test(label.replace(/[\s._-]/g, '')) && !fits(tokUnit)) continue;
        // "with 15 RPM 1 single": the word is the unit of the number before it, not a label for the number after it
        if (!sep && /(?:^|[^\w.,])\d+(?:[.,]\d+)?\s*$/.test(line.slice(Math.max(0, m.index! - 12), m.index!))) continue;
        // "Overpull @ 3600 m": "@" introduces where it happened, not the value
        if (sep === '@' && tokUnit && !compatible(par.dim, tokUnit.dim)) continue;
        let unitRaw: string | null = hdrUnit ?? null, textAll = all;
        const condition = bracket && !hdrUnit ? bracket.trim() : null;
        if (unitTok) {
          if (readUnit(unitTok)) unitRaw = unitTok.replace(/[.,;:]+$/, '');
          else textAll = all.slice(0, all.length - unitTok.length).replace(/\s+$/, '');   // the next word is not a unit: leave it for the next label
        }
        const end = m.index! + textAll.length;
        const base = { start: m.index!, end, rawLabel: label, qualifier: qual?.toLowerCase() ?? (/^[^:=]*\bup\s*\/\s*down\b/i.test(all.slice(label.length)) && par.key !== 'updown' ? 'up/down (reciprocating)' : /off\s*\/\s*on|on\s*\/\s*off/i.test(all) ? 'off/on bottom' : /\boff[\s-]*(bottom|btm)/i.test(all) ? 'off bottom' : /\bon[\s-]*(bottom|btm)/i.test(all.slice(label.length)) ? 'on bottom' : null),
          text: textAll.trim(), unitRaw, sep: !!sep || hdrUnit != null, depth: [] as InCellHit['depth'], labelLen: label.length + (qual?.length ?? 0), notes: condition ? [`measured with: ${condition}`] : [] };
        if (par.pair && pa != null) {
          // two values: in / out, up / down - one hit each, both covering the same text
          cands.push({ ...base, key: par.pair[0], value: num(pa), min: null, max: null, method: 'label: value/value', notes: [...base.notes, `first of two values (${par.label})`] });
          cands.push({ ...base, key: par.pair[1], value: num(pb), min: null, max: null, method: 'label: value/value', notes: [...base.notes, `second of two values (${par.label})`], start: base.start + 0.5 });
        } else if (v1 != null) {
          const a = num(v1), b = v2 != null ? num(v2) : null;
          const key = par.pair ? par.pair[0] : par.key;
          const lo = b == null ? null : Math.min(a, b), hi = b == null ? null : Math.max(a, b);
          cands.push({ ...base, key, qualifier: par.pair && par.key === 'mw_inout' ? 'in/out' : base.qualifier, value: b == null ? a : (a + b) / 2, min: lo, max: hi, method: b == null ? (sep ? 'label: value' : 'label value') : 'label: range' });
        }
      }
    }
    cands.sort((a, b) => b.end - b.start - (a.end - a.start) || b.labelLen - a.labelLen || a.start - b.start);
    const pairTaken = new Set<number>();
    for (const c of cands) {
      if (c.start % 1) { if (pairTaken.has(Math.floor(c.start))) raws.push({ ...c, start: Math.floor(c.start) }); continue; }   // second value of an accepted pair
      if (take(c)) pairTaken.add(c.start);
    }
    // 8a ROP written after its value: "drilling with +/- 1 m/h ROP"
    for (const m of line.matchAll(new RegExp(String.raw`(\+\/-|±|~)?\s*(?<![\w.])(${NUM})\s*(m\/hr?|ft\/hr?|fph)\s+rop\b`, 'gi')))
      take({ start: m.index!, end: m.index! + m[0].length, key: 'rop', rawLabel: 'ROP', qualifier: null, text: m[0].trim(), value: num(m[2]), min: null, max: null, unitRaw: m[3], method: 'value unit label', sep: true, depth: [] });
    // 8b a parameter followed by a change: "ROP decreased to 0.8 m/h", "increased MW to 1.25 sg", "DHL rate reduce to 8 -10 m3/hr",
    //    "Losses rate remained constant at 3-4m3/hr", "Bumped plug and closed DV to 1700 psi". The unit must be written.
    for (const [key, re] of CHANGE) {
      // optional "from X unit" before "to": "MW increased gradually from 1.25 SG to 1.28 SG", "SSP increase from 440 psi to 650 psi"
      for (const m of line.matchAll(new RegExp(String.raw`(?<![A-Za-z0-9])(${re})(?![A-Za-z])((?:\s+[A-Za-z/&]+){0,5}?)(?:\s+from\s*(${NUM})\s*[A-Za-z°%][A-Za-z0-9\/.\-³]{0,10})?\s+(?:to|at|of|by)\s*(\+\/-|±|~)?\s*(${NUM})(?:\s*(?:-|–)\s*(${NUM}))?\s*([A-Za-z°%][A-Za-z0-9\/.\-³]{0,10})`, 'gi'))) {
        const u = readUnit(m[7]);
        if (!u || !compatible(paramDim(key), u.dim)) continue;
        const a = num(m[5]), b = m[6] != null ? num(m[6]) : null;
        take({ start: m.index!, end: m.index! + m[0].length, key, rawLabel: m[1], qualifier: m[2].trim().toLowerCase() || null, text: m[0].trim(), value: b == null ? a : (a + b) / 2, min: b == null ? null : Math.min(a, b), max: b == null ? null : Math.max(a, b), unitRaw: m[7].replace(/[.,;:]+$/, ''), method: 'label … to value (narrative)', sep: true, depth: [],
          notes: ['value stated in a sentence (e.g. after a change), not in a parameter list', ...(m[3] ? [`changed from ${m[3]}`] : [])] });
      }
    }
    // 8c a change of the value stated earlier in the same line: "losses rate:10 m3/hr, started LCM, gradually decreased to 2 m3/hr"
    for (const m of line.matchAll(new RegExp(String.raw`\b(decreas\w*|increas\w*|reduc\w*|dropp?\w*|remain\w*|stabili[sz]\w*|rais\w*|lower\w*)\s+(?:[A-Za-z]+\s+){0,2}?(?:to|at)\s*(\+\/-|±|~)?\s*(${NUM})(?:\s*(?:-|–)\s*(${NUM}))?\s*([A-Za-z°%][A-Za-z0-9\/.\-³]{0,10})`, 'gi'))) {
      const u = readUnit(m[5]);
      if (!u || !free(m.index!, m.index! + m[0].length)) continue;
      const prev = [...raws].filter(r => r.start < m.index! && typeof r.value === 'number' && compatible(paramDim(r.key), u.dim)).sort((a, b) => b.start - a.start)[0];
      if (!prev) continue;
      const a = num(m[3]), b = m[4] != null ? num(m[4]) : null;
      take({ start: m.index!, end: m.index! + m[0].length, key: prev.key, rawLabel: prev.rawLabel, qualifier: m[1].toLowerCase().replace(/(ed|ing|s)$/, 'ed').replace(/eed$/, 'ed'), text: m[0].trim(), value: b == null ? a : (a + b) / 2, min: b == null ? null : Math.min(a, b), max: b == null ? null : Math.max(a, b), unitRaw: m[5].replace(/[.,;:]+$/, ''), method: 'continuation of the value stated before', sep: true, depth: [], notes: [`refers to "${prev.text}" earlier in the line`] });
    }
    // 9 unlabelled values with an unmistakable unit: "with 1600 lpm", "with 100 RPM", "@ 5-6 bpm"
    for (const m of line.matchAll(new RegExp(String.raw`(?<![\w.\/])(${NUM})(?:\s*-\s*(${NUM}))?\s*(lpm|gpm|l\/min|bpm|bbl\/min|rpm)\b(?:\s*(?:and|&|,|:)\s*(${NUM})(?:\s*-\s*(${NUM}))?\s*psi\b)?`, 'gi'))) {
      const a = num(m[1]), b = m[2] != null ? num(m[2]) : null;
      const s1 = m[4] != null ? m.index! + m[0].length : m.index! + m[0].length;
      if (!take({ start: m.index!, end: s1, key: /rpm/i.test(m[3]) ? 'rpm' : 'flow', rawLabel: '', qualifier: null, text: m[0].trim(), value: b == null ? a : (a + b) / 2, min: b == null ? null : Math.min(a, b), max: b == null ? null : Math.max(a, b), unitRaw: m[3], method: 'unit only (no label)', sep: false, depth: [] })) continue;
      // "at 1130 lpm and 1350-1450 psi": the pressure that goes with that rate
      if (m[4] != null) { const pa = num(m[4]), pb = m[5] != null ? num(m[5]) : null; raws.push({ start: m.index! + 0.5, end: s1, key: 'spp', rawLabel: '', qualifier: null, text: m[0].trim(), value: pb == null ? pa : (pa + pb) / 2, min: pb == null ? null : Math.min(pa, pb), max: pb == null ? null : Math.max(pa, pb), unitRaw: 'psi', method: 'unit only (no label)', sep: false, depth: [] }); }
    }

    // depth references and context
    raws.sort((a, b) => a.start - b.start);
    for (const r of raws) {
      if (!r.depth.length) {
        const before = DEPTH_BEFORE.exec(line.slice(Math.max(0, r.start - 70), r.start));
        if (before && r.key !== 'formation' && r.key !== 'fm_top_marker' && !r.key.startsWith('survey') && r.key !== 'inc' && r.key !== 'azi') r.depth = [{ value: num(before[1]), unit: depthUnit(before[2]) }];
        const after = DEPTHS_AFTER.exec(line.slice(r.end));
        if (after && (r.key === 'overpull' || r.key === 'setdown_wt' || r.key === 'loss_rate')) r.depth = [...after[1].matchAll(new RegExp(String.raw`(${NUM})\s*(m|ft|')?`, 'gi'))].map(x => ({ value: num(x[1]), unit: depthUnit(x[2]) ?? depthUnit(/(m|ft)\s*$/i.exec(after[1])?.[1]) }));
      }
      const ctx = lineContext(line, r.start) ?? cellCtx;
      const k = out.length;
      out.push(makeHit(r, line, ctx, sheet, cell, src, `${src}#${k}`));
    }
  }
  return out;
}

function makeHit(r: Raw, line: string, context: Context, sheet: string, cell: string, src: string, id: string): InCellHit {
  const par = PARAM[r.key], dim = r.dimOverride ?? paramDim(r.key);
  const hit: InCellHit = {
    id, key: r.key, label: paramLabel(r.key), group: paramGroup(r.key), qualifier: r.qualifier, rawLabel: r.rawLabel, text: r.text, line, value: r.value, min: r.min, max: r.max,
    unitRaw: r.unitRaw, unit: null, unitBasis: 'none', canonical: null, canonicalUnit: null, depth: r.depth, context, sheet, cell, src,
    confidence: 0.95, method: r.method, status: 'confirmed', notes: [...(r.notes ?? [])], use: r.use ?? true, span: [Math.floor(r.start), r.end],
  };
  if (dim === 'text' || typeof r.value === 'string') { hit.confidence = r.use === false ? 0.9 : 0.93; return hit; }
  const u = readUnit(r.unitRaw);
  if (u) {
    if (!compatible(dim, u.dim) && !(dim === 'lossrate' && u.dim === 'volume')) {
      hit.unit = u.unit; hit.unitBasis = 'written'; hit.status = 'suspected'; hit.confidence = 0.3;
      hit.notes.push(`unit "${r.unitRaw}" does not fit ${hit.label}`);
      return hit;
    }
    if (dim === 'lossrate' && u.dim === 'volume') { hit.key = 'loss_volume'; hit.label = paramLabel('loss_volume'); }
    hit.unit = u.unit; hit.unitBasis = 'written';
  }
  if (r.method === 'unit only (no label)') hit.confidence = 0.72;
  else if (!r.sep) hit.confidence -= 0.04;
  if (par?.amb) hit.confidence -= 0.02;
  if (r.min != null) { hit.status = 'inferred'; hit.notes.push(`range ${fmtN(r.min)}–${fmtN(r.max!)} reported; midpoint used`); }
  if (r.method.startsWith('survey projection')) { hit.status = 'inferred'; hit.notes.push('projection, not a measured survey station'); }
  if (r.method === 'negative statement') { hit.unitBasis = 'none'; hit.canonical = 0; hit.canonicalUnit = 'bbl/h'; hit.notes.push('the report states that there were no downhole losses'); }
  return hit;
}
const fmtN = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * Second pass over all hits of a report: fill units that are not written (from the unit the same report uses for
 * that parameter, then from the value range, then the default), convert to database units and check ranges.
 */
export function finalizeHits(hits: InCellHit[], reportDepthUnit: 'ft' | 'm'): void {
  const usage = new Map<string, Map<string, number>>();
  const dimUsage = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, k: string, u: string) => { const x = m.get(k) ?? new Map<string, number>(); x.set(u, (x.get(u) ?? 0) + 1); m.set(k, x); };
  for (const h of hits) if (h.unit && h.unitBasis === 'written') { bump(usage, h.key, h.unit); bump(dimUsage, String(paramDim(h.key)), h.unit); }
  const top = (m: Map<string, number> | undefined) => (m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null);
  for (const h of hits) {
    const dim = paramDim(h.key);
    if (typeof h.value !== 'number' || dim === 'text' || h.status === 'suspected' && h.unitBasis === 'written' && h.confidence <= 0.3) continue;
    if (h.method === 'negative statement') continue;
    if (!h.unit && (dim === 'count' || dim === 'angle' || dim === 'percent' || dim === 'speed' || dim === 'temperature')) {
      h.unit = dim === 'angle' ? '°' : dim === 'percent' ? '%' : /^rpm/.test(h.key) ? 'rpm' : h.key === 'spm' ? 'spm' : '';   // implied by the parameter name
    } else if (!h.unit) {
      const fromKey = top(usage.get(h.key)), fromDim = top(dimUsage.get(String(dim)));
      let u: string | null = null;
      if (fromKey) { u = fromKey; h.unitBasis = 'report'; h.confidence -= 0.08; h.notes.push(`unit not written; ${u} assumed (the unit this report uses for ${h.label})`); }
      else if (dim === 'density') { u = h.value < 3 ? 'sg' : h.value <= 25 ? 'ppg' : null; if (u) { h.unitBasis = 'range'; h.confidence -= 0.12; h.notes.push(`unit not written; ${u} assumed from the value`); } }
      else if (dim === 'depth' || dim === 'rop') { u = dim === 'depth' ? reportDepthUnit : reportDepthUnit === 'm' ? 'm/h' : 'ft/h'; h.unitBasis = 'default'; h.confidence -= 0.15; h.notes.push(`unit not written; ${u} assumed from the report's depth unit`); }
      else if (fromDim) { u = fromDim; h.unitBasis = 'report'; h.confidence -= 0.1; h.notes.push(`unit not written; ${u} assumed (the unit this report uses for this kind of value)`); }
      else { const d = dim as Dim; u = UNITS[d] ? Object.keys(UNITS[d])[0] : null; if (u) { h.unitBasis = 'default'; h.confidence -= 0.2; h.notes.push(`unit not written; ${u} assumed`); } }
      h.unit = u;
      if (h.status === 'confirmed' && u) h.status = 'inferred';
    }
    const c = canonical(h.value, dim, h.unit);
    if (c) { h.canonical = Math.round(c.v * 10000) / 10000; h.canonicalUnit = c.unit; }
    const range = PARAM[h.key]?.range ?? (h.key === 'inc' ? [0, 180] as [number, number] : h.key === 'azi' ? [0, 360] as [number, number] : h.key.startsWith('survey') ? [0, 45000] as [number, number] : undefined);
    if (range && h.canonical != null && (h.canonical < range[0] || h.canonical > range[1])) {
      h.status = 'suspected'; h.confidence = Math.min(h.confidence, 0.4);
      h.notes.push(`outside the plausible range for ${h.label} (${range[0]}–${range[1]} ${h.canonicalUnit ?? ''}) - check the source`);
    }
    h.confidence = Math.max(0.05, Math.round(h.confidence * 100) / 100);
  }
  // survey: TVD can never exceed MD at the same station
  const bySrcLine = new Map<string, InCellHit[]>();
  for (const h of hits) if (h.key === 'survey_md' || h.key === 'survey_tvd') { const k = `${h.src}|${h.line}`; bySrcLine.set(k, [...(bySrcLine.get(k) ?? []), h]); }
  for (const g of bySrcLine.values()) {
    const md = g.find(x => x.key === 'survey_md'), tvd = g.find(x => x.key === 'survey_tvd');
    if (md?.canonical != null && tvd?.canonical != null && tvd.canonical > md.canonical * 1.001) { tvd.status = 'suspected'; tvd.confidence = 0.3; tvd.notes.push(`TVD (${tvd.value}) is greater than MD (${md.value}) - probably a typing error in the report`); }
  }
}

/** Apply engineer corrections to scanned hits (by id). */
export function applyCorrections(hits: InCellHit[], corrections: Record<string, Correction> | undefined, reportDepthUnit: 'ft' | 'm'): void {
  if (!corrections) return;
  for (const h of hits) {
    const c = corrections[h.id];
    if (!c) continue;
    h.original = { key: h.key, value: h.value };
    if (c.reject) { h.status = 'rejected'; h.review = 'rejected'; h.use = false; h.notes.push('rejected by the engineer'); continue; }
    if (c.key && c.key !== h.key) { h.key = c.key; h.label = paramLabel(c.key); h.group = paramGroup(c.key); }
    if (c.value != null && c.value !== '' && c.value !== h.value) {
      const n = typeof c.value === 'number' ? c.value : Number(String(c.value).replace(/,/g, ''));
      h.value = typeof h.value === 'number' && isFinite(n) ? n : String(c.value); h.min = null; h.max = null;
    }
    const dim = paramDim(h.key);
    if (typeof h.value === 'number' && dim !== 'text') {
      if (h.unit && !compatible(dim, readUnit(h.unit)?.dim ?? (dim as PDim)) && !(UNITS[dim as Dim]?.[h.unit] != null)) h.unit = null;
      if (!h.unit) h.unit = dim === 'depth' ? reportDepthUnit : UNITS[dim as Dim] ? Object.keys(UNITS[dim as Dim])[0] : null;
      const cv = canonical(h.value, dim, h.unit);
      h.canonical = cv ? Math.round(cv.v * 10000) / 10000 : null; h.canonicalUnit = cv?.unit ?? null;
    }
    h.status = 'confirmed'; h.confidence = 1; h.review = c.key || c.value != null ? 'corrected' : 'confirmed';
    h.notes = h.notes.filter(n => !/outside the plausible|does not fit/.test(n));
    h.notes.push(h.review === 'corrected' ? 'corrected by the engineer' : 'confirmed by the engineer');
  }
}

// ------------------------------------------------------------------ coverage: numbers the scanner did not explain
const PARAM_UNIT = /^(psi|psig|bar|kpa|lpm|gpm|l\/min|bpm|tons?|tonnes?|klbs?|klbf|rpm|spm|sg|ppg|m\/hr?|ft\/hr?|kft\.?-?lbs?|klbs?f?\.?-?ft|m3\/hr?|bbls?\/hr?)$/i;
/**
 * Numbers followed by a drilling-parameter unit that no hit and no depth interval accounts for. These are the
 * candidates for parameters the reader may have missed, listed for review instead of being silently dropped.
 */
export function unexplainedNumbers(rawText: string, hits: InCellHit[]): { text: string; unit: string; line: string }[] {
  const out: { text: string; unit: string; line: string }[] = [];
  const text = clean(String(rawText ?? ''));
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    const spans = hits.filter(h => h.line === line).map(h => h.span);
    for (const m of line.matchAll(new RegExp(String.raw`(?<![\w.\/])(${NUM})(?:\s*(?:-|–|to)\s*(?:${NUM}))?\s*([A-Za-z][A-Za-z0-9.\/\-³]{0,10})`, 'gi'))) {
      const unit = m[2].replace(/[.,;:)]+$/, '');
      if (!PARAM_UNIT.test(unit)) continue;
      if (spans.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
      out.push({ text: m[0].trim(), unit, line });
    }
  }
  return out;
}
