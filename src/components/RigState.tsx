import { useMemo } from 'react';
import type { Segment } from '../lib/kpi';
import { ACT, ACTIVITIES } from '../lib/types';
import { fmtDateTime } from '../lib/units';
import { usePrefs } from '../lib/context';

/** Horizontal rig-state timeline with a share-of-time legend. */
export default function RigState({ segs, t0, t1, cursor, height = 54 }: { segs: Segment[]; t0: number; t1: number; cursor?: number; height?: number }) {
  const { t } = usePrefs();
  const span = Math.max(t1 - t0, 1);
  const { bars, shares } = useMemo(() => {
    const hours: Record<string, number> = {};
    const bars = segs.filter(s => s.t1 > t0 && s.t0 < t1).map(s => {
      const a = Math.max(s.t0, t0), b = Math.min(s.t1, t1);
      hours[s.code] = (hours[s.code] ?? 0) + (b - a) / 3600000;
      return { ...s, left: ((a - t0) / span) * 100, width: ((b - a) / span) * 100 };
    });
    const total = Object.values(hours).reduce((x, y) => x + y, 0) || 1;
    const shares = ACTIVITIES.filter(a => hours[a.code]).map(a => ({ ...a, pct: (hours[a.code] / total) * 100, hours: hours[a.code] })).sort((a, b) => b.pct - a.pct);
    return { bars, shares };
  }, [segs, t0, t1, span]);
  const ticks = Array.from({ length: 6 }, (_, i) => t0 + (span * i) / 5);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_230px]">
      <div dir="ltr" className="min-w-0">
        <div className="relative overflow-hidden rounded-sm bg-bg" style={{ height }}>
          {bars.map((b, i) => (
            <div key={i} className="absolute inset-y-0" title={`${ACT[b.code]?.name ?? b.code} · ${fmtDateTime(b.t0)} → ${fmtDateTime(b.t1)}`}
              style={{ left: `${b.left}%`, width: `max(${b.width}%, 1px)`, background: ACT[b.code]?.color ?? '#64748b' }} />
          ))}
          {cursor != null && cursor >= t0 && cursor <= t1 && <div className="absolute inset-y-0 w-0.5 bg-white" style={{ left: `${((cursor - t0) / span) * 100}%` }} />}
        </div>
        <div className="num mt-1 flex justify-between text-[10px] text-mute">{ticks.map(x => <span key={x}>{fmtDateTime(x).slice(5)}</span>)}</div>
      </div>
      <ul className="space-y-1 text-xs">
        {shares.map(s => (
          <li key={s.code} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="flex-1 truncate text-ink/90">{t(s.name)}</span>
            <span className="num text-mute">{s.hours.toFixed(1)} h</span>
            <span className="num w-11 text-end">{s.pct.toFixed(1)}%</span>
          </li>
        ))}
        {!shares.length && <li className="text-mute">{t('No activity recorded in this period')}</li>}
      </ul>
    </div>
  );
}
