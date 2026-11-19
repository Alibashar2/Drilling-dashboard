import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Activity, ChartColumn, Database, GitCompareArrows, Languages, LayoutDashboard, LogOut, Menu, Plus, Settings, Timer, TriangleAlert, X } from 'lucide-react';
import { useAuth, usePrefs } from '../lib/context';
import { DB_MODE } from '../db/adapter';
import { Badge, cx } from './ui';

const NAV = [
  { to: '/', label: 'Home / Overview', icon: LayoutDashboard },
  { to: '/add-well', label: 'Add New Well', icon: Plus, write: true },
  { to: '/simulation', label: 'Drilling Simulation', icon: Activity },
  { to: '/wells', label: 'Historical Wells', icon: Database },
  { to: '/problems', label: 'Problems & Lessons Learned', icon: TriangleAlert },
  { to: '/compare', label: 'Well Comparison', icon: GitCompareArrows },
  { to: '/estimate', label: 'Drilling Time Estimation', icon: Timer },
  { to: '/reports', label: 'Analytics & Reports', icon: ChartColumn },
  { to: '/settings', label: 'Settings & Data Management', icon: Settings },
];
const ROLE_LABEL = { admin: 'Administrator', engineer: 'Engineer', viewer: 'Viewer' } as const;

export default function Layout({ children }: { children: ReactNode }) {
  const { user, signOut, canWrite } = useAuth();
  const { t, lang, setLang, depthUnit, setDepthUnit } = usePrefs();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const wide = loc.pathname === '/simulation';

  const nav = (
    <nav className="flex flex-col gap-0.5 p-2">
      {NAV.filter(n => !n.write || canWrite).map(n => (
        <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setOpen(false)}
          className={({ isActive }) => cx('flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium', isActive ? 'bg-cyan-500/10 text-cyan-200' : 'text-mute hover:bg-white/5 hover:text-ink')}>
          <n.icon size={16} className="shrink-0" />
          <span>{t(n.label)}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-e border-line bg-panel/80 lg:flex">
        <div className="border-b border-line px-4 py-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">{t('Drilling Intelligence')}</div>
          <div className="mt-1 text-[13px] font-semibold leading-snug">{t('Digital Dashboard for Drilling Operations')}</div>
        </div>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-line p-3 text-[11px] text-mute">
          <Badge color={DB_MODE === 'supabase' ? 'green' : 'cyan'}>{DB_MODE === 'supabase' ? t('Supabase database') : t('Local database (PGlite)')}</Badge>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <aside className="absolute inset-y-0 start-0 w-64 overflow-y-auto border-e border-line bg-panel" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="text-sm font-semibold">{t('Menu')}</span>
              <button aria-label="Close menu" onClick={() => setOpen(false)}><X size={18} /></button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel/60 px-3 sm:px-5">
          <button className="rounded p-1.5 text-mute hover:bg-white/5 lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={18} /></button>
          <div className="min-w-0 flex-1 truncate text-[13px] text-mute lg:hidden">{t('Digital Dashboard for Drilling Operations')}</div>
          <div className="hidden flex-1 lg:block" />
          <div className="flex items-center overflow-hidden rounded-md border border-line text-xs" role="group" aria-label={t('Depth unit')}>
            {(['ft', 'm'] as const).map(u => (
              <button key={u} onClick={() => setDepthUnit(u)} aria-pressed={depthUnit === u} className={cx('px-2.5 py-1', depthUnit === u ? 'bg-cyan-500/15 text-cyan-200' : 'text-mute hover:text-ink')}>{u}</button>
            ))}
          </div>
          <button onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs text-mute hover:text-ink" aria-label="Language">
            <Languages size={14} />{lang === 'en' ? 'العربية' : 'English'}
          </button>
          <div className="hidden text-end leading-tight sm:block">
            <div className="max-w-40 truncate text-xs font-medium">{user?.full_name || user?.email}</div>
            <div className="text-[11px] text-mute">{t(ROLE_LABEL[user!.role])}</div>
          </div>
          <button onClick={() => signOut()} title={t('Sign out')} aria-label={t('Sign out')} className="rounded p-1.5 text-mute hover:bg-white/5 hover:text-ink"><LogOut size={16} /></button>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className={cx('mx-auto p-3 sm:p-5', wide ? 'max-w-[1900px]' : 'max-w-[1500px]')}>{children}</div>
        </main>
      </div>
    </div>
  );
}
