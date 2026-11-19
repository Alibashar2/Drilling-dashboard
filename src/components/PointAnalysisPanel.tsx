// Analysis panel of the Well Comparison page: what happened at the selected depth / time in every compared well, how the
// parameters changed around it, what the report records there, what other wells recorded nearby, and an interpretation in
// which every statement carries its evidence class.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Core } from '../lib/data';
import {
  allChanges, analysisWindow, contextAt, entries, explain, historicalAt, matchWell, PARAM, ALL_PARAMS, recordedEvents, shortSrc, SIG_PCT, STABLE_PCT, WINDOWS,
  type AxisMode, type Entry, type EvidenceClass, type Match, type ParamKey, type PointSel, type WellEquip, type WellSeries, type WindowKind,
} from '../lib/pointAnalysis';
import { usePrefs } from '../lib/context';
import { interpAtMd, type TrajPoint } from '../lib/survey';
import type { CorrectiveAction, Rec } from '../lib/types';
import { fmt, fmtDateTime } from '../lib/units';
import { OP_TYPE } from '../lib/operations';
import { inch } from './SimPanels';
import { Badge, Button, Card, cx, Empty, Notice, Select, Tabs } from './ui';

type Tab = 'summary' | 'wells' | 'changes' | 'events' | 'history' | 'interpret' | 'evidence';
const DIGITS: Record<ParamKey, number> = { rop: 1, wob: 1, rpm: 0, torque: 0, diff: 0, spp: 0, flow: 0, mw: 2, hook: 0 };
const CLS: Record<EvidenceClass, { label: string; color: string; text: string }> = {
  confirmed: { label: 'Confirmed', color: 'green', text: 'Explicitly documented in the drilling report' },
  data: { label: 'Data-supported', color: 'cyan', text: 'Supported by observed changes in the drilling records' },
  possible: { label: 'Possible explanation', color: 'yellow', text: 'An engineering interpretation that the report does not confirm' },
  insufficient: { label: 'Insufficient data', color: 'gray', text: 'The data cannot determine the cause' },
};
const entryCache = new WeakMap<Rec[], Entry[]>();
const entriesOf = (recs: Rec[]) => { let e = entryCache.get(recs); if (!e) { e = entries(recs); entryCache.set(recs, e); } return e; };

export function PointAnalysisPanel({ sel, series, axis, eqs, trajs, core, canon, actions, tol, onStep, onClear, loading }: {
  sel: PointSel | null; series: WellSeries[]; axis: AxisMode; eqs: Map<string, WellEquip>; trajs: Map<string, TrajPoint[]>; core: Core;
  canon: (n: string | null | undefined) => string | null; actions: Map<string, CorrectiveAction[]>; tol: (ws: WellSeries) => number;
  onStep: (dir: -1 | 1) => void; onClear: () => void; loading: boolean;
}) {
  const { t, U } = usePrefs();
  const [focus, setFocus] = useState<string | null>(null);
  const [win, setWin] = useState<WindowKind>('rec1');
  const [prox, setProx] = useState(500);
  const [tab, setTab] = useState<Tab>('summary');
  const [explainP, setExplainP] = useState<ParamKey | null>(null);
  // a new click focuses the well that was clicked; switching wells afterwards keeps the selected depth / time
  useEffect(() => { if (sel) { setFocus(sel.wellId); setExplainP(null); } }, [sel?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const fv = (p: ParamKey, v: number | null) => (v == null ? '—' : `${fmt(p === 'rop' ? U.r(v) : v, DIGITS[p])} ${p === 'rop' ? U.rl : PARAM[p].unit}`);
  const catName = (id: string) => core.cat.get(id)?.name ?? 'Other Problems';
  const keyTxt = (k: number) => (axis === 'depth' ? `${U.fd(k)} ${U.dl} MD` : `${t('day')} ${fmt(k / 24, 2)}`);
  const diffTxt = (m: Match) => {
    if (m.diff == null) return '';
    if (axis === 'depth') return `${m.diff > 0 ? '+' : m.diff < 0 ? '−' : ''}${U.fd(Math.abs(m.diff), Math.abs(m.diff) < 10 ? 1 : 0)} ${U.dl}`;
    const h = Math.abs(m.diff);
    return `${m.diff > 0 ? '+' : '−'}${h < 1 ? `${Math.round(h * 60)} min` : `${fmt(h, 1)} h`}`;
  };

  const matches = useMemo(() => (sel ? series.map(ws => ({ ws, m: matchWell(ws, sel.key, tol(ws)) })) : []), [sel, series, tol]);
  const ctxs = useMemo(() => new Map(matches.map(({ ws, m }) => [ws.wellId, m.rec ? contextAt(m.rec, eqs.get(ws.wellId) ?? null) : null])), [matches, eqs]);
  const focused = matches.find(x => x.ws.wellId === focus) ?? matches[0];
  const tvdOf = (wellId: string, r: Rec) => {
    if (r.tvd_ft != null) return { v: r.tvd_ft, basis: 'recorded' as const };
    const tr = trajs.get(wellId);
    return tr && tr.length > 1 ? { v: interpAtMd(tr, r.hole)!.tvd, basis: 'survey' as const } : null;
  };
  const fx = useMemo(() => {
    if (!sel || !focused?.m.rec) return null;
    const { ws, m } = focused, rec = m.rec!, eq = eqs.get(ws.wellId) ?? null;
    const w = analysisWindow(entriesOf(ws.recs), rec, win);
    const ch = w ? allChanges(w) : null;
    const evs = w ? recordedEvents(w, { recs: ws.recs, eq, problems: core.problems.filter(p => p.well_id === ws.wellId), actions, catName, proximityFt: prox }) : [];
    const hist = historicalAt(core.problems, ws.wellId, rec.hole, rec.formation_name, canon, prox, core.well, catName, actions);
    const ex = ch ? explain(explainP ?? sel.origin, ch, evs, fv) : null;
    return { ws, m, rec, w, ch, evs, hist, ex };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, focused, eqs, win, prox, explainP, core, actions, canon, U]);

  if (!sel) return (
    <Card title={t('Point analysis')}>
      <Empty title={t('Select a point on any chart')} text={t('Click a point to see, for every compared well, the record at that depth or time, the operation, BHA and formation, how the parameters changed around it, the events recorded there and an evidence-based interpretation.')} />
    </Card>
  );
  const P = PARAM[sel.origin];
  const ctx = focused ? ctxs.get(focused.ws.wellId) ?? null : null;

  return (
    <Card title={t('Point analysis')} right={<div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" aria-label={t('Previous record')} title={t('Previous record')} onClick={() => onStep(-1)}><ChevronLeft size={14} /></Button>
      <Button size="sm" variant="ghost" aria-label={t('Next record')} title={t('Next record')} onClick={() => onStep(1)}><ChevronRight size={14} /></Button>
      <Button size="sm" variant="ghost" aria-label={t('Clear selection')} title={t('Clear selection')} onClick={onClear}><X size={14} /></Button>
    </div>}>
      <div className="mb-2 text-[13px]">
        <span className="text-mute">{t('Selected')}: </span><b>{t(P.label)}</b> <span className="text-mute">@</span> <b className="num">{keyTxt(sel.key)}</b>
        <span className="text-mute"> · {t('clicked in')} {series.find(s => s.wellId === sel.wellId)?.name}</span>
      </div>
      {/* well switcher: keeps the selected depth / time */}
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label={t('Well')}>
        {matches.map(({ ws, m }) => (
          <button key={ws.wellId} role="tab" aria-selected={focused?.ws.wellId === ws.wellId} onClick={() => setFocus(ws.wellId)}
            className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', focused?.ws.wellId === ws.wellId ? 'border-slate-400/70 bg-white/10 text-ink' : 'border-line text-mute hover:text-ink')}>
            <span className="h-2 w-2 rounded-sm" style={{ background: ws.color }} />{ws.name}
            {m.status === 'far' || m.status === 'none' ? <span className="text-yellow-300">!</span> : null}
          </button>
        ))}
      </div>
      {loading && <Notice className="mb-2">{t('Loading operations, BHA and survey data…')}</Notice>}
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'summary', label: t('Summary') }, { id: 'wells', label: t('Compare wells') }, { id: 'changes', label: t('Before / after') },
        { id: 'events', label: t('Recorded events') }, { id: 'history', label: `${t('Historical')}${fx?.hist.length ? ` (${fx.hist.length})` : ''}` },
        { id: 'interpret', label: t('Interpretation') }, { id: 'evidence', label: t('Sources') },
      ]} />
      <div className="pt-3 text-[13px]">
        {focused && <MatchNote m={focused.m} name={focused.ws.name} diff={diffTxt(focused.m)} keyTxt={keyTxt} axis={axis} />}

        {tab === 'summary' && focused?.m.rec && (() => {
          const r = focused.m.rec, tv = tvdOf(focused.ws.wellId, r), run = ctx?.run;
          return <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <Dt>{t('Selected parameter')}</Dt><Dd>{t(P.label)}: <b>{fv(sel.origin, r[P.field] as number | null)}</b></Dd>
              <Dt>{t('Measured depth (MD)')}</Dt><Dd>{U.fdu(r.hole)}</Dd>
              <Dt>TVD</Dt><Dd>{tv ? <>{U.fdu(tv.v)}{tv.basis === 'survey' && <span className="text-mute"> ({t('from survey')})</span>}</> : t('Not available')}</Dd>
              <Dt>{t('Date and time')}</Dt><Dd>{fmtDateTime(r.t)}</Dd>
              <Dt>{t('Formation')}</Dt><Dd>{r.formation_name ?? t('Not recorded')}</Dd>
              <Dt>{t('Operation')}</Dt><Dd>{ctx ? <>{t(ctx.opName)}{ctx.opCategory && <span className="text-mute"> · {t(ctx.opCategory)}</span>}{ctx.opSource === 'activity code' && <span className="text-mute"> ({t('activity code; no operations log')})</span>}</> : '—'}</Dd>
              <Dt>{t('Hole section')}</Dt><Dd>{ctx?.holeSize != null ? `${inch(ctx.holeSize)} ${t('hole')}${ctx.section ? ` · ${t('section')} ${ctx.section.section_no}` : ''}` : t('Not recorded')}</Dd>
              <Dt>{t('BHA number')}</Dt><Dd>{ctx?.bhaNumber ?? t('Not recorded')}</Dd>
              <Dt>{t('Drilling run')}</Dt><Dd>{run ? `${t('Run')} ${run.run_no}: ${U.fd(run.depth_in_ft)}–${U.fd(run.depth_out_ft)} ${U.dl}, ${fmtDateTime(run.start_at)} → ${run.end_at ? fmtDateTime(run.end_at) : '…'}` : t('Not recorded')}</Dd>
              <Dt>{t('Bit type')}</Dt><Dd>{run?.bit_type ? [run.bit_type, run.bit_model].filter(Boolean).join(' · ') : t('Not available')}</Dd>
              <Dt>{t('Bit diameter')}</Dt><Dd>{inch(run?.bit_size_in) ?? t('Not available')}</Dd>
              <Dt>{t('Relevant tools')}</Dt><Dd>{ctx?.tools.length ? <ToolList tools={ctx.tools} /> : t('No tool list recorded for this run')}</Dd>
            </dl>
            {fx?.ex && <div className="mt-3 rounded-md border border-line bg-panel2/60 p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mute">{t('Engineering interpretation')} · {t(PARAM[fx.ex.param].label)}</div>
              <p className="leading-relaxed">{fx.ex.summary}</p>
              <button className="mt-1 text-xs text-cyan-300 hover:underline" onClick={() => setTab('interpret')}>{t('Evidence for each statement')} →</button>
            </div>}
          </>;
        })()}

        {tab === 'wells' && <WellsTable matches={matches} ctxs={ctxs} fv={fv} diffTxt={diffTxt} tvdOf={tvdOf} onFocus={w => { setFocus(w); }} focus={focused?.ws.wellId ?? null} origin={sel.origin} />}

        {tab === 'changes' && <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-mute" htmlFor="pa-win">{t('Analysis window')}</label>
            <Select id="pa-win" className="h-8 w-auto text-xs" value={win} onChange={e => setWin(e.target.value as WindowKind)}>{WINDOWS.map(w => <option key={w.id} value={w.id}>{t(w.label)}</option>)}</Select>
          </div>
          {!fx?.w ? <Notice kind="warn">{t('The selected record is not a drilling record; no before / after analysis.')}</Notice> : <>
            <WindowNote w={fx.w} win={win} U={U} t={t} />
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="border-b border-line text-[10px] uppercase tracking-wide text-mute">
                  {[t('Parameter'), t('Previous record'), t('Previous (window)'), t('Current'), t('Next (window)'), t('Change'), '%', t('Min'), t('Max')].map((h, i) => <th key={i} className={cx('px-2 py-1.5 font-medium whitespace-nowrap', i ? 'text-end' : 'text-start')}>{h}</th>)}
                </tr></thead>
                <tbody>{ALL_PARAMS.map(p => {
                  const c = fx.ch![p];
                  if (c.cur == null && c.prev == null && c.next == null) return null;
                  const sig = c.pct != null && Math.abs(c.pct) >= SIG_PCT;
                  return <tr key={p} className={cx('border-b border-line/50', p === (explainP ?? sel.origin) && 'bg-cyan-500/5')}>
                    <td className="px-2 py-1 font-medium">{t(PARAM[p].label)}</td>
                    <td className="num px-2 py-1 text-end">{fv(p, c.prevRec)}</td>
                    <td className="num px-2 py-1 text-end">{fv(p, c.prev)}</td>
                    <td className="num px-2 py-1 text-end font-semibold">{fv(p, c.cur)}</td>
                    <td className="num px-2 py-1 text-end">{fv(p, c.next)}</td>
                    <td className="num px-2 py-1 text-end">{c.abs == null ? '—' : `${c.abs > 0 ? '+' : ''}${fv(p, c.abs)}`}</td>
                    <td className={cx('num px-2 py-1 text-end', sig && (c.pct! > 0 ? 'text-emerald-300' : 'text-rose-300'))}>{c.pct == null ? '—' : `${c.pct > 0 ? '+' : ''}${fmt(c.pct, 1)}%`}</td>
                    <td className="num px-2 py-1 text-end">{fv(p, c.min)}</td>
                    <td className="num px-2 py-1 text-end">{fv(p, c.max)}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-mute">{t('Previous / next = mean of the drilling entries in the window; current = the selected entry. Change and % compare current with previous. Changes below')} ±{SIG_PCT}% {t('are not treated as a change.')}</p>
          </>}
        </>}

        {tab === 'events' && fx && <>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('Actual events recorded in')} {fx.ws.name}</h4>
          <ProxSelect prox={prox} setProx={setProx} U={U} t={t} />
          {([[true, 'In the analysis window', 'No operation change, BHA / bit change, formation change, NPT or problem is recorded in this window.'], [false, 'Problems recorded near this depth at another time', null]] as const).map(([inWin, title, none]) => {
            const list = fx.evs.filter(e => e.inWindow === inWin);
            if (!list.length && !none) return null;
            return <div key={title} className="mb-3">
              <div className="mb-1 text-[11px] font-semibold text-mute">{t(title)}{!inWin && <span className="font-normal"> · {t('context only; not used to explain the change')}</span>}</div>
              {!list.length ? <p className="text-mute">{t(none!)}</p> : <ul className="space-y-2">{list.map((e, i) => (
                <li key={i} className={cx('rounded-md border px-3 py-2', e.kind === 'problem' || e.kind === 'npt' ? 'border-rose-500/40 bg-rose-500/5' : 'border-line bg-panel2/40')}>
                  <div className="flex flex-wrap items-center gap-2"><Badge color="green">{t('Recorded in report')}</Badge><span className="font-medium">{e.text}</span></div>
                  <div className="mt-0.5 text-[11px] text-mute">{e.t != null && fmtDateTime(e.t)}{e.md != null && ` · ${U.fdu(e.md)}`}{e.src && <span title={e.src}> · {t('Source')}: {shortSrc(e.src)}</span>}</div>
                  {e.problem && <p className="mt-1">{e.problem.description}</p>}
                  {e.quote && <p className="mt-1 text-[12px] italic text-mute">“{e.quote}”</p>}
                  {!!e.actions?.length && <div className="mt-1 text-[12px]"><span className="text-mute">{t('Corrective actions')}: </span>{e.actions.map(a => a.action_text).join('; ')}</div>}
                </li>
              ))}</ul>}
            </div>;
          })}
        </>}

        {tab === 'history' && fx && <>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-300">{t('Historical events from other wells')}</h4>
          <ProxSelect prox={prox} setProx={setProx} U={U} t={t} />
          {!fx.hist.length ? <p className="text-mute">{t('No problem of another well is recorded within this distance or in the same formation.')}</p> : (
            <ul className="space-y-2">{fx.hist.map(h => (
              <li key={h.problem.id} className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color="orange">{t('Other well')}</Badge><b>{h.well?.name ?? '—'}</b><span>· {t(h.category)}</span>
                  {h.sameFormation && <Badge color="yellow">{t('same formation')}</Badge>}
                </div>
                <div className="mt-0.5 text-[11px] text-mute">
                  {U.fd(h.problem.md_top_ft)}{h.problem.md_bottom_ft != null && h.problem.md_bottom_ft !== h.problem.md_top_ft ? `–${U.fd(h.problem.md_bottom_ft)}` : ''} {U.dl} MD
                  {' · '}{h.depthDiff === 0 ? t('at the selected depth') : `${h.depthDiff > 0 ? t('deeper by') : t('shallower by')} ${U.fdu(Math.abs(h.depthDiff))}`}
                  {h.problem.formation_name && ` · ${h.problem.formation_name}`}{h.problem.npt_hours ? ` · NPT ${h.problem.npt_hours} h` : ''} · {t(h.problem.status)}
                  {h.problem.occurred_at && ` · ${fmtDateTime(h.problem.occurred_at)}`}{h.problem.source_ref && <span title={h.problem.source_ref}> · {t('Source')}: {shortSrc(h.problem.source_ref)}</span>}
                </div>
                <p className="mt-1">{h.problem.description}</p>
                <div className="mt-1 text-[12px]"><span className="text-mute">{t('Corrective actions')}: </span>{h.actions.length ? h.actions.map(a => a.action_text + (a.outcome ? ` (${a.outcome})` : '')).join('; ') : t('none recorded')}</div>
              </li>
            ))}</ul>
          )}
          <p className="mt-2 text-[11px] text-mute">{t('These are problems of other wells, shown for reference. They did not happen in')} {fx.ws.name}.</p>
        </>}

        {tab === 'interpret' && fx && <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-mute" htmlFor="pa-par">{t('Explain the change in')}</label>
            <Select id="pa-par" className="h-8 w-auto text-xs" value={explainP ?? sel.origin} onChange={e => setExplainP(e.target.value as ParamKey)}>
              {ALL_PARAMS.map(p => <option key={p} value={p}>{t(PARAM[p].label)}</option>)}
            </Select>
            <span className="text-[11px] text-mute">{t(WINDOWS.find(w => w.id === win)!.label)}</span>
          </div>
          {!fx.ex ? <Notice kind="warn">{t('Insufficient data to determine the cause of this change.')}</Notice> : <>
            <p className="mb-3 rounded-md border border-line bg-panel2/60 p-3 leading-relaxed">{fx.ex.summary}</p>
            {(['confirmed', 'data', 'possible', 'insufficient'] as EvidenceClass[]).map(cls => {
              const fs = fx.ex!.findings.filter(f => f.cls === cls);
              if (!fs.length) return null;
              return <div key={cls} className="mb-3">
                <div className="mb-1 flex items-center gap-2"><Badge color={CLS[cls].color}>{t(CLS[cls].label)}</Badge><span className="text-[11px] text-mute">{t(CLS[cls].text)}</span></div>
                <ul className="space-y-1.5 ps-1">{fs.map((f, i) => <li key={i}>
                  <div>{f.text}</div>
                  {!!f.evidence.length && <div className="text-[11px] text-mute">{t('Evidence')}: {f.evidence.join(' · ')}</div>}
                </li>)}</ul>
              </div>;
            })}
            <p className="text-[11px] text-mute">{t('Correlation is not causation: data-supported statements show what changed at the same time. Changes below')} ±{SIG_PCT}% {t('are treated as no change and below')} ±{STABLE_PCT}% {t('as stable.')}</p>
          </>}
        </>}

        {tab === 'evidence' && fx && <>
          <p className="mb-2 text-mute">{t('Every value above comes from these stored drilling records (drilling_records), the operations log, BHA runs and the problem register of the database.')}</p>
          {fx.w ? <div className="overflow-x-auto"><table className="w-full text-[12px]">
            <thead><tr className="border-b border-line text-[10px] uppercase tracking-wide text-mute">{[t('Role'), t('Time'), `MD (${U.dl})`, t(PARAM[explainP ?? sel.origin].label), t('Source cell'), t('Data quality')].map((h, i) => <th key={i} className="px-2 py-1.5 text-start font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>{[...fx.w.before.map(e => ['before', e] as const), ['selected', fx.w.sel] as const, ...fx.w.after.map(e => ['after', e] as const)].map(([role, e]) => (
              <tr key={e.idx} className={cx('border-b border-line/50', role === 'selected' && 'bg-cyan-500/5 font-medium')}>
                <td className="px-2 py-1">{t(role === 'before' ? 'Previous' : role === 'after' ? 'Next' : 'Selected')}</td>
                <td className="num px-2 py-1 whitespace-nowrap">{fmtDateTime(e.t0)} → {fmtDateTime(e.t1).slice(11)}</td>
                <td className="num px-2 py-1 whitespace-nowrap">{U.fd(e.md0)}–{U.fd(e.md1)}</td>
                <td className="num px-2 py-1">{fv(explainP ?? sel.origin, entryVal(e, explainP ?? sel.origin))}</td>
                <td className="px-2 py-1" title={e.src ?? ''}>{shortSrc(e.src, 2) ?? '—'}</td>
                <td className="px-2 py-1">{e.interpolated ? <Badge color="yellow">{t('depth spread across report entry')}</Badge> : <Badge color="green">{t('reported')}</Badge>}</td>
              </tr>
            ))}</tbody>
          </table></div> : <p className="text-mute">{t('No drilling entry around the selected record.')}</p>}
          <p className="mt-2 text-[11px] text-mute">{t('A report line that covers several hours is stored as several records with the same values; its depth is spread across the reported interval. Such points are drawn hollow in the charts. Nothing is interpolated for the comparison: a well without a record at the selected key shows its nearest record and the difference.')}</p>
        </>}
      </div>
    </Card>
  );
}

const entryVal = (e: Entry, p: ParamKey) => { const v = e.recs.map(r => r[PARAM[p].field] as number | null).filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const Dt = ({ children }: { children: ReactNode }) => <dt className="text-mute">{children}</dt>;
const Dd = ({ children }: { children: ReactNode }) => <dd className="min-w-0 break-words">{children}</dd>;

function MatchNote({ m, name, diff, keyTxt, axis }: { m: Match; name: string; diff: string; keyTxt: (k: number) => string; axis: AxisMode }) {
  const { t } = usePrefs();
  if (m.status === 'none') return <Notice kind="warn" className="mb-2">{name}: {t('no drilling record with parameters.')}</Notice>;
  if (m.status === 'exact') return null;
  if (m.status === 'nearest') return <p className="mb-2 text-[12px] text-mute">{name}: {t('no record exactly at this point; nearest actual record')} {keyTxt(m.key!)} ({diff}).</p>;
  return <Notice kind="warn" className="mb-2">{name}: {m.outside ? t(axis === 'depth' ? 'this well has no drilling record at this depth' : 'this well has no drilling record at this time') : t('no record within the matching tolerance')}. {t('Shown: nearest actual record')} {keyTxt(m.key!)} ({diff}). {t('Values are not interpolated.')}</Notice>;
}

function WindowNote({ w, win, U, t }: { w: NonNullable<ReturnType<typeof analysisWindow>>; win: WindowKind; U: ReturnType<typeof usePrefs>['U']; t: (s: string) => string }) {
  const minutes = WINDOWS.find(x => x.id === win)!.minutes;
  return <div className="mb-2 space-y-1 text-[12px] text-mute">
    <p>{t('Analysed')}: <span className="num text-ink">{fmtDateTime(w.t0)} → {fmtDateTime(w.t1)}</span>, <span className="num text-ink">{U.fd(w.md0)}–{U.fd(w.md1)} {U.dl}</span> · {w.before.length} {t('previous')} / {w.after.length} {t('next drilling entries')}
      {w.entryGapH != null && <> · {t('median spacing of drilling entries')} <span className="num text-ink">{w.entryGapH < 1 ? `${Math.round(w.entryGapH * 60)} min` : `${fmt(w.entryGapH, 1)} h`}</span></>}</p>
    {minutes != null && w.entryGapH != null && w.entryGapH * 60 > minutes && <p className="text-yellow-200">{t('This well is sampled more coarsely than the window; the window may contain no other drilling entry. Use a record-based window instead.')}</p>}
  </div>;
}

function ProxSelect({ prox, setProx, U, t }: { prox: number; setProx: (n: number) => void; U: ReturnType<typeof usePrefs>['U']; t: (s: string) => string }) {
  return <div className="mb-2 flex items-center gap-2 text-xs">
    <label className="text-mute" htmlFor="pa-prox">{t('Depth proximity')}</label>
    <Select id="pa-prox" className="h-7 w-auto text-xs" value={prox} onChange={e => setProx(Number(e.target.value))}>
      {[100, 250, 500, 1000, 2000].map(v => <option key={v} value={v}>± {U.fdu(v)}</option>)}
    </Select>
  </div>;
}

function ToolList({ tools }: { tools: { id: string; name: string; od_in: number | null; serial_no: string | null; tool_type: string }[] }) {
  const { t } = usePrefs();
  const [all, setAll] = useState(false);
  const shown = all ? tools : tools.slice(0, 6);
  return <span>
    {shown.map(x => <span key={x.id} className="me-1 mb-1 inline-block rounded border border-line px-1.5 py-0.5 text-[11px]">{x.name}{x.od_in != null ? ` · ${inch(x.od_in)}` : ''}{x.serial_no ? ` · S/N ${x.serial_no}` : ''}</span>)}
    {tools.length > 6 && <button className="text-[11px] text-cyan-300 hover:underline" onClick={() => setAll(!all)}>{all ? t('show less') : `+${tools.length - 6} ${t('more')}`}</button>}
  </span>;
}

function WellsTable({ matches, ctxs, fv, diffTxt, tvdOf, onFocus, focus, origin }: {
  matches: { ws: WellSeries; m: Match }[]; ctxs: Map<string, ReturnType<typeof contextAt> | null>; fv: (p: ParamKey, v: number | null) => string; diffTxt: (m: Match) => string;
  tvdOf: (wellId: string, r: Rec) => { v: number; basis: 'recorded' | 'survey' } | null; onFocus: (w: string) => void; focus: string | null; origin: ParamKey;
}) {
  const { t, U } = usePrefs();
  const cell = (fn: (r: Rec, wellId: string) => ReactNode) => matches.map(({ ws, m }) => <td key={ws.wellId} className={cx('px-2 py-1 align-top', m.status === 'far' && 'opacity-60')}>{m.rec ? fn(m.rec, ws.wellId) : '—'}</td>);
  const nr = <span className="text-mute">{t('Not recorded')}</span>;
  const rows: [string, ReactNode[]][] = [
    [t('Record used'), matches.map(({ ws, m }) => <td key={ws.wellId} className="px-2 py-1 align-top">{m.rec ? <><span className="num">{U.fdu(m.rec.hole)}</span> {m.status === 'exact' ? <Badge color="green">{t('exact')}</Badge> : m.status === 'nearest' ? <Badge color="cyan">{t('nearest')} {diffTxt(m)}</Badge> : <Badge color="yellow">{t('far')} {diffTxt(m)}</Badge>}</> : t('No drilling record')}</td>)],
    [t('Date and time'), cell(r => <span className="num">{fmtDateTime(r.t)}</span>)],
    ['TVD', cell((r, w) => { const v = tvdOf(w, r); return v ? <>{U.fdu(v.v)}{v.basis === 'survey' && <span className="text-mute"> *</span>}</> : nr; })],
    [t('Formation'), cell(r => r.formation_name ?? nr)],
    [t('Operation'), cell((_, w) => { const c = ctxs.get(w); return c ? (c.op ? t(OP_TYPE[c.op.type_code]?.name ?? c.opName) : <>{t(c.opName)} <span className="text-mute">({t('activity code')})</span></>) : '—'; })],
    [t('Hole section'), cell((_, w) => { const c = ctxs.get(w); return c?.holeSize != null ? inch(c.holeSize) : nr; })],
    [t('BHA run'), cell((_, w) => ctxs.get(w)?.bhaNumber ?? nr)],
    [t('Bit'), cell((_, w) => { const run = ctxs.get(w)?.run; return run && (run.bit_type || run.bit_size_in) ? [inch(run.bit_size_in), run.bit_type].filter(Boolean).join(' ') : nr; })],
    ...ALL_PARAMS.filter(p => matches.some(({ m }) => m.rec && m.rec[PARAM[p].field] != null)).map(p => [t(PARAM[p].label), cell(r => { const v = r[PARAM[p].field] as number | null; return v == null ? nr : <span className={cx('num', p === origin && 'font-semibold')}>{fv(p, v)}</span>; })] as [string, ReactNode[]]),
    [t('Data quality'), cell(r => (r.data_quality === 'interpolated' ? <Badge color="yellow">{t('depth spread across report entry')}</Badge> : <Badge color="green">{t('reported')}</Badge>))],
    [t('Source cell'), cell(r => <span title={r.source_ref ?? ''}>{shortSrc(r.source_ref ?? null, 2) ?? '—'}</span>)],
  ];
  return <div className="overflow-x-auto">
    <table className="w-full text-[12px]">
      <thead><tr className="border-b border-line text-[11px] text-mute">
        <th className="px-2 py-1.5 text-start font-medium">{t('Information')}</th>
        {matches.map(({ ws }) => <th key={ws.wellId} className="px-2 py-1.5 text-start font-medium whitespace-nowrap">
          <button className={cx('inline-flex items-center gap-1.5 hover:text-ink', focus === ws.wellId && 'text-ink')} onClick={() => onFocus(ws.wellId)}><span className="h-2 w-2 rounded-sm" style={{ background: ws.color }} />{ws.name}</button>
        </th>)}
      </tr></thead>
      <tbody>{rows.map(([label, cells]) => <tr key={label} className="border-b border-line/50"><th scope="row" className="px-2 py-1 text-start font-medium text-mute whitespace-nowrap">{label}</th>{cells}</tr>)}</tbody>
    </table>
    <p className="mt-2 text-[11px] text-mute">{t('Each column is the actual stored record of that well nearest to the selected point; nothing is interpolated. * TVD calculated from the survey.')}</p>
  </div>;
}
