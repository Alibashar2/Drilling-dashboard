/// <reference types="node" />
// Asia/Baghdad display of UTC timestamps, report-clock conversion on import, and the one-time database correction.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { dayRange, dayStart, fmtDateTime, fmtTime, fromLocalInput, localDay, offsetMs, TIME_ZONE, toLocalInput, toMs, utcOffsetLabel, utcToWall, wallToUtc, zoneLabel } from './time';
import { dailyReports, prepareRecords } from './kpi';
import { parseDate } from '../import/parse';
import { extractionToUtc, recordsToUtc, reportIsoToUtc } from '../import/reportTime';
import type { Extraction } from '../import/smart/engine';
import type { DrillingRecord } from './types';

const H = 3600000;

describe('UTC -> Asia/Baghdad display', () => {
  it('shows a UTC timestamp in Baghdad time (09:00 UTC = 12:00 Baghdad)', () => {
    expect(TIME_ZONE).toBe('Asia/Baghdad');
    expect(fmtDateTime('2026-11-20T09:00:00Z')).toBe('2026-11-20 12:00');
    expect(fmtTime(Date.UTC(2026, 10, 20, 9))).toBe('12:00');
    expect(zoneLabel(Date.UTC(2026, 10, 20))).toBe('Asia/Baghdad | UTC+03:00');
  });
  it('honours the Z suffix and explicit offsets, and treats a zone-less database value as UTC', () => {
    const same = ['2026-11-20T09:00:00Z', '2026-11-20T09:00:00.000Z', '2026-11-20T12:00:00+03:00', '2026-11-20T12:00:00+0300', '2026-11-20 09:00:00+00', '2026-11-20T09:00:00', '2026-11-20T05:00:00-04:00'];
    for (const s of same) expect(toMs(s), s).toBe(Date.UTC(2026, 10, 20, 9));
    expect(toMs(new Date(Date.UTC(2026, 10, 20, 9)))).toBe(Date.UTC(2026, 10, 20, 9));
    expect(toMs('not a date')).toBeNull();
    expect(fmtDateTime(null)).toBe('—');
  });
  it('preserves minutes and seconds', () => {
    expect(fmtDateTime('2026-11-20T09:07:45Z')).toBe('2026-11-20 12:07:45');
    expect(fmtDateTime('2026-11-20T09:07:00Z')).toBe('2026-11-20 12:07');
    expect(wallToUtc(Date.UTC(2026, 10, 20, 12, 7, 45, 250))).toBe(Date.UTC(2026, 10, 20, 9, 7, 45, 250));
  });
  it('moves events after 21:00 UTC to the next Baghdad calendar date', () => {
    expect(localDay('2026-11-20T20:59:59Z')).toBe('2026-11-20');
    expect(localDay('2026-11-20T21:00:00Z')).toBe('2026-11-21');
    expect(fmtDateTime('2026-11-20T22:30:00Z')).toBe('2026-11-21 01:30');
    expect(fmtDateTime('2026-12-31T22:00:00Z')).toBe('2027-01-01 01:00');   // across a year end
  });
  it('filters a Baghdad date with the right UTC boundaries', () => {
    const [a, b] = dayRange('2026-11-21');
    expect(new Date(a).toISOString()).toBe('2026-11-20T21:00:00.000Z');
    expect(new Date(b).toISOString()).toBe('2026-11-21T21:00:00.000Z');
    expect(dayStart('2026-11-21')).toBe(a);
  });
  it('uses the IANA zone rules, not a fixed +3 hours (Iraq observed summer time until 2007)', () => {
    expect(offsetMs(Date.UTC(2026, 6, 1))).toBe(3 * H);
    expect(offsetMs(Date.UTC(2006, 6, 1))).toBe(4 * H);
    expect(utcOffsetLabel(Date.UTC(2006, 6, 1))).toBe('UTC+04:00');
    expect(fmtDateTime('2006-07-01T08:00:00Z')).toBe('2006-07-01 12:00');
  });
  it('round-trips datetime-local inputs in Baghdad time', () => {
    expect(toLocalInput('2026-11-20T21:30:00Z')).toBe('2026-11-21T00:30');
    expect(fromLocalInput('2026-11-21T00:30')).toBe('2026-11-20T21:30:00.000Z');
    expect(fromLocalInput('')).toBeNull();
  });
});

describe('report clock -> UTC on import (exactly once)', () => {
  it('converts a report time written in Baghdad time to the UTC instant', () => {
    const clock = parseDate('9/8/2025 6:00:00 PM', 'DMY')!;      // as written in the report
    expect(new Date(clock).toISOString()).toBe('2025-08-09T18:00:00.000Z');   // report clock, before conversion
    const utc = reportIsoToUtc(new Date(clock).toISOString());
    expect(utc).toBe('2025-08-09T15:00:00.000Z');
    expect(fmtDateTime(utc)).toBe('2025-08-09 18:00');   // shown exactly as the report wrote it
  });
  it('does not convert a time that already carries a zone twice', () => {
    for (const s of ['2025-08-09T15:00:00Z', '2025-08-09T18:00:00+03:00', '2025-08-09T16:00:00+01:00']) {
      const clock = parseDate(s, 'DMY')!;
      expect(reportIsoToUtc(new Date(clock).toISOString()), s).toBe('2025-08-09T15:00:00.000Z');
    }
    expect(utcToWall(wallToUtc(Date.UTC(2025, 7, 9, 18)))).toBe(Date.UTC(2025, 7, 9, 18));
  });
  it('converts every timestamp of an extraction once, and leaves dates and text alone', () => {
    const ex = {
      records: [{ ts: '2025-08-10T01:45:00.000Z', activity_raw: 'POOH 2025-08-10T01:45:00Z text', extra: { at: '2025-08-10T02:00:00.000Z', note: '6:00 PM' } }],
      problems: [{ ts: '2025-08-10T01:45:00.000Z' }], nptCandidates: [{ start: '2025-08-09T23:00:00.000Z' }], cellParams: [], operations: [{ start: '2025-08-10T00:00:00.000Z', end: '2025-08-10T01:45:00.000Z' }],
      bhaRuns: [], tools: [{ installedAt: null }], casings: [], cementJobs: [], holeSections: [],
      days: [{ date: '2025-08-10', fields: { md: { value: '2025-08-10T00:00:00.000Z' } }, ops: [{ start: '2025-08-10T00:00:00.000Z' }] }],
      wellInfo: { spud_date: { value: '2025-08-01' } },
    } as unknown as Extraction;
    const u = extractionToUtc(ex) as unknown as typeof ex & Record<string, any>;
    const r = (u as any).records[0];
    expect(r.ts).toBe('2025-08-09T22:45:00.000Z');
    expect(r.activity_raw).toBe('POOH 2025-08-10T01:45:00Z text');
    expect(r.extra).toEqual({ at: '2025-08-09T23:00:00.000Z', note: '6:00 PM' });
    expect((u as any).operations[0]).toEqual({ start: '2025-08-09T21:00:00.000Z', end: '2025-08-09T22:45:00.000Z' });
    expect((u as any).nptCandidates[0].start).toBe('2025-08-09T20:00:00.000Z');
    expect((u as any).days[0].date).toBe('2025-08-10');
    expect((u as any).days[0].fields.md.value).toBe('2025-08-10T00:00:00.000Z');
    expect((u as any).days[0].ops[0].start).toBe('2025-08-09T21:00:00.000Z');
    expect(extractionToUtc(u)).toBe(u);   // a second call does nothing
    expect((ex as any).records[0].ts).toBe('2025-08-10T01:45:00.000Z');   // the reader's own result is not modified
    expect(recordsToUtc([{ ts: '2025-08-10T01:45:00.000Z' } as never])[0].ts).toBe('2025-08-09T22:45:00.000Z');
  });
  it('assigns daily reports to the Baghdad calendar date', () => {
    const rec = (ts: string, hole: number): DrillingRecord => ({ ts, hole_depth_ft: hole, md_ft: hole, activity_code: 'ROT', npt_hours: null } as unknown as DrillingRecord);
    // 23:00 and 23:30 Baghdad on 20 Nov, then 00:00-00:30 Baghdad on 21 Nov (21:00 UTC is local midnight)
    const days = dailyReports({ id: 'w' }, prepareRecords([rec('2026-11-20T20:00:00Z', 100), rec('2026-11-20T20:30:00Z', 110), rec('2026-11-20T21:00:00Z', 120), rec('2026-11-20T21:30:00Z', 130)]));
    expect(days.map(d => d.report_date)).toEqual(['2026-11-20', '2026-11-21']);
  });
});

describe('one-time correction of report times already in the database', async () => {
  const read = (f: string) => readFileSync(resolve(process.cwd(), 'supabase/migrations', f), 'utf8');
  const db = new PGlite();
  await db.exec(read('0001_schema.sql'));
  // a database written by the previous version: report clock 18:00 stored as 18:00Z
  const w = (await db.query<{ id: string }>(`insert into wells (well_code, name) values ('OLD-1', 'Old') returning id`)).rows[0].id;
  await db.query(`insert into drilling_records (well_id, ts) values ($1, '2025-08-09T18:00:00Z'), ($1, '2025-08-09T21:00:00Z')`, [w]);
  await db.query(`insert into drilling_problems (problem_code, well_id, category_id, occurred_at, md_top_ft, created_at)
    select 'P-1', $1, id, '2025-08-10T01:00:00Z', 100, '2026-01-01T10:00:00Z' from problem_categories limit 1`, [w]);
  // two operations of the same cell 3 h apart: shifting one onto the other must not break the uniqueness constraint
  await db.query(`insert into operations (well_id, seq, type_code, category, start_at, end_at, duration_h, basis, source_ref) values
    ($1, 1, 'DRL_ROT', 'Drilling', '2025-08-09T15:00:00Z', '2025-08-09T18:00:00Z', 3, 'x', 'Sheet!Q2'), ($1, 2, 'DRL_ROT', 'Drilling', '2025-08-09T18:00:00Z', '2025-08-09T21:00:00Z', 3, 'x', 'Sheet!Q2')`, [w]);
  await db.query(`insert into activity_log (ts, action) values ('2026-01-01T10:00:00Z', 'login')`);
  await db.exec(read('0003_report_times_utc.sql'));
  await db.exec(read('0003_report_times_utc.sql'));   // runs again on every start: must not convert twice
  const iso = (rows: { v: Date }[]) => rows.map(r => r.v.toISOString());

  it('moves report times to UTC once, so they still show as the report wrote them', async () => {
    const ts = iso((await db.query<{ v: Date }>('select ts as v from drilling_records order by ts')).rows);
    expect(ts).toEqual(['2025-08-09T15:00:00.000Z', '2025-08-09T18:00:00.000Z']);
    expect(ts.map(fmtDateTime)).toEqual(['2025-08-09 18:00', '2025-08-09 21:00']);
    const ops = (await db.query<{ a: Date; b: Date }>('select start_at a, end_at b from operations order by seq')).rows;
    expect(ops.map(o => [o.a.toISOString(), o.b.toISOString()])).toEqual([['2025-08-09T12:00:00.000Z', '2025-08-09T15:00:00.000Z'], ['2025-08-09T15:00:00.000Z', '2025-08-09T18:00:00.000Z']]);
    expect(iso((await db.query<{ v: Date }>('select occurred_at as v from drilling_problems')).rows)).toEqual(['2025-08-09T22:00:00.000Z']);
  });
  it('leaves database-generated UTC times, row counts and the marker as expected', async () => {
    expect(iso((await db.query<{ v: Date }>('select created_at as v from drilling_problems')).rows)).toEqual(['2026-01-01T10:00:00.000Z']);
    expect(iso((await db.query<{ v: Date }>(`select ts as v from activity_log where action = 'login'`)).rows)).toEqual(['2026-01-01T10:00:00.000Z']);
    expect((await db.query('select * from drilling_records')).rows).toHaveLength(2);
    expect((await db.query(`select * from app_settings where key = 'migration.report_times_utc'`)).rows).toHaveLength(1);
  });
  it('does nothing on a new database', async () => {
    const fresh = new PGlite();
    await fresh.exec(read('0001_schema.sql'));
    await fresh.exec(read('0003_report_times_utc.sql'));
    const ww = (await fresh.query<{ id: string }>(`insert into wells (well_code, name) values ('NEW-1', 'New') returning id`)).rows[0].id;
    await fresh.query(`insert into drilling_records (well_id, ts) values ($1, '2025-08-09T15:00:00Z')`, [ww]);   // written as real UTC by this version
    await fresh.exec(read('0003_report_times_utc.sql'));
    expect(iso((await fresh.query<{ v: Date }>('select ts as v from drilling_records')).rows)).toEqual(['2025-08-09T15:00:00.000Z']);
  });
});
