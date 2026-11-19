// Small shadcn-style UI primitives (Tailwind only).
import { useCallback, useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { X } from 'lucide-react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function Card({ title, right, children, className, pad = true }: { title?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-lg border border-line bg-panel/90 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset] min-w-0', className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
          <h3 className="text-[13px] font-semibold tracking-wide text-ink">{title}</h3>
          <div className="flex items-center gap-2 text-xs text-mute">{right}</div>
        </header>
      )}
      <div className={pad ? 'px-4 pb-4' : ''}>{children}</div>
    </section>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'md' };
export function Button({ variant = 'default', size = 'md', className, ...p }: BtnProps) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25',
        variant === 'default' && 'border-line bg-panel2 text-ink hover:border-slate-500',
        variant === 'ghost' && 'border-transparent text-mute hover:text-ink hover:bg-white/5',
        variant === 'danger' && 'border-rose-500/50 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20',
        className,
      )}
    />
  );
}

const base = 'rounded-md border border-line bg-bg/70 px-2.5 text-sm text-ink placeholder:text-mute/60 outline-none focus:border-cyan-500/70 disabled:opacity-50';
/** Default height / full width apply only when the caller has not passed its own h-* / w-* class. */
const field = (className?: string, h = 'h-9') => cx(base, !/(^|\s)h-/.test(className ?? '') && h, !/(^|\s)w-/.test(className ?? '') && 'w-full', className);
export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={field(className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(field(className), 'pe-7')} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(field(className, 'min-h-20'), 'py-2')} />;

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block min-w-0', className)}>
      <span className="mb-1 block text-xs font-medium text-mute">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-mute/80">{hint}</span>}
    </label>
  );
}

const BADGE: Record<string, string> = {
  gray: 'border-slate-600/60 bg-slate-500/10 text-slate-300', cyan: 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200',
  green: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200', yellow: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-200',
  orange: 'border-orange-500/50 bg-orange-500/10 text-orange-200', red: 'border-rose-500/50 bg-rose-500/10 text-rose-200',
  magenta: 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-200',
};
export function Badge({ color = 'gray', children, className }: { color?: keyof typeof BADGE | string; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', BADGE[color] ?? BADGE.gray, className)}>{children}</span>;
}

export function Notice({ kind = 'info', children, className }: { kind?: 'info' | 'warn' | 'error' | 'ok'; children: ReactNode; className?: string }) {
  const c = { info: 'border-cyan-500/30 bg-cyan-500/5 text-cyan-100', warn: 'border-yellow-500/40 bg-yellow-500/5 text-yellow-100', error: 'border-rose-500/40 bg-rose-500/10 text-rose-100', ok: 'border-emerald-500/40 bg-emerald-500/5 text-emerald-100' }[kind];
  return <div role={kind === 'error' ? 'alert' : 'status'} className={cx('rounded-md border px-3 py-2 text-[13px] leading-relaxed', c, className)}>{children}</div>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-8" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={cx('w-full rounded-lg border border-line bg-panel shadow-2xl', wide ? 'max-w-5xl' : 'max-w-2xl')}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-mute hover:bg-white/5 hover:text-ink"><X size={18} /></button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-line">
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cx('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium', value === t.id ? 'border-cyan-400 text-cyan-200' : 'border-transparent text-mute hover:text-ink')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** KPI tile: the value wears ink, a small colour chip carries identity. */
export function Stat({ label, value, unit, color, sub, className }: { label: ReactNode; value: ReactNode; unit?: ReactNode; color?: string; sub?: ReactNode; className?: string }) {
  return (
    <div className={cx('rounded-md border border-line bg-panel2/60 px-3 py-2.5 min-w-0', className)}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-mute">
        {color && <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: color }} />}
        <span className="truncate">{label}</span>
      </div>
      <div className="num mt-0.5 truncate text-xl font-semibold leading-tight text-ink">
        {value}{unit && <span className="ms-1 text-xs font-normal text-mute">{unit}</span>}
      </div>
      {sub && <div className="num mt-0.5 truncate text-[11px] text-mute">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-mute">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, text, action }: { title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <div className="text-sm font-semibold">{title}</div>
      {text && <p className="mx-auto mt-1 max-w-xl text-[13px] text-mute">{text}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
export const Spinner = ({ label }: { label?: ReactNode }) => (
  <div className="flex items-center gap-2 py-6 text-[13px] text-mute"><span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-cyan-400" />{label}</div>
);

export interface Column<T> { key: string; label: ReactNode; render?: (row: T) => ReactNode; value?: (row: T) => string | number | null | undefined; align?: 'start' | 'end'; className?: string }
/** Sortable data table. `value` supplies the sort key and the default cell text. */
export function DataTable<T>({ columns, rows, onRowClick, rowKey, empty, dense }: { columns: Column<T>[]; rows: T[]; onRowClick?: (row: T) => void; rowKey: (row: T, i: number) => string; empty?: ReactNode; dense?: boolean }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    const col = sort && columns.find(c => c.key === sort.key);
    if (!col?.value) return rows;
    return [...rows].sort((a, b) => {
      const x = col.value!(a), y = col.value!(b);
      if (x == null) return 1; if (y == null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort!.dir;
    });
  }, [rows, sort, columns]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wide text-mute">
            {columns.map(c => (
              <th key={c.key} scope="col" className={cx('px-3 py-2 font-medium whitespace-nowrap', c.align === 'end' ? 'text-end' : 'text-start', c.value && 'cursor-pointer select-none hover:text-ink')}
                onClick={() => c.value && setSort(s => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}>
                {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey(r, i)} onClick={onRowClick && (() => onRowClick(r))} className={cx('border-b border-line/60', onRowClick && 'cursor-pointer hover:bg-white/[0.03]')}>
              {columns.map(c => (
                <td key={c.key} className={cx('px-3 align-top', dense ? 'py-1.5' : 'py-2.5', c.align === 'end' && 'num text-end', c.className)}>
                  {c.render ? c.render(r) : (c.value?.(r) ?? '—')}
                </td>
              ))}
            </tr>
          ))}
          {!sorted.length && <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-mute">{empty ?? 'No data'}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(() => {
    const id = ++seq.current;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(data => { if (id === seq.current) setState({ data, loading: false, error: null }); })
      .catch(e => { if (id === seq.current) setState({ data: null, loading: false, error: (e as Error).message ?? String(e) }); });
  }, deps);
  useEffect(run, [run]);
  return { ...state, reload: run };
}

/** Wrap an async action with busy / error state for buttons. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); return true; } catch (e) { setError((e as Error).message ?? String(e)); return false; } finally { setBusy(false); }
  }, []);
  return { busy, error, run, setError };
}

export function Chips<T extends string>({ options, value, onChange }: { options: { id: T; label: ReactNode; color?: string }[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = value.includes(o.id);
        return (
          <button key={o.id} type="button" aria-pressed={on} onClick={() => onChange(on ? value.filter(v => v !== o.id) : [...value, o.id])}
            className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', on ? 'border-slate-400/70 bg-white/10 text-ink' : 'border-line text-mute hover:text-ink')}>
            {o.color && <span className="h-2 w-2 rounded-sm" style={{ background: o.color, opacity: on ? 1 : 0.35 }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
