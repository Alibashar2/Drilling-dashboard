// Import pipeline: raw grid -> column mapping -> validation -> canonical drilling records.
// Pure functions (no DOM, no database) so the same logic can be unit-tested and reused by future connectors.
import type { DrillingRecord } from '../lib/types';
import { normalizeActivity } from '../lib/types';
import { detectUnit, toCanonical, UNITS, type Dim } from '../lib/units';
import { median } from '../lib/kpi';
import { utcToWall } from '../lib/time';

export interface RawSheet { name: string; rows: unknown[][] }
export interface RawWorkbook { fileName: string; kind: 'excel' | 'csv'; sheets: RawSheet[] }

export interface FieldDef {
  key: string; label: string; kind: 'datetime' | 'time' | 'number' | 'int' | 'text'; dim: Dim;
  match: RegExp; nonNegative?: boolean;
}
export const DRILLING_FIELDS: FieldDef[] = [
  { key: 'ts', label: 'Date / Date-Time', kind: 'datetime', dim: 'none', match: /^(date ?time|date and time|timestamp|time ?stamp|date|rig time|yyyy.*)$/ },
  { key: 'time_part', label: 'Time (if in a separate column)', kind: 'time', dim: 'none', match: /^(time|local time|clock|hh.*)$/ },
  { key: 'bit_depth_ft', label: 'Bit Depth', kind: 'number', dim: 'depth', match: /bit (depth|md|pos)|^dbtm$|^bit dep/, nonNegative: true },
  { key: 'hole_depth_ft', label: 'Hole Depth', kind: 'number', dim: 'depth', match: /hole (depth|md)|^dmea$|total depth|^td$/, nonNegative: true },
  { key: 'tvd_ft', label: 'True Vertical Depth (TVD)', kind: 'number', dim: 'depth', match: /tvd|true vert/, nonNegative: true },
  { key: 'md_ft', label: 'Measured Depth (MD)', kind: 'number', dim: 'depth', match: /^(md|measured depth|depth|depth md|md depth|dept)$/, nonNegative: true },
  { key: 'hole_size_in', label: 'Hole Size', kind: 'number', dim: 'diameter', match: /hole (size|dia)|bit (size|dia)|section size/, nonNegative: true },
  { key: 'bha_number', label: 'BHA Number', kind: 'int', dim: 'none', match: /bha/, nonNegative: true },
  { key: 'rop_fph', label: 'Rate of Penetration (ROP)', kind: 'number', dim: 'rop', match: /rop|rate of pen|penetration rate/, nonNegative: true },
  { key: 'wob_klb', label: 'Weight on Bit (WOB)', kind: 'number', dim: 'force', match: /wob|weight on bit/ },
  { key: 'rpm', label: 'Rotary Speed (RPM)', kind: 'number', dim: 'none', match: /rpm|rotary speed|rotation/, nonNegative: true },
  { key: 'torque_ftlb', label: 'Torque', kind: 'number', dim: 'torque', match: /torque|^tq|^trq/ },
  { key: 'diff_pressure_psi', label: 'Differential Pressure', kind: 'number', dim: 'pressure', match: /diff.*press|delta p|^dp$|differential/ },
  { key: 'spp_psi', label: 'Standpipe Pressure (SPP)', kind: 'number', dim: 'pressure', match: /spp|stand ?pipe|pump press/, nonNegative: true },
  { key: 'flow_gpm', label: 'Flow Rate', kind: 'number', dim: 'flow', match: /flow|pump rate|^gpm$/, nonNegative: true },
  { key: 'mud_weight_ppg', label: 'Mud Weight', kind: 'number', dim: 'density', match: /mud ?(weight|wt|dens)|^mw$|density/, nonNegative: true },
  { key: 'hook_load_klb', label: 'Hook Load', kind: 'number', dim: 'force', match: /hook ?load|^hkld/, nonNegative: true },
  { key: 'drilling_hours', label: 'Drilling Hours', kind: 'number', dim: 'hours', match: /drill(ing)? (h|time)|drlg h|on bottom h/, nonNegative: true },
  { key: 'circulating_hours', label: 'Circulating Hours', kind: 'number', dim: 'hours', match: /circ\w* (h|time)/, nonNegative: true },
  { key: 'connection_time_min', label: 'Connection Time', kind: 'number', dim: 'minutes', match: /conn\w* (time|min)/, nonNegative: true },
  { key: 'npt_hours', label: 'NPT', kind: 'number', dim: 'hours', match: /npt|non ?productive|down ?time|lost time/, nonNegative: true },
  { key: 'formation_name', label: 'Formation / Geological Layer', kind: 'text', dim: 'none', match: /formation|geolog|litho|layer|zone/ },
  { key: 'activity', label: 'Drilling Activity', kind: 'text', dim: 'none', match: /activity|operation|rig state|op code|phase/ },
  { key: 'problem_text', label: 'Drilling Problems', kind: 'text', dim: 'none', match: /problem|issue|incident|event|remark|comment/ },
];
export const SURVEY_FIELDS: FieldDef[] = [
  { key: 'md', label: 'Measured Depth (MD)', kind: 'number', dim: 'depth', match: /^(md|measured depth|depth|station depth|survey depth)$/, nonNegative: true },
  { key: 'inc', label: 'Inclination (deg)', kind: 'number', dim: 'none', match: /inc|angle|drift/, nonNegative: true },
  { key: 'azi', label: 'Azimuth (deg)', kind: 'number', dim: 'none', match: /azi|direction/ },
];

export type SheetRole = 'drilling' | 'survey' | 'ignore';
export interface SheetConfig {
  role: SheetRole; headerRow: number;
  mapping: Record<string, number | null>;   // field key -> column index
  units: Record<string, string>;            // field key -> source unit
}
export interface ImportOptions { dateOrder: 'auto' | 'DMY' | 'MDY'; dropDuplicates: boolean; declaredDepthUnit?: 'ft' | 'm'; /** records get source_ref = refPrefix + row number */ refPrefix?: string }
export interface Issue {
  severity: 'error' | 'warning' | 'info'; type: string; field?: string; message: string; count: number;
  rows: number[];   // sample of 1-based sheet row numbers
}
export interface BadCell { row: number; col: number; field: string; value: unknown; reason: string }
export type ImportRecord = Omit<DrillingRecord, 'well_id'>;
export interface ProcessResult {
  records: ImportRecord[]; issues: Issue[]; badCells: BadCell[];
  stats: { rows: number; imported: number; skipped: number; duplicates: number };
}

const MISSING = /^(|n\/?a|nan|null|none|-|--|#n\/a|#value!|-999\.25|-9999)$/i;
const isMissing = (v: unknown) => v == null || (typeof v === 'string' && MISSING.test(v.trim())) || v === -999.25 || v === -9999;

export const normHeader = (h: unknown) => String(h ?? '').toLowerCase().replace(/[([{].*?[)\]}]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export function detectHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i] ?? [];
    const texts = cells.filter(c => typeof c === 'string' && c.trim() && isNaN(Number(c))).length;
    if (texts >= 2 && texts >= cells.filter(c => c != null && c !== '').length * 0.6) return i;
  }
  return 0;
}

export function autoMap(headers: unknown[], fields: FieldDef[]): Pick<SheetConfig, 'mapping' | 'units'> {
  const mapping: Record<string, number | null> = {}, units: Record<string, string> = {};
  const taken = new Set<number>();
  const norm = headers.map(normHeader);
  for (const f of fields) {
    mapping[f.key] = null;
    const idx = norm.findIndex((h, i) => h && !taken.has(i) && f.match.test(h));
    if (idx >= 0) { mapping[f.key] = idx; taken.add(idx); }
    if (f.dim !== 'none') units[f.key] = (idx >= 0 && detectUnit(String(headers[idx]), f.dim)) || Object.keys(UNITS[f.dim])[0];
  }
  // a lone "Time" column is the timestamp
  if ('ts' in mapping && mapping.ts == null && mapping.time_part != null) { mapping.ts = mapping.time_part; mapping.time_part = null; }
  return { mapping, units };
}

export function autoConfig(sheet: RawSheet): SheetConfig {
  const headerRow = detectHeaderRow(sheet.rows), headers = sheet.rows[headerRow] ?? [];
  const sv = autoMap(headers, SURVEY_FIELDS), dr = autoMap(headers, DRILLING_FIELDS);
  const isSurvey = sv.mapping.md != null && sv.mapping.inc != null && dr.mapping.ts == null;
  const hasData = dr.mapping.ts != null && (dr.mapping.md_ft != null || dr.mapping.hole_depth_ft != null || dr.mapping.bit_depth_ft != null);
  return isSurvey ? { role: 'survey', headerRow, ...sv } : { role: hasData ? 'drilling' : 'ignore', headerRow, ...dr };
}
export function remap(sheet: RawSheet, role: SheetRole, headerRow: number): SheetConfig {
  const m = autoMap(sheet.rows[headerRow] ?? [], role === 'survey' ? SURVEY_FIELDS : DRILLING_FIELDS);
  return { role, headerRow, ...m };
}

// ------------------------------------------------------------------ cell parsing
export function parseNum(v: unknown): number | null | typeof NaN {
  if (isMissing(v)) return null;
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  let s = String(v).trim().replace(/\s/g, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');        // 1,234.5
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');                     // 12,5 (decimal comma)
  return /^-?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : NaN;
}

const EXCEL_EPOCH = 25569;
/**
 * Parse a date / date-time cell to epoch ms on the report clock: the UTC fields of the result are the clock time written in the
 * report (rig local time). Converting that clock time to a real UTC instant happens once, after reading (import/reportTime.ts).
 * Returns NaN when not understood.
 */
export function parseDate(v: unknown, order: 'DMY' | 'MDY'): number | null {
  if (isMissing(v)) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') {
    if (v > 1 && v < 200000) return Math.round((v - EXCEL_EPOCH) * 86400) * 1000;   // Excel serial date
    if (v > 1e11) return v;                                                         // epoch ms
    return NaN;
  }
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseDate(Number(s), order);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    const t = utc(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
    // an explicit zone ("Z", "+03:00") names a real instant: express it on the report clock like every other time
    if (m[7] && m[4] != null && !isNaN(t)) {
      const z = m[7].toUpperCase() === 'Z' ? 0 : (m[7][0] === '-' ? -1 : 1) * (+m[7].slice(1, 3) * 60 + +m[7].slice(-2)) * 60000;
      return utcToWall(t - z);
    }
    return t;
  }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const [d, mo] = order === 'DMY' ? [a, b] : [b, a];
    let h = +(m[4] ?? 0);
    if (m[7]) h = (h % 12) + (m[7].toLowerCase() === 'pm' ? 12 : 0);
    return utc(y, mo, d, h, +(m[5] ?? 0), +(m[6] ?? 0));
  }
  m = s.match(/^(\d{1,2})[-\s]([a-z]{3})[a-z]*[-\s,]+(\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/i);
  if (m) {
    const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[2].toLowerCase()) + 1;
    return mo ? utc(+m[3] < 100 ? 2000 + +m[3] : +m[3], mo, +m[1], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) : NaN;
  }
  return NaN;
}
function utc(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return NaN;
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  return new Date(t).getUTCDate() === d ? t : NaN;
}
/** Time-of-day cell -> ms since midnight. */
export function parseTime(v: unknown): number | null {
  if (isMissing(v)) return null;
  if (typeof v === 'number') return v >= 0 && v < 1 ? Math.round(v * 86400) * 1000 : NaN;
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return NaN;
  let h = +m[1];
  if (m[4]) h = (h % 12) + (m[4].toLowerCase() === 'pm' ? 12 : 0);
  return h > 23 || +m[2] > 59 ? NaN : (h * 3600 + +m[2] * 60 + +(m[3] ?? 0)) * 1000;
}

/** Decide day/month order from the data: any first part > 12 means DMY, any second part > 12 means MDY. */
export function detectDateOrder(values: unknown[]): { order: 'DMY' | 'MDY'; ambiguous: boolean } {
  let dmy = false, mdy = false, seen = false;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = v.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    seen = true;
    if (+m[1] > 12) dmy = true;
    if (+m[2] > 12) mdy = true;
  }
  if (dmy && !mdy) return { order: 'DMY', ambiguous: false };
  if (mdy && !dmy) return { order: 'MDY', ambiguous: false };
  return { order: 'MDY', ambiguous: seen };
}

// ------------------------------------------------------------------ processing
class Issues {
  map = new Map<string, Issue>();
  add(severity: Issue['severity'], type: string, message: string, row?: number, field?: string) {
    const k = `${type}|${field ?? ''}|${message}`;
    let i = this.map.get(k);
    if (!i) { i = { severity, type, field, message, count: 0, rows: [] }; this.map.set(k, i); }
    i.count++;
    if (row != null && i.rows.length < 50) i.rows.push(row);
  }
  list() { const rank = { error: 0, warning: 1, info: 2 }; return [...this.map.values()].sort((a, b) => rank[a.severity] - rank[b.severity]); }
}

export function processDrillingSheet(sheet: RawSheet, cfg: SheetConfig, opts: ImportOptions): ProcessResult {
  const iss = new Issues(), badCells: BadCell[] = [];
  const data = sheet.rows.slice(cfg.headerRow + 1);
  const col = (k: string) => cfg.mapping[k] ?? null;
  const stats = { rows: 0, imported: 0, skipped: 0, duplicates: 0 };

  if (col('ts') == null) iss.add('error', 'missing_required', 'No Date / Time column is mapped. Map the timestamp column to continue.');
  if (col('md_ft') == null && col('hole_depth_ft') == null && col('bit_depth_ft') == null)
    iss.add('error', 'missing_required', 'No depth column is mapped. Map at least one of Measured Depth, Hole Depth or Bit Depth.');
  if (iss.map.size) return { records: [], issues: iss.list(), badCells, stats };

  const tsCol = col('ts')!;
  const det = detectDateOrder(data.map(r => r?.[tsCol]));
  const order = opts.dateOrder === 'auto' ? det.order : opts.dateOrder;
  if (opts.dateOrder === 'auto' && det.ambiguous)
    iss.add('warning', 'bad_date', 'Day/month order is ambiguous in this file (every date fits both DD/MM and MM/DD). Month-first was assumed - set the date format explicitly if that is wrong.');

  const depthUnits = new Set(['md_ft', 'tvd_ft', 'bit_depth_ft', 'hole_depth_ft'].filter(k => col(k) != null).map(k => cfg.units[k]));
  if (depthUnits.size > 1) iss.add('warning', 'unit_inconsistent', `Depth columns use different units (${[...depthUnits].join(', ')}). Each is converted separately - confirm the units are right.`);
  if (opts.declaredDepthUnit && depthUnits.size === 1 && !depthUnits.has(opts.declaredDepthUnit))
    iss.add('warning', 'unit_inconsistent', `The well was declared in ${opts.declaredDepthUnit} but the depth columns are mapped as ${[...depthUnits][0]}.`);

  const numFields = DRILLING_FIELDS.filter(f => (f.kind === 'number' || f.kind === 'int') && col(f.key) != null);
  const missing: Record<string, number> = {};
  const seen = new Set<number>();
  const records: (ImportRecord & { _row: number; _t: number })[] = [];

  data.forEach((row, i) => {
    if (!row || row.every(c => c == null || c === '')) return;
    stats.rows++;
    const rowNo = cfg.headerRow + 2 + i, gridRow = cfg.headerRow + 1 + i;
    let t = parseDate(row[tsCol], order);
    if (t == null || isNaN(t)) {
      iss.add('error', 'bad_date', t == null ? 'Rows with no date/time cannot be imported and will be skipped.' : 'Unrecognised date/time format - these rows will be skipped unless corrected.', rowNo, 'ts');
      badCells.push({ row: gridRow, col: tsCol, field: 'ts', value: row[tsCol], reason: t == null ? 'missing date' : 'unrecognised date' });
      stats.skipped++;
      return;
    }
    if (col('time_part') != null) {
      const tp = parseTime(row[col('time_part')!]);
      if (tp != null && !isNaN(tp)) t = Math.floor(t / 86400000) * 86400000 + tp;
      else if (tp != null) { iss.add('warning', 'bad_date', 'Unrecognised time-of-day value - midnight used.', rowNo, 'time_part'); badCells.push({ row: gridRow, col: col('time_part')!, field: 'time_part', value: row[col('time_part')!], reason: 'unrecognised time' }); }
    }
    if (seen.has(t)) {
      stats.duplicates++;
      iss.add('warning', 'duplicate', opts.dropDuplicates ? 'Duplicate timestamps - only the first record of each is kept.' : 'Duplicate timestamps found (kept, as requested).', rowNo);
      if (opts.dropDuplicates) { stats.skipped++; return; }
    }
    seen.add(t);

    const rec: Record<string, unknown> = { ts: new Date(t).toISOString() };
    if (opts.refPrefix) { rec.source_ref = opts.refPrefix + rowNo; rec.data_quality = 'reported'; }
    for (const f of numFields) {
      const c = col(f.key)!, raw = row[c];
      let v = parseNum(raw);
      if (v == null) { missing[f.key] = (missing[f.key] ?? 0) + 1; rec[f.key] = null; continue; }
      if (isNaN(v)) {
        iss.add('warning', 'bad_number', `${f.label}: non-numeric value - stored as empty unless corrected.`, rowNo, f.key);
        badCells.push({ row: gridRow, col: c, field: f.key, value: raw, reason: 'not a number' });
        rec[f.key] = null; continue;
      }
      if (f.nonNegative && v < 0) {
        iss.add('warning', 'bad_number', `${f.label}: negative value - stored as empty unless corrected.`, rowNo, f.key);
        badCells.push({ row: gridRow, col: c, field: f.key, value: raw, reason: 'negative' });
        rec[f.key] = null; continue;
      }
      v = toCanonical(v, f.dim, cfg.units[f.key]);
      rec[f.key] = f.kind === 'int' ? Math.round(v) : v;
    }
    const text = (k: string) => { const c = col(k); const v = c == null ? null : row[c]; return isMissing(v) ? null : String(v).trim(); };
    const act = text('activity');
    rec.activity_raw = act; rec.activity_code = normalizeActivity(act);
    rec.formation_name = text('formation_name'); rec.problem_text = text('problem_text');
    records.push({ ...EMPTY, ...rec, _row: rowNo, _t: t } as ImportRecord & { _row: number; _t: number });
  });

  records.sort((a, b) => a._t - b._t);
  for (const [k, n] of Object.entries(missing)) {
    const f = DRILLING_FIELDS.find(x => x.key === k)!;
    iss.add(n / Math.max(records.length, 1) > 0.2 ? 'warning' : 'info', 'missing_values', `${f.label}: ${n} empty value(s) (${Math.round((n / Math.max(records.length, 1)) * 100)}% of rows).`, undefined, k);
    iss.map.get(`missing_values|${k}|${[...iss.map.values()].at(-1)!.message}`)!.count = n;
  }

  // physical consistency checks (after unit conversion, in ft)
  let prevDepth: number | null = null, prevT = 0;
  const incs: number[] = [];
  const depthOf = (r: ImportRecord) => r.hole_depth_ft ?? r.md_ft;
  for (const r of records) { const d = depthOf(r); if (d != null && prevDepth != null && d > prevDepth) incs.push(d - prevDepth); if (d != null) prevDepth = Math.max(prevDepth ?? d, d); }
  const medInc = median(incs) ?? 0, gapLimit = Math.max(100, medInc * 5);
  prevDepth = null;
  for (const r of records) {
    const d = depthOf(r);
    if (d != null && prevDepth != null && d - prevDepth > gapLimit)
      iss.add('warning', 'depth_gap', `Missing depth interval: depth jumps by more than ${Math.round(gapLimit)} ft between consecutive records (data for that interval is absent).`, r._row);
    if (prevT && r._t - prevT > 6 * 3600000) iss.add('info', 'time_gap', 'Gap of more than 6 hours between consecutive records.', r._row);
    if (r.tvd_ft != null && r.md_ft != null && r.tvd_ft > r.md_ft * 1.01 + 1) iss.add('warning', 'unit_inconsistent', 'TVD is greater than MD - check that the columns are not swapped and use the same unit.', r._row);
    if (r.bit_depth_ft != null && r.hole_depth_ft != null && r.bit_depth_ft > r.hole_depth_ft + 1) iss.add('warning', 'bad_number', 'Bit depth is deeper than hole depth.', r._row);
    if (d != null) prevDepth = Math.max(prevDepth ?? d, d);
    prevT = r._t;
  }
  const mw = median(records.map(r => r.mud_weight_ppg).filter((v): v is number => v != null));
  if (mw != null && (mw < 6 || mw > 25))
    iss.add('warning', 'unit_inconsistent', `Mud weight median is ${mw.toFixed(2)} ppg after conversion, which is outside the plausible 6-25 ppg range - the source unit (${cfg.units.mud_weight_ppg}) is probably wrong.`);
  const maxDepth = Math.max(0, ...records.map(r => depthOf(r) ?? 0));
  if (maxDepth > 45000) iss.add('warning', 'unit_inconsistent', `Maximum depth after conversion is ${Math.round(maxDepth)} ft - check the depth unit.`);

  stats.imported = records.length;
  return { records: records.map(({ _row, _t, ...r }) => r), issues: iss.list(), badCells: badCells.slice(0, 200), stats };
}

const EMPTY: ImportRecord = {
  ts: '', md_ft: null, tvd_ft: null, bit_depth_ft: null, hole_depth_ft: null, rop_fph: null, wob_klb: null, rpm: null, torque_ftlb: null,
  spp_psi: null, diff_pressure_psi: null, flow_gpm: null, mud_weight_ppg: null, hook_load_klb: null, drilling_hours: null,
  circulating_hours: null, connection_time_min: null, npt_hours: null, activity_code: null, activity_raw: null, formation_name: null,
  bha_number: null, hole_size_in: null, problem_text: null,
};

export function processSurveySheet(sheet: RawSheet, cfg: SheetConfig): { stations: { md: number; inc: number; azi: number }[]; issues: Issue[] } {
  const iss = new Issues(), stations: { md: number; inc: number; azi: number }[] = [];
  const { md, inc, azi } = cfg.mapping;
  if (md == null || inc == null) { iss.add('error', 'missing_required', 'Survey sheets need MD and Inclination columns.'); return { stations, issues: iss.list() }; }
  sheet.rows.slice(cfg.headerRow + 1).forEach((row, i) => {
    if (!row || row.every(c => c == null || c === '')) return;
    const m = parseNum(row[md]), n = parseNum(row[inc]), a = azi == null ? 0 : parseNum(row[azi]) ?? 0;
    if (m == null || n == null || isNaN(m) || isNaN(n) || isNaN(a) || n < 0 || n > 180) { iss.add('warning', 'bad_number', 'Survey row skipped: MD / inclination / azimuth not valid.', cfg.headerRow + 2 + i); return; }
    stations.push({ md: toCanonical(m, 'depth', cfg.units.md ?? 'ft'), inc: n, azi: a });
  });
  return { stations, issues: iss.list() };
}

// ------------------------------------------------------------------ problems reported in the data
const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/diff\w* stick|differential/, 'DIFF_STICK'], [/mech\w* stick|stuck/, 'MECH_STICK'], [/lost circ|total loss/, 'LOST_CIRC'],
  [/loss|seepage/, 'MUD_LOSS'], [/instab|cav|slough|collapse/, 'INSTABILITY'], [/tight/, 'TIGHT_HOLE'], [/pack/, 'PACK_OFF'],
  [/clean|cutting/, 'HOLE_CLEAN'], [/twist|wash ?out|pipe fail|parted/, 'PIPE_FAIL'], [/bha|motor|mwd|tool fail/, 'BHA_FAIL'],
  [/torque|drag/, 'TORQUE_DRAG'], [/damage/, 'FORM_DAMAGE'], [/kick|influx|pressure|gas/, 'PRESSURE'], [/low rop|slow/, 'LOW_ROP'],
];
export const guessCategory = (text: string) => CATEGORY_KEYWORDS.find(([re]) => re.test(text.toLowerCase()))?.[1] ?? 'OTHER';

export interface ReportedProblem { text: string; categoryCode: string; ts: string; mdTop: number; mdBottom: number; nptHours: number; rec: ImportRecord }
/** Group consecutive records carrying the same problem text into one reported event. */
export function extractProblems(records: ImportRecord[]): ReportedProblem[] {
  const out: ReportedProblem[] = [];
  let cur: ReportedProblem | null = null;
  for (const r of records) {
    const depth = r.hole_depth_ft ?? r.md_ft ?? r.bit_depth_ft ?? 0;
    if (r.problem_text && cur && cur.text === r.problem_text) { cur.mdBottom = Math.max(cur.mdBottom, depth); cur.nptHours += r.npt_hours ?? 0; }
    else if (r.problem_text) { cur = { text: r.problem_text, categoryCode: guessCategory(r.problem_text), ts: r.ts, mdTop: depth, mdBottom: depth, nptHours: r.npt_hours ?? 0, rec: r }; out.push(cur); }
    else cur = null;
  }
  return out;
}
