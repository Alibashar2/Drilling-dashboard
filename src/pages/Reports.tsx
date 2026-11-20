import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import * as repo from '../db/repo';
import { usePrefs } from '../lib/context';
import { loadCore } from '../lib/data';
import type { EstimateResult } from '../lib/estimate';
import { buildDDR, buildEstimateReport, buildFormationRisk, buildNpt, buildOffset, buildPerformance, buildProblems, buildRop, type ReportDoc } from '../lib/reports';
import type { Rec } from '../lib/types';
import { localDay } from '../lib/units';
import ReportView from '../components/ReportView';
import { Card, Chips, cx, Empty, Field, Notice, PageHeader, Select, Spinner, useAsync } from '../components/ui';

const TYPES = [
  { id: 'ddr', label: 'Daily Drilling Report (DDR)', hint: 'One well, one day: time breakdown, operations log, parameters, problems.' },
  { id: 'performance', label: 'Well Performance Report', hint: 'Summary and daily performance of the selected wells.' },
  { id: 'npt', label: 'NPT Report', hint: 'Non-productive time by well, category and event.' },
  { id: 'problems', label: 'Drilling Problems Report', hint: 'Full problem register for the selected wells.' },
  { id: 'offset', label: 'Offset Well Analysis', hint: 'Side-by-side offset summary and section performance.' },
  { id: 'formation', label: 'Formation Risk Analysis', hint: 'Recorded problems and NPT grouped by formation.' },
  { id: 'rop', label: 'ROP Performance Analysis', hint: 'ROP by well, hole section and formation.' },
  { id: 'estimate', label: 'Drilling Time Estimation Report', hint: 'The estimate last saved on the Drilling Time Estimation page.' },
] as const;
type TypeId = (typeof TYPES)[number]['id'];

export default function Reports() {
  const { t, U } = usePrefs();
  const base = useAsync(async () => {
    const [core, actions, formations] = await Promise.all([loadCore(), repo.listActions(), repo.listFormations()]);
    return { core, actions, canon: repo.canonResolver(formations) };
  }, []);
  const [type, setType] = useState<TypeId>('performance');
  const [sel, setSel] = useState<string[] | null>(null);
  const [ddrWell, setDdrWell] = useState('');
  const [ddrDate, setDdrDate] = useState('');

  const withData = useMemo(() => base.data?.core.summaries.filter(s => s.finalDepth != null) ?? [], [base.data]);
  const ids = sel ?? base.data?.core.wells.map(w => w.id) ?? [];
  const wellId = ddrWell || withData[0]?.well.id || '';
  const dates = useMemo(() => base.data?.core.reports.filter(r => r.well_id === wellId).map(r => String(r.report_date).slice(0, 10)) ?? [], [base.data, wellId]);
  const date = dates.includes(ddrDate) ? ddrDate : dates[dates.length - 1] ?? '';

  const doc = useAsync<ReportDoc | null>(async () => {
    if (!base.data) return null;
    const { core, actions, canon } = base.data;
    const recsOf = async () => new Map<string, Rec[]>(await Promise.all(ids.map(async id => [id, await repo.getRecords(id)] as [string, Rec[]])));
    switch (type) {
      case 'ddr': {
        const well = core.well.get(wellId), d = core.reports.find(r => r.well_id === wellId && String(r.report_date).slice(0, 10) === date);
        if (!well || !d) return null;
        return buildDDR(well, d, (await repo.getRecords(wellId)).filter(r => localDay(r.t) === date), core, actions, U);
      }
      case 'performance': return buildPerformance(core, ids, U);
      case 'npt': return buildNpt(core, ids, actions, U);
      case 'problems': return buildProblems(core, ids, actions, U);
      case 'offset': return buildOffset(core, ids, await recsOf(), U);
      case 'formation': return buildFormationRisk(core, ids, canon, U);
      case 'rop': return buildRop(core, ids, await recsOf(), U);
      case 'estimate': {
        const s = await repo.getSetting<{ label?: string; spud?: string | null; result?: EstimateResult }>('last_estimate', {});
        return s.result ? buildEstimateReport(s.result, s.label ?? '', s.spud ?? null, U) : null;
      }
    }
  }, [base.data, type, ids.join(','), wellId, date, U]);

  if (base.loading && !base.data) return <Spinner label={t('Loading…')} />;
  if (base.error || !base.data) return <Notice kind="error">{base.error}</Notice>;
  const { core } = base.data;
  if (!core.wells.length) return <><PageHeader title={t('Analytics & Reports')} /><Empty title={t('No wells in the database yet')} text={t('Reports are generated from stored wells.')} /></>;

  return (
    <div className="space-y-4">
      <PageHeader title={t('Analytics & Reports')} subtitle={t('Choose a report, filter it, review it on screen and export it to PDF or Excel. PDF exports are produced in English.')} />
      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title={t('Report')} pad={false}>
            <ul className="p-2">{TYPES.map(x => (
              <li key={x.id}><button onClick={() => setType(x.id)} aria-pressed={type === x.id} className={cx('w-full rounded-md px-3 py-2 text-start', type === x.id ? 'bg-cyan-500/10' : 'hover:bg-white/5')}>
                <span className={cx('block text-[13px] font-medium', type === x.id && 'text-cyan-200')}>{t(x.label)}</span><span className="block text-[11px] text-mute">{t(x.hint)}</span></button></li>))}</ul>
          </Card>
          {type === 'ddr' ? (
            <Card title={t('Filters')}>
              <Field label={t('Well')}><Select value={wellId} onChange={e => setDdrWell(e.target.value)}>{withData.map(s => <option key={s.well.id} value={s.well.id}>{s.well.name}</option>)}</Select></Field>
              <Field label={t('Drilling date')} className="mt-3"><Select value={date} onChange={e => setDdrDate(e.target.value)}>{dates.map((d, i) => <option key={d} value={d}>{d} · {t('Day')} {i + 1}</option>)}</Select></Field>
            </Card>
          ) : type !== 'estimate' && (
            <Card title={t('Filters')} right={`${ids.length} ${t('wells')}`}>
              <Chips options={core.wells.map(w => ({ id: w.id, label: w.name, color: core.color(w.id) }))} value={ids} onChange={setSel} />
            </Card>
          )}
        </div>
        <div className="min-w-0">
          {doc.loading && !doc.data ? <Spinner label={t('Building report…')} /> : doc.error ? <Notice kind="error">{doc.error}</Notice>
            : !doc.data ? (type === 'estimate'
              ? <Empty title={t('No saved estimate')} text={t('Run an estimate on the Drilling Time Estimation page and choose "Save for the Reports page".')} action={<Link className="text-cyan-300 hover:underline" to="/estimate">{t('Drilling Time Estimation')} →</Link>} />
              : <Empty title={t('Nothing to report for this selection')} />)
            : <ReportView doc={doc.data} />}
        </div>
      </div>
    </div>
  );
}
