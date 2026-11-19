// Data-source connectors. Every source produces the same RawWorkbook, so mapping / validation / import are
// identical regardless of where the data came from. New sources (Power BI REST, WITSML, a Python service...)
// are added by implementing DataSourceConnector.
import * as XLSX from 'xlsx';
import type { RawWorkbook } from './parse';
import { readSmart, type SWorkbook } from './smart/workbook';

/** `hash`: SHA-256 of the file content, used to refuse importing the same file twice. */
export type LoadedWorkbook = RawWorkbook & { smart: SWorkbook; hash: string | null };

export interface DataSourceConnector {
  id: 'file' | 'powerbi_export' | 'powerbi_api';
  label: string;
  available: boolean;
  /** why the connector is unavailable / what it needs */
  note?: string;
}

export const CONNECTORS: DataSourceConnector[] = [
  { id: 'file', label: 'Excel / CSV file', available: true },
  { id: 'powerbi_export', label: 'Power BI export (Excel / CSV)', available: true, note: 'In Power BI use "Export data" on a visual or table (Underlying data) and upload the .xlsx / .csv here.' },
  {
    id: 'powerbi_api', label: 'Power BI dataset API', available: false,
    note: 'Not configured. Requires an Azure AD app registration (tenant ID, client ID, client secret) with Dataset.Read.All, the workspace ID and dataset ID, and a small backend proxy to call the executeQueries endpoint - the client secret must never be placed in browser code.',
  },
];

export class UnsupportedFileError extends Error {}

/** Read an .xlsx / .xls / .csv file into raw grids. Values are kept raw (no locale or timezone conversion). */
export async function readWorkbookFile(file: File): Promise<LoadedWorkbook> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pbix' || ext === 'pbit')
    throw new UnsupportedFileError('A .pbix file is a Power BI report package (compressed data model + report layout), not a spreadsheet, and cannot be read as Excel. Export the table data from Power BI to Excel or CSV and upload that file instead.');
  if (!['xlsx', 'xls', 'csv', 'txt'].includes(ext))
    throw new UnsupportedFileError(`Unsupported file type ".${ext}". Upload an .xlsx, .xls or .csv file.`);
  const buf = await file.arrayBuffer();
  let wb: XLSX.WorkBook, smart: SWorkbook;
  try {
    ({ wb, smart } = readSmart(ext === 'csv' || ext === 'txt' ? new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '') : buf, file.name));
  } catch (e) {
    throw new UnsupportedFileError(`The file could not be read: ${(e as Error).message}`);
  }
  const sheets = wb.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false }),
  })).filter(s => s.rows.length > 0);
  if (!sheets.length) throw new UnsupportedFileError('The file contains no data.');
  let hash: string | null = null;
  try { hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join(''); } catch { /* no WebCrypto (insecure context): duplicate check skipped */ }
  return { fileName: file.name, kind: ext === 'csv' || ext === 'txt' ? 'csv' : 'excel', sheets, smart, hash };
}
