# Intelligent drilling report reader

Reads drilling Excel/CSV reports as they arrive - no reformatting, no column mapping - and turns them into
traceable, simulation-ready data. Code: `src/import/smart/`. It runs by default when a file is uploaded on
**Add New Well**; the previous manual column mapping is still there as a fallback ("Manual mapping").

## Layers

| # | File | What it does |
|---|---|---|
| 1 | `workbook.ts` | Every worksheet, including hidden ones. Per cell: raw value, displayed text, formula, date/time flag. Merged ranges are propagated; hidden rows and columns are read and reported. |
| 2 | `structure.ts` | Finds tables anywhere on a sheet (not just at the top), several per sheet and side by side; single, two-level and unit-row headers; horizontal tables (parameters down, days or Min/Max/Avg across); label/value metadata above, below or beside tables; paragraphs; section titles; tables that continue after a blank row. |
| 3 | `dictionary.ts` | ~60 drilling concepts recognised from names, abbreviations and synonyms, scored by how much of the label matches, then checked against the unit in the header and the plausible value range. Unknown labels can be taught once and are stored in `term_dictionary`. |
| 4 | `narrative.ts` | From operations text: drilled / reamed / tripped intervals, ROP (average vs instantaneous), durations, problems (with negation), formations, corrective actions, rig activity, planned vs actual. |
| 5 | `engine.ts` | Cross-sheet integration, unit conversion, validation, confidence, and the records for the database. |

| 3b | `incell.ts` | Parameters written **with their value inside one cell** ("WOB: 2-4 Ton, FR:1000 lpm, SPP:330-350 psi"), anywhere in the workbook. See below. |

Optional: `llm.ts` + `server/llm-proxy.mjs` ask Claude to map labels the dictionary cannot resolve. It is off
unless `VITE_LLM_PROXY_URL` is set; everything else is deterministic and works without any AI service.

## Values written inside cells (`incell.ts`)

Real reports (XX-1, XX-2) keep the drilling parameters inside the comment of each operation, e.g.
`- WOB: 1-5 Ton, RPM: 60-70, T.RPM: 90-110 ,TQ: 2-12 kft.lb.` / `- On BTM ROP: 37.09 m/hr, Avg ROP: 23.81 m/hr.` /
`- Lithology @ 810 m: 100% Dolomite` / `** Last Survey: 577.96 mMD, 577.89 mTVD, inc:2.98°, Azm:145.77°`.
The scanner reads every text cell (operations comments, scattered "Label: value" cells, paragraphs, leftovers); it
never relies on a column or a cell position.

| Step | What it recognises |
|---|---|
| Grammar | `label[:= -]value[unit]`, `label value`, `label (unit): value`, ranges `2-4`, `10 -11`, pairs `138/115 Ton`, `MW in/out`, `+/-`, qualifiers before (`Daily`, `Total`, `Current`, `Managed`…) and after (`off/on bottom`, `up/down`) the label |
| Lexicon | ~70 parameters with abbreviations seen in the reports: `FR`/`F.R`/`FL`, `TQ`/`TRQ`, `S.RPM`/`SRPM`, `T.RPM`/`TRPM`, `On BTM`/`On-bottom`/`AVR ROP`, `DHL`, `MW IN/OUT`, `FCP`/`FDP`, `WBJ`, `K-Rev`, `PBL`, … (`PARAMS` in `incell.ts`) |
| Units | read as written and kept (`Ton`, `kft.lb`, `klbs.ft`, `KIbf.ft`, `lpm`, `bpm`, `m3/hr`, `SG`, `°`…), converted to the database unit (klb, ft-lb, gpm, psi, ppg, bbl/h, ft). A missing unit is taken from the unit the same report uses for that parameter (status *inferred*, noted) |
| Sentences | `ROP decreased to 0.8 m/h`, `MW increased gradually from 1.25 SG to 1.28 SG`, `DHL started from 688 m to 716 m with rate= 5 m3/hr`, `tight spot on 464 m, 367 m with 15 tons`, `Tag TOC at 596 m W/ 5 Ton`, `601.0 bbl of 1.50 SG lead slurry`, `P/T … to 700 psi for 15 min`, pump tables `MP#2: 30 SPM_ 430 PSI` |
| Special | survey stations and projections (projections and TVD > MD are never used as stations), lithology with its depth, `Formation:` lines, `(Top of X)` / `(X Fm Top)` markers with the interval depth, IADC dull grade, nozzles |
| Not data | serial / part numbers are recognised as identifiers and never used as values; `No DHL` is a stated absence (0), not a missing value; safety-meeting paragraphs never create problems |
| Context | each value carries the context of its line ("Ream up … with FR: 1460 lpm" = reaming). Records use only the operation's own context: a reaming flow rate is never a drilling flow rate; SCR / test values never go into records |
| Coverage | every number followed by a drilling unit that nothing explains is listed ("Values in cells" tab, accuracy report) instead of being silently dropped |

Every value has: parameter, qualifier, original text, line, value / min / max, unit as written, recognised unit, unit basis,
database value, worksheet, cell, context, confidence, method, status and notes. It is stored in `extracted_parameters`
(one row per value, with the import batch) and shown on the well page under **Source values**.

### Validation and corrections

The **Values in cells** tab on Add New Well shows a summary per parameter (count, example, unit, source cell, mean confidence,
how many need review) and the full list with filters. An engineer can change the parameter, change the value, confirm or
reject each value; the extraction re-runs at once, so records, problems and formations use the corrected values. Corrections are
saved with the value (`review`, `original_value`).

### How the operations of a time-breakdown sheet become records (XX-1 layout)

| Column in XX-1 | Read as |
|---|---|
| Start_Date / End_Date (`8/9/2025 6:00:00 PM`) | start / end date-time; month-first is decided from dates such as `8/13/2025` that can only be read one way |
| Duration (h) | cross-check against start / end |
| Top / Bottom Depth (m) and (ft) | hole depth at the start / end of the entry; the ft columns are recognised as the same values in another unit (checked row by row) and the m columns, which hold the originally reported numbers, are used |
| Activity(Code) / Task(Sub Code) | phase and task; the task gives the rig state (`Drill to depth` → rotary or slide from the text, `Trip out to depth (OH)` → tripping, `Run in casing to depth` → other, `Waiting on cement` → other, not NPT) |
| Time_Classification | the report's own Productive / Non Productive classification: it is final, no "possible NPT" guesses are added |
| NPT_Category / NPT_SubCategroy / NPT_Vendor | consecutive NPT entries with the same category become one NPT event, its NPT the sum of their durations |
| Borehole Section (`17.500`) | numbers between 3 and 40 → hole size in inches (data pattern) |
| Comments | in-cell parameters, problems, intervals, formation, lithology, surveys |

Bit depth follows the hole while drilling and is interpolated along a trip when the text gives it ("POOH from 601 m to 257 m");
otherwise it is left empty.

### Results on the real reports

`reports/XX-1_ACCURACY.md` (regenerate with `ACCURACY_OUT=reports npm run test:accuracy`) and `reports/XX-1_extraction_map.csv`.

| | XX-1 | XX-2 (not used to tune anything) |
|---|---|---|
| Operations / records | 375 / 1,389 | 442 / 1,587 |
| NPT | 17.75 h = sum of the 10 "Non Productive" rows | 98.5 h = sum of the 52 "Non Productive" rows |
| Values read in cells | 1,755 (93 identifiers) | 1,671 (62 identifiers) |
| Hand-labelled sample (12 cells, 164 values) | recall 99.4 %, precision 100 % | — |
| Numbers with a drilling unit not attributed | 23 (packer / DV / liner-hanger pressures, slurry densities in brackets, "more than 1 m/h") | 33 |
| Survey stations | 9 (11 statements, 2 repeated; one repeated station has two different TVDs → warning) | 4 |

The test `src/import/smart/realReport.test.ts` checks these against numbers computed directly from the sheet's own columns
(NPT, deepest Bottom Depth, distinct survey stations) and verifies that the text of every one of the 1,755 values is found
verbatim in the cell it is attributed to. It is skipped on machines where the file is not present.

### Running the reader outside the browser

```bash
npm run read-report -- "C:/path/XX-1.xlsx" --unit m --out reports
```
```bash
node server/report-reader.mjs --serve --port 8788
```

The first writes `<name>.extraction.json` and `<name>.extraction_map.csv`; the second accepts
`POST /extract?unit=m&name=XX-1.xlsx` with the file as the request body and returns the summary, records, problems,
formations, survey stations and every value with its source cell. Both run the same engine code as the app (Vite loads the
TypeScript in Node). The input file is only read.

## Evidence rules

| Rule | How it is applied |
|---|---|
| Status of every value | **confirmed** (written in the source), **inferred** (calculated, e.g. footage from two depths, midpoint of a min-max range), **suspected** (interpreted from text), **missing** (not found - nothing is filled in). Each has a confidence and a `Sheet!Cell` reference. |
| MD / TVD / bit depth / hole depth | Separate concepts. Off-bottom records get no bit depth because the report does not give one. |
| ROP | Average, instantaneous and unspecified ROP are separate; ROP calculated as footage / hours is labelled inferred. |
| NPT | Counted only when the report classifies it: an NPT column / code, the words NPT / non-productive / downtime / lost time, or the report's own NPT table. Waiting, repairs and stuck pipe without such a label are listed as *possible NPT* for the engineer to accept. A duration next to a problem ("spent 4 hours treating the losses") is stored as problem-related time and **not** counted. |
| No double counting | NPT is placed on the timeline once; an event that appears in both the time log and the NPT table is merged, and overlapping events cannot add up. |
| Problems | Always saved as **suspected** with the original text and cell; an engineer confirms them. "No losses", "without drag" are recognised as negative. |
| Planned vs actual | Planned / forecast paragraphs are shown but never imported as operations or problems. |
| Unrelated data | Sheets that name a different well are reported and not merged. |
| Nothing discarded | Content that cannot be classified is listed in the report and stored with the import batch. |

## How records are built

1. **Time-based table** (timestamp + depth, many rows): one record per row, values as reported.
2. **Operations log** (From / To / Hrs / description): each operation becomes 30-minute records. Depth advances
   only across intervals the text states ("drilled from X to Y"); daily parameters (WOB, RPM, mud weight...) are
   applied to that day's drilling records; formation comes from the formation table by depth. These records are
   marked `data_quality = 'interpolated'` and show a badge in the simulation.
3. **Daily summary** (one row or one sheet per day, no time log): one record per day using the reported hours.

Sheets are joined by well, report date (from a label, the title or the sheet name), timestamp and depth.

## Traceability

- `drilling_records.source_ref`, `data_quality`, `extra`
- `drilling_problems.source_ref`, `source_text`, `extraction`
- `import_batches.mapping / validation` hold the whole extraction report (tables, parameter confidences,
  issues, unresolved labels, unclassified content).

## Known limits

- Tested on two real reports of one operator (XX-1, XX-2, same template) and on synthetic layouts. Other operators'
  wording will expose labels the lexicon does not have; they show up as "not attributed" numbers and in the
  validation table, and `PARAMS` / `CHANGE` in `incell.ts` plus the tests are the place to extend them.
- "Ton" is read as the metric tonne (1 t = 2.205 klb), as in these reports.
- A loss-rate statement ("DHL: 2 m3/hr") is recorded as a suspected *Mud Losses* problem; "partial / total / no return @
  depth" as lost circulation. The engineer confirms.
- Formation names are taken as written; obvious variants are merged ("Dammam FM" = "Dammam", "UER" = "Umm-Er-Radhuma",
  "Zubair Upper SH" = "Zubair Upper Shale"). Other spellings remain separate until mapped in Settings.
- Extracted values are not part of the JSON backup in Settings (they are re-created by re-importing the file).
- `.xls` / `.xlsx` / `.csv` only. PDFs, scanned reports and images are not read.
- Narrative rules are English only.
- One well per import. A workbook holding several wells imports the most frequent one and reports the rest.
- Text dates are read day-first unless the date format is set on the manual tab; Excel date cells need no guess.
- The AI proxy is written but was not run (no API key during development).
