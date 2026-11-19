import { useState, type FormEvent } from 'react';
import { Languages } from 'lucide-react';
import { useAuth, usePrefs } from '../lib/context';
import { DB_MODE } from '../db/adapter';
import { Button, Field, Input, Notice, useAction } from '../components/ui';

export default function Login() {
  const { setup, signIn, signUp } = useAuth();
  const { t, lang, setLang } = usePrefs();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState('');
  const { busy, error, run } = useAction();
  const creating = setup || mode === 'up';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => (creating ? signUp(email, password, name) : signIn(email, password)));
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">{t('Drilling Intelligence')}</div>
          <h1 className="mt-2 text-xl font-semibold leading-snug">{t('Digital Dashboard for Drilling Operations Performance Insights & Wells Time Estimation')}</h1>
        </div>
        <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-panel p-5">
          <h2 className="text-base font-semibold">{setup ? t('Create the administrator account') : creating ? t('Create account') : t('Sign in')}</h2>
          {setup && <Notice>{t('No accounts exist yet. The first account becomes the Administrator and can create Engineer and Viewer accounts in Settings.')}</Notice>}
          {!setup && creating && <Notice>{t('New accounts start as Viewer. An Administrator can change the role in Settings.')}</Notice>}
          {creating && <Field label={t('Full name')}><Input value={name} onChange={e => setName(e.target.value)} required autoComplete="name" /></Field>}
          <Field label={t('Email')}><Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" dir="ltr" /></Field>
          <Field label={t('Password')} hint={creating ? t('At least 8 characters.') : undefined}>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete={creating ? 'new-password' : 'current-password'} dir="ltr" />
          </Field>
          {error && <Notice kind="error">{error}</Notice>}
          <Button variant="primary" type="submit" disabled={busy} className="w-full">{busy ? t('Please wait…') : creating ? t('Create account') : t('Sign in')}</Button>
          {!setup && (
            <button type="button" className="w-full text-center text-xs text-mute hover:text-ink" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
              {mode === 'in' ? t('Need an account? Create one') : t('Already have an account? Sign in')}
            </button>
          )}
        </form>
        <div className="mt-4 flex items-center justify-between text-[11px] text-mute">
          <span>{DB_MODE === 'supabase' ? t('Connected to Supabase') : t('Local mode: data is stored in this browser (embedded PostgreSQL).')}</span>
          <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}><Languages size={13} />{lang === 'en' ? 'العربية' : 'English'}</button>
        </div>
      </div>
    </div>
  );
}
