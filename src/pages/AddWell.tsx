import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Upload } from 'lucide-react';
import * as repo from '../db/repo';
import { useAuth, usePrefs } from '../lib/context';
import { WELL_TYPES, type WellStatus } from '../lib/types';
import { fmt, fmtDateTime, localDay, mToFt, UNITS } from '../lib/units';
import { CONNECTORS, readWorkbookFile, type LoadedWorkbook } from '../import/connectors';
import { autoConfig, DRILLING_FIELDS, extractProblems, processDrillingSheet, processSurveySheet, remap, SURVEY_FIELDS, type ImportOptions, type SheetConfig, type SheetRole } from '../import/parse';
import { extractWorkbook, type Extraction } from '../import/smart/engine';
import { extractionToUtc, recordsToUtc } from '../import/reportTime';
import type { Correction } from '../import/smart/incell';
import { paramSnapshot } from '../lib/kpi';
import { downloadSampleImportFile } from '../demo/load';
import { downloadMessyReport } from '../demo/messyReport';
import ExtractionReport from '../components/ExtractionReport';
import { Badge, Button, Card, cx, Field, Input, Notice, PageHeader, Select, Tabs, useAction, useAsync } from '../components/ui';

const SEV = { error: 'red', warning: 'yellow', info: 'gray' } as const;

export default function AddWell() {
  const { t } = usePrefs();
  const { canWrite } = useAuth();
  const nav = useNavigate();
  const [w, setW] = useState({ name: '', well_code: '', field: '', location: '', spud_date: '', planned_completion_date: '', target: '', hole_size: '', well_type: WELL_TYPES[0], status: 'completed' as WellStatus, unit: 'ft' as 'ft' | 'm', notes: '' });
  const [source, setSource] = useState<(typeof CONNECTORS)[number]['id']>('file');
  const [wb, setWb] = useState<LoadedWorkbook | null>(null);
  // intelligent reader: automatic by default, manual column mapping remains as a fallback
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [acceptNpt, setAcceptNpt] = useState<string[]>([]);
  const [fallbackDate, setFallbackDate] = useState('');
  const [corrections, setCorrections] = useState<Record<string, Correction>>({});
  const known = useAsync(async () => ({ learned: await repo.getLearnedTerms(), formations: (await repo.listFormations()).map(f => f.name) }), []);
  const [cfgs, setCfgs] = useState<SheetConfig[]>([]);
  const [sheet, setSheet] = useState('0');
  const [opts, setOpts] = useState<ImportOptions>({ dateOrder: 'auto', dropDuplicates: true });
  const [rev, setRev] = useState(0);   // bumped when a cell is corrected in place
  const [progress, setProgress] = useState('');
  const file = useAction(), save = useAction();
  const connector = CONNECTORS.find(c => c.id === source)!;
  const si = Number(sheet), cfg = cfgs[si];

  const results = useMemo(() => {
    if (!wb) return [];
    return wb.sheets.map((s, i) => {
      const c = cfgs[i];
      if (!c || c.role === 'ignore') return null;
      if (c.role !== 'drilling') return { kind: 'survey' as const, ...processSurveySheet(s, c) };
      const res = processDrillingSheet(s, c, { ...opts, declaredDepthUnit: w.unit });
      return { kind: 'drilling' as const, ...res, records: recordsToUtc(res.records) };   // report clock (Asia/Baghdad) -> UTC
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wb, cfgs, opts, w.unit, rev]);

  const smartOpts = (o: Record<string, string> = overrides, a = acceptNpt, d = fallbackDate, c = corrections) => ({ depthUnit: w.unit, dateOrder: opts.dateOrder, learned: known.data?.learned ?? {}, overrides: o, acceptNpt: a, fallbackDate: d || null, knownFormations: known.data?.formations ?? [], corrections: c });
  // the report's clock times (rig local time, Asia/Baghdad) become UTC instants here, once, before preview and saving
  const smart: Extraction | null = useMemo(() => (wb ? extractionToUtc(extractWorkbook(wb.smart, smartOpts())) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wb, w.unit, opts.dateOrder, overrides, acceptNpt, fallbackDate, known.data, corrections]);
  const auto = mode === 'auto' && !!smart;

  const manRecords = useMemo(() => results.flatMap(r => (r?.kind === 'drilling' ? r.records : [])).sort((a, b) => (a.ts < b.ts ? -1 : 1)), [results]);
  const allRecords = auto ? smart!.records : manRecords;
  const stations = useMemo(() => (auto ? smart!.stations : results.flatMap(r => (r?.kind === 'survey' ? r.stations : []))), [auto, smart, results]);
  const errors = auto ? smart!.issues.filter(i => i.severity === 'error') : results.flatMap(r => r?.issues.filter(i => i.severity === 'error' && i.type === 'missing_required') ?? []);
  const reported = useMemo(() => (auto ? [] : extractProblems(manRecords)), [auto, manRecords]);
  const cur = results[si];

  const onFile = (f: File | undefined) => f && file.run(async () => {
    const book = await readWorkbookFile(f);
    setOverrides({}); setAcceptNpt([]); setFallbackDate(''); setCorrections({});
    setWb(book); setCfgs(book.sheets.map(autoConfig)); setSheet('0'); setMode('auto');
    // fill empty well fields from what the report itself says (the user can still edit them)
    const first = extractWorkbook(book.smart, smartOpts({}, [], '', {}));
    const info = first.wellInfo;
    // a report written in metres: suggest metres as the well's depth unit (the report's own depth columns decide)
    const metric = first.sheets.some(s => s.tables.some(t => t.columns.some(c => c.unit === 'm' && /depth/i.test(c.concept ?? ''))));
    if (metric && !w.name) setW(p => ({ ...p, unit: 'm' }));
    const s = (k: string) => (info[k] ? String(info[k].value) : '');
    setW(p => ({
      ...p, name: p.name || s('well_name'), well_code: p.well_code || s('well_id') || s('well_name').replace(/\s*\(.*\)\s*/g, '').trim(), field: p.field || s('field'), location: p.location || s('location'),
      spud_date: p.spud_date || s('spud_date'), hole_size: p.hole_size || s('hole_size'),
      target: p.target || (typeof info.target_depth?.value === 'number' ? String(Math.round(p.unit === 'm' ? (info.target_depth.value as number) / 3.280839895 : (info.target_depth.value as number))) : ''),
    }));
  });
  const patchCfg = (patch: Partial<SheetConfig>) => setCfgs(cs => cs.map((c, i) => (i === si ? { ...c, ...patch } : c)));
  const setRole = (role: SheetRole) => setCfgs(cs => cs.map((c, i) => (i === si ? (role === 'ignore' ? { ...c, role } : remap(wb!.sheets[i], role, c.headerRow)) : c)));

  const submit = () => save.run(async () => {
    if (!w.name.trim() || !w.well_code.trim()) throw new Error(t('Well name and Well ID are required.'));
    if (wb && errors.length) throw new Error(auto ? errors[0].message : t('Fix the mapping errors before saving.'));
    // the same file is imported once: its content hash is stored with the import batch
    if (wb?.hash) {
      const prev = await repo.findBatchByHash(wb.hash);
      if (prev) { const pw = await repo.getWell(prev.well_id); throw new Error(`${t('This file was already imported')} (${prev.file_name ?? ''} → ${pw?.name ?? prev.well_id}, ${String(prev.created_at).slice(0, 10)}). ${t('Existing records are kept; nothing was imported again.')}`); }
    }
    const num = (s: string) => (s.trim() === '' || isNaN(Number(s)) ? null : Number(s));
    const target = num(w.target);
    setProgress(t('Creating well…'));
    const well = await repo.createWell({
      well_code: w.well_code, name: w.name.trim(), field: w.field || null, location: w.location || null, well_type: w.well_type, status: w.status,
      spud_date: w.spud_date || null, planned_completion_date: w.planned_completion_date || null,
      completion_date: w.status === 'completed' && allRecords.length ? localDay(allRecords[allRecords.length - 1].ts) : null,
      target_depth_ft: target == null ? null : w.unit === 'm' ? mToFt(target) : target, hole_size_in: num(w.hole_size),
      source_depth_unit: w.unit, is_demo: false, notes: w.notes || null,
    });
    try {
      if (allRecords.length) {
        setProgress(`${t('Importing drilling records…')} (${allRecords.length.toLocaleString()})`);
        const batch = auto
          ? await repo.createImportBatch(well.id, source === 'file' ? wb!.kind : source, wb!.fileName, allRecords.length,
            { engine: 'intelligent-reader', recordMode: smart!.recordMode, overrides, acceptNpt, sheets: smart!.sheets },
            { parameters: smart!.params, issues: smart!.issues, unresolved: smart!.unresolved, unclassified: smart!.unclassified.slice(0, 500), wellInfo: smart!.wellInfo, days: smart!.days.map(d => ({ date: d.date, fields: d.fields })) })
          : await repo.createImportBatch(well.id, source === 'file' ? wb!.kind : source, wb!.fileName, allRecords.length,
          cfgs.map((c, i) => ({ sheet: wb!.sheets[i].name, ...c })), results.map(r => r?.issues.map(i => ({ severity: i.severity, type: i.type, message: i.message, count: i.count })) ?? null));
        await repo.insertRecords(well.id, allRecords, batch);
        if (wb?.hash) await repo.setBatchHash(batch, wb.hash);
        if (auto && smart!.operations.length) {
          setProgress(`${t('Saving operations, BHA runs, tools, casing and cementing…')} (${smart!.operations.length} / ${smart!.tools.length})`);
          await repo.insertEquipment(well.id, batch, smart!);
        }
        if (auto && smart!.cellParams.length) {
          setProgress(`${t('Saving values read inside cells…')} (${smart!.cellParams.length.toLocaleString()})`);
          await repo.insertExtractedParameters(well.id, batch, smart!.cellParams);
        }
      }
      if (stations.length) { setProgress(t('Importing directional survey…')); await repo.insertSurvey(well.id, stations); }
      if (allRecords.length) {
        setProgress(t('Calculating daily reports, formation intervals and sections…'));
        await repo.rebuildDerived(well);
        const cats = await repo.listCategories();
        for (const p of reported) {
          await repo.saveProblem({
            well_id: well.id, category_id: cats.find(c => c.code === p.categoryCode)!.id, occurred_at: p.ts, md_top_ft: p.mdTop, md_bottom_ft: p.mdBottom,
            tvd_ft: p.rec.tvd_ft, formation_name: p.rec.formation_name, hole_size_in: p.rec.hole_size_in ?? well.hole_size_in, bha_number: p.rec.bha_number,
            activity_code: p.rec.activity_code, description: p.text, npt_hours: p.nptHours, status: 'suspected', source: 'import',
            notes: 'Created from the "Drilling Problems" column of the imported file. Category was guessed from the text - review and confirm.',
          }, well);
        }
      }
      if (auto) {
        // problems found by the intelligent reader: always "suspected", each linked to its worksheet cell and original text
        const cats = await repo.listCategories();
        const depthAt = (ts: string | null) => { if (!ts) return null; let d: number | null = null; for (const r of allRecords) { if (r.ts > ts) break; d = r.hole_depth_ft ?? r.md_ft ?? d; } return d; };
        // drilling parameters at the time of each problem (from the records just saved), for later comparisons with other wells
        const saved = allRecords.length ? await repo.getRecords(well.id) : [];
        const paramsAt = (ts: string | null) => { if (!ts || !saved.length) return null; const t0 = Date.parse(ts); let i = -1; for (let k = 0; k < saved.length && saved[k].t <= t0; k++) i = k; return i < 0 ? null : paramSnapshot(saved, i); };
        for (const p of smart!.problems) {
          const md = p.md ?? depthAt(p.ts);
          const obs = paramsAt(p.ts);
          const saved = await repo.saveProblem({
            well_id: well.id, category_id: (cats.find(c => c.code === p.category) ?? cats.find(c => c.code === 'OTHER')!).id, occurred_at: p.ts, md_top_ft: md ?? 0, md_bottom_ft: p.mdBottom,
            formation_name: p.formation, hole_size_in: p.holeSize ?? well.hole_size_in, description: `${p.label}: ${p.description}`, npt_hours: p.nptHours, severity: p.severity, status: 'suspected', source: 'import',
            observed_params: obs && Object.keys(obs).length ? obs : null,
            notes: `Extracted automatically (confidence ${Math.round(p.confidence * 100)}%). NPT basis: ${p.nptBasis}.${p.md == null ? (md == null ? ' Depth is not reported in the source (stored as 0).' : ' Depth taken from the hole depth at the time of the event (inferred).') : ''}`,
            source_ref: p.src, source_text: p.sourceText, extraction: { confidence: p.confidence, reportedHours: p.reportedHours, nptBasis: p.nptBasis, depthReported: p.md != null },
          }, well);
          for (const a of p.actions) await repo.addAction(saved.id, a, 'Extracted from the report');
        }
        const learn = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== 'ignore'));
        if (Object.keys(learn).length) await repo.learnTerms(learn);
      }
    } catch (e) {
      await repo.rollbackWell(well.id).catch(() => undefined);
      throw new Error(`${t('Import failed and the well was not saved')}: ${(e as Error).message}`);
    }
    nav(`/wells/${well.id}`);
  });

  if (!canWrite) return <Notice kind="warn">{t('Your role (Viewer) cannot add wells. Ask an Administrator for the Engineer role.')}</Notice>;
  const fields = cfg?.role === 'survey' ? SURVEY_FIELDS : DRILLING_FIELDS;
  const headers = (wb && cfg ? wb.sheets[si].rows[cfg.headerRow] : []) ?? [];
  const firstRow = (wb && cfg ? wb.sheets[si].rows[cfg.headerRow + 1] : []) ?? [];
  const inp = (k: keyof typeof w) => ({ value: w[k], onChange: (e: { target: { value: string } }) => setW(s => ({ ...s, [k]: e.target.value })) });

  return (
    <div className="space-y-4">
      <PageHeader title={t('Add New Well')} subtitle={t('Enter the well information, upload its drilling data, check the column mapping and validation, then save. Existing wells are never overwritten.')} />

      <Card title={`1 · ${t('Well information')}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={`${t('Well name')} *`}><Input {...inp('name')} /></Field>
          <Field label={`${t('Well ID')} *`} hint={t('Must be unique')}><Input {...inp('well_code')} dir="ltr" /></Field>
          <Field label={t('Field')}><Input {...inp('field')} /></Field>
          <Field label={t('Oilfield location')}><Input {...inp('location')} /></Field>
          <Field label={t('Spud date')}><Input type="date" {...inp('spud_date')} /></Field>
          <Field label={t('Planned completion date')}><Input type="date" {...inp('planned_completion_date')} /></Field>
          <Field label={t('Depth unit of this well')} hint={t('Used for target depth and checked against the file')}>
            <Select {...inp('unit')}><option value="ft">{t('feet (ft)')}</option><option value="m">{t('metres (m)')}</option></Select>
          </Field>
          <Field label={`${t('Target depth')} (${w.unit}, MD)`}><Input {...inp('target')} inputMode="decimal" /></Field>
          <Field label={`${t('Hole Size')} (in)`} hint={t('Final hole size; per-record hole size in the file takes precedence')}><Input {...inp('hole_size')} inputMode="decimal" /></Field>
          <Field label={t('Well type')}><Select {...inp('well_type')}>{WELL_TYPES.map(x => <option key={x} value={x}>{t(x)}</option>)}</Select></Field>
          <Field label={t('Well status')}><Select {...inp('status')}><option value="completed">{t('completed')}</option><option value="active">{t('active')}</option><option value="planned">{t('planned')}</option></Select></Field>
          <Field label={t('Notes')} className="lg:col-span-1"><Input {...inp('notes')} /></Field>
        </div>
      </Card>

      <Card title={`2 · ${t('Drilling data file')}`} right={<span className="flex flex-wrap gap-3">
        <button className="inline-flex items-center gap-1 text-cyan-300 hover:underline" onClick={downloadMessyReport}><Download size={13} />{t('Sample messy daily report (synthetic)')}</button>
        <button className="inline-flex items-center gap-1 text-cyan-300 hover:underline" onClick={downloadSampleImportFile}><Download size={13} />{t('Sample time-based data file (synthetic, metric)')}</button>
      </span>}>
        <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
          <Field label={t('Data source')}>
            <Select value={source} onChange={e => setSource(e.target.value as typeof source)}>{CONNECTORS.map(c => <option key={c.id} value={c.id}>{t(c.label)}{c.available ? '' : ` — ${t('not configured')}`}</option>)}</Select>
          </Field>
          <div>
            {connector.note && <Notice kind={connector.available ? 'info' : 'warn'} className="mb-2">{t(connector.note)}</Notice>}
            {connector.available && (
              <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-line px-4 py-4 hover:border-cyan-500/60"
                onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFile(e.dataTransfer.files[0]); }}>
                <Upload size={18} className="text-cyan-300" />
                <span className="text-[13px]">{wb ? <><b>{wb.fileName}</b> — {wb.sheets.length} {t('sheet(s)')}</> : t('Choose or drop an Excel (.xlsx, .xls) or CSV file')}</span>
                <input type="file" accept=".xlsx,.xls,.csv,.pbix" className="hidden" onChange={e => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            )}
            {file.error && <Notice kind="error" className="mt-2">{file.error}</Notice>}
            <p className="mt-2 text-xs text-mute">{t('The file is optional, but this version cannot add drilling data to a well after it is saved - upload the data now if you have it.')}</p>
          </div>
        </div>
      </Card>

      {wb && smart && (
        <Card title={`3 · ${t(mode === 'auto' ? 'Automatic extraction report' : 'Manual column mapping')}`}
          right={<div className="flex items-center overflow-hidden rounded-md border border-line text-xs" role="group">
            {(['auto', 'manual'] as const).map(m => <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={cx('px-2.5 py-1', mode === m ? 'bg-cyan-500/15 text-cyan-200' : 'text-mute hover:text-ink')}>{t(m === 'auto' ? 'Automatic reading' : 'Manual mapping')}</button>)}
          </div>}>
          {mode === 'auto' ? <>
            <p className="mb-3 text-xs text-mute">{t('The report was read as it is: every worksheet, table, label and paragraph. Review what was found; you only need to act on the "Needs your input" tab, if anything is listed there.')}</p>
            {!smart.records.length && <Notice kind="warn" className="mb-3">{t('No simulation-ready drilling records could be built from this workbook (no dated depths or operations were found). You can still save the well information, or switch to manual mapping.')}</Notice>}
            <ExtractionReport ex={smart} overrides={overrides} setOverrides={setOverrides} acceptNpt={acceptNpt} setAcceptNpt={setAcceptNpt} fallbackDate={fallbackDate} setFallbackDate={setFallbackDate} corrections={corrections} setCorrections={setCorrections} />
          </> : <p className="text-xs text-mute">{t('Manual mode: assign each sheet and column yourself in the two sections below.')}</p>}
        </Card>
      )}

      {wb && cfg && mode === 'manual' && (
        <>
          <Card title={`3a · ${t('Sheets and column mapping')}`}>
            <Tabs tabs={wb.sheets.map((s, i) => ({ id: String(i), label: <>{s.name} <Badge color={cfgs[i].role === 'ignore' ? 'gray' : 'cyan'} className="ms-1">{t(cfgs[i].role)}</Badge></> }))} value={sheet} onChange={setSheet} />
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t('This sheet contains')}>
                <Select value={cfg.role} onChange={e => setRole(e.target.value as SheetRole)}><option value="drilling">{t('Drilling data (time-based records)')}</option><option value="survey">{t('Directional survey (MD / Inc / Azi)')}</option><option value="ignore">{t('Ignore this sheet')}</option></Select>
              </Field>
              <Field label={t('Header row')} hint={t('Row number that holds the column names')}>
                <Input type="number" min={1} value={cfg.headerRow + 1} onChange={e => { const h = Math.max(0, Number(e.target.value) - 1); setCfgs(cs => cs.map((c, i) => (i === si ? (c.role === 'ignore' ? { ...c, headerRow: h } : remap(wb.sheets[i], c.role, h)) : c))); }} />
              </Field>
              {cfg.role === 'drilling' && <>
                <Field label={t('Date format')}><Select value={opts.dateOrder} onChange={e => setOpts(o => ({ ...o, dateOrder: e.target.value as ImportOptions['dateOrder'] }))}><option value="auto">{t('Detect automatically')}</option><option value="DMY">{t('Day first (DD/MM/YYYY)')}</option><option value="MDY">{t('Month first (MM/DD/YYYY)')}</option></Select></Field>
                <Field label={t('Duplicate timestamps')}><Select value={opts.dropDuplicates ? '1' : '0'} onChange={e => setOpts(o => ({ ...o, dropDuplicates: e.target.value === '1' }))}><option value="1">{t('Keep the first, drop the rest')}</option><option value="0">{t('Keep all')}</option></Select></Field>
              </>}
            </div>
            {cfg.role !== 'ignore' && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="border-b border-line text-[11px] uppercase tracking-wide text-mute"><th className="px-2 py-1.5 text-start font-medium">{t('Dashboard field')}</th><th className="px-2 text-start font-medium">{t('Column in file')}</th><th className="px-2 text-start font-medium">{t('Unit in file')}</th><th className="px-2 text-start font-medium">{t('First value')}</th></tr></thead>
                  <tbody>{fields.map(f => {
                    const c = cfg.mapping[f.key];
                    return (
                      <tr key={f.key} className="border-b border-line/50">
                        <td className="px-2 py-1">{t(f.label)}</td>
                        <td className="px-2 py-1"><Select className="h-8" value={c ?? ''} onChange={e => patchCfg({ mapping: { ...cfg.mapping, [f.key]: e.target.value === '' ? null : Number(e.target.value) } })}>
                          <option value="">— {t('not mapped')} —</option>{headers.map((h, i) => <option key={i} value={i}>{String(h ?? `(${t('column')} ${i + 1})`)}</option>)}</Select></td>
                        <td className="px-2 py-1">{f.dim !== 'none' && c != null ? <Select className="h-8 w-28" value={cfg.units[f.key]} onChange={e => patchCfg({ units: { ...cfg.units, [f.key]: e.target.value } })}>{Object.keys(UNITS[f.dim]).map(u => <option key={u}>{u}</option>)}</Select> : <span className="text-mute">—</span>}</td>
                        <td className="num px-2 py-1 text-mute" dir="ltr">{c != null ? String(firstRow[c] ?? '') : ''}</td>
                      </tr>);
                  })}</tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={`4 · ${t('Validation and preview')}`} right={cur?.kind === 'drilling' ? `${cur.stats.rows.toLocaleString()} ${t('rows read')} · ${cur.stats.imported.toLocaleString()} ${t('will be imported')} · ${cur.stats.skipped.toLocaleString()} ${t('skipped')}` : cur?.kind === 'survey' ? `${cur.stations.length} ${t('survey stations')}` : undefined}>
            {!cur ? <p className="text-[13px] text-mute">{t('This sheet is ignored.')}</p> : (
              <div className="space-y-3">
                {!cur.issues.length && <Notice kind="ok">{t('No validation issues found on this sheet.')}</Notice>}
                <ul className="space-y-1.5">{cur.issues.map((i, k) => (
                  <li key={k} className="flex items-start gap-2 text-[13px]"><Badge color={SEV[i.severity]}>{t(i.severity)}</Badge>
                    <span className="flex-1">{i.message}{i.count > 1 && i.rows.length > 0 && <span className="text-mute"> ({i.count.toLocaleString()} {t('rows')})</span>}
                      {i.rows.length > 0 && <span className="num block text-[11px] text-mute" dir="ltr">{t('rows')}: {i.rows.slice(0, 12).join(', ')}{i.count > 12 ? ' …' : ''}</span>}</span></li>))}</ul>
                {cur.kind === 'drilling' && cur.badCells.length > 0 && (
                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('Correct invalid cells')} ({cur.badCells.length})</h4>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{cur.badCells.slice(0, 30).map(b => (
                      <label key={`${b.row}-${b.col}`} className="flex items-center gap-2 text-xs"><span className="w-40 shrink-0 text-mute">{t('row')} {b.row + 1} · {String(headers[b.col] ?? b.field)}<span className="block text-[10px]">{t(b.reason)}</span></span>
                        <Input className="h-8" defaultValue={String(b.value ?? '')} dir="ltr" onBlur={e => { if (e.target.value !== String(b.value ?? '')) { wb.sheets[si].rows[b.row][b.col] = e.target.value; setRev(r => r + 1); } }} /></label>))}</div>
                    <p className="mt-1 text-[11px] text-mute">{t('Edit a value and leave the box to re-validate. Uncorrected dates are skipped; uncorrected numbers are stored as empty.')}</p>
                  </div>
                )}
                {cur.kind === 'drilling' && cur.records.length > 0 && (
                  <div className="overflow-x-auto">
                    <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('Preview after unit conversion (stored units)')}</h4>
                    <table className="w-full text-xs" dir="ltr">
                      <thead><tr className="border-b border-line text-mute">{['Time (UTC)', 'MD ft', 'TVD ft', 'Bit ft', 'Hole ft', 'ROP ft/h', 'WOB klb', 'RPM', 'Torque ft-lb', 'SPP psi', 'Diff psi', 'Flow gpm', 'MW ppg', 'Activity', 'Formation'].map(h => <th key={h} className="px-2 py-1 text-start font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                      <tbody>{cur.records.slice(0, 10).map((r, i) => (
                        <tr key={i} className="num border-b border-line/40">
                          <td className="px-2 py-1 whitespace-nowrap">{fmtDateTime(r.ts)}</td>
                          {[r.md_ft, r.tvd_ft, r.bit_depth_ft, r.hole_depth_ft, r.rop_fph, r.wob_klb, r.rpm, r.torque_ftlb, r.spp_psi, r.diff_pressure_psi, r.flow_gpm, r.mud_weight_ppg].map((x, j) => <td key={j} className="px-2 py-1">{fmt(x, j === 11 || j === 4 || j === 5 ? 1 : 0)}</td>)}
                          <td className="px-2 py-1">{r.activity_code ?? '—'}</td><td className="px-2 py-1 whitespace-nowrap">{r.formation_name ?? '—'}</td>
                        </tr>))}</tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      <Card title={`${wb ? 5 : 3} · ${t('Save')}`}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 text-[13px] text-mute">
            {allRecords.length ? <>{allRecords.length.toLocaleString()} {t('drilling records')}{stations.length ? ` · ${stations.length} ${t('survey stations')}` : ` · ${t('no survey (schematic will be illustrative)')}`}
              {(auto ? smart!.problems.length : reported.length) > 0 && <> · {auto ? smart!.problems.length : reported.length} {t('reported problem(s) will be saved as "suspected" for engineer review')}</>}</> : t('No drilling data selected - only the well information will be saved.')}
          </div>
          <Button variant="primary" disabled={save.busy || (!!wb && errors.length > 0)} onClick={submit} className={cx(save.busy && 'animate-pulse')}>{save.busy ? progress || t('Please wait…') : t('Save well')}</Button>
        </div>
        {save.error && <Notice kind="error" className="mt-3">{save.error}</Notice>}
      </Card>
    </div>
  );
}
