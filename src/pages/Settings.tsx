import { useEffect, useState } from 'react';
import * as repo from '../db/repo';
import { adminCreateUser } from '../db/auth';
import { DB_MODE, SUPABASE_URL } from '../db/adapter';
import { useAuth, usePrefs } from '../lib/context';
import { DEFAULT_ALERT_CONFIG, type AlertConfig, type SimilarityWeights } from '../lib/matching';
import type { Role } from '../lib/types';
import { localDay } from '../lib/time';
import { CONNECTORS } from '../import/connectors';
import { loadDemo, removeDemo } from '../demo/load';
import { Badge, Button, Card, DataTable, Field, Input, Notice, PageHeader, Select, Spinner, Tabs, useAction, useAsync } from '../components/ui';

type Tab = 'general' | 'alerts' | 'formations' | 'users' | 'data' | 'integrations';
const WEIGHT_LABELS: Record<keyof SimilarityWeights, string> = {
  formation: 'Formation similarity', depth: 'Depth proximity', holeSize: 'Hole size similarity', wellType: 'Well type',
  activity: 'Drilling activity', bha: 'BHA configuration (run number)', mud: 'Mud properties (mud weight)', params: 'Similar drilling parameter patterns',
};

export default function SettingsPage() {
  const { t, lang, setLang, depthUnit, setDepthUnit } = usePrefs();
  const { user, canWrite, isAdmin } = useAuth();
  const [tab, setTab] = useState<Tab>('general');
  const { data, loading, error, reload } = useAsync(async () => {
    const [cfg, formations, intervals, problems, users, wells] = await Promise.all([repo.getAlertConfig(), repo.listFormations(), repo.listIntervals(), repo.listProblems(), repo.listUsers(), repo.listWells()]);
    return { cfg, formations, intervals, problems, users, wells };
  }, []);
  const [cfg, setCfg] = useState<AlertConfig>(DEFAULT_ALERT_CONFIG);
  useEffect(() => { if (data) setCfg(data.cfg); }, [data]);
  const act = useAction();
  const [ok, setOk] = useState('');
  const [nu, setNu] = useState({ email: '', name: '', password: '', role: 'engineer' as Role });
  const [progress, setProgress] = useState('');

  if (loading && !data) return <Spinner label={t('Loading…')} />;
  if (error || !data) return <Notice kind="error">{error}</Notice>;
  const done = (msg: string) => { setOk(msg); reload(); };
  const wsum = Object.values(cfg.weights).reduce((a, b) => a + (Number(b) || 0), 0);
  const numField = (k: 'earlyFt' | 'mediumFt' | 'criticalFt' | 'minSimilarity' | 'minHistoricalWells', label: string, hint?: string) => (
    <Field label={t(label)} hint={hint && t(hint)}><Input type="number" min={0} disabled={!canWrite} value={cfg[k]} onChange={e => setCfg({ ...cfg, [k]: Number(e.target.value) })} /></Field>
  );
  const saveCfg = () => act.run(async () => {
    if (!(cfg.criticalFt <= cfg.mediumFt && cfg.mediumFt <= cfg.earlyFt)) throw new Error(t('Warning distances must satisfy: critical ≤ medium ≤ early.'));
    if (wsum <= 0) throw new Error(t('At least one similarity weight must be greater than zero.'));
    await repo.setSetting('alert_config', cfg);
    await repo.logActivity('Updated alert settings');
    done(t('Alert settings saved.'));
  });
  const usage = (name: string) => ({ wells: new Set(data.intervals.filter(i => i.formation_name === name).map(i => i.well_id)).size, problems: data.problems.filter(p => p.formation_name === name).length });
  const demoCount = data.wells.filter(w => w.is_demo).length;

  return (
    <div className="space-y-4">
      <PageHeader title={t('Settings & Data Management')} subtitle={`${t('Signed in as')} ${user?.email} · ${t(user!.role)}`} />
      <Tabs value={tab} onChange={x => { setTab(x); setOk(''); act.setError(null); }} tabs={[
        { id: 'general', label: t('Language & units') }, { id: 'alerts', label: t('Alert thresholds & similarity') }, { id: 'formations', label: t('Formation mapping') },
        { id: 'users', label: t('Users & roles') }, { id: 'data', label: t('Data management') }, { id: 'integrations', label: t('Integrations') },
      ]} />
      {ok && <Notice kind="ok">{ok}</Notice>}
      {act.error && <Notice kind="error">{act.error}</Notice>}

      {tab === 'general' && (
        <Card title={t('Language & units')}>
          <div className="grid max-w-xl gap-3 sm:grid-cols-2">
            <Field label={t('Language')}><Select value={lang} onChange={e => setLang(e.target.value as 'en' | 'ar')}><option value="en">English</option><option value="ar">العربية (RTL)</option></Select></Field>
            <Field label={t('Depth unit')} hint={t('Depths are stored in feet and converted for display; ROP follows the depth unit.')}><Select value={depthUnit} onChange={e => setDepthUnit(e.target.value as 'ft' | 'm')}><option value="ft">{t('feet (ft)')}</option><option value="m">{t('metres (m)')}</option></Select></Field>
          </div>
          <p className="mt-3 text-xs text-mute">{t('These preferences are stored in this browser for the current user. Data values (well names, descriptions, formations) are shown as entered.')}</p>
        </Card>
      )}

      {tab === 'alerts' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('Depth-based warning distances')}>
            {!canWrite && <Notice kind="warn" className="mb-3">{t('Viewer role: settings are read-only.')}</Notice>}
            <div className="grid gap-3 sm:grid-cols-3">
              {numField('earlyFt', 'Early warning (ft before)')}{numField('mediumFt', 'Medium warning (ft before)')}{numField('criticalFt', 'Critical warning (ft before)')}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t('Depth basis for matching')} hint={t('TVD is used only when both the current well and the historical problem have a TVD; otherwise MD.')}>
                <Select disabled={!canWrite} value={cfg.depthBasis} onChange={e => setCfg({ ...cfg, depthBasis: e.target.value as 'md' | 'tvd' })}><option value="md">{t('Measured depth (MD) – default')}</option><option value="tvd">{t('True vertical depth (TVD) when available')}</option></Select>
              </Field>
              {numField('minSimilarity', 'Hide matches below similarity (%)')}
              {numField('minHistoricalWells', 'Minimum historical wells', 'Below this number the risk assessment is flagged as limited.')}
              <Field label={t('Historical events used')}>
                <div className="space-y-1 pt-1 text-[13px]">
                  <label className="flex items-center gap-2"><input type="checkbox" checked disabled />{t('Engineer-confirmed problems (always)')}</label>
                  <label className="flex items-center gap-2"><input type="checkbox" disabled={!canWrite} checked={cfg.includeSuspected} onChange={e => setCfg({ ...cfg, includeSuspected: e.target.checked })} />{t('Suspected problems')}</label>
                  <label className="flex items-center gap-2"><input type="checkbox" disabled={!canWrite} checked={cfg.includeAnomalies} onChange={e => setCfg({ ...cfg, includeAnomalies: e.target.checked })} />{t('Detected anomalies (not recommended)')}</label>
                </div>
              </Field>
            </div>
          </Card>
          <Card title={t('Similarity score weights')} right={`${t('total')} ${wsum}`}>
            <p className="mb-3 text-xs text-mute">{t('Each component scores 0-100%. The similarity is their weighted average; components with no data on either well are left out and the remaining weights are rescaled.')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(Object.keys(WEIGHT_LABELS) as (keyof SimilarityWeights)[]).map(k => (
                <Field key={k} label={t(WEIGHT_LABELS[k])}><Input type="number" min={0} max={100} disabled={!canWrite} value={cfg.weights[k]} onChange={e => setCfg({ ...cfg, weights: { ...cfg.weights, [k]: Number(e.target.value) } })} /></Field>))}
            </div>
            {canWrite && <div className="mt-4 flex gap-2"><Button variant="primary" disabled={act.busy} onClick={saveCfg}>{t('Save alert settings')}</Button><Button onClick={() => setCfg(DEFAULT_ALERT_CONFIG)}>{t('Reset to defaults')}</Button></div>}
          </Card>
        </div>
      )}

      {tab === 'formations' && (
        <Card title={t('Formation mapping')} pad={false}>
          <p className="px-4 pb-3 text-[13px] text-mute">{t('When the same geological formation has different names in different wells, mark one name as equivalent to the other. Formation-based alerts, comparison and formation risk reports then treat them as one formation.')}</p>
          <DataTable dense rowKey={f => f.id} rows={data.formations} empty={t('No formations yet. They are created from the Formation column of imported data.')} columns={[
            { key: 'n', label: t('Formation name'), value: f => f.name, render: f => <span className="font-medium">{f.name}</span> },
            { key: 'w', label: t('Wells'), align: 'end', value: f => usage(f.name).wells },
            { key: 'p', label: t('Problems'), align: 'end', value: f => usage(f.name).problems },
            { key: 'c', label: t('Equivalent to'), render: f => (
              <Select className="h-8 w-64" disabled={!canWrite || act.busy} value={f.canonical_id ?? ''} onChange={e => act.run(async () => { await repo.setFormationCanonical(f.id, e.target.value || null); done(t('Formation mapping saved.')); })}>
                <option value="">— {t('own name (no mapping)')} —</option>
                {data.formations.filter(x => x.id !== f.id && !x.canonical_id).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>) },
          ]} />
        </Card>
      )}

      {tab === 'users' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card title={t('Users & roles')} pad={false}>
            <DataTable dense rowKey={u => u.id} rows={data.users} columns={[
              { key: 'n', label: t('Full name'), value: u => u.full_name }, { key: 'e', label: t('Email'), value: u => u.email },
              { key: 'r', label: t('Role'), render: u => isAdmin && u.id !== user!.id
                ? <Select className="h-8 w-40" value={u.role} disabled={act.busy} onChange={e => act.run(async () => { await repo.setUserRole(u.id, e.target.value as Role); done(t('Role updated.')); })}><option value="admin">{t('Administrator')}</option><option value="engineer">{t('Engineer')}</option><option value="viewer">{t('Viewer')}</option></Select>
                : <Badge color={u.role === 'admin' ? 'cyan' : u.role === 'engineer' ? 'green' : 'gray'}>{t(u.role === 'admin' ? 'Administrator' : u.role === 'engineer' ? 'Engineer' : 'Viewer')}</Badge> },
            ]} />
            <ul className="space-y-1 border-t border-line p-4 text-xs text-mute">
              <li><b className="text-ink">{t('Administrator')}</b>: {t('full access, including users, deleting wells and data management.')}</li>
              <li><b className="text-ink">{t('Engineer')}</b>: {t('add wells, upload data, manage problems, handle alerts, run simulations.')}</li>
              <li><b className="text-ink">{t('Viewer')}</b>: {t('view dashboards, historical wells and reports.')}</li>
            </ul>
          </Card>
          {isAdmin && (
            <Card title={t('Create account')}>
              {DB_MODE === 'supabase' ? <Notice>{t('With Supabase, users register themselves on the sign-in page (they start as Viewer). Assign their role in the table.')}</Notice> : (
                <div className="space-y-3">
                  <Field label={t('Full name')}><Input value={nu.name} onChange={e => setNu({ ...nu, name: e.target.value })} /></Field>
                  <Field label={t('Email')}><Input type="email" dir="ltr" value={nu.email} onChange={e => setNu({ ...nu, email: e.target.value })} /></Field>
                  <Field label={t('Temporary password')} hint={t('At least 8 characters.')}><Input type="password" dir="ltr" autoComplete="new-password" value={nu.password} onChange={e => setNu({ ...nu, password: e.target.value })} /></Field>
                  <Field label={t('Role')}><Select value={nu.role} onChange={e => setNu({ ...nu, role: e.target.value as Role })}><option value="engineer">{t('Engineer')}</option><option value="viewer">{t('Viewer')}</option><option value="admin">{t('Administrator')}</option></Select></Field>
                  <Button variant="primary" disabled={act.busy} onClick={() => act.run(async () => { await adminCreateUser(user!, nu.email, nu.password, nu.name, nu.role); setNu({ email: '', name: '', password: '', role: 'engineer' }); done(t('Account created.')); })}>{t('Create account')}</Button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === 'data' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('Sample dataset')} right={demoCount ? <Badge color="magenta">{demoCount} {t('sample wells loaded')}</Badge> : undefined}>
            <p className="text-[13px] text-mute">{t('Four synthetic wells (three completed offsets and one active well) with drilling records, surveys, formation tops and example problems. Everything is generated by a seeded model and labelled as sample data - it is not real drilling data.')}</p>
            {canWrite ? <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="primary" disabled={act.busy || demoCount >= 4} onClick={() => act.run(async () => { const n = await loadDemo(setProgress); setProgress(''); done(`${n} ${t('sample wells loaded.')}`); })}>{t('Load sample dataset')}</Button>
              {isAdmin && <Button variant="danger" disabled={act.busy || !demoCount} onClick={() => { if (confirm(t('Remove all sample wells and their records, problems and alerts?'))) act.run(async () => { const n = await removeDemo(); done(`${n} ${t('sample wells removed.')}`); }); }}>{t('Remove sample data')}</Button>}
              {act.busy && <span className="text-xs text-mute">{progress || t('Please wait…')}</span>}
            </div> : <Notice kind="warn" className="mt-3">{t('Viewer role: settings are read-only.')}</Notice>}
          </Card>
          <Card title={t('Backup')}>
            <p className="text-[13px] text-mute">{t('Download every well, record, problem, alert and setting as one JSON file.')}</p>
            <Button className="mt-3" disabled={act.busy} onClick={() => act.run(async () => {
              const blob = new Blob([JSON.stringify(await repo.exportBackup())], { type: 'application/json' });
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `drilling-dashboard-backup-${localDay(Date.now())}.json`; a.click(); URL.revokeObjectURL(a.href);
            })}>{t('Download backup (JSON)')}</Button>
            <p className="mt-3 text-xs text-mute">{t('Individual wells are deleted from their own page (Administrator only). Wells are never overwritten: each Well ID can be used once.')}</p>
          </Card>
        </div>
      )}

      {tab === 'integrations' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('Database')} right={<Badge color={DB_MODE === 'supabase' ? 'green' : 'cyan'}>{DB_MODE === 'supabase' ? 'Supabase' : 'PGlite'}</Badge>}>
            {DB_MODE === 'supabase' ? <p className="text-[13px]">{t('Connected to Supabase project')}: <span dir="ltr" className="text-mute">{SUPABASE_URL}</span></p> : <>
              <p className="text-[13px] text-mute">{t('Running on the embedded PostgreSQL database (PGlite) stored in this browser. Data stays on this device and is not shared between users or browsers.')}</p>
              <p className="mt-2 text-[13px] text-mute">{t('To use Supabase (shared multi-user database, Supabase Auth and Storage) provide:')}</p>
              <ul className="mt-1 list-disc ps-5 text-[13px]" dir="ltr"><li><code>VITE_SUPABASE_URL</code></li><li><code>VITE_SUPABASE_ANON_KEY</code></li></ul>
              <p className="mt-2 text-xs text-mute">{t('Put them in .env.local, run the two SQL files in supabase/migrations on the project, and restart. See README.md.')}</p>
            </>}
          </Card>
          <Card title={t('Data sources')}>
            <ul className="space-y-3">{CONNECTORS.map(c => (
              <li key={c.id} className="text-[13px]"><div className="flex items-center gap-2"><b>{t(c.label)}</b><Badge color={c.available ? 'green' : 'yellow'}>{t(c.available ? 'available' : 'not configured')}</Badge></div>{c.note && <p className="mt-0.5 text-xs text-mute">{t(c.note)}</p>}</li>))}</ul>
            <p className="mt-3 text-xs text-mute">{t('.pbix files are Power BI report packages and cannot be read as spreadsheets; export the data to Excel or CSV.')}</p>
          </Card>
        </div>
      )}
    </div>
  );
}
