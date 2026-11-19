// Simulation panels: operations timeline, current operation, current-well problem alerts (red), hole section,
// tools & BHA, casing & cementing. Values not given by the report are shown as "Not available".
import { useMemo, useState } from 'react';
import { AlertOctagon, Pencil } from 'lucide-react';
import { usePrefs } from '../lib/context';
import { CATEGORY_COLOR, OP_CATEGORIES, OP_TYPE, OP_TYPES, type OpCategory } from '../lib/operations';
import type { CurrentAlert, Equip, ToolView } from '../lib/simContext';
import type { AlertComment, BhaRun, CorrectiveAction, DrillingTool, HoleSection, Operation, SimEvent } from '../lib/types';
import { fmt, fmtDateTime, type Units } from '../lib/units';
import { Badge, Button, cx, Select } from './ui';

/** 12.25 -> 12-1/4", 22.875 -> 22-7/8", 4.0625 -> 4-1/16" (exact fractions only; otherwise the decimal) */
export function inch(v: number | null | undefined): string | null {
  if (v == null) return null;
  const w = Math.floor(v + 1e-9), f = v - w;
  if (f < 0.003) return `${w}"`;
  for (const d of [2, 4, 8, 16, 32]) { const n = Math.round(f * d); if (Math.abs(f - n / d) < 0.004) { const g = (a: number, b: number): number => (b ? g(b, a % b) : a); const k = g(n, d); return `${w ? w + '-' : ''}${n / k}/${d / k}"`; } }
  return `${fmt(v, 3)}"`;
}
const NA = ({ t }: { t: (s: string) => string }) => <span className="text-mute italic">{t('Not available')}</span>;

// ------------------------------------------------------------------ operations timeline
export function OperationsTimeline({ ops, t0, t1, cursor, onPick }: { ops: Operation[]; t0: number; t1: number; cursor: number; onPick: (op: Operation) => void }) {
  const { t } = usePrefs();
  const win = useMemo(() => ops.filter(o => Date.parse(o.end_at) > t0 && Date.parse(o.start_at) < t1), [ops, t0, t1]);
  const cats = OP_CATEGORIES.filter(c => win.some(o => o.category === c));
  const pct = (v: number) => `${Math.max(0, Math.min(100, ((v - t0) / (t1 - t0)) * 100))}%`;
  if (!ops.length) return <p className="text-xs text-mute">{t('No operations were stored for this well (imported before operations were read, or by column mapping).')}</p>;
  return (
    <div dir="ltr" className="space-y-1">
      {cats.map(c => (
        <div key={c} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-end text-[10px] uppercase tracking-wide text-mute" dir="auto">{t(c)}</span>
          <div className="relative h-4 flex-1 rounded-sm bg-bg/60">
            {win.filter(o => o.category === c).map(o => {
              const a = Date.parse(o.start_at), b = Date.parse(o.end_at);
              return <button key={o.id} title={`${t(OP_TYPE[o.type_code]?.name ?? o.type_code)} · ${fmtDateTime(a)} – ${fmtDateTime(b)} · ${fmt(o.duration_h, 2)} h${o.is_npt ? ' · NPT' : ''}`}
                onClick={() => onPick(o)} className={cx('absolute top-0 h-4 rounded-[2px] border-s border-black/30 hover:brightness-125', o.is_npt && 'ring-1 ring-rose-400')}
                style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})`, minWidth: 2, background: o.is_npt ? '#e11d48' : CATEGORY_COLOR[c as OpCategory] }} />;
            })}
            <div className="pointer-events-none absolute -top-1 bottom-[-4px] w-px bg-white/80" style={{ left: pct(cursor) }} />
          </div>
        </div>))}
      <div className="flex justify-between ps-30 text-[10px] text-mute num"><span>{fmtDateTime(t0)}</span><span>{fmtDateTime(t1)}</span></div>
    </div>
  );
}

export function CurrentOperation({ op, run, U, canWrite, onCorrect }: { op: Operation | null; run: BhaRun | null; U: Units; canWrite: boolean; onCorrect: (op: Operation) => void }) {
  const { t } = usePrefs();
  if (!op) return <p className="text-xs text-mute">{t('The report records no operation at this time.')}</p>;
  const ty = OP_TYPE[op.type_code];
  const dl = (a: number | null, b: number | null) => (a == null && b == null ? null : a === b || b == null ? U.fdu(a) : `${U.fd(a)} – ${U.fdu(b)}`);
  return (
    <div className="rounded-md border border-line bg-bg/40 p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLOR[op.category as OpCategory] }} />
        <b className="text-[13px]">{t(ty?.name ?? op.type_code)}</b>
        <Badge>{t(op.category)}</Badge>
        {op.is_npt && <Badge color="red">NPT{op.npt_category ? ` · ${op.npt_category}` : ''}</Badge>}
        <Badge color={op.basis === 'engineer' ? 'green' : op.basis === 'insufficient information' ? 'yellow' : 'gray'}>{op.basis === 'engineer' ? t('corrected by engineer') : op.basis === 'insufficient information' ? t('not specified in report') : `${t('from')} ${t(op.basis)} · ${Math.round(op.confidence * 100)}%`}</Badge>
        <Badge color="gray">{t(op.status === 'in_progress' ? 'In progress' : op.status === 'planned' ? 'Planned' : 'Completed')}</Badge>
        <span className="flex-1" />
        {canWrite && <Button size="sm" variant="ghost" onClick={() => onCorrect(op)}><Pencil size={12} />{t('Correct operation')}</Button>}
      </div>
      <dl className="num mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
        <div><dt className="text-[10px] text-mute">{t('Start')}</dt><dd>{fmtDateTime(op.start_at)}</dd></div>
        <div><dt className="text-[10px] text-mute">{t('End')}</dt><dd>{fmtDateTime(op.end_at)}</dd></div>
        <div><dt className="text-[10px] text-mute">{t('Duration')}</dt><dd>{fmt(op.duration_h, 2)} h</dd></div>
        <div><dt className="text-[10px] text-mute">{t('Depth')} (MD)</dt><dd>{dl(op.start_md_ft, op.end_md_ft) ?? <NA t={t} />}</dd></div>
        <div><dt className="text-[10px] text-mute">BHA</dt><dd>{run ? `${t('Run')} ${run.run_no}${run.bha_type ? ` · ${run.bha_type}` : ''}` : <NA t={t} />}</dd></div>
        <div><dt className="text-[10px] text-mute">{t('Hole Size')}</dt><dd>{inch(op.hole_size_in) ?? <NA t={t} />}</dd></div>
        <div className="col-span-2"><dt className="text-[10px] text-mute">{t('Report task')}</dt><dd className="truncate">{[op.phase_raw, op.task_raw].filter(Boolean).join(' / ') || '—'}</dd></div>
      </dl>
      {op.steps.length > 0 && <p className="mt-1 text-[11px]"><span className="text-mute">{t('Steps stated in the report (no separate times)')}:</span> {op.steps.map(s => t(s)).join(' → ')}</p>}
      <p className="mt-1 line-clamp-3 text-[11px] text-mute" title={op.text ?? ''}>{op.description}</p>
      <p className="num mt-0.5 text-[10px] text-mute" dir="ltr">{op.source_ref}{op.original_type_code && ` · ${t('originally read as')} ${OP_TYPE[op.original_type_code]?.name ?? op.original_type_code}`}</p>
    </div>
  );
}

export function CorrectOperation({ op, onSave, onCancel, busy }: { op: Operation; onSave: (code: string) => void; onCancel: () => void; busy: boolean }) {
  const { t } = usePrefs();
  const [code, setCode] = useState(op.type_code);
  return (
    <div className="space-y-3 text-[13px]">
      <p className="text-mute">{op.description}</p>
      <p className="num text-xs text-mute" dir="ltr">{op.source_ref} · {[op.phase_raw, op.task_raw].filter(Boolean).join(' / ')}</p>
      <Select value={code} onChange={e => setCode(e.target.value)}>
        {OP_CATEGORIES.map(c => <optgroup key={c} label={t(c)}>{OP_TYPES.filter(x => x.category === c).map(x => <option key={x.code} value={x.code}>{t(x.name)}</option>)}</optgroup>)}
      </Select>
      <p className="text-xs text-mute">{t('The reader\'s original classification is kept with the operation.')}</p>
      <div className="flex justify-end gap-2"><Button onClick={onCancel}>{t('Cancel')}</Button><Button variant="primary" disabled={busy || code === op.type_code} onClick={() => onSave(code)}>{t('Save')}</Button></div>
    </div>
  );
}

// ------------------------------------------------------------------ current-well problems (RED)
export function CurrentProblems({ alerts, events, wellName, catName, actions, U, canWrite, onOpen, onEvent, tvdAt }: {
  alerts: CurrentAlert[]; events: Record<string, SimEvent>; wellName: string; catName: (id: string) => string; actions: CorrectiveAction[]; U: Units; canWrite: boolean;
  tvdAt?: (md: number) => number | null;
  onOpen: (a: CurrentAlert) => void; onEvent: (problemId: string, patch: Partial<SimEvent>) => void;
}) {
  const { t } = usePrefs();
  const [comment, setComment] = useState<Record<string, string>>({});
  const active = alerts.filter(a => a.active), earlier = alerts.filter(a => !a.active);
  return (
    <section className={cx('rounded-lg border p-3', active.length ? 'border-rose-500/80 bg-rose-500/10' : 'border-line bg-panel/80')} aria-label={t('Current well problems')}>
      <div className="flex flex-wrap items-center gap-2">
        <AlertOctagon size={16} className={active.length ? 'text-rose-400' : 'text-mute'} />
        <b className="text-[13px] tracking-wide">{t('CURRENT WELL – ACTUAL RECORDED PROBLEMS')}</b>
        <span className="text-xs text-mute">· {wellName} · {active.length} {t('active')} · {earlier.length} {t('earlier')}</span>
      </div>
      {!alerts.length && <p className="mt-1 text-xs text-mute">{t('No problem is recorded in this well\'s reports up to the current time.')}</p>}
      <div className="mt-2 space-y-2">
        {active.map(a => {
          const p = a.problem, ev = events[p.id], acts = actions.filter(x => x.problem_id === p.id), done = ev && ev.status !== 'new';
          return (
            <div key={p.id} className={cx('rounded-md border p-2.5 text-xs', done ? 'border-rose-500/30 bg-panel/60' : 'border-rose-500/70 bg-rose-950/40')}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge color="red">{t('CURRENT WELL – ACTUAL RECORDED PROBLEM')}</Badge>
                <b className="text-[13px]">{t(catName(p.category_id))}</b>
                <Badge color={p.status === 'confirmed' ? 'green' : 'yellow'}>{p.status === 'confirmed' ? t('Engineer-confirmed') : t('recorded in the report – not yet confirmed')}</Badge>
                {ev && <Badge color={ev.status === 'new' ? 'yellow' : 'green'}>{t(ev.status === 'acknowledged' ? 'Acknowledged' : ev.status === 'reviewed' ? 'Reviewed' : 'Not yet acknowledged')}</Badge>}
                <span className="flex-1" />
                <Button size="sm" onClick={() => onOpen(a)}>{t('Open problem report')}</Button>
              </div>
              {!done && <>
                <dl className="num mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
                  <div><dt className="text-[10px] text-mute">{t('Date and time')}</dt><dd>{fmtDateTime(p.occurred_at)}</dd></div>
                  <div><dt className="text-[10px] text-mute">{t('Problem depth')} (MD)</dt><dd>{U.fdu(p.md_top_ft)}{p.md_bottom_ft ? ` – ${U.fdu(p.md_bottom_ft)}` : ''}</dd></div>
                  <div><dt className="text-[10px] text-mute">TVD</dt><dd>{p.tvd_ft != null ? U.fdu(p.tvd_ft) : tvdAt?.(p.md_top_ft) != null ? <>{U.fdu(tvdAt(p.md_top_ft))} <span className="text-[10px] text-mute">({t('from survey')})</span></> : <NA t={t} />}</dd></div>
                  <div><dt className="text-[10px] text-mute">{t('Formation')}</dt><dd>{p.formation_name ?? <NA t={t} />}</dd></div>
                  <div><dt className="text-[10px] text-mute">NPT</dt><dd>{p.npt_hours ? `${fmt(p.npt_hours, 2)} h` : t('none recorded')}</dd></div>
                  <div className="col-span-3"><dt className="text-[10px] text-mute">{t('Detected drilling parameters')}</dt>
                    <dd>{a.params.filter(x => x.value != null).map(x => `${t(x.label)} ${fmt(x.value, x.value! < 20 ? 2 : 0)} ${x.unit}`).join(' · ') || <NA t={t} />}</dd></div>
                </dl>
                <p className="mt-1 line-clamp-2">{p.description}</p>
                {acts.length > 0 && <p className="mt-1"><span className="text-mute">{t('Corrective actions')}:</span> {acts.map(x => x.action_text).join(' · ')}</p>}
                <p className="num mt-1 text-[10px] text-mute" dir="ltr">{t('Original report')}: {p.source_ref ?? '—'}</p>
              </>}
              {canWrite && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="primary" disabled={ev?.status === 'acknowledged' || ev?.status === 'reviewed'} onClick={() => onEvent(p.id, { status: 'acknowledged' })}>{t('Acknowledge')}</Button>
                  <Button size="sm" disabled={ev?.status === 'reviewed'} onClick={() => onEvent(p.id, { status: 'reviewed' })}>{t('Mark as reviewed')}</Button>
                  <input className="h-7 min-w-40 flex-1 rounded border border-line bg-bg/70 px-2 text-xs" placeholder={t('Engineering comment…')} value={comment[p.id] ?? ''} onChange={e => setComment(c => ({ ...c, [p.id]: e.target.value }))} />
                  <Button size="sm" disabled={!comment[p.id]?.trim()} onClick={() => { onEvent(p.id, { comments: [...(ev?.comments ?? []), { at: new Date().toISOString(), by: '', text: comment[p.id].trim() } as AlertComment] }); setComment(c => ({ ...c, [p.id]: '' })); }}>{t('Add')}</Button>
                </div>
              )}
              {ev?.comments?.length ? <ul className="mt-1 space-y-0.5">{ev.comments.map((c, i) => <li key={i} className="text-[11px]"><span className="text-mute">{fmtDateTime(c.at)} · {c.by}:</span> {c.text}</li>)}</ul> : null}
            </div>);
        })}
        {earlier.length > 0 && (
          <details className="text-xs"><summary className="cursor-pointer text-mute">{t('Earlier problems in this well')} ({earlier.length})</summary>
            <ul className="mt-1 space-y-1">{earlier.map(a => (
              <li key={a.problem.id}><button className="flex w-full gap-2 text-start hover:text-rose-200" onClick={() => onOpen(a)}>
                <span className="h-2 w-2 translate-y-1 rounded-full bg-rose-500" /><span className="flex-1">{t(catName(a.problem.category_id))} @ {U.fdu(a.problem.md_top_ft)} · <span className="num text-mute">{fmtDateTime(a.problem.occurred_at)}</span></span>
                {events[a.problem.id] && <Badge color="green">{t(events[a.problem.id].status)}</Badge>}
              </button></li>))}</ul></details>)}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ hole section, tools, casing & cementing
export function HoleSectionCard({ s, total, U }: { s: HoleSection | null; total: number; U: Units }) {
  const { t } = usePrefs();
  if (!s) return <p className="text-xs text-mute">{t('No hole section information for this time.')}</p>;
  const row = (k: string, v: React.ReactNode) => <div><dt className="text-[10px] text-mute">{k}</dt><dd className="font-semibold">{v ?? <NA t={t} />}</dd></div>;
  return (
    <dl className="num grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      {row(t('Hole section'), `${s.section_no} / ${total}`)}
      {row(t('Hole diameter'), inch(s.hole_size_in))}
      {row(t('Bit diameter'), s.bit_sizes_in.length ? s.bit_sizes_in.map(inch).join(', ') : null)}
      {row(t('Casing diameter'), s.casing_od_in != null ? `${inch(s.casing_od_in)} ${t(s.casing_kind ?? '')}` : null)}
      {row(t('Interval'), s.top_md_ft != null ? `${U.fd(s.top_md_ft)} – ${U.fdu(s.bottom_md_ft)}` : null)}
      {row(t('Casing shoe'), s.shoe_md_ft != null ? U.fdu(s.shoe_md_ft) : null)}
      {row(t('Bit type'), s.bit_types.length ? s.bit_types.join(', ') : null)}
      {row(t('BHA runs'), s.bha_runs.length ? s.bha_runs.join(', ') : null)}
      {row(t('Drilling'), s.drill_start ? `${String(s.drill_start).slice(0, 10)} → ${String(s.drill_end).slice(0, 10)}` : null)}
      {row(t('Section duration'), s.duration_h != null ? `${fmt(s.duration_h / 24, 1)} d` : null)}
      {row(t('Average ROP'), s.avg_rop_fph != null ? `${U.fr(s.avg_rop_fph)} ${U.rl}` : null)}
      {row('NPT', s.npt_hours != null ? `${fmt(s.npt_hours, 2)} h` : null)}
      <div className="col-span-2">{row(t('Formations'), s.formations.length ? s.formations.join(' · ') : null)}</div>
    </dl>
  );
}

const TOOL_ORDER = ['PDC Bit', 'Roller Cone Bit', 'Bit', 'Rotary Steerable System (RSS)', 'Motor', 'Near Bit Stabilizer', 'String Stabilizer', 'Reamer', 'LWD Tool', 'MWD Tool', 'Non-Magnetic Drill Collar', 'Sub', 'Jar', 'Shock Sub', 'Drill Collar', 'Crossover', 'Heavy Weight Drill Pipe (HWDP)', 'Drill Pipe'];
export function ToolTable({ tools, U }: { tools: DrillingTool[]; U?: Units }) {
  const { t } = usePrefs();
  const rows = [...tools].sort((a, b) => (TOOL_ORDER.indexOf(a.tool_type) + 99) % 99 - (TOOL_ORDER.indexOf(b.tool_type) + 99) % 99);
  const th = 'border-b border-line px-1.5 py-1 text-start text-[10px] font-medium uppercase tracking-wide text-mute whitespace-nowrap', td = 'border-b border-line/40 px-1.5 py-1 align-top';
  if (!rows.length) return <p className="text-xs text-mute">{t('No equipment of this kind is listed in the report for this stage.')}</p>;
  return (
    <div className="overflow-x-auto"><table className="w-full text-xs">
      <thead><tr><th className={th}>{t('Tool')}</th><th className={th}>OD</th><th className={th}>ID</th><th className={th}>{t('Length')}</th><th className={th}>{t('Qty')}</th><th className={th}>{t('Serial No.')}</th><th className={th}>{t('Specifications')}</th><th className={th}>{t('Source')}</th></tr></thead>
      <tbody>{rows.map(x => (
        <tr key={x.id}>
          <td className={td}><b>{t(x.tool_type)}</b><div className="text-[10px] text-mute">{x.name}</div></td>
          <td className={cx(td, 'num')}>{inch(x.od_in) ?? <NA t={t} />}</td>
          <td className={cx(td, 'num')}>{inch(x.id_in) ?? <NA t={t} />}</td>
          <td className={cx(td, 'num')}>{x.length_ft != null ? (U ? U.fdu(x.length_ft, 1) : `${fmt(x.length_ft, 1)} ft`) : <NA t={t} />}</td>
          <td className={cx(td, 'num')}>{x.quantity != null ? `${fmt(x.quantity, 0)} ${t(x.quantity_unit ?? '')}` : <NA t={t} />}</td>
          <td className={cx(td, 'num')}>{x.serial_no ?? <NA t={t} />}{x.manufacturer && <div className="text-[10px] text-mute">{x.manufacturer}</div>}</td>
          <td className={cx(td, 'text-[11px]')}>{Object.entries(x.specs ?? {}).map(([k, v]) => <span key={k} className="me-1.5 inline-block"><span className="text-mute">{t(k.replace(/_/g, ' '))}:</span> {typeof v === 'number' && /_in$/.test(k) ? inch(v) : String(v)}</span>)}</td>
          <td className={td}><span className="num text-[10px] text-mute" dir="ltr">{x.source_ref}</span>{x.entered_by !== 'import' && <Badge color="cyan" className="ms-1">{t(x.entered_by)}</Badge>}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

export function ToolsPanel({ view, op, U }: { view: ToolView; op: Operation | null; U: Units }) {
  const { t } = usePrefs();
  const kv = (k: string, v: React.ReactNode) => <div><dt className="text-[10px] text-mute">{k}</dt><dd className="font-semibold">{v ?? <NA t={t} />}</dd></div>;
  return (
    <div className="space-y-2">
      <p className="text-xs"><span className="text-mute">{t('Current operation')}:</span> <b>{op ? t(OP_TYPE[op.type_code]?.name ?? op.type_code) : '—'}</b> · <span className="text-mute">{t(view.title)}</span></p>
      {view.kind === 'bha' && view.run && (
        <dl className="num grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
          {kv(t('BHA number'), view.run.run_no)}{kv(t('BHA type'), view.run.bha_type)}{kv(t('Hole Size'), inch(view.run.hole_size_in))}{kv(t('Bit diameter'), inch(view.run.bit_size_in))}
          {kv(t('Bit type'), [view.run.bit_type, view.run.bit_model].filter(Boolean).join(' ') || null)}{kv(t('Bit serial'), view.run.bit_serial)}{kv(t('Nozzles'), view.run.nozzles)}{kv(t('Dull grade (out)'), view.run.dull_grade)}
          {kv(t('Motor'), view.tools.filter(x => x.tool_type === 'Motor').map(x => [inch(x.od_in), x.name, x.specs.bend_deg != null ? `${x.specs.bend_deg}° bend` : null].filter(Boolean).join(' · ')).join('; ') || null)}
          {kv('RSS', view.tools.filter(x => /RSS/.test(x.tool_type)).map(x => x.name).join('; ') || null)}
          {kv(t('Stabilizers'), view.tools.filter(x => /Stabilizer/.test(x.tool_type)).map(x => inch(x.od_in) ?? x.name).join(', ') || null)}
          {kv(t('Drill pipe'), view.tools.filter(x => x.tool_type === 'Drill Pipe').map(x => inch(x.od_in) ?? x.name).join(', ') || null)}
          {kv(t('Depth in / out'), view.run.depth_in_ft != null ? `${U.fd(view.run.depth_in_ft)} / ${U.fdu(view.run.depth_out_ft)}` : null)}
          {kv(t('In hole'), view.run.start_at ? `${fmtDateTime(view.run.start_at)} → ${view.run.end_at ? fmtDateTime(view.run.end_at) : '…'}` : null)}
        </dl>)}
      {view.kind === 'casing' && (view.casing ? <CasingSummary c={view.casing} U={U} /> : <p className="text-xs text-mute">{t('The casing string is not described in the report.')}</p>)}
      {view.kind === 'cementing' && <>
        {view.casing && <CasingSummary c={view.casing} U={U} />}
        {view.job ? <CementSummary j={view.job} U={U} /> : <p className="text-xs text-mute">{t('No cement job details in the report.')}</p>}
      </>}
      {view.kind === 'none' ? <p className="text-xs text-mute">{t(view.title)}.</p> : <ToolTable tools={view.tools} U={U} />}
    </div>
  );
}

export function CasingSummary({ c, U }: { c: import('../lib/types').CasingString; U: Units }) {
  const { t } = usePrefs();
  return (
    <div className="rounded border border-line/70 p-2 text-xs">
      <b>{inch(c.od_in)} {t(c.kind)}</b>
      <span className="text-mute"> · {c.weights.length ? c.weights.map(w => `${fmt(w.ppf, 1)} ppf${w.from != null || w.to != null ? ` (${w.from != null ? U.fd(w.from) : '?'}–${w.to != null ? U.fdu(w.to) : '?'})` : ''}`).join(', ') : `${t('weight')} ${t('Not available')}`}
        {' · '}{c.grades.length ? c.grades.join(', ') : `${t('grade')} ${t('Not available')}`}{' · '}{c.connections.length ? c.connections.join(', ') : `${t('connection')} ${t('Not available')}`}</span>
      <div className="num mt-0.5 text-mute">{t('Shoe')}: <span className="text-ink">{c.shoe_md_ft != null ? U.fdu(c.shoe_md_ft) : t('Not available')}</span>{c.shoe_basis && ` (${t(c.shoe_basis)})`}
        {c.top_md_ft ? ` · ${t('Top')}: ${U.fdu(c.top_md_ft)}` : ''}{c.float_collar_md_ft ? ` · ${t('Float collar')}: ${U.fdu(c.float_collar_md_ft)}` : ''}{c.landing_collar_md_ft ? ` · ${t('Landing collar')}: ${U.fdu(c.landing_collar_md_ft)}` : ''}</div>
      <div className="num text-[10px] text-mute" dir="ltr">{c.source_ref}</div>
    </div>
  );
}
export function CementSummary({ j, U }: { j: import('../lib/types').CementingEvent; U: Units }) {
  const { t } = usePrefs();
  return (
    <div className="rounded border border-line/70 p-2 text-xs">
      <b>{t('Cement job')} · {inch(j.casing_od_in) ?? ''} {t(j.kind ?? '')}</b> <span className="text-mute">· {j.stages} {t(j.stages > 1 ? 'stages' : 'stage')} · {fmtDateTime(j.start_at)} → {fmtDateTime(j.end_at)}</span>
      {j.steps.length > 0 && <div className="mt-0.5">{j.steps.map(s => t(s)).join(' → ')}</div>}
      <div className="num mt-0.5 text-mute">
        {j.fluids.length ? j.fluids.map(f => `${f.fluid} ${fmt(f.densityPpg, 1)} ppg`).join(' · ') : `${t('fluids')} ${t('Not available')}`}
      </div>
      <div className="num text-mute">{t('Displacement')}: <span className="text-ink">{j.displacement_bbl != null ? `${fmt(j.displacement_bbl, 0)} bbl` : t('Not available')}</span> · FCP: <span className="text-ink">{j.fcp_psi != null ? `${fmt(j.fcp_psi, 0)} psi` : t('Not available')}</span> · {t('Bump')}: <span className="text-ink">{j.bump_psi != null ? `${fmt(j.bump_psi, 0)} psi` : t('Not available')}</span>
        {j.plugs.length ? ` · ${t('Plugs')}: ${j.plugs.join(', ')}` : ''}{j.woc_hours ? ` · WOC ${fmt(j.woc_hours, 1)} h` : ''}</div>
      {j.losses_text && <div className="text-yellow-200/90">{t('Losses')}: {j.losses_text}</div>}
      <div className="num text-[10px] text-mute" dir="ltr">{j.source_ref}</div>
    </div>
  );
}

export function CasingCementing({ eq, t: now, U }: { eq: Equip; t: number; U: Units }) {
  const { t } = usePrefs();
  const set = eq.casings.filter(c => c.run_start && Date.parse(c.run_start) <= now);
  if (!eq.casings.length && !eq.cementing.length) return <p className="text-xs text-mute">{t('No casing or cementing information in the report.')}</p>;
  if (!set.length) return <p className="text-xs text-mute">{t('No casing has been run yet at this time.')}</p>;
  return (
    <div className="space-y-2">{set.map(c => {
      const job = eq.cementing.find(j => j.casing_string_id === c.id);
      const done = c.run_end && Date.parse(c.run_end) <= now;
      return (
        <div key={c.id} className="space-y-1">
          <div className="flex items-center gap-2 text-[11px]"><Badge color={done ? 'green' : 'yellow'}>{done ? t('run') : t('running')}</Badge>{job && Date.parse(job.start_at ?? '') <= now && <Badge color={job.end_at && Date.parse(job.end_at) <= now ? 'green' : 'yellow'}>{t('cemented')}{job.end_at && Date.parse(job.end_at) > now ? ` (${t('in progress')})` : ''}</Badge>}</div>
          <CasingSummary c={c} U={U} />
          {job && Date.parse(job.start_at ?? '') <= now && <CementSummary j={job} U={U} />}
        </div>);
    })}</div>
  );
}

export function SectionTable({ sections, U }: { sections: HoleSection[]; U: Units }) {
  const { t } = usePrefs();
  const th = 'border-b border-line px-1.5 py-1 text-start text-[10px] font-medium uppercase tracking-wide text-mute whitespace-nowrap', td = 'border-b border-line/40 px-1.5 py-1 align-top num';
  return (
    <div className="overflow-x-auto"><table className="w-full text-xs">
      <thead><tr>{['Hole section', 'Hole diameter', 'Bit diameter', 'Casing diameter', 'Casing shoe', 'Interval', 'Bit type', 'BHA runs', 'Tools', 'Drilling', 'Duration', 'Average ROP', 'NPT', 'Formations'].map(h => <th key={h} className={th}>{t(h)}</th>)}</tr></thead>
      <tbody>{sections.map(s => (
        <tr key={s.id}>
          <td className={td}>{s.section_no}</td><td className={td}>{inch(s.hole_size_in) ?? <NA t={t} />}</td><td className={td}>{s.bit_sizes_in.length ? s.bit_sizes_in.map(inch).join(', ') : <NA t={t} />}</td>
          <td className={td}>{s.casing_od_in != null ? `${inch(s.casing_od_in)} ${t(s.casing_kind ?? '')}` : <NA t={t} />}</td><td className={td}>{s.shoe_md_ft != null ? U.fdu(s.shoe_md_ft) : <NA t={t} />}</td>
          <td className={td}>{s.top_md_ft != null ? `${U.fd(s.top_md_ft)} – ${U.fdu(s.bottom_md_ft)}` : <NA t={t} />}</td><td className={td}>{s.bit_types.join(', ') || <NA t={t} />}</td><td className={td}>{s.bha_runs.join(', ') || '—'}</td><td className={td}>{s.tools_count}</td>
          <td className={td}>{s.drill_start ? `${String(s.drill_start).slice(0, 10)} → ${String(s.drill_end).slice(0, 10)}` : <NA t={t} />}</td><td className={td}>{s.duration_h != null ? `${fmt(s.duration_h / 24, 1)} d` : '—'}</td>
          <td className={td}>{s.avg_rop_fph != null ? `${U.fr(s.avg_rop_fph)} ${U.rl}` : <NA t={t} />}</td><td className={td}>{fmt(s.npt_hours, 2)} h</td><td className={cx(td, 'font-sans')}>{s.formations.join(' · ')}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

export const OP_COLOR_LEGEND = ({ cats }: { cats: string[] }) => {
  const { t } = usePrefs();
  return <div className="flex flex-wrap gap-2 text-[10px] text-mute">{cats.map(c => <span key={c} className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: CATEGORY_COLOR[c as OpCategory] }} />{t(c)}</span>)}<span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-600" />NPT</span></div>;
};
