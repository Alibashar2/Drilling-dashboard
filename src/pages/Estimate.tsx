import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import * as repo from '../db/repo';
import { useAuth, usePrefs } from '../lib/context';
import { loadCore } from '../lib/data';
import { ESTIMATORS, offsetSectionStats, type EstimateResult, type OffsetSectionStat } from '../lib/estimate';
import { buildEstimateReport } from '../lib/reports';
import { WELL_TYPES } from '../lib/types';
import { fmt } from '../lib/units';
import { axis, chartBase, EChart, PALETTE } from '../components/EChart';
import { ExportButtons } from '../components/ReportView';
import { Badge, Button, Card, Chips, DataTable, Empty, Field, Input, Notice, PageHeader, Select, Spinner, Stat, useAction, useAsync } from '../components/ui';

interface Row { size: string; top: string; bottom: string }
const CONF = { High: 'green', Medium: 'yellow', Low: 'orange', 'Insufficient data': 'red' } as const;
const PARTS = [['drilling', 'On-bottom drilling'], ['connection', 'Connections'], ['circulation', 'Circulation'], ['tripping', 'Tripping'], ['other', 'Other operations'], ['npt', 'Estimated NPT']] as const;

export default function Estimate() {
  const { t, U } = usePrefs();
  const { canWrite } = useAuth();
  const base = useAsync(async () => ({ core: await loadCore(), sections: await repo.listSections() }), []);
  const [source, setSource] = useState('manual');
  const [rows, setRows] = useState<Row[]>([{ size: '17.5', top: '0', bottom: '' }, { size: '12.25', top: '', bottom: '' }, { size: '8.5', top: '', bottom: '' }]);
  const [wellType, setWellType] = useState(WELL_TYPES[0]);
  const [spud, setSpud] = useState(new Date().toISOString().slice(0, 10));
  const [weighting, setWeighting] = useState<'similarity' | 'equal'>('similarity');
  const [sel, setSel] = useState<string[] | null>(null);
  const save = useAction();
  const [savedMsg, setSavedMsg] = useState(false);

  const candidates = useMemo(() => base.data?.core.summaries.filter(s => s.finalDepth != null && s.well.id !== source) ?? [], [base.data, source]);
  const ids = useMemo(() => sel ?? candidates.filter(s => s.well.status === 'completed').map(s => s.well.id), [sel, candidates]);
  const offs = useAsync(async () => {
    const out: OffsetSectionStat[] = [];
    for (const id of ids) { const w = base.data?.core.well.get(id); if (w) out.push(...offsetSectionStats(w, await repo.getRecords(id))); }
    return out;
  }, [ids.join(','), !!base.data]);

  // fill the planned sections from an existing well
  useEffect(() => {
    if (source === 'manual' || !base.data) return;
    const w = base.data.core.well.get(source); if (!w) return;
    const secs = base.data.sections.filter(s => s.well_id === w.id && s.hole_size_in != null);
    const d = (ft: number) => String(Math.round(U.d(ft)!));
    const target = w.target_depth_ft;
    const merged: { size: number; top: number; bottom: number }[] = [];
    for (const s of secs) { const l = merged[merged.length - 1]; if (l && l.size === s.hole_size_in) l.bottom = s.bottom_md_ft; else merged.push({ size: s.hole_size_in!, top: s.top_md_ft, bottom: s.bottom_md_ft }); }
    if (merged.length && target && target > merged[merged.length - 1].bottom) merged[merged.length - 1].bottom = target;
    if (merged.length && merged[0].top < 100) merged[0].top = 0;   // data usually starts just below surface
    if (!merged.length && target && w.hole_size_in) merged.push({ size: w.hole_size_in, top: 0, bottom: target });
    if (merged.length) setRows(merged.map(m => ({ size: String(m.size), top: d(m.top), bottom: d(m.bottom) })));
    if (w.well_type) setWellType(w.well_type);
    if (w.spud_date) setSpud(String(w.spud_date).slice(0, 10));
    setSel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, base.data]);

  const planned = useMemo(() => rows.map(r => ({ holeSize: Number(r.size), top: U.toFt(Number(r.top)), bottom: U.toFt(Number(r.bottom)) }))
    .filter((s, i) => rows[i].size && rows[i].bottom !== '' && rows[i].top !== '' && isFinite(s.holeSize) && isFinite(s.top) && isFinite(s.bottom) && s.bottom > s.top), [rows, U]);
  const result: EstimateResult | null = useMemo(() => (offs.data && planned.length ? ESTIMATORS[0].estimate({ sections: planned, wellType, spudDate: spud || null, offsets: offs.data, weighting }) : null), [offs.data, planned, wellType, spud, weighting]);

  const chart = useMemo(() => {
    if (!result) return null;
    const ok = result.sections.filter(s => s.hours);
    if (!ok.length) return null;
    return chartBase({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#0b1826', borderColor: '#22364b', textStyle: { color: '#dde8f3', fontSize: 12 }, valueFormatter: (x: number) => `${x} h` },
      xAxis: { type: 'value', name: t('hours'), ...axis() }, yAxis: { type: 'category', inverse: true, data: ok.map(s => `${s.section.holeSize}"`), ...axis() },
      series: PARTS.map(([k, label], i) => ({ type: 'bar', stack: 'h', name: t(label), barMaxWidth: 26, itemStyle: { color: PALETTE[i], borderColor: '#0a1522', borderWidth: 1 }, data: ok.map(s => Math.round(s.hours![k] * 10) / 10) })),
    });
  }, [result, t]);

  if (base.loading && !base.data) return <Spinner label={t('Loading…')} />;
  if (base.error || !base.data) return <Notice kind="error">{base.error}</Notice>;
  const { core } = base.data;
  const label = source === 'manual' ? 'Manual plan' : core.well.get(source)?.name ?? '';
  const setRow = (i: number, patch: Partial<Row>) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const days = result?.totalDays;

  return (
    <div className="space-y-4">
      <PageHeader title={t('Drilling Time Estimation')} subtitle={t('Estimates are calculated from the recorded performance of comparable offset hole sections using transparent averages - not a predictive model.')}
        actions={result && <>
          <ExportButtons doc={() => buildEstimateReport(result, label, spud, U)} />
          {canWrite && <Button size="sm" disabled={save.busy} onClick={() => save.run(async () => { await repo.setSetting('last_estimate', { label, spud, result }); setSavedMsg(true); })}>{savedMsg ? t('Saved for reports') : t('Save for the Reports page')}</Button>}
        </>} />

      <div className="grid gap-4 xl:grid-cols-[440px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title={t('Planned well')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('Plan source')} className="sm:col-span-2"><Select value={source} onChange={e => setSource(e.target.value)}><option value="manual">{t('Enter planned sections manually')}</option>{core.wells.map(w => <option key={w.id} value={w.id}>{t('Use sections of')} {w.name}</option>)}</Select></Field>
              <Field label={t('Well type')}><Select value={wellType} onChange={e => setWellType(e.target.value)}>{WELL_TYPES.map(x => <option key={x} value={x}>{t(x)}</option>)}</Select></Field>
              <Field label={t('Spud date')}><Input type="date" value={spud} onChange={e => setSpud(e.target.value)} /></Field>
            </div>
            <table className="mt-3 w-full text-[13px]">
              <thead><tr className="text-[11px] uppercase tracking-wide text-mute"><th className="py-1 text-start font-medium">{t('Hole Size')} (in)</th><th className="text-start font-medium">{t('From')} ({U.dl})</th><th className="text-start font-medium">{t('To')} ({U.dl})</th><th /></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i}><td className="py-1 pe-2"><Input className="h-8" value={r.size} onChange={e => setRow(i, { size: e.target.value })} inputMode="decimal" /></td>
                  <td className="pe-2"><Input className="h-8" value={r.top} onChange={e => setRow(i, { top: e.target.value })} inputMode="decimal" /></td>
                  <td className="pe-2"><Input className="h-8" value={r.bottom} onChange={e => { setRow(i, { bottom: e.target.value }); if (rows[i + 1] && rows[i + 1].top === '') setRow(i + 1, { top: e.target.value }); }} inputMode="decimal" /></td>
                  <td><button aria-label={t('Remove')} className="p-1 text-mute hover:text-rose-300" onClick={() => setRows(rs => rs.filter((_, k) => k !== i))}><Trash2 size={14} /></button></td></tr>))}</tbody>
            </table>
            <Button size="sm" className="mt-2" onClick={() => setRows(rs => [...rs, { size: '', top: rs[rs.length - 1]?.bottom ?? '', bottom: '' }])}><Plus size={14} />{t('Add section')}</Button>
          </Card>
          <Card title={t('Offset wells used')} right={`${ids.length} ${t('selected')}`}>
            {candidates.length ? <Chips options={candidates.map(s => ({ id: s.well.id, label: `${s.well.name}${s.well.status !== 'completed' ? ` (${t(s.well.status)})` : ''}`, color: core.color(s.well.id) }))} value={ids} onChange={setSel} /> : <p className="text-[13px] text-mute">{t('No offset wells with drilling data.')}</p>}
            <Field label={t('Weighting')} className="mt-3"><Select value={weighting} onChange={e => setWeighting(e.target.value as typeof weighting)}><option value="similarity">{t('Weighted by similarity (hole size, depth overlap, well type)')}</option><option value="equal">{t('Equal weights (simple average)')}</option></Select></Field>
            <p className="mt-2 text-xs text-mute">{t('Estimator')}: {t(ESTIMATORS[0].name)}. {t('The estimator interface accepts additional models (for example a trained regression) without changes to this page.')}</p>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          {!planned.length ? <Empty title={t('Enter at least one planned hole section')} text={t('Each section needs a hole size, a start depth and a deeper end depth.')} />
            : offs.loading || !result ? <Spinner label={t('Calculating from offset wells…')} />
            : !result.totalDays ? <Notice kind="warn"><b>{t('No estimate can be produced.')}</b> {result.confidenceReasons.join(' ')} {t('Add or select offset wells that drilled a similar hole size.')}</Notice>
            : <>
              {!result.complete && <Notice kind="warn">{t('At least one planned section has no comparable offset data. It is excluded from the totals below, so the real total will be longer.')}</Notice>}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label={t('Most likely')} value={fmt(days!.likely, 1)} unit={t('days')} sub={result.completion ? `${t('Completion')} ${result.completion.likely}` : undefined} className="border-cyan-500/40" />
                <Stat label={t('Optimistic')} value={fmt(days!.optimistic, 1)} unit={t('days')} sub={result.completion?.optimistic} />
                <Stat label={t('Pessimistic')} value={fmt(days!.pessimistic, 1)} unit={t('days')} sub={result.completion?.pessimistic} />
                <Stat label={t('Expected ROP')} value={U.fr(result.expectedRop)} unit={U.rl} sub={t('on-bottom, footage-weighted')} />
              </div>
              <Card title={t('Confidence level')} right={<Badge color={CONF[result.confidence]}>{t(result.confidence)}</Badge>}>
                <ul className="list-disc space-y-0.5 ps-5 text-[13px] text-mute">{result.confidenceReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              </Card>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {PARTS.map(([k, lbl], i) => <Stat key={k} color={PALETTE[i]} label={t(lbl)} value={fmt(result.breakdown![k], 1)} unit="h" sub={`${fmt((result.breakdown![k] / result.totalHours!.likely) * 100, 0)}%`} />)}
              </div>
              {chart && <Card title={t('Most likely time by hole section')}><EChart option={chart} height={Math.max(170, 52 * result.sections.length + 70)} /></Card>}
              <Card title={t('Estimate by hole section')} pad={false}>
                <DataTable dense rowKey={(_, i) => String(i)} rows={result.sections} columns={[
                  { key: 's', label: `${t('Hole Size')} (in)`, render: s => `${s.section.holeSize}"` },
                  { key: 'i', label: `${t('Interval')} (${U.dl})`, render: s => `${U.fd(s.section.top)} – ${U.fd(s.section.bottom)}` },
                  { key: 'n', label: t('Comparable offsets'), align: 'end', render: s => s.comparable || <Badge color="red">{t('none')}</Badge> },
                  { key: 'rop', label: `${t('Expected ROP')} (${U.rl})`, align: 'end', render: s => U.fr(s.expectedRop) },
                  ...PARTS.map(([k, lbl]) => ({ key: k, label: `${t(lbl)} (h)`, align: 'end' as const, render: (s: EstimateResult['sections'][number]) => fmt(s.hours?.[k], 1) })),
                  { key: 'o', label: `${t('Optimistic')} (d)`, align: 'end', render: s => fmt(s.total && s.total.optimistic / 24, 1) },
                  { key: 'l', label: `${t('Most likely')} (d)`, align: 'end', render: s => <b>{fmt(s.total && s.total.likely / 24, 1)}</b> },
                  { key: 'p', label: `${t('Pessimistic')} (d)`, align: 'end', render: s => fmt(s.total && s.total.pessimistic / 24, 1) },
                ]} />
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title={t('Historical wells used in the calculation')} pad={false}>
                  <DataTable dense rowKey={w => w.wellName} rows={result.wellsUsed} columns={[
                    { key: 'w', label: t('Well'), value: w => w.wellName }, { key: 's', label: t('Sections used'), align: 'end', value: w => w.sections },
                    { key: 'sh', label: t('Share of weight'), align: 'end', value: w => w.weightShare, render: w => `${fmt(w.weightShare * 100, 0)}%` },
                  ]} />
                </Card>
                <Card title={t('Assumptions and limitations')}>
                  <ol className="list-decimal space-y-1 ps-5 text-xs text-mute">{result.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ol>
                </Card>
              </div>
            </>}
          {save.error && <Notice kind="error">{save.error}</Notice>}
        </div>
      </div>
    </div>
  );
}
