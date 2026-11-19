// Extraction engine: runs the five layers over a workbook and returns one structured, fully traceable result.
//   1 workbook.ts   cells, formulas, merges, hidden sheets/rows/columns
//   2 structure.ts  tables, headers, horizontal layouts, metadata, narratives, sections
//   3 dictionary.ts drilling terminology, units, value ranges
//   4 narrative.ts  events, intervals, ROP, problems, formations from text
//   5 (here)        validation, cross-sheet integration, confidence, simulation-ready records
// Every value carries its status (confirmed = written in the source, inferred = calculated, suspected =
// interpreted from context), a confidence and the worksheet!cell it came from. Nothing is invented.
import { ACT, normalizeActivity, type Severity } from '../../lib/types';
import { detectUnit, mToFt, toCanonical, UNITS, type Dim } from '../../lib/units';
import { DRILLING_FIELDS, guessCategory, parseDate, parseNum, processDrillingSheet, processSurveySheet, type ImportRecord, type Issue, type SheetConfig } from '../parse';
import { CHECKLIST, classify, CONCEPT, dimCompatible, headerUnit, normLabel, suggestFromData, type Concept } from './dictionary';
import { activityFromText, analyzeNarrative, toFt, type NarrativeFacts } from './narrative';
import { analyzeSheet, isNum, type KV, type Structure, type Table } from './structure';
import { A1, cellRef, type SCell, type SWorkbook } from './workbook';
import { applyCorrections, finalizeHits, scanCell, taskContext, unexplainedNumbers, type Context, type Correction, type InCellHit } from './incell';
import { extractEquipment, holeSections, type BhaRunEx, type CasingEx, type CementJobEx, type EqOp, type HoleSectionEx, type OperationEx, type ToolEx } from './equipment';

export type Status = 'confirmed' | 'inferred' | 'suspected';
export interface Ex { value: number | string; raw: string; unit?: string; status: Status; confidence: number; src: string; note?: string }
export interface SmartOptions {
  depthUnit: 'ft' | 'm'; dateOrder: 'auto' | 'DMY' | 'MDY';
  learned: Record<string, string>;      // terms learned on earlier imports
  overrides: Record<string, string>;    // this import: normalised label -> concept key or 'ignore'
  acceptNpt: string[];                  // ids of NPT candidates the engineer accepted
  fallbackDate: string | null;          // used only when the report contains no date at all
  knownFormations: string[];
  corrections?: Record<string, Correction>;   // engineer corrections of values read inside cells (by hit id)
}
export interface OpOut {
  id: string; start: string; end: string; hours: number; activity: string; text: string; src: string;
  npt: 'flag' | 'explicit' | 'candidate' | null; nptCounted: boolean;
  interval: { from: number; to: number; status: Status } | null; rop: number | null; formation: string | null; problems: string[];
  task: string | null; params: string[];
}
export interface Coverage {
  cellsScanned: number; cellsWithValues: number; values: number; used: number; identifiers: number;
  missed: { src: string; text: string; unit: string; line: string }[];   // numbers with a drilling unit that nothing explains
}
export interface ProblemEx {
  id: string; category: string; label: string; ts: string | null; md: number | null; mdBottom: number | null; formation: string | null; holeSize: number | null;
  nptHours: number; reportedHours: number | null; nptBasis: string; description: string; sourceText: string; src: string; actions: string[];
  confidence: number; status: Status; severity: Severity;
}
export interface ParamSummary { key: string; label: string; group: string; status: Status | 'missing'; confidence: number; count: number; src: string; sample: string }
export interface Unresolved { key: string; header: string; src: string; samples: string[]; suggestions: string[] }
export interface Extraction {
  sheets: { name: string; hidden: boolean; rows: number; cols: number; merges: number; formulas: number; hiddenRows: number; hiddenCols: number; excluded: string | null; sections: string[]; kv: number; narratives: number;
    tables: { title: string | null; range: string; kind: string; rows: number; columns: { header: string; concept: string | null; confidence: number; unit: string | null }[] }[] }[];
  wellInfo: Record<string, Ex>;
  days: { date: string; src: string; fields: Record<string, Ex>; ops: OpOut[]; narratives: { label: string | null; text: string; src: string; planned: boolean }[] }[];
  records: ImportRecord[]; recordMode: 'time series' | 'operations log' | 'daily summary' | 'none';
  stations: { md: number; inc: number; azi: number }[];
  formations: { name: string; top: number; bottom: number | null; tvd: number | null; src: string }[];
  problems: ProblemEx[]; negatedMentions: number;
  nptCandidates: { id: string; start: string; hours: number; text: string; src: string }[];
  params: ParamSummary[]; unresolved: Unresolved[]; unclassified: { src: string; text: string }[];
  issues: Issue[]; needsDate: boolean; depthUnitAssumed: boolean;
  /** every parameter-value found inside a cell, with its source, method, confidence and context */
  cellParams: (InCellHit & { ts: string | null; md_ft: number | null })[];
  coverage: Coverage;
  lithology: { md: number | null; text: string; src: string }[];
  dateOrder: { order: 'DMY' | 'MDY'; basis: string };
  operations: OperationEx[]; bhaRuns: BhaRunEx[]; tools: ToolEx[]; casings: CasingEx[]; cementJobs: CementJobEx[]; holeSections: HoleSectionEx[];
}

const DAY = 86400000, HOUR = 3600000, STEP_H = 0.5;
const iso = (ms: number) => new Date(ms).toISOString();
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const FRACTIONS: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Find a calendar date anywhere inside a piece of text (titles, sheet names, "Report for 12 March 2025"). */
export function findDate(text: string, order: 'DMY' | 'MDY'): number | null {
  const pats = [/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/, /\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/, /\d{1,2}[-\s](?:[A-Za-z]{3,9})[-\s,]+\d{2,4}/];
  for (const p of pats) { const m = p.exec(text); if (m) { const t = parseDate(m[0].replace(/([A-Za-z]{3})[a-z]*/, '$1'), order); if (t != null && !isNaN(t)) return t; } }
  const m = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(text);
  if (m && MONTHS.includes(m[1].toLowerCase())) return Date.UTC(+m[3], MONTHS.indexOf(m[1].toLowerCase()), +m[2]);
  return null;
}

function cellDate(x: SCell | null | undefined, order: 'DMY' | 'MDY'): number | null {
  if (!x) return null;
  if (typeof x.v === 'number') return x.date || (x.v > 20000 && x.v < 80000) ? Math.round((x.v - 25569) * 86400) * 1000 : null;
  const t = parseDate(String(x.v), order);
  return t != null && !isNaN(t) ? t : findDate(String(x.v), order);
}
/** Clock cell -> hours since midnight. Accepts Excel time fractions, 06:30, 0630, 6.5, "06:00-08:30" (returns start). */
function cellClock(x: SCell | null | undefined): { h: number; h2?: number } | null {
  if (!x) return null;
  if (typeof x.v === 'number') {
    if (x.date || (x.v >= 0 && x.v < 1)) return { h: round((x.v % 1) * 24, 4) };
    if (x.v <= 24) return { h: x.v };
    if (x.v <= 2400 && Number.isInteger(x.v)) return { h: Math.floor(x.v / 100) + (x.v % 100) / 60 };
    return null;
  }
  const one = (s: string) => { const m = /^(\d{1,2})[:.]?(\d{2})?(?::\d{2})?\s*([ap]m)?$/i.exec(s.trim()); if (!m) return null; let h = +m[1]; if (m[3]) h = (h % 12) + (/p/i.test(m[3]) ? 12 : 0); return h > 24 ? null : h + +(m[2] ?? 0) / 60; };
  const parts = String(x.v).split(/\s*(?:-|–|to)\s*/i);
  const a = one(parts[0]);
  if (a == null) return null;
  const b = parts[1] ? one(parts[1]) : null;
  return b != null ? { h: a, h2: b } : { h: a };
}

/** Number (and unit) from a cell: handles "8,510 ft", "9.8 ppg", `12 1/4"`, "12¼", and ranges such as "20 - 25". */
function cellNumber(x: SCell, c: Concept, labelHint: string, kvUnit: string | undefined, o: SmartOptions): { value: number; unit: string; assumed: boolean; range: boolean } | null {
  let n: number | null = null, token = '', range = false;
  if (typeof x.v === 'number') n = x.v;
  else {
    let s = String(x.v).trim();
    for (const [ch, f] of Object.entries(FRACTIONS)) s = s.replace(new RegExp(`(\\d+)\\s*${ch}`), (_m, a) => String(+a + f));
    const mixed = /^(\d+)[\s-]+(\d+)\/(\d+)\s*(.*)$/.exec(s);
    const rng = /^(-?[\d,]*\.?\d+)\s*(?:-|–|to|\/)\s*(-?[\d,]*\.?\d+)\s*(.*)$/i.exec(s);
    const single = /^(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(.*)$/.exec(s);
    if (mixed) { n = +mixed[1] + +mixed[2] / +mixed[3]; token = mixed[4]; }
    else if (rng && c.dim !== 'depth') { n = (Number(rng[1].replace(/,/g, '')) + Number(rng[2].replace(/,/g, ''))) / 2; token = rng[3]; range = true; }
    else if (single) { n = Number(single[1].replace(/,/g, '')); token = single[2]; }
  }
  if (n == null || !isFinite(n)) return null;
  if (c.dim === 'none') return { value: n, unit: '', assumed: false, range };
  token = token.replace(/^["”]/, 'in').replace(/^['’]/, 'ft');
  const explicit = (token && detectUnit(`(${token.split(/\s/)[0]})`, c.dim)) || (kvUnit && detectUnit(`(${kvUnit})`, c.dim)) || detectUnit(labelHint, c.dim);
  const unit = explicit || (c.dim === 'depth' ? o.depthUnit : c.dim === 'rop' ? (o.depthUnit === 'm' ? 'm/h' : 'ft/h') : Object.keys(UNITS[c.dim])[0]);
  return { value: toCanonical(n, c.dim, unit), unit, assumed: !explicit, range };
}

/** Full date-time in a cell ("8/9/2025 6:00:00 PM", an Excel date-time serial); null for a bare clock time. */
function absTime(x: SCell | null | undefined, order: 'DMY' | 'MDY'): number | null {
  if (!x) return null;
  if (typeof x.v === 'number') return x.v > 20000 && x.v < 80000 ? Math.round((x.v - 25569) * 86400) * 1000 : null;
  const s = String(x.v).trim();
  if (!/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3}/.test(s)) return null;
  const t = parseDate(s, order);
  return t != null && !isNaN(t) ? t : null;
}

/** Rig state from an operation / task code ("Drill to depth", "Trip out to depth (OH)", "Run in casing to depth"). */
export function activityFromTask(task: string, text: string, progress: boolean): string {
  const t = task.toLowerCase(), head = text.split(/\r?\n/)[0] ?? '';
  if (/\bdrill/.test(t) && !/drill ?pipe|choke|kick|\bpit\b|fire/.test(t)) {
    if (/shoe|cement|float|stage|plug|out\b|collar|\bdv\b/.test(t) && !progress) return 'OTH';   // drilling out cement / shoe track: no new hole
    return /\bslid/i.test(head) ? 'SLD' : 'ROT';
  }
  if (/ream|wash/.test(t)) return 'REA';
  if (/connection/.test(t)) return 'CON';
  if (/wait/.test(t)) return /cement|woc/.test(t) ? 'OTH' : 'WOO';
  if (/trip|pull out|run in|rih|pooh|\btih\b|\btoh\b/.test(t)) return /casing|liner|tubing|wireline|completion/.test(t) ? 'OTH' : 'TRP';
  if (/circ|condition|pump (pill|slug|lcm|sweep)|pump\b.*pill|reverse|sweep|displace|change fluid/.test(t)) return 'CIR';
  if (/repair|maintenance|fishing|stuck/.test(t)) return 'WOO';
  return 'OTH';
}

/** Problem category for an NPT event from the report's own NPT category / sub-category. */
function nptCode(s: string): string {
  const t = s.toLowerCase();
  if (/\bbits?\b|motor|mwd|lwd|rss|dh equip|down ?hole equip|\bbha\b|tool failure/.test(t)) return 'BHA_FAIL';
  if (/tight/.test(t)) return 'TIGHT_HOLE';
  if (/stuck|sticking/.test(t)) return /diff/.test(t) ? 'DIFF_STICK' : 'MECH_STICK';
  if (/loss|lost circ/.test(t)) return 'LOST_CIRC';
  if (/pack/.test(t)) return 'PACK_OFF';
  if (/instab|caving|collapse/.test(t)) return 'INSTABILITY';
  if (/twist|wash ?out|parted|fish/.test(t)) return 'PIPE_FAIL';
  if (/kick|influx/.test(t)) return 'PRESSURE';
  if (/hole clean/.test(t)) return 'HOLE_CLEAN';
  return 'OTHER';
}

/** Comparable form of a formation name: "Dammam FM", "Dammam Fm Top" and "dammam" are the same formation. */
/** Lithology abbreviations in formation names ("Zubair Upper SH" = "Zubair Upper Shale", "S.ST" / "S.S" = sand). */
const fmKey = (n: string) => n.toLowerCase()
  .replace(/\bs\.?\s?st\.?(?![a-z])|\bs\.\s?s\.?(?![a-z])|\bsst\b|\bsandstone\b/g, ' sand ').replace(/\bsh\b\.?/g, ' shale ').replace(/\blst\b\.?/g, ' limestone ')
  .replace(/\b(fm|fmn|formation|top|base)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const acronym = (n: string) => fmKey(n).split(' ').filter(Boolean).map(w => w[0]).join('');

/** "Sheet!Q16; Sheet!Q17; Sheet!Q18" -> "Sheet!Q16:Q18" when the cells are consecutive in one column. */
function compactRefs(refs: string[]): string {
  const parsed = refs.map(r => /^(.*)!([A-Z]+)(\d+)$/.exec(r));
  if (parsed.length > 1 && parsed.every(p => p && p[1] === parsed[0]![1] && p[2] === parsed[0]![2]) && parsed.every((p, i) => i === 0 || +p![3] === +parsed[i - 1]![3] + 1))
    return `${parsed[0]![1]}!${parsed[0]![2]}${parsed[0]![3]}:${parsed[0]![2]}${parsed[parsed.length - 1]![3]}`;
  return [...new Set(refs)].join('; ');
}

/** In-cell parameter keys that correspond to a dictionary concept (used for daily values and the checklist). */
const HIT_CONCEPT: Record<string, string> = {
  rop: 'rop', rop_avg: 'rop_avg', rop_inst: 'rop_inst', footage: 'footage', md: 'md', tvd: 'tvd', bit_depth: 'bit_depth', hole_depth: 'hole_depth',
  wob: 'wob', rpm: 'rpm', rpm_surface: 'rpm', torque: 'torque', spp: 'spp', diff_pressure: 'diff_pressure', flow: 'flow', hook_load: 'hook_load',
  mud_weight: 'mud_weight', ecd: 'ecd', npt: 'npt', drilling_hours: 'drilling_hours', rotating_hours: 'rotating_hours', circ_hours: 'circ_hours',
  tripping_hours: 'tripping_hours', connection_time: 'connection_time', operating_hours: 'operating_hours', fm_top: 'fm_top', fm_bottom: 'fm_bottom',
  hole_size: 'hole_size', formation: 'formation', lithology: 'lithology', shoe_depth: 'casing_shoe', survey_tvd: 'tvd',
};

/** Operational context of a rig state, used to pick the parameters that belong to an operation. */
const ACT_CTX: Record<string, Context> = { ROT: 'drilling', SLD: 'drilling', CON: 'drilling', REA: 'reaming', CIR: 'circulating', TRP: 'tripping' };
/** In-cell parameters that go into drilling_records columns (the rest go into the record's `extra`). */
const RECORD_KEYS = new Set(['wob', 'rpm', 'rpm_surface', 'torque', 'spp', 'flow', 'mud_weight', 'rop_avg', 'rop', 'rop_inst', 'diff_pressure', 'hook_load', 'formation', 'serial']);

export function extractWorkbook(wb: SWorkbook, o: SmartOptions): Extraction {
  const learned = { ...o.learned, ...Object.fromEntries(Object.entries(o.overrides).filter(([, v]) => v !== 'ignore')) };
  const issues: Issue[] = [];
  const issue = (severity: Issue['severity'], type: string, message: string) => { const e = issues.find(i => i.message === message); if (e) e.count++; else issues.push({ severity, type, message, count: 1, rows: [] }); };
  const structs = wb.sheets.map(s => analyzeSheet(s, learned));
  // Text dates: the report itself decides. "8/13/2025" can only be month-first, "13/8/2025" only day-first.
  // With no decisive date, day-first is assumed (the common DDR convention) and said so. Excel date cells need no guess.
  let dmyVotes = 0, mdyVotes = 0, dateExample = '';
  for (const s of wb.sheets) for (const row of s.cells) for (const x of row) {
    if (!x || typeof x.v !== 'string') continue;
    const m = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/.exec(x.v);
    if (!m) continue;
    if (+m[1] > 12 && +m[2] <= 12) { dmyVotes++; dateExample ||= x.v; } else if (+m[2] > 12 && +m[1] <= 12) { mdyVotes++; dateExample ||= x.v; }
  }
  const order: 'DMY' | 'MDY' = o.dateOrder !== 'auto' ? o.dateOrder : mdyVotes > dmyVotes ? 'MDY' : 'DMY';
  const dateOrder = {
    order, basis: o.dateOrder !== 'auto' ? 'set by the user' : mdyVotes + dmyVotes === 0 ? 'no text date decides it; day-first assumed'
      : `${order === 'MDY' ? 'month-first' : 'day-first'}: ${Math.max(mdyVotes, dmyVotes)} text date(s) such as "${dateExample}" can only be read this way${Math.min(mdyVotes, dmyVotes) ? `; ${Math.min(mdyVotes, dmyVotes)} contradict it` : ''}`,
  };
  if (o.dateOrder === 'auto' && mdyVotes && dmyVotes) issue('warning', 'date_order', `The report mixes day-first and month-first text dates (${dmyVotes} vs ${mdyVotes}); ${order === 'MDY' ? 'month-first' : 'day-first'} is used. Check the dates or set the date format.`);
  else if (o.dateOrder === 'auto' && mdyVotes + dmyVotes) issue('info', 'date_order', `Text dates are read ${order === 'MDY' ? 'month-first (M/D/Y)' : 'day-first (D/M/Y)'}: ${dateOrder.basis}.`);
  const seen = new Map<string, { n: number; conf: number; status: Status; src: string; sample: string }>();
  const note = (key: string, status: Status, conf: number, src: string, sample: string, n = 1) => {
    const e = seen.get(key);
    const rank = { confirmed: 3, inferred: 2, suspected: 1 };
    if (!e) seen.set(key, { n, conf, status, src, sample });
    else { e.n += n; if (rank[status] > rank[e.status] || (status === e.status && conf > e.conf)) { e.conf = conf; e.status = status; e.src = src; e.sample = sample; } }
  };
  let depthUnitExplicit = false, depthUnitAssumed = false;
  const unresolved = new Map<string, Unresolved>();
  const unclassified: Extraction['unclassified'] = [];

  // ------------------------------------------------------------------ sheet context: well identity and report date
  const kvConcept = (kv: KV) => { const n = normLabel(kv.label); if (o.overrides[n] === 'ignore') return null; const k = classify(kv.label, learned); return k && k.score >= 0.8 ? k : null; };
  const ctx = structs.map(st => {
    let well: string | null = null, date: number | null = null, dateSrc = '';
    for (const kv of st.kvs) {
      const k = kvConcept(kv);
      if (!k) continue;
      if ((k.concept.key === 'well_name' || k.concept.key === 'well_id') && !well) well = String(kv.value.w).trim();
      if (k.concept.key === 'report_date' && date == null) { date = cellDate(kv.value, order); dateSrc = cellRef(st.sheet.name, kv.r, kv.c); }
    }
    if (date == null) for (const s of st.sections) { const d = findDate(s.title, order); if (d != null) { date = d; dateSrc = cellRef(st.sheet.name, s.r, s.c); break; } }
    if (date == null) { const d = findDate(st.sheet.name, order); if (d != null) { date = d; dateSrc = `${st.sheet.name} (sheet name)`; } }
    return { well, date: date == null ? null : Math.floor(date / DAY) * DAY, dateSrc };
  });
  const wellCount = new Map<string, number>();
  for (const c of ctx) if (c.well) wellCount.set(c.well.toLowerCase(), (wellCount.get(c.well.toLowerCase()) ?? 0) + 1);
  const primary = [...wellCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const excluded = ctx.map(c => (c.well && primary && c.well.toLowerCase() !== primary ? `belongs to a different well ("${c.well}") - not merged` : null));
  excluded.forEach((e, i) => e && issue('warning', 'unrelated_sheet', `Sheet "${wb.sheets[i].name}" ${e}.`));
  wb.sheets.forEach((s, i) => {
    if (excluded[i]) return;
    if (s.hidden) issue('info', 'hidden', `Sheet "${s.name}" is hidden in Excel; it was read like the visible sheets.`);
    if (s.hiddenRows.size || s.hiddenCols.size) issue('info', 'hidden', `Sheet "${s.name}" has ${s.hiddenRows.size} hidden row(s) and ${s.hiddenCols.size} hidden column(s); their content was read and is included.`);
  });

  // ------------------------------------------------------------------ classify table columns
  interface Col { c: number; header: string; concept: Concept | null; score: number; unit: string | null; unitAssumed: boolean; dup?: string }
  interface TInfo { t: Table; st: Structure; si: number; cols: Col[]; kind: string; by: Record<string, Col> }
  const tinfos: TInfo[] = [];
  structs.forEach((st, si) => {
    for (const t of st.tables) {
      const cols: Col[] = t.cols.map(tc => {
        const xs: SCell[] = []; for (let r = t.r0; r <= t.r1; r++) { const x = st.sheet.cells[r][tc.c]; if (x) xs.push(x); }
        const nums = xs.filter(isNum).map(x => Number(parseNum(x.v)));
        const n = normLabel(tc.header), hu = headerUnit(tc.header);
        if (o.overrides[n] === 'ignore') return { c: tc.c, header: tc.header, concept: null, score: 0, unit: null, unitAssumed: false };
        const k = classify(tc.header, learned);
        let concept = k?.concept ?? null, score = k?.score ?? 0;
        if (concept) {
          if (hu && concept.dim !== 'none' && !dimCompatible(concept.dim, hu.dim)) score -= 0.3;
          if (hu && concept.dim !== 'none' && dimCompatible(concept.dim, hu.dim)) score = Math.min(0.99, score + 0.04);
          const numeric = xs.length ? nums.length / xs.length : 0;
          if (concept.kind === 'number' && xs.length && numeric < 0.5) score -= 0.3;
          if (concept.kind === 'text' && xs.length && numeric > 0.9 && concept.key !== 'activity' && concept.key !== 'hole_section') score -= 0.25;
          // "From" / "To" holding depths rather than clock times
          if ((concept.key === 'time_from' || concept.key === 'time_to') && nums.length && nums.every(v => v > 24) && !xs.some(x => x.date)) concept = CONCEPT[concept.key === 'time_from' ? 'depth_from' : 'depth_to'];
          if (concept.range && nums.length && k?.how !== 'learned') {
            const f = hu && UNITS[concept.dim]?.[hu.unit] ? UNITS[concept.dim][hu.unit] : concept.dim === 'depth' && o.depthUnit === 'm' ? UNITS.depth.m : 1;
            const ok = nums.filter(v => v * f >= concept!.range![0] && v * f <= concept!.range![1]).length / nums.length;
            score += ok >= 0.9 ? 0.03 : ok < 0.5 ? -0.3 : -0.1;
          }
        }
        if (!concept || score < 0.6) {
          if (xs.length) {
            const key = n || `column ${A1(t.headerRow, tc.c)}`;
            if (!unresolved.has(key)) unresolved.set(key, { key, header: tc.header || '(no header)', src: cellRef(t.sheet, t.headerRow, tc.c), samples: xs.slice(0, 4).map(x => x.w), suggestions: suggestFromData(tc.header, nums.slice(0, 200)).map(x => x.key) });
          }
          return { c: tc.c, header: tc.header, concept: null, score: 0, unit: hu?.unit ?? null, unitAssumed: false };
        }
        const unit = concept.dim === 'none' ? null : hu && dimCompatible(concept.dim, hu.dim) && UNITS[concept.dim][hu.unit] ? hu.unit : concept.dim === 'depth' ? o.depthUnit : concept.dim === 'rop' ? (o.depthUnit === 'm' ? 'm/h' : 'ft/h') : Object.keys(UNITS[concept.dim])[0];
        const assumed = concept.dim !== 'none' && !(hu && dimCompatible(concept.dim, hu.dim));
        if (concept.dim === 'depth') { if (assumed) depthUnitAssumed = true; else depthUnitExplicit = true; }
        return { c: tc.c, header: tc.header, concept, score: Math.min(0.99, score), unit, unitAssumed: assumed };
      });
      // one column per concept: the best match wins, the others need a decision - except the same quantity
      // given twice in two units ("Top Depth (m)" and "Top Depth (ft)"): the values are cross-checked and the
      // column that holds the originally reported numbers (the one with fewer decimals) is used
      const by: Record<string, Col> = {};
      const decimals = (col: Col) => { let n = 0, k = 0; for (let r = t.r0; r <= Math.min(t.r1, t.r0 + 200); r++) { const x = st.sheet.cells[r][col.c]; if (x && typeof x.v === 'number') { n += (String(x.v).split('.')[1] ?? '').length; k++; } } return k ? n / k : 99; };
      const sameValues = (a: Col, b: Col) => {
        let n = 0, ok = 0;
        for (let r = t.r0; r <= Math.min(t.r1, t.r0 + 300); r++) {
          const xa = st.sheet.cells[r][a.c], xb = st.sheet.cells[r][b.c];
          if (!xa || !xb) continue;
          const va = cellNumber(xa, a.concept!, a.header, a.unit ?? undefined, o), vb = cellNumber(xb, b.concept!, b.header, b.unit ?? undefined, o);
          if (!va || !vb) continue;
          n++; if (Math.abs(va.value - vb.value) <= Math.max(0.005 * Math.abs(va.value), 0.5)) ok++;
        }
        return { n, ok };
      };
      for (const col of [...cols].sort((a, b) => b.score - a.score)) {
        if (!col.concept) continue;
        const prev = by[col.concept.key];
        if (!prev) { by[col.concept.key] = col; continue; }
        if (col.concept.dim !== 'none' && prev.unit && col.unit && prev.unit !== col.unit && !prev.unitAssumed && !col.unitAssumed) {
          const { n, ok } = sameValues(prev, col);
          const [keep, other] = decimals(col) < decimals(prev) ? [col, prev] : [prev, col];
          by[col.concept.key] = keep;
          other.dup = `same values as "${keep.header}" in ${other.unit}${n ? `; ${ok}/${n} rows agree after conversion` : ''}`;
          if (n && ok < n * 0.98) issue('warning', 'unit_columns_disagree', `"${keep.header}" and "${other.header}" (${t.sheet}) should hold the same values in different units, but ${n - ok} of ${n} rows disagree after conversion. "${keep.header}" is used.`);
          continue;
        }
        const key = normLabel(col.header); if (!unresolved.has(key)) unresolved.set(key, { key, header: col.header, src: cellRef(t.sheet, t.headerRow, col.c), samples: [], suggestions: [col.concept.key] }); col.concept = null;
      }
      // "Borehole Section" holding 23.000 / 17.500 / 08.500 is a hole size in inches (data pattern)
      if (by.hole_section && !by.hole_size) {
        const vals: number[] = []; for (let r = t.r0; r <= t.r1; r++) { const x = st.sheet.cells[r][by.hole_section.c]; const v = x ? Number(String(x.v).replace(/["”]|in(ch(es)?)?$/i, '').trim()) : NaN; if (x) vals.push(v); }
        if (vals.length && vals.filter(v => isFinite(v) && v >= 3 && v <= 40).length / vals.length > 0.9) { by.hole_size = { ...by.hole_section, concept: CONCEPT.hole_size, unit: 'in', unitAssumed: true }; issue('info', 'hole_size_from_section', `"${by.hole_section.header}" (${t.sheet}) holds numbers between 3 and 40; they are read as the hole size in inches.`); }
      }
      const has = (...k: string[]) => k.some(x => by[x]);
      const rows = t.r1 - t.r0 + 1, title = `${t.title ?? ''} ${st.sheet.name}`;
      // an operations log may carry NPT category columns that are empty on productive rows: it is still an operations log
      const opsLike = has('description') && has('time_from', 'time_to', 'duration_h', 'time_only');
      let nptFill = 0; if (by.npt_category) { let k = 0; for (let r = t.r0; r <= t.r1; r++) if (st.sheet.cells[r][by.npt_category.c]) k++; nptFill = k / Math.max(1, rows); }
      const kind = has('md', 'depth_from') && has('inc') && !opsLike ? 'survey'
        : has('formation') && has('fm_top', 'md', 'depth_from') && !has('timestamp', 'time_from', 'description') ? 'formations'
        : (!opsLike || nptFill > 0.6) && (has('npt_category', 'corrective') || /npt|down ?time|lost time|problem|trouble|incident/i.test(title)) && has('description', 'problem', 'npt_category') ? 'npt events'
        : opsLike ? 'operations log'
        : has('timestamp', 'report_date') && has('md', 'hole_depth', 'bit_depth') && rows >= 12 && !has('description') && (has('timestamp', 'time_only') || rows > 60) ? 'time series'
        : has('report_date', 'timestamp') ? 'daily values' : 'other';
      tinfos.push({ t, st, si, cols, kind, by });
    }
  });
  if (depthUnitAssumed && !depthUnitExplicit) issue('info', 'unit_assumed', `No depth unit is written in the report; ${o.depthUnit === 'm' ? 'metres' : 'feet'} assumed from the well's declared depth unit.`);

  const cell = (ti: TInfo, r: number, key: string) => (ti.by[key] ? ti.st.sheet.cells[r][ti.by[key].c] : null);
  const numAt = (ti: TInfo, r: number, key: string): number | null => {
    const col = ti.by[key], x = col && ti.st.sheet.cells[r][col.c];
    if (!x || !col.concept) return null;
    const v = cellNumber(x, col.concept, col.header, col.unit ?? undefined, o);
    return v ? v.value : null;
  };
  const refOf = (ti: TInfo, r: number, key?: string) => cellRef(ti.t.sheet, r, key && ti.by[key] ? ti.by[key].c : ti.t.cols[0].c);

  // ------------------------------------------------------------------ formations and survey first (used by narratives and records)
  const formations: Extraction['formations'] = [];
  let stations: Extraction['stations'] = [];
  for (const ti of tinfos) {
    if (excluded[ti.si]) continue;
    if (ti.kind === 'formations') {
      for (let r = ti.t.r0; r <= ti.t.r1; r++) {
        const name = cell(ti, r, 'formation')?.w, top = numAt(ti, r, 'fm_top') ?? numAt(ti, r, 'md') ?? numAt(ti, r, 'depth_from');
        if (!name || top == null) continue;
        formations.push({ name, top, bottom: numAt(ti, r, 'fm_bottom') ?? numAt(ti, r, 'depth_to'), tvd: numAt(ti, r, 'tvd'), src: refOf(ti, r, 'formation') });
        note('formation', 'confirmed', ti.by.formation.score, refOf(ti, r, 'formation'), name);
      }
    }
    if (ti.kind === 'survey') {
      const mdCol = ti.by.md ?? ti.by.depth_from;
      const cfg: SheetConfig = { role: 'survey', headerRow: ti.t.headerRow, mapping: { md: mdCol.c, inc: ti.by.inc.c, azi: ti.by.azi?.c ?? null }, units: { md: mdCol.unit ?? o.depthUnit } };
      const res = processSurveySheet({ name: ti.t.sheet, rows: ti.st.sheet.cells.slice(0, ti.t.r1 + 1).map(row => row.map(x => x?.v ?? null)) }, cfg);
      if (res.stations.length > stations.length) stations = res.stations;
    }
  }
  formations.sort((a, b) => a.top - b.top);
  formations.forEach((f, i) => { if (f.bottom == null && formations[i + 1]) f.bottom = formations[i + 1].top; });
  const knownFm = [...new Set([...formations.map(f => f.name), ...o.knownFormations])];
  const fmAt = (md: number) => formations.find(f => md >= f.top && (f.bottom == null || md < f.bottom))?.name ?? null;

  // ------------------------------------------------------------------ day store
  interface Op {
    id: string; date: number; t0: number; t1: number | null; hours: number | null; text: string; code: string | null; nptFlag: boolean; dFrom: number | null; dTo: number | null; facts: NarrativeFacts; src: string;
    phase: string | null; flagText: string | null; nptCat: string | null; nptSub: string | null; nptVendor: string | null; holeSize: number | null; hits: InCellHit[]; ctx: Context;
  }
  interface Day { date: number; src: string; fields: Record<string, Ex>; ops: Op[]; narratives: { label: string | null; text: string; src: string; planned: boolean; facts: NarrativeFacts }[] }
  const days = new Map<number, Day>();
  const wellInfo: Record<string, Ex> = {};
  const dayOf = (date: number, src: string) => { let d = days.get(date); if (!d) { d = { date, src, fields: {}, ops: [], narratives: [] }; days.set(date, d); } return d; };
  const setField = (target: Record<string, Ex>, key: string, ex: Ex) => {
    const old = target[key];
    if (old && typeof old.value === 'number' && typeof ex.value === 'number' && Math.abs(old.value - ex.value) > Math.max(0.02 * Math.abs(old.value), 0.05))
      issue('warning', 'conflict', `${CONCEPT[key]?.label ?? key} is reported with different values (${old.raw} at ${old.src} and ${ex.raw} at ${ex.src}); the higher-confidence value is used.`);
    if (!old || ex.confidence > old.confidence) target[key] = ex;
    note(key, ex.status, ex.confidence, ex.src, ex.raw);
  };
  const fallback = o.fallbackDate ? Date.parse(o.fallbackDate + 'T00:00:00Z') : null;
  let needsDate = false;
  const toEx = (x: SCell, c: Concept, label: string, score: number, src: string, kvUnit?: string): Ex | null => {
    if (c.kind === 'number') {
      const v = cellNumber(x, c, label, kvUnit, o);
      if (!v) return null;
      if (c.dim === 'depth') { if (v.assumed) depthUnitAssumed = true; else depthUnitExplicit = true; }
      return { value: round(v.value, 3), raw: x.w, unit: v.unit || undefined, status: v.range ? 'inferred' : 'confirmed', confidence: round(v.range ? score - 0.1 : score), src, note: v.range ? 'midpoint of the reported range' : v.assumed && c.dim !== 'none' ? `unit not written; ${v.unit} assumed` : undefined };
    }
    if (c.kind === 'datetime') { const d = cellDate(x, order); return d == null ? null : { value: iso(d).slice(0, 10), raw: x.w, status: 'confirmed', confidence: round(score), src }; }
    return { value: x.w, raw: x.w, status: 'confirmed', confidence: round(score), src };
  };
  const INFO = new Set(['well_name', 'well_id', 'field', 'location', 'rig', 'spud_date', 'well_type', 'target_depth']);
  // values found inside cells: those of operations (attached to the operation) and those anywhere else on a sheet
  const opHits: InCellHit[] = [];
  const looseHits: { hit: InCellHit; date: number | null; dateSrc: string }[] = [];
  const scanned = new Map<string, string>();   // worksheet!cell -> text of every cell the in-cell scanner read
  const scanLoose = (text: string, sheet: string, r: number, c: number, date: number | null, dateSrc: string) => {
    scanned.set(cellRef(sheet, r, c), text);
    const hits = scanCell(text, sheet, A1(r, c), 'general').filter(h => h.use);
    for (const hit of hits) looseHits.push({ hit, date, dateSrc });
    return hits.length > 0;
  };

  structs.forEach((st, si) => {
    if (excluded[si]) return;
    const date = ctx[si].date;
    // label / value metadata
    for (const kv of st.kvs) {
      const k0 = kvConcept(kv), src = cellRef(st.sheet.name, kv.r, kv.c);
      // a single cell holding "label: value" (or several of them) is read by the in-cell scanner,
      // which also understands ranges, units and several parameters in one cell
      const inline = kv.lr === kv.r && kv.lc === kv.c;
      const cellText = inline ? st.sheet.cells[kv.r][kv.c]?.w ?? '' : kv.value.w;
      if ((inline || !k0) && !INFO.has(k0?.concept.key ?? '') && k0?.concept.key !== 'report_date' && scanLoose(inline ? cellText : `${kv.label}: ${kv.value.w}`, st.sheet.name, kv.r, kv.c, date ?? fallback, ctx[si].dateSrc)) continue;
      const k = k0;
      if (!k && kv.value.w.split(/\s+/).length >= 9) {
        // a paragraph under a label the dictionary does not know (e.g. "Planned Operations") is still operations text
        const facts = analyzeNarrative(kv.value.w, knownFm, /plan|forecast|next|ahead|forward|program/i.test(kv.label));
        const d0 = date ?? fallback;
        if (d0 != null) dayOf(d0, ctx[si].dateSrc).narratives.push({ label: kv.label, text: kv.value.w, src, planned: facts.planned, facts });
        else unclassified.push({ src, text: `${kv.label}: ${kv.value.w}` });
        continue;
      }
      if (!k) { unclassified.push({ src, text: `${kv.label}: ${kv.value.w}` }); continue; }
      const ex = toEx(kv.value, k.concept, kv.label, k.score, src, kv.unit);
      if (!ex) { unclassified.push({ src, text: `${kv.label}: ${kv.value.w}` }); continue; }
      if (INFO.has(k.concept.key)) setField(wellInfo, k.concept.key, ex);
      else if (k.concept.key === 'report_date' || k.concept.key === 'report_no') note(k.concept.key, 'confirmed', ex.confidence, src, ex.raw);
      else if (k.concept.key === 'description' || k.concept.key === 'problem' || k.concept.key === 'corrective') {
        const planned = /plan|forecast|next|ahead|forward|program/i.test(kv.label);
        const facts = analyzeNarrative(kv.value.w, knownFm, planned);
        if (date != null) dayOf(date, ctx[si].dateSrc).narratives.push({ label: kv.label, text: kv.value.w, src, planned: facts.planned, facts });
        else unclassified.push({ src, text: `${kv.label}: ${kv.value.w}` });
        note(k.concept.key, 'confirmed', ex.confidence, src, kv.value.w.slice(0, 60));
      } else if (date != null) setField(dayOf(date, ctx[si].dateSrc).fields, k.concept.key, ex);
      else setField(wellInfo, k.concept.key, ex);   // undated report-level value
    }
    // paragraphs
    for (const n of st.narratives) {
      const src = cellRef(st.sheet.name, n.r, n.c);
      const planned = !!n.label && /plan|forecast|next|ahead|forward|program/i.test(n.label);
      const facts = analyzeNarrative(n.text, knownFm, planned);
      if (!facts.planned) scanLoose(n.text, st.sheet.name, n.r, n.c, date ?? fallback, ctx[si].dateSrc);
      const d = date ?? fallback;
      if (d != null) dayOf(d, ctx[si].dateSrc || 'date entered by user').narratives.push({ label: n.label, text: n.text, src, planned: facts.planned, facts });
      else { needsDate = true; unclassified.push({ src, text: n.text }); }
      note('description', 'confirmed', 0.9, src, n.text.slice(0, 60));
    }
    // horizontal tables: parameters down, periods (or Min / Max / Avg) across
    for (const tt of st.ttables) {
      const periods = tt.valueCols.map(vc => ({ c: vc.c, date: cellDate(vc.header, order), stat: vc.header ? String(vc.header.w).toLowerCase() : '' }));
      const dated = periods.filter(p => p.date != null).length >= 2;
      for (const row of tt.rows) {
        const n = normLabel(row.label), k = o.overrides[n] === 'ignore' ? null : classify(row.label, learned);
        if (!k || k.score < 0.7) { if (o.overrides[n] !== 'ignore' && !unresolved.has(n)) unresolved.set(n, { key: n, header: row.label, src: cellRef(st.sheet.name, row.r, tt.labelCol), samples: periods.map(p => st.sheet.cells[row.r][p.c]?.w ?? '').filter(Boolean).slice(0, 4), suggestions: [] }); continue; }
        if (dated) {
          for (const p of periods) { const x = st.sheet.cells[row.r][p.c]; if (!x || p.date == null) continue; const ex = toEx(x, k.concept, row.label, k.score, cellRef(st.sheet.name, row.r, p.c)); if (ex) setField(dayOf(Math.floor(p.date / DAY) * DAY, cellRef(st.sheet.name, tt.headerRow, p.c)).fields, k.concept.key, ex); }
        } else {
          const pick = periods.find(p => /avg|aver|mean|actual|value/.test(p.stat)) ?? null;
          const lo = periods.find(p => /min|from|low/.test(p.stat)), hi = periods.find(p => /max|to|high/.test(p.stat));
          const d = date ?? fallback;
          let ex: Ex | null = null;
          if (pick && st.sheet.cells[row.r][pick.c]) ex = toEx(st.sheet.cells[row.r][pick.c]!, k.concept, row.label, k.score, cellRef(st.sheet.name, row.r, pick.c));
          else if (lo && hi && st.sheet.cells[row.r][lo.c] && st.sheet.cells[row.r][hi.c]) {
            const a = toEx(st.sheet.cells[row.r][lo.c]!, k.concept, row.label, k.score, cellRef(st.sheet.name, row.r, lo.c)), b = toEx(st.sheet.cells[row.r][hi.c]!, k.concept, row.label, k.score, '');
            if (a && b && typeof a.value === 'number' && typeof b.value === 'number') ex = { ...a, value: round((a.value + b.value) / 2, 3), raw: `${a.raw} - ${b.raw}`, status: 'inferred', confidence: round(k.score - 0.1), note: 'midpoint of reported minimum and maximum' };
          }
          if (ex && d != null) setField(dayOf(d, ctx[si].dateSrc).fields, k.concept.key, ex);
          else if (ex) setField(wellInfo, k.concept.key, ex);
        }
      }
    }
    for (const l of st.leftovers) if (!scanLoose(l.text, st.sheet.name, l.r, l.c, date ?? fallback, ctx[si].dateSrc)) unclassified.push({ src: cellRef(st.sheet.name, l.r, l.c), text: l.text });
  });

  // ------------------------------------------------------------------ tables: time series, operations log, daily values, NPT events
  let tsRecords: ImportRecord[] = [];
  interface NptEvent { date: number | null; a: number | null; b: number | null; hours: number | null; category: string; text: string; action: string | null; md: number | null; src: string }
  const nptEvents: NptEvent[] = [];
  let opSeq = 0;
  for (const ti of tinfos) {
    if (excluded[ti.si]) continue;
    const { t, st, by } = ti, sheetDate = ctx[ti.si].date;
    const rowDate = (r: number) => { const d = cellDate(cell(ti, r, 'report_date') ?? cell(ti, r, 'timestamp'), order); return d != null ? Math.floor(d / DAY) * DAY : sheetDate ?? fallback; };
    for (const col of ti.cols) if (col.concept) note(col.concept.key, col.score >= 0.85 ? 'confirmed' : 'suspected', round(col.score), cellRef(t.sheet, t.headerRow, col.c), `column "${col.header}"`, 0);

    if (ti.kind === 'time series') {
      const tsCol = by.timestamp ?? by.report_date;
      const mapping: Record<string, number | null> = {}, units: Record<string, string> = {};
      for (const f of DRILLING_FIELDS) { mapping[f.key] = null; if (f.dim !== 'none') units[f.key] = Object.keys(UNITS[f.dim])[0]; }
      mapping.ts = tsCol.c;
      if (!by.timestamp && by.time_only) mapping.time_part = by.time_only.c;
      for (const col of ti.cols) if (col.concept?.record && col.concept.record !== 'ts' && col.concept.record !== 'time_part') { mapping[col.concept.record] = col.c; if (col.unit) units[col.concept.record] = col.unit; }
      const res = processDrillingSheet({ name: t.sheet, rows: st.sheet.cells.slice(0, t.r1 + 1).map(row => row.map(x => x?.v ?? null)) }, { role: 'drilling', headerRow: t.headerRow, mapping, units }, { dateOrder: o.dateOrder, dropDuplicates: true, refPrefix: `${t.sheet}!` });
      for (const i of res.issues) if (i.type !== 'missing_values') issues.push({ ...i, message: `[${t.sheet}] ${i.message}` });
      for (const col of ti.cols) if (col.concept) note(col.concept.key, col.score >= 0.85 ? 'confirmed' : 'suspected', round(col.score), cellRef(t.sheet, t.headerRow, col.c), `column "${col.header}"`, res.records.length);
      tsRecords = tsRecords.concat(res.records);
      continue;
    }
    if (ti.kind === 'operations log') {
      let prev: Op | null = null, offset = 0, lastStart = -1, gaps = 0, overlaps = 0, durMismatch = 0;
      for (let r = t.r0; r <= t.r1; r++) {
        const text = cell(ti, r, 'description')?.w ?? '';
        // start / end may be full date-times ("8/9/2025 6:00:00 PM") or clock times on a dated sheet
        const a0 = absTime(cell(ti, r, 'time_from'), order), a1 = absTime(cell(ti, r, 'time_to'), order);
        const clk = a0 != null ? null : cellClock(cell(ti, r, 'time_from') ?? cell(ti, r, 'time_only') ?? (by.timestamp ? cell(ti, r, 'timestamp') : null));
        const end = a1 != null ? null : cellClock(cell(ti, r, 'time_to')), dur = numAt(ti, r, 'duration_h');
        if (!text) continue;
        if (a0 == null && !clk && dur == null && !end && prev) {   // continuation line
          prev.text += '\n' + text; prev.facts = analyzeNarrative(prev.text, knownFm);
          const more = scanCell(text, t.sheet, A1(r, by.description.c), prev.ctx); prev.hits.push(...more); opHits.push(...more); scanned.set(cellRef(t.sheet, r, by.description.c), text);
          continue;
        }
        const date = a0 != null ? Math.floor(a0 / DAY) * DAY : rowDate(r);
        if (date == null) { needsDate = true; unclassified.push({ src: refOf(ti, r, 'description'), text }); continue; }
        let t0: number, t1: number | null;
        if (a0 != null) {
          t0 = a0; t1 = a1 ?? (dur != null ? a0 + dur * HOUR : null);
          if (a1 != null && dur != null && Math.abs((a1 - a0) / HOUR - dur) > 0.02) durMismatch++;
          if (prev?.t1 != null) { if (t0 - prev.t1 > 60000) gaps++; else if (prev.t1 - t0 > 60000) overlaps++; }
        } else {
          let h0 = clk?.h ?? null;
          if (h0 != null) { if (prev && prev.date === date && h0 + offset < lastStart - 0.01) offset += 24; lastStart = h0 + offset; h0 += offset; }
          t0 = h0 != null ? date + h0 * HOUR : prev && prev.date === date && prev.t1 != null ? prev.t1 : date;
          const h1 = end?.h ?? clk?.h2 ?? null;
          t1 = h1 != null ? date + (h1 + offset) * HOUR : dur != null ? t0 + dur * HOUR : null;
          if (t1 != null && t1 <= t0 && h1 != null) t1 += DAY;
          if (prev && prev.date !== date) { offset = 0; lastStart = h0 ?? -1; }
        }
        const flag = (cell(ti, r, 'npt_flag')?.w ?? '').trim();
        const task = cell(ti, r, 'operation')?.w ?? null, phase = cell(ti, r, 'activity')?.w ?? null, code = task ?? phase;
        const src = refOf(ti, r, 'description'), ctx0 = taskContext(task ?? phase);
        const hits = scanCell(text, t.sheet, A1(r, by.description.c), ctx0);
        scanned.set(src, text);
        const op: Op = {
          id: `op${++opSeq}`, date, t0, t1, hours: dur, text, code, flagText: flag || null,
          nptFlag: /^(npt|n|np|non|non[- ]?prod\w*|unprod\w*|down\w*|lost|unplanned)$/i.test(flag) || /\bnpt\b/i.test(code ?? ''),
          dFrom: numAt(ti, r, 'depth_from'), dTo: numAt(ti, r, 'depth_to') ?? numAt(ti, r, 'md'), facts: analyzeNarrative(text, knownFm), src,
          phase: task ? phase : null, nptCat: cell(ti, r, 'npt_category')?.w ?? null, nptSub: cell(ti, r, 'npt_subcategory')?.w ?? null, nptVendor: cell(ti, r, 'npt_vendor')?.w ?? null,
          holeSize: numAt(ti, r, 'hole_size'), hits, ctx: ctx0,
        };
        opHits.push(...hits);
        dayOf(date, ctx[ti.si].dateSrc || refOf(ti, r)).ops.push(op);
        prev = op;
      }
      if (gaps) issue('warning', 'time_gap', `[${t.sheet}] ${gaps} operation(s) start later than the previous one ended; the gaps are left empty on the timeline.`);
      if (overlaps) issue('warning', 'time_overlap', `[${t.sheet}] ${overlaps} operation(s) start before the previous one ended (overlapping times).`);
      if (durMismatch) issue('warning', 'duration_mismatch', `[${t.sheet}] ${durMismatch} operation(s) have a duration that does not match their start and end times; the start and end times are used.`);
      if (by.time_from && absTime(st.sheet.cells[t.r0][by.time_from.c], order) != null) note('timestamp', 'confirmed', 0.95, cellRef(t.sheet, t.headerRow, by.time_from.c), `column "${by.time_from.header}" (date and time of each operation)`);
      const nRows = t.r1 - t.r0 + 1;
      // a well-name column with one value on every row identifies the well
      if (by.well_name && !wellInfo.well_name) {
        const names = new Set<string>(); for (let r = t.r0; r <= t.r1; r++) { const x = st.sheet.cells[r][by.well_name.c]; if (x) names.add(String(x.w).trim()); }
        if (names.size === 1) setField(wellInfo, 'well_name', { value: [...names][0], raw: [...names][0], status: 'confirmed', confidence: 0.95, src: cellRef(t.sheet, t.r0, by.well_name.c), note: `column "${by.well_name.header}", same on all ${nRows} rows` });
        else if (names.size > 1) issue('warning', 'several_wells', `Column "${by.well_name.header}" names ${names.size} wells (${[...names].slice(0, 4).join(', ')}); they are imported as one well. Split the file per well if that is wrong.`);
      }
      if (by.depth_to) note('hole_depth', 'confirmed', by.depth_to.score, cellRef(t.sheet, t.headerRow, by.depth_to.c), `columns "${by.depth_from?.header ?? ''}" / "${by.depth_to.header}": hole depth at the start and end of each operation`, nRows);
      if (by.hole_size) note('hole_size', by.hole_size.concept?.key === 'hole_size' && by.hole_size.header === by.hole_section?.header ? 'inferred' : 'confirmed', 0.9, cellRef(t.sheet, t.headerRow, by.hole_size.c), `column "${by.hole_size.header}" (inches)`, nRows);
      continue;
    }
    if (ti.kind === 'npt events') {
      for (let r = t.r0; r <= t.r1; r++) {
        const text = [cell(ti, r, 'npt_category')?.w, cell(ti, r, 'problem')?.w, cell(ti, r, 'description')?.w].filter(Boolean).join(' - ');
        if (!text) continue;
        const date = rowDate(r), a = cellClock(cell(ti, r, 'time_from')), b = cellClock(cell(ti, r, 'time_to'));
        const hours = numAt(ti, r, 'npt') ?? numAt(ti, r, 'duration_h') ?? (a && b ? ((b.h - a.h + 24) % 24) : null);
        nptEvents.push({ date, a: date != null && a ? date + a.h * HOUR : null, b: date != null && a && b ? date + (b.h < a.h ? b.h + 24 : b.h) * HOUR : null, hours, category: cell(ti, r, 'npt_category')?.w ?? '', text, action: cell(ti, r, 'corrective')?.w ?? null, md: numAt(ti, r, 'md') ?? numAt(ti, r, 'depth_from'), src: refOf(ti, r, 'description') });
        if (hours != null) note('npt', 'confirmed', 0.92, refOf(ti, r, by.npt ? 'npt' : 'duration_h'), `${hours} h`);
      }
      continue;
    }
    if (ti.kind === 'daily values') {
      for (let r = t.r0; r <= t.r1; r++) {
        const date = rowDate(r);
        if (date == null) continue;
        for (const col of ti.cols) {
          const x = st.sheet.cells[r][col.c];
          if (!x || !col.concept || col.concept.key === 'report_date' || col.concept.key === 'timestamp') continue;
          const src = cellRef(t.sheet, r, col.c);
          if (col.concept.key === 'description' || col.concept.key === 'problem') { const facts = analyzeNarrative(x.w, knownFm); dayOf(date, src).narratives.push({ label: col.header, text: x.w, src, planned: facts.planned, facts }); continue; }
          const ex = toEx(x, col.concept, col.header, col.score, src, col.unit ?? undefined);
          if (ex) setField(dayOf(date, src).fields, col.concept.key, ex);
        }
      }
      continue;
    }
    if (ti.kind === 'other') issue('info', 'table_kept', `Table "${t.title ?? t.sheet}" (${cellRef(t.sheet, t.headerTop, t.cols[0].c)}, ${t.r1 - t.r0 + 1} rows) is not a drilling record table; it is listed in the extraction report and kept in the import record.`);
  }

  // ------------------------------------------------------------------ values read inside cells: units, corrections, daily values
  const allHits = [...opHits, ...looseHits.map(l => l.hit)];
  finalizeHits(allHits, o.depthUnit);
  applyCorrections(allHits, o.corrections, o.depthUnit);
  const live = (h: InCellHit) => h.use && h.status !== 'rejected';
  for (const h of allHits) if (live(h) && HIT_CONCEPT[h.key]) note(HIT_CONCEPT[h.key], h.status === 'rejected' ? 'suspected' : h.status, h.confidence, h.src, h.text);
  for (const { hit, date, dateSrc } of looseHits) {
    const key = HIT_CONCEPT[hit.key];
    if (!key || !live(hit)) continue;
    const ex: Ex = typeof hit.value === 'number'
      ? { value: round(hit.canonical ?? hit.value, 3), raw: hit.text, unit: hit.canonicalUnit ?? undefined, status: hit.status === 'rejected' ? 'suspected' : hit.status, confidence: hit.confidence, src: hit.src, note: hit.notes.join('; ') || undefined }
      : { value: hit.value, raw: hit.text, status: hit.status === 'rejected' ? 'suspected' : hit.status, confidence: hit.confidence, src: hit.src };
    if (INFO.has(key) || date == null) setField(wellInfo, key, ex);
    else setField(dayOf(Math.floor(date / DAY) * DAY, dateSrc).fields, key, ex);
  }

  const bySrc = new Map<string, InCellHit[]>();
  for (const h of allHits) bySrc.set(h.src, [...(bySrc.get(h.src) ?? []), h]);
  const missed: Coverage['missed'] = [];
  for (const [src, text] of scanned) for (const u of unexplainedNumbers(text, bySrc.get(src) ?? [])) missed.push({ src, ...u });
  const coverage: Coverage = {
    cellsScanned: scanned.size, cellsWithValues: [...scanned.keys()].filter(s => bySrc.has(s)).length, values: allHits.length, used: allHits.filter(live).length,
    identifiers: allHits.filter(h => !h.use && h.status !== 'rejected').length, missed,
  };
  if (missed.length) issue('info', 'unread_numbers', `${missed.length} number(s) with a drilling unit (psi, lpm, ton, sg ...) inside text cells are not attributed to any parameter. They are listed under "Values in cells" for review and kept with the import record.`);

  // ------------------------------------------------------------------ formations named in the operations (when the report has no formation table)
  // "Formation: Ghar" on a drilled interval and "(Top of Ghar)" at the end of an interval give tops by depth.
  // Marker tops are as written; tops taken from the first interval naming a formation are inferred.
  const allOps = [...days.values()].flatMap(d => d.ops).sort((a, b) => a.t0 - b.t0);
  const opDepth = (op: Op) => {
    const iv = op.facts.intervals.find(x => x.kind === 'drill');
    if (op.dFrom != null && op.dTo != null && op.dTo > op.dFrom) return { from: op.dFrom, to: op.dTo };
    if (iv) return { from: toFt(iv.from, iv.unit, o.depthUnit), to: toFt(iv.to, iv.unit, o.depthUnit) };
    return op.dTo != null ? { from: op.dTo, to: op.dTo } : null;
  };
  if (!formations.length && allOps.length) {
    const tops = new Map<string, { name: string; top: number; src: string; marker: boolean }>();
    const keyOf = (name: string) => { const k = fmKey(name); for (const x of tops.keys()) if (x === k || acronym(x) === k.replace(/ /g, '') || acronym(k) === x.replace(/ /g, '')) return x; return k; };
    const add = (name: string, top: number, src: string, marker: boolean) => {
      if (!fmKey(name)) return;
      const k = keyOf(name), cur = tops.get(k);
      // keep the most complete spelling ("Umm-Er-Radhuma" over "UER", "Lower Fars" over "lower Fars")
      const cand = name.replace(/\s+(fm|formation)\b\.?/gi, '').trim();
      const score = (s: string) => fmKey(s).length * 2 + (/^[A-Z]/.test(s) ? 1 : 0) - (s === s.toUpperCase() && s.length > 4 ? 1 : 0) + s.length / 1000;
      const longer = cur && score(cur.name) >= score(cand) ? cur.name : cand;
      if (!cur || (marker && !cur.marker) || (marker === cur.marker && top < cur.top)) tops.set(k, { name: longer, top, src, marker });
      else if (cur) cur.name = longer;
    };
    for (const op of allOps) {
      const dep = opDepth(op);
      for (const h of op.hits) {
        if (!live(h)) continue;
        if (h.key === 'fm_top_marker' && typeof h.value === 'string') { const d = h.depth[0] ? toFt(h.depth[0].value, h.depth[0].unit, o.depthUnit) : dep?.to; if (d != null) add(h.value, d, h.src, true); }
        if (h.key === 'formation' && typeof h.value === 'string' && dep) add(h.value, dep.from, h.src, false);
      }
    }
    for (const x of [...tops.values()].sort((a, b) => a.top - b.top)) {
      formations.push({ name: x.name, top: round(x.top, 1), bottom: null, tvd: null, src: x.src });
      note('formation', x.marker ? 'confirmed' : 'inferred', x.marker ? 0.9 : 0.75, x.src, `${x.name} top ${Math.round(x.top)} ft (${x.marker ? 'top stated in the report' : 'first interval that names it'})`);
    }
    formations.forEach((f, i) => { if (f.bottom == null && formations[i + 1]) f.bottom = formations[i + 1].top; });
    if (formations.length) issue('info', 'formations_from_text', `${formations.length} formation tops were taken from the operations text ("Top of ..." markers as stated; otherwise the first drilled interval that names the formation, which is inferred). Names that are abbreviations of each other (e.g. "UER" / "Umm Er Radhuma") are merged.`);
  }
  // directional survey stations written in the operations text ("Last Survey: 577.96 mMD, ... inc:2.98°, Azm:145.77°")
  if (!stations.length) {
    const byLine = new Map<string, InCellHit[]>();
    for (const h of opHits) if (live(h) && ['survey_md', 'inc', 'azi'].includes(h.key) && h.qualifier === 'survey') { const k = `${h.src}|${h.line}`; byLine.set(k, [...(byLine.get(k) ?? []), h]); }
    const st: Extraction['stations'] = [];
    const seenMd = new Map<number, { tvd: number | null; src: string; text: string }>();
    for (const g of byLine.values()) {
      const md = g.find(x => x.key === 'survey_md'), inc = g.find(x => x.key === 'inc'), azi = g.find(x => x.key === 'azi');
      const tvd = opHits.find(x => x.key === 'survey_tvd' && x.src === md?.src && x.line === md?.line);
      if (md?.canonical != null) {
        // the same station repeated in a later report must agree with itself
        const k = round(md.canonical, 1), prev = seenMd.get(k), tv = tvd?.canonical ?? null;
        if (prev && prev.tvd != null && tv != null && Math.abs(prev.tvd - tv) > 1) issue('warning', 'survey_conflict', `The survey station at ${md.value} ${md.unit ?? ''} MD is reported twice with different TVD: "${prev.text}" (${prev.src}) and "${tvd!.text}" (${tvd!.src}). The first one is used; check the survey.`);
        if (!prev) seenMd.set(k, { tvd: tv, src: tvd?.src ?? md.src, text: tvd?.text ?? md.text });
      }
      if (md?.canonical != null && inc && typeof inc.value === 'number' && md.status !== 'suspected') st.push({ md: round(md.canonical, 1), inc: inc.value, azi: typeof azi?.value === 'number' ? azi.value : 0 });
    }
    st.sort((a, b) => a.md - b.md);
    stations = st.filter((s, i) => i === 0 || s.md > st[i - 1].md + 0.5);
    if (stations.length) issue('info', 'survey_from_text', `${stations.length} directional survey stations were read from "Last Survey" statements in the operations text (projections are not used as stations).`);
  }
  const lithology: Extraction['lithology'] = allHits.filter(h => live(h) && h.key === 'lithology').map(h => ({ md: h.depth[0] ? round(toFt(h.depth[0].value, h.depth[0].unit, o.depthUnit), 1) : null, text: String(h.value), src: h.src }));

  // ------------------------------------------------------------------ build simulation-ready records
  const accept = new Set(o.acceptNpt);
  const sortedDays = [...days.values()].sort((a, b) => a.date - b.date);
  const f = (d: Day, k: string) => (typeof d.fields[k]?.value === 'number' ? (d.fields[k].value as number) : null);
  const records: ImportRecord[] = [];
  const opsOut = new Map<number, OpOut[]>();
  const nptCandidates: Extraction['nptCandidates'] = [];
  const problems: ProblemEx[] = [];
  let negated = 0;
  const addProblem = (p: Omit<ProblemEx, 'id' | 'severity'>, date: number | null) => {
    const dup = problems.find(q => q.category === p.category && (q.ts ?? '').slice(0, 10) === (p.ts ?? iso(date ?? 0)).slice(0, 10) && (q.md == null || p.md == null || Math.abs(q.md - p.md) < 300));
    if (dup) {
      dup.confidence = Math.min(0.97, dup.confidence + 0.1); dup.src += `; ${p.src}`;
      if (!dup.sourceText.includes(p.sourceText)) dup.sourceText += ` | ${p.sourceText}`;
      if (p.nptHours > dup.nptHours) { dup.nptHours = p.nptHours; dup.nptBasis = p.nptBasis; }
      dup.reportedHours ??= p.reportedHours; dup.md ??= p.md; dup.formation ??= p.formation;
      for (const a of p.actions) if (!dup.actions.includes(a)) dup.actions.push(a);
      return;
    }
    problems.push({ ...p, id: `p${problems.length + 1}`, severity: p.category === 'PRESSURE' || p.category === 'PIPE_FAIL' ? 'high' : /total/i.test(p.label) ? 'high' : 'medium' });
  };
  let hole: number | null = null, mode: Extraction['recordMode'] = 'none';
  const depthTextMismatch: string[] = [];
  let lastMw: { v: number; src: string; hole: number | null } | null = null;
  const hitMeta = new Map<string, { ts: string; md: number | null }>();
  const nptOps: { op: Op; hours: number; md: number | null; hole: number | null; formation: string | null }[] = [];
  const opInfo = new Map<string, { counted: boolean; md0: number | null; md1: number | null; progress: boolean; activity: string; holeSize: number | null }>();
  const base = (): ImportRecord => ({ ts: '', md_ft: null, tvd_ft: null, bit_depth_ft: null, hole_depth_ft: null, rop_fph: null, wob_klb: null, rpm: null, torque_ftlb: null, spp_psi: null, diff_pressure_psi: null, flow_gpm: null,
    mud_weight_ppg: null, hook_load_klb: null, drilling_hours: null, circulating_hours: null, connection_time_min: null, npt_hours: null, activity_code: null, activity_raw: null, formation_name: null, bha_number: null, hole_size_in: null, problem_text: null });
  const holeSize = (d: Day) => f(d, 'hole_size') ?? (typeof wellInfo.hole_size?.value === 'number' ? (wellInfo.hole_size.value as number) : null);
  const extras = (d: Day) => { const e: Record<string, unknown> = {}; for (const [k, v] of Object.entries(d.fields)) if (!CONCEPT[k]?.record && !['md', 'footage', 'depth_from', 'depth_to', 'rop_avg', 'rop_inst'].includes(k)) e[k] = v.unit ? `${v.raw} (${v.unit})` : v.raw; return Object.keys(e).length ? e : null; };

  if (tsRecords.length) { mode = 'time series'; tsRecords.sort((a, b) => (a.ts < b.ts ? -1 : 1)); records.push(...tsRecords); }
  for (const d of sortedDays) {
    const dayEnd = f(d, 'md') ?? f(d, 'hole_depth') ?? f(d, 'depth_to'), footage = f(d, 'footage');
    const dayRecs: ImportRecord[] = [], outs: OpOut[] = [];
    const ops = d.ops.sort((a, b) => a.t0 - b.t0);
    ops.forEach((op, i) => { if (op.t1 == null) op.t1 = op.hours != null ? op.t0 + op.hours * HOUR : ops[i + 1]?.t0 ?? null; });
    // resolve each operation's activity and drilled interval
    const res = ops.map(op => {
      const progress = op.dFrom != null && op.dTo != null && op.dTo > op.dFrom + 0.01;
      const code = op.code?.trim() ?? '';
      let activity: string;
      if (code && /\s/.test(code) && !ACT[code.toUpperCase()]) activity = activityFromTask(code, op.text, progress);   // "Drill to depth", "Trip out to depth (OH)"
      else { const fromCode = code && /[a-z]{3,}/i.test(code) ? normalizeActivity(code) : null; activity = (fromCode && fromCode !== 'OTH' ? fromCode : null) ?? op.facts.activity ?? activityFromText(code) ?? 'OTH'; }
      const iv = op.facts.intervals.find(x => x.kind === 'drill') ?? (op.facts.intervals.length === 1 && (activity === 'ROT' || activity === 'SLD') ? op.facts.intervals[0] : null);
      let from: number | null = null, to: number | null = null;
      const st: Status = 'confirmed';
      const drillingAct = activity === 'ROT' || activity === 'SLD';
      if (progress && drillingAct) {
        // the report's depth columns are the structured source; the text interval is a cross-check
        from = op.dFrom; to = op.dTo;
        if (iv) { const a = toFt(iv.from, iv.unit, o.depthUnit), b = toFt(iv.to, iv.unit, o.depthUnit); if (Math.abs(a - from!) > Math.max(3, 0.01 * from!) || Math.abs(b - to!) > Math.max(3, 0.01 * to!)) depthTextMismatch.push(`${op.src} (columns ${Math.round(from!)}–${Math.round(to!)} ft, text ${Math.round(a)}–${Math.round(b)} ft)`); }
      } else if (iv && op.dFrom == null && op.dTo == null) {
        from = toFt(iv.from, iv.unit, o.depthUnit); to = toFt(iv.to, iv.unit, o.depthUnit); if (iv.unit) depthUnitExplicit = true; if (activity !== 'SLD') activity = 'ROT';
      } else if (drillingAct && iv && !progress && op.dTo == null) { from = toFt(iv.from, iv.unit, o.depthUnit); to = toFt(iv.to, iv.unit, o.depthUnit); }
      if (from != null && to != null && to < from) { from = null; to = null; }
      return { op, activity, from, to, st: st as Status, hours: op.t1 != null ? (op.t1 - op.t0) / HOUR : 0 };
    });
    if (ops.length && !tsRecords.length) {
      mode = 'operations log';
      const firstFrom = res.find(x => x.from != null)?.from ?? null;
      const start: number | null = firstFrom ?? hole ?? f(d, 'depth_from') ?? (dayEnd != null && footage != null ? dayEnd - footage : null);
      // footage the log does not locate: share the remaining reported footage between drilling entries without depths
      const knownFt = res.reduce((s, x) => s + (x.from != null ? x.to! - x.from : 0), 0);
      const open = res.filter(x => (x.activity === 'ROT' || x.activity === 'SLD') && x.from == null && x.hours > 0);
      const remaining = dayEnd != null && start != null ? dayEnd - start - knownFt : footage != null ? footage - knownFt : 0;
      if (open.length && remaining > 1 && start != null) {
        const tot = open.reduce((s, x) => s + x.hours, 0);
        let cur = Math.max(start, ...res.filter(x => x.to != null).map(x => x.to!));
        for (const x of open) { x.from = cur; x.to = cur + remaining * (x.hours / tot); x.st = 'inferred'; cur = x.to; }
        issue('info', 'footage_inferred', `${d.fields.md?.src ?? iso(d.date).slice(0, 10)}: ${Math.round(remaining)} ft of the day's footage is not located by the operations text and was shared between drilling entries by duration (inferred).`);
      } else if (open.length) issue('warning', 'footage_unknown', `${iso(d.date).slice(0, 10)}: ${open.length} drilling entr${open.length > 1 ? 'ies have' : 'y has'} no depth interval and the day's depths are not reported, so no footage is assigned to them.`);
      if (hole == null) hole = start;
      for (const x of res) {
        const { op } = x;
        if (!(x.hours > 0)) { issue('warning', 'bad_time', `Operation at ${op.src} has no usable duration and is not placed on the timeline (it is kept in the extraction report).`); continue; }
        const drilling = x.activity === 'ROT' || x.activity === 'SLD', hasFt = drilling && x.from != null;
        if (hasFt && hole != null && Math.abs(x.from! - hole) > 60) issue('warning', 'depth_gap', `Depth discontinuity before ${op.src}: previous hole depth ${Math.round(hole)} ft, this interval starts at ${Math.round(x.from!)} ft.`);
        const probs = op.facts.problems.filter(p => !p.negated);
        negated += op.facts.problems.length - probs.length;
        // an operation that falls inside an event of the report's own NPT table is NPT by the report's classification;
        // when the report classifies every entry (a productive / NPT column), that classification is final
        const inNptTable = nptEvents.some(e => e.a != null && e.b != null && Math.min(op.t1!, e.b) - Math.max(op.t0, e.a) >= 0.5 * (op.t1! - op.t0));
        const nptKind: OpOut['npt'] = op.nptFlag || inNptTable ? 'flag' : op.flagText != null ? null
          : op.facts.durations.some(q => q.npt === 'explicit') || /\bnpt\b|non[- ]?productive|down ?time|lost time/i.test(op.text) ? 'explicit'
          : x.activity === 'WOO' || op.facts.durations.some(q => q.npt === 'candidate') ? 'candidate' : null;
        const counted = nptKind === 'flag' || nptKind === 'explicit' || (nptKind === 'candidate' && accept.has(op.id));
        if (nptKind === 'candidate') nptCandidates.push({ id: op.id, start: iso(op.t0), hours: round(x.hours), text: op.text, src: op.src });
        // parameters written in this operation's cell, in the operation's own context (a reaming flow rate is not a drilling flow rate)
        const dctx: Context[] = ['drilling', 'general'];
        const octx: Context[] = [...new Set<Context>([ACT_CTX[x.activity] ?? op.ctx, op.ctx, 'general'])];
        const pick = (keys: string[], ctxs: Context[] | null, tests = false) => { for (const k of keys) { const h = op.hits.find(y => live(y) && y.key === k && y.canonical != null && (ctxs == null || ctxs.includes(y.context)) && (tests || !/scr|test|step/.test(y.qualifier ?? ''))); if (h) return h; } return null; };
        const val = (h: InCellHit | null) => (h?.canonical == null ? null : round(h.canonical, 2));
        const pr = {
          wob: drilling ? pick(['wob'], dctx) : null, rpm: pick(['rpm_surface', 'rpm'], drilling ? dctx : octx), torque: pick(['torque'], drilling ? dctx : octx),
          spp: pick(['spp'], drilling ? dctx : octx), flow: pick(['flow'], drilling ? dctx : octx), diff: drilling ? pick(['diff_pressure'], dctx) : null, hook: pick(['hook_load'], null),
          mw: pick(['mud_weight'], null), ropAvg: drilling ? pick(['rop_avg', 'rop'], dctx) : null, ropInst: drilling ? pick(['rop_inst'], dctx) : null,
        };
        const hs = op.holeSize ?? holeSize(d);
        if (pr.mw) { lastMw = { v: pr.mw.canonical!, src: pr.mw.src, hole: hs }; }
        else if (lastMw && lastMw.hole !== hs) lastMw = null;   // a new hole section starts with a new mud system
        const mw = pr.mw ? val(pr.mw) : lastMw ? round(lastMw.v, 2) : f(d, 'mud_weight');
        const ropN = pr.ropAvg ? pr.ropAvg.canonical : op.facts.rop && !op.hits.length ? (op.facts.rop.unit === 'm/h' || (!op.facts.rop.unit && o.depthUnit === 'm') ? mToFt(op.facts.rop.value) : op.facts.rop.value) : null;
        const rop = hasFt ? ropN ?? (x.to! - x.from!) / x.hours : null;
        if (hasFt) { note('md', x.st, x.st === 'confirmed' ? 0.93 : 0.6, op.src, `${Math.round(x.from!)} - ${Math.round(x.to!)} ft`); note('footage', 'inferred', 0.9, op.src, `${Math.round(x.to! - x.from!)} ft (calculated from the interval)`); }
        if (ropN == null && rop != null) note('rop_avg', 'inferred', 0.8, op.src, `${round(rop, 1)} ft/h (footage / hours)`);
        else if (!pr.ropAvg && ropN != null && op.facts.rop) note(op.facts.rop.kind === 'average' ? 'rop_avg' : op.facts.rop.kind === 'instantaneous' ? 'rop_inst' : 'rop', 'confirmed', op.facts.rop.conf, op.src, `${op.facts.rop.value} ${op.facts.rop.unit ?? ''}`);
        note('activity', op.code ? 'confirmed' : 'suspected', op.code ? 0.9 : 0.75, op.src, x.activity);
        const stated = op.hits.find(h => live(h) && h.key === 'formation');
        // bit position while tripping, when the text gives the trip interval ("POOH ... from 601 m to 257 m")
        const tripIv = !drilling ? op.facts.intervals.find(i => i.kind === 'trip') : null;
        const b0 = tripIv ? toFt(tripIv.from, tripIv.unit, o.depthUnit) : null, b1 = tripIv ? toFt(tripIv.to, tripIv.unit, o.depthUnit) : null;
        if (hasFt) note('bit_depth', 'inferred', 0.8, op.src, 'equal to the hole depth while drilling');
        else if (tripIv) note('bit_depth', 'inferred', 0.7, op.src, `interpolated along the trip "${tripIv.from}–${tripIv.to}${tripIv.unit ? ' ' + tripIv.unit : ''}"`);
        const n = Math.max(1, Math.ceil(x.hours / STEP_H - 1e-9)), dt = x.hours / n;
        const startHole = hole;
        const holeHere = !hasFt && op.dTo != null ? op.dTo : hole;   // the depth columns give the hole depth of every entry
        const extraOp = () => {
          const e: Record<string, unknown> = d.ops[0] === op ? { ...(extras(d) ?? {}) } : {};
          if (op.code) e.operation = op.code;
          if (op.phase) e.phase = op.phase;
          if (pr.ropInst) e['on-bottom ROP'] = `${round(pr.ropInst.canonical!, 1)} ft/h (${pr.ropInst.text})`;
          if (!pr.mw && lastMw) e['mud weight'] = `${round(lastMw.v, 2)} ppg carried from ${lastMw.src}`;
          if (b0 != null) e['bit depth'] = `interpolated from "${tripIv!.from}–${tripIv!.to}${tripIv!.unit ? ' ' + tripIv!.unit : ''}" in the text`;
          for (const h of op.hits) {
            if (!live(h) || RECORD_KEYS.has(h.key) || h.method === 'negative statement') continue;
            const k = h.qualifier ? `${h.label} (${h.qualifier})` : h.label;
            if (!(k in e) && Object.keys(e).length < 40) e[k] = h.canonical != null && h.canonicalUnit ? `${round(h.canonical, 2)} ${h.canonicalUnit} (${h.text})` : String(h.value);
          }
          return Object.keys(e).length ? e : null;
        };
        for (let k = 0; k < n; k++) {
          const now: number | null = hasFt ? x.from! + ((x.to! - x.from!) * (k + 1)) / n : holeHere;
          const formation = (typeof stated?.value === 'string' ? stated.value : null) ?? (now != null ? fmAt(now) : null) ?? op.facts.formation?.name ?? (typeof d.fields.formation?.value === 'string' ? (d.fields.formation.value as string) : null);
          const bit = hasFt ? now : b0 != null && b1 != null ? Math.max(0, Math.min(b0 + ((b1 - b0) * (k + 1)) / n, now ?? Infinity)) : null;
          dayRecs.push({
            ...base(), ts: iso(op.t0 + k * dt * HOUR), md_ft: now == null ? null : round(now, 1), hole_depth_ft: now == null ? null : round(now, 1), bit_depth_ft: bit == null ? null : round(bit, 1),
            rop_fph: rop == null ? null : round(rop, 1),
            wob_klb: drilling ? val(pr.wob) ?? f(d, 'wob') : null, rpm: val(pr.rpm) ?? (drilling ? f(d, 'rpm') : null), torque_ftlb: val(pr.torque) ?? (drilling ? f(d, 'torque') : null), spp_psi: val(pr.spp) ?? (drilling ? f(d, 'spp') : null),
            diff_pressure_psi: val(pr.diff) ?? (drilling ? f(d, 'diff_pressure') : null), flow_gpm: val(pr.flow) ?? (drilling ? f(d, 'flow') : null), hook_load_klb: val(pr.hook) ?? (drilling ? f(d, 'hook_load') : null),
            mud_weight_ppg: mw, hole_size_in: hs, bha_number: f(d, 'bha'),
            npt_hours: counted ? round(dt, 4) : 0, activity_code: counted && !drilling ? 'WOO' : x.activity, activity_raw: k === 0 ? op.text.slice(0, 500) : null,
            formation_name: formation, problem_text: probs[0]?.label ?? null, source_ref: op.src, data_quality: n > 1 || x.st !== 'confirmed' ? 'interpolated' : 'reported',
            extra: k === 0 ? extraOp() : null,
          });
        }
        if (hasFt) hole = x.to!;
        else if (op.dTo != null) hole = op.dTo;
        const md0 = hasFt ? x.from! : holeHere ?? startHole ?? (op.facts.depths[0] ? toFt(op.facts.depths[0].value, op.facts.depths[0].unit, o.depthUnit) : null);
        for (const h of op.hits) hitMeta.set(h.id, { ts: iso(op.t0), md: h.depth[0] ? round(toFt(h.depth[0].value, h.depth[0].unit, o.depthUnit), 1) : md0 == null ? null : round(md0, 1) });
        // NPT the report classifies with a category: one event per run of consecutive entries (problems below must not count it again)
        const reportNpt = counted && nptKind === 'flag' && !!(op.nptCat || op.nptSub);
        if (reportNpt) nptOps.push({ op, hours: x.hours, md: md0, hole: hs, formation: (typeof stated?.value === 'string' ? stated.value : null) ?? (md0 != null ? fmAt(md0) : null) });
        const groupLabel = [op.nptCat, op.nptSub].filter(Boolean).join(' – ');
        for (const p of probs) {
          const dur = op.facts.durations.find(q => q.npt !== 'none') ?? null;
          const depthHere = p.sentence && op.hits.find(h => h.line.includes(p.sentence.slice(0, 30)) && h.depth.length)?.depth[0];
          const pmd = depthHere ? toFt(depthHere.value, depthHere.unit, o.depthUnit) : md0;
          addProblem({
            category: p.category, label: p.label, ts: iso(op.t0), md: pmd == null ? null : round(pmd, 1), mdBottom: hasFt ? round(x.to!, 1) : null,
            formation: (typeof stated?.value === 'string' ? stated.value : null) ?? op.facts.formation?.name ?? (pmd != null ? fmAt(pmd) : null), holeSize: hs,
            nptHours: counted && !reportNpt ? round(x.hours) : 0, reportedHours: dur?.hours ?? null,
            nptBasis: reportNpt ? `the time of this entry is counted under the report's NPT event "${groupLabel}"` : counted ? (nptKind === 'flag' ? 'entry is classified NPT in the report' : nptKind === 'explicit' ? 'text states NPT / downtime' : 'accepted by the engineer') : dur ? `${dur.hours} h reported in the text as ${dur.npt === 'candidate' ? 'a possible NPT event' : 'problem-related time'} - not counted as NPT until verified` : op.flagText ? `entry is classified "${op.flagText}" in the report - not NPT` : 'no duration reported',
            description: p.sentence, sourceText: op.text, src: op.src, actions: op.facts.actions, confidence: p.conf, status: 'suspected',
          }, d.date);
          note('problem', 'suspected', p.conf, op.src, p.label);
        }
        opInfo.set(op.id, { counted, md0: hasFt ? x.from! : holeHere ?? null, md1: hasFt ? x.to! : holeHere ?? null, progress: hasFt, activity: x.activity, holeSize: hs });
        outs.push({ id: op.id, start: iso(op.t0), end: iso(op.t1!), hours: round(x.hours), activity: x.activity, text: op.text, src: op.src, npt: nptKind, nptCounted: counted,
          interval: hasFt ? { from: round(x.from!, 1), to: round(x.to!, 1), status: x.st } : null, rop: rop == null ? null : round(rop, 1), formation: (typeof stated?.value === 'string' ? stated.value : null) ?? op.facts.formation?.name ?? null, problems: probs.map(p => p.label),
          task: op.code, params: op.hits.filter(h => live(h) && h.method !== 'negative statement').slice(0, 16).map(h => h.text.length > 48 ? h.text.slice(0, 46) + '…' : h.text) });
      }
      if (dayEnd != null && hole != null && Math.abs(hole - dayEnd) > 10) issue('warning', 'depth_mismatch', `${iso(d.date).slice(0, 10)}: the operations text ends at ${Math.round(hole)} ft but the report header gives ${Math.round(dayEnd)} ft (${d.fields.md?.src ?? ''}).`);
      const total = dayRecs.length ? res.reduce((s, x) => s + Math.max(0, x.hours), 0) : 0;
      if (total > 24.5) issue('warning', 'time_overrun', `${iso(d.date).slice(0, 10)}: operations add up to ${round(total, 1)} h, more than 24 h.`);
    } else if (!tsRecords.length && (dayEnd != null || footage != null)) {
      // daily summary only: one record per report day, hours taken from the reported hour columns
      if (mode === 'none') mode = 'daily summary';
      const start: number | null = hole ?? f(d, 'depth_from') ?? (dayEnd != null && footage != null ? dayEnd - footage : null);
      const end: number | null = dayEnd ?? (start != null && footage != null ? start + footage : null);
      const ropR = f(d, 'rop_avg') ?? f(d, 'rop');
      let dh = f(d, 'drilling_hours') ?? f(d, 'rotating_hours');
      if (dh == null && ropR && end != null && start != null && end > start) { dh = round((end - start) / ropR, 2); note('drilling_hours', 'inferred', 0.7, d.src, `${dh} h (footage / ROP)`); }
      if (hole == null && start != null && end != null && end > start) dayRecs.push({ ...base(), ts: iso(d.date), md_ft: start, hole_depth_ft: start, drilling_hours: 0, npt_hours: 0, activity_code: 'OTH', source_ref: d.src, data_quality: 'reported' });
      if (end != null) {
        dayRecs.push({ ...base(), ts: iso(d.date + (dayRecs.length ? 60000 : 0)), md_ft: round(end, 1), hole_depth_ft: round(end, 1), tvd_ft: f(d, 'tvd'), rop_fph: ropR, wob_klb: f(d, 'wob'), rpm: f(d, 'rpm'), torque_ftlb: f(d, 'torque'), spp_psi: f(d, 'spp'),
          diff_pressure_psi: f(d, 'diff_pressure'), flow_gpm: f(d, 'flow'), mud_weight_ppg: f(d, 'mud_weight'), hook_load_klb: f(d, 'hook_load'), drilling_hours: dh ?? 0, circulating_hours: f(d, 'circ_hours'), connection_time_min: f(d, 'connection_time'),
          npt_hours: f(d, 'npt') ?? 0, activity_code: dh ? 'ROT' : 'OTH', formation_name: fmAt(end) ?? (typeof d.fields.formation?.value === 'string' ? (d.fields.formation.value as string) : null),
          bha_number: f(d, 'bha'), hole_size_in: holeSize(d), source_ref: d.src, data_quality: 'reported', extra: extras(d) });
        hole = end;
      }
    }
    // NPT events with clock times mark the timeline; reported totals that the log does not locate are spread over non-drilling time
    for (const e of nptEvents.filter(x => x.date === d.date && x.a != null && x.b != null))
      for (const r of dayRecs) { const t = Date.parse(r.ts); if (t >= e.a! && t < e.b! && r.activity_code !== 'ROT' && r.activity_code !== 'SLD') { r.npt_hours = STEP_H; r.activity_code = 'WOO'; } }
    const untimed = nptEvents.filter(x => x.date === d.date && (x.a == null || x.b == null) && x.hours != null);
    const reported = f(d, 'npt') ?? (untimed.length ? Math.min(24, untimed.reduce((s, x) => s + x.hours!, 0)) : null);
    if (reported != null && dayRecs.length > 1) {
      const placed = dayRecs.reduce((s, r) => s + (r.npt_hours ?? 0), 0), idle = dayRecs.filter(r => !(r.npt_hours! > 0) && r.activity_code !== 'ROT' && r.activity_code !== 'SLD');
      const miss = reported - placed;
      if (miss > 0.25 && idle.length) {
        const each = Math.min(STEP_H, miss / idle.length);
        idle.forEach(r => { r.npt_hours = round(each, 4); });
        issue('info', 'npt_spread', `${iso(d.date).slice(0, 10)}: ${round(miss, 1)} h of reported NPT has no clock time in the report; it is spread over the day's non-drilling time so daily totals match (placement inferred).`);
      }
    }
    for (const n of d.narratives) {
      if (n.planned) continue;
      const pr = n.facts.problems.filter(p => !p.negated);
      negated += n.facts.problems.length - pr.length;
      for (const p of pr) {
        const dur = n.facts.durations.find(q => q.npt !== 'none') ?? null, dep = n.facts.intervals[0]?.from ?? n.facts.depths[0]?.value ?? null;
        addProblem({ category: p.category, label: p.label, ts: iso(d.date), md: dep == null ? null : round(toFt(dep, n.facts.intervals[0]?.unit ?? n.facts.depths[0]?.unit ?? null, o.depthUnit), 1), mdBottom: null, formation: n.facts.formation?.name ?? null, holeSize: holeSize(d),
          nptHours: dur?.npt === 'explicit' ? dur.hours : 0, reportedHours: dur?.hours ?? null, nptBasis: dur ? (dur.npt === 'explicit' ? 'text states NPT / downtime' : `${dur.hours} h reported in the text - not counted as NPT until verified`) : 'no duration reported',
          description: p.sentence, sourceText: n.text, src: n.src, actions: n.facts.actions, confidence: p.conf, status: 'suspected' }, d.date);
        note('problem', 'suspected', p.conf, n.src, p.label);
      }
      if (!d.ops.length) for (const ivl of n.facts.intervals.filter(x => x.kind === 'drill')) note('md', 'confirmed', ivl.conf, n.src, `${ivl.from} - ${ivl.to}`);
      if (n.facts.rop) note(n.facts.rop.kind === 'average' ? 'rop_avg' : 'rop', 'confirmed', n.facts.rop.conf, n.src, `${n.facts.rop.value} ${n.facts.rop.unit ?? ''}`);
      if (n.facts.formation) note('formation', n.facts.formation.conf > 0.9 ? 'confirmed' : 'suspected', n.facts.formation.conf, n.src, n.facts.formation.name);
    }
    if (!tsRecords.length) records.push(...dayRecs);
    opsOut.set(d.date, outs);
  }
  // NPT the report classifies on its operations: consecutive entries with the same NPT category / sub-category /
  // responsible party are one event; its NPT is the sum of those entries' durations (each entry counted once)
  for (let i = 0; i < nptOps.length;) {
    const g = [nptOps[i]];
    const same = (a: typeof g[0], b: typeof g[0]) => a.op.nptCat === b.op.nptCat && a.op.nptSub === b.op.nptSub && a.op.nptVendor === b.op.nptVendor && Math.abs(a.op.t1! - b.op.t0) <= 60000;
    while (i + g.length < nptOps.length && same(g[g.length - 1], nptOps[i + g.length])) g.push(nptOps[i + g.length]);
    i += g.length;
    const first = g[0], label = [first.op.nptCat, first.op.nptSub].filter(Boolean).join(' – ');
    const hours = round(g.reduce((s, x) => s + x.hours, 0), 2);
    const headline = (t: string) => t.split(/\r?\n/)[0].trim();
    const code = nptCode(`${first.op.nptCat ?? ''} ${first.op.nptSub ?? ''}`);
    // the same event read from the text of these entries ("pipe got stuck ...") is this NPT event, not a second problem
    const srcs = new Set(g.map(x => x.op.src));
    const dupText = problems.filter(p => p.category === code && p.src.split(/;\s*/).every(s => srcs.has(s)));
    for (const p of dupText) problems.splice(problems.indexOf(p), 1);
    problems.push({
      id: `p${problems.length + 1}`, category: code, label: label || 'NPT event', ts: iso(first.op.t0),
      md: first.md == null ? null : round(first.md, 1), mdBottom: null, formation: first.formation, holeSize: first.hole,
      nptHours: hours, reportedHours: hours, nptBasis: `${g.length} entr${g.length > 1 ? 'ies' : 'y'} classified "${first.op.flagText}" in the report${first.op.nptVendor ? `; responsible: ${first.op.nptVendor}` : ''}`,
      // the label is added to the description when the problem is saved
      description: g.map(x => headline(x.op.text)).join(' → ').slice(0, 1500), sourceText: g.map(x => x.op.text).join('\n---\n').slice(0, 6000), src: compactRefs(g.map(x => x.op.src)),
      actions: [...new Set([...g.flatMap(x => x.op.facts.actions), ...dupText.flatMap(p => p.actions)])], confidence: dupText.length ? 0.97 : 0.92, status: 'suspected', severity: hours >= 12 ? 'high' : 'medium',
    });
    if (dupText.length) problems[problems.length - 1].description = `${problems[problems.length - 1].description} | ${dupText.map(p => p.description).join(' | ')}`.slice(0, 1500);
    note('npt', 'confirmed', 0.95, first.op.src, `${hours} h – ${label}`);
    note('problem', 'suspected', 0.92, first.op.src, label);
  }
  // ------------------------------------------------------------------ operations, BHA runs, tools, casing, cementing, hole sections
  const eqOps: EqOp[] = allOps.filter(op => opInfo.has(op.id) && op.t1 != null).map(op => {
    const i = opInfo.get(op.id)!;
    return { id: op.id, t0: op.t0, t1: op.t1!, text: op.text, task: op.code, phase: op.phase, src: op.src, holeSize: i.holeSize, md0: i.md0 == null ? null : round(i.md0, 1), md1: i.md1 == null ? null : round(i.md1, 1),
      progress: i.progress, hits: op.hits, nptCounted: i.counted, nptCategory: [op.nptCat, op.nptSub].filter(Boolean).join(' – ') || null, activity: i.activity };
  });
  const eq = extractEquipment(eqOps);
  if (eq.bhaRuns.length) {
    // each record carries the BHA run that was in the hole at its time
    const spans = eq.bhaRuns.map(b => ({ n: b.runNo, a: Date.parse(b.start), z: b.end ? Date.parse(b.end) : Infinity }));
    for (const r of records) { const t = Date.parse(r.ts); const s = spans.find(x => t >= x.a && t < x.z); if (s && r.bha_number == null) r.bha_number = s.n; }
    note('bha', 'inferred', 0.85, eq.bhaRuns[0].src, `${eq.bhaRuns.length} BHA runs from the make-up / lay-down entries`);
  }
  const sections = eq.operations.length ? holeSections(eq, records) : [];
  for (const w of eq.warnings) issue('warning', 'equipment_inconsistent', w);
  if (eq.operations.length) {
    const unspecified = eq.operations.filter(x => x.code === 'UNSPECIFIED').length;
    if (unspecified) issue('info', 'operation_unspecified', `${unspecified} operation(s) could not be named from the report (no task code and no clear description); they are shown as "Not specified in report" for an engineer to correct.`);
    const noOd = eq.tools.filter(t => t.od == null && t.category !== 'Well Control' && t.type !== 'Centralizers' && t.type !== 'Crossover').length;
    if (noOd) issue('info', 'tool_dimension_missing', `${noOd} of ${eq.tools.length} tools have no outer diameter written in the report; they are shown as "Not available".`);
  }

  if (depthTextMismatch.length) issue('warning', 'depth_text_mismatch', `${depthTextMismatch.length} drilling entr${depthTextMismatch.length > 1 ? 'ies' : 'y'} state a different interval in the text than in the depth columns; the columns are used. First: ${depthTextMismatch.slice(0, 3).join('; ')}.`);
  for (const e of nptEvents) {
    const cat = guessCategory(`${e.category} ${e.text}`);
    addProblem({ category: cat, label: e.category || e.text.slice(0, 60), ts: e.a != null ? iso(e.a) : e.date != null ? iso(e.date) : null, md: e.md, mdBottom: null, formation: e.md != null ? fmAt(e.md) : null, holeSize: null,
      nptHours: e.hours ?? 0, reportedHours: e.hours, nptBasis: 'listed in the report\'s NPT table', description: e.text, sourceText: e.text, src: e.src, actions: e.action ? [e.action] : [], confidence: 0.85, status: 'suspected' }, e.date);
    if (e.action) note('corrective', 'confirmed', 0.9, e.src, e.action.slice(0, 60));
  }
  for (const p of problems) if (p.actions.length) note('corrective', 'suspected', 0.7, p.src, p.actions[0].slice(0, 60));
  if (tsRecords.length && sortedDays.some(d => d.ops.length)) issue('info', 'ops_not_merged', 'The workbook has both a time-based data table and an operations log. Records come from the time-based table; the operations log is used for problems, events and the extraction report.');
  if (needsDate) issue('error', 'no_date', 'Some operations have no date: the report gives no report date. Enter the report date above and the extraction is repeated.');
  // assign formations to time-series records that have none, from the formation table (inferred by depth)
  if (formations.length) for (const r of records) if (!r.formation_name) { const dpt = r.hole_depth_ft ?? r.md_ft; if (dpt != null) r.formation_name = fmAt(dpt); }
  // final relational checks on the records
  let prevT = '';
  for (const r of records) {
    if (r.tvd_ft != null && r.md_ft != null && r.tvd_ft > r.md_ft * 1.01 + 1) issue('warning', 'unit_inconsistent', 'TVD is greater than MD in some records - check units and column meaning.');
    if (r.ts === prevT) issue('warning', 'duplicate', 'Two extracted records share the same timestamp.');
    prevT = r.ts;
  }

  // ------------------------------------------------------------------ report
  const params: ParamSummary[] = CHECKLIST.map(key => {
    const s = seen.get(key), c = CONCEPT[key];
    return s ? { key, label: c.label, group: c.group, status: s.status, confidence: round(s.conf), count: s.n, src: s.src, sample: s.sample } : { key, label: c.label, group: c.group, status: 'missing', confidence: 0, count: 0, src: '', sample: '' };
  });
  return {
    sheets: structs.map((st, i) => ({
      name: st.sheet.name, hidden: st.sheet.hidden, rows: st.sheet.nRows, cols: st.sheet.nCols, merges: st.sheet.merges, formulas: st.sheet.formulas, hiddenRows: st.sheet.hiddenRows.size, hiddenCols: st.sheet.hiddenCols.size,
      excluded: excluded[i], sections: st.sections.map(s => s.title), kv: st.kvs.length, narratives: st.narratives.length,
      tables: [
        ...tinfos.filter(x => x.si === i).map(x => ({ title: x.t.title, range: `${A1(x.t.headerTop, x.t.cols[0].c)}:${A1(x.t.r1, x.t.cols[x.t.cols.length - 1].c)}`, kind: x.kind, rows: x.t.r1 - x.t.r0 + 1,
          columns: x.cols.map(c => ({ header: c.header || '(no header)', concept: c.concept ? (c.dup ? `${c.concept.label} (duplicate: ${c.dup})` : x.by.hole_size === c || (x.by.hole_size?.c === c.c && c.concept.key === 'hole_section') ? `${c.concept.label} → hole size (in)` : c.concept.label) : null, confidence: round(c.score), unit: c.unit })) })),
        ...st.ttables.map(tt => ({ title: tt.title, range: `${A1(tt.headerRow, tt.labelCol)}:${A1(tt.rows[tt.rows.length - 1].r, tt.valueCols[tt.valueCols.length - 1].c)}`, kind: 'horizontal (parameters down, periods across)', rows: tt.rows.length,
          columns: tt.rows.map(r => { const k = classify(r.label, learned); return { header: r.label, concept: k && k.score >= 0.7 ? k.concept.label : null, confidence: k ? round(k.score) : 0, unit: headerUnit(r.label)?.unit ?? null }; }) })),
      ],
    })),
    wellInfo,
    days: sortedDays.map(d => ({ date: iso(d.date).slice(0, 10), src: d.src, fields: d.fields, ops: opsOut.get(d.date) ?? [], narratives: d.narratives.map(n => ({ label: n.label, text: n.text, src: n.src, planned: n.planned })) })),
    records, recordMode: mode, stations, formations, problems, negatedMentions: negated, nptCandidates,
    params, unresolved: [...unresolved.values()], unclassified, issues, needsDate, depthUnitAssumed: depthUnitAssumed && !depthUnitExplicit,
    cellParams: allHits.map(h => ({ ...h, ts: hitMeta.get(h.id)?.ts ?? null, md_ft: hitMeta.get(h.id)?.md ?? (h.depth[0] ? round(toFt(h.depth[0].value, h.depth[0].unit, o.depthUnit), 1) : null) })),
    coverage, lithology, dateOrder,
    operations: eq.operations, bhaRuns: eq.bhaRuns, tools: eq.tools, casings: eq.casings, cementJobs: eq.cementJobs, holeSections: sections,
  };
}
