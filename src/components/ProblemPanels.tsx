// Problem report (with optional alert context) and the problem entry form.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Paperclip, Trash2 } from 'lucide-react';
import * as repo from '../db/repo';
import { useAuth, usePrefs } from '../lib/context';
import { paramSnapshot } from '../lib/kpi';
import { paramLabel, type CurrentContext, type Match } from '../lib/matching';
import { ACTIVITIES, actName, SEVERITIES, STATUS_LABEL, type DrillingProblem, type HistoricalAlert, type ProblemCategory, type ProblemStatus, type Well } from '../lib/types';
import { fmt, fmtDateTime } from '../lib/units';
import { fromLocalInput, toLocalInput, zoneLabel } from '../lib/time';
import { Badge, Button, Field, Input, Notice, Select, Spinner, Textarea, useAction, useAsync } from './ui';

export const SEV_COLOR = { low: 'gray', medium: 'yellow', high: 'orange', critical: 'red' } as const;
export const STATUS_COLOR: Record<ProblemStatus, string> = { anomaly: 'gray', suspected: 'yellow', confirmed: 'cyan', dismissed: 'gray' };
export const ALERT_BADGE = { green: 'green', yellow: 'yellow', orange: 'orange', red: 'red' } as const;

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-3 border-b border-line/50 py-1.5 text-[13px]"><dt className="w-40 shrink-0 text-mute">{k}</dt><dd className="min-w-0 flex-1 break-words">{v ?? '—'}</dd></div>
);

interface ReportProps {
  problem: DrillingProblem; well: Well | undefined; category: ProblemCategory | undefined;
  match?: Match; ctx?: CurrentContext; alert?: HistoricalAlert;
  onAlertChanged?: (a: HistoricalAlert) => void; onChanged?: () => void; onEdit?: () => void;
}

export function ProblemReport({ problem: p, well, category, match, ctx, alert, onAlertChanged, onChanged, onEdit }: ReportProps) {
  const { t, U } = usePrefs();
  const { canWrite, user } = useAuth();
  const actions = useAsync(() => repo.listActions(p.id), [p.id]);
  const files = useAsync(() => repo.listAttachments(p.id), [p.id]);
  const [newAction, setNewAction] = useState(''), [comment, setComment] = useState('');
  const act = useAction();

  const patchAlert = (patch: Partial<HistoricalAlert>) => act.run(async () => { await repo.updateAlert(alert!.id, patch); onAlertChanged?.({ ...alert!, ...patch }); });
  const setStatus = (status: ProblemStatus) => act.run(async () => { await repo.saveProblem({ ...p, status }, well!); onChanged?.(); });

  return (
    <div className="space-y-5">
      {match && (
        <div className="rounded-md border border-line bg-panel2/50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={ALERT_BADGE[match.color]}>{t('Historical Drilling Risk Detected')}</Badge>
            <Badge>{t('Similarity')} {match.similarity}%</Badge>
            {alert && <Badge color={alert.status === 'new' ? 'yellow' : 'green'}>{t(alert.status === 'new' ? 'Not yet acknowledged' : alert.status === 'acknowledged' ? 'Acknowledged' : 'Reviewed')}</Badge>}
          </div>
          <p className="mt-2 text-[13px] text-mute">{t('This is a historical risk indicator based on previous wells. It does not mean the problem will occur.')}</p>
          <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-mute">{t('Why this event was matched')}</h4>
          <ul className="mt-1 list-disc space-y-0.5 ps-5 text-[13px]">{match.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <table className="mt-3 w-full text-xs">
            <thead><tr className="text-mute"><th className="py-1 text-start font-medium">{t('Similarity component')}</th><th className="text-end font-medium">{t('Weight')}</th><th className="text-end font-medium">{t('Score')}</th><th className="ps-3 text-start font-medium">{t('Detail')}</th></tr></thead>
            <tbody>{match.components.map(c => (
              <tr key={c.key} className="border-t border-line/50"><td className="py-1">{t(c.label)}</td><td className="num text-end">{c.weight}</td><td className="num text-end">{c.score == null ? t('n/a') : `${Math.round(c.score * 100)}%`}</td><td className="ps-3 text-mute">{c.detail}</td></tr>
            ))}</tbody>
          </table>
          {ctx && (
            <>
              <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-mute">{t('Current conditions vs historical event')}</h4>
              <table className="mt-1 w-full text-xs">
                <thead><tr className="text-mute"><th className="py-1 text-start font-medium">{t('Parameter')}</th><th className="text-end font-medium">{t('Current well')}</th><th className="text-end font-medium">{t('Historical event')}</th></tr></thead>
                <tbody>
                  <tr className="border-t border-line/50"><td className="py-1">MD ({U.dl})</td><td className="num text-end">{U.fd(ctx.md)}</td><td className="num text-end">{U.fd(p.md_top_ft)}</td></tr>
                  <tr className="border-t border-line/50"><td className="py-1">{t('Formation')}</td><td className="text-end">{ctx.formation ?? '—'}</td><td className="text-end">{p.formation_name ?? '—'}</td></tr>
                  <tr className="border-t border-line/50"><td className="py-1">{t('Hole Size')} (in)</td><td className="num text-end">{ctx.holeSize ?? '—'}</td><td className="num text-end">{p.hole_size_in ?? '—'}</td></tr>
                  {Object.keys({ ...ctx.params, ...(p.observed_params ?? {}) }).map(k => (
                    <tr key={k} className="border-t border-line/50"><td className="py-1">{t(paramLabel(k))}</td><td className="num text-end">{fmt(ctx.params[k], 1)}</td><td className="num text-end">{fmt(p.observed_params?.[k], 1)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {alert && canWrite && (
            <div className="mt-4 space-y-3 border-t border-line pt-3">
              <div className="flex flex-wrap items-end gap-2">
                <Button size="sm" variant="primary" disabled={act.busy || alert.status !== 'new'} onClick={() => patchAlert({ status: 'acknowledged' })}>{t('Acknowledge')}</Button>
                <Button size="sm" disabled={act.busy || alert.status === 'reviewed'} onClick={() => patchAlert({ status: 'reviewed' })}>{t('Mark as reviewed')}</Button>
                <Field label={t('Did the risk actually occur?')} className="w-56">
                  <Select value={alert.outcome} onChange={e => patchAlert({ outcome: e.target.value as HistoricalAlert['outcome'] })}>
                    <option value="unknown">{t('Not recorded yet')}</option><option value="occurred">{t('Yes – it occurred')}</option><option value="not_occurred">{t('No – it did not occur')}</option>
                  </Select>
                </Field>
              </div>
              <div>
                {alert.comments.map((c, i) => <p key={i} className="text-xs"><span className="text-mute">{fmtDateTime(c.at)} · {c.by}:</span> {c.text}</p>)}
                <div className="mt-1 flex gap-2">
                  <Input value={comment} onChange={e => setComment(e.target.value)} placeholder={t('Add a comment')} />
                  <Button size="md" disabled={!comment.trim() || act.busy} onClick={() => patchAlert({ comments: [...alert.comments, { at: new Date().toISOString(), by: user!.email, text: comment.trim() }] }).then(() => setComment(''))}>{t('Add')}</Button>
                </div>
              </div>
            </div>
          )}
          {!alert && <p className="mt-3 text-xs text-mute">{t('Viewer role: alerts are shown but not stored, acknowledged or commented.')}</p>}
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="num text-xs text-mute">{p.problem_code}</span>
          <Badge color={STATUS_COLOR[p.status]}>{t(STATUS_LABEL[p.status])}</Badge>
          <Badge color={SEV_COLOR[p.severity]}>{t('Severity')}: {t(p.severity)}</Badge>
          {p.source === 'demo' && <Badge color="magenta">{t('Sample data')}</Badge>}
          <div className="flex-1" />
          {well && <Link to={`/wells/${well.id}`} className="text-xs text-cyan-300 hover:underline">{t('View original well record')} →</Link>}
        </div>
        <dl>
          <Row k={t('Well')} v={well ? `${well.name} (${well.well_code})` : '—'} />
          <Row k={t('Problem category')} v={category ? t(category.name) : '—'} />
          <Row k={t('Date and time')} v={fmtDateTime(p.occurred_at)} />
          <Row k={`MD (${U.dl})`} v={`${U.fd(p.md_top_ft)}${p.md_bottom_ft != null && p.md_bottom_ft !== p.md_top_ft ? ` – ${U.fd(p.md_bottom_ft)}` : ''}`} />
          <Row k={`TVD (${U.dl})`} v={p.tvd_ft == null ? t('Not available') : U.fd(p.tvd_ft)} />
          <Row k={t('Formation')} v={p.formation_name} />
          <Row k={t('Hole Size')} v={p.hole_size_in != null ? `${p.hole_size_in} in` : null} />
          <Row k={t('BHA Number')} v={p.bha_number} />
          <Row k={t('Drilling activity')} v={p.activity_code ? t(actName(p.activity_code)) : null} />
          <Row k={t('Description')} v={p.description} />
          <Row k={t('Root cause')} v={p.root_cause ?? t('Not known')} />
          <Row k={t('NPT duration')} v={`${fmt(p.npt_hours, 1)} h`} />
          <Row k={t('Observed parameters')} v={p.observed_params ? Object.entries(p.observed_params).map(([k, v]) => `${t(paramLabel(k))} ${fmt(v, 1)}`).join(' · ') : null} />
          <Row k={t('Lessons learned')} v={p.lessons_learned} />
          <Row k={t('Notes')} v={p.notes} />
          {p.source_ref && <Row k={t('Source location')} v={<span dir="ltr" className="num text-xs">{p.source_ref}</span>} />}
          {p.source_text && <Row k={t('Original text')} v={<span className="text-mute">{p.source_text}</span>} />}
        </dl>
      </div>

      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('Corrective actions')}</h4>
        {actions.loading ? <Spinner /> : (
          <ul className="space-y-1 text-[13px]">
            {actions.data?.map(a => (
              <li key={a.id} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" /><span className="flex-1">{a.action_text}{a.outcome && <span className="text-mute"> — {a.outcome}</span>}</span>
                {canWrite && <button aria-label={t('Delete')} className="text-mute hover:text-rose-300" onClick={() => act.run(async () => { await repo.removeAction(a.id); actions.reload(); })}><Trash2 size={13} /></button>}
              </li>
            ))}
            {!actions.data?.length && <li className="text-mute">{t('No corrective actions recorded.')}</li>}
          </ul>
        )}
        {canWrite && (
          <div className="mt-2 flex gap-2">
            <Input value={newAction} onChange={e => setNewAction(e.target.value)} placeholder={t('Add a corrective action')} />
            <Button disabled={!newAction.trim() || act.busy} onClick={() => act.run(async () => { await repo.addAction(p.id, newAction.trim()); setNewAction(''); actions.reload(); })}>{t('Add')}</Button>
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-mute">{t('Attachments')}</h4>
        <ul className="space-y-1 text-[13px]">
          {files.data?.map(a => (
            <li key={a.id} className="flex items-center gap-2"><Paperclip size={13} className="text-mute" />
              <button className="text-cyan-300 hover:underline" onClick={() => act.run(async () => { const url = await repo.attachmentUrl(a); const el = document.createElement('a'); el.href = url; el.download = a.file_name; el.click(); })}>{a.file_name}</button>
              <span className="num text-xs text-mute">{fmt((a.size_bytes ?? 0) / 1024, 0)} KB</span>
              {canWrite && <button aria-label={t('Delete')} className="text-mute hover:text-rose-300" onClick={() => act.run(async () => { await repo.removeAttachment(a); files.reload(); })}><Trash2 size={13} /></button>}
            </li>
          ))}
          {!files.data?.length && <li className="text-mute">{t('No attachments.')}</li>}
        </ul>
        {canWrite && <input type="file" className="mt-2 text-xs text-mute" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) act.run(async () => { await repo.addAttachment(p.id, f); files.reload(); }); }} />}
      </div>

      {act.error && <Notice kind="error">{act.error}</Notice>}
      {canWrite && well && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {p.status !== 'confirmed' && <Button size="sm" variant="primary" disabled={act.busy} onClick={() => setStatus('confirmed')}>{t('Confirm as drilling problem')}</Button>}
          {p.status === 'anomaly' && <Button size="sm" disabled={act.busy} onClick={() => setStatus('suspected')}>{t('Mark as suspected')}</Button>}
          {p.status !== 'dismissed' && <Button size="sm" disabled={act.busy} onClick={() => setStatus('dismissed')}>{t('Dismiss')}</Button>}
          {onEdit && <Button size="sm" onClick={onEdit}>{t('Edit')}</Button>}
          <div className="flex-1" />
          <Button size="sm" variant="danger" disabled={act.busy} onClick={() => { if (confirm(t('Delete this problem record permanently?'))) act.run(async () => { await repo.deleteProblem(p); onChanged?.(); }); }}>{t('Delete')}</Button>
        </div>
      )}
    </div>
  );
}

interface FormProps { wells: Well[]; categories: ProblemCategory[]; initial?: Partial<DrillingProblem>; onSaved: (p: DrillingProblem) => void; onCancel: () => void }

export function ProblemForm({ wells, categories, initial, onSaved, onCancel }: FormProps) {
  const { t, U } = usePrefs();
  const [f, setF] = useState<Partial<DrillingProblem>>({ severity: 'medium', status: 'suspected', npt_hours: 0, well_id: wells[0]?.id, category_id: categories[0]?.id, ...initial });
  const [md, setMd] = useState(initial?.md_top_ft != null ? String(Math.round(U.d(initial.md_top_ft)! * 10) / 10) : '');
  const [mdB, setMdB] = useState(initial?.md_bottom_ft != null ? String(Math.round(U.d(initial.md_bottom_ft)! * 10) / 10) : '');
  const [tvd, setTvd] = useState(initial?.tvd_ft != null ? String(Math.round(U.d(initial.tvd_ft)! * 10) / 10) : '');
  const [actionsText, setActionsText] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const act = useAction();
  const set = (patch: Partial<DrillingProblem>) => setF(s => ({ ...s, ...patch }));
  const num = (s: string) => (s.trim() === '' || isNaN(Number(s)) ? null : Number(s));
  const well = wells.find(w => w.id === f.well_id);

  const autofill = () => act.run(async () => {
    const depth = num(md);
    if (!well || depth == null) throw new Error(t('Select a well and enter the measured depth first.'));
    const recs = await repo.getRecords(well.id);
    const ft = U.toFt(depth), idx = recs.findIndex(r => r.hole >= ft);
    if (idx < 0) throw new Error(t('No drilling record at or below this depth for the selected well.'));
    const r = recs[idx];
    set({ occurred_at: r.ts, formation_name: r.formation_name, hole_size_in: r.hole_size_in ?? well.hole_size_in, bha_number: r.bha_number, activity_code: r.activity_code, observed_params: paramSnapshot(recs, idx) });
    if (r.tvd_ft != null) setTvd(String(Math.round(U.d(r.tvd_ft)! * 10) / 10));
    setInfo(t('Filled from the drilling record at') + ` ${fmtDateTime(r.t)}`);
  });

  const save = () => act.run(async () => {
    const top = num(md);
    if (!well) throw new Error(t('Select a well.'));
    if (top == null || top < 0) throw new Error(t('Measured depth (MD) is required.'));
    if (!f.category_id) throw new Error(t('Select a problem category.'));
    const bottom = num(mdB);
    const saved = await repo.saveProblem({
      ...f, well_id: well.id, category_id: f.category_id, md_top_ft: U.toFt(top), md_bottom_ft: bottom == null ? null : U.toFt(bottom),
      tvd_ft: num(tvd) == null ? null : U.toFt(num(tvd)!), description: f.description ?? '', npt_hours: Number(f.npt_hours) || 0,
    }, well);
    for (const line of actionsText.split('\n').map(s => s.trim()).filter(Boolean)) await repo.addAction(saved.id, line);
    onSaved(saved);
  });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('Well')}><Select value={f.well_id ?? ''} disabled={!!f.id} onChange={e => set({ well_id: e.target.value })}>{wells.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</Select></Field>
        <Field label={t('Problem category')}><Select value={f.category_id ?? ''} onChange={e => set({ category_id: e.target.value })}>{categories.map(c => <option key={c.id} value={c.id}>{t(c.name)}</option>)}</Select></Field>
        <Field label={t('Classification')}><Select value={f.status} onChange={e => set({ status: e.target.value as ProblemStatus })}>{(['anomaly', 'suspected', 'confirmed'] as const).map(s => <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>)}</Select></Field>
        <Field label={`${t('Measured depth (MD) – top')} (${U.dl})`}><Input value={md} onChange={e => setMd(e.target.value)} inputMode="decimal" /></Field>
        <Field label={`${t('MD – bottom of interval')} (${U.dl})`} hint={t('Optional')}><Input value={mdB} onChange={e => setMdB(e.target.value)} inputMode="decimal" /></Field>
        <Field label={`TVD (${U.dl})`} hint={t('If available')}><Input value={tvd} onChange={e => setTvd(e.target.value)} inputMode="decimal" /></Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={autofill} disabled={act.busy}>{t('Fill time, formation, BHA and parameters from drilling data at this depth')}</Button>
        {info && <span className="text-xs text-emerald-300">{info}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('Date and time')}><Input type="datetime-local" title={zoneLabel()} value={toLocalInput(f.occurred_at)} onChange={e => set({ occurred_at: fromLocalInput(e.target.value) })} /></Field>
        <Field label={t('Formation')}><Input value={f.formation_name ?? ''} onChange={e => set({ formation_name: e.target.value || null })} /></Field>
        <Field label={t('Drilling activity')}><Select value={f.activity_code ?? ''} onChange={e => set({ activity_code: e.target.value || null })}><option value="">—</option>{ACTIVITIES.map(a => <option key={a.code} value={a.code}>{t(a.name)}</option>)}</Select></Field>
        <Field label={`${t('Hole Size')} (in)`}><Input value={f.hole_size_in ?? ''} onChange={e => set({ hole_size_in: num(e.target.value) })} inputMode="decimal" /></Field>
        <Field label={t('BHA Number')}><Input value={f.bha_number ?? ''} onChange={e => set({ bha_number: num(e.target.value) })} inputMode="numeric" /></Field>
        <Field label={`${t('NPT duration')} (h)`}><Input value={f.npt_hours ?? 0} onChange={e => set({ npt_hours: e.target.value as unknown as number })} inputMode="decimal" /></Field>
        <Field label={t('Severity')}><Select value={f.severity} onChange={e => set({ severity: e.target.value as DrillingProblem['severity'] })}>{SEVERITIES.map(s => <option key={s} value={s}>{t(s)}</option>)}</Select></Field>
      </div>
      <Field label={t('Description')}><Textarea value={f.description ?? ''} onChange={e => set({ description: e.target.value })} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('Root cause')} hint={t('If known')}><Textarea value={f.root_cause ?? ''} onChange={e => set({ root_cause: e.target.value || null })} /></Field>
        {!f.id && <Field label={t('Corrective actions')} hint={t('One per line')}><Textarea value={actionsText} onChange={e => setActionsText(e.target.value)} /></Field>}
        <Field label={t('Lessons learned')}><Textarea value={f.lessons_learned ?? ''} onChange={e => set({ lessons_learned: e.target.value || null })} /></Field>
        <Field label={t('Notes')}><Textarea value={f.notes ?? ''} onChange={e => set({ notes: e.target.value || null })} /></Field>
      </div>
      {f.observed_params && <p className="text-xs text-mute">{t('Observed parameters')}: {Object.entries(f.observed_params).map(([k, v]) => `${t(paramLabel(k))} ${fmt(v, 1)}`).join(' · ')}</p>}
      <p className="text-xs text-mute">{t('Attachments can be added after saving, from the problem report.')}</p>
      {act.error && <Notice kind="error">{act.error}</Notice>}
      <div className="flex justify-end gap-2"><Button onClick={onCancel}>{t('Cancel')}</Button><Button variant="primary" onClick={save} disabled={act.busy}>{t('Save problem')}</Button></div>
    </div>
  );
}
