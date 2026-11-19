// Repository: all database reads/writes go through here. Role checks are applied to every write
// (and enforced again by row-level security in Supabase mode).
import { createAdapter, DB_MODE, getSupabase, type DbAdapter } from './adapter';
import type {
  ActivityLogEntry, Attachment, CorrectiveAction, DailyReport, DrillingProblem, DrillingRecord, Formation,
  FormationInterval, HistoricalAlert, ProblemCategory, Rec, Role, SurveyStation, User, Well, WellSection,
  Operation, BhaRun, DrillingTool, CasingString, CementingEvent, HoleSection, SimEvent,
} from '../lib/types';
import type { Extraction } from '../import/smart/engine';
import { dailyReports, deriveFormationIntervals, deriveSections, prepareRecords } from '../lib/kpi';
import { minCurvature } from '../lib/survey';
import { DEFAULT_ALERT_CONFIG, type AlertConfig } from '../lib/matching';

let db: DbAdapter;
let me: User | null = null;
let ready: Promise<void> | null = null;

export function initDb(): Promise<void> {
  if (!ready) { db = createAdapter(); ready = db.init(); }
  return ready;
}
export const adapter = () => db;
export const setCurrentUser = (u: User | null) => { me = u; };
export const currentUser = () => me;
export const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export function canWrite(role?: Role | null) { return role === 'admin' || role === 'engineer'; }
function guard(level: 'write' | 'admin' = 'write') {
  if (!me) throw new Error('You are not signed in.');
  if (level === 'admin' ? me.role !== 'admin' : !canWrite(me.role)) throw new Error('Your role does not permit this action.');
}

// ------------------------------------------------------------------ activity log
export async function logActivity(action: string, detail?: string) {
  if (!me || !canWrite(me.role)) return;
  await db.insert('activity_log', [{ id: uid(), ts: now(), user_email: me.email, action, detail: detail ?? null }]);
}
export const recentActivity = (limit = 12) => db.select<ActivityLogEntry>('activity_log', { order: [['ts', false]], limit });

// ------------------------------------------------------------------ users
export const listUsers = () => db.select<User>('users', { order: [['created_at', true]] });
export async function setUserRole(id: string, role: Role) {
  guard('admin');
  await db.update('users', { id }, { role });
  await logActivity('Changed user role', role);
}

// ------------------------------------------------------------------ wells
export const listWells = () => db.select<Well>('wells', { order: [['spud_date', true], ['name', true]] });
export async function getWell(id: string) { return (await db.select<Well>('wells', { eq: { id } }))[0] ?? null; }
export async function createWell(w: Omit<Well, 'id' | 'created_at'>): Promise<Well> {
  guard();
  const code = w.well_code.trim();
  if (!code || !w.name.trim()) throw new Error('Well name and Well ID are required.');
  if ((await db.select<Well>('wells', { eq: { well_code: code } })).length)
    throw new Error(`A well with ID "${code}" already exists. Existing wells are never overwritten - choose a different Well ID.`);
  const well: Well = { ...w, well_code: code, id: uid() };
  await db.insert('wells', [{ ...well, created_by: me!.id }]);
  await logActivity('Added well', `${well.name} (${well.well_code})`);
  return well;
}
export async function updateWell(id: string, patch: Partial<Well>) {
  guard();
  await db.update('wells', { id }, patch);
  await logActivity('Updated well', Object.keys(patch).join(', '));
}
export async function deleteWell(well: Well) {
  guard('admin');
  await db.remove('wells', { id: well.id });   // children are removed by ON DELETE CASCADE
  recCache.delete(well.id);
  await logActivity('Deleted well', `${well.name} (${well.well_code})`);
}

/** Remove a well whose import failed part-way, so no half-imported well is left behind. */
export async function rollbackWell(id: string) {
  guard();
  await db.remove('wells', { id });
  recCache.delete(id);
}

// ------------------------------------------------------------------ drilling records
const recCache = new Map<string, Promise<Rec[]>>();
export function getRecords(wellId: string): Promise<Rec[]> {
  let p = recCache.get(wellId);
  if (!p) {
    p = db.select<DrillingRecord>('drilling_records', { eq: { well_id: wellId }, order: [['ts', true]] }).then(prepareRecords);
    p.catch(() => recCache.delete(wellId));
    recCache.set(wellId, p);
  }
  return p;
}
export async function createImportBatch(wellId: string, source_type: string, file_name: string | null, row_count: number, mapping: unknown, validation: unknown) {
  guard();
  const id = uid();
  await db.insert('import_batches', [{ id, well_id: wellId, source_type, file_name, row_count, mapping, validation, created_by: me!.id }]);
  return id;
}
export async function insertRecords(wellId: string, rows: Omit<DrillingRecord, 'well_id'>[], batchId: string | null) {
  guard();
  await db.insert('drilling_records', rows.map(r => ({ ...r, well_id: wellId, import_batch_id: batchId })));
  recCache.delete(wellId);
}

// ------------------------------------------------------------------ survey, sections, formations
export const getSurvey = (wellId: string) => db.select<SurveyStation>('survey_stations', { eq: { well_id: wellId }, order: [['md_ft', true]] });
export async function insertSurvey(wellId: string, stations: { md: number; inc: number; azi: number }[]) {
  guard();
  const traj = minCurvature(stations);
  await db.remove('survey_stations', { well_id: wellId });
  await db.insert('survey_stations', traj.map(p => ({
    well_id: wellId, md_ft: p.md, inclination_deg: p.inc, azimuth_deg: p.azi, tvd_ft: p.tvd, north_ft: p.north, east_ft: p.east,
  })));
}
export const getSections = (wellId: string) => db.select<WellSection>('well_sections', { eq: { well_id: wellId }, order: [['top_md_ft', true]] });
export const listSections = () => db.select<WellSection>('well_sections', { order: [['top_md_ft', true]] });

export const listFormations = () => db.select<Formation>('formations', { order: [['name', true]] });
async function ensureFormations(names: string[]): Promise<Map<string, string>> {
  const all = await listFormations();
  const map = new Map(all.map(f => [f.name, f.id]));
  const add = [...new Set(names)].filter(n => n && !map.has(n)).map(name => ({ id: uid(), name }));
  if (add.length) { await db.insert('formations', add); add.forEach(f => map.set(f.name, f.id)); }
  return map;
}
export async function setFormationCanonical(id: string, canonical_id: string | null) {
  guard();
  await db.update('formations', { id }, { canonical_id });
  await logActivity('Updated formation mapping');
}
/** Returns name -> canonical name using the manual equivalence mapping. */
export function canonResolver(formations: Formation[]) {
  const byId = new Map(formations.map(f => [f.id, f]));
  const byName = new Map(formations.map(f => [f.name.trim().toLowerCase(), f]));
  return (name: string | null | undefined): string | null => {
    if (!name) return null;
    let f = byName.get(name.trim().toLowerCase());
    if (!f) return name.trim().toLowerCase();
    for (let i = 0; i < 5 && f.canonical_id && byId.get(f.canonical_id); i++) f = byId.get(f.canonical_id)!;
    return f.name.trim().toLowerCase();
  };
}
export const getIntervals = (wellId: string) => db.select<FormationInterval>('formation_intervals', { eq: { well_id: wellId }, order: [['top_md_ft', true]] });
export const listIntervals = () => db.select<FormationInterval>('formation_intervals', { order: [['top_md_ft', true]] });
export async function addPrognosis(wellId: string, items: { formation_name: string; top_md_ft: number; bottom_md_ft: number }[]) {
  guard();
  const ids = await ensureFormations(items.map(i => i.formation_name));
  await db.insert('formation_intervals', items.map(i => ({ id: uid(), well_id: wellId, formation_id: ids.get(i.formation_name)!, ...i, is_prognosis: true })));
}
export async function removeInterval(id: string) { guard(); await db.remove('formation_intervals', { id }); }

// ------------------------------------------------------------------ derived data (rebuilt after every import)
export async function rebuildDerived(well: Well) {
  guard();
  recCache.delete(well.id);
  const recs = await getRecords(well.id);
  await db.remove('daily_reports', { well_id: well.id });
  await db.insert('daily_reports', dailyReports(well, recs));
  const ivs = deriveFormationIntervals(recs);
  const ids = await ensureFormations(ivs.map(i => i.formation_name));
  await db.remove('formation_intervals', { well_id: well.id, is_prognosis: false });
  await db.insert('formation_intervals', ivs.map(i => ({ id: uid(), well_id: well.id, formation_id: ids.get(i.formation_name)!, ...i, is_prognosis: false })));
  await db.remove('well_sections', { well_id: well.id });
  await db.insert('well_sections', deriveSections(recs, well).map(s => ({ id: uid(), well_id: well.id, ...s })));
  return recs;
}
export const listDailyReports = (wellId?: string) =>
  db.select<DailyReport>('daily_reports', { eq: wellId ? { well_id: wellId } : undefined, order: [['report_date', true]] });

// ------------------------------------------------------------------ problems
let catCache: Promise<ProblemCategory[]> | null = null;
export const listCategories = () => (catCache ??= db.select<ProblemCategory>('problem_categories', { order: [['name', true]] }));
export const listProblems = (wellId?: string) =>
  db.select<DrillingProblem>('drilling_problems', { eq: wellId ? { well_id: wellId } : undefined, order: [['md_top_ft', true]] });
export async function saveProblem(p: Partial<DrillingProblem> & { well_id: string; category_id: string; md_top_ft: number }, well: Well): Promise<DrillingProblem> {
  guard();
  let formation_id = p.formation_id ?? null;
  if (p.formation_name) formation_id = (await ensureFormations([p.formation_name])).get(p.formation_name) ?? null;
  if (p.id) {
    const { id, problem_code, created_at, ...patch } = p as DrillingProblem;
    await db.update('drilling_problems', { id }, { ...patch, formation_id });
    await logActivity('Updated problem', problem_code);
    return (await db.select<DrillingProblem>('drilling_problems', { eq: { id } }))[0];
  }
  const row = {
    occurred_at: null, md_bottom_ft: null, tvd_ft: null, formation_name: null, hole_size_in: null, bha_number: null,
    activity_code: null, description: '', observed_params: null, root_cause: null, npt_hours: 0, severity: 'medium',
    status: 'suspected', source: 'manual', notes: null, lessons_learned: null,
    ...p, formation_id, id: uid(),
    problem_code: p.problem_code ?? `PRB-${well.well_code}-${Date.now().toString(36).toUpperCase().slice(-6)}${Math.floor(Math.random() * 36).toString(36).toUpperCase()}`,
    created_by: me!.id,
  };
  await db.insert('drilling_problems', [row]);
  await logActivity('Recorded problem', `${row.problem_code} on ${well.name}`);
  return row as unknown as DrillingProblem;
}
export async function deleteProblem(p: DrillingProblem) { guard(); await db.remove('drilling_problems', { id: p.id }); await logActivity('Deleted problem', p.problem_code); }

export const listActions = (problemId?: string) =>
  db.select<CorrectiveAction>('corrective_actions', { eq: problemId ? { problem_id: problemId } : undefined, order: [['created_at', true]] });
export async function addAction(problem_id: string, action_text: string, outcome: string | null = null) {
  guard();
  await db.insert('corrective_actions', [{ id: uid(), problem_id, action_text, outcome, created_at: now() }]);
}
export async function removeAction(id: string) { guard(); await db.remove('corrective_actions', { id }); }

export const listAttachments = (problem_id: string) =>
  db.select<Attachment>('problem_attachments', { eq: { problem_id }, columns: 'id, problem_id, file_name, mime_type, size_bytes, storage_path', order: [['created_at', true]] });
export async function addAttachment(problem_id: string, file: File) {
  guard();
  const row: Record<string, unknown> = { id: uid(), problem_id, file_name: file.name, mime_type: file.type || null, size_bytes: file.size };
  if (DB_MODE === 'supabase') {
    const path = `${problem_id}/${row.id}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
    const { error } = await (await getSupabase()).storage.from('attachments').upload(path, file);
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    row.storage_path = path;
  } else {
    if (file.size > 5 * 1024 * 1024) throw new Error('In local mode attachments are limited to 5 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    row.data_base64 = btoa(bin);
  }
  await db.insert('problem_attachments', [row]);
}
export async function removeAttachment(a: Attachment) {
  guard();
  if (a.storage_path && DB_MODE === 'supabase') await (await getSupabase()).storage.from('attachments').remove([a.storage_path]);
  await db.remove('problem_attachments', { id: a.id });
}
/** Returns an object URL / signed URL for downloading an attachment. */
export async function attachmentUrl(a: Attachment): Promise<string> {
  if (a.storage_path && DB_MODE === 'supabase') {
    const { data, error } = await (await getSupabase()).storage.from('attachments').createSignedUrl(a.storage_path, 300);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  }
  const full = (await db.select<Attachment>('problem_attachments', { eq: { id: a.id } }))[0];
  const bin = atob(full?.data_base64 ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: a.mime_type ?? 'application/octet-stream' }));
}

// ------------------------------------------------------------------ historical alerts
export const listAlerts = (wellId?: string) =>
  db.select<HistoricalAlert>('historical_alerts', { eq: wellId ? { well_id: wellId } : undefined, order: [['updated_at', false]] });
export async function createAlert(a: Omit<HistoricalAlert, 'id' | 'status' | 'outcome' | 'comments'>): Promise<HistoricalAlert> {
  guard();
  const row: HistoricalAlert = { ...a, id: uid(), status: 'new', outcome: 'unknown', comments: [], created_at: now(), updated_at: now() };
  await db.upsert('historical_alerts', [row], ['well_id', 'problem_id']);
  return (await db.select<HistoricalAlert>('historical_alerts', { eq: { well_id: a.well_id, problem_id: a.problem_id } }))[0] ?? row;
}
export async function updateAlert(id: string, patch: Partial<HistoricalAlert>) {
  guard();
  await db.update('historical_alerts', { id }, { ...patch, updated_at: now() });
}

// ------------------------------------------------------------------ settings, sessions, comparisons
export async function getSetting<T extends object>(key: string, def: T): Promise<T> {
  const r = await db.select<{ value: T }>('app_settings', { eq: { key } });
  return r[0] ? { ...def, ...r[0].value } : def;
}
export async function setSetting(key: string, value: object) {
  guard();
  await db.upsert('app_settings', [{ key, value, updated_at: now() }], ['key']);
}
export async function getAlertConfig(): Promise<AlertConfig> {
  const c = await getSetting('alert_config', DEFAULT_ALERT_CONFIG);
  return { ...c, weights: { ...DEFAULT_ALERT_CONFIG.weights, ...c.weights } };
}

export interface SimSession { well_id: string | null; playhead_ts: string | null; speed: number }
export async function getSimSession(): Promise<SimSession | null> {
  if (!me) return null;
  return (await db.select<SimSession>('simulation_sessions', { eq: { user_id: me.id } }))[0] ?? null;
}
/** Per-user playback state; every role may store its own. */
export async function saveSimSession(s: SimSession) {
  if (!me) return;
  await db.upsert('simulation_sessions', [{ user_id: me.id, ...s, updated_at: now() }], ['user_id']);
}

export interface SavedComparison { id: string; name: string; well_ids: string[] }
export const listComparisons = () => db.select<SavedComparison>('offset_comparisons', { order: [['created_at', false]] });
export async function saveComparison(name: string, well_ids: string[]) {
  guard();
  await db.insert('offset_comparisons', [{ id: uid(), name, well_ids, created_by: me!.id }]);
}
export async function deleteComparison(id: string) { guard(); await db.remove('offset_comparisons', { id }); }

// ------------------------------------------------------------------ learned drilling terminology
// ------------------------------------------------------------------ operations, BHA runs, tools, casing, cementing, hole sections
export const findBatchByHash = async (hash: string) => (await db.select<{ id: string; well_id: string; file_name: string | null; created_at: string }>('import_batches', { eq: { file_hash: hash } }))[0] ?? null;
export async function setBatchHash(batchId: string, hash: string) { guard(); await db.update('import_batches', { id: batchId }, { file_hash: hash }); }

/** Save what the report reader found about operations and equipment, with their relations and source cells. */
export async function insertEquipment(wellId: string, batchId: string | null, ex: Pick<Extraction, 'operations' | 'bhaRuns' | 'tools' | 'casings' | 'cementJobs' | 'holeSections'>) {
  guard();
  const runId = new Map<number, string>(), csgId = new Map<number, string>();
  for (const b of ex.bhaRuns) runId.set(b.runNo, uid());
  for (const c of ex.casings) csgId.set(c.od, uid());
  if (ex.bhaRuns.length) await db.insert('bha_runs', ex.bhaRuns.map(b => ({ id: runId.get(b.runNo), well_id: wellId, import_batch_id: batchId, run_no: b.runNo, bha_type: b.bhaType, hole_size_in: b.holeSize, bit_size_in: b.bitSize,
    bit_type: b.bitType, bit_model: b.bitModel, bit_serial: b.bitSerial, bit_condition: b.bitCondition, nozzles: b.nozzles, dull_grade: b.dullGrade, start_at: b.start, end_at: b.end,
    depth_in_ft: b.depthIn, depth_out_ft: b.depthOut, description: b.description, source_ref: b.src })));
  if (ex.casings.length) await db.insert('casing_strings', ex.casings.map(c => ({ id: csgId.get(c.od), well_id: wellId, import_batch_id: batchId, kind: c.kind, od_in: c.od, weights: c.weights, grades: c.grades, connections: c.connections,
    top_md_ft: c.topMd, shoe_md_ft: c.shoeMd, shoe_basis: c.shoeBasis || null, float_collar_md_ft: c.floatCollarMd, landing_collar_md_ft: c.landingCollarMd, hole_size_in: c.holeSize, run_start: c.start, run_end: c.end, description: c.description, source_ref: c.src })));
  if (ex.operations.length) await db.insert('operations', ex.operations.map(o => ({ well_id: wellId, import_batch_id: batchId, seq: o.seq, type_code: o.code, category: o.category, start_at: o.start, end_at: o.end, duration_h: o.hours,
    start_md_ft: o.startMd, end_md_ft: o.endMd, hole_size_in: o.holeSize, bha_run_id: o.bhaRun != null ? runId.get(o.bhaRun) ?? null : null, casing_string_id: o.casingOd != null ? csgId.get(o.casingOd) ?? null : null,
    description: o.description, text: o.text.slice(0, 8000), task_raw: o.task, phase_raw: o.phase, steps: o.steps, status: 'completed', is_npt: o.isNpt, npt_category: o.nptCategory, basis: o.basis, confidence: o.confidence, source_ref: o.src })));
  if (ex.tools.length) await db.insert('drilling_tools', ex.tools.map(t => ({ well_id: wellId, import_batch_id: batchId, bha_run_id: t.bhaRun != null ? runId.get(t.bhaRun) ?? null : null, casing_string_id: t.casingOd != null ? csgId.get(t.casingOd) ?? null : null,
    category: t.category, tool_type: t.type, name: t.name, description: t.description, od_in: t.od, id_in: t.id, length_ft: t.lengthFt, quantity: t.quantity, quantity_unit: t.quantityUnit, serial_no: t.serial, manufacturer: t.manufacturer,
    specs: t.specs, run_no: t.bhaRun, hole_size_in: t.holeSize, installed_at: t.installedAt, retrieved_at: t.retrievedAt, source_ref: t.src, source_text: t.line.slice(0, 1000), entered_by: 'import' })));
  if (ex.cementJobs.length) await db.insert('cementing_events', ex.cementJobs.map(j => ({ well_id: wellId, import_batch_id: batchId, casing_string_id: j.casingOd != null ? csgId.get(j.casingOd) ?? null : null, casing_od_in: j.casingOd, kind: j.kind,
    stages: j.stages, start_at: j.start, end_at: j.end, steps: j.steps, fluids: j.fluids, displacement_bbl: j.displacementBbl, fcp_psi: j.fcpPsi, bump_psi: j.bumpPsi, plugs: j.plugs, losses_text: j.lossesText, woc_hours: j.wocHours, toc_md_ft: j.tocMd, description: j.description, source_ref: j.src })));
  if (ex.holeSections.length) await db.insert('hole_sections', ex.holeSections.map(s => ({ well_id: wellId, import_batch_id: batchId, section_no: s.no, hole_size_in: s.holeSize, bit_sizes_in: s.bitSizes, bit_types: s.bitTypes, casing_od_in: s.casingOd, casing_kind: s.casingKind,
    shoe_md_ft: s.shoeMd, top_md_ft: s.topMd, bottom_md_ft: s.bottomMd, formations: s.formations, bha_runs: s.bhaRuns, tools_count: s.tools, drill_start: s.drillStart, drill_end: s.drillEnd, start_at: s.start, end_at: s.end,
    duration_h: s.hours, avg_rop_fph: s.avgRopFph, npt_hours: s.nptHours, source_ref: s.src })));
}
export interface WellEquipment { operations: Operation[]; runs: BhaRun[]; tools: DrillingTool[]; casings: CasingString[]; cementing: CementingEvent[]; sections: HoleSection[] }
export async function getEquipment(wellId: string): Promise<WellEquipment> {
  const eq = { eq: { well_id: wellId } };
  const [operations, runs, tools, casings, cementing, sections] = await Promise.all([
    db.select<Operation>('operations', { ...eq, order: [['start_at', true]] }), db.select<BhaRun>('bha_runs', { ...eq, order: [['run_no', true]] }),
    db.select<DrillingTool>('drilling_tools', { ...eq, order: [['run_no', true], ['installed_at', true]] }), db.select<CasingString>('casing_strings', { ...eq, order: [['run_start', true]] }),
    db.select<CementingEvent>('cementing_events', { ...eq, order: [['start_at', true]] }), db.select<HoleSection>('hole_sections', { ...eq, order: [['section_no', true]] }),
  ]);
  return { operations, runs, tools, casings, cementing, sections };
}
/** Engineer correction of an operation's name; the reader's original is kept. */
export async function correctOperation(op: Operation, typeCode: string, category: string) {
  guard();
  await db.update('operations', { id: op.id }, { type_code: typeCode, category, basis: 'engineer', confidence: 1, original_type_code: op.original_type_code ?? op.type_code, corrected_by: me!.email, corrected_at: new Date().toISOString() });
  await logActivity('Corrected operation', `${op.source_ref ?? op.id}: ${op.type_code} -> ${typeCode}`);
}
export async function saveTool(t: Partial<DrillingTool> & { well_id: string; category: string; tool_type: string; name: string }) {
  guard();
  if (t.id) { const { id, ...patch } = t; await db.update('drilling_tools', { id }, { ...patch, entered_by: patch.entered_by === 'manual' ? 'manual' : 'corrected', updated_at: new Date().toISOString() }); return; }
  await db.insert('drilling_tools', [{ ...t, id: uid(), entered_by: 'manual', source_ref: t.source_ref ?? `entered by ${me!.email}` }]);
}
export async function deleteTool(id: string) { guard(); await db.remove('drilling_tools', { id }); }

// ------------------------------------------------------------------ current-well problem alerts (review state)
export const listSimEvents = (wellId: string) => db.select<SimEvent>('simulation_events', { eq: { well_id: wellId } });
export async function upsertSimEvent(e: Pick<SimEvent, 'well_id' | 'problem_id'> & Partial<SimEvent>): Promise<SimEvent> {
  guard();
  const row = { event_type: 'current_problem', status: 'new', comments: [], ...e, updated_at: new Date().toISOString() };
  await db.upsert('simulation_events', [row], ['well_id', 'problem_id', 'event_type']);
  return (await db.select<SimEvent>('simulation_events', { eq: { well_id: e.well_id, problem_id: e.problem_id } }))[0];
}

// ------------------------------------------------------------------ values read inside report cells (traceability)
export interface ExtractedParameter {
  id: string; well_id: string; import_batch_id: string | null; hit_id: string; param_key: string; param_label: string; param_group: string | null; qualifier: string | null; context: string | null;
  value_num: number | null; value_min: number | null; value_max: number | null; value_text: string | null; unit_raw: string | null; unit: string | null; unit_basis: string | null;
  value_canonical: number | null; unit_canonical: string | null; sheet: string; cell: string; source_ref: string; original_text: string; line_text: string | null;
  occurred_at: string | null; md_ft: number | null; confidence: number; method: string; status: string; review: string | null; original_value: string | null; notes: string | null; used: boolean;
}
type HitRow = { id: string; key: string; label: string; group: string; qualifier: string | null; context: string; value: number | string; min: number | null; max: number | null; unitRaw: string | null; unit: string | null; unitBasis: string;
  canonical: number | null; canonicalUnit: string | null; sheet: string; cell: string; src: string; text: string; line: string; ts: string | null; md_ft: number | null; confidence: number; method: string; status: string;
  review?: string; original?: { key: string; value: number | string }; notes: string[]; use: boolean };
export async function insertExtractedParameters(wellId: string, batchId: string | null, hits: HitRow[]) {
  guard();
  await db.insert('extracted_parameters', hits.map(h => ({
    well_id: wellId, import_batch_id: batchId, hit_id: h.id, param_key: h.key, param_label: h.label, param_group: h.group, qualifier: h.qualifier, context: h.context,
    value_num: typeof h.value === 'number' ? h.value : null, value_min: h.min, value_max: h.max, value_text: typeof h.value === 'string' ? h.value : null,
    unit_raw: h.unitRaw, unit: h.unit, unit_basis: h.unitBasis, value_canonical: h.canonical, unit_canonical: h.canonicalUnit,
    sheet: h.sheet, cell: h.cell, source_ref: h.src, original_text: h.text.slice(0, 2000), line_text: h.line.slice(0, 4000), occurred_at: h.ts, md_ft: h.md_ft,
    confidence: h.confidence, method: h.method, status: h.status, review: h.review ?? null,
    original_value: h.original ? `${h.original.key}: ${h.original.value}` : null, notes: h.notes.join('; ') || null, used: h.use && h.status !== 'rejected',
  })));
}
export const listExtractedParameters = (wellId: string) =>
  db.select<ExtractedParameter>('extracted_parameters', { eq: { well_id: wellId }, order: [['occurred_at', true], ['hit_id', true]] });

export async function getLearnedTerms(): Promise<Record<string, string>> {
  const rows = await db.select<{ term: string; concept: string }>('term_dictionary');
  return Object.fromEntries(rows.map(r => [r.term, r.concept]));
}
export async function learnTerms(terms: Record<string, string>) {
  guard();
  const rows = Object.entries(terms).map(([term, concept]) => ({ term, concept, created_by: me!.id }));
  if (rows.length) await db.upsert('term_dictionary', rows, ['term']);
}

// ------------------------------------------------------------------ backup
const BACKUP_TABLES = ['wells', 'well_sections', 'formations', 'formation_intervals', 'drilling_records', 'survey_stations',
  'drilling_problems', 'corrective_actions', 'historical_alerts', 'daily_reports', 'offset_comparisons', 'app_settings'];
export async function exportBackup(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) out[t] = await db.select(t, t === 'drilling_records' ? { order: [['ts', true]] } : {});
  return out;
}
