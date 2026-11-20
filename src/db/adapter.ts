// Database adapters. One relational schema, two PostgreSQL runtimes:
//   - Supabase (hosted PostgreSQL) when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are configured
//   - PGlite (PostgreSQL compiled to WebAssembly, persisted in IndexedDB) otherwise
// Every operation either succeeds against the real database or throws; nothing is simulated.
import type { SupabaseClient } from '@supabase/supabase-js';
import schemaSql from '../../supabase/migrations/0001_schema.sql?raw';
import reportTimesUtcSql from '../../supabase/migrations/0003_report_times_utc.sql?raw';

type Scalar = string | number | boolean;
export interface SelectOpts {
  eq?: Record<string, Scalar>;
  in?: [string, Scalar[]];
  order?: [string, boolean?][];   // [column, ascending = true]
  limit?: number;
  columns?: string;
}
export interface DbAdapter {
  mode: 'local' | 'supabase';
  init(): Promise<void>;
  select<T>(table: string, o?: SelectOpts): Promise<T[]>;
  insert(table: string, rows: object[]): Promise<void>;
  update(table: string, match: Record<string, Scalar>, patch: object): Promise<void>;
  upsert(table: string, rows: object[], conflict: string[]): Promise<void>;
  remove(table: string, match: Record<string, Scalar>): Promise<void>;
}

const env = import.meta.env as Record<string, string | undefined>;
export const SUPABASE_URL = env.VITE_SUPABASE_URL?.trim() || '';
export const SUPABASE_KEY = env.VITE_SUPABASE_ANON_KEY?.trim() || '';
export const DB_MODE: 'local' | 'supabase' = SUPABASE_URL && SUPABASE_KEY ? 'supabase' : 'local';

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Invalid identifier: ${s}`);
  return `"${s}"`;
};
const keysOf = (rows: object[]) => [...new Set(rows.flatMap(r => Object.keys(r)))];

// ------------------------------------------------------------------ PGlite
const LOCAL_ONLY_SQL = `
create table if not exists local_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  salt text not null,
  hash text not null
);`;

class LocalAdapter implements DbAdapter {
  mode = 'local' as const;
  private db: any;
  async init() {
    const { PGlite } = await import('@electric-sql/pglite');
    this.db = new PGlite('idb://drilling-dashboard');
    await this.db.waitReady;
    await this.db.exec(schemaSql);
    await this.db.exec(LOCAL_ONLY_SQL);
    await this.db.exec(reportTimesUtcSql);   // once per database: report clock times stored before -> UTC
  }
  private norm<T>(rows: any[]): T[] {
    for (const r of rows) for (const k in r) {
      const v = r[k];
      if (v instanceof Date) r[k] = v.toISOString();
      else if (typeof v === 'bigint') r[k] = Number(v);
    }
    return rows as T[];
  }
  private where(match: Record<string, Scalar>, params: unknown[], prefix = '') {
    const parts = Object.entries(match).map(([k, v]) => { params.push(v); return `${prefix}${ident(k)} = $${params.length}`; });
    return parts.length ? ` where ${parts.join(' and ')}` : '';
  }
  async select<T>(table: string, o: SelectOpts = {}): Promise<T[]> {
    const params: unknown[] = [];
    let sql = `select ${o.columns ?? '*'} from ${ident(table)}` + this.where(o.eq ?? {}, params);
    if (o.in) {
      if (!o.in[1].length) return [];
      const ph = o.in[1].map(v => { params.push(v); return `$${params.length}`; });
      sql += `${params.length > ph.length ? ' and' : ' where'} ${ident(o.in[0])} in (${ph.join(',')})`;
    }
    if (o.order?.length) sql += ' order by ' + o.order.map(([c, asc]) => `${ident(c)} ${asc === false ? 'desc' : 'asc'}`).join(', ');
    if (o.limit) sql += ` limit ${Math.floor(o.limit)}`;
    const res = await this.db.query(sql, params);
    return this.norm<T>(res.rows);
  }
  async insert(table: string, rows: object[]) {
    for (let i = 0; i < rows.length; i += 2000) {
      const chunk = rows.slice(i, i + 2000), cols = keysOf(chunk).map(ident).join(', ');
      // json_populate_recordset lets PostgreSQL do all type conversion (dates, jsonb, numbers) server-side
      await this.db.query(
        `insert into ${ident(table)} (${cols}) select ${cols} from json_populate_recordset(null::${ident(table)}, $1::text::json)`,
        [JSON.stringify(chunk)]);
    }
  }
  async upsert(table: string, rows: object[], conflict: string[]) {
    if (!rows.length) return;
    const keys = keysOf(rows), cols = keys.map(ident).join(', ');
    const set = keys.filter(k => !conflict.includes(k)).map(k => `${ident(k)} = excluded.${ident(k)}`).join(', ');
    await this.db.query(
      `insert into ${ident(table)} (${cols}) select ${cols} from json_populate_recordset(null::${ident(table)}, $1::text::json)
       on conflict (${conflict.map(ident).join(', ')}) do ${set ? `update set ${set}` : 'nothing'}`,
      [JSON.stringify(rows)]);
  }
  async update(table: string, match: Record<string, Scalar>, patch: object) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const params: unknown[] = [JSON.stringify(patch)];
    const set = keys.map(k => `${ident(k)} = j.${ident(k)}`).join(', ');
    const where = this.where(match, params, 't.');
    if (!where) throw new Error('update requires a match');
    await this.db.query(`update ${ident(table)} as t set ${set} from json_populate_record(null::${ident(table)}, $1::text::json) as j${where}`, params);
  }
  async remove(table: string, match: Record<string, Scalar>) {
    const params: unknown[] = [];
    const where = this.where(match, params);
    if (!where) throw new Error('remove requires a match');
    await this.db.query(`delete from ${ident(table)}${where}`, params);
  }
}

// ------------------------------------------------------------------ Supabase
let sb: SupabaseClient | null = null;
export async function getSupabase(): Promise<SupabaseClient> {
  if (DB_MODE !== 'supabase') throw new Error('Supabase is not configured (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).');
  if (!sb) { const { createClient } = await import('@supabase/supabase-js'); sb = createClient(SUPABASE_URL, SUPABASE_KEY); }
  return sb;
}
const check = <T>(res: { data: T; error: { message: string } | null }) => { if (res.error) throw new Error(res.error.message); return res.data; };

class SupabaseAdapter implements DbAdapter {
  mode = 'supabase' as const;
  async init() { await getSupabase(); }
  async select<T>(table: string, o: SelectOpts = {}): Promise<T[]> {
    const c = await getSupabase();
    const out: T[] = [], page = 1000;
    for (let from = 0; ; from += page) {
      let q: any = c.from(table).select(o.columns ?? '*');
      for (const [k, v] of Object.entries(o.eq ?? {})) q = q.eq(k, v);
      if (o.in) { if (!o.in[1].length) return []; q = q.in(o.in[0], o.in[1]); }
      for (const [col, asc] of o.order ?? []) q = q.order(col, { ascending: asc !== false });
      const to = o.limit ? Math.min(from + page, o.limit) - 1 : from + page - 1;
      const rows = check<T[]>(await q.range(from, to));
      out.push(...rows);
      if (rows.length < page || (o.limit && out.length >= o.limit)) break;
    }
    return out;
  }
  async insert(table: string, rows: object[]) {
    const c = await getSupabase();
    for (let i = 0; i < rows.length; i += 500) check(await c.from(table).insert(rows.slice(i, i + 500)));
  }
  async upsert(table: string, rows: object[], conflict: string[]) {
    if (rows.length) check(await (await getSupabase()).from(table).upsert(rows, { onConflict: conflict.join(',') }));
  }
  async update(table: string, match: Record<string, Scalar>, patch: object) {
    check(await (await getSupabase()).from(table).update(patch).match(match));
  }
  async remove(table: string, match: Record<string, Scalar>) {
    check(await (await getSupabase()).from(table).delete().match(match));
  }
}

export function createAdapter(): DbAdapter {
  return DB_MODE === 'supabase' ? new SupabaseAdapter() : new LocalAdapter();
}
