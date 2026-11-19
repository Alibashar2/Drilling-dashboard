import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import * as repo from '../db/repo';
import { useAuth, usePrefs } from '../lib/context';
import { loadCore } from '../lib/data';
import { depthBasis, paramSnapshot, progressCurve, runPerf, segments, type ParamStat } from '../lib/kpi';
import { colorRank, matchProblems, matchTypes, type CurrentContext, type Match } from '../lib/matching';
import { interpAtMd, type TrajPoint } from '../lib/survey';
import { actName, type DrillingProblem, type HistoricalAlert, type Rec } from '../lib/types';
import { fmt, fmtDateTime, isoDay } from '../lib/units';
import { axis, chartBase, EChart } from '../components/EChart';
import RigState from '../components/RigState';
import Schematic from '../components/Schematic';
import { ProblemReport, SEV_COLOR } from '../components/ProblemPanels';
import { CasingCementing, CorrectOperation, CurrentOperation, CurrentProblems, HoleSectionCard, OP_COLOR_LEGEND, OperationsTimeline, ToolsPanel } from '../components/SimPanels';
import { bhaAt, currentWellAlerts, historicalTone, materialized, operationAt, sectionAt, toolsAt, type CurrentAlert, type Equip } from '../lib/simContext';
import { OP_CATEGORIES, OP_TYPE } from '../lib/operations';
import type { Operation, SimEvent } from '../lib/types';
import { Badge, Button, Card, Chips, cx, Empty, Input, Modal, Notice, Select, Spinner, Stat, useAction, useAsync } from '../components/ui';

/** Trace definitions. Colours follow the reference dashboard's accents; each parameter keeps its colour everywhere. */
const TRACES = [
  { key: 'hole', label: 'Hole Depth', color: '#cbd5e1', track: 0, kind: 'depth' },
  { key: 'bit_depth_ft', label: 'Bit Depth', color: '#f59e0b', track: 0, kind: 'depth' },
  { key: 'rop_fph', label: 'ROP', color: '#f43f5e', track: 1, kind: 'rop' },
  { key: 'wob_klb', label: 'WOB', color: '#22c55e', track: 1, unit: 'klb' },
  { key: 'rpm', label: 'RPM', color: '#22d3ee', track: 2, unit: 'rpm' },
  { key: 'torque_ftlb', label: 'Torque', color: '#fb923c', track: 2, unit: 'ft-lb' },
  { key: 'spp_psi', label: 'Standpipe Pressure', color: '#a78bfa', track: 3, unit: 'psi' },
  { key: 'flow_gpm', label: 'Flow Rate', color: '#38bdf8', track: 3, unit: 'gpm' },
  { key: 'diff_pressure_psi', label: 'Differential Pressure', color: '#e879f9', track: 4, unit: 'psi' },
] as const;
type TraceKey = (typeof TRACES)[number]['key'];
const TRACK_NAMES = ['Depth', 'ROP · WOB', 'RPM · Torque', 'SPP · Flow', 'Diff. Pressure'];
// Historical offset warnings use amber tones only: red is reserved for problems actually recorded in the current well.
const PANEL = {
  green: { cls: 'border-emerald-500/40 bg-emerald-500/5', text: 'No significant historical risk found' },
  yellow: { cls: 'border-yellow-500/50 bg-yellow-500/5', text: 'Historical problem recorded in a nearby interval or formation' },
  orange: { cls: 'border-orange-500/60 bg-orange-500/10', text: 'Multiple similar historical problems' },
  red: { cls: 'border-orange-400/90 bg-orange-500/15', text: 'Critical proximity to a previously problematic interval' },
} as const;
const HIST_BADGE = { yellow: 'yellow', orange: 'orange', critical: 'orange' } as const;
const EMPTY_EQ: Equip = { operations: [], runs: [], tools: [], casings: [], cementing: [], sections: [] };

export default function Simulation() {
  const { t, U } = usePrefs();
  const { canWrite, user } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();

  const base = useAsync(async () => {
    const [core, formations, intervals, cfg, session, actions] = await Promise.all([loadCore(), repo.listFormations(), repo.listIntervals(), repo.getAlertConfig(), repo.getSimSession(), repo.listActions()]);
    return { core, formations, intervals, cfg, session, actions, canon: repo.canonResolver(formations) };
  }, []);
  const withData = useMemo(() => base.data?.core.summaries.filter(s => s.finalDepth != null) ?? [], [base.data]);
  const wellId = params.get('well') ?? (withData.some(s => s.well.id === base.data?.session?.well_id) ? base.data!.session!.well_id! : (withData.find(s => s.well.status === 'active') ?? withData[0])?.well.id) ?? null;
  const well = base.data?.core.well.get(wellId ?? '');

  const wd = useAsync(async () => {
    if (!wellId) return null;
    const [recs, survey, sections, alerts, eq, simEvents] = await Promise.all([repo.getRecords(wellId), repo.getSurvey(wellId), repo.getSections(wellId), repo.listAlerts(wellId), repo.getEquipment(wellId), repo.listSimEvents(wellId)]);
    return { wellId, recs, survey, sections, alerts, eq, simEvents };
  }, [wellId]);
  const eq: Equip = wd.data?.wellId === wellId ? wd.data!.eq : EMPTY_EQ;
  const recs: Rec[] = wd.data?.wellId === wellId ? wd.data!.recs : [];

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [windowH, setWindowH] = useState(24);
  const [rigRange, setRigRange] = useState<'24h' | 'day' | 'all'>('24h');
  const [selected, setSelected] = useState<TraceKey[]>(TRACES.map(x => x.key));
  const [offsets, setOffsets] = useState<string[] | null>(null);
  const [goDepth, setGoDepth] = useState('');
  const [alerts, setAlerts] = useState<Record<string, HistoricalAlert>>({});
  const [openMatch, setOpenMatch] = useState<string | null>(null);
  const [openEvent, setOpenEvent] = useState<DrillingProblem | null>(null);
  const [simEvents, setSimEvents] = useState<Record<string, SimEvent>>({});
  const [fixOp, setFixOp] = useState<Operation | null>(null);
  const [opsRange, setOpsRange] = useState<'24h' | 'day' | 'all'>('24h');
  const opAct = useAction();
  const pending = useRef(new Set<string>());

  // initialise the playhead when a well's data arrives
  const initFor = useRef<string | null>(null);
  useEffect(() => {
    if (!wd.data || wd.data.wellId !== wellId) return;
    setSimEvents(Object.fromEntries(wd.data.simEvents.map(e => [e.problem_id, e])));
    if (initFor.current === wellId) return;   // a reload of the same well (e.g. after a correction) keeps the playhead where it is
    initFor.current = wellId;
    const s = base.data?.session, r = wd.data.recs;
    let i = well?.status === 'active' ? r.length - 1 : 0;
    if (s?.well_id === wellId && s.playhead_ts) { const ts = new Date(s.playhead_ts).getTime(); const k = r.findIndex(x => x.t >= ts); if (k >= 0) i = k; }
    setIdx(Math.max(0, i)); setPlaying(false);
    if (s?.well_id === wellId && s.speed) setSpeed(s.speed);
    setAlerts(Object.fromEntries(wd.data.alerts.map(a => [a.problem_id, a])));
    pending.current.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wd.data]);

  // playback clock
  useEffect(() => {
    if (!playing || !recs.length) return;
    const id = setInterval(() => setIdx(i => { const n = Math.min(i + speed, recs.length - 1); if (n >= recs.length - 1) setPlaying(false); return n; }), 300);
    return () => clearInterval(id);
  }, [playing, speed, recs.length]);

  const cur: Rec | undefined = recs[Math.min(idx, recs.length - 1)];

  // remember the playback position for this user
  useEffect(() => {
    if (playing || !cur || !wellId) return;
    const id = setTimeout(() => { repo.saveSimSession({ well_id: wellId, playhead_ts: cur.ts, speed }).catch(() => undefined); }, 900);
    return () => clearTimeout(id);
  }, [playing, idx, wellId, speed, cur]);

  const days = useMemo(() => {
    const out: { day: string; first: number }[] = [];
    recs.forEach((r, i) => { const d = isoDay(r.t); if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, first: i }); });
    return out;
  }, [recs]);
  const dayNo = cur ? days.findIndex(d => d.day === isoDay(cur.t)) : -1;
  const segs = useMemo(() => segments(recs), [recs]);
  const traj: TrajPoint[] = useMemo(() => (wd.data?.survey ?? []).map(s => ({ md: s.md_ft, inc: s.inclination_deg, azi: s.azimuth_deg, tvd: s.tvd_ft ?? s.md_ft, north: s.north_ft ?? 0, east: s.east_ft ?? 0, hd: Math.hypot(s.north_ft ?? 0, s.east_ft ?? 0) })), [wd.data]);
  const basis = useMemo(() => depthBasis(recs), [recs]);

  const run = useMemo(() => {
    if (!cur) return null;
    let a = idx;
    while (a > 0 && recs[a - 1].bha_number === cur.bha_number) a--;
    return runPerf(recs.slice(a, idx + 1));
  }, [recs, idx, cur]);

  // ---- historical risk matching at the playhead
  const ctx: CurrentContext | null = useMemo(() => {
    if (!cur || !well || !base.data) return null;
    const tvd = cur.tvd_ft ?? (traj.length > 1 ? interpAtMd(traj, cur.hole)!.tvd : null);
    return {
      wellId: well.id, md: cur.hole, tvd, formation: cur.formation_name,
      upcoming: base.data.intervals.filter(i => i.well_id === well.id && i.top_md_ft > cur.hole).map(i => ({ name: i.formation_name, topMd: i.top_md_ft })),
      holeSize: cur.hole_size_in ?? well.hole_size_in, wellType: well.well_type, activity: cur.activity_code, bha: cur.bha_number,
      mudWeight: cur.mud_weight_ppg, params: paramSnapshot(recs, idx),
    };
  }, [cur, well, base.data, traj, recs, idx]);
  const result = useMemo(() => {
    if (!ctx || !base.data) return null;
    const { core, cfg, canon } = base.data;
    const hist = core.problems.map(p => ({ problem: p, well: core.well.get(p.well_id)!, categoryName: core.cat.get(p.category_id)?.name ?? 'Other Problems' })).filter(h => h.well);
    return matchProblems(ctx, hist, cfg, canon, core.summaries.filter(s => s.well.id !== ctx.wellId && s.finalDepth != null).length);
  }, [ctx, base.data]);

  // store new / escalated alerts (Engineers and Administrators only)
  const sig = result?.matches.map(m => `${m.problem.id}:${m.color}`).join('|') ?? '';
  useEffect(() => {
    if (!result || !canWrite || !ctx) return;
    for (const m of result.matches) {
      const id = m.problem.id, ex = alerts[id];
      if (pending.current.has(id)) continue;
      const body = { well_id: ctx.wellId, problem_id: id, level: m.color, match_types: matchTypes(m), similarity: m.similarity, reasons: m.reasons, trigger_md_ft: ctx.md };
      if (!ex) {
        pending.current.add(id);
        repo.createAlert(body).then(a => setAlerts(s => ({ ...s, [id]: a }))).catch(() => undefined).finally(() => pending.current.delete(id));
      } else if (colorRank(m.color) > colorRank(ex.level)) {
        pending.current.add(id);
        repo.updateAlert(ex.id, body).then(() => setAlerts(s => ({ ...s, [id]: { ...ex, ...body } }))).catch(() => undefined).finally(() => pending.current.delete(id));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, canWrite]);

  // ---- operation, hole section, BHA and equipment at the playhead; problems recorded in THIS well
  const op = useMemo(() => (cur ? operationAt(eq.operations, cur.t) : null), [eq, cur]);
  const section = useMemo(() => (cur ? sectionAt(eq.sections, cur.t, cur.hole) : null), [eq, cur]);
  const runNow = useMemo(() => (cur ? (op?.bha_run_id ? eq.runs.find(r => r.id === op.bha_run_id) ?? null : bhaAt(eq.runs, cur.t)) : null), [eq, cur, op]);
  const toolView = useMemo(() => (cur ? toolsAt(eq, op, cur.t) : null), [eq, op, cur]);
  const currentAlerts: CurrentAlert[] = useMemo(() => (cur && base.data && well ? currentWellAlerts(base.data.core.problems, eq.operations, recs, well.id, cur.t) : []), [cur, base.data, well, eq, recs]);
  // a current-well alert is stored once, the first time the replay reaches it; afterwards it is shown with its review state, never re-raised
  const activeSig = currentAlerts.filter(a => a.active).map(a => a.problem.id).join('|');
  useEffect(() => {
    if (!canWrite || !wellId) return;
    for (const a of currentAlerts.filter(x => x.active)) {
      const id = a.problem.id;
      if (simEvents[id] || pending.current.has(`ev:${id}`)) continue;
      pending.current.add(`ev:${id}`);
      repo.upsertSimEvent({ well_id: wellId, problem_id: id }).then(e => setSimEvents(s => ({ ...s, [id]: e }))).catch(() => undefined).finally(() => pending.current.delete(`ev:${id}`));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSig, canWrite]);
  const patchEvent = (problemId: string, patch: Partial<SimEvent>) => {
    if (!wellId) return;
    const comments = patch.comments?.map(c => ({ ...c, by: c.by || user?.email || '' }));
    const next = { ...(simEvents[problemId] ?? {}), ...patch, ...(comments ? { comments } : {}), well_id: wellId, problem_id: problemId };
    repo.upsertSimEvent(next).then(e => setSimEvents(s => ({ ...s, [problemId]: e }))).catch(() => undefined);
  };
  const [openCurrent, setOpenCurrent] = useState<CurrentAlert | null>(null);

  // ---- time traces (strip-log tracks; every trace is auto-scaled within its track, values are read from the tooltip and KPI tiles)
  const traceOpt = useMemo(() => {
    if (!cur) return {};
    const t1 = cur.t, t0 = t1 - windowH * 3600000;
    let a = idx; while (a > 0 && recs[a - 1].t >= t0) a--;
    const win = recs.slice(a, idx + 1);
    const on = TRACES.filter(x => selected.includes(x.key));
    const tracks = [...new Set(on.map(x => x.track))].sort();
    const n = Math.max(tracks.length, 1), left0 = 9, wEach = (100 - left0 - 1) / n;
    const conv = (x: (typeof TRACES)[number], v: number | null) => (v == null ? null : 'kind' in x ? Math.round(U.d(v)! * 10) / 10 : v);
    return chartBase({
      legend: { show: false },
      tooltip: {
        trigger: 'axis', backgroundColor: '#0b1826', borderColor: '#22364b', textStyle: { color: '#dde8f3', fontSize: 12 }, confine: true,
        formatter: (ps: { marker: string; seriesName: string; value: [number | null, number] }[]) => !ps.length ? '' :
          `<b>${fmtDateTime(ps[0].value[1])}</b><br/>` + ps.map(p => `${p.marker}${p.seriesName}: <b>${p.value[0] == null ? '—' : p.value[0].toLocaleString('en-US')}</b>`).join('<br/>'),
      },
      axisPointer: { link: [{ yAxisIndex: 'all' }], lineStyle: { color: '#5b7590' } },
      grid: tracks.map((_, i) => ({ left: `${left0 + i * wEach}%`, width: `${wEach - 1.2}%`, top: 6, bottom: 8, show: true, borderColor: '#1b2c3f', backgroundColor: 'rgba(5,11,20,0.5)' })),
      yAxis: tracks.map((_, i) => ({ gridIndex: i, type: 'time', inverse: true, min: t0, max: t1, ...axis({ axisLabel: { show: i === 0, color: '#8499ae', fontSize: 10, formatter: (v: number) => new Date(v).toISOString().slice(11, 16) }, splitLine: { lineStyle: { color: '#101d2c' } } }) })),
      xAxis: on.map(x => ({ gridIndex: tracks.indexOf(x.track), type: 'value', scale: true, show: false, inverse: 'kind' in x && x.kind === 'depth' ? false : false })),
      series: on.map((x, i) => ({
        type: 'line', name: `${t(x.label)} (${'kind' in x ? (x.kind === 'depth' ? U.dl : U.rl) : x.unit})`, xAxisIndex: i, yAxisIndex: tracks.indexOf(x.track), showSymbol: false,
        lineStyle: { width: 1.3, color: x.color }, itemStyle: { color: x.color }, connectNulls: false,
        data: win.map(r => [conv(x, r[x.key as keyof Rec] as number | null), r.t]),
      })),
    });
  }, [recs, idx, cur, windowH, selected, U, t]);

  // ---- offset performance (bit/hole depth vs drilling days)
  const offsetIds = offsets ?? withData.filter(s => s.well.id !== wellId).slice(0, 5).map(s => s.well.id);
  const dayFloor = cur && recs.length ? Math.floor((cur.t - recs[0].t) / 3600000) : 0;
  const offsetOpt = useMemo(() => {
    if (!base.data || !cur) return {};
    const { core } = base.data;
    const mk = (name: string, color: string, data: [number, number][], width: number) => ({ type: 'line', name, showSymbol: false, lineStyle: { width, color }, itemStyle: { color }, data: data.map(([d, md]) => [Math.round(d * 100) / 100, Math.round(U.d(md)!)]) });
    const series = [mk(well?.name ?? '', core.color(wellId!), progressCurve(recs.slice(0, idx + 1), 250), 3)];
    for (const id of offsetIds) {
      const rs = core.reports.filter(r => r.well_id === id);
      if (!rs.length) continue;
      let h = 0; const pts: [number, number][] = [[0, rs[0].start_md_ft ?? 0]];
      for (const r of rs) { h += r.total_hours; pts.push([h / 24, r.end_md_ft ?? 0]); }
      series.push(mk(core.well.get(id)!.name, core.color(id), pts, 1.6));
    }
    return chartBase({
      grid: { left: 6, right: 12, top: 44, bottom: 22, containLabel: true },
      legend: { textStyle: { color: '#8499ae', fontSize: 10 }, top: 0, icon: 'roundRect', itemWidth: 8, itemHeight: 8, type: 'scroll' },
      xAxis: { type: 'value', name: t('Days'), nameLocation: 'middle', nameGap: 20, min: 0, ...axis() },
      yAxis: { type: 'value', inverse: true, name: `${t('Depth')} (${U.dl})`, nameLocation: 'start', ...axis() },
      series,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.data, offsetIds.join(','), dayFloor, wellId, U, recs]);

  if (base.loading && !base.data) return <Spinner label={t('Loading…')} />;
  if (base.error) return <Notice kind="error">{base.error}</Notice>;
  if (!withData.length) return <Empty title={t('No drilling data to simulate')} text={t('Add a well with drilling data, or load the sample dataset from Home or Settings.')} action={<Button variant="primary" onClick={() => nav('/')}>{t('Go to Home')}</Button>} />;
  if ((wd.loading && !recs.length) || !cur || !well || !result || !ctx) return <Spinner label={t('Loading drilling records…')} />;

  const core = base.data!.core;
  const go = (i: number) => setIdx(Math.max(0, Math.min(recs.length - 1, i)));
  const stepDay = (d: number) => { const k = Math.max(0, Math.min(days.length - 1, dayNo + d)); go(days[k].first); };
  const jumpDepth = () => { const v = Number(goDepth); if (!goDepth.trim() || isNaN(v)) return; const ft = U.toFt(v); const k = recs.findIndex(r => r.hole >= ft); go(k < 0 ? recs.length - 1 : k); };
  const rig = rigRange === 'all' ? [recs[0].t, recs[recs.length - 1].t + 1] : rigRange === 'day' ? [Date.parse(isoDay(cur.t) + 'T00:00:00Z'), Date.parse(isoDay(cur.t) + 'T00:00:00Z') + 86400000] : [cur.t - 86400000, cur.t];
  const target = well.target_depth_ft;
  const tvd = ctx.tvd;
  const events = core.problems.filter(p => p.well_id === well.id && (p.occurred_at ? new Date(p.occurred_at).getTime() <= cur.t : p.md_top_ft <= cur.hole));
  const om = result.matches.find(m => m.problem.id === openMatch);
  const range = (s: ParamStat, d = 1) => (s.min == null ? '—' : `${fmt(s.min, d)} – ${fmt(s.max, d)}`);
  const kpis: { label: string; v: string; unit: string; color: string }[] = [
    { label: 'Bit Depth', v: cur.bit_depth_ft == null ? '—' : U.fd(cur.bit_depth_ft, 1), unit: U.dl, color: '#f59e0b' },
    { label: 'ROP', v: U.fr(cur.rop_fph), unit: U.rl, color: '#f43f5e' },
    { label: 'WOB', v: fmt(cur.wob_klb, 2), unit: 'klb', color: '#22c55e' },
    { label: 'RPM', v: fmt(cur.rpm, 0), unit: 'rpm', color: '#22d3ee' },
    { label: 'Differential Pressure', v: fmt(cur.diff_pressure_psi, 0), unit: 'psi', color: '#e879f9' },
    { label: 'Torque', v: fmt(cur.torque_ftlb, 0), unit: 'ft-lb', color: '#fb923c' },
    { label: 'Flow Rate', v: fmt(cur.flow_gpm, 0), unit: 'gpm', color: '#38bdf8' },
    { label: 'Mud Weight', v: fmt(cur.mud_weight_ppg, 1), unit: 'ppg', color: '#a78bfa' },
  ];
  const activeTracks = [...new Set(TRACES.filter(x => selected.includes(x.key)).map(x => x.track))].sort();

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------ controls */}
      <div className="rounded-lg border border-line bg-panel/90 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="me-2 text-base font-semibold">{t('Live Operations Overview')}</h1>
          <Select aria-label={t('Well')} className="h-8 w-52" value={well.id} onChange={e => { setOffsets(null); setParams({ well: e.target.value }); }}>
            {withData.map(s => <option key={s.well.id} value={s.well.id}>{s.well.name}</option>)}
          </Select>
          <Select aria-label={t('Drilling date')} className="h-8 w-36" value={isoDay(cur.t)} onChange={e => go(days.find(d => d.day === e.target.value)?.first ?? 0)}>
            {days.map((d, i) => <option key={d.day} value={d.day}>{d.day} · {t('Day')} {i + 1}</option>)}
          </Select>
          <div className="flex items-center gap-1" dir="ltr">
            <Button size="sm" onClick={() => stepDay(-1)} title={t('Previous day')} aria-label={t('Previous day')}><SkipBack size={14} /></Button>
            <Button size="sm" variant="primary" onClick={() => { if (idx >= recs.length - 1) go(0); setPlaying(p => !p); }} className="w-24">
              {playing ? <><Pause size={14} />{t('Pause')}</> : <><Play size={14} />{t('Play')}</>}
            </Button>
            <Button size="sm" onClick={() => stepDay(1)} title={t('Next day')} aria-label={t('Next day')}><SkipForward size={14} /></Button>
          </div>
          <Select aria-label={t('Simulation speed')} className="h-8 w-24" value={speed} onChange={e => setSpeed(Number(e.target.value))}>
            {[1, 2, 5, 10, 30].map(s => <option key={s} value={s}>{s}× {t('speed')}</option>)}
          </Select>
          <div className="flex items-center gap-1">
            <Input aria-label={t('Go to depth')} className="h-8 w-28" placeholder={`${t('Go to depth')} (${U.dl})`} value={goDepth} onChange={e => setGoDepth(e.target.value)} onKeyDown={e => e.key === 'Enter' && jumpDepth()} inputMode="decimal" />
            <Button size="sm" onClick={jumpDepth}>{t('Go')}</Button>
          </div>
          <div className="flex-1" />
          {well.is_demo && <Badge color="magenta">{t('SAMPLE DATA')}</Badge>}
          {cur.data_quality === 'interpolated' && <span title={`${t('Source location')}: ${cur.source_ref ?? ''}`}><Badge color="yellow">{t('Interpolated from daily report')}</Badge></span>}
          <Badge color={playing ? 'green' : 'gray'}>{playing ? t('Replaying') : t('Paused')}</Badge>
          <span className="num text-xs text-mute" dir="ltr">{fmtDateTime(cur.t)} UTC · {t('Day')} {dayNo + 1}/{days.length}</span>
        </div>
        <input type="range" dir="ltr" aria-label={t('Timeline')} className="mt-2 w-full" min={0} max={recs.length - 1} value={idx} onChange={e => { setPlaying(false); go(Number(e.target.value)); }} />
      </div>

      {/* ------------------------------------------------ two independent alert systems */}
      <div className="grid gap-3 xl:grid-cols-2">
        <CurrentProblems alerts={currentAlerts} events={simEvents} wellName={well.name} catName={id => core.cat.get(id)?.name ?? 'Other Problems'} actions={base.data!.actions} U={U} canWrite={canWrite}
          onOpen={a => setOpenCurrent(a)} onEvent={patchEvent} tvdAt={md => (traj.length > 1 ? interpAtMd(traj, md)?.tvd ?? null : null)} />
        <section className={cx('rounded-lg border p-3', PANEL[result.panelColor].cls)} aria-label={t('Historical risk alerts')}>
          <div className="flex flex-wrap items-center gap-2">
            <b className="text-[13px] tracking-wide text-orange-200">{t('HISTORICAL OFFSET WELLS – PREVIOUS PROBLEM WARNINGS')}</b>
            <span className="text-xs font-semibold">{t(PANEL[result.panelColor].text)}</span>
            <span className="text-xs text-mute">· {result.matches.length} {t('historical risk indicator(s)')} · {result.consideredProblems} {t('historical problems from')} {result.historicalWells} {t('other well(s) checked')}</span>
          </div>
          {result.limited && <p className="mt-1 text-xs text-yellow-200">{t('Limited risk assessment: only')} {result.historicalWells} {t('other well(s) with drilling history are available, so the absence of alerts does not indicate low risk.')}</p>}
          {result.matches.length > 0 && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {[...result.matches].sort((a, b) => Number((alerts[a.problem.id]?.status ?? 'new') !== 'new') - Number((alerts[b.problem.id]?.status ?? 'new') !== 'new')).slice(0, 6).map(m => {
                const a = alerts[m.problem.id], tone = historicalTone(m.color), seen = a && a.status !== 'new';
                const mat = materialized(m.problem, currentAlerts), acts = base.data!.actions.filter(x => x.problem_id === m.problem.id);
                return (
                  <button key={m.problem.id} onClick={() => setOpenMatch(m.problem.id)} className={cx('rounded-md border p-2.5 text-start text-xs hover:border-orange-300', tone === 'critical' ? 'border-orange-400/80 bg-orange-950/40' : tone === 'orange' ? 'border-orange-500/50 bg-panel/80' : 'border-yellow-500/50 bg-panel/80', seen && 'opacity-70')}>
                    <div className="flex items-center gap-1.5"><Badge color={HIST_BADGE[tone]}>{t(tone === 'critical' ? 'critical proximity' : tone)}</Badge><b className="flex-1 truncate">{t('HISTORICAL OFFSET WELL – PREVIOUS PROBLEM WARNING')}</b><span className="num" title={t('Similarity score')}>{m.similarity}%</span></div>
                    <dl className="num mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-mute">
                      <div><dt className="inline">{t('Current well')}: </dt><dd className="inline text-ink">{well.name}</dd></div>
                      <div><dt className="inline">{t('Historical well')}: </dt><dd className="inline text-ink">{m.well.name}</dd></div>
                      <div><dt className="inline">{t('Previous problem')}: </dt><dd className="inline text-ink">{t(m.categoryName)}</dd></div>
                      <div><dt className="inline">{t('Historical formation')}: </dt><dd className="inline text-ink">{m.problem.formation_name ?? '—'}</dd></div>
                      <div><dt className="inline">{t('Historical depth')}: </dt><dd className="inline text-ink">{U.fdu(m.problem.md_top_ft)}</dd></div>
                      <div><dt className="inline">{t('Current depth')}: </dt><dd className="inline text-ink">{U.fdu(cur.hole)}</dd></div>
                      <div className="col-span-2"><dt className="inline">{t('Depth difference')}: </dt><dd className="inline text-ink">{U.fd(Math.abs(m.problem.md_top_ft - cur.hole))} {U.dl} {m.problem.md_top_ft >= cur.hole ? t('ahead') : t('above the bit (passed)')}</dd></div>
                    </dl>
                    <p className="mt-1 line-clamp-2 text-ink/80">{m.problem.description}</p>
                    {acts.length > 0 && <p className="mt-0.5 line-clamp-2"><span className="text-mute">{t('Previous corrective actions')}:</span> {acts.map(x => x.action_text).join(' · ')}</p>}
                    <p className="mt-0.5 text-[11px] text-mute">{t('Reason for matching')}: {m.reasons.slice(0, 3).join('; ')}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {m.depthLevel && <Badge>{t('depth')}: {t(m.depthLevel)}</Badge>}{m.formationMatch && <Badge>{t('formation')}: {t(m.formationMatch)}</Badge>}
                      {a && <Badge color={a.status === 'new' ? 'yellow' : 'green'}>{t(a.status)}</Badge>}
                      {a && a.outcome !== 'unknown' && <Badge color={a.outcome === 'occurred' ? 'red' : 'green'}>{t(a.outcome === 'occurred' ? 'materialized' : 'did not occur')}</Badge>}
                      {mat && <Badge color="red">{t('a similar problem is recorded in this well')}</Badge>}
                    </div>
                  </button>);
              })}
            </div>
          )}
          {result.matches.length > 0 && <p className="mt-2 text-[11px] text-mute">{t('These are warnings from other wells, not events of this well. Review the previous well\'s corrective actions and monitor the relevant drilling parameters.')}</p>}
        </section>
      </div>

      <div className="grid gap-3 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* ------------------------------------------------ left column */}
        <div className="space-y-3">
          <Card title={<><span className="block text-[11px] font-normal text-mute">{t('Current Well State')}</span>{t('Wellbore Schematic')}</>} right={<Badge color={op?.is_npt ? 'red' : 'yellow'}>{op ? t(OP_TYPE[op.type_code]?.name ?? op.type_code) : t(actName(cur.activity_code))}</Badge>}>
            <div className="relative">
              <Schematic traj={traj} holeDepth={cur.hole} bitDepth={cur.bit_depth_ft} targetDepth={target}
                shoes={eq.casings.length ? eq.casings.filter(c => c.shoe_md_ft != null && c.run_end && Date.parse(c.run_end) <= cur.t).map(c => c.shoe_md_ft!) : wd.data!.sections.map(s => s.bottom_md_ft)} />
              <dl className="num pointer-events-none absolute right-0 top-9 grid grid-cols-2 gap-x-4 gap-y-1.5 text-right text-xs">
                {[
                  [t('Bit Depth'), cur.bit_depth_ft == null ? '—' : U.fdu(cur.bit_depth_ft)], [t('Hole Depth'), U.fdu(cur.hole)],
                  ['TVD', tvd == null ? t('n/a') : U.fdu(tvd)], [t('Hole Size'), ctx.holeSize != null ? `${ctx.holeSize} in` : '—'],
                  [t('Target depth'), U.fdu(target)], [t('Remaining'), target != null ? U.fdu(Math.max(0, target - cur.hole)) : '—'],
                ].map(([k, v]) => <div key={k}><dt className="text-[10px] text-mute">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
                <div className="col-span-2"><dt className="text-[10px] text-mute">{t('Formation')}</dt><dd className="font-semibold">{cur.formation_name ?? t('not recorded')}</dd></div>
                <div className="col-span-2"><dt className="text-[10px] text-mute">{t('Completion')}</dt><dd className="font-semibold">{target ? `${fmt(Math.min(100, (cur.hole / target) * 100), 1)}%` : '—'}</dd></div>
              </dl>
            </div>
            {basis !== 'hole depth' && <p className="mt-1 text-[11px] text-yellow-200">{t('This well has no hole-depth column; hole depth is derived from')} {basis}.</p>}
          </Card>

          <Card title={t('Current Hole Section')} right={section ? `${t('Section')} ${section.section_no}` : undefined}>
            <HoleSectionCard s={section} total={eq.sections.length} U={U} />
          </Card>

          <Card title={t('Offset Performance')} right={t('depth vs drilling days')}>
            <EChart option={offsetOpt} height={250} />
            <div className="mt-2"><Chips options={withData.filter(s => s.well.id !== well.id).map(s => ({ id: s.well.id, label: s.well.name, color: core.color(s.well.id) }))} value={offsetIds} onChange={setOffsets} /></div>
          </Card>

          <Card title={t('Well events so far')} right={`${events.length}`}>
            {events.length ? <ul className="space-y-1.5">{events.map(p => (
              <li key={p.id}><button className="flex w-full items-start gap-2 text-start text-xs hover:text-cyan-200" onClick={() => setOpenEvent(p)}>
                <Badge color={SEV_COLOR[p.severity]}>{t(p.severity)}</Badge>
                <span className="flex-1">{t(core.cat.get(p.category_id)?.name ?? '')} @ {U.fdu(p.md_top_ft)}<span className="num block text-[11px] text-mute">{fmtDateTime(p.occurred_at)} · NPT {fmt(p.npt_hours, 1)} h</span></span>
              </button></li>))}</ul> : <p className="text-xs text-mute">{t('No problems recorded on this well up to the current time.')}</p>}
          </Card>
        </div>

        {/* ------------------------------------------------ right column */}
        <div className="min-w-0 space-y-3">
          <Card title={<>{t('Rig State')} <span className="font-normal text-mute">· {t(rigRange === '24h' ? 'Last 24 Hours' : rigRange === 'day' ? 'Selected day' : 'Entire well')}</span></>}
            right={<Select aria-label={t('Period')} className="h-7 w-36 text-xs" value={rigRange} onChange={e => setRigRange(e.target.value as typeof rigRange)}><option value="24h">{t('Last 24 Hours')}</option><option value="day">{t('Selected day')}</option><option value="all">{t('Entire well')}</option></Select>}>
            <RigState segs={segs} t0={rig[0]} t1={rig[1]} cursor={rigRange === '24h' ? undefined : cur.t} />
          </Card>

          <Card title={t('Operations Timeline')} right={<Select aria-label={t('Period')} className="h-7 w-36 text-xs" value={opsRange} onChange={e => setOpsRange(e.target.value as typeof opsRange)}><option value="24h">{t('Last 24 Hours')}</option><option value="day">{t('Selected day')}</option><option value="all">{t('Entire well')}</option></Select>}>
            {(() => {
              const w = opsRange === 'all' ? [Date.parse(eq.operations[0]?.start_at ?? '') || recs[0].t, Date.parse(eq.operations[eq.operations.length - 1]?.end_at ?? '') || recs[recs.length - 1].t]
                : opsRange === 'day' ? [Date.parse(isoDay(cur.t) + 'T00:00:00Z'), Date.parse(isoDay(cur.t) + 'T00:00:00Z') + 86400000] : [cur.t - 86400000 + 3600000 * 2, cur.t + 3600000 * 2];
              return <>
                <OperationsTimeline ops={eq.operations} t0={w[0]} t1={w[1]} cursor={cur.t} onPick={o => { setPlaying(false); const k = recs.findIndex(r => r.t >= Date.parse(o.start_at)); go(k < 0 ? recs.length - 1 : k); }} />
                {eq.operations.length > 0 && <div className="mt-1.5"><OP_COLOR_LEGEND cats={OP_CATEGORIES.filter(c => eq.operations.some(o => o.category === c))} /></div>}
                <div className="mt-2"><CurrentOperation op={op} run={runNow} U={U} canWrite={canWrite} onCorrect={setFixOp} /></div>
              </>;
            })()}
          </Card>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_230px]">
            <Card title={t('Time Traces')} right={<Select aria-label={t('Window')} className="h-7 w-32 text-xs" value={windowH} onChange={e => setWindowH(Number(e.target.value))}>{[2, 6, 12, 24, 48].map(h => <option key={h} value={h}>{t('Last')} {h} h</option>)}</Select>}>
              <Chips options={TRACES.map(x => ({ id: x.key, label: t(x.label), color: x.color }))} value={selected} onChange={v => setSelected(v)} />
              {selected.length ? <>
                <div className="mt-2 flex text-[10px] font-semibold uppercase tracking-wider text-mute" dir="ltr" style={{ paddingLeft: '9%', paddingRight: '1%' }}>
                  {activeTracks.map(tr => <div key={tr} className="flex-1 text-center">{t(TRACK_NAMES[tr])}</div>)}
                </div>
                <EChart option={traceOpt} height={360} />
              </> : <p className="py-10 text-center text-[13px] text-mute">{t('Select at least one parameter.')}</p>}
            </Card>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              {kpis.map(k => <Stat key={k.label} label={t(k.label)} value={k.v} unit={k.unit} color={k.color} />)}
            </div>
          </div>

          <Card title={t('Drilling Tools & Hole Section Details')} right={t('tools used at the current date, depth and operation')}>
            {toolView && <ToolsPanel view={toolView} op={op} U={U} />}
          </Card>

          <Card title={t('Casing & Cementing Details')} right={t('strings run up to the playhead')}>
            <CasingCementing eq={eq} t={cur.t} U={U} />
          </Card>

          <Card title={t('Run Performance')} right={t('current BHA run, calculated up to the playhead')}>
            {run && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                  <Stat label="BHA" value={run.bha ?? '—'} sub={`${t('Hole Size')} ${run.holeSize ?? '—'} in`} />
                  <Stat label="ROP" value={U.fr(run.rop)} unit={U.rl} sub={`${t('ROP Overall')} ${U.fr(run.ropOverall)} ${U.rl}`} />
                  <Stat label={t('Footage')} value={U.fd(run.footage)} unit={U.dl} />
                  <Stat label={t('Run Time')} value={fmt(run.runHours, 1)} unit="h" />
                  <Stat label={t('Depth In')} value={U.fd(run.depthIn)} unit={U.dl} />
                  <Stat label={t('Depth Out')} value={U.fd(run.depthOut)} unit={U.dl} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
                  <Stat label={`WOB ${t('Avg')}`} value={fmt(run.wob.avg, 1)} unit="klb" sub={`${t('Range')} ${range(run.wob)}`} />
                  <Stat label={`${t('Torque')} ${t('Avg')}`} value={fmt(run.torque.avg, 0)} unit="ft-lb" sub={`${t('Range')} ${range(run.torque, 0)}`} />
                  <Stat label={`RPM ${t('Avg')}`} value={fmt(run.rpm.avg, 1)} unit="rpm" sub={`${t('Range')} ${range(run.rpm, 0)}`} />
                  <Stat label={`${t('Diff. Pressure')} ${t('Avg')}`} value={fmt(run.diff.avg, 0)} unit="psi" sub={`${t('Range')} ${range(run.diff, 0)}`} />
                  <Stat label={`${t('Flow Rate')} ${t('Avg')}`} value={fmt(run.flow.avg, 0)} unit="gpm" sub={`${t('Range')} ${range(run.flow, 0)}`} />
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal open={!!om} onClose={() => setOpenMatch(null)} title={t('Historical problem report')} wide>
        {om && <ProblemReport problem={om.problem} well={om.well} category={core.cat.get(om.problem.category_id)} match={om as Match} ctx={ctx} alert={alerts[om.problem.id]}
          onAlertChanged={a => setAlerts(s => ({ ...s, [a.problem_id]: a }))} onChanged={() => { setOpenMatch(null); base.reload(); }} />}
      </Modal>
      <Modal open={!!openCurrent} onClose={() => setOpenCurrent(null)} title={t('Current well – actual recorded problem')} wide>
        {openCurrent && <ProblemReport problem={openCurrent.problem} well={well} category={core.cat.get(openCurrent.problem.category_id)} onChanged={() => { setOpenCurrent(null); base.reload(); }} />}
      </Modal>
      <Modal open={!!fixOp} onClose={() => setFixOp(null)} title={t('Correct operation')}>
        {fixOp && <>
          {opAct.error && <Notice kind="error" className="mb-2">{opAct.error}</Notice>}
          <CorrectOperation op={fixOp} busy={opAct.busy} onCancel={() => setFixOp(null)} onSave={code => opAct.run(async () => { await repo.correctOperation(fixOp, code, OP_TYPE[code].category); setFixOp(null); wd.reload(); })} />
        </>}
      </Modal>
      <Modal open={!!openEvent} onClose={() => setOpenEvent(null)} title={t('Problem report')} wide>
        {openEvent && <ProblemReport problem={openEvent} well={well} category={core.cat.get(openEvent.category_id)} onChanged={() => { setOpenEvent(null); base.reload(); }} />}
      </Modal>
    </div>
  );
}
