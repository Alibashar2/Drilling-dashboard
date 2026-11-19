-- ============================================================================
-- Drilling Operations Dashboard - relational schema (PostgreSQL)
-- Portable: runs unchanged on Supabase and on the embedded PGlite database.
-- All depths are stored in FEET, MD / TVD / bit depth / hole depth are separate
-- columns and are never substituted for each other at the storage level.
-- ============================================================================

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  full_name   text not null default '',
  role        text not null default 'viewer' check (role in ('admin','engineer','viewer')),
  created_at  timestamptz not null default now()
);

create table if not exists wells (
  id                       uuid primary key default gen_random_uuid(),
  well_code                text not null unique,
  name                     text not null,
  field                    text,
  location                 text,
  well_type                text,
  status                   text not null default 'planned' check (status in ('planned','active','completed')),
  spud_date                date,
  planned_completion_date  date,
  completion_date          date,
  target_depth_ft          double precision,
  hole_size_in             double precision,
  source_depth_unit        text not null default 'ft' check (source_depth_unit in ('ft','m')),
  is_demo                  boolean not null default false,
  notes                    text,
  created_by               uuid references users(id) on delete set null,
  created_at               timestamptz not null default now()
);

create table if not exists import_batches (
  id           uuid primary key default gen_random_uuid(),
  well_id      uuid not null references wells(id) on delete cascade,
  source_type  text not null check (source_type in ('excel','csv','powerbi_export','powerbi_api','demo','manual')),
  file_name    text,
  row_count    integer not null default 0,
  mapping      jsonb,
  validation   jsonb,
  created_by   uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists well_sections (
  id             uuid primary key default gen_random_uuid(),
  well_id        uuid not null references wells(id) on delete cascade,
  name           text not null,
  hole_size_in   double precision,
  bha_number     integer,
  top_md_ft      double precision not null,
  bottom_md_ft   double precision not null
);
create index if not exists well_sections_well_idx on well_sections(well_id);

create table if not exists formations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  -- manual equivalence mapping: points to the formation this name is equivalent to
  canonical_id  uuid references formations(id) on delete set null,
  description   text
);

create table if not exists formation_intervals (
  id              uuid primary key default gen_random_uuid(),
  well_id         uuid not null references wells(id) on delete cascade,
  formation_id    uuid not null references formations(id) on delete restrict,
  formation_name  text not null,
  top_md_ft       double precision not null,
  bottom_md_ft    double precision not null,
  top_tvd_ft      double precision,
  bottom_tvd_ft   double precision,
  -- true = prognosed (planned) top entered ahead of the bit, false = derived from drilled data
  is_prognosis    boolean not null default false
);
create index if not exists formation_intervals_well_idx on formation_intervals(well_id);

create table if not exists drilling_activities (
  code           text primary key,
  name           text not null,
  color          text not null,
  is_productive  boolean not null default true,
  sort_order     integer not null default 0
);

create table if not exists drilling_records (
  id                   uuid primary key default gen_random_uuid(),
  well_id              uuid not null references wells(id) on delete cascade,
  import_batch_id      uuid references import_batches(id) on delete set null,
  ts                   timestamptz not null,
  md_ft                double precision,
  tvd_ft               double precision,
  bit_depth_ft         double precision,
  hole_depth_ft        double precision,
  rop_fph              double precision,
  wob_klb              double precision,
  rpm                  double precision,
  torque_ftlb          double precision,
  spp_psi              double precision,
  diff_pressure_psi    double precision,
  flow_gpm             double precision,
  mud_weight_ppg       double precision,
  hook_load_klb        double precision,
  drilling_hours       double precision,
  circulating_hours    double precision,
  connection_time_min  double precision,
  npt_hours            double precision,
  activity_code        text references drilling_activities(code),
  activity_raw         text,
  formation_name       text,
  bha_number           integer,
  hole_size_in         double precision,
  problem_text         text
);
create index if not exists drilling_records_well_ts_idx on drilling_records(well_id, ts);

create table if not exists survey_stations (
  id               uuid primary key default gen_random_uuid(),
  well_id          uuid not null references wells(id) on delete cascade,
  md_ft            double precision not null,
  inclination_deg  double precision not null,
  azimuth_deg      double precision not null default 0,
  tvd_ft           double precision,
  north_ft         double precision,
  east_ft          double precision
);
create index if not exists survey_stations_well_idx on survey_stations(well_id, md_ft);

create table if not exists problem_categories (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  default_severity  text not null default 'medium'
);

create table if not exists drilling_problems (
  id               uuid primary key default gen_random_uuid(),
  problem_code     text not null unique,
  well_id          uuid not null references wells(id) on delete cascade,
  occurred_at      timestamptz,
  md_top_ft        double precision not null,
  md_bottom_ft     double precision,
  tvd_ft           double precision,
  formation_id     uuid references formations(id) on delete set null,
  formation_name   text,
  hole_size_in     double precision,
  bha_number       integer,
  activity_code    text references drilling_activities(code),
  category_id      uuid not null references problem_categories(id),
  description      text not null default '',
  observed_params  jsonb,
  root_cause       text,
  npt_hours        double precision not null default 0,
  severity         text not null default 'medium' check (severity in ('low','medium','high','critical')),
  -- anomaly = rule-detected only, suspected = needs engineer review, confirmed = engineer-confirmed
  status           text not null default 'suspected' check (status in ('anomaly','suspected','confirmed','dismissed')),
  source           text not null default 'manual' check (source in ('manual','auto','import','demo')),
  notes            text,
  lessons_learned  text,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists drilling_problems_well_idx on drilling_problems(well_id);

create table if not exists corrective_actions (
  id           uuid primary key default gen_random_uuid(),
  problem_id   uuid not null references drilling_problems(id) on delete cascade,
  action_text  text not null,
  outcome      text,
  created_at   timestamptz not null default now()
);

create table if not exists problem_attachments (
  id            uuid primary key default gen_random_uuid(),
  problem_id    uuid not null references drilling_problems(id) on delete cascade,
  file_name     text not null,
  mime_type     text,
  size_bytes    integer,
  storage_path  text,   -- Supabase Storage object path (Supabase mode)
  data_base64   text,   -- inline content (local mode only)
  created_at    timestamptz not null default now()
);

create table if not exists historical_alerts (
  id             uuid primary key default gen_random_uuid(),
  well_id        uuid not null references wells(id) on delete cascade,             -- well being drilled
  problem_id     uuid not null references drilling_problems(id) on delete cascade, -- historical event
  level          text not null check (level in ('yellow','orange','red')),
  match_types    jsonb not null default '[]'::jsonb,
  similarity     double precision not null default 0,
  reasons        jsonb not null default '[]'::jsonb,
  trigger_md_ft  double precision,
  status         text not null default 'new' check (status in ('new','acknowledged','reviewed')),
  outcome        text not null default 'unknown' check (outcome in ('unknown','occurred','not_occurred')),
  comments       jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (well_id, problem_id)
);

create table if not exists simulation_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references users(id) on delete cascade,
  well_id      uuid references wells(id) on delete cascade,
  playhead_ts  timestamptz,
  speed        integer not null default 1,
  updated_at   timestamptz not null default now()
);

create table if not exists daily_reports (
  id                 uuid primary key default gen_random_uuid(),
  well_id            uuid not null references wells(id) on delete cascade,
  report_date        date not null,
  day_number         integer not null,
  start_md_ft        double precision,
  end_md_ft          double precision,
  footage_ft         double precision not null default 0,
  total_hours        double precision not null default 0,
  drilling_hours     double precision not null default 0,
  connection_hours   double precision not null default 0,
  circulating_hours  double precision not null default 0,
  tripping_hours     double precision not null default 0,
  other_hours        double precision not null default 0,
  npt_hours          double precision not null default 0,
  avg_rop_fph        double precision,
  avg_wob_klb        double precision,
  avg_rpm            double precision,
  avg_torque_ftlb    double precision,
  avg_spp_psi        double precision,
  avg_flow_gpm       double precision,
  avg_diff_psi       double precision,
  mud_weight_ppg     double precision,
  activity_hours     jsonb,
  formations         text,
  summary            text,
  unique (well_id, report_date)
);

create table if not exists offset_comparisons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  well_ids    jsonb not null default '[]'::jsonb,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  user_email  text,
  action      text not null,
  detail      text
);

-- ---------------------------------------------------------------- v2: intelligent report reader
-- Traceability: every extracted record keeps the worksheet / cell it came from, and whether the value
-- was reported in the source or interpolated from a coarser report.
alter table drilling_records add column if not exists source_ref text;
alter table drilling_records add column if not exists data_quality text;
alter table drilling_records add column if not exists extra jsonb;
alter table drilling_problems add column if not exists source_ref text;
alter table drilling_problems add column if not exists source_text text;
alter table drilling_problems add column if not exists extraction jsonb;

-- Drilling terminology learned from user corrections (label -> concept), reused on later imports.
create table if not exists term_dictionary (
  term        text primary key,
  concept     text not null,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Every parameter value read inside a report cell ("WOB: 2-4 Ton"), with the worksheet and cell it came from,
-- the text as written, the value in the original and the database unit, how it was read and how sure the reader is.
-- Engineer corrections are kept here too (review = confirmed / corrected / rejected, with the original value).
create table if not exists extracted_parameters (
  id               uuid primary key default gen_random_uuid(),
  well_id          uuid not null references wells(id) on delete cascade,
  import_batch_id  uuid references import_batches(id) on delete cascade,
  hit_id           text not null,                 -- Sheet!Cell#n, stable for the same file
  param_key        text not null,
  param_label      text not null,
  param_group      text,
  qualifier        text,                          -- daily / total / in-out / on-bottom / scr ...
  context          text,                          -- drilling / reaming / circulating / tripping / cementing ...
  value_num        double precision,
  value_min        double precision,
  value_max        double precision,
  value_text       text,
  unit_raw         text,                          -- unit exactly as written ("Ton", "kft.lb")
  unit             text,                          -- recognised unit
  unit_basis       text,                          -- written / report / range / default / none
  value_canonical  double precision,              -- in the database unit (klb, ft-lb, psi, gpm, ppg, ft, ft/h, h, bbl, bbl/h)
  unit_canonical   text,
  sheet            text not null,
  cell             text not null,
  source_ref       text not null,                 -- Sheet!Cell
  original_text    text not null,                 -- the matched text
  line_text        text,                          -- the whole line of the cell
  occurred_at      timestamptz,
  md_ft            double precision,
  confidence       real not null,
  method           text not null,
  status           text not null check (status in ('confirmed','inferred','suspected','rejected')),
  review           text check (review in ('confirmed','corrected','rejected')),
  original_value   text,                          -- value before an engineer correction
  notes            text,
  used             boolean not null default true, -- false for identifiers (serial numbers) and rejected values
  created_at       timestamptz not null default now()
);
create index if not exists extracted_parameters_well_idx on extracted_parameters(well_id, param_key);

-- ---------------------------------------------------------------- lookup data
insert into drilling_activities (code, name, color, is_productive, sort_order) values
  ('ROT','Drilling Rotary','#16a34a', true, 1),
  ('SLD','Drilling Slide','#d97706', true, 2),
  ('CON','Connection','#c026d3', true, 3),
  ('TRP','Tripping','#3b82f6', true, 4),
  ('CIR','Circulating','#ca8a04', true, 5),
  ('REA','Reaming','#8b5cf6', true, 6),
  ('WOO','Waiting on Operations','#e11d48', false, 7),
  ('OTH','Other','#64748b', true, 8)
on conflict (code) do nothing;

insert into problem_categories (code, name, default_severity) values
  ('DIFF_STICK','Differential Sticking','high'),
  ('MECH_STICK','Mechanical Sticking','high'),
  ('LOST_CIRC','Lost Circulation','high'),
  ('MUD_LOSS','Mud Losses','medium'),
  ('INSTABILITY','Wellbore Instability','high'),
  ('TIGHT_HOLE','Tight Hole','medium'),
  ('PACK_OFF','Pack-Off','high'),
  ('HOLE_CLEAN','Hole Cleaning Problems','medium'),
  ('PIPE_FAIL','Pipe Failure','critical'),
  ('BHA_FAIL','BHA Failure','high'),
  ('TORQUE_DRAG','Excessive Torque and Drag','medium'),
  ('FORM_DAMAGE','Formation Damage','medium'),
  ('PRESSURE','Unexpected Pressure','critical'),
  ('LOW_ROP','Slow Drilling / Low ROP','low'),
  ('VIBRATION','Drilling Vibrations / Shocks','medium'),
  ('BIT_BALLING','Bit / BHA Balling','medium'),
  ('OTHER','Other Problems','medium')
on conflict (code) do nothing;


-- ================================================================ v3: operations, equipment, hole sections, alert reviews
-- One row per operation of the daily report, named from the report (task code / text) or by an engineer.
create table if not exists operation_categories (
  code        text primary key,
  name        text not null,
  sort_order  integer not null default 0
);
create table if not exists operation_types (
  code           text primary key,
  name           text not null,
  category       text not null references operation_categories(code),
  activity_code  text references drilling_activities(code)    -- rig state used by the KPIs
);

-- One row per BHA run (make-up to lay-down); bit data as written in the report.
create table if not exists bha_runs (
  id               uuid primary key default gen_random_uuid(),
  well_id          uuid not null references wells(id) on delete cascade,
  import_batch_id  uuid references import_batches(id) on delete cascade,
  run_no           integer not null,
  bha_type         text,
  hole_size_in     double precision,
  bit_size_in      double precision,
  bit_type         text,
  bit_model        text,
  bit_serial       text,
  bit_condition    text,
  nozzles          text,
  dull_grade       text,
  start_at         timestamptz,
  end_at           timestamptz,
  depth_in_ft      double precision,
  depth_out_ft     double precision,
  description      text,
  source_ref       text,
  unique (well_id, run_no)
);

-- Casing and liner strings: OD, weights by interval, grades, connections, shoe (with how it is known).
create table if not exists casing_strings (
  id                   uuid primary key default gen_random_uuid(),
  well_id              uuid not null references wells(id) on delete cascade,
  import_batch_id      uuid references import_batches(id) on delete cascade,
  kind                 text not null check (kind in ('casing','liner')),
  od_in                double precision not null,
  weights              jsonb not null default '[]'::jsonb,
  grades               jsonb not null default '[]'::jsonb,
  connections          jsonb not null default '[]'::jsonb,
  top_md_ft            double precision,
  shoe_md_ft           double precision,
  shoe_basis           text,
  float_collar_md_ft   double precision,
  landing_collar_md_ft double precision,
  hole_size_in         double precision,
  run_start            timestamptz,
  run_end              timestamptz,
  description          text,
  source_ref           text,
  unique (well_id, od_in)
);

create table if not exists operations (
  id                  uuid primary key default gen_random_uuid(),
  well_id             uuid not null references wells(id) on delete cascade,
  import_batch_id     uuid references import_batches(id) on delete cascade,
  seq                 integer not null,
  type_code           text not null references operation_types(code),
  category            text not null references operation_categories(code),
  start_at            timestamptz not null,
  end_at              timestamptz not null,
  duration_h          double precision not null,
  start_md_ft         double precision,
  end_md_ft           double precision,
  hole_size_in        double precision,
  bha_run_id          uuid references bha_runs(id) on delete set null,
  casing_string_id    uuid references casing_strings(id) on delete set null,
  description         text,
  text                text,
  task_raw            text,
  phase_raw           text,
  steps               jsonb not null default '[]'::jsonb,   -- cementing steps stated in the text (no separate times)
  status              text not null default 'completed' check (status in ('completed','in_progress','planned')),
  is_npt              boolean not null default false,
  npt_category        text,
  basis               text not null,                        -- task code / operation text / insufficient information / engineer
  confidence          real not null default 0,
  source_ref          text,
  original_type_code  text,                                 -- before an engineer correction
  corrected_by        text,
  corrected_at        timestamptz,
  unique (well_id, start_at, source_ref)
);
create index if not exists operations_well_idx on operations(well_id, start_at);

-- Every tool / equipment item, linked to its BHA run or casing string. Dimensions not written in the report stay null.
create table if not exists drilling_tools (
  id                uuid primary key default gen_random_uuid(),
  well_id           uuid not null references wells(id) on delete cascade,
  import_batch_id   uuid references import_batches(id) on delete cascade,
  bha_run_id        uuid references bha_runs(id) on delete cascade,
  casing_string_id  uuid references casing_strings(id) on delete cascade,
  category          text not null check (category in ('Drill String','BHA','Casing Equipment','Cementing Equipment','Well Control')),
  tool_type         text not null,
  name              text not null,
  description       text,
  od_in             double precision,
  id_in             double precision,
  length_ft         double precision,
  quantity          double precision,
  quantity_unit     text,
  serial_no         text,
  manufacturer      text,
  specs             jsonb not null default '{}'::jsonb,       -- tool specifications: model, nozzles, bend, weight, grade, rating ...
  run_no            integer,
  hole_size_in      double precision,
  installed_at      timestamptz,
  retrieved_at      timestamptz,
  source_ref        text,
  source_text       text,
  entered_by        text not null default 'import' check (entered_by in ('import','manual','corrected')),
  updated_at        timestamptz not null default now()
);
create index if not exists drilling_tools_well_idx on drilling_tools(well_id);

create table if not exists cementing_events (
  id                uuid primary key default gen_random_uuid(),
  well_id           uuid not null references wells(id) on delete cascade,
  import_batch_id   uuid references import_batches(id) on delete cascade,
  casing_string_id  uuid references casing_strings(id) on delete set null,
  casing_od_in      double precision,
  kind              text,
  stages            integer not null default 1,
  start_at          timestamptz,
  end_at            timestamptz,
  steps             jsonb not null default '[]'::jsonb,
  fluids            jsonb not null default '[]'::jsonb,
  displacement_bbl  double precision,
  fcp_psi           double precision,
  bump_psi          double precision,
  plugs             jsonb not null default '[]'::jsonb,
  losses_text       text,
  woc_hours         double precision,
  toc_md_ft         double precision,
  description       text,
  source_ref        text
);

-- Structured hole sections: hole, bit and casing diameters are separate columns.
create table if not exists hole_sections (
  id                uuid primary key default gen_random_uuid(),
  well_id           uuid not null references wells(id) on delete cascade,
  import_batch_id   uuid references import_batches(id) on delete cascade,
  section_no        integer not null,
  hole_size_in      double precision,
  bit_sizes_in      jsonb not null default '[]'::jsonb,
  bit_types         jsonb not null default '[]'::jsonb,
  casing_od_in      double precision,
  casing_kind       text,
  shoe_md_ft        double precision,
  top_md_ft         double precision,
  bottom_md_ft      double precision,
  formations        jsonb not null default '[]'::jsonb,
  bha_runs          jsonb not null default '[]'::jsonb,
  tools_count       integer not null default 0,
  drill_start       timestamptz,
  drill_end         timestamptz,
  start_at          timestamptz,
  end_at            timestamptz,
  duration_h        double precision,
  avg_rop_fph       double precision,
  npt_hours         double precision,
  source_ref        text,
  unique (well_id, section_no)
);

-- Review state of CURRENT-WELL problem alerts in the simulation (historical warnings use historical_alerts).
create table if not exists simulation_events (
  id          uuid primary key default gen_random_uuid(),
  well_id     uuid not null references wells(id) on delete cascade,
  problem_id  uuid not null references drilling_problems(id) on delete cascade,
  event_type  text not null default 'current_problem' check (event_type in ('current_problem')),
  status      text not null default 'new' check (status in ('new','acknowledged','reviewed')),
  comments    jsonb not null default '[]'::jsonb,
  first_shown_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (well_id, problem_id, event_type)
);

-- The same file is imported only once (SHA-256 of the file content).
alter table import_batches add column if not exists file_hash text;
create unique index if not exists import_batches_file_hash_idx on import_batches(file_hash) where file_hash is not null;
insert into operation_categories (code, name, sort_order) values
  ('Drilling','Drilling',1),
  ('Tripping','Tripping',2),
  ('Casing','Casing',3),
  ('Cementing','Cementing',4),
  ('Logging','Logging',5),
  ('Well Control','Well Control',6),
  ('Maintenance','Maintenance',7),
  ('NPT','NPT',8),
  ('Other Operations','Other Operations',9)
on conflict (code) do update set sort_order = excluded.sort_order;

insert into operation_types (code, name, category, activity_code) values
  ('DRL_ROT','Drilling Rotary','Drilling','ROT'),
  ('DRL_SLD','Drilling Slide','Drilling','SLD'),
  ('DRL_AHEAD','Drilling Ahead','Drilling','ROT'),
  ('REAM','Reaming','Drilling','REA'),
  ('BACKREAM','Back Reaming','Drilling','REA'),
  ('CIRC','Circulating','Drilling','CIR'),
  ('HOLE_CLEAN','Hole Cleaning','Drilling','CIR'),
  ('CONN','Connection','Drilling','CON'),
  ('CONDITION','Wellbore Conditioning','Drilling','CIR'),
  ('LC_TREAT','Lost Circulation Treatment','Drilling','CIR'),
  ('MUD_COND','Mud Conditioning','Drilling','CIR'),
  ('MW_ADJUST','Mud Weight Adjustment','Drilling','CIR'),
  ('WIPER','Wiper Trip','Tripping','TRP'),
  ('SHORT_TRIP','Short Trip','Tripping','TRP'),
  ('TRIP_IN','Tripping In','Tripping','TRP'),
  ('TRIP_OUT','Tripping Out','Tripping','TRP'),
  ('MU_BHA','Making Up BHA','Tripping','TRP'),
  ('BO_BHA','Breaking Out BHA','Tripping','TRP'),
  ('PU_LD_DP','Picking Up / Laying Down Drill Pipe','Tripping','TRP'),
  ('SLUG','Pumping Slug','Tripping','CIR'),
  ('SURVEY','Surveying','Logging','OTH'),
  ('MWD','Measurement While Drilling (MWD)','Logging','OTH'),
  ('LWD','Logging While Drilling (LWD)','Logging','OTH'),
  ('WL_LOG','Wireline Logging','Logging','OTH'),
  ('CSG_RUN','Casing Running','Casing','OTH'),
  ('LNR_RUN','Liner Running','Casing','OTH'),
  ('CSG_CONN','Casing Connection','Casing','OTH'),
  ('CSG_CIRC','Casing Circulation','Casing','CIR'),
  ('CSG_FILL','Casing Filling','Casing','OTH'),
  ('CSG_LAND','Casing Landing','Casing','OTH'),
  ('CSG_SET','Casing Setting','Casing','OTH'),
  ('CSG_TEST','Casing Testing','Casing','OTH'),
  ('PT_CSG','Pressure Testing Casing','Casing','OTH'),
  ('SHOE_DRILL','Casing Shoe Drilling','Casing','OTH'),
  ('DO_CMT','Drill Out Cement','Casing','OTH'),
  ('DO_FLOAT','Drill Out Float Equipment','Casing','OTH'),
  ('CMT_PREP','Cementing Preparation','Cementing','OTH'),
  ('CMT_MIX','Cement Mixing','Cementing','OTH'),
  ('CMT_PUMP','Cement Pumping','Cementing','OTH'),
  ('SPACER','Spacer Pumping','Cementing','OTH'),
  ('CMT_LEAD','Lead Cement Pumping','Cementing','OTH'),
  ('CMT_TAIL','Tail Cement Pumping','Cementing','OTH'),
  ('DISPLACE','Displacement','Cementing','OTH'),
  ('BUMP','Bumping Plug','Cementing','OTH'),
  ('WOC','Waiting on Cement (WOC)','Cementing','OTH'),
  ('REV_CIRC','Reverse Circulation','Cementing','CIR'),
  ('CMT_EVAL','Cement Evaluation','Cementing','OTH'),
  ('CBL','Cement Bond Logging (CBL)','Cementing','OTH'),
  ('BOP_INST','BOP Installation','Well Control','OTH'),
  ('BOP_REMOVE','BOP Removal','Well Control','OTH'),
  ('BOP_TEST','BOP Testing','Well Control','OTH'),
  ('WELLHEAD','Wellhead Installation','Well Control','OTH'),
  ('PRESS_TEST','Pressure Testing','Well Control','OTH'),
  ('FLOW_CHECK','Flow Check','Well Control','OTH'),
  ('WC_DRILL','Well Control Drill','Well Control','OTH'),
  ('WELL_CONTROL','Well Control Operations','Well Control','WOO'),
  ('STUCK_TREAT','Stuck Pipe Treatment','Other Operations','WOO'),
  ('FISHING','Fishing Operations','Other Operations','WOO'),
  ('RIG_MAINT','Rig Maintenance','Maintenance','OTH'),
  ('RIG_REPAIR','Rig Repair','Maintenance','WOO'),
  ('SLIP_CUT','Slip and Cut Drilling Line','Maintenance','OTH'),
  ('WAIT_EQUIP','Waiting on Equipment','NPT','WOO'),
  ('WAIT_WEATHER','Waiting on Weather','NPT','WOO'),
  ('WAIT_INSTR','Waiting on Instructions','NPT','WOO'),
  ('WAIT','Waiting (reason not stated)','NPT','WOO'),
  ('NPT','NPT','NPT','WOO'),
  ('RIG_UPDOWN','Rig Up / Rig Down Equipment','Other Operations','OTH'),
  ('SAFETY','Safety Meeting','Other Operations','OTH'),
  ('WEAR_BUSHING','Wear Bushing Run / Retrieval','Other Operations','OTH'),
  ('COMPLETION','Completion Operations','Other Operations','OTH'),
  ('HOUSEKEEPING','Rig Floor Housekeeping','Other Operations','OTH'),
  ('OTHER','Other Operations','Other Operations','OTH'),
  ('UNSPECIFIED','Not specified in report','Other Operations','OTH')
on conflict (code) do update set name = excluded.name, category = excluded.category, activity_code = excluded.activity_code;
