// Unit handling. Canonical storage units: ft, ft/h, klb, ft-lb, psi, gpm, ppg, in, h, min.

export const FT_PER_M = 3.280839895;

export type Dim = 'depth' | 'rop' | 'force' | 'torque' | 'pressure' | 'flow' | 'density' | 'diameter' | 'hours' | 'minutes' | 'volume' | 'lossrate' | 'none';

/** Multipliers converting a source unit to the canonical unit of its dimension. First key = canonical. */
export const UNITS: Record<Dim, Record<string, number>> = {
  depth: { ft: 1, m: FT_PER_M },
  rop: { 'ft/h': 1, 'm/h': FT_PER_M },
  force: { klb: 1, lb: 0.001, kN: 0.2248089, tonne: 2.20462, kdaN: 2.248089 },
  torque: { 'ft-lb': 1, 'kft-lb': 1000, 'N-m': 0.7375621, 'kN-m': 737.5621 },
  pressure: { psi: 1, kPa: 0.1450377, bar: 14.50377, MPa: 145.0377 },
  flow: { gpm: 1, 'L/min': 0.2641721, 'm3/min': 264.1721, 'bbl/min': 42 },
  density: { ppg: 1, sg: 8.3454, 'kg/m3': 0.0083454, pcf: 0.1336806 },
  diameter: { in: 1, mm: 0.03937008 },
  hours: { h: 1, min: 1 / 60, day: 24 },
  minutes: { min: 1, s: 1 / 60, h: 60 },
  volume: { bbl: 1, m3: 6.289811, L: 0.006289811, gal: 1 / 42 },
  lossrate: { 'bbl/h': 1, 'm3/h': 6.289811, 'L/min': 0.3773887, 'bbl/min': 60 },
  none: { '': 1 },
};

const UNIT_PATTERNS: Record<string, RegExp> = {
  ft: /^(ft|feet|foot|ftmd|ftkb)$/, m: /^(m|meter|meters|metre|metres|mtr|mmd)$/,
  'ft/h': /^(ft\/h|ft\/hr|fph|ftph|ft\/hour)$/, 'm/h': /^(m\/h|m\/hr|mph|m\/hour|mtr\/hr)$/,
  klb: /^(klb|klbs|klbf|kip|kips|k-lbs)$/, lb: /^(lb|lbs|lbf)$/, kN: /^kn$/, tonne: /^(t|ton|tons|tonne|tonnes|mt)$/, kdaN: /^kdan$/,
  'ft-lb': /^(ft-?lbs?|ft\.lbs?|lbf?[-.]ft|ftlbf?)$/, 'kft-lb': /^(kft-?lbs?|kft\.lbs?|k ?ft-?lbf?)$/, 'N-m': /^(n[-.·]?m|nm)$/, 'kN-m': /^(kn[-.·]?m|knm)$/,
  psi: /^(psi|psig)$/, kPa: /^kpa$/, bar: /^(bar|barg)$/, MPa: /^mpa$/,
  gpm: /^(gpm|gal\/min|usgpm)$/, 'L/min': /^(l\/min|lpm|l\/m)$/, 'm3/min': /^(m3\/min|m³\/min)$/, 'bbl/min': /^(bbl\/min|bpm)$/,
  ppg: /^(ppg|lb\/gal|lbs\/gal)$/, sg: /^(sg|s\.g\.|g\/cc|g\/cm3)$/, 'kg/m3': /^(kg\/m3|kg\/m³)$/, pcf: /^(pcf|lb\/ft3)$/,
  in: /^(in|inch|inches|")$/, mm: /^mm$/,
  bbl: /^(bbl|bbls)$/, m3: /^(m3|m³|cum)$/, L: /^(l|ltr|litre|liter)$/, gal: /^(gal|usgal)$/,
  'bbl/h': /^(bbl\/hr?|bbls\/hr?|bph)$/, 'm3/h': /^(m3\/hr?|m³\/hr?)$/,
  h: /^(h|hr|hrs|hour|hours)$/, min: /^(min|mins|minute|minutes)$/, day: /^(d|day|days)$/, s: /^(s|sec|secs|seconds)$/,
};

/** Detect a unit from a column header such as "MD (m)", "Depth_m" or "ROP [m/hr]". Returns null if no hint. */
export function detectUnit(header: string, dim: Dim): string | null {
  if (dim === 'none') return null;
  const h = header.trim().toLowerCase();
  const bracket = h.match(/[([{]\s*([^)\]}]+?)\s*[)\]}]/);
  const tokens = h.split(/[\s_,]+/).filter(Boolean);
  const hints = [bracket?.[1], tokens.length > 1 ? tokens[tokens.length - 1] : null].filter(Boolean) as string[];
  for (const hint of hints) {
    const clean = hint.replace(/\s+/g, '');
    for (const unit of Object.keys(UNITS[dim])) if (UNIT_PATTERNS[unit]?.test(clean)) return unit;
  }
  return null;
}

export function toCanonical(v: number, dim: Dim, unit: string): number {
  const f = UNITS[dim]?.[unit];
  return f == null ? v : v * f;
}

export const ftToM = (ft: number) => ft / FT_PER_M;
export const mToFt = (m: number) => m * FT_PER_M;

export function fmt(v: number | null | undefined, digits = 0): string {
  if (v == null || !isFinite(v)) return '—';
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export type DepthUnit = 'ft' | 'm';
export interface Units {
  depthUnit: DepthUnit;
  dl: string;                 // depth label
  rl: string;                 // ROP label
  d(ft: number | null | undefined): number | null;        // ft -> display depth
  r(fph: number | null | undefined): number | null;       // ft/h -> display ROP
  fd(ft: number | null | undefined, digits?: number): string;   // formatted depth, no unit
  fdu(ft: number | null | undefined, digits?: number): string;  // formatted depth with unit
  fr(fph: number | null | undefined, digits?: number): string;
  toFt(v: number): number;    // display depth -> ft
}
export function makeUnits(depthUnit: DepthUnit): Units {
  const k = depthUnit === 'm' ? 1 / FT_PER_M : 1;
  const d = (v: number | null | undefined) => (v == null || !isFinite(v) ? null : v * k);
  return {
    depthUnit, dl: depthUnit, rl: depthUnit === 'm' ? 'm/h' : 'ft/h', d, r: d,
    fd: (v, digits = 0) => fmt(d(v), digits),
    fdu: (v, digits = 0) => (d(v) == null ? '—' : `${fmt(d(v), digits)} ${depthUnit}`),
    fr: (v, digits = 1) => fmt(d(v), digits),
    toFt: v => v / k,
  };
}

/** Dates are handled as UTC wall-clock "rig time" throughout the app. */
export const day10 = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : '');
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const fmtDateTime = (ms: number | string | null | undefined) => {
  if (ms == null) return '—';
  const d = new Date(ms);
  return isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ');
};
export const fmtTime = (ms: number) => new Date(ms).toISOString().slice(11, 16);
