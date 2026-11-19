import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as repo from '../db/repo';
import { useAuth, usePrefs } from '../lib/context';
import { counted, loadCore } from '../lib/data';
import { mean, sum } from '../lib/kpi';
import { fmt, fmtDateTime } from '../lib/units';
import { axis, chartBase, EChart, PALETTE } from '../components/EChart';
import { Badge, Button, Card, Empty, Notice, PageHeader, Spinner, Stat, useAction, useAsync } from '../components/ui';
import { ALERT_BADGE } from '../components/ProblemPanels';
import { loadDemo } from '../demo/load';

export default function Home() {
  const { t, U } = usePrefs();
  const { canWrite } = useAuth();
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync(async () => {
    const [core, alerts, activity] = await Promise.all([loadCore(), repo.listAlerts(), repo.recentActivity(10)]);
    return { core, alerts, activity };
  }, []);
  const demo = useAction();

  const v = useMemo(() => {
    if (!data) return null;
    const { core } = data;
    const withData = core.summaries.filter(s => s.finalDepth != null);
    const completed = withData.filter(s => s.well.status === 'completed');
    const probs = core.problems.filter(counted);
    const totalFt = sum(withData.map(s => s.footage)), totalDrill = sum(withData.map(s => s.drillHours));
    const best = [...completed].filter(s => s.avgRop != null).sort((a, b) => b.avgRop! - a.avgRop!)[0];
    const byCat = new Map<string, { n: number; npt: number }>();
    for (const p of probs) { const k = core.cat.get(p.category_id)?.name ?? 'Other'; const e = byCat.get(k) ?? { n: 0, npt: 0 }; e.n++; e.npt += p.npt_hours; byCat.set(k, e); }
    const cats = [...byCat.entries()].sort((a, b) => a[1].n - b[1].n);
    const names = withData.map(s => s.well.name);
    const shown = withData.slice(-PALETTE.length);

    const bar = (title: string, values: (number | null)[], unit: string, color = PALETTE[0]) => chartBase({
      legend: { show: false }, grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: names, ...axis({ axisLabel: { color: '#8499ae', fontSize: 11, interval: 0, width: 90, overflow: 'truncate' } }) },
      yAxis: { type: 'value', name: unit, ...axis() },
      series: [{ type: 'bar', name: title, data: values.map(x => (x == null ? null : Math.round(x * 10) / 10)), barMaxWidth: 28, itemStyle: { color, borderRadius: [4, 4, 0, 0] }, label: { show: values.length <= 8, position: 'top', color: '#dde8f3', fontSize: 11 } }],
    });
    return {
      withData, completed, probs, best,
      avgRop: totalDrill > 0 ? totalFt / totalDrill : null,
      avgDays: mean(completed.map(s => s.days)),
      active: core.summaries.filter(s => s.well.status === 'active'),
      perf: chartBase({
        xAxis: { type: 'value', name: t('Drilling day'), nameLocation: 'middle', nameGap: 24, minInterval: 1, ...axis() },
        yAxis: { type: 'value', name: `${t('On-bottom ROP')} (${U.rl})`, ...axis() },
        grid: { left: 8, right: 16, top: 34, bottom: 26, containLabel: true },
        series: shown.map(s => ({
          type: 'line', name: s.well.name, showSymbol: false, lineStyle: { width: 2 }, itemStyle: { color: core.color(s.well.id) }, connectNulls: true,
          data: core.reports.filter(r => r.well_id === s.well.id).map(r => [r.day_number, r.avg_rop_fph == null ? null : Math.round(U.r(r.avg_rop_fph)! * 10) / 10]),
        })),
      }),
      rop: bar(t('Average ROP'), withData.map(s => U.r(s.avgRop)), U.rl),
      days: bar(t('Drilling days'), withData.map(s => s.days), t('days'), PALETTE[4]),
      cat: chartBase({
        legend: { show: false }, tooltip: { trigger: 'item' }, grid: { left: 8, right: 30, top: 8, bottom: 8, containLabel: true },
        xAxis: { type: 'value', minInterval: 1, ...axis() }, yAxis: { type: 'category', data: cats.map(c => t(c[0])), ...axis() },
        series: [{ type: 'bar', name: t('Recorded problems'), data: cats.map(c => c[1].n), barMaxWidth: 18, itemStyle: { color: PALETTE[1], borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: '#dde8f3', fontSize: 11 } }],
      }),
      npt: chartBase({
        xAxis: { type: 'category', data: names, ...axis({ axisLabel: { color: '#8499ae', fontSize: 11, interval: 0, width: 90, overflow: 'truncate' } }) },
        yAxis: { type: 'value', name: t('hours'), ...axis() },
        series: [
          { type: 'bar', stack: 'npt', name: t('NPT linked to recorded problems'), barMaxWidth: 28, itemStyle: { color: PALETTE[2], borderColor: '#0a1522', borderWidth: 1 },
            data: withData.map(s => Math.round(Math.min(s.nptHours, sum(probs.filter(p => p.well_id === s.well.id).map(p => p.npt_hours))) * 10) / 10) },
          { type: 'bar', stack: 'npt', name: t('Other NPT'), barMaxWidth: 28, itemStyle: { color: '#64748b', borderColor: '#0a1522', borderWidth: 1, borderRadius: [4, 4, 0, 0] },
            data: withData.map(s => Math.round(Math.max(0, s.nptHours - sum(probs.filter(p => p.well_id === s.well.id).map(p => p.npt_hours))) * 10) / 10) },
        ],
      }),
    };
  }, [data, t, U]);

  if (loading && !data) return <Spinner label={t('Loading…')} />;
  if (error || !data || !v) return <Notice kind="error">{error}</Notice>;
  const { core, alerts, activity } = data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('Digital Dashboard for Drilling Operations Performance Insights & Wells Time Estimation')}
        subtitle={t('Replay drilling day by day, learn from every previous well, get warned before historically problematic depths and formations, and estimate drilling time from offset performance.')}
        actions={<>
          <Button onClick={() => nav('/simulation')} variant="primary">{t('Open drilling simulation')}</Button>
          {canWrite && <Button onClick={() => nav('/add-well')}>{t('Add New Well')}</Button>}
        </>}
      />

      {core.wells.some(w => w.is_demo) && <Notice kind="warn">{t('Sample data is loaded. Wells marked "(Sample)" / DEMO are synthetic and for demonstration only - they are not real drilling data. Remove them in Settings → Data management.')}</Notice>}

      {!core.wells.length ? (
        <Empty title={t('No wells in the database yet')}
          text={t('Add a well and upload its drilling data (Excel / CSV), or load the clearly-labelled sample dataset to explore the platform.')}
          action={canWrite ? <>
            <Button variant="primary" onClick={() => nav('/add-well')}>{t('Add New Well')}</Button>
            <Button disabled={demo.busy} onClick={() => demo.run(async () => { await loadDemo(); reload(); })}>{demo.busy ? t('Loading sample data…') : t('Load sample dataset')}</Button>
          </> : undefined} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Stat label={t('Total wells')} value={core.wells.length} />
            <Stat label={t('Active drilling wells')} value={v.active.length} />
            <Stat label={t('Completed wells')} value={core.wells.filter(w => w.status === 'completed').length} />
            <Stat label={t('Recorded drilling problems')} value={v.probs.length} sub={`${core.problems.filter(p => p.status === 'anomaly').length} ${t('unreviewed anomalies')}`} />
            <Stat label={t('Average ROP')} value={U.fr(v.avgRop)} unit={U.rl} sub={t('on-bottom, all wells')} />
            <Stat label={t('Average drilling time')} value={fmt(v.avgDays, 1)} unit={t('days')} sub={t('completed wells')} />
            <Stat label={t('Best performing well')} value={<span className="text-base">{v.best?.well.name ?? '—'}</span>} sub={v.best ? `${U.fr(v.best.avgRop)} ${U.rl} · ${t('highest average ROP')}` : undefined} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card title={t('Wells currently being monitored')} className="xl:col-span-1">
              {v.active.length ? <ul className="space-y-3">{v.active.map(s => (
                <li key={s.well.id}>
                  <div className="flex items-center justify-between gap-2 text-[13px]"><Link to={`/simulation?well=${s.well.id}`} className="font-medium text-cyan-200 hover:underline">{s.well.name}</Link><span className="num text-mute">{U.fdu(s.finalDepth)} / {U.fdu(s.well.target_depth_ft)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full bg-cyan-500" style={{ width: `${s.progress ?? 0}%` }} /></div>
                  <div className="num mt-1 text-[11px] text-mute">{fmt(s.progress, 1)}% · {fmt(s.days, 1)} {t('days')} · {t('last data')} {s.lastDate ?? '—'}</div>
                </li>))}</ul> : <p className="text-[13px] text-mute">{t('No active wells.')}</p>}
            </Card>
            <Card title={t('Recent drilling alerts')} right={<Link to="/simulation" className="text-cyan-300 hover:underline">{t('Simulation')} →</Link>}>
              {alerts.length ? <ul className="space-y-2">{alerts.slice(0, 6).map(a => {
                const p = core.problems.find(x => x.id === a.problem_id);
                return (
                  <li key={a.id} className="flex items-start gap-2 text-[13px]">
                    <Badge color={ALERT_BADGE[a.level]}>{t(a.level)}</Badge>
                    <span className="min-w-0 flex-1"><b>{core.well.get(a.well_id)?.name}</b>: {t(core.cat.get(p?.category_id ?? '')?.name ?? 'Problem')} — {core.well.get(p?.well_id ?? '')?.name} @ {U.fdu(p?.md_top_ft)} · {a.similarity}%<span className="block text-[11px] text-mute">{t(a.status)} · {fmtDateTime(a.updated_at)}</span></span>
                  </li>);
              })}</ul> : <p className="text-[13px] text-mute">{t('No alerts recorded yet. Alerts are generated while a well is replayed in the drilling simulation.')}</p>}
            </Card>
            <Card title={t('Recent activities')}>
              {activity.length ? <ul className="space-y-1.5 text-[13px]">{activity.map(a => (
                <li key={a.id} className="flex gap-2"><span className="num w-28 shrink-0 text-[11px] leading-5 text-mute">{fmtDateTime(a.ts)}</span><span className="min-w-0 flex-1">{t(a.action)}{a.detail && <span className="text-mute"> — {a.detail}</span>}</span></li>
              ))}</ul> : <p className="text-[13px] text-mute">{t('No activity yet.')}</p>}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t('Drilling performance over time')} right={t('daily on-bottom ROP by drilling day')}><EChart option={v.perf} height={270} /></Card>
            <Card title={t('ROP comparison between wells')} right={`${t('footage ÷ on-bottom hours')}, ${U.rl}`}><EChart option={v.rop} height={270} /></Card>
            <Card title={t('Drilling duration comparison')} right={t('recorded days per well')}><EChart option={v.days} height={250} /></Card>
            <Card title={t('Non-Productive Time (NPT) analysis')} right={t('hours per well')}><EChart option={v.npt} height={250} /></Card>
            <Card title={t('Problem frequency by category')} right={t('confirmed and suspected problems')} className="lg:col-span-2">
              {v.probs.length ? <EChart option={v.cat} height={Math.max(160, 34 * new Set(v.probs.map(p => p.category_id)).size + 30)} /> : <p className="py-6 text-center text-[13px] text-mute">{t('No problems recorded.')}</p>}
            </Card>
          </div>
        </>
      )}
      {demo.error && <Notice kind="error">{demo.error}</Notice>}
    </div>
  );
}
