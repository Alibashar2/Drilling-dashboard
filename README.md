# Digital Dashboard for Drilling Operations Performance Insights & Wells Time Estimation

A drilling intelligence web application: import well data from Excel/CSV, replay drilling day by day, keep a
central register of drilling problems, get historical-risk alerts before previously problematic depths and
formations, compare wells, estimate drilling time from offsets, and export reports to PDF and Excel.
English and Arabic (RTL) interface.

## Run it

Requires Node.js 20.19+ (developed on Node 26).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests (matching, KPIs, estimation, import, survey, units, report reader)
npm run test:accuracy   # real-report test on XX-1 / XX-2 (skipped if ../project/data is not present; REPORT_DIR to point elsewhere)
npm run build      # type-check + production bundle in dist/
```

On first start there are no accounts: the first account you create becomes the **Administrator**.
Then either add a well (Add New Well) or load the clearly-labelled **sample dataset** (Home or
Settings → Data management). Sample wells are synthetic, flagged `is_demo`, and removable.

## Database modes

| Mode | When | What you get |
|---|---|---|
| **Local (default)** | no Supabase variables set | Real PostgreSQL (PGlite, WebAssembly) persisted in the browser's IndexedDB. Single machine / single browser. Local accounts with PBKDF2-hashed passwords. |
| **Supabase** | `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set | Shared hosted PostgreSQL, Supabase Auth, Supabase Storage for attachments, row-level security by role. |

Both modes run the same schema (`supabase/migrations/0001_schema.sql`) through the same repository code.
No database call is simulated: an operation either succeeds against the database or raises the error.

### Connecting Supabase (credentials needed)

1. Create a Supabase project.
2. In the SQL editor run `supabase/migrations/0001_schema.sql`, then `0002_supabase_auth_rls.sql`
   (profile trigger, role-based RLS policies, `attachments` storage bucket).
3. Copy `.env.example` to `.env.local` and set:
   - `VITE_SUPABASE_URL` – Project Settings → API → Project URL
   - `VITE_SUPABASE_ANON_KEY` – Project Settings → API → anon public key
4. Restart `npm run dev`. The first user to sign up becomes Administrator; later users start as Viewer.

> Supabase mode was written against the Supabase JS v2 API but has **not been run against a live project**
> (no credentials were available during development). Local mode is the verified path. Test sign-up, an
> import and an attachment upload on your project before relying on it.

### Power BI

- **Supported now:** Excel/CSV exported from Power BI ("Export data" on a visual or table).
- **Not supported:** `.pbix` files. They are report packages, not spreadsheets, and are rejected with an explanation.
- **Prepared, not configured:** a Power BI dataset API connector (`src/import/connectors.ts`). It needs an
  Azure AD app registration (tenant ID, client ID, client secret, `Dataset.Read.All`), workspace ID, dataset ID
  and a small backend proxy for the `executeQueries` endpoint. The secret must not live in browser code.

## Intelligent report reader

Uploading a file on **Add New Well** runs the automatic reader: it inspects every worksheet, finds the tables
and metadata wherever they are, understands drilling terminology and operations text, and shows an extraction
report with status, confidence and cell reference for everything it found. You act only on the
"Needs your input" tab. See [docs/REPORT_READER.md](docs/REPORT_READER.md).

Parameters written together with their value inside a cell ("WOB: 2-4 Ton, FR:1000 lpm") are read wherever they
are, checked on the **Values in cells** tab (correct / confirm / reject), and stored with their worksheet and cell in
`extracted_parameters` (well page → **Source values**). Results on the real report XX-1: `reports/XX-1_ACCURACY.md`.

The reader also names every operation (drilling, tripping, casing, cementing, logging, well control, maintenance, NPT),
and extracts BHA runs and tools, casing strings, cement jobs and hole sections, which the simulation shows at the
playhead next to two separate alert panels: problems actually recorded in the current well (red) and warnings from
offset wells (amber). See [docs/OPERATIONS_AND_EQUIPMENT.md](docs/OPERATIONS_AND_EQUIPMENT.md).

**Well Comparison** has one interactive chart per drilling parameter (actual records on a depth or time axis) with three
selection modes (all parameters / independent / custom), optional navigation sync, per-chart layout controls, and a point
analysis panel: every compared well at the selected depth or time, before-and-after changes, recorded events, other wells'
problems, and an interpretation in which each statement is marked confirmed, data-supported or possible.
See [docs/WELL_COMPARISON.md](docs/WELL_COMPARISON.md).

The same engine runs outside the browser:

```bash
npm run read-report -- "path/to/report.xlsx" --unit m --out reports
```

Optional AI help for labels the dictionary does not know:

```bash
node server/llm-proxy.mjs
```

Run it with `ANTHROPIC_API_KEY` set, then put `VITE_LLM_PROXY_URL=http://localhost:8787` in `.env.local`.
Without it the reader is fully rule-based.

## Roles

| Role | Can do |
|---|---|
| Administrator | Everything, plus user roles, deleting wells, removing sample data |
| Engineer | Add wells, import data, record/confirm problems, handle alerts, change alert settings, run simulations |
| Viewer | View dashboards, wells, simulation and reports (alerts are shown but not stored) |

## Deployment

The app is a static bundle: `npm run build` → deploy `dist/` to any static host (Vercel, Netlify, Azure Static
Web Apps, S3 + CloudFront, nginx). Routing uses the URL hash, so no server rewrite rules are needed.
Set the two `VITE_SUPABASE_*` variables in the host's build environment for a shared multi-user deployment;
without them every browser keeps its own private local database.

## Things to know

- **Units:** everything is stored in ft, ft/h, klb, ft-lb, psi, gpm, ppg. Import converts from m, m/h, kN, tonne,
  N·m, kN·m, kPa, bar, MPa, L/min, sg, kg/m³ and others; display switches between ft and m.
- **Depths:** MD, TVD, bit depth and hole depth are separate columns. Hole depth falls back to MD (then bit
  depth) only when a file has no hole-depth column, and the simulation says so.
- **Time:** drilling reports are written in rig local time, **Asia/Baghdad**. On import each report clock time is converted once to a real UTC instant (`src/import/reportTime.ts`), the database stores UTC, and every screen, chart, tooltip and export shows Baghdad local time (`src/lib/time.ts`, the single place that names the time zone; conversion uses the IANA zone rules, never a fixed +3 h). Report days are Baghdad calendar days: filtering by a date uses that day's UTC start and end. Databases written by earlier versions, which stored the report clock as if it were UTC, are converted once on first start (`supabase/migrations/0003_report_times_utc.sql`).
- **NPT:** taken from the report's own classification (NPT column, Productive / Non Productive column, NPT table);
  otherwise listed as "possible NPT" for the engineer to accept. Never summed twice.
- **Appending data** to an existing well after it is saved is not implemented; a Well ID can be used once.
- **PDF exports** are in English (jsPDF's built-in fonts have no Arabic glyphs). Excel exports keep any text.
- **Local accounts** protect against casual access only; the database is in the user's own browser.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the architecture, schema, workflows and the matching algorithm.
