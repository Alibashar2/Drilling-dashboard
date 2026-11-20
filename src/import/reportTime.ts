// The one place where a report's clock times become UTC instants.
// The readers (parse.ts, smart/engine.ts, smart/equipment.ts) work on the report clock: every time they produce is an ISO string
// whose UTC fields are the clock time written in the report. Drilling reports are written in rig local time (TIME_ZONE), so
// before anything is shown or saved those strings are converted to the real UTC instant, exactly once.
import type { ImportRecord } from './parse';
import type { Extraction } from './smart/engine';
import { wallToUtc } from '../lib/time';

/** Exactly the strings the readers create with Date#toISOString(); dates, clock texts and source text are never touched. */
const READER_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const reportIsoToUtc = (s: string) => new Date(wallToUtc(Date.parse(s))).toISOString();

function walk<T>(v: T): T {
  if (typeof v === 'string') return (READER_ISO.test(v) ? reportIsoToUtc(v) : v) as T;
  if (Array.isArray(v)) return v.map(walk) as T;
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = walk(x);
    return o as T;
  }
  return v;
}

/** Drilling records from a mapped sheet, with report clock times converted to UTC. */
export const recordsToUtc = (recs: ImportRecord[]): ImportRecord[] => walk(recs);

/**
 * An extraction with every timestamp converted to UTC: records, operations, BHA runs, tools, casing, cementing, hole sections,
 * problems, NPT candidates, cell values and the per-day operation list. Report dates ("YYYY-MM-DD"), the well-information block and
 * the per-day header fields keep the report's own values.
 */
export function extractionToUtc(ex: Extraction): Extraction {
  if (converted.has(ex)) return ex;   // never convert the same extraction twice
  const out: Extraction = {
    ...ex,
    records: walk(ex.records), problems: walk(ex.problems), nptCandidates: walk(ex.nptCandidates), cellParams: walk(ex.cellParams),
    operations: walk(ex.operations), bhaRuns: walk(ex.bhaRuns), tools: walk(ex.tools), casings: walk(ex.casings), cementJobs: walk(ex.cementJobs), holeSections: walk(ex.holeSections),
    days: ex.days.map(d => ({ ...d, ops: walk(d.ops) })),
  };
  converted.add(out);
  return out;
}
const converted = new WeakSet<Extraction>();
