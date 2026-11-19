// Validation table for values read inside report cells: what was found, where (worksheet!cell), as written,
// in the database unit, how it was read and how sure the reader is. Engineers confirm, correct or reject values;
// the extraction is re-run with their corrections before anything is saved.
import { useMemo, useState } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import { usePrefs } from '../lib/context';
import { fmt } from '../lib/units';
import type { Extraction } from '../import/smart/engine';
import { PARAM_KEYS, paramLabel, type Correction } from '../import/smart/incell';
import { Badge, Button, cx, Input, Notice, Select } from './ui';

type Hit = Extraction['cellParams'][number];
const STATUS_COLOR: Record<string, string> = { confirmed: 'green', inferred: 'cyan', suspected: 'yellow', rejected: 'red' };
const PAGE = 60;

const shown = (h: Hit) => (typeof h.value === 'string' ? h.value : h.min != null && h.max != null ? `${fmt(h.min, h.min % 1 ? 2 : 0)}–${fmt(h.max, h.max % 1 ? 2 : 0)}` : fmt(h.value, h.value % 1 ? 3 : 0));
const dbValue = (h: Hit) => (h.canonical == null || typeof h.value === 'string' ? '—' : `${fmt(h.canonical, Math.abs(h.canonical) < 10 ? 2 : Math.abs(h.canonical) < 1000 ? 1 : 0)} ${h.canonicalUnit ?? ''}`.trim());
const needsReview = (h: Hit) => h.status === 'suspected' || (h.confidence < 0.8 && h.status !== 'rejected' && !h.review);

export default function CellValues({ ex, corrections, setCorrections }: { ex: Extraction; corrections: Record<string, Correction>; setCorrections: (c: Record<string, Correction>) => void }) {
  const { t } = usePrefs();
  const [key, setKey] = useState('');
  const [filter, setFilter] = useState<'all' | 'review' | 'reviewed' | 'rejected' | 'identifiers'>('all');
  const [ctx, setCtx] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [showMissed, setShowMissed] = useState(false);
  const hits = ex.cellParams, cov = ex.coverage;
  const th = 'border-b border-line px-2 py-1.5 text-start text-[11px] font-medium uppercase tracking-wide text-mute whitespace-nowrap';
  const td = 'border-b border-line/40 px-2 py-1 align-top';

  // one row per parameter: the validation summary
  const summary = useMemo(() => {
    const m = new Map<string, { key: string; label: string; group: string; n: number; used: number; review: number; conf: number; first: Hit }>();
    for (const h of hits) {
      const e = m.get(h.key) ?? { key: h.key, label: h.label, group: h.group, n: 0, used: 0, review: 0, conf: 0, first: h };
      e.n++; e.conf += h.confidence; if (h.use && h.status !== 'rejected') e.used++; if (needsReview(h)) e.review++;
      if (h.method !== 'negative statement' && e.first.method === 'negative statement') e.first = h;
      m.set(h.key, e);
    }
    return [...m.values()].sort((a, b) => a.group.localeCompare(b.group) || b.n - a.n);
  }, [hits]);
  const contexts = useMemo(() => [...new Set(hits.map(h => h.context))].sort(), [hits]);
  const rows = useMemo(() => hits.filter(h =>
    (!key || h.key === key) && (!ctx || h.context === ctx) &&
    (filter === 'all' ? h.use || h.status === 'rejected' : filter === 'review' ? needsReview(h) : filter === 'reviewed' ? !!h.review && h.review !== 'rejected' : filter === 'rejected' ? h.status === 'rejected' : !h.use && h.status !== 'rejected') &&
    (!q || `${h.text} ${h.line} ${h.src} ${h.label}`.toLowerCase().includes(q.toLowerCase()))), [hits, key, ctx, filter, q]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)), cur = Math.min(page, pages - 1);
  const set = (id: string, c: Correction | null) => { const n = { ...corrections }; if (c) n[id] = { ...n[id], ...c }; else delete n[id]; setCorrections(n); };
  const reviewCount = hits.filter(needsReview).length;
  const highlight = (h: Hit) => {
    const [a, b] = h.span; if (!(b > a) || a >= h.line.length) return <span>{h.line}</span>;
    return <span>{h.line.slice(0, a)}<mark className="rounded-sm bg-cyan-500/25 px-0.5 text-ink">{h.line.slice(a, b)}</mark>{h.line.slice(b)}</span>;
  };

  if (!hits.length) return <p className="text-[13px] text-mute">{t('No parameter values were found inside text cells of this workbook.')}</p>;
  return (
    <div className="space-y-3">
      <Notice>
        {t('Every value below was read inside a cell together with its parameter name (for example "WOB: 2-4 Ton"). Nothing depends on fixed columns or cell positions.')}{' '}
        <b className="num">{cov.cellsScanned.toLocaleString()}</b> {t('text cells read')}, <b className="num">{cov.cellsWithValues.toLocaleString()}</b> {t('with values')}, <b className="num">{cov.values.toLocaleString()}</b> {t('values found')} (<b className="num">{cov.used.toLocaleString()}</b> {t('used')}, <b className="num">{cov.identifiers}</b> {t('identifiers such as serial numbers, not used')}).{' '}
        {reviewCount > 0 && <>{reviewCount} {t('need a look (suspected or confidence below 80%).')} </>}
        {Object.keys(corrections).length > 0 && <>{Object.keys(corrections).length} {t('reviewed by you.')}</>}
      </Notice>

      {cov.missed.length > 0 && (
        <div className="rounded-md border border-yellow-500/40 p-2.5 text-[13px]">
          <button className="flex w-full items-center justify-between text-start" onClick={() => setShowMissed(s => !s)}>
            <span><b className="num">{cov.missed.length}</b> {t('numbers with a drilling unit (psi, lpm, ton, sg …) are not attributed to any parameter.')} <span className="text-mute">{t('They are kept with the import record.')}</span></span>
            <span className="text-xs text-cyan-300">{showMissed ? t('Hide') : t('Show')}</span>
          </button>
          {showMissed && <ul className="mt-2 max-h-56 space-y-1 overflow-auto text-xs">{cov.missed.map((m, i) => (
            <li key={i}><span className="num text-[11px] text-mute" dir="ltr">{m.src}</span> <b className="num">{m.text}</b> <span className="text-mute">— {m.line}</span></li>))}</ul>}
        </div>
      )}

      <div className="overflow-x-auto"><table className="w-full text-[13px]">
        <thead><tr><th className={th}>{t('Parameter')}</th><th className={th}>{t('Values')}</th><th className={th}>{t('Example from the source')}</th><th className={th}>{t('Unit')}</th><th className={th}>{t('Source cell')}</th><th className={th}>{t('Confidence')}</th><th className={th}>{t('Needs review')}</th></tr></thead>
        <tbody>{summary.map(s => (
          <tr key={s.key} className={cx('cursor-pointer hover:bg-white/5', key === s.key && 'bg-cyan-500/10')} onClick={() => { setKey(key === s.key ? '' : s.key); setPage(0); }}>
            <td className={td}><span className="text-[10px] uppercase tracking-wider text-mute">{t(s.group)}</span><br />{t(s.label)}</td>
            <td className={cx(td, 'num')}>{s.n}{s.used !== s.n && <span className="text-mute"> ({s.used} {t('used')})</span>}</td>
            <td className={cx(td, 'max-w-sm truncate text-mute')} title={s.first.text}>{s.first.text}</td>
            <td className={cx(td, 'num')}>{s.first.unitRaw ?? s.first.unit ?? '—'}</td>
            <td className={td}><span className="num text-[11px] text-mute" dir="ltr">{s.first.src}</span></td>
            <td className={cx(td, 'num')}>{Math.round((s.conf / s.n) * 100)}%</td>
            <td className={cx(td, 'num')}>{s.review ? <Badge color="yellow">{s.review}</Badge> : '—'}</td>
          </tr>))}</tbody>
      </table></div>

      <div className="flex flex-wrap items-end gap-2">
        <Select className="h-8 w-56" value={key} onChange={e => { setKey(e.target.value); setPage(0); }}>
          <option value="">{t('All parameters')}</option>{summary.map(s => <option key={s.key} value={s.key}>{t(s.label)} ({s.n})</option>)}
        </Select>
        <Select className="h-8 w-52" value={filter} onChange={e => { setFilter(e.target.value as typeof filter); setPage(0); }}>
          <option value="all">{t('All used values')}</option><option value="review">{t('Needs review')}</option><option value="reviewed">{t('Confirmed / corrected by you')}</option>
          <option value="rejected">{t('Rejected')}</option><option value="identifiers">{t('Identifiers (not used)')}</option>
        </Select>
        <Select className="h-8 w-40" value={ctx} onChange={e => { setCtx(e.target.value); setPage(0); }}>
          <option value="">{t('Any context')}</option>{contexts.map(c => <option key={c} value={c}>{t(c)}</option>)}
        </Select>
        <Input className="h-8 w-56" placeholder={t('Search text or cell…')} value={q} onChange={e => { setQ(e.target.value); setPage(0); }} />
        <span className="ms-auto text-xs text-mute num">{rows.length.toLocaleString()} {t('rows')}</span>
      </div>

      <div className="overflow-x-auto"><table className="w-full text-xs">
        <thead><tr>
          <th className={th}>{t('Parameter')}</th><th className={th}>{t('Extracted value')}</th><th className={th}>{t('Unit')}</th><th className={th}>{t('Database value')}</th>
          <th className={th}>{t('Context')}</th><th className={th}>{t('Source cell')}</th><th className={th}>{t('Confidence')}</th><th className={th}>{t('Method')}</th><th className={th}>{t('Original text')}</th><th className={th} />
        </tr></thead>
        <tbody>{rows.slice(cur * PAGE, cur * PAGE + PAGE).map(h => {
          const c = corrections[h.id];
          return (
            <tr key={h.id} className={cx(h.status === 'rejected' && 'opacity-50')}>
              <td className={td}>
                <Select className="h-7 w-44 text-xs" value={c?.key ?? h.key} disabled={h.status === 'rejected'} onChange={e => set(h.id, { key: e.target.value })}>
                  {[...new Set([h.key, ...PARAM_KEYS])].map(k => <option key={k} value={k}>{t(paramLabel(k))}</option>)}
                </Select>
                {h.qualifier && <div className="mt-0.5 text-[10px] text-mute">{t(h.qualifier)}</div>}
              </td>
              <td className={td}>
                <input key={`${h.id}:${String(h.value)}`} defaultValue={typeof h.value === 'number' && h.min == null ? String(h.value) : shown(h)} disabled={h.status === 'rejected'} dir="ltr"
                  className="num h-7 w-24 rounded border border-line bg-bg/70 px-1.5 text-xs outline-none focus:border-cyan-500/70"
                  onBlur={e => { const v = e.target.value.trim(); if (v && v !== shown(h) && v !== String(h.value)) set(h.id, { value: v }); }}
                  onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                {h.min != null && <div className="mt-0.5 text-[10px] text-mute">{t('midpoint')} {fmt(Number(h.value), 2)}</div>}
              </td>
              <td className={cx(td, 'num whitespace-nowrap')} title={h.notes.join('; ')}>{h.unitRaw ?? (h.unit ? <span className="text-mute">{h.unit}*</span> : '—')}</td>
              <td className={cx(td, 'num whitespace-nowrap')}>{dbValue(h)}</td>
              <td className={td}>{t(h.context)}</td>
              <td className={td}><span className="num text-[11px] text-mute" dir="ltr">{h.src}</span></td>
              <td className={td}><Badge color={STATUS_COLOR[h.status]}>{Math.round(h.confidence * 100)}%</Badge>{h.review && <div className="mt-0.5 text-[10px] text-emerald-300">{t(h.review)}</div>}</td>
              <td className={cx(td, 'text-mute')}>{t(h.method)}{h.notes.length > 0 && <div className="mt-0.5 max-w-[14rem] text-[10px] text-yellow-200/80">{h.notes.join('; ')}</div>}</td>
              <td className={cx(td, 'max-w-md text-mute')}>{highlight(h)}</td>
              <td className={cx(td, 'whitespace-nowrap')}>
                {c ? <Button size="sm" variant="ghost" title={t('Undo')} onClick={() => set(h.id, null)}><RotateCcw size={13} /></Button> : <>
                  <Button size="sm" variant="ghost" title={t('Confirm')} onClick={() => set(h.id, { confirm: true })}><Check size={13} /></Button>
                  <Button size="sm" variant="ghost" title={t('Reject')} onClick={() => set(h.id, { reject: true })}><X size={13} /></Button></>}
              </td>
            </tr>);
        })}</tbody>
      </table></div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <Button size="sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>{t('Previous')}</Button>
          <span className="num text-mute">{cur + 1} / {pages}</span>
          <Button size="sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>{t('Next')}</Button>
        </div>
      )}
      <p className="text-[11px] text-mute">{t('* unit not written next to the value; the unit shown was assumed (hover for the reason). Corrections, confirmations and rejections are applied immediately to the records that will be created, and saved with each value.')}</p>
    </div>
  );
}
