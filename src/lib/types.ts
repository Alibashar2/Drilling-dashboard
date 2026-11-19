// Domain types. All stored depths are in feet; MD, TVD, bit depth and hole depth are distinct fields.

export type Role = 'admin' | 'engineer' | 'viewer';
export interface User { id: string; email: string; full_name: string; role: Role; created_at?: string }

export type WellStatus = 'planned' | 'active' | 'completed';
export interface Well {
  id: string; well_code: string; name: string;
  field: string | null; location: string | null; well_type: string | null;
  status: WellStatus;
  spud_date: string | null; planned_completion_date: string | null; completion_date: string | null;
  target_depth_ft: number | null; hole_size_in: number | null;
  source_depth_unit: 'ft' | 'm'; is_demo: boolean; notes: string | null; created_at?: string;
}

export interface DrillingRecord {
  id?: string; well_id: string; import_batch_id?: string | null; ts: string;
  md_ft: number | null; tvd_ft: number | null; bit_depth_ft: number | null; hole_depth_ft: number | null;
  rop_fph: number | null; wob_klb: number | null; rpm: number | null; torque_ftlb: number | null;
  spp_psi: number | null; diff_pressure_psi: number | null; flow_gpm: number | null;
  mud_weight_ppg: number | null; hook_load_klb: number | null;
  drilling_hours: number | null; circulating_hours: number | null; connection_time_min: number | null;
  npt_hours: number | null;
  activity_code: string | null; activity_raw: string | null; formation_name: string | null;
  bha_number: number | null; hole_size_in: number | null; problem_text: string | null;
  /** worksheet!cell the record was extracted from */
  source_ref?: string | null;
  /** 'reported' = value present in the source, 'interpolated' = spread across a reported interval */
  data_quality?: string | null;
  /** recognised parameters with no dedicated column (ECD, EGT, lithology ...) */
  extra?: Record<string, unknown> | null;
}

/** A record prepared for analysis. */
export interface Rec extends DrillingRecord {
  t: number;     // epoch ms (UTC)
  dt: number;    // duration represented by this record, hours
  hole: number;  // effective hole depth (running maximum), ft
  ft: number;    // new hole made by this record, ft
  npt: number;   // non-productive hours attributed to this record
}

export interface SurveyStation {
  id?: string; well_id: string; md_ft: number; inclination_deg: number; azimuth_deg: number;
  tvd_ft: number | null; north_ft: number | null; east_ft: number | null;
}
export interface WellSection {
  id?: string; well_id: string; name: string; hole_size_in: number | null; bha_number: number | null;
  top_md_ft: number; bottom_md_ft: number;
}
export interface Formation { id: string; name: string; canonical_id: string | null; description: string | null }
export interface FormationInterval {
  id?: string; well_id: string; formation_id: string; formation_name: string;
  top_md_ft: number; bottom_md_ft: number; top_tvd_ft: number | null; bottom_tvd_ft: number | null;
  is_prognosis: boolean;
}
export interface Activity { code: string; name: string; color: string; is_productive: boolean; sort_order: number }
export interface ProblemCategory { id: string; code: string; name: string; default_severity: Severity }

export type ProblemStatus = 'anomaly' | 'suspected' | 'confirmed' | 'dismissed';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export interface DrillingProblem {
  id: string; problem_code: string; well_id: string; occurred_at: string | null;
  md_top_ft: number; md_bottom_ft: number | null; tvd_ft: number | null;
  formation_id: string | null; formation_name: string | null;
  hole_size_in: number | null; bha_number: number | null; activity_code: string | null;
  category_id: string; description: string;
  observed_params: Record<string, number> | null;
  root_cause: string | null; npt_hours: number; severity: Severity; status: ProblemStatus;
  source: 'manual' | 'auto' | 'import' | 'demo';
  notes: string | null; lessons_learned: string | null; created_at?: string;
  source_ref?: string | null; source_text?: string | null; extraction?: Record<string, unknown> | null;
}
export interface CorrectiveAction { id: string; problem_id: string; action_text: string; outcome: string | null; created_at?: string }
export interface Attachment {
  id: string; problem_id: string; file_name: string; mime_type: string | null; size_bytes: number | null;
  storage_path: string | null; data_base64: string | null;
}

export type AlertColor = 'green' | 'yellow' | 'orange' | 'red';
export interface AlertComment { at: string; by: string; text: string }
export interface HistoricalAlert {
  id: string; well_id: string; problem_id: string; level: Exclude<AlertColor, 'green'>;
  match_types: string[]; similarity: number; reasons: string[]; trigger_md_ft: number | null;
  status: 'new' | 'acknowledged' | 'reviewed'; outcome: 'unknown' | 'occurred' | 'not_occurred';
  comments: AlertComment[]; created_at?: string; updated_at?: string;
}

// ---- operations, equipment, hole sections (v3)
export interface Operation {
  id: string; well_id: string; seq: number; type_code: string; category: string; start_at: string; end_at: string; duration_h: number;
  start_md_ft: number | null; end_md_ft: number | null; hole_size_in: number | null; bha_run_id: string | null; casing_string_id: string | null;
  description: string | null; text: string | null; task_raw: string | null; phase_raw: string | null; steps: string[];
  status: 'completed' | 'in_progress' | 'planned'; is_npt: boolean; npt_category: string | null; basis: string; confidence: number; source_ref: string | null;
  original_type_code: string | null; corrected_by: string | null; corrected_at: string | null;
}
export interface BhaRun {
  id: string; well_id: string; run_no: number; bha_type: string | null; hole_size_in: number | null; bit_size_in: number | null; bit_type: string | null;
  bit_model: string | null; bit_serial: string | null; bit_condition: string | null; nozzles: string | null; dull_grade: string | null;
  start_at: string | null; end_at: string | null; depth_in_ft: number | null; depth_out_ft: number | null; description: string | null; source_ref: string | null;
}
export interface DrillingTool {
  id: string; well_id: string; bha_run_id: string | null; casing_string_id: string | null; category: string; tool_type: string; name: string; description: string | null;
  od_in: number | null; id_in: number | null; length_ft: number | null; quantity: number | null; quantity_unit: string | null; serial_no: string | null; manufacturer: string | null;
  specs: Record<string, string | number>; run_no: number | null; hole_size_in: number | null; installed_at: string | null; retrieved_at: string | null;
  source_ref: string | null; source_text: string | null; entered_by: 'import' | 'manual' | 'corrected';
}
export interface CasingString {
  id: string; well_id: string; kind: 'casing' | 'liner'; od_in: number; weights: { ppf: number; from: number | null; to: number | null }[]; grades: string[]; connections: string[];
  top_md_ft: number | null; shoe_md_ft: number | null; shoe_basis: string | null; float_collar_md_ft: number | null; landing_collar_md_ft: number | null; hole_size_in: number | null;
  run_start: string | null; run_end: string | null; description: string | null; source_ref: string | null;
}
export interface CementingEvent {
  id: string; well_id: string; casing_string_id: string | null; casing_od_in: number | null; kind: string | null; stages: number; start_at: string | null; end_at: string | null;
  steps: string[]; fluids: { fluid: string; densityPpg: number; text: string; src: string }[]; displacement_bbl: number | null; fcp_psi: number | null; bump_psi: number | null;
  plugs: string[]; losses_text: string | null; woc_hours: number | null; toc_md_ft: number | null; description: string | null; source_ref: string | null;
}
export interface HoleSection {
  id: string; well_id: string; section_no: number; hole_size_in: number | null; bit_sizes_in: number[]; bit_types: string[]; casing_od_in: number | null; casing_kind: string | null;
  shoe_md_ft: number | null; top_md_ft: number | null; bottom_md_ft: number | null; formations: string[]; bha_runs: number[]; tools_count: number;
  drill_start: string | null; drill_end: string | null; start_at: string | null; end_at: string | null; duration_h: number | null; avg_rop_fph: number | null; npt_hours: number | null; source_ref: string | null;
}
export interface SimEvent { id: string; well_id: string; problem_id: string; event_type: 'current_problem'; status: 'new' | 'acknowledged' | 'reviewed'; comments: AlertComment[]; first_shown_at?: string; updated_at?: string }

export interface DailyReport {
  id?: string; well_id: string; report_date: string; day_number: number;
  start_md_ft: number | null; end_md_ft: number | null; footage_ft: number;
  total_hours: number; drilling_hours: number; connection_hours: number; circulating_hours: number;
  tripping_hours: number; other_hours: number; npt_hours: number;
  avg_rop_fph: number | null; avg_wob_klb: number | null; avg_rpm: number | null; avg_torque_ftlb: number | null;
  avg_spp_psi: number | null; avg_flow_gpm: number | null; avg_diff_psi: number | null; mud_weight_ppg: number | null;
  activity_hours: Record<string, number> | null; formations: string | null; summary: string | null;
}

export interface ActivityLogEntry { id: string; ts: string; user_email: string | null; action: string; detail: string | null }

export const ACTIVITIES: Activity[] = [
  { code: 'ROT', name: 'Drilling Rotary', color: '#16a34a', is_productive: true, sort_order: 1 },
  { code: 'SLD', name: 'Drilling Slide', color: '#d97706', is_productive: true, sort_order: 2 },
  { code: 'CON', name: 'Connection', color: '#c026d3', is_productive: true, sort_order: 3 },
  { code: 'TRP', name: 'Tripping', color: '#3b82f6', is_productive: true, sort_order: 4 },
  { code: 'CIR', name: 'Circulating', color: '#ca8a04', is_productive: true, sort_order: 5 },
  { code: 'REA', name: 'Reaming', color: '#8b5cf6', is_productive: true, sort_order: 6 },
  { code: 'WOO', name: 'Waiting on Operations', color: '#e11d48', is_productive: false, sort_order: 7 },
  { code: 'OTH', name: 'Other', color: '#64748b', is_productive: true, sort_order: 8 },
];
export const ACT: Record<string, Activity> = Object.fromEntries(ACTIVITIES.map(a => [a.code, a]));
export const actName = (code: string | null | undefined) => (code && ACT[code]?.name) || 'Unknown';

/** Map free-text activity descriptions onto the standard activity codes. */
export function normalizeActivity(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim().toLowerCase();
  if (ACT[s.toUpperCase()]) return s.toUpperCase();
  if (/slid/.test(s)) return 'SLD';
  if (/conn/.test(s)) return 'CON';
  if (/ream|wash/.test(s)) return 'REA';
  if (/trip|pooh|rih|pull out|run in|tih|toh/.test(s)) return 'TRP';
  if (/circ|condition/.test(s)) return 'CIR';
  if (/wait|woo|wow|woc|npt|repair|stuck|down ?time/.test(s)) return 'WOO';
  if (/rotar|rotat|drill/.test(s)) return 'ROT';
  return 'OTH';
}

export const WELL_TYPES = ['Vertical', 'Directional (J-type)', 'Directional (S-type)', 'Horizontal', 'Deviated', 'Other'];
export const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
export const STATUS_LABEL: Record<ProblemStatus, string> = {
  anomaly: 'Detected anomaly', suspected: 'Suspected problem', confirmed: 'Engineer-confirmed', dismissed: 'Dismissed',
};
