import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { usePrefs } from '../lib/context';
import { loadCore } from '../lib/data';
import type { WellSummary } from '../lib/kpi';
import { fmt } from '../lib/units';
import { summaryCols, summaryRow } from '../lib/reports';
import { ExportButtons } from '../components/ReportView';
import { Badge, Card, DataTable, Empty, Input, Notice, PageHeader, Select, Spinner, useAsync, type Column } from '../components/ui';

export const STATUS_BADGE = { planned: 'gray', active: 'green', completed: 'cyan' } as const;

export default function Wells() {
  const { t, U } = usePrefs();
  const nav = useNavigate();
  const { data, loading, error } = useAsync(loadCore, []);
  const [q, setQ] = useState(''), [status, setStatus] = useState(''), [field, setField] = useState('');

  const rows = useMemo(() => (data?.summaries ?? []).filter(s =>
    (!status || s.well.status === status) && (!field || s.well.field === field) &&
    (!q || `${s.well.name} ${s.well.well_code} ${s.well.field} ${s.well.location}`.toLowerCase().includes(q.toLowerCase()))), [data, q, status, field]);
  const fields = [...new Set((data?.wells ?? []).map(w => w.field).filter(Boolean))] as string[];

  const columns: Column<WellSummary>[] = [
    { key: 'name', label: t('Well Name'), value: s => s.well.name, render: s => <span className="font-medium text-cyan-200">{s.well.name}{s.well.is_demo && <Badge color="magenta" className="ms-2">{t('Sample')}</Badge>}</span> },
    { key: 'code', label: t('Well ID'), value: s => s.well.well_code },
    { key: 'field', label: t('Field'), value: s => s.well.field },
    { key: 'loc', label: t('Location'), value: s => s.well.location },
    { key: 'spud', label: t('Spud Date'), value: s => String(s.well.spud_date ?? '').slice(0, 10) || null },
    { key: 'comp', label: t('Completion Date'), value: s => String(s.well.completion_date ?? '').slice(0, 10) || null },
    { key: 'depth', label: `${t('Final Depth')} (${U.dl})`, align: 'end', value: s => s.finalDepth, render: s => U.fd(s.finalDepth) },
    { key: 'days', label: t('Total Drilling Days'), align: 'end', value: s => s.days, render: s => (s.finalDepth == null ? '—' : fmt(s.days, 1)) },
    { key: 'rop', label: `${t('Average ROP')} (${U.rl})`, align: 'end', value: s => s.avgRop, render: s => U.fr(s.avgRop) },
    { key: 'npt', label: `${t('Total NPT')} (h)`, align: 'end', value: s => s.nptHours, render: s => (s.finalDepth == null ? '—' : fmt(s.nptHours, 1)) },
    { key: 'prob', label: t('Recorded Problems'), align: 'end', value: s => s.problems },
    { key: 'status', label: t('Well Status'), value: s => s.well.status, render: s => <Badge color={STATUS_BADGE[s.well.status]}>{t(s.well.status)}</Badge> },
  ];

  if (loading && !data) return <Spinner label={t('Loading…')} />;
  if (error) return <Notice kind="error">{error}</Notice>;
  return (
    <div>
      <PageHeader title={t('Historical Wells')} subtitle={t('All wells in the database. Select a well to open its full record.')}
        actions={<ExportButtons doc={() => ({ title: 'Historical Wells', meta: [['Wells listed', String(rows.length)]], tables: [{ heading: 'Wells', columns: summaryCols(U), rows: rows.map(s => summaryRow(s, U)) }] })} />} />
      {!data!.wells.length ? <Empty title={t('No wells in the database yet')} text={t('Add a well, or load the sample dataset from Home or Settings.')} /> : (
        <Card pad={false}>
          <div className="flex flex-wrap items-center gap-2 p-3">
            <div className="relative min-w-52 flex-1"><Search size={14} className="absolute start-2.5 top-2.5 text-mute" /><Input className="ps-8" placeholder={t('Search by name, ID, field or location')} value={q} onChange={e => setQ(e.target.value)} /></div>
            <Select className="w-40" aria-label={t('Well Status')} value={status} onChange={e => setStatus(e.target.value)}><option value="">{t('All statuses')}</option>{(['planned', 'active', 'completed'] as const).map(s => <option key={s} value={s}>{t(s)}</option>)}</Select>
            <Select className="w-44" aria-label={t('Field')} value={field} onChange={e => setField(e.target.value)}><option value="">{t('All fields')}</option>{fields.map(f => <option key={f}>{f}</option>)}</Select>
          </div>
          <DataTable columns={columns} rows={rows} rowKey={s => s.well.id} onRowClick={s => nav(`/wells/${s.well.id}`)} empty={t('No wells match the filters')} />
        </Card>
      )}
    </div>
  );
}
