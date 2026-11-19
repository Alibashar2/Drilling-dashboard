// SAMPLE DATA ONLY. A deliberately disorganised synthetic drilling report workbook used to test the
// intelligent report reader: one sheet per day laid out differently, merged titles, metadata scattered around
// the tables, side-by-side tables, multi-level headers, a horizontal table, an NPT log, a hidden sheet that
// belongs to another well, text dates, clock ranges in one cell, and narrative operations text.
import * as XLSX from 'xlsx';

type V = string | number | { v: number; z: string } | null;
const D = (y: number, m: number, d: number) => ({ v: Date.UTC(y, m - 1, d) / 86400000 + 25569, z: 'dd-mmm-yy' });
const T = (h: number, min = 0) => ({ v: (h * 60 + min) / 1440, z: 'hh:mm' });

function sheet(rows: V[][], merges: string[] = [], hiddenRows: number[] = []): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxC = 0;
  rows.forEach((row, r) => row.forEach((x, c) => {
    if (x == null || x === '') return;
    maxC = Math.max(maxC, c);
    const a = XLSX.utils.encode_cell({ r, c });
    ws[a] = typeof x === 'object' ? { t: 'n', v: x.v, z: x.z } : typeof x === 'number' ? { t: 'n', v: x } : { t: 's', v: x };
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: maxC } });
  if (merges.length) ws['!merges'] = merges.map(m => XLSX.utils.decode_range(m));
  if (hiddenRows.length) { const rr: XLSX.RowInfo[] = []; hiddenRows.forEach(r => { rr[r] = { hidden: true }; }); ws['!rows'] = rr; }
  return ws;
}

export function messyReportWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const day1: V[][] = [
    ['DAILY DRILLING REPORT'],
    [],
    ['Well Name:', 'KH-07 (SAMPLE)', null, 'Rig:', 'Rig 12', null, 'Report No.', 12],
    ['Field:', 'Sample East', null, 'Report Date:', D(2025, 3, 12), null, 'DFS', 11],
    ['Depth MD (ft)', 8510, null, 'TVD (ft)', 8342, null, 'Progress (ft)', 310],
    ['Hole Size', '8 1/2"', null, 'Mud Wt', '9.8 ppg', null, 'Planned TD (ft)', 12400],
    [],
    ['TIME LOG'],
    ['From', 'To', 'Hrs', 'Code', 'Operations Summary'],
    [T(0), T(6), 6, 'DRL', 'Drilled 8 1/2" hole from 8,200 ft to 8,420 ft. Avg ROP 36.7 ft/hr. No losses observed.'],
    [T(6), T(6, 30), 0.5, 'CIRC', 'Circulated bottoms up prior to connection.'],
    [T(6, 30), T(8, 30), 2, 'DRL', 'Drilled from 8,420 ft to 8,510 ft with an average ROP of 45 ft/hr. Experienced partial losses in Formation X and spent 4 hours treating the losses.'],
    [T(8, 30), T(12, 30), 4, 'LCM', 'Pumped 40 bbl LCM pill and monitored well. Losses reduced to 5 bbl/hr.'],
    [T(12, 30), T(15), 2.5, 'WOW', 'Waiting on weather - crane operations suspended.'],
    [T(15), T(24), 9, 'TRIP', 'POOH from 8,510 ft to surface for bit change. L/D BHA #3.'],
    [],
    ['DRILLING PARAMETERS', null, null, null, null, 'MUD PROPERTIES'],
    ['Parameter', 'Min', 'Max', 'Avg', null, 'Property', 'Value', 'Unit'],
    ['WOB (klbs)', 20, 28, 25, null, 'Mud Weight', 9.8, 'ppg'],
    ['RPM', 80, 100, 90, null, 'ECD', 10.4, 'ppg'],
    ['Torque (ft-lbs)', 11000, 14500, 12800, null, 'Funnel Viscosity', 48, 'sec/qt'],
    ['Flow Rate (gpm)', 580, 620, 600],
    ['SPP (psi)', 3300, 3500, 3400],
    [],
    ['24 Hr Summary:', 'Drilled 8½" hole to 8,510 ft. Treated partial losses with LCM. Waited on weather. POOH for bit change.'],
    ['Planned Operations:', 'RIH with new bit and drill ahead to 9,200 ft. Expect losses in Formation X and plan to pump LCM if required.'],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(day1, ['A1:H1', 'E9:H9', 'E10:H10', 'E11:H11', 'E12:H12', 'E13:H13', 'E14:H14', 'E15:H15', 'B25:H25', 'B26:H26']), 'DDR 12');

  // second day: different layout - shifted right and down, text date in the title, clock ranges in one cell, no code column
  const day2: V[][] = [
    [],
    [null, 'Daily Drilling Report - 13-Mar-2025'],
    [],
    [null, 'Well', 'KH-07 (SAMPLE)', null, 'Present Depth', '8,790 ft', null, 'Footage', '280 ft'],
    [null, 'M.Wt', '9.9 ppg', null, 'Hole Dia', '8.5 in', null, 'Avg ROP', '50.9 ft/hr'],
    [],
    [null, 'Time', 'Daily Operations'],
    [null, '00:00 - 05:00', 'P/U new 8 1/2" bit and BHA #4. RIH to 8,510 ft.'],
    [null, '05:00 - 10:30', "Drill f/ 8510' t/ 8790' with ROP 50.9 fph. High torque observed while drilling Formation X."],
    [null, '10:30 - 14:00', 'Pipe stuck at 8,790 ft after connection. Worked pipe and jarred free. 3.5 hrs NPT.'],
    [null, '14:00 - 16:00', 'Circulated hole clean and conditioned mud. No drag on trip out of slips.'],
    [null, '16:00 - 24:00', 'Rig repair: top drive hydraulic leak.'],
    [null, null, 'internal note - hidden row'],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(day2, ['B2:I2'], [12]), 'DDR 13');

  const tops: V[][] = [
    ['Geological prognosis vs actual'],
    [],
    [],
    ['Formation', 'Top', null, 'Bottom', 'Lithology'],
    [null, 'MD (ft)', 'TVD (ft)', 'MD (ft)'],
    ['Upper Shale', 0, 0, 6900, 'Shale'],
    ['Formation W', 6900, 6790, 8400, 'Sandstone'],
    ['Formation X', 8400, 8240, 9100, 'Fractured limestone'],
    ['Formation Y', 9100, 8905, 10600, 'Shale'],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(tops, ['B4:C4']), 'Formation Tops');

  const npt: V[][] = [
    ['NPT / DOWNTIME LOG'],
    ['Date', 'From', 'To', 'Hrs', 'NPT Category', 'Description', 'Action Taken'],
    [D(2025, 3, 12), T(12, 30), T(15), 2.5, 'Waiting on Weather', 'Crane operations suspended due to high wind', 'Resumed operations when wind dropped below limit'],
    [D(2025, 3, 13), T(10, 30), T(14), 3.5, 'Stuck Pipe', 'String stuck at 8,790 ft after connection', 'Worked pipe, jarred free, circulated hole clean'],
    [D(2025, 3, 13), T(16), T(24), 8, 'Rig Repair', 'Top drive hydraulic leak', 'Replaced hydraulic hose'],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(npt, ['A1:G1']), 'NPT Log');

  const horiz: V[][] = [
    ['Surface parameters by day'],
    [],
    ['Parameter', D(2025, 3, 12), D(2025, 3, 13)],
    ['Hook Load (klbs)', 245, 251],
    ['Diff Pressure (psi)', 420, 455],
    ['Mud Weight (ppg)', 9.8, 9.9],
    ['Pump Liner Wear Index', 3, 4],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(horiz), 'Daily Params');

  const survey: V[][] = [['MD (ft)', 'Inc (deg)', 'Azi (deg)'], ...Array.from({ length: 12 }, (_, i) => [i * 800, Math.min(28, Math.max(0, (i - 4) * 4)), 142])];
  XLSX.utils.book_append_sheet(wb, sheet(survey), 'Survey');

  const other: V[][] = [['Well Name:', 'KH-02'], ['Report Date:', D(2024, 11, 2)], ['Depth MD (ft)', 5100], [], ['From', 'To', 'Hrs', 'Operations Summary'], [T(0), T(24), 24, 'Drilled from 4,800 ft to 5,100 ft.']];
  XLSX.utils.book_append_sheet(wb, sheet(other), 'old-KH02');
  wb.Workbook = { Sheets: wb.SheetNames.map(n => ({ name: n, Hidden: n === 'old-KH02' ? 1 : 0 })) } as XLSX.WBProps as never;
  return wb;
}

export const messyReportBuffer = (): ArrayBuffer => XLSX.write(messyReportWorkbook(), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
export function downloadMessyReport() { XLSX.writeFile(messyReportWorkbook(), 'SAMPLE_messy_drilling_report.xlsx'); }
