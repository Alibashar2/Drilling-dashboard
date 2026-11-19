// Loads / removes the clearly-labelled SAMPLE dataset through the same repository functions a real import uses.
import * as XLSX from 'xlsx';
import { addAction, addPrognosis, createImportBatch, createWell, deleteWell, insertRecords, insertSurvey, listCategories, listWells, logActivity, rebuildDerived, saveProblem } from '../db/repo';
import { generateDemoWells, sampleImportSheets } from './generate';

export async function loadDemo(onProgress?: (msg: string) => void): Promise<number> {
  const cats = await listCategories();
  const existing = new Set((await listWells()).map(w => w.well_code));
  let n = 0;
  for (const d of generateDemoWells()) {
    if (existing.has(d.well.well_code)) continue;
    onProgress?.(`${d.well.name}: ${d.records.length.toLocaleString()} records`);
    const well = await createWell(d.well);
    const batch = await createImportBatch(well.id, 'demo', null, d.records.length, null, null);
    await insertRecords(well.id, d.records, batch);
    if (d.survey.length) await insertSurvey(well.id, d.survey);
    await rebuildDerived(well);
    if (d.prognosis.length) await addPrognosis(well.id, d.prognosis);
    for (const p of d.problems) {
      const saved = await saveProblem({
        well_id: well.id, problem_code: p.code, category_id: cats.find(c => c.code === p.category)!.id, occurred_at: p.ts,
        md_top_ft: p.md, md_bottom_ft: p.md + 30, tvd_ft: p.tvd, formation_name: p.formation, hole_size_in: p.holeSize, bha_number: p.bha,
        activity_code: 'ROT', description: p.description, observed_params: p.observed, root_cause: p.rootCause, npt_hours: p.hours,
        severity: p.severity, status: 'confirmed', source: 'demo', lessons_learned: p.lesson, notes: 'Sample record (synthetic).',
      }, well);
      for (const a of p.actions) await addAction(saved.id, a, 'Applied');
    }
    n++;
  }
  if (n) await logActivity('Loaded sample dataset', `${n} synthetic wells`);
  return n;
}

export async function removeDemo(): Promise<number> {
  const demo = (await listWells()).filter(w => w.is_demo);
  for (const w of demo) await deleteWell(w);
  return demo.length;
}

/** Download a synthetic metric-unit workbook for trying the import wizard. */
export function downloadSampleImportFile() {
  const { drilling, survey } = sampleImportSheets();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(drilling), 'Drilling Data');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(survey), 'Survey');
  XLSX.writeFile(wb, 'SAMPLE_import_test_well_metric.xlsx');
}
