// Interactive parameter charts of the Well Comparison page: one chart per drilling parameter on a shared depth or time
// axis, three selection modes, optional navigation sync, per-chart layout controls and the point analysis panel.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, EyeOff, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import * as repo from '../db/repo';
import type { Core } from '../lib/data';
import { usePrefs } from '../lib/context';
import {
  ALL_PARAMS, applySelection, buildWellSeries, clearSelection, DEFAULT_VISIBLE, navTargets, nearestIndex, PARAM, paramPoints, resync, syncTargets, tolerance,
  type AxisMode, type ParamKey, type PointSel, type SelMode, type SelState, type WellEquip, type WellSeries,
} from '../lib/pointAnalysis';
import type { TrajPoint } from '../lib/survey';
import type { CorrectiveAction, Rec, Well } from '../lib/types';
import { ParamChart, type ChartHandle, type ChartSeries, type ZoomRange } from './ParamChart';
import { PointAnalysisPanel } from './PointAnalysisPanel';
import { Badge, Button, Card, Chips, cx, Select, useAsync } from './ui';

type Size = 'normal' | 'expanded' | 'collapsed';
interface Layout { mode: SelMode; custom: ParamKey[]; syncNav: boolean; navSet: ParamKey[]; visible: ParamKey[]; sizes: Partial<Record<ParamKey, Size>>; axis: AxisMode; tol: string }
const DEFAULT_LAYOUT: Layout = { mode: 'all', custom: ['rop', 'wob', 'rpm'], syncNav: false, navSet: [...ALL_PARAMS], visible: DEFAULT_VISIBLE, sizes: {}, axis: 'depth', tol: 'auto' };
const LS = 'dd.compare.layout.v1';
const loadLayout = (): Layout => {
  try {
    const x = JSON.parse(localStorage.getItem(LS) ?? 'null');
    if (!x) return DEFAULT_LAYOUT;
    const ok = (a: unknown) => (Array.isArray(a) ? a.filter((p): p is ParamKey => ALL_PARAMS.includes(p)) : null);
    return { ...DEFAULT_LAYOUT, ...x, custom: ok(x.custom) ?? DEFAULT_LAYOUT.custom, navSet: ok(x.navSet) ?? DEFAULT_LAYOUT.navSet, visible: ok(x.visible) ?? DEFAULT_LAYOUT.visible };
  } catch { return DEFAULT_LAYOUT; }
};
// matching tolerance choices; 'auto' = three sampling intervals of each well
const NO_EQ = new Map<string, WellEquip>(), NO_TRAJ = new Map<string, TrajPoint[]>(), NO_ACT = new Map<string, CorrectiveAction[]>();
const TOL_DEPTH = [25, 50, 100, 250, 500], TOL_TIME_H = [0.25, 1, 3, 6, 12];

export function CompareExplorer({ wells, core, canon }: { wells: { well: Well; color: string; recs: Rec[] }[]; core: Core; canon: (n: string | null | undefined) => string | null }) {
  const { t, U } = usePrefs();
  const [L, setL] = useState<Layout>(loadLayout);
  const set = (patch: Partial<Layout>) => setL(prev => { const n = { ...prev, ...patch }; try { localStorage.setItem(LS, JSON.stringify(n)); } catch { /* per-viewer convenience only */ } return n; });
  const { mode, custom, syncNav, navSet, visible, sizes, axis } = L;

  // ---- data: records come from the database once per well set (repo caches them); nothing is fetched on interaction
  const ids = wells.map(w => w.well.id).join(',');
  const series = useMemo(() => wells.map(w => buildWellSeries(w.well, w.color, w.recs, axis)), [wells, axis]);
  const chartData = useMemo(() => Object.fromEntries(ALL_PARAMS.map(p => [p, series.map(ws => ({ ws, pts: paramPoints(ws, p) }))])) as Record<ParamKey, ChartSeries[]>, [series]);
  const hasData = (p: ParamKey) => chartData[p].some(s => s.pts.length > 0);
  const extra = useAsync(async () => {
    const list = wells.map(w => w.well.id);
    const [eqs, surveys, actions] = await Promise.all([Promise.all(list.map(id => repo.getEquipment(id))), Promise.all(list.map(id => repo.getSurvey(id))), repo.listActions()]);
    const am = new Map<string, CorrectiveAction[]>();
    for (const a of actions) { const x = am.get(a.problem_id); if (x) x.push(a); else am.set(a.problem_id, [a]); }
    return {
      eqs: new Map<string, WellEquip>(list.map((id, i) => [id, eqs[i]])),
      trajs: new Map<string, TrajPoint[]>(list.map((id, i) => [id, surveys[i].map(s => ({ md: s.md_ft, inc: s.inclination_deg, azi: s.azimuth_deg, tvd: s.tvd_ft ?? s.md_ft, north: s.north_ft ?? 0, east: s.east_ft ?? 0, hd: Math.hypot(s.north_ft ?? 0, s.east_ft ?? 0) }))])),
      actions: am,
    };
  }, [ids]);

  const tolOverride = L.tol === 'auto' ? null : axis === 'depth' ? Number(L.tol) : Number(L.tol);
  const tol = useCallback((ws: WellSeries) => tolerance(ws, tolOverride), [tolOverride]);

  // ---- selection
  const [sel, setSel] = useState<SelState>({});
  const [active, setActive] = useState<PointSel | null>(null);
  const seq = useRef(0);
  const zooms = useRef(new Map<ParamKey, ZoomRange>());
  const handles = useRef(new Map<ParamKey, ChartHandle>());
  // a new axis or well set makes keys and zoom ranges meaningless
  useEffect(() => { setSel({}); setActive(null); zooms.current.clear(); }, [axis, ids, U.depthUnit]);

  const pick = useCallback((p: ParamKey, key: number, wellId: string) => {
    const s: PointSel = { key, wellId, origin: p, seq: ++seq.current };
    setSel(st => applySelection(st, s, mode, custom));
    setActive(s);
  }, [mode, custom]);
  const step = useCallback((p: ParamKey, dir: -1 | 1) => {
    const cur = sel[p];
    if (!cur) return;
    const s = chartData[p].find(x => x.ws.wellId === cur.wellId) ?? chartData[p].find(x => x.pts.length);
    if (!s) return;
    const xs = s.pts.map(q => q.x);
    let i = nearestIndex(xs, cur.key);
    if (i < 0) return;
    // step to the next point with a different key (records of one report entry can share a depth)
    while (i >= 0 && i < xs.length && xs[i] === cur.key) i += dir;
    if (i >= 0 && i < xs.length) pick(p, xs[i], s.ws.wellId);
  }, [sel, chartData, pick]);
  const clear = useCallback((p: ParamKey) => {
    setSel(st => clearSelection(st, p, mode, custom));
    setActive(a => (a && syncTargets(p, mode, custom).includes(a.origin) ? null : a));
  }, [mode, custom]);
  const setMode = (m: SelMode) => { set({ mode: m }); setSel(st => resync(st, m, custom)); };
  const setCustom = (c: ParamKey[]) => { set({ custom: c }); if (mode === 'custom') setSel(st => resync(st, 'custom', c)); };

  // ---- navigation (zoom / pan)
  const register = useCallback((p: ParamKey, h: ChartHandle | null) => { if (h) handles.current.set(p, h); else handles.current.delete(p); }, []);
  const navRef = useRef({ syncNav, navSet, visible });
  navRef.current = { syncNav, navSet, visible };
  const onZoom = useCallback((p: ParamKey, r: ZoomRange) => {
    zooms.current.set(p, r);
    const n = navRef.current;
    for (const q of navTargets(p, n.syncNav, n.navSet, n.visible)) { zooms.current.set(q, r); handles.current.get(q)?.setZoom(r); }
  }, []);
  const resetZoom = (p: ParamKey | 'all') => {
    const targets = p === 'all' ? ALL_PARAMS : [p, ...navTargets(p, syncNav, navSet, visible)];
    for (const q of targets) { zooms.current.delete(q); handles.current.get(q)?.setZoom(null); }
  };

  // ---- layout
  const [max, setMax] = useState<ParamKey | null>(null);
  useEffect(() => {
    if (!max) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setMax(null);
    window.addEventListener('keydown', h);
    // the page behind a maximized chart must not scroll (the app scrolls inside <main>, not the body)
    const locked = [document.body, document.querySelector('main')].filter((x): x is HTMLElement => !!x).map(el => [el, el.style.overflow] as const);
    for (const [el] of locked) el.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', h); for (const [el, prev] of locked) el.style.overflow = prev; };
  }, [max]);
  const restore = () => { set({ visible: DEFAULT_VISIBLE, sizes: {} }); setMax(null); resetZoom('all'); };
  const setSize = (p: ParamKey, s: Size) => set({ sizes: { ...sizes, [p]: s } });
  const shown = ALL_PARAMS.filter(p => visible.includes(p));
  const keyTxt = (k: number) => (axis === 'depth' ? `${U.fd(k)} ${U.dl}` : `${t('day')} ${(k / 24).toFixed(2)}`);
  const panelRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-3">
      <Card title={t('Drilling parameter charts')} right={t('actual on-bottom drilling records from the database')}>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3 text-xs">
          <div>
            <div className="mb-1 font-medium text-mute">{t('Point selection')}</div>
            <div role="radiogroup" aria-label={t('Point selection')} className="inline-flex overflow-hidden rounded-md border border-line">
              {([['all', 'All Parameters'], ['independent', 'Independent'], ['custom', 'Custom Selection']] as [SelMode, string][]).map(([m, l]) => (
                <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}
                  className={cx('px-2.5 py-1.5 text-xs', mode === m ? 'bg-cyan-500/20 text-cyan-100' : 'text-mute hover:text-ink')}>{t(l)}</button>
              ))}
            </div>
            <p className="mt-1 max-w-sm text-[11px] text-mute">{t(mode === 'all' ? 'A point selected on one chart is selected at the same depth / time on every chart.' : mode === 'independent' ? 'Each chart keeps its own selected point.' : 'Only the parameters chosen below share a selection; the others stay independent.')}</p>
          </div>
          <div>
            <div className="mb-1 font-medium text-mute">{t('X axis')}</div>
            <Select className="h-8 w-auto text-xs" value={axis} onChange={e => set({ axis: e.target.value as AxisMode, tol: 'auto' })}>
              <option value="depth">{t('Measured depth (MD)')}</option>
              <option value="time">{t('Elapsed time since first record')}</option>
            </Select>
          </div>
          <div>
            <div className="mb-1 font-medium text-mute">{t('Matching tolerance')}</div>
            <Select className="h-8 w-auto text-xs" value={L.tol} onChange={e => set({ tol: e.target.value })}>
              <option value="auto">{t('Auto (3 × sampling interval of each well)')}</option>
              {(axis === 'depth' ? TOL_DEPTH : TOL_TIME_H).map(v => <option key={v} value={axis === 'depth' ? String(v) : String(v)}>{axis === 'depth' ? `± ${U.fdu(v)}` : `± ${v < 1 ? `${v * 60} min` : `${v} h`}`}</option>)}
            </Select>
          </div>
          <div>
            <div className="mb-1 font-medium text-mute">{t('Navigation')}</div>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={syncNav} onChange={e => set({ syncNav: e.target.checked })} />{t('Synchronize Chart Navigation')}</label>
            <p className="mt-1 max-w-xs text-[11px] text-mute">{t('Zoom and pan of the chosen charts follow each other on the shared x axis; the value axes (different units) are never linked.')}</p>
          </div>
          <div className="ms-auto flex items-end gap-2 self-end">
            <Button size="sm" onClick={() => resetZoom('all')}><RotateCcw size={13} />{t('Reset zoom')}</Button>
            <Button size="sm" onClick={restore}>{t('Restore default layout')}</Button>
          </div>
        </div>
        {mode === 'custom' && <div className="mt-3 text-xs"><div className="mb-1 font-medium text-mute">{t('Parameters that share the selection')}</div>
          <Chips options={ALL_PARAMS.map(p => ({ id: p, label: t(PARAM[p].label) }))} value={custom} onChange={v => setCustom(v as ParamKey[])} /></div>}
        {syncNav && <div className="mt-3 text-xs"><div className="mb-1 font-medium text-mute">{t('Charts with linked navigation')}</div>
          <Chips options={ALL_PARAMS.map(p => ({ id: p, label: t(PARAM[p].label) }))} value={navSet} onChange={v => set({ navSet: v as ParamKey[] })} /></div>}
        <div className="mt-3 border-t border-line pt-3 text-xs">
          <div className="mb-1 font-medium text-mute">{t('Show parameters')}</div>
          <Chips options={ALL_PARAMS.map(p => ({ id: p, label: <>{t(PARAM[p].label)}{!hasData(p) && <span className="text-mute"> · {t('no data')}</span>}</> }))} value={visible} onChange={v => set({ visible: v as ParamKey[] })} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-mute">
          {series.map(s => <span key={s.wellId} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} /><span className="text-ink">{s.name}</span> · {s.on.length} {t('drilling records')}</span>)}
          <span>○ {t('hollow point = depth spread across one report entry')}</span>
          <span>{t('Click a point to select · drag or Shift + wheel to pan · Ctrl + wheel to zoom · ← → step')}</span>
        </div>
        {active && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-cyan-500/30 bg-cyan-500/5 px-3 py-1.5 text-xs">
          <span className="text-mute">{t('Selected')}:</span><b>{t(PARAM[active.origin].label)}</b> @ <b className="num">{keyTxt(active.key)}</b>
          <span className="text-mute">· {t('synchronized with')} {syncTargets(active.origin, mode, custom).filter(p => p !== active.origin && visible.includes(p)).map(p => t(PARAM[p].label)).join(', ') || t('no other chart')}</span>
          <button className="ms-auto text-cyan-300 hover:underline 2xl:hidden" onClick={() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{t('View analysis')} ↓</button>
          <button className="text-mute hover:text-ink" onClick={() => clear(active.origin)}>{t('Clear')}</button>
        </div>}
      </Card>

      <div className="grid items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_minmax(420px,34%)]">
        <div className="min-w-0 space-y-3">
          {!shown.length && <p className="rounded-lg border border-dashed border-line p-6 text-center text-[13px] text-mute">{t('No parameter chart is shown. Choose parameters above.')}</p>}
          {shown.map(p => {
            const size = sizes[p] ?? 'normal', isMax = max === p, s = sel[p] ?? null;
            const group = syncTargets(p, mode, custom);
            return (
              <section key={p} aria-label={t(PARAM[p].label)} className={cx('rounded-lg border border-line bg-panel/95', isMax && 'fixed inset-2 z-50 flex flex-col shadow-2xl sm:inset-6')}>
                <header className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <h4 className="text-[13px] font-semibold">{t(PARAM[p].label)} <span className="font-normal text-mute">({p === 'rop' ? U.rl : PARAM[p].unit})</span></h4>
                  {group.length > 1 ? <Badge color="cyan">{t('Synced selection')}</Badge> : <Badge>{t('Independent')}</Badge>}
                  {syncNav && navSet.includes(p) && <Badge color="magenta">{t('Linked navigation')}</Badge>}
                  {s && <span className="text-[11px] text-mute">● <span className="num text-ink">{keyTxt(s.key)}</span>{s.origin !== p && ` (${t('from')} ${t(PARAM[s.origin].label)})`}</span>}
                  <div className="ms-auto flex items-center gap-0.5">
                    <IconBtn label={t('Reset zoom')} onClick={() => resetZoom(p)}><RotateCcw size={13} /></IconBtn>
                    {!isMax && <IconBtn label={size === 'expanded' ? t('Normal height') : t('Expand')} onClick={() => setSize(p, size === 'expanded' ? 'normal' : 'expanded')}><ChevronsUpDown size={13} /></IconBtn>}
                    {!isMax && <IconBtn label={size === 'collapsed' ? t('Show chart') : t('Collapse')} onClick={() => setSize(p, size === 'collapsed' ? 'normal' : 'collapsed')}>{size === 'collapsed' ? <ChevronDown size={13} /> : <ChevronUp size={13} />}</IconBtn>}
                    <IconBtn label={isMax ? t('Restore') : t('Maximize')} onClick={() => setMax(isMax ? null : p)}>{isMax ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</IconBtn>
                    <IconBtn label={t('Hide')} onClick={() => { if (isMax) setMax(null); set({ visible: visible.filter(x => x !== p) }); }}><EyeOff size={13} /></IconBtn>
                  </div>
                </header>
                {(size !== 'collapsed' || isMax) && (
                  <div className={cx('px-2 pb-2', isMax ? 'min-h-0 flex-1' : size === 'expanded' ? 'h-[440px]' : 'h-[210px] sm:h-[250px]')}>
                    {hasData(p)
                      ? <ParamChart p={p} series={chartData[p]} axis={axis} U={U} t={t} sel={s} isOrigin={!!s && s.origin === p} tol={tol} zoom={zooms.current.get(p) ?? null}
                          onPick={pick} onStep={step} onClear={clear} onZoom={onZoom} register={register} label={`${t(PARAM[p].label)} ${t('chart')}`} />
                      : <div className="flex h-full items-center justify-center text-[13px] text-mute">{t('Not recorded in the selected wells.')}</div>}
                  </div>
                )}
              </section>
            );
          })}
          {max && <div className="fixed inset-0 z-40 bg-black/70" onClick={() => setMax(null)} />}
        </div>
        <div ref={panelRef} className="min-w-0 scroll-mt-4 2xl:sticky 2xl:top-4 2xl:max-h-[calc(100vh-2rem)] 2xl:overflow-y-auto 2xl:overscroll-contain">
          <PointAnalysisPanel sel={active} series={series} axis={axis} eqs={extra.data?.eqs ?? NO_EQ} trajs={extra.data?.trajs ?? NO_TRAJ} core={core} canon={canon}
            actions={extra.data?.actions ?? NO_ACT} tol={tol} loading={extra.loading} onStep={d => active && step(active.origin, d)} onClear={() => active && clear(active.origin)} />
          {extra.error && <p className="mt-2 text-xs text-rose-300">{extra.error}</p>}
        </div>
      </div>
    </div>
  );
}

const IconBtn = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded p-1.5 text-mute hover:bg-white/5 hover:text-ink">{children}</button>
);
