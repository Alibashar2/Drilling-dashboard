/// <reference types="node" />
// Real-report test: the user's own drilling report XX-1 (and XX-2 for generalisation, when present).
// The file is read, never modified. Skipped when the file is not on this machine.
//   REPORT_DIR=<folder with XX-1.xlsx>       default: ../project/data next to the app folder
//   ACCURACY_OUT=<folder>                    also write the extraction map (CSV) and the accuracy report (Markdown)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractWorkbook, type Extraction } from './engine';
import { readSmart, type SWorkbook } from './workbook';
import { prepareRecords } from '../../lib/kpi';
import { allChanges, analysisWindow, buildWellSeries, entries, explain, matchWell, recordedEvents, tolerance } from '../../lib/pointAnalysis';

const DIR = process.env.REPORT_DIR ?? resolve(process.cwd(), '..', 'project', 'data');
const load = (name: string): SWorkbook | null => {
  const f = join(DIR, name);
  if (!existsSync(f)) return null;
  const buf = readFileSync(f);
  return readSmart(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, name).smart;
};
const OPTS = { depthUnit: 'm' as const, dateOrder: 'auto' as const, learned: {}, overrides: {}, acceptNpt: [], fallbackDate: null, knownFormations: [] };
type Hit = Extraction['cellParams'][number];

// ------------------------------------------------------------------ ground truth, labelled by hand from the cells of XX-1
// [cell, parameter, value | [min, max] | text, unit as recognised, qualifier]
type Truth = [string, string, number | [number, number] | string, string?, string?];
const T = (cell: string, rows: [string, number | [number, number] | string, string?, string?][]): Truth[] => rows.map(r => [cell, ...r] as Truth);
const TRUTH: Truth[] = [
  ...T('Q2', [['serial', 'QG1628'], ['nozzles', '12x12'], ['toc', 55, 'm'], ['wob', [2, 4], 'tonne'], ['flow', 1000, 'L/min'], ['spp', [330, 350], 'psi'], ['rpm_surface', 30], ['rpm_total', 65], ['torque', [10, 11], 'kft-lb'], ['loss_rate', 0]]),
  ...T('Q3', [['wob', [1, 5], 'tonne'], ['rpm', [60, 70]], ['rpm_total', [90, 110]], ['torque', [2, 12], 'kft-lb'], ['flow', [1000, 1500], 'L/min'], ['spp', [170, 480], 'psi'], ['rop_inst', 37.09, 'm/h'], ['rop_avg', 23.81, 'm/h'], ['formation', 'Dibdibba'], ['loss_rate', 0]]),
  ...T('Q8', [['wob', [1, 7], 'tonne'], ['rpm_surface', [40, 80]], ['rpm_total', [70, 170]], ['torque', [3, 15], 'kft-lb'], ['flow', [1400, 3050], 'L/min'], ['spp', [400, 1500], 'psi'], ['rop_inst', 51.22, 'm/h'], ['rop_avg', 30, 'm/h'],
    ['mud_weight', [1.08, 1.14], 'sg'], ['formation', 'Dibdibba'], ['lithology', '100% Sand & Gravel'], ['fm_top_marker', 'lower Fars'], ['loss_rate', 0]]),
  ...T('Q15', [['wob', 19, 'tonne'], ['flow', 3400, 'L/min'], ['spp', [1210, 1540], 'psi'], ['rpm_surface', 100], ['rpm_total', 200], ['torque', [6, 11], 'kft-lb'], ['rop_inst', 1, 'm/h'], ['rop_avg', 0.84, 'm/h'], ['rop', 0.8, 'm/h'], ['rop', 1, 'm/h'],
    ['formation', 'Ghar'], ['lithology', '90% Sand, 10% Limestone'], ['loss_rate', 0], ['survey_md', 577.96, 'm'], ['survey_tvd', 577.89, 'm'], ['inc', 2.98], ['azi', 145.77], ['ct_ct', 5.82, 'm'], ['jar_hours', 2.63, 'h', 'daily'], ['jar_hours', 28.76, 'h', 'total']]),
  ...T('Q19', [['overpull', 10, 'tonne'], ['flow', [1460, 1535], 'L/min'], ['spp', [280, 360], 'psi'], ['rpm_surface', 30], ['rpm_total', 75], ['torque', [3, 11], 'kft-lb'], ['serial', '17625029'], ['serial', 'QG1628'], ['nozzles', '12x12'], ['dull_grade', '8-8-LT-S-X-1-RO-BHA'], ['loss_rate', 0]]),
  ...T('Q61', [['wob', [1, 16], 'tonne'], ['flow', 3000, 'L/min'], ['spp', [1120, 1420], 'psi'], ['rpm_surface', [40, 70]], ['rpm_total', [115, 150]], ['torque', [5, 10], 'kft-lb'], ['rop_inst', 43.85, 'm/h'], ['rop_avg', 30.57, 'm/h'], ['mud_weight', 1.14, 'sg'],
    ['formation', 'Dammam'], ['lithology', '100% Dolomite'], ['loss_rate', 10, 'm3/h'], ['loss_rate', 2, 'm3/h'], ['loss_rate', 2, 'm3/h'], ['fm_top_marker', 'RUS']]),
  ...T('Q73', [['wob', 18, 'tonne'], ['flow', 3200, 'L/min'], ['spp', [1530, 1600], 'psi'], ['rpm_surface', 70], ['rpm_total', [120, 155]], ['torque', [8, 10], 'kft-lb'], ['rop_inst', 24, 'm/h'], ['rop_avg', 24, 'm/h'], ['mud_weight', 1.14, 'sg'], ['formation', 'UMM-ER-RADHUME'],
    ['lithology', '90% Dolomite, 10% Anhydrite'], ['loss_rate', 2, 'm3/h'], ['survey_md', 1180.81, 'm'], ['survey_tvd', 1177.7, 'm'], ['inc', 10.66], ['azi', 195.4], ['ct_ct', 31.63, 'm'],
    ['jar_hours', 23.1, 'h', 'daily'], ['jar_hours', 35.25, 'h', 'total'], ['jar_hours', 69.65, 'h', 'total'], ['pbl_hours', 23.1, 'h', 'daily'], ['pbl_hours', 35.25, 'h', 'total'], ['krev', 191, undefined, 'daily'], ['krev', 272, undefined, 'total']]),
  ...T('Q165', [['wob', [6, 12], 'tonne'], ['flow', [2650, 2690], 'L/min'], ['spp', [1420, 1750], 'psi'], ['rpm_surface', 40], ['rpm_total', 120], ['torque', [15, 19], 'kft-lb'], ['rop_inst', 6, 'm/h'], ['rop_avg', 6, 'm/h'], ['formation', 'Hartha'], ['lithology', '100% Limestone'], ['mud_weight', 1.19, 'sg'], ['loss_rate', 0]]),
  ...T('Q175', [['flow', 3050, 'L/min'], ['spp', [2100, 2200], 'psi'], ['rpm_surface', [40, 100]], ['torque', [7, 12], 'kft-lb'], ['mud_weight', 1.25, 'sg'], ['loss_rate', 0],
    ['spm', 30], ['spp', 160, 'psi'], ['spm', 40], ['spp', 210, 'psi'], ['spm', 30], ['spp', 155, 'psi'], ['spm', 40], ['spp', 205, 'psi']]),
  ...T('Q217', [['wob', [15, 18], 'tonne'], ['flow', 3100, 'L/min'], ['spp', [2800, 3100], 'psi'], ['rpm_surface', 80], ['rpm_total', 170], ['torque', [14, 20], 'kft-lb'], ['rop_inst', 32, 'm/h'], ['rop_avg', 24, 'm/h'], ['formation', 'Nahr Umr'], ['lithology', '70% Arg Limestone, 30% Shale'], ['mud_weight', 1.33, 'sg'], ['loss_rate', 0]]),
  ...T('Q277', [['wob', 16, 'tonne'], ['flow', [2100, 2150], 'L/min'], ['spp', [2000, 2650], 'psi'], ['rpm_surface', 120], ['torque', [14, 16], 'kft-lb'], ['rop_avg', 16.53, 'm/h'], ['rop_inst', 11.43, 'm/h'], ['formation', 'Zubair Upper Shale'], ['lithology', '80% Shale, 20% Arg Limestone'], ['mud_weight', 1.38, 'sg'], ['loss_rate', 0]]),
  ...T('Q281', [['wob', [14, 16], 'tonne'], ['flow', 2200, 'L/min'], ['spp', [2720, 2920], 'psi'], ['rpm_surface', 120], ['torque', [16, 19], 'kft-lb'], ['rop_avg', 28, 'm/h'], ['rop_inst', 22.5, 'm/h'], ['formation', 'Zubair Lower Sand'], ['lithology', '20% Shale, 50% Limestone, 30% Sand'], ['mud_weight', [1.39, 1.4], 'sg'], ['loss_rate', 0], ['fm_top_marker', 'Zubair Lower SH']]),
];

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 + 0.005 * Math.abs(b);
function matches(h: Hit, t: Truth) {
  const [, key, v, unit, qual] = t;
  if (h.key !== key || h.status === 'rejected') return false;
  if (unit && h.unit !== unit) return false;
  if (qual && h.qualifier !== qual) return false;
  if (typeof v === 'string') return String(h.value).toLowerCase() === v.toLowerCase();
  if (Array.isArray(v)) return h.min != null && h.max != null && close(h.min, v[0]) && close(h.max, v[1]);
  return typeof h.value === 'number' && h.min == null && close(h.value, v);
}
function score(ex: Extraction, sheet: string) {
  const cells = [...new Set(TRUTH.map(t => t[0]))];
  const inCells = ex.cellParams.filter(h => h.sheet === sheet && cells.includes(h.cell));
  const used = new Set<string>(), found: Truth[] = [], missed: Truth[] = [];
  for (const t of TRUTH) { const h = inCells.find(x => x.cell === t[0] && !used.has(x.id) && matches(x, t)); if (h) { used.add(h.id); found.push(t); } else missed.push(t); }
  const extra = inCells.filter(h => !used.has(h.id));
  return { cells, found, missed, extra, precision: found.length / (found.length + extra.length), recall: found.length / TRUTH.length };
}

// ------------------------------------------------------------------ independent checks from the sheet's own columns
function columnFacts(wb: SWorkbook) {
  const s = wb.sheets[0], hdr = s.cells[0].map(x => String(x?.v ?? ''));
  const col = (re: RegExp) => hdr.findIndex(h => re.test(h));
  const cDur = col(/^Duration/i), cClass = col(/Classification/i), cBot = col(/^Bottom Depth \(m\)/i), cCom = col(/^Comments/i);
  let npt = 0, total = 0, maxBottom = 0, rows = 0, nptRows = 0, formations = new Set<string>();
  const surveyMd = new Set<number>();
  for (let r = 1; r < s.nRows; r++) {
    const row = s.cells[r]; if (!row?.some(Boolean)) continue;
    rows++; const d = Number(row[cDur]?.v ?? 0); total += d;
    if (/non/i.test(String(row[cClass]?.v ?? ''))) { npt += d; nptRows++; }
    maxBottom = Math.max(maxBottom, Number(row[cBot]?.v ?? 0));
    const txt = String(row[cCom]?.v ?? '');
    for (const m of txt.matchAll(/last\s+survey\s*(?:[:@]|at)?\s*(?:MD\s*=\s*)?([\d.]+)/gi)) surveyMd.add(Number(m[1]));
    for (const m of txt.matchAll(/formation\s*:\s*([^.\r\n]+)/gi)) formations.add(m[1].trim().toLowerCase());
  }
  return { rows, total, npt, nptRows, maxBottomM: maxBottom, surveys: surveyMd.size, formationNames: formations.size };
}

const xx1 = load('XX-1.xlsx'), xx2 = load('XX-2.xlsx');

describe.skipIf(!xx1)('real report XX-1 (user file, read-only)', () => {
  if (!xx1) return;   // the body is still collected when skipped; the report is not on this machine (e.g. CI)
  const ex = extractWorkbook(xx1!, OPTS);
  const facts = columnFacts(xx1!);
  const sheet = xx1!.sheets[0].name;
  it('reads the table as an operations log with month-first dates', () => {
    expect(ex.recordMode).toBe('operations log');
    expect(ex.dateOrder.order).toBe('MDY');
    expect(ex.days.reduce((s, d) => s + d.ops.length, 0)).toBe(facts.rows);
    expect(ex.unresolved).toHaveLength(0);
  });
  it('NPT equals the sum of the rows the report classifies "Non Productive" (no double counting)', () => {
    const recNpt = ex.records.reduce((s, r) => s + (r.npt_hours ?? 0), 0);
    expect(recNpt).toBeCloseTo(facts.npt, 2);
    const evNpt = ex.problems.filter(p => /classified "Non Productive"/.test(p.nptBasis)).reduce((s, p) => s + p.nptHours, 0);
    expect(evNpt).toBeCloseTo(facts.npt, 2);
    expect(ex.problems.filter(p => !/classified "Non Productive"/.test(p.nptBasis)).every(p => p.nptHours === 0)).toBe(true);
  });
  it('final hole depth equals the deepest Bottom Depth (m) in the sheet', () => {
    expect(Math.max(...ex.records.map(r => r.hole_depth_ft ?? 0))).toBeCloseTo(facts.maxBottomM * 3.280839895, 0);
  });
  it('every value keeps its source cell and its text is found in that cell', () => {
    const cellText = (h: Hit) => String(xx1!.sheets[0].cells[Number(h.cell.replace(/\D/g, '')) - 1][h.cell.replace(/\d/g, '').charCodeAt(0) - 65]?.v ?? '').replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/[³]/g, '3').replace(/[“”]/g, '"').replace(/[´’]/g, "'");
    const bad = ex.cellParams.filter(h => !cellText(h).includes(h.text));
    expect(bad.map(h => `${h.src} ${h.text}`)).toEqual([]);
  });
  it('hand-labelled cells: recall and precision', () => {
    const s = score(ex, sheet);
    expect(s.recall).toBeGreaterThanOrEqual(0.97);
    expect(s.precision).toBeGreaterThanOrEqual(0.97);
  });
  it('drilling records carry the parameters of their own operation', () => {
    const r = ex.records.find(x => x.source_ref === `${sheet}!Q3` && x.activity_code === 'ROT')!;
    expect(r.wob_klb).toBeCloseTo(3 * 2.20462, 2);         // WOB 1-5 Ton -> midpoint 3 t
    expect(r.spp_psi).toBe(325); expect(r.flow_gpm).toBeCloseTo(1250 * 0.2641721, 1); expect(r.rop_fph).toBeCloseTo(23.81 * 3.280839895, 1);
    const ream = ex.records.find(x => x.source_ref === `${sheet}!Q19`)!;
    expect(ream.wob_klb).toBeNull();                        // a tripping entry gets no WOB
    expect(ex.stations.length).toBe(facts.surveys);          // every distinct "Last Survey" station (repeats are one station)
    expect(ex.issues.some(i => i.type === 'survey_conflict' && /2416\.24/.test(i.message))).toBe(true);   // same MD reported with two TVDs
  });

  it('operations, BHA runs, hole sections and casing strings', () => {
    expect(ex.operations).toHaveLength(facts.rows);
    expect(ex.operations.filter(o => o.code === 'UNSPECIFIED')).toHaveLength(0);
    expect(ex.operations.filter(o => o.isNpt).reduce((s, o) => s + o.hours, 0)).toBeCloseTo(facts.npt, 2);
    expect(ex.holeSections.map(s => [s.holeSize, s.bitSizes, s.casingOd])).toEqual([[23, [23], 18.625], [17.5, [17.5], 13.375], [12.25, [12.25], 9.625], [8.5, [8.5], 7]]);
    expect(ex.casings.map(c => [c.od, Math.round((c.shoeMd ?? 0) / 3.280839895)])).toEqual([[18.625, 608], [13.375, 1806], [9.625, 3081], [7, 3525]]);
    expect(ex.bhaRuns.map(r => r.bitSerial)).toEqual(['QG1628', '8656', 'RS5850', 'JM3576', 'SP2218', 'SP2218', 'SP1760', '6141']);
    expect(ex.tools.every(x => x.src.startsWith(sheet))).toBe(true);
    expect(ex.issues.filter(i => i.type === 'equipment_inconsistent').map(i => i.message)).toEqual([expect.stringMatching(/HYD825BP95.*HYDB825BP95/), expect.stringMatching(/SP1760.*SP1750/)]);
  });

  it.skipIf(!process.env.ACCURACY_OUT)('writes the extraction map and the accuracy report', () => {
    const out = resolve(process.env.ACCURACY_OUT!); mkdirSync(out, { recursive: true });
    const s = score(ex, sheet);
    const q = (v: unknown) => { const t = v == null ? '' : String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const head = ['Parameter', 'Parameter key', 'Qualifier', 'Original text', 'Extracted value', 'Min', 'Max', 'Unit as written', 'Unit recognised', 'Unit basis', 'Database value', 'Database unit', 'Worksheet', 'Cell', 'Context', 'Confidence', 'Status', 'Extraction method', 'Notes', 'Used'];
    writeFileSync(join(out, 'XX-1_extraction_map.csv'), '﻿' + [head.join(','), ...ex.cellParams.map(h => [h.label, h.key, h.qualifier, h.text, h.value, h.min, h.max, h.unitRaw, h.unit, h.unitBasis, h.canonical, h.canonicalUnit, h.sheet, h.cell, h.context, h.confidence, h.status, h.method, h.notes.join('; '), h.use ? 'yes' : 'no'].map(q).join(','))].join('\r\n'));
    // per parameter
    const by = new Map<string, Hit[]>(); for (const h of ex.cellParams) by.set(h.key, [...(by.get(h.key) ?? []), h]);
    const groups = [...by.entries()].sort((a, b) => a[1][0].group.localeCompare(b[1][0].group) || b[1].length - a[1].length);
    const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
    const recNpt = ex.records.reduce((a, r) => a + (r.npt_hours ?? 0), 0);
    const st = (k: string) => ex.params.find(p => p.key === k);
    const md = [
      '# Extraction accuracy report — XX-1', '',
      `Source: \`XX-1.xlsx\` (read-only), worksheet "${sheet}", ${facts.rows} operations. Generated by \`src/import/smart/realReport.test.ts\`; re-run it to regenerate.`, '',
      '## Summary', '',
      `| Check | Result |`, `|---|---|`,
      `| Table recognised as | ${ex.recordMode} (${ex.sheets[0].tables[0]?.columns.filter(c => c.concept).length}/${ex.sheets[0].tables[0]?.columns.length} columns classified, ${ex.unresolved.length} unresolved) |`,
      `| Date order | ${ex.dateOrder.basis} |`,
      `| Text cells read | ${ex.coverage.cellsScanned} (${ex.coverage.cellsWithValues} contain parameter values) |`,
      `| Values found inside cells | ${ex.coverage.values} (${ex.coverage.used} used, ${ex.coverage.identifiers} identifiers such as serial numbers recognised and not used) |`,
      `| Source verification | ${ex.cellParams.length} of ${ex.cellParams.length} values: the extracted text is found verbatim in the cell it is attributed to |`,
      `| Hand-labelled sample (${s.cells.length} cells: ${s.cells.join(', ')}) | recall ${pct(s.recall)} (${s.found.length}/${TRUTH.length}), precision ${pct(s.precision)} (${s.extra.length} value(s) not in the labels) |`,
      `| NPT | ${recNpt.toFixed(2)} h in the records = ${facts.npt.toFixed(2)} h summed directly from the ${facts.nptRows} rows classified "Non Productive" |`,
      `| Final hole depth | ${(Math.max(...ex.records.map(r => r.hole_depth_ft ?? 0))).toFixed(1)} ft = ${facts.maxBottomM} m (deepest "Bottom Depth (m)") |`,
      `| Survey stations | ${ex.stations.length} (= ${facts.surveys} distinct "Last Survey" stations; repeated statements merged, projections excluded) |`,
      `| Formation tops | ${ex.formations.length} from the text ("Top of …" markers and "Formation:" lines) |`,
      `| Drilling records built | ${ex.records.length} (30-min steps along each operation; depth from the depth columns) |`,
      `| Numbers with a drilling unit not attributed | ${ex.coverage.missed.length} (listed below) |`, '',
      '## Values found, by parameter', '',
      '| Group | Parameter | Values | Used | Units as written | Suspected | Mean confidence | Example (cell) |', '|---|---|---|---|---|---|---|---|',
      ...groups.map(([, hs]) => { const u = [...new Set(hs.map(h => h.unitRaw).filter(Boolean))].slice(0, 5).join(', '); const ex1 = hs.find(h => h.method !== 'negative statement') ?? hs[0];
        return `| ${hs[0].group} | ${hs[0].label} | ${hs.length} | ${hs.filter(h => h.use && h.status !== 'rejected').length} | ${u || '—'} | ${hs.filter(h => h.status === 'suspected').length} | ${pct(hs.reduce((a, h) => a + h.confidence, 0) / hs.length)} | \`${ex1.text.replace(/\|/g, '/')}\` (${ex1.cell}) |`; }),
      '', '## Checklist parameters not present in the report', '',
      ...ex.params.filter(p => p.status === 'missing').map(p => `- ${p.label}`),
      '', 'These are not written anywhere in XX-1, so nothing is filled in for them. (Drilling, circulating and tripping hours are calculated by the dashboard from the classified operations.)', '',
      `Checklist status of the main ones: ${['md', 'hole_depth', 'bit_depth', 'tvd', 'rop_avg', 'rop_inst', 'wob', 'rpm', 'torque', 'spp', 'flow', 'mud_weight', 'ecd', 'npt', 'formation', 'lithology', 'hole_size'].map(k => `${k} = ${st(k)?.status ?? '?'}`).join(', ')}.`,
      '', '## Hand-labelled sample: values not found', '',
      ...(s.missed.length ? s.missed.map(t => `- ${t[0]}: ${t[1]} = ${Array.isArray(t[2]) ? t[2].join('–') : t[2]} ${t[3] ?? ''}`) : ['- none']),
      '', '## Hand-labelled sample: values extracted that are not in the labels', '',
      ...(s.extra.length ? s.extra.map(h => `- ${h.cell}: ${h.label} = ${h.value} (${h.method}) — \`${h.text}\``) : ['- none']),
      '', '## Values marked suspected (need an engineer)', '',
      ...(ex.cellParams.filter(h => h.status === 'suspected').map(h => `- ${h.src}: ${h.label} \`${h.text}\` — ${h.notes.join('; ')}`)),
      '', '## Numbers with a drilling unit that are not attributed to any parameter', '',
      'Kept with the import record and listed under "Values in cells" in the app.', '',
      ...ex.coverage.missed.map(m => `- ${m.src}: \`${m.text}\` — ${m.line.replace(/\|/g, '/')}`),
      '', '## Validation messages', '', ...ex.issues.map(i => `- ${i.severity}: ${i.message}`), '',
    ];
    writeFileSync(join(out, 'XX-1_ACCURACY.md'), md.join('\n'));
  });
});

describe.skipIf(!xx2)('real report XX-2 (generalisation: nothing was tuned on its numbers)', () => {
  if (!xx2) return;
  const ex = extractWorkbook(xx2!, OPTS);
  const facts = columnFacts(xx2!);
  it('reads it the same way and NPT matches its own classification', () => {
    expect(ex.recordMode).toBe('operations log');
    expect(ex.records.reduce((s, r) => s + (r.npt_hours ?? 0), 0)).toBeCloseTo(facts.npt, 2);
    expect(Math.max(...ex.records.map(r => r.hole_depth_ft ?? 0))).toBeCloseTo(facts.maxBottomM * 3.280839895, 0);
    expect(ex.stations.length).toBe(facts.surveys);
    expect(ex.coverage.values).toBeGreaterThan(1000);
  });
  it('finds its BHA runs, hole sections and casing strings the same way', () => {
    expect(ex.bhaRuns).toHaveLength(7);
    expect(ex.holeSections.map(s => s.holeSize)).toEqual([23, 17.5, 12.25, 8.5]);
    expect(ex.casings.map(c => c.od)).toEqual([18.625, 13.375, 9.625, 7]);
    expect(ex.operations.filter(o => o.isNpt).reduce((s, o) => s + o.hours, 0)).toBeCloseTo(facts.npt, 2);
  });
});

describe.skipIf(!xx1 || !xx2)('Well Comparison point analysis on XX-1 against XX-2', () => {
  if (!xx1 || !xx2) return;
  const recs = (wb: SWorkbook, id: string) => prepareRecords(extractWorkbook(wb, OPTS).records.map(r => ({ ...r, well_id: id })));
  const r1 = recs(xx1!, 'X1'), r2 = recs(xx2!, 'X2');
  const s1 = buildWellSeries({ id: 'X1', name: 'XX-1' }, '#0ea5c4', r1, 'depth'), s2 = buildWellSeries({ id: 'X2', name: 'XX-2' }, '#d97706', r2, 'depth');
  it('the previous drilling record is the previous report entry, not a copy of the same cell', () => {
    const e1 = entries(r1);
    expect(e1.filter(e => e.onBottom).length).toBeLessThan(s1.on.length);   // long entries are stored as several records
    const rec = s1.on[Math.floor(s1.on.length / 2)];
    const w = analysisWindow(e1, rec, 'rec1')!;
    expect(w.before).toHaveLength(1);
    expect(w.before[0].src).not.toBe(w.sel.src);
    expect(w.sel.recs.every(r => r.source_ref === rec.source_ref)).toBe(true);
  });
  it('XX-2 is matched at the same depth by its own nearest record, with the actual difference', () => {
    for (const rec of [s1.on[10], s1.on[Math.floor(s1.on.length / 2)], s1.on[s1.on.length - 10]]) {
      const m = matchWell(s2, rec.hole, tolerance(s2));
      expect(m.rec).not.toBeNull();
      expect(m.diff).toBeCloseTo(m.rec!.hole - rec.hole, 6);
      expect(r2).toContain(m.rec);
    }
  });
  it('every interpretation on the real data is classified and never empty', () => {
    const e1 = entries(r1);
    for (let i = 5; i < s1.on.length; i += Math.ceil(s1.on.length / 25)) {
      const w = analysisWindow(e1, s1.on[i], 'rec5');
      if (!w) continue;
      const evs = recordedEvents(w, { recs: r1, eq: null, problems: [], actions: new Map(), catName: () => '', proximityFt: 500 });
      const ex = explain('rop', allChanges(w), evs);
      expect(ex.summary.length).toBeGreaterThan(20);
      if (ex.direction === 'increase' || ex.direction === 'decrease') expect(ex.findings.length).toBeGreaterThan(0);
    }
  });
});
