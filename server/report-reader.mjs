// Server-side report reader: the same extraction engine the app uses, run in Node.
//
//   CLI   node server/report-reader.mjs <report.xlsx> [--unit m|ft] [--out <folder>]
//         prints a summary and writes <name>.extraction.json and <name>.extraction_map.csv to --out (default: ./reports)
//   HTTP  node server/report-reader.mjs --serve [--port 8788]
//         POST /extract?unit=m&name=XX-1.xlsx   body: the .xlsx / .xls / .csv file (application/octet-stream)
//         -> JSON: summary, records, problems, formations, survey stations and every value read inside cells
//
// The input file is only read, never modified. The engine source is TypeScript; Vite loads it in Node (no build step).
import http from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createVite } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const vite = await createVite({ root: ROOT, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const { readSmart } = await vite.ssrLoadModule('/src/import/smart/workbook.ts');
const { extractWorkbook } = await vite.ssrLoadModule('/src/import/smart/engine.ts');

function extract(buf, name, unit) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const wb = /\.csv$/i.test(name) ? readSmart(buf.toString('utf8'), name).smart : readSmart(ab, name).smart;
  return extractWorkbook(wb, { depthUnit: unit === 'ft' ? 'ft' : 'm', dateOrder: 'auto', learned: {}, overrides: {}, acceptNpt: [], fallbackDate: null, knownFormations: [] });
}
const summary = ex => ({
  recordMode: ex.recordMode, dateOrder: ex.dateOrder, sheets: ex.sheets.map(s => ({ name: s.name, tables: s.tables.map(t => ({ kind: t.kind, range: t.range, rows: t.rows })) })),
  operations: ex.days.reduce((s, d) => s + d.ops.length, 0), days: ex.days.length, records: ex.records.length,
  nptHours: Math.round(ex.records.reduce((s, r) => s + (r.npt_hours ?? 0), 0) * 100) / 100,
  finalHoleDepthFt: Math.max(0, ...ex.records.map(r => r.hole_depth_ft ?? 0)), problems: ex.problems.length, formations: ex.formations.length, surveyStations: ex.stations.length,
  coverage: { ...ex.coverage, missed: ex.coverage.missed.length }, missingParameters: ex.params.filter(p => p.status === 'missing').map(p => p.label),
  issues: ex.issues.map(i => `${i.severity}: ${i.message}`),
});
const csv = ex => {
  const q = v => { const t = v == null ? '' : String(v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const head = ['Parameter', 'Key', 'Qualifier', 'Original text', 'Value', 'Min', 'Max', 'Unit as written', 'Unit', 'Database value', 'Database unit', 'Worksheet', 'Cell', 'Context', 'Confidence', 'Status', 'Method', 'Notes', 'Used', 'Time', 'MD (ft)'];
  return '﻿' + [head.join(','), ...ex.cellParams.map(h => [h.label, h.key, h.qualifier, h.text, h.value, h.min, h.max, h.unitRaw, h.unit, h.canonical, h.canonicalUnit, h.sheet, h.cell, h.context, h.confidence, h.status, h.method, h.notes.join('; '), h.use ? 'yes' : 'no', h.ts, h.md_ft].map(q).join(','))].join('\r\n');
};

if (args.includes('--serve')) {
  const port = Number(opt('--port', 8788)), origin = process.env.ALLOW_ORIGIN ?? 'http://localhost:5173';
  http.createServer((req, res) => {
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' }); res.end(JSON.stringify(obj)); };
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'OPTIONS') return send(204, {});
    if (req.method !== 'POST' || url.pathname !== '/extract') return send(404, { error: 'POST /extract with the report file as the body' });
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > 50e6) { send(413, { error: 'file larger than 50 MB' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try {
        const name = url.searchParams.get('name') ?? 'report.xlsx';
        const ex = extract(Buffer.concat(chunks), name, url.searchParams.get('unit') ?? 'm');
        send(200, { summary: summary(ex), records: ex.records, problems: ex.problems, formations: ex.formations, stations: ex.stations, cellParams: ex.cellParams, unread: ex.coverage.missed, issues: ex.issues });
      } catch (e) { send(400, { error: e instanceof Error ? e.message : String(e) }); }
    });
  }).listen(port, () => console.log(`report reader listening on http://localhost:${port}/extract`));
} else {
  const file = args.find(a => !a.startsWith('--') && a !== opt('--unit') && a !== opt('--out'));
  if (!file) { console.error('usage: node server/report-reader.mjs <report.xlsx> [--unit m|ft] [--out folder]   |   --serve [--port 8788]'); process.exit(2); }
  const name = basename(file), out = resolve(opt('--out', 'reports'));
  const t0 = Date.now(), ex = extract(readFileSync(file), name, opt('--unit', 'm'));
  mkdirSync(out, { recursive: true });
  const stem = name.replace(/\.[^.]+$/, '');
  writeFileSync(join(out, `${stem}.extraction.json`), JSON.stringify({ summary: summary(ex), formations: ex.formations, stations: ex.stations, problems: ex.problems, unread: ex.coverage.missed }, null, 1));
  writeFileSync(join(out, `${stem}.extraction_map.csv`), csv(ex));
  console.log(JSON.stringify({ file: name, ms: Date.now() - t0, ...summary(ex), issues: undefined }, null, 1));
  console.log(`wrote ${join(out, `${stem}.extraction.json`)} and ${join(out, `${stem}.extraction_map.csv`)}`);
  await vite.close();
}
