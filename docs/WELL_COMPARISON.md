# Well Comparison: interactive charts and point analysis

The **Drilling parameter charts** section of the Well Comparison page replaces the former single depth-track chart.
Code: `src/lib/pointAnalysis.ts` (logic, tested), `src/components/CompareExplorer.tsx` (controls and layout),
`src/components/ParamChart.tsx` (one chart), `src/components/PointAnalysisPanel.tsx` (analysis panel).

## Data

- One chart per parameter: ROP, WOB, RPM, Torque, Differential Pressure, SPP, Flow Rate, Mud Weight, Hook Load (the first
  five are shown by default; the others from **Show parameters**).
- Points are the stored **on-bottom drilling records** of each well (`drilling_records`), not averages. X axis: **measured
  depth** or **elapsed time since the well's first record** (wells drilled in different months are compared from their own start).
- A report line that covers several hours is stored as several records with the same values and its depth spread across the
  reported interval (`data_quality = interpolated`). Those points are drawn hollow and labelled; the comparison never
  interpolates anything itself.
- Records, equipment, surveys and corrective actions are loaded once per well set. Clicking, zooming and panning run no
  database query.

## 1. Selection modes

| Mode | A click on one chart selects |
|---|---|
| All Parameters | the same depth / time on every chart |
| Independent | only that chart |
| Custom Selection | the same depth / time on the chosen parameters; the others keep their own selection |

- **One shared key.** A selection is a depth (ft) or elapsed time (h), never an array index. Each chart marks, for each well,
  that well's nearest record that has the parameter.
- **Tolerance.** By default the tolerance is three times that well's own sampling interval; it can also be set in ft or hours.
  Outside the tolerance nothing is marked.
- **Mode changes.** Changing the mode or the custom set re-applies the latest selection at once.
- **Keyboard.** With a chart focused, ← / → step to the previous / next record and Esc clears the selection.

## 2. Point analysis panel

Opens on the right on wide screens (below the charts on narrower ones, with a "View analysis" link); its own scroll is
contained. The well chips switch the analysed well without losing the selected depth / time.

| Tab | Content |
|---|---|
| Summary | parameter, MD, TVD (recorded, or from the survey and labelled), date and time, formation, operation (operations log, or the activity code when there is none), hole section, BHA number, run (depth in / out, dates), bit type and diameter, the run's tools; the interpretation headline |
| Compare wells | one column per well: the record used (exact / nearest with its real difference / far), time, TVD, formation, operation, section, BHA, bit, every parameter, data quality, source cell |
| Before / after | window: previous / next drilling record, 5 records, 10 min, 30 min, 1 h. The actual interval analysed and the median entry spacing are shown; a time window narrower than the well's sampling is flagged. Per parameter: previous record, previous window mean, current, next, change, %, min, max |
| Recorded events | facts of the selected well. In the window: BHA / bit change, formation change, hole size change, rotary / slide change, non-drilling operations and NPT, problems, report text mentioning a parameter, documented dull grade. Separately, as context only: problems recorded near the depth at another time |
| Historical | problems of **other** wells within the chosen depth distance or in the same (equivalence-mapped) formation, with the original well, description, NPT, status, source and corrective actions |
| Interpretation | the explanation, statement by statement, each with its class and evidence |
| Sources | the drilling entries used (role, time, depth, value, source cell, data quality) |

"Previous drilling record" means the previous **report entry**, not a copy of the same cell (`entries()` groups records
that share a source cell).

### Evidence classes

| Class | Meaning | Examples |
|---|---|---|
| Confirmed | written in the report | "Formation changed from Hartha to Sadi" with its cell; a report sentence that ties the parameter to a change ("drilled with reduced WOB due to vibration") |
| Data-supported | observed in the records at the same time | "WOB increased by 19% (28.7 → 34.2 klb), consistent with the increase in ROP" |
| Possible explanation | engineering interpretation the report does not confirm | "a harder formation may have slowed drilling; rock strength is not recorded" |
| Insufficient data | the data cannot decide | "Insufficient data to determine the cause of this change." |

- **What counts as a change.** A change smaller than ±10% of the previous window is not treated as a change; below ±5% the
  parameter is "relatively stable".
- **Parameters examined for each target:**
  - ROP: WOB, RPM, ΔP, flow, mud weight (opposite direction), torque (no direction claimed).
  - Torque: WOB, RPM, ROP, mud weight.
  - ΔP: flow, WOB, SPP, mud weight.
  - SPP: flow, mud weight, ΔP.
- **Parameters the crew sets** (WOB, RPM, flow, mud weight) are explained only by recorded events or the report text.
- **Only the analysis window counts as evidence.** A recorded event is reported as a fact plus "the report does not state that
  this changed X", unless the report text itself says so. Problems of the well that happened at another time near the same
  depth are listed but never used as evidence.

## 3. Navigation and layout

- **Page scrolling.** ECharts' "inside" zoom consumes every wheel event over a chart, so the page could not scroll past one.
  It is not used. The page always scrolls with the wheel.
- **Zoom and pan.**
  - Ctrl + wheel zooms at the pointer.
  - Shift + wheel or a horizontal trackpad swipe pans.
  - Dragging pans; a drag never creates a selection.
  - The slider under each chart zooms and pans, including on touch screens.
- **Synchronize Chart Navigation** (off by default) links the horizontal zoom / pan of the chosen charts. All charts share the
  depth or time axis. The value axes have different units and are never linked.
- **Per chart:** reset zoom, expand, collapse, maximize (Esc or the button restores; the page behind does not scroll), hide.
  **Show parameters**, **Reset zoom** (all) and **Restore default layout** are at the top.
- **Layout memory.** Mode, custom set, axis, tolerance, visible charts and sizes are remembered per browser
  (`localStorage`, optional).

## Tests

- `src/lib/pointAnalysis.test.ts`, the eight requested scenarios on synthetic records:
  1. All Parameters mode.
  2. Independent mode.
  3. Custom ROP / WOB / RPM.
  4. The nearest record of each well and its context.
  5. Before / after changes, events and the evidence classes; explicit report text; insufficient data.
  6. Historical problems with original well and corrective actions; the well's own nearby problems kept as context.
  7. Navigation targets.
  8. Different sampling intervals, missing values, unreached depths, time axis, split report entries.
- `src/import/smart/realReport.test.ts` runs the same on XX-1 against XX-2:
  - the previous record is the previous report entry;
  - XX-2 is matched by its own nearest record with the exact difference;
  - every interpretation is classified.

## Limits

- **Relationships are general.** The direction rules are general drilling relationships used to say whether a change
  is consistent. They are not a model of the specific well, and nothing is concluded from them alone.
- **Text reading is basic.** Report text is checked for a parameter named together with a change word. Other wording that
  states a cause is not recognised.
