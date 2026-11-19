// Depth-synchronised small multiples: one panel per drilling parameter, all sharing the same depth axis.
import type { depthBins } from '../lib/kpi';
import type { Units } from '../lib/units';
import { axis, chartBase } from './EChart';

export const DEPTH_PARAMS = [
  { key: 'rop', label: 'ROP', unit: '' }, { key: 'wob', label: 'WOB', unit: 'klb' }, { key: 'rpm', label: 'RPM', unit: 'rpm' },
  { key: 'torque', label: 'Torque', unit: 'ft-lb' }, { key: 'diff', label: 'Differential Pressure', unit: 'psi' },
] as const;

export function depthTracksOption(wells: { name: string; color: string; bins: ReturnType<typeof depthBins> }[], U: Units, t: (s: string) => string) {
  const n = DEPTH_PARAMS.length, left0 = 7, w = (100 - left0 - 1) / n;
  return chartBase({
    legend: { show: wells.length > 1, textStyle: { color: '#8499ae', fontSize: 11 }, top: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10 },
    tooltip: {
      trigger: 'axis', axisPointer: { axis: 'y', lineStyle: { color: '#5b7590' } }, backgroundColor: '#0b1826', borderColor: '#22364b', textStyle: { color: '#dde8f3', fontSize: 12 }, confine: true,
      formatter: (ps: { marker: string; seriesName: string; value: [number | null, number] }[]) => !ps.length ? '' :
        `<b>${ps[0].value[1].toLocaleString('en-US')} ${U.dl}</b><br/>` + ps.map(p => `${p.marker}${p.seriesName}: <b>${p.value[0] == null ? '—' : p.value[0].toLocaleString('en-US')}</b>`).join('<br/>'),
    },
    axisPointer: { link: [{ yAxisIndex: 'all' }] },
    dataZoom: [{ type: 'inside', yAxisIndex: DEPTH_PARAMS.map((_, i) => i), filterMode: 'none' }],
    grid: DEPTH_PARAMS.map((_, i) => ({ left: `${left0 + i * w}%`, width: `${w - 1.5}%`, top: 58, bottom: 10 })),
    xAxis: DEPTH_PARAMS.map((p, i) => ({ gridIndex: i, type: 'value', scale: true, position: 'top', name: `${t(p.label)} (${p.key === 'rop' ? U.rl : p.unit})`, nameLocation: 'middle', nameGap: 22, splitNumber: 3, ...axis({ axisLabel: { color: '#8499ae', fontSize: 10, hideOverlap: true } }) })),
    yAxis: DEPTH_PARAMS.map((_, i) => ({ gridIndex: i, type: 'value', inverse: true, scale: true, ...axis({ axisLabel: { show: i === 0, color: '#8499ae', fontSize: 10 } }) })),
    series: wells.flatMap(wl => DEPTH_PARAMS.map((p, i) => ({
      type: 'line', name: wl.name, xAxisIndex: i, yAxisIndex: i, showSymbol: false, lineStyle: { width: 1.6, color: wl.color }, itemStyle: { color: wl.color },
      data: wl.bins.map(b => { const v = b[p.key]; return [v == null ? null : Math.round((p.key === 'rop' ? U.r(v)! : v) * 10) / 10, Math.round(U.d(b.depth)!)]; }),
    }))),
  });
}
