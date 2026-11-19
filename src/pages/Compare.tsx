import { useMemo, useState } from 'react';
import * as repo from '../db/repo';
import { useAuth, usePrefs } from '../lib/context';
import { counted, loadCore } from '../lib/data';
import { progressCurve } from '../lib/kpi';
import { buildOffset, perfBy } from '../lib/reports';
import type { Rec } from '../lib/types';
import { fmt } from '../lib/units';
import { axis, chartBase, EChart } from '../components/EChart';
import { CompareExplorer } from '../components/CompareExplorer';
import { ExportButtons } from '../components/ReportView';
import { Button, Card, Chips, DataTable, Empty, Input, Notice, PageHeader, Spinner, useAction, useAsync } from '../components/ui';

const MAX = 6;

export default function Compare() {
  const { t, U } = usePrefs();
  const { canWrite } = useAuth();
  const base = useAsync(async () => {
    const [core, formations, saved] = await Promise.all([loadCore(), repo.listFormations(), repo.listComparisons()]);
    return { core, canon: repo.canonResolver(formations), saved };
  }, []);
  const withData = useMemo(() => base.data?.core.summaries.filter(s => s.finalDepth != null) ?? [], [base.data]);
  const [sel, setSel] = useState<string[] | null>(null);
  const [name, setName] = useState('');
  const act = useAction();
  const ids = useMemo(() => (sel ?? withData.slice(0, 4).map(s => s.well.id)).slice(0, MAX), [sel, withData]);
  const recs = useAsync(async () => new Map<string, Rec[]>(await Promise.all(ids.map(async id => [id, await repo.getRecords(id)] as [string, Rec[]]))), [ids.join(',')]);

  const v = useMemo(() => {
    if (!base.data || !recs.data) return null;
    const { core, canon } = base.data;
    const ss = ids.map(id => core.summaries.find(s => s.well.id === id)!).filter(Boolean).filter(s => recs.data!.has(s.well.id));
    if (!ss.length) return null;
    const R = (id: string) => recs.data!.get(id) ?? [];
    const grouped = (title: string, keys: string[], get: (id: string, key: string) => number | null, unit: string) => chartBase({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#0b1826', borderColor: '#22364b', textStyle: { color: '#dde8f3', fontSize: 12 } },
      xAxis: { type: 'category', data: keys, ...axis({ axisLabel: { color: '#8499ae', fontSize: 11, interval: 0, width: 100, overflow: 'truncate' } }) }, yAxis: { type: 'value', name: unit, ...axis() },
      series: ss.map(s => ({ type: 'bar', name: s.well.name, barMaxWidth: 18, barGap: '12%', itemStyle: { color: core.color(s.well.id), borderRadius: [3, 3, 0, 0] }, data: keys.map(k => { const x = get(s.well.id, k); return x == null ? null : Math.round(x * 10) / 10; }) })),
    });
    // formations: merge equivalent names through the manual mapping
    const fperf = new Map(ss.map(s => [s.well.id, perfBy(R(s.well.id), r => canon(r.formation_name))]));
    const fLabel = new Map<string, string>();
    for (const s of ss) for (const r of R(s.well.id)) { const c = canon(r.formation_name); if (c && !fLabel.has(c)) fLabel.set(c, r.formation_name!); }
    const fKeys = [...fLabel.keys()];
    const sperf = new Map(ss.map(s => [s.well.id, perfBy(R(s.well.id), r => (r.hole_size_in ?? s.well.hole_size_in)?.toString() ?? null)]));
    const sKeys = [...new Set([...sperf.values()].flatMap(x => x.map(y => y.key)))].sort((a, b) => Number(b) - Number(a));
    const single = (title: string, vals: (number | null)[], unit: string) => chartBase({
      legend: { show: false }, grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: ss.map(s => s.well.name), ...axis({ axisLabel: { color: '#8499ae', fontSize: 11, interval: 0, width: 90, overflow: 'truncate' } }) }, yAxis: { type: 'value', name: unit, ...axis() },
      series: [{ type: 'bar', name: title, barMaxWidth: 26, data: vals.map((x, i) => ({ value: x == null ? null : Math.round(x * 10) / 10, itemStyle: { color: core.color(ss[i].well.id), borderRadius: [4, 4, 0, 0] } })), label: { show: true, position: 'top', color: '#dde8f3', fontSize: 11 } }],
    });
    const best = (f: (s: (typeof ss)[number]) => number | null, lowest = false) => [...ss].filter(s => f(s) != null).sort((a, b) => (lowest ? f(a)! - f(b)! : f(b)! - f(a)!))[0];
    const fastest = best(s => s.avgRop), shortest = best(s => (s.well.status === 'completed' ? s.days : null), true), leastNpt = best(s => s.nptHours, true), mostProb = best(s => s.problems);
    return {
      ss,
      progress: chartBase({
        grid: { left: 8, right: 16, top: 34, bottom: 24, containLabel: true },
        xAxis: { type: 'value', name: t('Drilling days'), nameLocation: 'middle', nameGap: 22, min: 0, ...axis() }, yAxis: { type: 'value', inverse: true, name: `${t('Hole Depth')} (${U.dl})`, nameLocation: 'start', ...axis() },
        series: ss.map(s => ({ type: 'line', name: s.well.name, showSymbol: false, lineStyle: { width: 2, color: core.color(s.well.id) }, itemStyle: { color: core.color(s.well.id) }, data: progressCurve(R(s.well.id), 300).map(([d, md]) => [Math.round(d * 100) / 100, Math.round(U.d(md)!)]) })),
      }),
      explorer: ss.map(s => ({ well: s.well, color: core.color(s.well.id), recs: R(s.well.id) })),
      byFormation: grouped('ROP', fKeys.map(k => fLabel.get(k)!), (id, label) => { const k = fKeys.find(x => fLabel.get(x) === label); return U.r(fperf.get(id)!.find(x => x.key === k)?.b.rop ?? null); }, U.rl),
      bySection: grouped('ROP', sKeys.map(k => `${k}"`), (id, label) => U.r(sperf.get(id)!.find(x => `${x.key}"` === label)?.b.rop ?? null), U.rl),
      sectionDays: grouped('Days', sKeys.map(k => `${k}"`), (id, label) => { const b = sperf.get(id)!.find(x => `${x.key}"` === label)?.b; return b ? b.totalHours / 24 : null; }, t('days')),
      npt: single('NPT', ss.map(s => s.nptHours), 'h'),
      probs: single(t('Problems'), ss.map(s => core.problems.filter(p => p.well_id === s.well.id && counted(p)).length), ''),
      summary: [
        fastest && `${fastest.well.name} ${t('has the highest average on-bottom ROP')} (${U.fr(fastest.avgRop)} ${U.rl}).`,
        shortest && `${shortest.well.name} ${t('is the shortest completed well')} (${fmt(shortest.days, 1)} ${t('days')}).`,
        leastNpt && `${leastNpt.well.name} ${t('has the least NPT')} (${fmt(leastNpt.nptHours, 1)} h).`,
        mostProb && mostProb.problems > 0 && `${mostProb.well.name} ${t('has the most recorded problems')} (${mostProb.problems}).`,
        ss.some(s => s.well.status !== 'completed') && t('Note: wells still being drilled are compared on data recorded so far.'),
      ].filter(Boolean) as string[],
    };
  }, [base.data, recs.data, ids, U, t]);

  if (base.loading && !base.data) return <Spinner label={t('Loading…')} />;
  if (base.error || !base.data) return <Notice kind="error">{base.error}</Notice>;
  const { core, saved } = base.data;
  if (withData.length < 2) return <><PageHeader title={t('Well Comparison')} /><Empty title={t('At least two wells with drilling data are needed for a comparison.')} /></>;

  return (
    <div className="space-y-4">
      <PageHeader title={t('Well Comparison')} subtitle={t('Select two or more wells. All figures are calculated from their stored drilling records.')}
        actions={v && recs.data && <ExportButtons doc={() => buildOffset(core, ids, recs.data!, U)} />} />
      <Card title={t('Wells to compare')} right={`${ids.length} ${t('selected')} · ${t('max')} ${MAX}`}>
        <Chips options={withData.map(s => ({ id: s.well.id, label: s.well.name, color: core.color(s.well.id) }))} value={ids} onChange={x => setSel(x.slice(0, MAX))} />
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
          <span className="text-mute">{t('Saved comparisons')}:</span>
          {saved.map(c => <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5"><button className="hover:text-cyan-200" onClick={() => setSel(c.well_ids.filter(i => core.well.has(i)))}>{c.name}</button>{canWrite && <button aria-label={t('Delete')} className="text-mute hover:text-rose-300" onClick={() => act.run(async () => { await repo.deleteComparison(c.id); base.reload(); })}>×</button>}</span>)}
          {!saved.length && <span className="text-mute">{t('none')}</span>}
          {canWrite && <><Input className="h-7 w-44 text-xs" placeholder={t('Name this comparison')} value={name} onChange={e => setName(e.target.value)} />
            <Button size="sm" disabled={!name.trim() || ids.length < 2 || act.busy} onClick={() => act.run(async () => { await repo.saveComparison(name.trim(), ids); setName(''); base.reload(); })}>{t('Save')}</Button></>}
        </div>
        {act.error && <Notice kind="error" className="mt-2">{act.error}</Notice>}
      </Card>

      {ids.length < 2 ? <Notice kind="warn">{t('Select at least two wells.')}</Notice> : !v ? <Spinner label={t('Loading drilling records…')} /> : (
        <>
          <Card title={t('Comparison summary')}>
            <ul className="mb-3 list-disc space-y-0.5 ps-5 text-[13px]">{v.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
            <DataTable dense rowKey={s => s.well.id} rows={v.ss} columns={[
              { key: 'w', label: t('Well'), value: s => s.well.name, render: s => <span className="inline-flex items-center gap-2 font-medium"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: core.color(s.well.id) }} />{s.well.name}</span> },
              { key: 'ty', label: t('Well type'), value: s => s.well.well_type },
              { key: 'd', label: `${t('Final Depth')} (${U.dl})`, align: 'end', value: s => s.finalDepth, render: s => U.fd(s.finalDepth) },
              { key: 'days', label: t('Drilling days'), align: 'end', value: s => s.days, render: s => fmt(s.days, 1) },
              { key: 'rop', label: `${t('Average ROP')} (${U.rl})`, align: 'end', value: s => s.avgRop, render: s => U.fr(s.avgRop) },
              { key: 'dh', label: t('Drilling h'), align: 'end', value: s => s.drillHours, render: s => fmt(s.drillHours, 1) },
              { key: 'npt', label: 'NPT (h)', align: 'end', value: s => s.nptHours, render: s => fmt(s.nptHours, 1) },
              { key: 'nptp', label: 'NPT %', align: 'end', value: s => (s.totalHours ? s.nptHours / s.totalHours : null), render: s => (s.totalHours ? fmt((s.nptHours / s.totalHours) * 100, 1) : '—') },
              { key: 'p', label: t('Recorded Problems'), align: 'end', value: s => s.problems },
            ]} />
          </Card>
          <Card title={t('Drilling progress')} right={t('hole depth vs drilling days')}><EChart option={v.progress} height={340} /></Card>
          <CompareExplorer wells={v.explorer} core={core} canon={base.data.canon} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t('Performance by formation')} right={`ROP, ${U.rl}`}><EChart option={v.byFormation} height={280} /></Card>
            <Card title={t('Performance by hole section')} right={`ROP, ${U.rl}`}><EChart option={v.bySection} height={280} /></Card>
            <Card title={t('Time per hole section')} right={t('days, all activities')}><EChart option={v.sectionDays} height={260} /></Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card title="NPT" right={t('hours')}><EChart option={v.npt} height={222} /></Card>
              <Card title={t('Problem frequency')} right={t('confirmed and suspected problems')}><EChart option={v.probs} height={222} /></Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
