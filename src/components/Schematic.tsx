import { useMemo } from 'react';
import { interpAtMd, type TrajPoint } from '../lib/survey';
import { usePrefs } from '../lib/context';

interface Props {
  traj: TrajPoint[];            // computed survey trajectory ([] when the well has no survey)
  holeDepth: number;            // ft MD
  bitDepth: number | null;      // ft MD
  targetDepth: number | null;   // ft MD
  shoes?: number[];             // section bottoms (ft MD) drawn as casing-point ticks
  height?: number;
}

/**
 * Vertical-section view of the wellbore (horizontal displacement vs TVD, true scale).
 * With a directional survey the real trajectory is drawn; without one a straight vertical well is drawn
 * and labelled as illustrative. Beyond the last survey station the path is projected along the last inclination.
 */
export default function Schematic({ traj, holeDepth, bitDepth, targetDepth, shoes = [], height = 340 }: Props) {
  const { t } = usePrefs();
  const W = 300, H = height, top = 34, illustrative = traj.length < 2;
  const g = useMemo(() => {
    const maxMd = Math.max(targetDepth ?? 0, holeDepth, traj.length ? traj[traj.length - 1].md : 0, 100);
    const at = (md: number) => (illustrative ? { tvd: md, hd: 0 } : interpAtMd(traj, md)!);
    const mds = illustrative ? [0, maxMd] : [...traj.map(p => p.md).filter(m => m <= maxMd), maxMd];
    const pts = mds.map(md => ({ md, ...at(md) }));
    const hdMax = Math.max(...pts.map(p => p.hd), 1), tvdMax = Math.max(...pts.map(p => p.tvd), 1);
    const scale = Math.min((W * 0.6) / hdMax, (H - top - 18) / tvdMax);
    const x0 = illustrative || hdMax * scale < 40 ? W * 0.3 : 46;
    const xy = (md: number) => { const p = at(md); return [x0 + p.hd * scale, top + p.tvd * scale] as const; };
    const path = (from: number, to: number) => {
      const inner = mds.filter(m => m > from && m < to);
      return [from, ...inner, to].map((m, i) => `${i ? 'L' : 'M'}${xy(m).map(v => v.toFixed(1)).join(',')}`).join(' ');
    };
    return { maxMd, xy, path, x0 };
  }, [traj, holeDepth, targetDepth, illustrative, H]);

  const hole = Math.min(holeDepth, g.maxMd);
  const bit = bitDepth == null ? null : g.xy(Math.max(0, Math.min(bitDepth, g.maxMd)));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={t('Wellbore schematic')} style={{ direction: 'ltr' }}>
      {/* surface + rig */}
      <line x1={0} y1={top} x2={W} y2={top} stroke="#22364b" strokeWidth={1} />
      <path d={`M${g.x0 - 9},${top} L${g.x0},${top - 24} L${g.x0 + 9},${top} M${g.x0 - 5},${top - 11} L${g.x0 + 5},${top - 11}`} fill="none" stroke="#8499ae" strokeWidth={1.4} />
      {/* planned / projected path */}
      <path d={g.path(0, g.maxMd)} fill="none" stroke="#3b536c" strokeWidth={1.5} strokeDasharray="4 5" />
      {/* drilled hole */}
      {hole > 0 && <>
        <path d={g.path(0, hole)} fill="none" stroke="#0ea5c4" strokeOpacity={0.18} strokeWidth={15} strokeLinecap="round" strokeLinejoin="round" />
        <path d={g.path(0, hole)} fill="none" stroke="#9fb3c8" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
        <path d={g.path(0, hole)} fill="none" stroke="#050b14" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </>}
      {shoes.filter(s => s < hole - 1).map(s => { const [x, y] = g.xy(s); return <path key={s} d={`M${x - 9},${y} l4,-6 M${x + 9},${y} l-4,-6`} stroke="#dde8f3" strokeWidth={1.6} fill="none" />; })}
      {/* target */}
      {targetDepth != null && (() => { const [x, y] = g.xy(g.maxMd); return <g><circle cx={x} cy={y} r={4} fill="none" stroke="#8499ae" strokeWidth={1.2} /><text x={x + 8} y={y + 4} fontSize={10} fill="#8499ae">TD</text></g>; })()}
      {/* bit */}
      {bit && <g><circle cx={bit[0]} cy={bit[1]} r={7} fill="#050b14" stroke="#f59e0b" strokeWidth={2} /><circle cx={bit[0]} cy={bit[1]} r={2.5} fill="#f59e0b" /></g>}
      {illustrative && <text x={W - 6} y={H - 6} textAnchor="end" fontSize={10} fill="#eab308">{t('Illustrative – no survey data')}</text>}
    </svg>
  );
}
