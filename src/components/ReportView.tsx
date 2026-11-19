import { useMemo, useRef } from 'react';
import type * as echarts from 'echarts';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { usePrefs } from '../lib/context';
import { exportExcel, exportPdf, type ReportDoc } from '../lib/reports';
import { axis, chartBase, EChart, PALETTE } from './EChart';
import { Button, Card, Notice, useAction } from './ui';

type Extra = Parameters<typeof exportExcel>[1];

export function ExportButtons({ doc, chart, extraSheets }: { doc: () => ReportDoc | Promise<ReportDoc>; chart?: () => string | null; extraSheets?: () => Extra | Promise<Extra> }) {
  const { t } = usePrefs();
  const act = useAction();
  return (
    <>
      <Button size="sm" disabled={act.busy} onClick={() => act.run(async () => exportPdf(await doc(), chart?.()))}><FileText size={14} />{t('Export PDF')}</Button>
      <Button size="sm" disabled={act.busy} onClick={() => act.run(async () => exportExcel(await doc(), await extraSheets?.()))}><FileSpreadsheet size={14} />{t('Export Excel')}</Button>
      {act.error && <span className="text-xs text-rose-300">{act.error}</span>}
    </>
  );
}

/** On-screen rendering of a report document, with PDF / Excel export. */
export default function ReportView({ doc }: { doc: ReportDoc }) {
  const { t } = usePrefs();
  const inst = useRef<echarts.ECharts | null>(null);
  const opt = useMemo(() => {
    const c = doc.chart;
    if (!c || !c.categories.length) return null;
    return chartBase({
      legend: { show: c.series.length > 1, textStyle: { color: '#8499ae', fontSize: 11 }, top: 0 },
      grid: { left: 8, right: 16, top: c.series.length > 1 ? 30 : 12, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: c.categories, ...axis({ axisLabel: { color: '#8499ae', fontSize: 11, interval: c.categories.length > 16 ? 'auto' : 0, width: 110, overflow: 'truncate' } }) },
      yAxis: { type: 'value', name: c.unit ?? '', ...axis() },
      series: c.series.map((s, i) => ({ type: 'bar', name: s.name, data: s.data, barMaxWidth: 26, itemStyle: { color: PALETTE[i], borderRadius: [4, 4, 0, 0] } })),
    });
  }, [doc]);

  return (
    <div className="space-y-4">
      <Card title={<span className="text-base">{doc.title}{doc.subtitle && <span className="ms-2 text-[13px] font-normal text-mute">{doc.subtitle}</span>}</span>}
        right={<ExportButtons doc={() => doc} chart={() => inst.current?.getDataURL({ pixelRatio: 2, backgroundColor: '#0a1522' }) ?? null} />}>
        <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2 xl:grid-cols-3">
          {doc.meta.map(([k, v]) => <div key={k} className="flex gap-2 border-b border-line/40 py-1"><dt className="w-44 shrink-0 text-mute">{t(k)}</dt><dd className="min-w-0 flex-1 break-words">{v}</dd></div>)}
        </dl>
        {doc.notes?.map((n, i) => <Notice key={i} kind="warn" className="mt-3">{t(n)}</Notice>)}
      </Card>
      {opt && <Card title={t(doc.chart!.title)}><EChart option={opt} height={240} onReady={c => { inst.current = c; }} /></Card>}
      {doc.tables.map(tb => (
        <Card key={tb.heading} title={t(tb.heading)} right={`${tb.rows.length} ${t('rows')}`} pad={false}>
          <div className="max-h-[420px] overflow-auto px-2 pb-2">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-panel"><tr>{tb.columns.map(c => <th key={c} scope="col" className="border-b border-line px-2 py-1.5 text-start font-medium whitespace-nowrap text-mute">{t(c)}</th>)}</tr></thead>
              <tbody>
                {tb.rows.map((r, i) => <tr key={i} className="border-b border-line/40">{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'num px-2 py-1 text-end whitespace-nowrap' : 'max-w-md px-2 py-1'}>{c == null || c === '' ? '—' : typeof c === 'number' ? c.toLocaleString('en-US') : c}</td>)}</tr>)}
                {!tb.rows.length && <tr><td colSpan={tb.columns.length} className="px-2 py-5 text-center text-mute">{t('No data')}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
