import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import * as repo from '../db/repo';
import { useAuth, usePrefs } from '../lib/context';
import { detectAnomalies, type AnomalyCandidate } from '../lib/anomaly';
import { loadCore } from '../lib/data';
import { groupBy } from '../lib/kpi';
import { buildProblems } from '../lib/reports';
import { SEVERITIES, STATUS_LABEL, type DrillingProblem, type ProblemStatus } from '../lib/types';
import { fmt, fmtDateTime } from '../lib/units';
import { ProblemForm, ProblemReport, SEV_COLOR, STATUS_COLOR } from '../components/ProblemPanels';
import { ExportButtons } from '../components/ReportView';
import { Badge, Button, Card, DataTable, Empty, Input, Modal, Notice, PageHeader, Select, Spinner, Tabs, useAction, useAsync } from '../components/ui';

type Tab = 'register' | 'anomalies' | 'lessons';

export default function Problems() {
  const { t, U } = usePrefs();
  const { canWrite } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => ({ core: await loadCore(), actions: await repo.listActions() }), []);
  const [tab, setTab] = useState<Tab>('register');
  const [f, setF] = useState({ well: '', cat: '', status: '', sev: '', q: '' });
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<DrillingProblem> | null>(null);
  const [scanWell, setScanWell] = useState('');
  const [cands, setCands] = useState<{ wellId: string; list: AnomalyCandidate[] } | null>(null);
  const scan = useAction();

  const rows = useMemo(() => (data?.core.problems ?? []).filter(p =>
    (!f.well || p.well_id === f.well) && (!f.cat || p.category_id === f.cat) && (!f.status || p.status === f.status) && (!f.sev || p.severity === f.sev) &&
    (!f.q || `${p.problem_code} ${p.description} ${p.formation_name} ${p.root_cause} ${p.lessons_learned}`.toLowerCase().includes(f.q.toLowerCase()))), [data, f]);

  if (loading && !data) return <Spinner label={t('Loading…')} />;
  if (error || !data) return <Notice kind="error">{error}</Notice>;
  const { core, actions } = data;
  const sel = core.problems.find(p => p.id === open);
  const withData = core.summaries.filter(s => s.finalDepth != null);
  const lessons = core.problems.filter(p => p.status !== 'dismissed' && (p.lessons_learned || p.root_cause) && (!f.q || `${p.lessons_learned} ${p.root_cause} ${p.formation_name}`.toLowerCase().includes(f.q.toLowerCase())));

  const runScan = () => scan.run(async () => {
    const id = scanWell || withData[0]?.well.id;
    if (!id) throw new Error(t('No well with drilling data.'));
    setCands({ wellId: id, list: detectAnomalies(await repo.getRecords(id)) });
  });
  const saveCand = (c: AnomalyCandidate, wellId: string) => scan.run(async () => {
    const well = core.well.get(wellId)!, recs = await repo.getRecords(wellId), r = recs[c.idx];
    await repo.saveProblem({
      well_id: wellId, category_id: core.categories.find(x => x.code === c.suggestedCategory)!.id, occurred_at: new Date(c.t0).toISOString(), md_top_ft: c.mdTop, md_bottom_ft: c.mdBottom,
      tvd_ft: r?.tvd_ft ?? null, formation_name: r?.formation_name ?? null, hole_size_in: r?.hole_size_in ?? well.hole_size_in, bha_number: r?.bha_number ?? null, activity_code: r?.activity_code ?? null,
      description: `${c.rule}: ${c.evidence}.`, observed_params: c.observed, status: 'anomaly', source: 'auto', severity: 'low',
      notes: 'Detected automatically by a parameter rule. Not a confirmed drilling problem - the category is a suggestion only.',
    }, well);
    reload();
  });
  const saved = (c: AnomalyCandidate, wellId: string) => core.problems.some(p => p.well_id === wellId && p.source === 'auto' && Math.abs(p.md_top_ft - c.mdTop) < 0.5 && p.description.startsWith(c.rule));

  return (
    <div className="space-y-4">
      <PageHeader title={t('Problems & Lessons Learned')} subtitle={t('Central register of drilling problems from every well. Detected anomalies, suspected problems and engineer-confirmed events are kept distinct.')}
        actions={<>
          <ExportButtons doc={() => buildProblems(core, f.well ? [f.well] : core.wells.map(w => w.id), actions, U)} />
          {canWrite && core.wells.length > 0 && <Button variant="primary" onClick={() => setForm({ well_id: f.well || core.wells[0].id })}><Plus size={15} />{t('Record a problem')}</Button>}
        </>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(['confirmed', 'suspected', 'anomaly', 'dismissed'] as ProblemStatus[]).map(s => (
          <button key={s} onClick={() => { setTab('register'); setF({ ...f, status: f.status === s ? '' : s }); }} className="rounded-md border border-line bg-panel2/60 px-3 py-2.5 text-start hover:border-slate-500">
            <div className="text-[11px] text-mute">{t(STATUS_LABEL[s])}</div><div className="num text-xl font-semibold">{core.problems.filter(p => p.status === s).length}</div>
          </button>))}
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'register', label: t('Problem register') }, { id: 'anomalies', label: t('Anomaly scan') }, { id: 'lessons', label: t('Lessons learned') }]} />

      {tab !== 'anomalies' && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1"><Search size={14} className="absolute start-2.5 top-2.5 text-mute" /><Input className="ps-8" placeholder={t('Search description, formation, root cause, lessons')} value={f.q} onChange={e => setF({ ...f, q: e.target.value })} /></div>
          {tab === 'register' && <>
            <Select className="w-44" aria-label={t('Well')} value={f.well} onChange={e => setF({ ...f, well: e.target.value })}><option value="">{t('All wells')}</option>{core.wells.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
            <Select className="w-48" aria-label={t('Problem category')} value={f.cat} onChange={e => setF({ ...f, cat: e.target.value })}><option value="">{t('All categories')}</option>{core.categories.map(c => <option key={c.id} value={c.id}>{t(c.name)}</option>)}</Select>
            <Select className="w-44" aria-label={t('Classification')} value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">{t('All classifications')}</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</Select>
            <Select className="w-36" aria-label={t('Severity')} value={f.sev} onChange={e => setF({ ...f, sev: e.target.value })}><option value="">{t('All severities')}</option>{SEVERITIES.map(s => <option key={s} value={s}>{t(s)}</option>)}</Select>
          </>}
        </div>
      )}

      {tab === 'register' && (
        <Card pad={false}>
          <DataTable rowKey={p => p.id} rows={rows} onRowClick={p => setOpen(p.id)} empty={t('No problems match the filters')} columns={[
            { key: 'id', label: t('Problem ID'), value: p => p.problem_code, className: 'num text-xs text-mute whitespace-nowrap' },
            { key: 'w', label: t('Well'), value: p => core.well.get(p.well_id)?.name },
            { key: 'c', label: t('Problem category'), value: p => core.cat.get(p.category_id)?.name, render: p => <span className="font-medium">{t(core.cat.get(p.category_id)?.name ?? '')}</span> },
            { key: 'st', label: t('Classification'), value: p => p.status, render: p => <Badge color={STATUS_COLOR[p.status]}>{t(STATUS_LABEL[p.status])}</Badge> },
            { key: 'sev', label: t('Severity'), value: p => SEVERITIES.indexOf(p.severity), render: p => <Badge color={SEV_COLOR[p.severity]}>{t(p.severity)}</Badge> },
            { key: 'dt', label: t('Date and time'), value: p => p.occurred_at, render: p => <span className="num whitespace-nowrap">{fmtDateTime(p.occurred_at)}</span> },
            { key: 'md', label: `MD (${U.dl})`, align: 'end', value: p => p.md_top_ft, render: p => U.fd(p.md_top_ft) },
            { key: 'tvd', label: `TVD (${U.dl})`, align: 'end', value: p => p.tvd_ft, render: p => U.fd(p.tvd_ft) },
            { key: 'f', label: t('Formation'), value: p => p.formation_name },
            { key: 'hs', label: `${t('Hole Size')} (in)`, align: 'end', value: p => p.hole_size_in },
            { key: 'npt', label: 'NPT (h)', align: 'end', value: p => p.npt_hours, render: p => fmt(p.npt_hours, 1) },
          ]} />
        </Card>
      )}

      {tab === 'anomalies' && (
        <Card title={t('Rule-based anomaly detection')}>
          <Notice className="mb-3">{t('The scan compares on-bottom drilling parameters with their recent trend (ROP, torque and standpipe pressure rules). Results are detected anomalies only. Nothing is classified as a drilling problem until an engineer reviews it and marks it suspected or confirmed.')}</Notice>
          {!withData.length ? <Empty title={t('No well with drilling data.')} /> : <>
            <div className="flex flex-wrap items-end gap-2">
              <Select className="w-64" aria-label={t('Well')} value={scanWell || withData[0].well.id} onChange={e => { setScanWell(e.target.value); setCands(null); }}>{withData.map(s => <option key={s.well.id} value={s.well.id}>{s.well.name}</option>)}</Select>
              <Button variant="primary" onClick={runScan} disabled={scan.busy}>{scan.busy ? t('Scanning…') : t('Scan drilling data')}</Button>
            </div>
            {scan.error && <Notice kind="error" className="mt-3">{scan.error}</Notice>}
            {cands && (
              <div className="mt-3">
                <p className="mb-2 text-[13px] text-mute">{cands.list.length} {t('anomaly candidate(s) found in')} {core.well.get(cands.wellId)?.name}</p>
                <DataTable dense rowKey={(c, i) => `${c.rule}-${i}`} rows={cands.list} empty={t('No anomalies detected by the current rules.')} columns={[
                  { key: 'r', label: t('Rule'), value: c => c.rule, render: c => <span className="font-medium">{t(c.rule)}</span> },
                  { key: 't', label: t('Date and time'), value: c => c.t0, render: c => <span className="num whitespace-nowrap">{fmtDateTime(c.t0)}</span> },
                  { key: 'md', label: `MD (${U.dl})`, align: 'end', value: c => c.mdTop, render: c => `${U.fd(c.mdTop)} – ${U.fd(c.mdBottom)}` },
                  { key: 'e', label: t('Evidence'), render: c => <span className="text-xs text-mute">{c.evidence}</span> },
                  { key: 's', label: t('Suggested category'), render: c => <span className="text-xs">{t(core.categories.find(x => x.code === c.suggestedCategory)?.name ?? '')}</span> },
                  { key: 'a', label: '', render: c => saved(c, cands.wellId) ? <Badge color="green">{t('Saved')}</Badge> : canWrite ? <Button size="sm" disabled={scan.busy} onClick={() => saveCand(c, cands.wellId)}>{t('Save as detected anomaly')}</Button> : null },
                ]} />
              </div>
            )}
          </>}
        </Card>
      )}

      {tab === 'lessons' && (
        lessons.length ? <div className="grid gap-4 lg:grid-cols-2">{[...groupBy(lessons, p => core.cat.get(p.category_id)?.name ?? 'Other').entries()].map(([cat, ps]) => (
          <Card key={cat} title={t(cat)} right={`${ps.length}`}>
            <ul className="space-y-3">{ps.map(p => (
              <li key={p.id} className="border-b border-line/50 pb-2 text-[13px] last:border-0">
                <button className="text-start hover:text-cyan-200" onClick={() => setOpen(p.id)}>
                  <span className="text-xs text-mute">{core.well.get(p.well_id)?.name} · <span className="num">{U.fdu(p.md_top_ft)}</span> · {p.formation_name ?? '—'} · <Badge color={STATUS_COLOR[p.status]}>{t(STATUS_LABEL[p.status])}</Badge></span>
                  {p.lessons_learned && <span className="mt-1 block">{p.lessons_learned}</span>}
                  {p.root_cause && <span className="mt-0.5 block text-xs text-mute">{t('Root cause')}: {p.root_cause}</span>}
                </button>
                <ul className="mt-1 list-disc ps-5 text-xs text-mute">{actions.filter(a => a.problem_id === p.id).map(a => <li key={a.id}>{a.action_text}</li>)}</ul>
              </li>))}</ul>
          </Card>))}</div> : <Empty title={t('No lessons recorded yet')} text={t('Lessons learned and root causes entered on problem records appear here, grouped by problem category.')} />
      )}

      <Modal open={!!sel} onClose={() => setOpen(null)} title={t('Problem report')} wide>
        {sel && <ProblemReport problem={sel} well={core.well.get(sel.well_id)} category={core.cat.get(sel.category_id)} onChanged={() => { setOpen(null); reload(); }} onEdit={() => { setForm(sel); setOpen(null); }} />}
      </Modal>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t('Edit problem') : t('Record a problem')} wide>
        {form && <ProblemForm wells={core.wells} categories={core.categories} initial={form} onCancel={() => setForm(null)} onSaved={() => { setForm(null); reload(); }} />}
      </Modal>
    </div>
  );
}
