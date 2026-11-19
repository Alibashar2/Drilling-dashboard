# Architecture

## 1. System architecture

```
 React + TypeScript + Tailwind + ECharts (src/pages, src/components)
        │
        ├── Engines – pure TypeScript, unit-tested (src/lib)
        │     kpi.ts        records → breakdowns, daily reports, sections, formation intervals, run performance
        │     matching.ts   historical problem matching + similarity score
        │     anomaly.ts    rule-based anomaly candidates (never confirmed problems)
        │     estimate.ts   offset-based time estimation (TimeEstimator interface)
        │     survey.ts     minimum-curvature trajectory
        │     units.ts      unit detection and conversion
        │     reports.ts    report documents → screen / PDF / Excel
        │
        ├── Import (src/import)
        │     connectors.ts  DataSourceConnector: file, Power BI export, Power BI API (not configured)
        │     parse.ts       mapping → validation → canonical records
        │
        └── Repository (src/db/repo.ts) – every read/write, role guard, activity log
              │
              └── DbAdapter (src/db/adapter.ts)
                    ├── PGlite  – PostgreSQL in WebAssembly, IndexedDB persistence (default)
                    └── Supabase – hosted PostgreSQL + Auth + Storage + RLS
```

### Technology choices and deviations from the requested stack

| Requested | Used | Why |
|---|---|---|
| React, TypeScript, Tailwind, Lucide | as requested | |
| Recharts or ECharts | ECharts | Multi-grid vertical time traces, linked axis pointers and depth-synchronised panels |
| shadcn/ui | hand-written shadcn-style primitives (`components/ui.tsx`) | The shadcn CLI needs interactive setup; same visual language |
| Supabase / PostgreSQL / Auth / Storage | Supabase adapter **plus** embedded PGlite | No credentials were available; PGlite keeps all database operations real and lets the app run with zero setup |
| Python + Pandas | TypeScript + SheetJS in the browser | No second server to deploy; the engines are pure functions with tests. A Python service can be added behind `DataSourceConnector` or `TimeEstimator` |

## 2. Database schema

Defined in `supabase/migrations/0001_schema.sql` (portable) and `0002_supabase_auth_rls.sql` (Supabase only).

| Table | Purpose | Key relationships |
|---|---|---|
| `users` | profile + role (`admin` / `engineer` / `viewer`) | mirrors `auth.users` in Supabase |
| `wells` | well header; `well_code` unique | |
| `import_batches` | audit of each import: source, file, mapping, validation result | → wells |
| `well_sections` | hole sections (size, BHA, top/bottom MD), derived on import | → wells |
| `formations` | formation names; `canonical_id` = manual equivalence mapping | self-reference |
| `formation_intervals` | per-well tops/bottoms (MD and TVD); `is_prognosis` for planned tops | → wells, formations |
| `drilling_activities` | lookup: ROT, SLD, CON, TRP, CIR, REA, WOO, OTH | |
| `drilling_records` | time-based records; separate `md_ft`, `tvd_ft`, `bit_depth_ft`, `hole_depth_ft` | → wells, import_batches, activities |
| `survey_stations` | MD / inclination / azimuth + computed TVD, N, E | → wells |
| `problem_categories` | lookup of 15 problem categories | |
| `drilling_problems` | the problem register: well, time, MD interval, TVD, formation, hole size, BHA, activity, category, description, observed parameters, root cause, NPT, severity, `status`, `source`, lessons | → wells, formations, categories |
| `corrective_actions` | actions per problem | → drilling_problems |
| `problem_attachments` | files (Storage path in Supabase, inline in local mode) | → drilling_problems |
| `historical_alerts` | one row per (current well, historical problem): level, similarity, reasons, status, outcome, comments | → wells, drilling_problems |
| `simulation_sessions` | per-user playback position | → users, wells |
| `daily_reports` | per-well per-day aggregates, rebuilt after each import | → wells |
| `offset_comparisons` | saved well selections | |
| `app_settings` | alert configuration, last saved estimate | |
| `activity_log` | recent activity feed | |

Integrity rules: all child tables cascade from `wells`; a problem always carries its `well_id` and MD interval;
a new well can never overwrite an existing one because `well_code` is unique and imports only insert.
Problem `status` separates `anomaly` (rule-detected) → `suspected` → `confirmed` (engineer), plus `dismissed`.

## 3. Main user workflows

1. **Add a well** – well header → upload `.xlsx/.xls/.csv` → each sheet is assigned a role (drilling data,
   directional survey, ignore) → columns auto-mapped by name, units auto-detected from headers, both editable →
   validation (missing values, duplicates, bad dates, bad numbers, unit inconsistencies, depth gaps) with inline
   correction of invalid cells → save. On save: records inserted, survey computed by minimum curvature, daily
   reports / formation intervals / hole sections derived, problems mentioned in the file stored as *suspected*.
   If any step fails the well is rolled back.
2. **Simulate** – choose well, date, depth or drag the timeline; play / pause / step by day / change speed.
   Every panel is recalculated from the records up to the playhead: schematic, rig state, traces, KPI tiles,
   run performance (current BHA run), offset progress and the alert panel.
3. **Problems** – record manually (with auto-fill of time, formation, BHA and parameters from the drilling
   data at that depth), or run the anomaly scan and save candidates as *detected anomalies*; an engineer
   confirms, marks as suspected or dismisses. Corrective actions, lessons and attachments hang off the problem.
4. **Alerts** – open an alert to see the historical problem report, why it matched, and current vs historical
   conditions; acknowledge, mark reviewed, comment, and record whether the risk occurred.
5. **Compare / Estimate / Report** – all computed from stored records; exported as PDF or Excel.

## 4. Historical problem-matching algorithm (`src/lib/matching.ts`)

**Inputs.** The current context at the playhead (hole MD, TVD, formation, formations expected ahead, hole size,
well type, activity, BHA run, mud weight, recent on-bottom parameter averages) and every eligible historical
problem from *other* wells. Eligible = confirmed, plus suspected (configurable), plus anomalies (off by default).

**A. Depth-based matching.** `ahead = problem_top − current_depth` (MD by default; TVD only when both sides
have TVD and the TVD basis is selected).

| Condition | Level |
|---|---|
| inside the problem interval, or `ahead ≤ critical` (50 ft) and not yet passed | critical |
| `ahead ≤ medium` (200 ft) | medium |
| `ahead ≤ early` (500 ft) | early |
| more than `critical` past the interval bottom | no depth match |

**B. Formation-based matching** (independent of A). Names are resolved through the manual equivalence mapping,
then: current formation = problem formation → *current* match; or the problem's formation is expected within the
early-warning distance (prognosed tops, or known intervals when replaying) → *upcoming* match.

A historical problem becomes a risk indicator if A **or** B matches.

**Similarity score (0–100 %).** Weighted average of component scores, each 0–1:

| Component | Default weight | Score |
|---|---|---|
| Formation | 30 | 1 if formation match, else 0 |
| Depth proximity | 25 | `1 − distance / (2 × early distance)`, 1 inside the interval |
| Hole size | 15 | 1 if equal, falling linearly to 0 at 4 in difference |
| Well type | 5 | equal / not equal |
| Drilling activity | 5 | equal / not equal |
| BHA | 5 | same BHA run number (a proxy – BHA component lists are not modelled) |
| Mud weight | 5 | `1 − Δ / 2 ppg` |
| Parameter pattern | 10 | mean closeness of WOB, RPM, torque, SPP, flow, diff. pressure (within 50 % = similar) |

Components with no data on either side are excluded and the remaining weights renormalised; the report shows
each component's weight, score and detail, plus plain-language reasons.

**Colour.** Red = critical depth proximity. Orange = two or more matched problems of the same category.
Yellow = a single nearby problem. Green = nothing matched. With fewer historical wells than the configured
minimum the panel states that the assessment is limited. Wording is always "historical risk indicator".

All distances, weights, eligibility switches, the similarity cut-off and the depth basis are in
Settings → Alert thresholds & similarity.

## 5. Other calculation rules

- **Effective hole depth** = running maximum of hole depth (fallback MD, then bit depth). New footage per record
  = increase in effective hole depth.
- **Record duration** = time to the next record, capped at 4× the median interval so data gaps are not counted.
- **Time split** is exclusive: NPT first, then the remainder to the record's activity (or to explicit
  drilling/circulating/connection hour columns when the file is daily-style).
- **On-bottom ROP** = footage ÷ on-bottom drilling hours.
- **Estimation** (`estimate.ts`): for each planned section, offset sections within ±1.5 in are comparable. Each
  offset's own rates are applied to the planned interval (drilling by ROP, connections and circulation per foot,
  tripping per section-bottom depth, flat time per section, NPT as a fraction of productive time). Most likely =
  weighted mean; optimistic / pessimistic = best / worst offset (P10 / P90 with ≥ 5); confidence from the number
  of offsets and the spread. Sections with no comparable offset are reported as such and excluded from totals.
- **Anomaly rules** (`anomaly.ts`): sustained low ROP, high torque, SPP rise or drop at steady flow, each against
  the trailing median of the same hole section and required to persist for several consecutive records.

## 6. Extension points

- New data source → implement `DataSourceConnector` and return a `RawWorkbook`.
- ML time estimate → add a `TimeEstimator` to `ESTIMATORS`.
- New anomaly rule → add to `RULES` in `anomaly.ts`.
- New report → add a builder returning a `ReportDoc`; screen, PDF and Excel rendering come for free.
