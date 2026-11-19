/// <reference types="node" />
// The schema runs on a real PostgreSQL (PGlite, in memory): every table, constraint and seed row is created,
// running it twice is harmless, the operation catalogue in the database equals the one in the code,
// and the same file cannot be imported twice.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { OP_CATEGORIES, OP_TYPES } from '../lib/operations';

const SQL = readFileSync(resolve(process.cwd(), 'supabase/migrations/0001_schema.sql'), 'utf8');

describe('database schema (PostgreSQL)', async () => {
  const db = new PGlite();
  await db.exec(SQL);
  await db.exec(SQL);   // idempotent
  it('creates the operations, equipment, hole-section and alert-review tables', async () => {
    const r = await db.query<{ table_name: string }>(`select table_name from information_schema.tables where table_schema = 'public'`);
    const names = r.rows.map(x => x.table_name);
    for (const t of ['operations', 'operation_types', 'operation_categories', 'bha_runs', 'drilling_tools', 'casing_strings', 'cementing_events', 'hole_sections', 'simulation_events', 'historical_alerts', 'drilling_problems'])
      expect(names).toContain(t);
  });
  it('seeds the operation catalogue exactly as the code defines it', async () => {
    const cats = (await db.query<{ code: string }>('select code from operation_categories order by sort_order')).rows.map(x => x.code);
    expect(cats).toEqual([...OP_CATEGORIES]);
    const types = (await db.query<{ code: string; name: string; category: string; activity_code: string }>('select * from operation_types')).rows;
    expect(types.length).toBe(OP_TYPES.length);
    for (const t of OP_TYPES) expect(types.find(x => x.code === t.code)).toMatchObject({ name: t.name, category: t.category, activity_code: t.activity });
  });
  it('relates wells, operations, BHA runs, tools and casing strings, and refuses a duplicate import', async () => {
    const w = (await db.query<{ id: string }>(`insert into wells (well_code, name) values ('T-1', 'Test') returning id`)).rows[0].id;
    const b = (await db.query<{ id: string }>(`insert into import_batches (well_id, source_type, file_hash) values ($1, 'excel', 'abc') returning id`, [w])).rows[0].id;
    await expect(db.query(`insert into import_batches (well_id, source_type, file_hash) values ($1, 'excel', 'abc')`, [w])).rejects.toThrow();
    const run = (await db.query<{ id: string }>(`insert into bha_runs (well_id, import_batch_id, run_no, bit_size_in) values ($1, $2, 1, 12.25) returning id`, [w, b])).rows[0].id;
    await db.query(`insert into drilling_tools (well_id, bha_run_id, category, tool_type, name, od_in) values ($1, $2, 'BHA', 'PDC Bit', '12-1/4" PDC', null)`, [w, run]);
    await db.query(`insert into operations (well_id, seq, type_code, category, start_at, end_at, duration_h, bha_run_id, basis) values ($1, 1, 'DRL_ROT', 'Drilling', now(), now(), 1, $2, 'task code')`, [w, run]);
    await expect(db.query(`insert into operations (well_id, seq, type_code, category, start_at, end_at, duration_h, basis) values ($1, 2, 'NOT_A_TYPE', 'Drilling', now(), now(), 1, 'x')`, [w])).rejects.toThrow();
    await db.query('delete from wells where id = $1', [w]);
    expect((await db.query('select * from drilling_tools')).rows).toHaveLength(0);   // cascade
  });
});
