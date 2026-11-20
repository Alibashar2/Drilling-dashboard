// Extraction report: what the intelligent reader found in the uploaded workbook, with status, confidence
// and the worksheet!cell of every item, plus the few decisions that genuinely need a person.
import { useState } from 'react';
import { usePrefs } from '../lib/context';
import { ACT, actName } from '../lib/types';
import { fmt, fmtDateTime, fmtTime } from '../lib/units';
import { CONCEPT, CONCEPTS } from '../import/smart/dictionary';
import type { Extraction, Ex, Status } from '../import/smart/engine';
import { llmAvailable, llmClassifyLabels } from '../import/smart/llm';
import type { Correction } from '../import/smart/incell';
import CellValues from './CellValues';
import { inch } from './SimPanels';
import { Badge, Button, cx, Notice, Select, Stat, Tabs, useAction } from './ui';

const STATUS_COLOR: Record<Status | 'missing', string> = { confirmed: 'green', inferred: 'cyan', suspected: 'yellow', missing: 'gray' };
const STATUS_TEXT: Record<Status | 'missing', string> = { confirmed: 'Confirmed', inferred: 'Inferred', suspected: 'Suspected', missing: 'Missing' };
const SEV = { error: 'red', warning: 'yellow', info: 'gray' } as const;
type Tab = 'overview' | 'cells' | 'equipment' | 'params' | 'ops' | 'problems' | 'geology' | 'attention' | 'rest';

const Src = ({ s }: { s: string }) => <span className="num text-[11px] text-mute" dir="ltr">{s}</span>;
const Conf = ({ v }: { v: number }) => <span className="num">{v > 0 ? `${Math.round(v * 100)}%` : '—'}</span>;
const Val = ({ ex }: { ex: Ex }) => <span title={ex.note}>{typeof ex.value === 'number' ? fmt(ex.value, ex.value % 1 ? 2 : 0) : ex.value}{ex.unit && typeof ex.value === 'number' ? ` ${ex.unit}` : ''}{ex.note && <span className="text-mute"> *</span>}</span>;

interface Props {
  ex: Extraction;
  overrides: Record<string, string>; setOverrides: (o: Record<string, string>) => void;
  acceptNpt: string[]; setAcceptNpt: (a: string[]) => void;
  fallbackDate: string; setFallbackDate: (d: string) => void;
  corrections: Record<string, Correction>; setCorrections: (c: Record<string, Correction>) => void;
}

export default function ExtractionReport({ ex, overrides, setOverrides, acceptNpt, setAcceptNpt, fallbackDate, setFallbackDate, corrections, setCorrections }: Props) {
  const { t, U } = usePrefs();
  const [tab, setTab] = useState<Tab>('overview');
  const [ai, setAi] = useState<Record<string, string>>({});
  const act = useAction();
  const found = ex.params.filter(p => p.status !== 'missing'), missing = ex.params.filter(p => p.status === 'missing');
  const attention = ex.unresolved.length + ex.nptCandidates.length + (ex.needsDate ? 1 : 0);
  const tables = ex.sheets.reduce((s, x) => s + x.tables.length, 0);
  const groups = [...new Set(ex.params.map(p => p.group))];
  const th = 'border-b border-line px-2 py-1.5 text-start text-[11px] font-medium uppercase tracking-wide text-mute whitespace-nowrap';
  const td = 'border-b border-line/40 px-2 py-1.5 align-top';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Stat label={t('Worksheets')} value={ex.sheets.length} sub={`${ex.sheets.filter(s => s.hidden).length} ${t('hidden')}`} />
        <Stat label={t('Tables detected')} value={tables} />
        <Stat label={t('Report days')} value={ex.days.length} />
        <Stat label={t('Operations')} value={ex.days.reduce((s, d) => s + d.ops.length, 0)} />
        <Stat label={t('Parameters found')} value={`${found.length}/${ex.params.length}`} />
        <Stat label={t('Records to create')} value={ex.records.length.toLocaleString()} sub={t(ex.recordMode)} />
        <Stat label={t('Problems detected')} value={ex.problems.length} sub={t('saved as suspected')} />
        <Stat label={t('Needs your input')} value={attention} className={attention ? 'border-yellow-500/50' : ''} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { id: 'overview', label: t('Worksheets & tables') },
        { id: 'cells', label: <>{t('Values in cells')} <span className="num text-mute">({ex.cellParams.length.toLocaleString()})</span></> },
        { id: 'equipment', label: <>{t('Operations & equipment')} <span className="num text-mute">({ex.operations.length} / {ex.tools.length})</span></> },
        { id: 'params', label: t('Parameters & confidence') }, { id: 'ops', label: t('Daily operations') },
        { id: 'problems', label: `${t('Problems')} (${ex.problems.length})` }, { id: 'geology', label: t('Formations & well data') },
        { id: 'attention', label: <>{t('Needs your input')} {attention > 0 && <Badge color="yellow" className="ms-1">{attention}</Badge>}</> },
        { id: 'rest', label: `${t('Validation & unclassified')} (${ex.issues.length + ex.unclassified.length})` },
      ]} />

      {tab === 'overview' && (
        <div className="space-y-3">{ex.sheets.map(s => (
          <div key={s.name} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center gap-2 text-[13px]"><b>{s.name}</b>
              {s.hidden && <Badge>{t('hidden sheet')}</Badge>}{s.excluded && <Badge color="orange">{t('not merged')}</Badge>}
              <span className="num text-xs text-mute">{s.rows} × {s.cols} · {s.merges} {t('merged ranges')} · {s.formulas} {t('formulas')} · {s.kv} {t('label/value pairs')} · {s.narratives} {t('paragraphs')}{s.hiddenRows + s.hiddenCols > 0 && ` · ${s.hiddenRows} ${t('hidden rows')}, ${s.hiddenCols} ${t('hidden columns')}`}</span>
            </div>
            {s.excluded && <p className="mt-1 text-xs text-orange-200">{s.excluded}</p>}
            {s.sections.length > 0 && <p className="mt-1 text-xs text-mute">{t('Sections')}: {s.sections.join(' · ')}</p>}
            {s.tables.map((tb, i) => (
              <div key={i} className="mt-2 rounded border border-line/60 bg-bg/40 p-2">
                <div className="flex flex-wrap items-center gap-2 text-xs"><Badge color="cyan">{t(tb.kind)}</Badge><b>{tb.title ?? t('Untitled table')}</b><Src s={`${s.name}!${tb.range}`} /><span className="text-mute">{tb.rows} {t('rows')}</span></div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">{tb.columns.map((c, k) => (
                  <span key={k} className={cx('rounded border px-1.5 py-0.5 text-[11px]', c.concept ? 'border-line text-ink' : 'border-yellow-500/50 text-yellow-200')}>
                    <span className="text-mute">{c.header}</span> → {c.concept ? t(c.concept) : t('not recognised')}{c.unit ? ` (${c.unit})` : ''}{c.concept && <span className="num text-mute"> {Math.round(c.confidence * 100)}%</span>}
                  </span>))}</div>
              </div>))}
            {!s.tables.length && <p className="mt-1 text-xs text-mute">{t('No table detected on this sheet.')}</p>}
          </div>))}</div>
      )}

      {tab === 'cells' && <CellValues ex={ex} corrections={corrections} setCorrections={setCorrections} />}

      {tab === 'equipment' && (() => {
        const byCat = new Map<string, number>(); for (const o of ex.operations) byCat.set(`${o.category} · ${o.name}`, (byCat.get(`${o.category} · ${o.name}`) ?? 0) + 1);
        const unspecified = ex.operations.filter(o => o.code === 'UNSPECIFIED'), noOd = ex.tools.filter(x => x.od == null);
        const ni = (v: number | null) => (v == null ? <span className="italic text-mute">{t('Not available')}</span> : inch(v));
        return (
          <div className="space-y-3 text-[13px]">
            <Notice>{t('Operations are named from the report\'s task code or operation text; when neither says enough they are "Not specified in report". Tools, casing and cement jobs are read from the operation text; a dimension that is not written stays "Not available". Everything can be corrected after saving on the well page.')}</Notice>
            <div className="grid gap-3 lg:grid-cols-2">
              <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('Operations')} ({ex.operations.length})</h4>
                <ul className="max-h-72 space-y-0.5 overflow-auto text-xs">{[...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k} className="flex justify-between gap-2"><span>{t(k)}</span><span className="num text-mute">{v}</span></li>)}</ul>
                {unspecified.length > 0 && <p className="mt-1 text-xs text-yellow-200">{unspecified.length} {t('not specified in report')}: {unspecified.slice(0, 5).map(o => o.src).join(', ')}</p>}
              </div>
              <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('Hole sections')}</h4>
                <table className="w-full text-xs"><thead><tr>{['#', 'Hole diameter', 'Bit diameter', 'Casing diameter', 'Casing shoe', 'Interval'].map(h => <th key={h} className={th}>{t(h)}</th>)}</tr></thead>
                  <tbody>{ex.holeSections.map(s => <tr key={s.no}><td className={td}>{s.no}</td><td className={cx(td, 'num')}>{ni(s.holeSize)}</td><td className={cx(td, 'num')}>{s.bitSizes.length ? s.bitSizes.map(inch).join(', ') : ni(null)}</td><td className={cx(td, 'num')}>{ni(s.casingOd)}</td><td className={cx(td, 'num')}>{s.shoeMd != null ? U.fdu(s.shoeMd) : ni(null)}</td><td className={cx(td, 'num')}>{U.fd(s.topMd)} – {U.fdu(s.bottomMd)}</td></tr>)}</tbody></table>
              </div>
            </div>
            <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('BHA runs')} ({ex.bhaRuns.length})</h4>
              <ul className="space-y-0.5 text-xs">{ex.bhaRuns.map(r => <li key={r.runNo}><b>{t('Run')} {r.runNo}</b> {r.bhaType ?? ''} · {t('Hole')} {inch(r.holeSize) ?? '—'} · {t('Bit')} {ni(r.bitSize)} {[r.bitType, r.bitModel].filter(Boolean).join(' ')} {r.bitSerial ? `SN ${r.bitSerial}` : ''} · {ex.tools.filter(x => x.bhaRun === r.runNo).length} {t('tools')} <Src s={r.src} /></li>)}</ul></div>
            <div><h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('Casing strings and cement jobs')}</h4>
              <ul className="space-y-0.5 text-xs">{ex.casings.map(c => { const j = ex.cementJobs.find(x => x.casingOd === c.od); return <li key={c.od}><b>{inch(c.od)} {t(c.kind)}</b> · {c.weights.map(w => `${w.ppf} ppf`).join(', ') || t('weight not written')} · {c.grades.join(', ')} {c.connections.join(', ')} · {t('shoe')} {c.shoeMd != null ? U.fdu(c.shoeMd) : t('Not available')} ({t(c.shoeBasis || 'not stated')}){j && ` · ${t('cement job')}: ${j.stages} ${t('stage(s)')}, ${j.fluids.length} ${t('fluids')}, FCP ${j.fcpPsi ?? '—'} psi`} <Src s={c.src} /></li>; })}</ul></div>
            <p className="text-xs text-mute">{ex.tools.length} {t('tools')} · {noOd.length} {t('without an outer diameter in the report (shown as "Not available")')}</p>
          </div>);
      })()}

      {tab === 'params' && (
        <div>
          <p className="mb-2 text-xs text-mute">{t('Confirmed = written in the source. Inferred = calculated from other reported values. Suspected = interpreted from context. Missing = not found; nothing is filled in for it.')}</p>
          <div className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead><tr><th className={th}>{t('Parameter')}</th><th className={th}>{t('Status')}</th><th className={th}>{t('Confidence')}</th><th className={th}>{t('Values')}</th><th className={th}>{t('Example from the source')}</th><th className={th}>{t('Source location')}</th></tr></thead>
            <tbody>{groups.flatMap(g => [
              <tr key={g}><td colSpan={6} className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-cyan-300">{t(g)}</td></tr>,
              ...ex.params.filter(p => p.group === g).map(p => (
                <tr key={p.key}><td className={td}>{t(p.label)}</td><td className={td}><Badge color={STATUS_COLOR[p.status]}>{t(STATUS_TEXT[p.status])}</Badge></td>
                  <td className={td}><Conf v={p.confidence} /></td><td className={cx(td, 'num')}>{p.count || '—'}</td><td className={cx(td, 'max-w-md text-mute')}>{p.sample || '—'}</td><td className={td}><Src s={p.src} /></td></tr>)),
            ])}</tbody>
          </table></div>
          {missing.length > 0 && <p className="mt-2 text-xs text-mute">{t('Missing parameters')}: {missing.map(p => t(p.label)).join(', ')}</p>}
        </div>
      )}

      {tab === 'ops' && (
        <div className="space-y-3">
          {!ex.days.length && <p className="text-[13px] text-mute">{t('No dated daily information was found in this workbook.')}</p>}
          {ex.days.map(d => (
            <div key={d.date} className="rounded-md border border-line p-3">
              <div className="flex flex-wrap items-center gap-2"><b className="num">{d.date}</b><Src s={d.src} /></div>
              <div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(d.fields).map(([k, v]) => (
                <span key={k} className="rounded border border-line px-1.5 py-0.5 text-[11px]" title={`${v.src}${v.note ? ' · ' + v.note : ''} · ${t('original')}: ${v.raw}`}>
                  <span className="text-mute">{t(CONCEPT[k]?.label ?? k)}:</span> <Val ex={v} /> <span className={cx('num', v.status === 'confirmed' ? 'text-emerald-300' : 'text-cyan-300')}>{Math.round(v.confidence * 100)}%</span>
                </span>))}</div>
              {d.ops.length > 0 && <div className="mt-2 overflow-x-auto"><table className="w-full text-xs">
                <thead><tr><th className={th}>{t('Time')}</th><th className={th}>h</th><th className={th}>{t('Rig state')}</th><th className={th}>{t('Extracted')}</th><th className={th}>{t('Original text')}</th><th className={th}>{t('Source')}</th></tr></thead>
                <tbody>{d.ops.map(o => (
                  <tr key={o.id}><td className={cx(td, 'num whitespace-nowrap')}>{fmtTime(o.start)}–{fmtTime(o.end)}</td><td className={cx(td, 'num')}>{fmt(o.hours, 1)}</td>
                    <td className={td}><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-sm" style={{ background: ACT[o.activity]?.color }} />{t(actName(o.activity))}</span></td>
                    <td className={td}><div className="flex flex-wrap gap-1">
                      {o.interval && <Badge color={STATUS_COLOR[o.interval.status]}>{U.fd(o.interval.from)}–{U.fd(o.interval.to)} {U.dl}</Badge>}
                      {o.interval && <Badge color="cyan">{t('footage')} {U.fd(o.interval.to - o.interval.from)} {U.dl} ({t('calculated')})</Badge>}
                      {o.rop != null && <Badge>ROP {U.fr(o.rop)} {U.rl}</Badge>}
                      {o.formation && <Badge>{o.formation}</Badge>}
                      {o.problems.map(p => <Badge key={p} color="orange">{t(p)}</Badge>)}
                      {o.npt && <Badge color={o.nptCounted ? 'red' : 'yellow'}>{o.nptCounted ? t('NPT') : t('possible NPT – not counted')}</Badge>}
                    </div>
                    {o.task && <div className="mt-1 text-[11px] text-mute">{o.task}</div>}
                    {o.params.length > 0 && <div className="mt-1 flex max-w-md flex-wrap gap-1">{o.params.map((p, i) => <span key={i} className="rounded border border-line/70 px-1 text-[10px] text-ink/80">{p}</span>)}</div>}
                    </td>
                    <td className={cx(td, 'max-w-xl text-mute')}>{o.text}</td><td className={td}><Src s={o.src} /></td></tr>))}</tbody>
              </table></div>}
              {d.narratives.map((n, i) => (
                <p key={i} className="mt-2 text-xs"><Badge color={n.planned ? 'gray' : 'cyan'}>{n.planned ? t('planned – not imported as actual') : t(n.label ?? 'Narrative')}</Badge> <span className="text-mute">{n.text}</span> <Src s={n.src} /></p>))}
            </div>))}
        </div>
      )}

      {tab === 'problems' && (
        <div className="space-y-2">
          <Notice>{t('Problems found in the report are saved as "suspected" for an engineer to confirm. A duration is counted as NPT only when the report classifies it as NPT.')}{ex.negatedMentions > 0 && ` ${ex.negatedMentions} ${t('statement(s) such as "no losses" were recognised as negative and not recorded as problems.')}`}</Notice>
          {!ex.problems.length && <p className="text-[13px] text-mute">{t('No problems detected.')}</p>}
          {ex.problems.map(p => (
            <div key={p.id} className="rounded-md border border-line p-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-2"><b>{t(p.label)}</b><Badge color="yellow">{t('Suspected')}</Badge><Badge><Conf v={p.confidence} /></Badge>
                <span className="num text-xs text-mute">{fmtDateTime(p.ts)} · MD {p.md == null ? t('not reported') : U.fdu(p.md)} · {p.formation ?? t('formation not reported')}</span></div>
              <p className="mt-1 text-xs"><span className="text-mute">NPT:</span> <b className="num">{fmt(p.nptHours, 1)} h</b> <span className="text-mute">— {p.nptBasis}</span></p>
              {p.actions.length > 0 && <p className="mt-1 text-xs"><span className="text-mute">{t('Corrective actions')}:</span> {p.actions.join(' · ')}</p>}
              <p className="mt-1 text-xs text-mute"><span className="text-ink/70">{t('Original text')}:</span> {p.sourceText}</p>
              <Src s={p.src} />
            </div>))}
        </div>
      )}

      {tab === 'geology' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('Well information')}</h4>
            <table className="w-full text-[13px]"><tbody>{Object.entries(ex.wellInfo).map(([k, v]) => (
              <tr key={k}><td className={cx(td, 'text-mute')}>{t(CONCEPT[k]?.label ?? k)}</td><td className={td}><Val ex={v} /></td><td className={td}><Conf v={v.confidence} /></td><td className={td}><Src s={v.src} /></td></tr>))}
              {!Object.keys(ex.wellInfo).length && <tr><td className="py-3 text-mute">{t('No well header information found.')}</td></tr>}</tbody></table>
            <p className="mt-2 text-xs text-mute">{ex.stations.length ? `${ex.stations.length} ${t('survey stations')}` : t('No directional survey found (schematic will be illustrative).')}</p>
          </div>
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('Formation intervals')}</h4>
            <table className="w-full text-[13px]"><thead><tr><th className={th}>{t('Formation')}</th><th className={th}>{t('Top')} MD ({U.dl})</th><th className={th}>{t('Bottom')} MD ({U.dl})</th><th className={th}>TVD ({U.dl})</th><th className={th}>{t('Source')}</th></tr></thead>
              <tbody>{ex.formations.map(f => <tr key={f.src}><td className={td}>{f.name}</td><td className={cx(td, 'num')}>{U.fd(f.top)}</td><td className={cx(td, 'num')}>{U.fd(f.bottom)}</td><td className={cx(td, 'num')}>{U.fd(f.tvd)}</td><td className={td}><Src s={f.src} /></td></tr>)}
                {!ex.formations.length && <tr><td colSpan={5} className="py-3 text-mute">{t('No formation table found; formations named in the operations text are still used.')}</td></tr>}</tbody></table>
          </div>
        </div>
      )}

      {tab === 'attention' && (
        <div className="space-y-4">
          {!attention && <Notice kind="ok">{t('Nothing needs your input. Everything that could be read was classified automatically.')}</Notice>}
          {ex.needsDate && (
            <div className="rounded-md border border-yellow-500/40 p-3">
              <b className="text-[13px]">{t('Report date not found')}</b>
              <p className="mt-1 text-xs text-mute">{t('The operations have clock times but the workbook gives no report date. Enter the date of the report.')}</p>
              <input type="date" className="mt-2 h-9 rounded-md border border-line bg-bg/70 px-2 text-sm" value={fallbackDate} onChange={e => setFallbackDate(e.target.value)} />
            </div>
          )}
          {ex.unresolved.length > 0 && (
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-2"><b className="text-[13px]">{t('Labels the dictionary does not know')}</b>
                {llmAvailable() ? <Button size="sm" disabled={act.busy} onClick={() => act.run(async () => { const r = await llmClassifyLabels(ex.unresolved); setAi(Object.fromEntries(r.filter(x => x.concept).map(x => [x.key, x.concept!]))); })}>{act.busy ? t('Asking…') : t('Suggest with AI')}</Button>
                  : <span className="text-xs text-mute">{t('AI assistance is not configured; rule-based reading only.')}</span>}</div>
              <p className="mb-2 text-xs text-mute">{t('Choose what each one means, or leave it. Your choices are remembered and applied automatically to future reports. Unassigned values are kept in the import record, not discarded.')}</p>
              {act.error && <Notice kind="error" className="mb-2">{act.error}</Notice>}
              <table className="w-full text-[13px]"><thead><tr><th className={th}>{t('Label in the report')}</th><th className={th}>{t('Sample values')}</th><th className={th}>{t('Source')}</th><th className={th}>{t('Meaning')}</th></tr></thead>
                <tbody>{ex.unresolved.map(u => {
                  const sugg = [...new Set([ai[u.key], ...u.suggestions].filter(Boolean))] as string[];
                  return (
                    <tr key={u.key}><td className={td}><b>{u.header}</b></td><td className={cx(td, 'num text-mute')}>{u.samples.join(', ') || '—'}</td><td className={td}><Src s={u.src} /></td>
                      <td className={td}><Select className="h-8 w-64" value={overrides[u.key] ?? ''} onChange={e => { const o = { ...overrides }; if (e.target.value) o[u.key] = e.target.value; else delete o[u.key]; setOverrides(o); }}>
                        <option value="">— {t('keep unassigned')} —</option><option value="ignore">{t('Ignore this label')}</option>
                        {sugg.length > 0 && <optgroup label={t('Suggested')}>{sugg.map(k => <option key={k} value={k}>{t(CONCEPT[k].label)}{ai[u.key] === k ? ' (AI)' : ''}</option>)}</optgroup>}
                        <optgroup label={t('All drilling parameters')}>{CONCEPTS.map(c => <option key={c.key} value={c.key}>{t(c.group)} · {t(c.label)}</option>)}</optgroup>
                      </Select></td></tr>);
                })}</tbody></table>
            </div>
          )}
          {ex.nptCandidates.length > 0 && (
            <div>
              <b className="text-[13px]">{t('Possible NPT that the report does not classify')}</b>
              <p className="mb-2 mt-1 text-xs text-mute">{t('These operations read like non-productive time (waiting, repairs, stuck pipe) but the report does not label them NPT. Tick the ones that should count as NPT.')}</p>
              {ex.nptCandidates.map(c => (
                <label key={c.id} className="flex items-start gap-2 border-b border-line/40 py-1.5 text-[13px]">
                  <input type="checkbox" className="mt-1" checked={acceptNpt.includes(c.id)} onChange={e => setAcceptNpt(e.target.checked ? [...acceptNpt, c.id] : acceptNpt.filter(x => x !== c.id))} />
                  <span className="flex-1"><span className="num">{fmtDateTime(c.start)} · {fmt(c.hours, 1)} h</span> — {c.text} <Src s={c.src} /></span>
                </label>))}
            </div>
          )}
        </div>
      )}

      {tab === 'rest' && (
        <div className="space-y-3">
          {!ex.issues.length && <Notice kind="ok">{t('No validation issues.')}</Notice>}
          <ul className="space-y-1.5">{ex.issues.map((i, k) => <li key={k} className="flex items-start gap-2 text-[13px]"><Badge color={SEV[i.severity]}>{t(i.severity)}</Badge><span className="flex-1">{i.message}{i.count > 1 && <span className="text-mute"> (×{i.count})</span>}</span></li>)}</ul>
          <div>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('Read but not classified')} ({ex.unclassified.length})</h4>
            <p className="mb-1 text-xs text-mute">{t('Content the reader could not attach to a drilling parameter. It is stored with the import record so nothing from the report is lost.')}</p>
            <ul className="max-h-64 space-y-0.5 overflow-auto text-xs">{ex.unclassified.slice(0, 300).map((u, k) => <li key={k}><Src s={u.src} /> <span className="text-mute">{u.text}</span></li>)}</ul>
          </div>
        </div>
      )}
    </div>
  );
}
