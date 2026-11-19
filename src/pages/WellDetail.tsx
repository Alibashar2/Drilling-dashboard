import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as repo from '../db/repo';
import { useAuth, usePrefs } from '../lib/context';
import { loadCore } from '../lib/data';
import { depthBasis, depthBins, progressCurve, segments } from '../lib/kpi';
import { buildWellReport, dailyCols, dailyRow, perfBy } from '../lib/reports';
import type { TrajPoint } from '../lib/survey';
import type { DrillingProblem, WellStatus } from '../lib/types';
import { fmt, fmtDateTime } from '../lib/units';
import { axis, chartBase, EChart, PALETTE } from '../components/EChart';
import { depthTracksOption } from '../components/depthTracks';
import { ProblemReport, SEV_COLOR, STATUS_COLOR } from '../components/ProblemPanels';
import { ExportButtons } from '../components/ReportView';
import RigState from '../components/RigState';
import EquipmentTab from '../components/EquipmentTab';
import Schematic from '../components/Schematic';
import { STATUS_LABEL } from '../lib/types';
import { Badge, Button, Card, cx, DataTable, Field, Input, Modal, Notice, PageHeader, Select, Spinner, Stat, Tabs, useAction, useAsync } from '../components/ui';
import { STATUS_BADGE } from './Wells';

type Tab = 'overview' | 'timeline' | 'daily' | 'formations' | 'problems' | 'parameters' | 'lessons' | 'source' | 'equipment';

/** Values read inside the imported report's cells, each with its worksheet!cell and the text as written. */
function SourceValues({ wellId }: { wellId: string }) {
  const { t } = usePrefs();
  const [key, setKey] = useState(''), [q, setQ] = useState(''), [n, setN] = useState(200);
  const { data, loading, error } = useAsync(() => repo.listExtractedParameters(wellId), [wellId]);
  const keys = useMemo(() => { const m = new Map<string, { label: string; n: number }>(); for (const r of data ?? []) { const e = m.get(r.param_key) ?? { label: r.param_label, n: 0 }; e.n++; m.set(r.param_key, e); } return [...m.entries()].sort((a, b) => b[1].n - a[1].n); }, [data]);
  const rows = useMemo(() => (data ?? []).filter(r => (!key || r.param_key === key) && (!q || `${r.original_text} ${r.source_ref} ${r.param_label}`.toLowerCase().includes(q.toLowerCase()))), [data, key, q]);
  if (loading && !data) return <Spinner label={t('Loading…')} />;
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data?.length) return <Notice>{t('No values read inside report cells are stored for this well (it was imported with column mapping, or before the in-cell reader existed).')}</Notice>;
  const th = 'border-b border-line px-2 py-1.5 text-start text-[11px] font-medium uppercase tracking-wide text-mute whitespace-nowrap', td = 'border-b border-line/40 px-2 py-1 align-top';
  return (
    <Card title={t('Values read inside the report cells')} right={`${data.length.toLocaleString()} ${t('values')}`}>
      <div className="mb-2 flex flex-wrap gap-2">
        <Select className="h-8 w-60" value={key} onChange={e => setKey(e.target.value)}><option value="">{t('All parameters')}</option>{keys.map(([k, v]) => <option key={k} value={k}>{t(v.label)} ({v.n})</option>)}</Select>
        <Input className="h-8 w-60" placeholder={t('Search text or cell…')} value={q} onChange={e => setQ(e.target.value)} />
      </div>
      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr><th className={th}>{t('Time')}</th><th className={th}>{t('Parameter')}</th><th className={th}>{t('Extracted value')}</th><th className={th}>{t('Unit')}</th><th className={th}>{t('Database value')}</th><th className={th}>{t('Context')}</th><th className={th}>{t('Source cell')}</th><th className={th}>{t('Confidence')}</th><th className={th}>{t('Original text')}</th></tr></thead>
        <tbody>{rows.slice(0, n).map(r => (
          <tr key={r.id} className={r.used ? '' : 'opacity-50'}>
            <td className={cx(td, 'num whitespace-nowrap')}>{fmtDateTime(r.occurred_at)}</td>
            <td className={td}>{t(r.param_label)}{r.qualifier && <div className="text-[10px] text-mute">{t(r.qualifier)}</div>}</td>
            <td className={cx(td, 'num')}>{r.value_text ?? (r.value_min != null && r.value_max != null ? `${fmt(r.value_min, 2)}–${fmt(r.value_max, 2)}` : fmt(r.value_num, 2))}</td>
            <td className={cx(td, 'num')}>{r.unit_raw ?? r.unit ?? '—'}</td>
            <td className={cx(td, 'num whitespace-nowrap')}>{r.value_canonical == null || r.value_text ? '—' : `${fmt(r.value_canonical, 2)} ${r.unit_canonical ?? ''}`}</td>
            <td className={td}>{t(r.context ?? '')}</td>
            <td className={td}><span className="num text-[11px] text-mute" dir="ltr">{r.source_ref}</span></td>
            <td className={td}><Badge color={r.status === 'confirmed' ? 'green' : r.status === 'suspected' ? 'yellow' : r.status === 'rejected' ? 'red' : 'cyan'}>{Math.round(r.confidence * 100)}%</Badge>{r.review && <div className="text-[10px] text-emerald-300">{t(r.review)}</div>}</td>
            <td className={cx(td, 'max-w-md text-mute')}>{r.original_text}</td>
          </tr>))}</tbody>
      </table></div>
      {rows.length > n && <div className="mt-2 text-end"><Button size="sm" onClick={() => setN(n + 400)}>{t('Show more')} ({(rows.length - n).toLocaleString()})</Button></div>}
    </Card>
  );
}

export default function WellDetail() {
  const { id = '' } = useParams();
  const { t, U } = usePrefs();
  const { canWrite, isAdmin } = useAuth();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');
  const [open, setOpen] = useState<DrillingProblem | null>(null);
  const [prog, setProg] = useState({ name: '', top: '', bottom: '' });
  const act = useAction();

  const { data, loading, error, reload } = useAsync(async () => {
    const [core, recs, survey, sections, intervals, actions] = await Promise.all([loadCore(), repo.getRecords(id), repo.getSurvey(id), repo.getSections(id), repo.getIntervals(id), repo.listActions()]);
    return { core, recs, survey, sections, intervals, actions };
  }, [id]);

  const v = useMemo(() => {
    if (!data) return null;
    const { core, recs, survey } = data;
    const well = core.well.get(id), summary = core.summaries.find(s => s.well.id === id);
    if (!well || !summary) return null;
    const reports = core.reports.filter(r => r.well_id === id), problems = core.problems.filter(p => p.well_id === id);
    const traj: TrajPoint[] = survey.map(s => ({ md: s.md_ft, inc: s.inclination_deg, azi: s.azimuth_deg, tvd: s.tvd_ft ?? s.md_ft, north: s.north_ft ?? 0, east: s.east_ft ?? 0, hd: Math.hypot(s.north_ft ?? 0, s.east_ft ?? 0) }));
    const color = core.color(id);
    return {
      well, summary, reports, problems, traj, segs: segments(recs),
      progress: chartBase({
        legend: { show: false }, grid: { left: 8, right: 16, top: 12, bottom: 24, containLabel: true },
        xAxis: { type: 'value', name: t('Days'), nameLocation: 'middle', nameGap: 22, ...axis() }, yAxis: { type: 'value', inverse: true, name: `${t('Hole Depth')} (${U.dl})`, nameLocation: 'start', ...axis() },
        series: [{ type: 'line', name: well.name, showSymbol: false, lineStyle: { width: 2, color }, itemStyle: { color }, data: progressCurve(recs).map(([d, md]) => [Math.round(d * 100) / 100, Math.round(U.d(md)!)]),
          markPoint: { symbol: 'triangle', symbolSize: 11, itemStyle: { color: '#e11d48' }, label: { show: false }, data: problems.filter(p => p.occurred_at && recs.length).map(p => ({ name: core.cat.get(p.category_id)?.name, coord: [Math.round(((new Date(p.occurred_at!).getTime() - recs[0].t) / 86400000) * 100) / 100, Math.round(U.d(p.md_top_ft)!)] })) } }],
      }),
      daily: chartBase({
        legend: { show: false }, grid: { left: 8, right: 16, top: 26, bottom: 8, containLabel: true },
        xAxis: { type: 'category', data: reports.map(r => `${t('Day')} ${r.day_number}`), ...axis() }, yAxis: { type: 'value', name: `${t('Footage')} (${U.dl})`, ...axis() },
        series: [{ type: 'bar', name: t('Footage'), data: reports.map(r => Math.round(U.d(r.footage_ft)!)), barMaxWidth: 22, itemStyle: { color: PALETTE[0], borderRadius: [4, 4, 0, 0] } }],
      }),
      dailyRop: chartBase({
        legend: { show: false }, grid: { left: 8, right: 16, top: 26, bottom: 8, containLabel: true },
        xAxis: { type: 'category', data: reports.map(r => `${t('Day')} ${r.day_number}`), ...axis() }, yAxis: { type: 'value', name: `ROP (${U.rl})`, ...axis() },
        series: [{ type: 'line', name: 'ROP', connectNulls: true, symbolSize: 8, lineStyle: { width: 2, color: PALETTE[1] }, itemStyle: { color: PALETTE[1] }, data: reports.map(r => (r.avg_rop_fph == null ? null : Math.round(U.r(r.avg_rop_fph)! * 10) / 10)) }],
      }),
      tracks: depthTracksOption([{ name: well.name, color, bins: depthBins(recs, 100) }], U, t),
      byFormation: perfBy(recs, r => r.formation_name),
    };
  }, [data, id, U, t]);

  if (loading && !data) return <Spinner label={t('Loading…')} />;
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data || !v) return <Notice kind="warn">{t('Well not found.')} <Link className="underline" to="/wells">{t('Historical Wells')}</Link></Notice>;
  const { core, recs, sections, intervals, actions } = data;
  const { well, summary: s, reports, problems } = v;
  const doc = () => buildWellReport({ well, summary: s, core, recs, actions, intervals, sections, U });
  const last = recs[recs.length - 1];

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: t('Well information') }, { id: 'timeline', label: t('Drilling timeline') }, { id: 'daily', label: t('Daily performance') },
    { id: 'formations', label: t('Formation intervals') }, { id: 'problems', label: `${t('Problems, NPT & corrective actions')} (${problems.length})` },
    { id: 'parameters', label: t('Drilling parameter charts') }, { id: 'lessons', label: t('Lessons learned') }, { id: 'equipment', label: t('Operations, tools & hole sections') }, { id: 'source', label: t('Source values') },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={<>{well.name} <Badge color={STATUS_BADGE[well.status]} className="ms-2 align-middle">{t(well.status)}</Badge>{well.is_demo && <Badge color="magenta" className="ms-2 align-middle">{t('SAMPLE DATA')}</Badge>}</>}
        subtitle={`${well.well_code} · ${well.field ?? '—'} · ${well.location ?? '—'}`}
        actions={<>
          {recs.length > 0 && <Button size="sm" variant="primary" onClick={() => nav(`/simulation?well=${well.id}`)}>{t('Open in simulation')}</Button>}
          <ExportButtons doc={doc} extraSheets={() => [{ name: 'Daily reports', columns: dailyCols(U), rows: reports.map(d => dailyRow(d, U)) }]} />
        </>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={`${t('Final Depth')} (MD)`} value={U.fd(s.finalDepth)} unit={U.dl} sub={`${t('Target depth')} ${U.fdu(well.target_depth_ft)}`} />
        <Stat label={t('Total Drilling Days')} value={fmt(s.days, 1)} />
        <Stat label={t('Average ROP')} value={U.fr(s.avgRop)} unit={U.rl} sub={t('footage ÷ on-bottom hours')} />
        <Stat label={t('Total NPT')} value={fmt(s.nptHours, 1)} unit="h" sub={s.totalHours ? `${fmt((s.nptHours / s.totalHours) * 100, 1)}% ${t('of recorded time')}` : undefined} />
        <Stat label={t('Recorded Problems')} value={s.problems} />
        <Stat label={t('Drilling records')} value={recs.length.toLocaleString()} sub={recs.length ? `${t('depth basis')}: ${t(depthBasis(recs))}` : undefined} />
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {!recs.length && tab !== 'overview' && tab !== 'problems' && tab !== 'lessons' && tab !== 'formations' && tab !== 'source' && tab !== 'equipment' && <Notice kind="warn">{t('This well has no drilling records.')}</Notice>}

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card title={t('Well information')}>
            <dl className="grid gap-x-6 text-[13px] sm:grid-cols-2">
              {[[t('Well ID'), well.well_code], [t('Field'), well.field], [t('Location'), well.location], [t('Well type'), well.well_type && t(well.well_type)], [t('Spud Date'), String(well.spud_date ?? '').slice(0, 10)],
                [t('Planned completion date'), String(well.planned_completion_date ?? '').slice(0, 10)], [t('Completion Date'), String(well.completion_date ?? '').slice(0, 10)], [t('Target depth'), U.fdu(well.target_depth_ft)],
                [t('Hole Size'), well.hole_size_in != null ? `${well.hole_size_in} in` : null], [t('Depth unit of source data'), well.source_depth_unit], [t('Last record'), last ? fmtDateTime(last.t) : null], [t('Notes'), well.notes],
              ].map(([k, val]) => <div key={k as string} className="flex gap-3 border-b border-line/50 py-1.5"><dt className="w-44 shrink-0 text-mute">{k}</dt><dd className="min-w-0 flex-1 break-words">{val || '—'}</dd></div>)}
            </dl>
            {canWrite && (
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <Field label={t('Well status')} className="w-44"><Select value={well.status} disabled={act.busy} onChange={e => act.run(async () => { const st = e.target.value as WellStatus; await repo.updateWell(well.id, { status: st, completion_date: st === 'completed' ? (well.completion_date ?? s.lastDate) : null }); reload(); })}>
                  {(['planned', 'active', 'completed'] as const).map(x => <option key={x} value={x}>{t(x)}</option>)}</Select></Field>
                <div className="flex-1" />
                {isAdmin && <Button variant="danger" size="sm" disabled={act.busy} onClick={() => { if (confirm(`${t('Delete this well and ALL of its records, problems and alerts permanently?')}\n${well.name}`)) act.run(async () => { await repo.deleteWell(well); nav('/wells'); }); }}>{t('Delete well')}</Button>}
              </div>
            )}
            {act.error && <Notice kind="error" className="mt-3">{act.error}</Notice>}
          </Card>
          <Card title={t('Wellbore Schematic')} right={t('final state')}>
            <Schematic traj={v.traj} holeDepth={s.finalDepth ?? 0} bitDepth={null} targetDepth={well.target_depth_ft} shoes={sections.map(x => x.bottom_md_ft)} height={320} />
            <table className="mt-2 w-full text-xs"><thead><tr className="text-mute"><th className="py-1 text-start font-medium">{t('Section')}</th><th className="text-end font-medium">BHA</th><th className="text-end font-medium">{t('Top')} ({U.dl})</th><th className="text-end font-medium">{t('Bottom')} ({U.dl})</th></tr></thead>
              <tbody>{sections.map(x => <tr key={x.id} className="num border-t border-line/50"><td className="py-1">{x.name}</td><td className="text-end">{x.bha_number ?? '—'}</td><td className="text-end">{U.fd(x.top_md_ft)}</td><td className="text-end">{U.fd(x.bottom_md_ft)}</td></tr>)}</tbody></table>
          </Card>
        </div>
      )}

      {tab === 'timeline' && recs.length > 0 && (
        <div className="space-y-4">
          <Card title={t('Rig State')} right={t('Entire well')}><RigState segs={v.segs} t0={recs[0].t} t1={last.t + 1} /></Card>
          <Card title={t('Depth vs time')} right={t('red markers = recorded problems')}><EChart option={v.progress} height={320} /></Card>
        </div>
      )}

      {tab === 'daily' && recs.length > 0 && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t('Daily footage')}><EChart option={v.daily} height={230} /></Card>
            <Card title={t('Daily on-bottom ROP')}><EChart option={v.dailyRop} height={230} /></Card>
          </div>
          <Card title={t('Daily drilling performance')} pad={false}>
            <div className="overflow-x-auto px-2 pb-2"><table className="w-full text-xs"><thead><tr>{dailyCols(U).map(c => <th key={c} className="border-b border-line px-2 py-1.5 text-start font-medium whitespace-nowrap text-mute">{t(c)}</th>)}</tr></thead>
              <tbody>{reports.map(d => <tr key={d.day_number} className="border-b border-line/40">{dailyRow(d, U).map((c, j) => <td key={j} className={typeof c === 'number' ? 'num px-2 py-1 text-end' : 'px-2 py-1 whitespace-nowrap'}>{c == null ? '—' : typeof c === 'number' ? c.toLocaleString('en-US') : c}</td>)}</tr>)}</tbody></table></div>
          </Card>
        </div>
      )}

      {tab === 'formations' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('Formation intervals')} pad={false}>
            <DataTable dense rowKey={(r, i) => r.id ?? String(i)} rows={intervals} empty={t('No formation data. Map a Formation column on import, or add prognosed tops below.')} columns={[
              { key: 'f', label: t('Formation'), value: r => r.formation_name },
              { key: 't', label: `${t('Top')} MD (${U.dl})`, align: 'end', value: r => r.top_md_ft, render: r => U.fd(r.top_md_ft) },
              { key: 'b', label: `${t('Bottom')} MD (${U.dl})`, align: 'end', value: r => r.bottom_md_ft, render: r => U.fd(r.bottom_md_ft) },
              { key: 'tt', label: `${t('Top')} TVD (${U.dl})`, align: 'end', render: r => U.fd(r.top_tvd_ft) },
              { key: 's', label: t('Source'), render: r => <Badge color={r.is_prognosis ? 'yellow' : 'cyan'}>{t(r.is_prognosis ? 'Prognosis' : 'Drilled')}</Badge> },
              ...(canWrite ? [{ key: 'x', label: '', render: (r: typeof intervals[number]) => r.is_prognosis ? <button className="text-xs text-rose-300 hover:underline" onClick={() => act.run(async () => { await repo.removeInterval(r.id!); reload(); })}>{t('Remove')}</button> : null }] : []),
            ]} />
            {canWrite && (
              <div className="border-t border-line p-3">
                <p className="mb-2 text-xs text-mute">{t('Add a prognosed formation top ahead of the bit. Prognosed tops let formation-based alerts fire before the formation is reached.')}</p>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t('Formation')} className="w-44"><Input value={prog.name} onChange={e => setProg({ ...prog, name: e.target.value })} /></Field>
                  <Field label={`${t('Top')} MD (${U.dl})`} className="w-28"><Input value={prog.top} onChange={e => setProg({ ...prog, top: e.target.value })} inputMode="decimal" /></Field>
                  <Field label={`${t('Bottom')} MD (${U.dl})`} className="w-28"><Input value={prog.bottom} onChange={e => setProg({ ...prog, bottom: e.target.value })} inputMode="decimal" /></Field>
                  <Button disabled={act.busy} onClick={() => act.run(async () => {
                    const top = Number(prog.top), bottom = Number(prog.bottom);
                    if (!prog.name.trim() || !prog.top || !prog.bottom || isNaN(top) || isNaN(bottom) || bottom <= top) throw new Error(t('Enter a formation name and a top depth shallower than the bottom depth.'));
                    await repo.addPrognosis(well.id, [{ formation_name: prog.name.trim(), top_md_ft: U.toFt(top), bottom_md_ft: U.toFt(bottom) }]);
                    setProg({ name: '', top: '', bottom: '' }); reload();
                  })}>{t('Add')}</Button>
                </div>
                {act.error && <Notice kind="error" className="mt-2">{act.error}</Notice>}
              </div>
            )}
          </Card>
          <Card title={t('Performance by formation')} pad={false}>
            <DataTable dense rowKey={r => r.key} rows={v.byFormation} columns={[
              { key: 'f', label: t('Formation'), value: r => r.key },
              { key: 'ft', label: `${t('Footage')} (${U.dl})`, align: 'end', value: r => r.b.footage, render: r => U.fd(r.b.footage) },
              { key: 'rop', label: `ROP (${U.rl})`, align: 'end', value: r => r.b.rop, render: r => U.fr(r.b.rop) },
              { key: 'h', label: t('Drilling h'), align: 'end', value: r => r.b.drillHours, render: r => fmt(r.b.drillHours, 1) },
              { key: 'npt', label: 'NPT h', align: 'end', value: r => r.b.nptHours, render: r => fmt(r.b.nptHours, 1) },
            ]} />
          </Card>
        </div>
      )}

      {tab === 'problems' && (
        <Card pad={false}>
          <DataTable rowKey={p => p.id} rows={problems} onRowClick={setOpen} empty={t('No problems recorded for this well.')} columns={[
            { key: 'c', label: t('Problem category'), value: p => core.cat.get(p.category_id)?.name, render: p => <span className="font-medium">{t(core.cat.get(p.category_id)?.name ?? '')}</span> },
            { key: 'st', label: t('Classification'), value: p => p.status, render: p => <Badge color={STATUS_COLOR[p.status]}>{t(STATUS_LABEL[p.status])}</Badge> },
            { key: 'sev', label: t('Severity'), value: p => p.severity, render: p => <Badge color={SEV_COLOR[p.severity]}>{t(p.severity)}</Badge> },
            { key: 'md', label: `MD (${U.dl})`, align: 'end', value: p => p.md_top_ft, render: p => U.fd(p.md_top_ft) },
            { key: 'f', label: t('Formation'), value: p => p.formation_name },
            { key: 'npt', label: 'NPT (h)', align: 'end', value: p => p.npt_hours, render: p => fmt(p.npt_hours, 1) },
            { key: 'd', label: t('Description'), render: p => <span className="line-clamp-2 max-w-md text-mute">{p.description}</span> },
            { key: 'a', label: t('Corrective actions'), render: p => <ul className="max-w-sm list-disc ps-4 text-xs text-mute">{actions.filter(a => a.problem_id === p.id).map(a => <li key={a.id}>{a.action_text}</li>)}</ul> },
          ]} />
        </Card>
      )}

      {tab === 'parameters' && recs.length > 0 && (
        <Card title={t('Drilling parameters vs depth')} right={t('on-bottom averages per 100 ft of hole · scroll to zoom depth')}><EChart option={v.tracks} height={560} /></Card>
      )}

      {tab === 'lessons' && (
        <Card title={t('Lessons learned')}>
          {problems.filter(p => p.lessons_learned).length ? <ul className="space-y-3">{problems.filter(p => p.lessons_learned).map(p => (
            <li key={p.id} className="border-b border-line/50 pb-3 text-[13px]"><div className="flex flex-wrap items-center gap-2"><b>{t(core.cat.get(p.category_id)?.name ?? '')}</b><span className="num text-xs text-mute">@ {U.fdu(p.md_top_ft)} · {p.formation_name ?? '—'}</span></div>
              <p className="mt-1">{p.lessons_learned}</p>{p.root_cause && <p className="mt-1 text-xs text-mute">{t('Root cause')}: {p.root_cause}</p>}</li>))}</ul>
            : <p className="text-[13px] text-mute">{t('No lessons recorded for this well yet. Add them to a problem record.')}</p>}
        </Card>
      )}

      {tab === 'source' && <SourceValues wellId={well.id} />}
      {tab === 'equipment' && <EquipmentTab wellId={well.id} U={U} />}

      <Modal open={!!open} onClose={() => setOpen(null)} title={t('Problem report')} wide>
        {open && <ProblemReport problem={open} well={well} category={core.cat.get(open.category_id)} onChanged={() => { setOpen(null); reload(); }} />}
      </Modal>
    </div>
  );
}
