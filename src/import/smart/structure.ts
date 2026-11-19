// Layer 2 - structural detection. Finds every table on a sheet (wherever it starts, with single or
// multi-level headers and unit rows), tables laid out horizontally (parameters down the side, days across),
// label/value metadata around the tables, narrative paragraphs and section titles. Nothing is assumed about
// where things are; whatever is not understood is returned as "leftovers" so it is never silently dropped.
import { classify, type Concept } from './dictionary';
import type { SCell, SSheet } from './workbook';

export interface TableCol { c: number; header: string }
export interface Table { sheet: string; title: string | null; headerTop: number; headerRow: number; r0: number; r1: number; cols: TableCol[] }
/** Horizontal layout: one parameter per row, one period / statistic per column. */
export interface TTable { sheet: string; title: string | null; headerRow: number; labelCol: number; valueCols: { c: number; header: SCell | null }[]; rows: { r: number; label: string }[] }
export interface KV { label: string; value: SCell; unit?: string; r: number; c: number; lr: number; lc: number }
export interface Narr { label: string | null; text: string; r: number; c: number }
export interface Structure {
  sheet: SSheet; tables: Table[]; ttables: TTable[]; kvs: KV[]; narratives: Narr[];
  sections: { title: string; r: number; c: number }[]; leftovers: { r: number; c: number; text: string }[];
}

const NUMERIC = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?$/;
export const isNum = (x: SCell | null | undefined) => !!x && (typeof x.v === 'number' || (typeof x.v === 'string' && NUMERIC.test(x.v.trim())));
const isText = (x: SCell | null | undefined): x is SCell => !!x && typeof x.v === 'string' && !NUMERIC.test(x.v.trim());
const TIMEISH = /^\d{1,2}[:.]\d{2}(\s*[-–]\s*\d{1,2}[:.]\d{2})?(\s*[ap]m)?$/i;
const isNarrative = (s: string) => s.length >= 70 || s.split(/\s+/).length >= 9;
const UNIT_CELL = /^\(?\s*(ft|feet|m|ft\/hr?|fph|m\/hr?|klbs?|kips?|rpm|psi|kpa|bar|gpm|ppg|sg|hrs?|hours?|mins?|deg|°|in|inch|%|k?ft[-.]?lbs?|lpm|l\/min|kn|usft|pcf|n\/a|-)\s*\)?$/i;
const PARAM_HDR = /^(parameters?|property|properties|items?|description|name|measurement)$/i;
const VALUE_HDR = /^(values?|actual|reading|result|data|today)$/i;
const UNIT_HDR = /^(units?|uom)$/i;

export function analyzeSheet(sheet: SSheet, learned: Record<string, string> = {}): Structure {
  const { cells, nRows, nCols } = sheet;
  const at = (r: number, c: number) => (r >= 0 && r < nRows && c >= 0 && c < nCols ? cells[r][c] : null);
  const used = cells.map(row => row.map(() => false));
  const out: Structure = { sheet, tables: [], ttables: [], kvs: [], narratives: [], sections: [], leftovers: [] };
  const known = (x: SCell | null, min = 0.8): Concept | null => { if (!isText(x) || x.w.length > 45) return null; const k = classify(x.w, learned); return k && k.score >= min ? k.concept : null; };
  const labelish = (x: SCell | null) => isText(x) && x.w.length <= 45 && !TIMEISH.test(x.w) && (/[:=]\s*$/.test(x.w) || !!known(x, 0.85));
  const rowCells = (r: number, c0: number, c1: number) => { const a: { c: number; x: SCell }[] = []; for (let c = c0; c <= c1; c++) { const x = at(r, c); if (x) a.push({ c, x }); } return a; };

  // ---------------------------------------------------------------- blocks: row bands, split on wide column gaps
  const rowHas = (r: number) => cells[r].some(Boolean);
  let lastTable: Table | null = null;
  for (let r = 0; r < nRows; r++) {
    if (!rowHas(r)) continue;
    let e = r; while (e + 1 < nRows && rowHas(e + 1)) e++;
    const occ: boolean[] = [];
    for (let c = 0; c < nCols; c++) { occ[c] = false; for (let k = r; k <= e; k++) if (cells[k][c]) { occ[c] = true; break; } }
    for (let c = 0; c < nCols; c++) {
      if (!occ[c]) continue;
      let ce = c;
      while (ce + 1 < nCols && occ[ce + 1]) ce++;
      scanBlock(r, e, c, ce);
      c = ce;
    }
    r = e;
  }

  function dataRow(d: number, r1: number, cols: number[], allowText: boolean): boolean {
    if (d > r1) return false;
    const xs = cols.map(c => at(d, c)).filter(Boolean) as SCell[];
    if (xs.length < Math.min(2, cols.length)) return false;
    const texts = xs.filter(isText), lab = texts.filter(labelish).length;
    if (lab >= 2 && lab >= texts.length / 2) return false;
    return allowText || xs.some(x => isNum(x) || x.date || TIMEISH.test(x.w) || x.w.length > 25);
  }

  /** Is row r a table header inside block [r..r1] x [c0..c1]? Returns the last header row (multi-level aware). */
  function headerAt(r: number, r1: number, c0: number, c1: number): { hr: number; kv: boolean } | null {
    const xs = rowCells(r, c0, c1);
    if (xs.length < 2) return null;
    if (xs.filter(o => !o.x.merged).length < 2) return null;   // one merged cell spanning the row is a title, not a header
    const texts = xs.filter(o => isText(o.x) && o.x.w.length <= 45 && !TIMEISH.test(o.x.w));
    if (texts.length / xs.length < 0.8) return null;
    if (texts.filter(o => /[:=]\s*$/.test(o.x.w)).length >= texts.length / 2) return null;
    const nKnown = new Set(texts.map(o => known(o.x)?.key).filter(Boolean)).size;
    const cols = xs.map(o => o.c);
    const kv = texts.some(o => PARAM_HDR.test(o.x.w)) && texts.some(o => VALUE_HDR.test(o.x.w)) && texts.every(o => PARAM_HDR.test(o.x.w) || VALUE_HDR.test(o.x.w) || UNIT_HDR.test(o.x.w));
    if (kv) return dataRow(r + 1, r1, cols, true) ? { hr: r, kv: true } : null;
    // second header level or a units row
    let hr = r;
    const nx = rowCells(r + 1, c0, c1);
    if (nx.length >= 2 && r + 2 <= r1 && nx.every(o => isText(o.x) && o.x.w.length <= 30 && !TIMEISH.test(o.x.w))) {
      const units = nx.filter(o => UNIT_CELL.test(o.x.w)).length >= nx.length / 2;
      const merged = xs.some(o => o.x.merged) || nx.length > new Set(xs.map(o => o.x.w)).size;
      const sub = nx.filter(o => known(o.x)).length >= 1 || units;
      if ((units || (merged && sub)) && dataRow(r + 2, r1, [...new Set([...cols, ...nx.map(o => o.c)])], false)) hr = r + 1;
    }
    const allCols = hr > r ? [...new Set([...cols, ...nx.map(o => o.c)])] : cols;
    if (!dataRow(hr + 1, r1, allCols, nKnown >= 2)) return null;
    if (nKnown >= 2) return { hr, kv: false };
    if (xs.length >= 3 && dataRow(hr + 2, r1, allCols, false)) return { hr, kv: false };
    return null;
  }

  function findTitle(r: number, c0: number, c1: number): string | null {
    for (let k = r - 1; k >= Math.max(0, r - 2); k--) {
      const xs = rowCells(k, 0, nCols - 1).filter(o => !o.x.merged);
      if (xs.length === 1 && isText(xs[0].x) && xs[0].x.w.length <= 60 && xs[0].c >= c0 - 1 && xs[0].c <= c1 && !used[k][xs[0].c] && !/[:=]\s*$/.test(xs[0].x.w)) {
        for (let c = 0; c < nCols; c++) if (at(k, c)) used[k][c] = true;
        out.sections.push({ title: xs[0].x.w, r: k, c: xs[0].c });
        return xs[0].x.w;
      }
    }
    return null;
  }

  function tryTransposed(r: number, r1: number, c0: number, c1: number): number | null {
    // row r = header (periods or Min/Max/Avg), rows r+1.. = "label, v1, v2, ..."
    const first = (k: number) => rowCells(k, c0, c1)[0];
    const paramRow = (k: number, L: number) => { const xs = rowCells(k, c0, c1); return xs.length >= 3 && xs[0].c === L && isText(xs[0].x) && xs[0].x.w.length <= 45 && xs.slice(1).filter(o => isNum(o.x)).length >= 2; };
    if (r + 3 > r1) return null;
    const f = first(r + 1);
    if (!f) return null;
    const L = f.c;
    let e = r; while (e + 1 <= r1 && paramRow(e + 1, L)) e++;
    if (e - r < 3) return null;
    const rows = []; let nKnown = 0;
    for (let k = r + 1; k <= e; k++) { const x = at(k, L)!; const kc = known(x); if (kc && kc.kind === 'number') nKnown++; rows.push({ r: k, label: x.w }); }
    if (nKnown < Math.max(2, rows.length / 2)) return null;
    const valueCols: TTable['valueCols'] = [];
    for (let c = L + 1; c <= c1; c++) if (rows.some(o => at(o.r, c))) valueCols.push({ c, header: at(r, c) });
    if (valueCols.filter(v => v.header).length < 2) return null;
    const title = findTitle(r, c0, c1);
    for (let k = r; k <= e; k++) for (let c = c0; c <= c1; c++) if (at(k, c)) used[k][c] = true;
    out.ttables.push({ sheet: sheet.name, title, headerRow: r, labelCol: L, valueCols, rows });
    return e;
  }

  function scanBlock(r0: number, r1: number, c0: number, c1: number) {
    let r = r0;
    // rows that continue the previous table across one blank row
    if (lastTable && lastTable.r1 === r0 - 2 && !headerAt(r0, r1, c0, c1) && lastTable.cols.some(k => k.c >= c0 && k.c <= c1)) {
      const cols = lastTable.cols.map(k => k.c);
      while (r <= r1 && !headerAt(r, r1, c0, c1) && dataRow(r, r1, cols, false) && rowCells(r, c0, c1).filter(o => cols.includes(o.c)).length >= Math.min(3, cols.length)) {
        for (const c of cols) if (at(r, c)) used[r][c] = true;
        lastTable.r1 = r; r++;
      }
    }
    while (r <= r1) {
      // side-by-side tables that share rows: split where a column is empty for the header and the rows below it
      const segs: [number, number][] = [];
      for (let c = c0; c <= c1; c++) {
        const empty = (cc: number) => !at(r, cc) && !at(r + 1, cc) && !at(r + 2, cc);
        if (empty(c)) continue;
        let ce = c; while (ce + 1 <= c1 && !empty(ce + 1)) ce++;
        segs.push([c, ce]); c = ce;
      }
      if (segs.length > 1 && segs.some(([a, b]) => headerAt(r, r1, a, b) || tryTransposedPeek(r, r1, a, b))) {
        for (const [a, b] of segs) scanBlock(r, r1, a, b);
        return;
      }
      const te = tryTransposed(r, r1, c0, c1);
      if (te != null) { r = te + 1; lastTable = null; continue; }
      const h = headerAt(r, r1, c0, c1);
      if (!h) { r++; continue; }
      // extent: until the next header or a title row that introduces one
      let e = h.hr + 1;
      while (e + 1 <= r1) {
        const n = e + 1;
        if (headerAt(n, r1, c0, c1) || tryTransposedPeek(n, r1, c0, c1)) break;
        const xs = rowCells(n, c0, c1).filter(o => !o.x.merged);
        if (xs.length === 1 && isText(xs[0].x) && n + 1 <= r1 && (headerAt(n + 1, r1, c0, c1) || tryTransposedPeek(n + 1, r1, c0, c1))) break;
        e = n;
      }
      const title = findTitle(r, c0, c1);
      if (h.kv) {
        const hdr = rowCells(r, c0, c1);
        const pc = hdr.find(o => PARAM_HDR.test(o.x.w))!.c, vc = hdr.find(o => VALUE_HDR.test(o.x.w))!.c, uc = hdr.find(o => UNIT_HDR.test(o.x.w))?.c;
        for (let k = r + 1; k <= e; k++) {
          const l = at(k, pc), v = at(k, vc);
          if (isText(l) && v) out.kvs.push({ label: l.w, value: v, unit: uc != null ? at(k, uc)?.w : undefined, r: k, c: vc, lr: k, lc: pc });
        }
      } else {
        const cols: TableCol[] = [];
        for (let c = c0; c <= c1; c++) {
          const top = at(r, c)?.w ?? '', bot = h.hr > r ? at(h.hr, c)?.w ?? '' : '';
          const header = !bot || bot === top ? top : !top ? bot : UNIT_CELL.test(bot) ? `${top} (${bot.replace(/[()]/g, '')})` : `${top} ${bot}`;
          let hasData = false; for (let k = h.hr + 1; k <= e && !hasData; k++) { const x = at(k, c); hasData = !!x && !x.merged; }
          // a merged header spanning several columns is one column, not several
          if (at(r, c)?.merged && cols.length && cols[cols.length - 1].header === header && !hasData) continue;
          if (header || hasData) cols.push({ c, header });
        }
        lastTable = { sheet: sheet.name, title, headerTop: r, headerRow: h.hr, r0: h.hr + 1, r1: e, cols };
        out.tables.push(lastTable);
      }
      for (let k = r; k <= e; k++) for (let c = c0; c <= c1; c++) if (at(k, c)) used[k][c] = true;
      r = e + 1;
    }
  }
  function tryTransposedPeek(r: number, r1: number, c0: number, c1: number): boolean {
    const snapshot = { n: out.ttables.length, s: out.sections.length };
    const saved = used.map(row => row.slice());
    const hit = tryTransposed(r, r1, c0, c1) != null;
    if (hit) { out.ttables.length = snapshot.n; out.sections.length = snapshot.s; saved.forEach((row, i) => { used[i] = row; }); }
    return hit;
  }

  // ---------------------------------------------------------------- metadata, narratives, titles, leftovers
  const free = (r: number, c: number) => { const x = at(r, c); return x && !used[r][c] ? x : null; };
  for (let r = 0; r < nRows; r++) for (let c = 0; c < nCols; c++) {
    const x = free(r, c);
    if (!x || x.merged) continue;
    if (isText(x)) {
      const s = x.w;
      if (isNarrative(s)) {
        let label: string | null = null;
        for (const [lr, lc] of [[r, c - 1], [r, c - 2], [r - 1, c]] as const) {
          const l = at(lr, lc);
          if (isText(l) && !l.merged && l.w.length <= 45 && !isNarrative(l.w)) { label = l.w.replace(/[:=]\s*$/, ''); used[lr][lc] = true; break; }
        }
        const inl = s.match(/^([A-Za-z][A-Za-z0-9 /&-]{2,32}):\s+(\S.{40,})$/s);
        out.narratives.push({ label: label ?? (inl ? inl[1] : null), text: inl && !label ? inl[2] : s, r, c });
        used[r][c] = true;
        continue;
      }
      const inl = s.match(/^([A-Za-z][A-Za-z0-9 .#/&()'-]{1,40}?)\s*[:=]\s*(\S.*)$/);
      if (inl && !TIMEISH.test(s)) { out.kvs.push({ label: inl[1], value: { v: inl[2], w: inl[2] }, r, c, lr: r, lc: c }); used[r][c] = true; continue; }
      if (labelish(x)) {
        let v: { r: number; c: number } | null = null;
        for (let cc = c + 1; cc <= c + 4 && cc < nCols; cc++) {
          const y = at(r, cc);
          if (!y || (y.merged && y.w === x.w)) continue;
          if (!used[r][cc] && !labelish(y)) v = { r, c: cc };
          break;
        }
        if (!v) { const y = free(r + 1, c); if (y && !labelish(y) && !(isText(y) && isNarrative(y.w))) v = { r: r + 1, c }; }
        if (v) { out.kvs.push({ label: s.replace(/[:=]\s*$/, ''), value: at(v.r, v.c)!, r: v.r, c: v.c, lr: r, lc: c }); used[r][c] = used[v.r][v.c] = true; continue; }
      }
    }
  }
  for (let r = 0; r < nRows; r++) for (let c = 0; c < nCols; c++) {
    const x = free(r, c);
    if (!x || x.merged) continue;
    const alone = rowCells(r, 0, nCols - 1).filter(o => !o.x.merged).length === 1;
    const caps = isText(x) && x.w.length <= 60 && x.w === x.w.toUpperCase() && /[A-Z]{3}/.test(x.w);
    if (isText(x) && x.w.length <= 60 && (alone || caps)) out.sections.push({ title: x.w, r, c });
    else out.leftovers.push({ r, c, text: x.w });
    used[r][c] = true;
  }
  out.sections.sort((a, b) => a.r - b.r);
  return out;
}
