// Layer 1 - Excel parsing. Reads every worksheet (including hidden ones) into a dense cell grid that keeps
// raw value, displayed text, formula, date flag, merge information and hidden rows / columns.
import * as XLSX from 'xlsx';

export interface SCell {
  v: string | number | boolean;   // raw value
  w: string;                      // text as displayed in Excel
  f?: string;                     // formula, when the cell is calculated
  date?: boolean;                 // number formatted as a date / time
  merged?: boolean;               // value propagated from the top-left cell of a merged range
}
export interface SSheet {
  name: string; hidden: boolean; cells: (SCell | null)[][]; nRows: number; nCols: number;
  hiddenRows: Set<number>; hiddenCols: Set<number>; merges: number; formulas: number;
}
export interface SWorkbook { fileName: string; sheets: SSheet[] }

// In Node (server/report-reader.mjs) the CommonJS build exposes SSF only on the default export
const SSF: typeof XLSX.SSF = XLSX.SSF ?? (Reflect.get(XLSX, 'default') as typeof XLSX).SSF;
export const A1 = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
export const cellRef = (sheet: string, r: number, c: number) => `${sheet}!${A1(r, c)}`;

export function toSmartWorkbook(wb: XLSX.WorkBook, fileName: string): SWorkbook {
  const sheets = wb.SheetNames.map((name, i): SSheet => {
    const ws = wb.Sheets[name];
    const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
    const cells: (SCell | null)[][] = [];
    let nCols = 0, formulas = 0;
    if (range) {
      for (let r = 0; r <= range.e.r; r++) {
        const row: (SCell | null)[] = [];
        for (let c = 0; c <= range.e.c; c++) {
          const x = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
          if (!x || x.v == null || x.t === 'e' || x.t === 'z' || (typeof x.v === 'string' && !x.v.trim())) { row.push(null); continue; }
          const v = x.v instanceof Date ? x.v.getTime() / 86400000 + 25569 : typeof x.v === 'string' ? x.v.trim() : (x.v as number | boolean);
          const date = x.v instanceof Date || (x.t === 'n' && !!x.z && SSF.is_date(String(x.z)));
          if (x.f) formulas++;
          row.push({ v, w: String(x.w ?? x.v).trim(), ...(x.f ? { f: x.f } : {}), ...(date ? { date: true } : {}) });
          nCols = Math.max(nCols, c + 1);
        }
        cells.push(row);
      }
    }
    while (cells.length && cells[cells.length - 1].every(c => !c)) cells.pop();
    for (const row of cells) row.length = nCols;
    const merges = ws['!merges'] ?? [];
    for (const m of merges) {
      const o = cells[m.s.r]?.[m.s.c];
      if (!o) continue;
      for (let r = m.s.r; r <= Math.min(m.e.r, cells.length - 1); r++)
        for (let c = m.s.c; c <= Math.min(m.e.c, nCols - 1); c++)
          if (r !== m.s.r || c !== m.s.c) cells[r][c] = { ...o, merged: true };
    }
    const hiddenRows = new Set<number>(), hiddenCols = new Set<number>();
    (ws['!rows'] ?? []).forEach((x, r) => { if (x?.hidden) hiddenRows.add(r); });
    (ws['!cols'] ?? []).forEach((x, c) => { if (x?.hidden) hiddenCols.add(c); });
    return { name, hidden: !!wb.Workbook?.Sheets?.[i]?.Hidden, cells, nRows: cells.length, nCols, hiddenRows, hiddenCols, merges: merges.length, formulas };
  });
  return { fileName, sheets };
}

/** Parse a workbook file buffer with the options the smart reader needs (formats, styles, formulas). */
export function readSmart(data: ArrayBuffer | string, fileName: string): { wb: XLSX.WorkBook; smart: SWorkbook } {
  const wb = typeof data === 'string'
    ? XLSX.read(data, { type: 'string', raw: true })
    : XLSX.read(data, { type: 'array', cellDates: false, cellNF: true, cellStyles: true, cellFormula: true });
  return { wb, smart: toSmartWorkbook(wb, fileName) };
}
