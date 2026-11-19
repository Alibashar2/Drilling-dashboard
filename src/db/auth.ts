// Authentication. Supabase Auth in Supabase mode; local accounts (PBKDF2-hashed passwords stored in the
// embedded database) in local mode. Local mode protects against casual access only - the database lives in
// the user's own browser - and is intended for single-machine use and evaluation.
import { DB_MODE, getSupabase } from './adapter';
import { adapter, uid } from './repo';
import type { Role, User } from '../lib/types';

const SESSION_KEY = 'dd.session';
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 150000 }, key, 256);
  return b64(bits);
}
const cleanEmail = (e: string) => e.trim().toLowerCase();
function checkInput(email: string, password: string) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
}

async function profile(id: string): Promise<User | null> {
  return (await adapter().select<User>('users', { eq: { id } }))[0] ?? null;
}

/** True when no account exists yet (local mode): the first account created becomes Administrator. */
export async function needsSetup(): Promise<boolean> {
  if (DB_MODE === 'supabase') return false;
  return (await adapter().select<User>('users', { limit: 1 })).length === 0;
}

export async function currentSession(): Promise<User | null> {
  if (DB_MODE === 'supabase') {
    const { data } = await (await getSupabase()).auth.getSession();
    return data.session ? profile(data.session.user.id) : null;
  }
  const id = localStorage.getItem(SESSION_KEY);
  return id ? profile(id) : null;
}

async function createLocalUser(email: string, password: string, full_name: string, role: Role): Promise<User> {
  email = cleanEmail(email);
  checkInput(email, password);
  if ((await adapter().select<User>('users', { eq: { email } })).length) throw new Error('An account with this email already exists.');
  const user: User = { id: uid(), email, full_name: full_name.trim(), role };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await adapter().insert('users', [user]);
  await adapter().insert('local_credentials', [{ user_id: user.id, salt: b64(salt), hash: await pbkdf2(password, salt) }]);
  return user;
}

export async function signUp(email: string, password: string, full_name: string): Promise<User> {
  if (DB_MODE === 'supabase') {
    checkInput(cleanEmail(email), password);
    const { data, error } = await (await getSupabase()).auth.signUp({ email: cleanEmail(email), password, options: { data: { full_name } } });
    if (error) throw new Error(error.message);
    if (!data.session || !data.user) throw new Error('Account created. Confirm your email address, then sign in.');
    const u = await profile(data.user.id);
    if (!u) throw new Error('Account created but no profile row was found. Check that migration 0002 has been applied.');
    return u;
  }
  const user = await createLocalUser(email, password, full_name, (await needsSetup()) ? 'admin' : 'viewer');
  localStorage.setItem(SESSION_KEY, user.id);
  return user;
}

export async function signIn(email: string, password: string): Promise<User> {
  email = cleanEmail(email);
  if (DB_MODE === 'supabase') {
    const { data, error } = await (await getSupabase()).auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    const u = await profile(data.user.id);
    if (!u) throw new Error('Signed in but no profile row was found. Check that migration 0002 has been applied.');
    return u;
  }
  const user = (await adapter().select<User>('users', { eq: { email } }))[0];
  const cred = user && (await adapter().select<{ salt: string; hash: string }>('local_credentials', { eq: { user_id: user.id } }))[0];
  if (!user || !cred || (await pbkdf2(password, unb64(cred.salt))) !== cred.hash) throw new Error('Incorrect email or password.');
  localStorage.setItem(SESSION_KEY, user.id);
  return user;
}

export async function signOut() {
  if (DB_MODE === 'supabase') await (await getSupabase()).auth.signOut();
  else localStorage.removeItem(SESSION_KEY);
}

/** Administrator creates an account for someone else (local mode). In Supabase mode users sign up themselves. */
export async function adminCreateUser(actor: User, email: string, password: string, full_name: string, role: Role): Promise<User> {
  if (actor.role !== 'admin') throw new Error('Only an Administrator can create accounts.');
  if (DB_MODE === 'supabase') throw new Error('In Supabase mode users register on the sign-in page; assign their role here afterwards.');
  return createLocalUser(email, password, full_name, role);
}
