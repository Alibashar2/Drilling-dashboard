import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

/**
 * Categorical palette for series identity (wells etc.) on the dark surface.
 * Validated with the dataviz palette checker (lightness band, chroma, CVD separation, contrast) - fixed order.
 */
export const PALETTE = ['#0ea5c4', '#d97706', '#c026d3', '#16a34a', '#8b5cf6', '#b45f5f'];
export const INK = '#dde8f3', MUTE = '#8499ae', GRID = '#152435', AXIS = '#2a3d52';

export const axis = (extra: Record<string, unknown> = {}) => ({
  axisLine: { lineStyle: { color: AXIS } }, axisTick: { show: false },
  axisLabel: { color: MUTE, fontSize: 11 }, splitLine: { lineStyle: { color: GRID } },
  nameTextStyle: { color: MUTE, fontSize: 11 }, ...extra,
});

/** Shared chart chrome: recessive grid, hover tooltip, legend for 2+ series. */
export function chartBase(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    backgroundColor: 'transparent', color: PALETTE, animation: false, useUTC: true,
    textStyle: { color: INK, fontFamily: 'inherit' },
    tooltip: { trigger: 'axis', backgroundColor: '#0b1826', borderColor: '#22364b', textStyle: { color: INK, fontSize: 12 }, axisPointer: { lineStyle: { color: '#3b536c' } }, confine: true },
    legend: { textStyle: { color: MUTE, fontSize: 11 }, top: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, type: 'scroll' },
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    ...extra,
  };
}

export function EChart({ option, height = 280, className, onReady }: { option: Record<string, unknown>; height?: number | string; className?: string; onReady?: (c: echarts.ECharts) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);
  useEffect(() => {
    const c = echarts.init(ref.current!);
    inst.current = c;
    onReady?.(c);
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current!);
    return () => { ro.disconnect(); c.dispose(); inst.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { inst.current?.setOption(option as echarts.EChartsOption, true); }, [option]);
  return <div ref={ref} dir="ltr" style={{ height }} className={className} />;
}
