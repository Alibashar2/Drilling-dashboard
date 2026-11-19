# Operations, problem alerts, drilling tools and hole sections

What the report reader extracts about the well-construction process, how it is stored, and how the simulation shows it.
Code: `src/lib/operations.ts`, `src/import/smart/equipment.ts`, `src/lib/simContext.ts`, `src/components/SimPanels.tsx`,
`src/components/EquipmentTab.tsx`.

## 1. Operations

Every entry of the operations log becomes one **operation** (`operations` table) with name, category, start, end,
duration, start / end depth, hole size, BHA run, casing string, description, full text, the report's own phase and task
codes, NPT flag and category, status, and the worksheet!cell.

- **Catalogue** (`OP_TYPES`, seeded into `operation_types` / `operation_categories`): the operations of the request
  (drilling, tripping, casing, cementing, logging, well control, maintenance, NPT, other) plus a few that real reports need
  (Liner Running, Wellhead Installation, Flow Check, Well Control Drill, Pumping Slug, Safety Meeting, Rig Up / Down,
  Slip and Cut, Wear Bushing, Completion, Waiting (reason not stated)). A test checks that the database seed equals the code.
- **How an operation is named** (`classifyOperation`), in this order:
  1. the report's task code ("Drill to depth", "Trip out to depth (OH)", "Run in casing to depth", "Waiting on cement") - basis
     *task code*, 92 %; the text refines it only where the code is generic (rotary / slide from "Rotary drilling" / "Slide
     drilling"; wiper / short trip; LCM pill vs sweep; weather / equipment / instructions for waiting);
  2. without a task code, the first line of the operation text - basis *operation text*, 72 %;
  3. otherwise **Not specified in report** - nothing is assumed. "Drilled ... hole" without rotary or slide is
     *Drilling Ahead*, never an assumed rotary or slide.
- **Cementing steps** (spacer, lead, tail, displacement, bump plug) stated inside one entry are listed as steps of that
  operation; the report gives them no separate times, so none are invented.
- **Manual correction**: "Correct operation" in the simulation and on the well page. The reader's original type is kept
  (`original_type_code`, `corrected_by`, `corrected_at`).
- XX-1: 375 operations, none unspecified; XX-2: 442, one unspecified ("Worked on troubleshooting RSS").

## 2. Two independent alert systems

| | Current well (RED) | Historical offset wells (AMBER) |
|---|---|---|
| Source | problems recorded in this well's own reports | problems of other wells, matched by depth / formation (existing engine, `matching.ts`) |
| Meaning | an actual recorded event | a warning, not a prediction |
| Label | CURRENT WELL – ACTUAL RECORDED PROBLEM | HISTORICAL OFFSET WELL – PREVIOUS PROBLEM WARNING |
| Shows | type, time, MD, TVD (or from survey), formation, description, drilling parameters at that time, NPT, corrective actions, report cell | current / historical well, problem, historical depth and formation, current depth, depth difference, description, previous corrective actions, similarity, reasons |
| Active | from the time recorded to the end of its report entry (or its NPT, at least 1 h); then listed as earlier | while the playhead is within the matching window |
| Review state | `simulation_events` (acknowledged / reviewed / comments) | `historical_alerts` (acknowledged / reviewed / comments / materialized) |

The historical engine's "red" level is shown as amber *critical proximity*; red is used only for actual problems of the
current well. When the current well records the same kind of problem near the historical interval, the historical card
says so ("a similar problem is recorded in this well") - the two never merge. Each alert is stored once, the first time
the replay reaches it; an acknowledged alert collapses to one line and is not raised again.

An NPT event of the report and the same event read from its text ("pipe got stuck ...") are one problem.

## 3. Drilling tools, BHA runs, casing, cementing, hole sections

- **BHA runs** (`bha_runs`): from make-up to the bit being laid down; also a BHA listed line by line under any entry that
  names it. Bit size, type, model, serial, condition (new / re-run / refurbished), nozzles, dull grade, depth in / out.
  Each record carries the run number (`drilling_records.bha_number`), so run performance works per run.
- **Tools** (`drilling_tools`): every listed component with category (drill string, BHA, casing equipment, cementing
  equipment, well control), type, OD, ID, length, quantity, serial, manufacturer and specifications (`specs`: model,
  nozzles, motor bend, stabilizer gauge, connections, weight, pressure rating, ram pipe sizes...). A size followed by
  "stab / sleeve" is the stabilizer gauge, not the tool body; a ram's pipe size is not the preventer bore; "12x12" after a
  bit is nozzles, not a count. **Anything not written stays null and is displayed "Not available"** (XX-1: 34 of 132 tools
  have no OD in the report; no tool has an ID or length there).
- The same tool listed with two serial numbers in one run is reported as an inconsistency of the report
  (XX-1: PBL sub HYD825BP95 / HYDB825BP95, bit SP1760 / SP1750); "SP0912" and "0912" are the same serial.
- **Casing strings** (`casing_strings`): OD, weights by interval, grades, connections, top (liner top), shoe and how the shoe
  is known (*shoe depth stated*, *setting depth stated*, or *deepest depth run to (inferred)*), float / landing collar depths.
- **Cement jobs** (`cementing_events`): stages, steps, fluids with densities, displacement, FCP / FDP, bump pressure, plugs,
  losses, WOC hours, from the in-cell values of the cementing entries.
- **Hole sections** (`hole_sections`): number, **hole diameter** (from the report's section column), **bit diameter(s)**
  (from the bits), **casing diameter** and shoe (from the casing run in that section) - three separate values - interval,
  formations, BHA runs, tools, drilling dates, duration, average ROP, NPT.

XX-1: 23" / 17-1/2" / 12-1/4" / 8-1/2" sections; 18-5/8" casing (shoe 608 m, inferred), 13-3/8" (1806 m, stated),
9-5/8" (3081 m, stated), 7" liner (3525 m, stated); 8 BHA runs.

## 4. Simulation

New panels, inside the existing layout: the two alert panels side by side; **Current Hole Section**; **Operations Timeline**
(one lane per category, NPT in red, click to jump) with the current operation; **Drilling Tools & Hole Section Details**
(changes with the operation: BHA and drill string while drilling / tripping, the casing string and its equipment while
running casing, the cement job and cementing equipment while cementing, BOP equipment for BOP operations); **Casing &
Cementing Details** (strings run and cemented up to the playhead). The schematic draws the casing shoes of the strings
already run.

## 5. Data provenance and duplicates

Every operation, run, tool, string, job and section keeps its worksheet!cell. Manual entries and corrections are marked
(`entered_by`, `basis = engineer`). The SHA-256 of each imported file is stored (`import_batches.file_hash`, unique): the
same file cannot be imported twice.

## 6. Tests

- `src/lib/simScenarios.test.ts` - the five requested scenarios on a synthetic report: operations at each stage (drilling,
  casing, cementing, WOC); a stuck-pipe event as a red current-well alert; a historical lost-circulation warning that stays
  amber and independent; BHA / bit / section / casing following date and depth; missing dimensions staying null.
- `src/import/smart/realReport.test.ts` - the same on XX-1 and XX-2 (operations, NPT, sections, shoes, serials).
- `src/db/schema.test.ts` - the schema on PostgreSQL (PGlite): tables, seed = catalogue, relations, cascade, duplicate refusal.

## Known limits

- Equipment is read from the comment text; reports that keep BHA / casing tallies in separate tables or sheets are read only
  through the generic table reader (not yet mapped to tools).
- A BHA's bit size is taken only from the bit line; when the bit line has no size (XX-1 run 1) it stays "Not available".
- Formation-specific casing tallies, tool lengths and IDs are not in these reports, so they are empty until entered.
- Supabase mode has the tables and policies but was not run against a live project.
