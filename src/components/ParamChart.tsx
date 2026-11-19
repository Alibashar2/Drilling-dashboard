// One parameter chart of the Well Comparison page. It owns its ECharts instance so that its zoom, pan and selection are
// independent of the other charts; the page synchronises them only when the user asks for it.
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { axis as axisStyle, chartBase } from './EChart';
import { nearestIndex, PARAM, type AxisMode, type ParamKey, type PointSel, type Pt, type WellSeries } from '../lib/pointAnalysis';
import { matchPoint } from '../lib/pointAnalysis';
import type { Units } from '../lib/units';

export interface ZoomRange { startValue: number; endValue: number }
export interface ChartHandle { setZoom(r: ZoomRange | null): void }
export interface ChartSeries { ws: WellSeries; pts: Pt[] }

const SEL_ID = '__selection';
const coarsePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

export function ParamChart({ p, series, axis, U, t, sel, isOrigin, tol, zoom, onPick, onStep, onClear, onZoom, register, label }: {
  p: ParamKey; series: ChartSeries[]; axis: AxisMode; U: Units; t: (s: string) => string;
  sel: PointSel | null; isOrigin: boolean; tol: (ws: WellSeries) => number; zoom: ZoomRange | null;
  onPick: (p: ParamKey, key: number, wellId: string) => void; onStep: (p: ParamKey, dir: -1 | 1) => void; onClear: (p: ParamKey) => void;
  onZoom: (p: ParamKey, r: ZoomRange) => void; register: (p: ParamKey, h: ChartHandle | null) => void; label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  // the latest props, read by the ECharts event handlers that are bound once
  const live = useRef({ series, axis, U, onPick, onZoom, p, ext: [0, 0] as [number, number] });
  live.current = { ...live.current, series, axis, U, onPick, onZoom, p };

  // display conversions: depth -> display unit, time -> days; ROP follows the depth unit
  const xd = (k: number) => (axis === 'depth' ? U.d(k)! : k / 24);
  const yd = (v: number) => (p === 'rop' ? U.r(v)! : v);

  useEffect(() => {
    const c = echarts.init(ref.current!);
    inst.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current!);
    // ---- navigation. ECharts' "inside" zoom consumes every wheel event over the plot (the page could not scroll past a
    // chart), so wheel and drag are handled here: wheel = page scroll, Ctrl + wheel = zoom at the pointer,
    // Shift + wheel / horizontal swipe = pan, drag = pan. The slider below the chart does the same on touch screens.
    const range = (): [number, number] | null => {
      const dz = (c.getOption() as { dataZoom?: { startValue?: number; endValue?: number }[] }).dataZoom?.[0];
      return dz?.startValue != null && dz.endValue != null ? [dz.startValue, dz.endValue] : null;
    };
    const setRange = (a: number, b: number) => {
      const [lo, hi] = live.current.ext;
      if (!(hi > lo)) return;
      const w = Math.min(Math.max(b - a, (hi - lo) / 2000), hi - lo);
      a = Math.max(lo, Math.min(a, hi - w));
      c.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: a, endValue: a + w });
    };
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect(), px = [e.clientX - rect.left, e.clientY - rect.top];
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if ((!e.ctrlKey && !horizontal) || !c.containPixel({ gridIndex: 0 }, px)) return;   // ordinary wheel: the page scrolls
      e.preventDefault();
      const r = range();
      if (!r) return;
      const [a, b] = r, w = b - a;
      if (e.ctrlKey) {
        const xv = (c.convertFromPixel({ gridIndex: 0 }, px) as number[])[0], nw = w * (e.deltaY > 0 ? 1.25 : 0.8);
        setRange(xv - ((xv - a) * nw) / w, xv - ((xv - a) * nw) / w + nw);
      } else {
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const shift = (d / Math.max(rect.width, 1)) * w;
        setRange(a + shift, b + shift);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    let down: [number, number] | null = null;
    let drag: { x: number; r: [number, number]; gw: number } | null = null, raf = 0;
    c.getZr().on('mousedown', e => {
      down = [e.offsetX, e.offsetY];
      if (coarsePointer() || !c.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
      const r = range();
      if (!r) return;
      const gw = (c.convertToPixel({ xAxisIndex: 0 }, r[1]) as number) - (c.convertToPixel({ xAxisIndex: 0 }, r[0]) as number);
      if (gw > 0) drag = { x: e.offsetX, r, gw };
    });
    c.getZr().on('mousemove', e => {
      if (!drag) return;
      const dx = e.offsetX - drag.x;
      if (Math.abs(dx) < 3) return;
      const d = drag, shift = (-dx / d.gw) * (d.r[1] - d.r[0]);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setRange(d.r[0] + shift, d.r[1] + shift));
    });
    const endDrag = () => { drag = null; };
    c.getZr().on('mouseup', endDrag);
    c.getZr().on('globalout', endDrag);
    c.getZr().on('click', e => {
      // a drag to pan is not a selection
      if (down && Math.hypot(e.offsetX - down[0], e.offsetY - down[1]) > 4) return;
      const px = [e.offsetX, e.offsetY];
      if (!c.containPixel({ gridIndex: 0 }, px)) return;
      const L = live.current;
      const xv = (c.convertFromPixel({ gridIndex: 0 }, px) as number[])[0];
      const key = L.axis === 'depth' ? L.U.toFt(xv) : xv * 24;
      // the nearest actual point of any well, measured on screen
      let best: { d: number; key: number; wellId: string } | null = null;
      for (const s of L.series) {
        const i = nearestIndex(s.pts.map(q => q.x), key);
        if (i < 0) continue;
        const q = s.pts[i];
        const pix = c.convertToPixel({ gridIndex: 0 }, [L.axis === 'depth' ? L.U.d(q.x)! : q.x / 24, L.p === 'rop' ? L.U.r(q.y)! : q.y]) as number[];
        const d = Math.hypot(pix[0] - px[0], pix[1] - px[1]);
        if (!best || d < best.d) best = { d, key: q.x, wellId: s.ws.wellId };
      }
      if (best) L.onPick(L.p, best.key, best.wellId);
    });
    c.on('datazoom', () => {
      const dz = (c.getOption() as { dataZoom?: { startValue?: number; endValue?: number }[] }).dataZoom?.[0];
      if (dz?.startValue != null && dz.endValue != null) live.current.onZoom(live.current.p, { startValue: dz.startValue, endValue: dz.endValue });
    });
    register(p, {
      // silent: a programmatic zoom from navigation sync must not echo back
      setZoom: r => c.dispatchAction(r ? { type: 'dataZoom', dataZoomIndex: 0, startValue: r.startValue, endValue: r.endValue } : { type: 'dataZoom', dataZoomIndex: 0, start: 0, end: 100 }, { silent: true } as never),
    });
    return () => { register(p, null); el.removeEventListener('wheel', onWheel); cancelAnimationFrame(raf); ro.disconnect(); c.dispose(); inst.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // base option: data, axes, zoom. Rebuilt only when the data, axis or units change (not on selection).
  useEffect(() => {
    const c = inst.current;
    if (!c) return;
    const unit = p === 'rop' ? U.rl : PARAM[p].unit;
    const lookup = new Map<string, (Pt | null)[]>();
    const sers = series.map(s => {
      const data: ([number, number | null])[] = [], idx: (Pt | null)[] = [];
      const gap = (s.ws.spacing ?? 0) * 10;
      s.pts.forEach((q, i) => {
        // a long stretch without records breaks the line instead of drawing a straight bridge across it
        if (i > 0 && gap > 0 && q.x - s.pts[i - 1].x > gap) { data.push([xd((q.x + s.pts[i - 1].x) / 2), null]); idx.push(null); }
        data.push([xd(q.x), Math.round(yd(q.y) * 100) / 100]); idx.push(q);
      });
      lookup.set(s.ws.wellId, idx);
      const few = s.pts.length <= 400;
      return {
        id: s.ws.wellId, type: 'line', name: s.ws.name, data, showSymbol: few, symbol: 'circle', symbolSize: 4, connectNulls: false,
        lineStyle: { width: 1.4, color: s.ws.color }, itemStyle: { color: s.ws.color }, emphasis: { disabled: true }, animation: false,
        // depth spread across a report entry: the point is drawn hollow
        ...(few ? { data: data.map((d, i) => (idx[i]?.rec.data_quality === 'interpolated' ? { value: d, symbol: 'emptyCircle' } : d)) } : {}),
      };
    });
    // data extent on the display axis, for clamping zoom and pan
    const xs = series.flatMap(s => s.pts.length ? [xd(s.pts[0].x), xd(s.pts[s.pts.length - 1].x)] : []);
    live.current.ext = xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 0];
    const xName = axis === 'depth' ? `MD (${U.dl})` : t('Days since first record');
    c.setOption(chartBase({
      legend: { show: false },
      grid: { left: 8, right: 18, top: 16, bottom: 46, containLabel: true },
      tooltip: {
        trigger: 'axis', confine: true, backgroundColor: '#0b1826', borderColor: '#22364b', textStyle: { color: '#dde8f3', fontSize: 12 }, axisPointer: { type: 'line', lineStyle: { color: '#5b7590' } },
        formatter: (ps: { seriesId: string; dataIndex: number; marker: string; seriesName: string }[]) => {
          const rows = ps.filter(q => q.seriesId !== SEL_ID).map(q => {
            const pt = lookup.get(q.seriesId)?.[q.dataIndex];
            if (!pt) return '';
            const at = axis === 'depth' ? `${U.fd(pt.x)} ${U.dl}` : `${t('day')} ${(pt.x / 24).toFixed(2)}`;
            return `${q.marker}${q.seriesName}: <b>${(Math.round(yd(pt.y) * 10) / 10).toLocaleString('en-US')}</b> ${unit} <span style="color:#8499ae">@ ${at}${pt.rec.data_quality === 'interpolated' ? ` · ${t('depth spread across report entry')}` : ''}</span>`;
          }).filter(Boolean);
          return rows.join('<br/>') + `<br/><span style="color:#8499ae">${t('Click to select · drag or Shift + wheel to pan · Ctrl + wheel to zoom')}</span>`;
        },
      },
      xAxis: { type: 'value', scale: true, name: xName, nameLocation: 'middle', nameGap: 22, min: 'dataMin', max: 'dataMax',
        ...axisStyle({ axisLabel: { color: '#8499ae', fontSize: 10, hideOverlap: true, formatter: (v: number) => (axis === 'depth' ? Math.round(v).toLocaleString('en-US') : (Math.round(v * 10) / 10).toLocaleString('en-US')) } }) },
      yAxis: { type: 'value', scale: true, name: unit, ...axisStyle({ axisLabel: { color: '#8499ae', fontSize: 10, hideOverlap: true } }) },
      dataZoom: [
        // no 'inside' zoom: it would capture the page's wheel scrolling (see the handlers above)
        { type: 'slider', xAxisIndex: 0, filterMode: 'none', height: 14, bottom: 4, borderColor: '#22364b', fillerColor: 'rgba(14,165,196,0.15)', backgroundColor: 'transparent', dataBackground: { lineStyle: { color: '#3b536c' }, areaStyle: { color: 'rgba(59,83,108,0.25)' } }, textStyle: { color: '#8499ae', fontSize: 10 }, handleSize: '120%', showDetail: false, brushSelect: false, ...(zoom ?? {}) },
      ],
      series: [...sers, { id: SEL_ID, type: 'scatter', name: 'selection', data: [], z: 10, symbolSize: 11, silent: true, tooltip: { show: false } }],
    }) as echarts.EChartsOption, { notMerge: true });
    applySel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, axis, U, t]);

  // selection markers: merged into the existing option, so zoom and pan are kept
  const applySel = () => {
    const c = inst.current;
    if (!c) return;
    const data: { value: [number, number]; itemStyle: Record<string, unknown> }[] = [];
    if (sel) for (const s of series) {
      const m = matchPoint(s.pts, sel.key, tol(s.ws), axis);
      if (m.pt && m.status !== 'far') data.push({ value: [xd(m.pt.x), yd(m.pt.y)], itemStyle: { color: s.ws.color, borderColor: '#ffffff', borderWidth: s.ws.wellId === sel.wellId && isOrigin ? 2.5 : 1.5 } });
    }
    c.setOption({ series: [{ id: SEL_ID, data, markLine: sel ? { silent: true, symbol: 'none', label: { show: false }, data: [{ xAxis: xd(sel.key) }], lineStyle: { color: isOrigin ? '#e2e8f0' : '#94a3b8', type: isOrigin ? 'solid' : 'dashed', width: 1 } } : { data: [] } }] });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(applySel, [sel, isOrigin, tol]);

  return (
    <div ref={ref} dir="ltr" tabIndex={0} aria-label={label} className="h-full w-full rounded outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/60"
      onKeyDown={e => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); onStep(p, e.key === 'ArrowRight' ? 1 : -1); }
        else if (e.key === 'Escape') onClear(p);
      }} />
  );
}
