// Well page: hole sections, BHA runs and their tools, casing & cementing, well-control equipment and the operations,
// all from the imported report (with their source cells). Engineers add missing tools and correct values;
// a corrected or manually entered tool is marked as such.
import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import * as repo from '../db/repo';
import { useAuth, usePrefs } from '../lib/context';
import { OP_CATEGORIES, OP_TYPE, type OpCategory, CATEGORY_COLOR } from '../lib/operations';
import type { DrillingTool, Operation } from '../lib/types';
import { fmt, fmtDateTime } from '../lib/units';
import { fromLocalInput, toLocalInput, zoneLabel } from '../lib/time';
import { CasingSummary, CementSummary, CorrectOperation, inch, SectionTable, ToolTable } from './SimPanels';
import { Badge, Button, Card, Field, Input, Modal, Notice, Select, Spinner, useAction, useAsync } from './ui';

const CATS = ['Drill String', 'BHA', 'Casing Equipment', 'Cementing Equipment', 'Well Control'] as const;
const TYPES: Record<string, string[]> = {
  'Drill String': ['Drill Pipe', 'Heavy Weight Drill Pipe (HWDP)', 'Drill Collar', 'String Stabilizer', 'Sub', 'Crossover'],
  BHA: ['PDC Bit', 'Roller Cone Bit', 'Motor', 'Rotary Steerable System (RSS)', 'Near Bit Stabilizer', 'String Stabilizer', 'Non-Magnetic Drill Collar', 'MWD Tool', 'LWD Tool', 'Jar', 'Shock Sub', 'Reamer', 'Other BHA Component'],
  'Casing Equipment': ['Casing Pipes', 'Float Shoe', 'Float Collar', 'Landing Collar', 'Centralizers', 'Stage Cementing (DV) Tool', 'Liner Hanger', 'Baffle Adapter'],
  'Cementing Equipment': ['Cementing Head', 'Cementing Plug', 'Cementing Lines', 'Other Cementing Equipment'],
  'Well Control': ['BOP', 'Annular Preventer', 'Ram Preventer', 'Choke Manifold', 'Kill Line', 'Choke Line', 'Diverter'],
};

export default function EquipmentTab({ wellId, U }: { wellId: string; U: import('../lib/units').Units }) {
  const { t } = usePrefs();
  const { canWrite } = useAuth();
  const { data, loading, error, reload } = useAsync(() => repo.getEquipment(wellId), [wellId]);
  const [edit, setEdit] = useState<Partial<DrillingTool> | null>(null);
  const [fixOp, setFixOp] = useState<Operation | null>(null);
  const [cat, setCat] = useState('');
  const [n, setN] = useState(60);
  const act = useAction();
  const ops = useMemo(() => (data?.operations ?? []).filter(o => !cat || o.category === cat), [data, cat]);
  if (loading && !data) return <Spinner label={t('Loading…')} />;
  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return null;
  const { runs, tools, casings, cementing, sections } = data;
  const wc = tools.filter(x => x.category === 'Well Control');
  const loose = tools.filter(x => !x.bha_run_id && !x.casing_string_id && x.category !== 'Well Control');
  const th = 'border-b border-line px-1.5 py-1 text-start text-[10px] font-medium uppercase tracking-wide text-mute whitespace-nowrap', td = 'border-b border-line/40 px-1.5 py-1 align-top';
  const editBtn = (x: DrillingTool) => canWrite && <span className="ms-1 inline-flex gap-0.5"><Button size="sm" variant="ghost" title={t('Edit')} onClick={() => setEdit(x)}><Pencil size={12} /></Button><Button size="sm" variant="ghost" title={t('Delete')} onClick={() => act.run(async () => { await repo.deleteTool(x.id); reload(); })}><Trash2 size={12} /></Button></span>;
  if (!data.operations.length && !tools.length && !sections.length) return <Notice>{t('No operations or equipment are stored for this well. They are read from the report when a well is imported with the automatic reader.')}</Notice>;

  return (
    <div className="space-y-4">
      {act.error && <Notice kind="error">{act.error}</Notice>}
      <Card title={t('Hole sections')} right={t('hole, bit and casing diameters are separate values')}><SectionTable sections={sections} U={U} /></Card>

      <Card title={t('BHA runs and drilling tools')} right={canWrite && <Button size="sm" onClick={() => setEdit({ category: 'BHA', tool_type: 'PDC Bit', name: '' })}><Plus size={13} />{t('Add tool')}</Button>}>
        <div className="space-y-3">{runs.map(r => (
          <details key={r.id} className="rounded-md border border-line p-2" open={runs.length <= 2}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-[13px]">
              <b>{t('BHA run')} {r.run_no}</b>{r.bha_type && <Badge>{r.bha_type}</Badge>}
              <span className="num text-xs text-mute">{t('Hole')} {inch(r.hole_size_in) ?? '—'} · {t('Bit')} {inch(r.bit_size_in) ?? t('Not available')} {[r.bit_type, r.bit_model].filter(Boolean).join(' ')} {r.bit_serial ? `SN ${r.bit_serial}` : ''} · {fmtDateTime(r.start_at)} → {fmtDateTime(r.end_at)} · {U.fd(r.depth_in_ft)} → {U.fdu(r.depth_out_ft)}{r.dull_grade ? ` · ${t('dull')} ${r.dull_grade}` : ''}</span>
            </summary>
            <div className="mt-2"><ToolTable tools={tools.filter(x => x.bha_run_id === r.id)} U={U} /></div>
            {canWrite && <div className="mt-1 flex flex-wrap gap-1">{tools.filter(x => x.bha_run_id === r.id).map(x => <span key={x.id} className="rounded border border-line/60 px-1 text-[10px]">{x.tool_type}{editBtn(x)}</span>)}</div>}
          </details>))}
          {!runs.length && <p className="text-xs text-mute">{t('No BHA run is described in the report.')}</p>}
          {loose.length > 0 && <div><h4 className="mb-1 text-xs font-semibold text-mute">{t('Tools not linked to a BHA run or casing string')}</h4><ToolTable tools={loose} U={U} />{canWrite && <div className="mt-1 flex flex-wrap gap-1">{loose.map(x => <span key={x.id} className="rounded border border-line/60 px-1 text-[10px]">{x.tool_type}{editBtn(x)}</span>)}</div>}</div>}
        </div>
      </Card>

      <Card title={t('Casing strings and cement jobs')}>
        <div className="space-y-3">{casings.map(c => (
          <div key={c.id} className="space-y-1">
            <CasingSummary c={c} U={U} />
            {cementing.filter(j => j.casing_string_id === c.id).map(j => <CementSummary key={j.id} j={j} U={U} />)}
            <ToolTable tools={tools.filter(x => x.casing_string_id === c.id)} U={U} />
            {canWrite && <div className="flex flex-wrap gap-1">{tools.filter(x => x.casing_string_id === c.id).map(x => <span key={x.id} className="rounded border border-line/60 px-1 text-[10px]">{x.tool_type}{editBtn(x)}</span>)}</div>}
          </div>))}
          {!casings.length && <p className="text-xs text-mute">{t('No casing string is described in the report.')}</p>}
        </div>
      </Card>

      <Card title={t('Well control equipment')}>
        <ToolTable tools={wc} U={U} />
        {canWrite && <div className="mt-1 flex flex-wrap gap-1">{wc.map(x => <span key={x.id} className="rounded border border-line/60 px-1 text-[10px]">{x.tool_type}{editBtn(x)}</span>)}</div>}
      </Card>

      <Card title={`${t('Operations')} (${data.operations.length})`} right={<Select className="h-7 w-44 text-xs" value={cat} onChange={e => setCat(e.target.value)}><option value="">{t('All categories')}</option>{OP_CATEGORIES.map(c => <option key={c} value={c}>{t(c)} ({data.operations.filter(o => o.category === c).length})</option>)}</Select>}>
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr>{['Start', 'h', 'Operation', 'Category', 'Depth', 'Hole', 'BHA', 'Basis', 'Description', 'Source', ''].map(h => <th key={h} className={th}>{t(h)}</th>)}</tr></thead>
          <tbody>{ops.slice(0, n).map(o => (
            <tr key={o.id}>
              <td className={`${td} num whitespace-nowrap`}>{fmtDateTime(o.start_at)}</td><td className={`${td} num`}>{fmt(o.duration_h, 2)}</td>
              <td className={td}><b>{t(OP_TYPE[o.type_code]?.name ?? o.type_code)}</b>{o.is_npt && <Badge color="red" className="ms-1">NPT</Badge>}</td>
              <td className={td}><span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: CATEGORY_COLOR[o.category as OpCategory] }} />{t(o.category)}</span></td>
              <td className={`${td} num whitespace-nowrap`}>{o.start_md_ft != null ? (o.start_md_ft === o.end_md_ft ? U.fdu(o.start_md_ft) : `${U.fd(o.start_md_ft)}–${U.fdu(o.end_md_ft)}`) : '—'}</td>
              <td className={`${td} num`}>{inch(o.hole_size_in) ?? '—'}</td><td className={`${td} num`}>{runs.find(r => r.id === o.bha_run_id)?.run_no ?? '—'}</td>
              <td className={td}><Badge color={o.basis === 'engineer' ? 'green' : o.basis === 'insufficient information' ? 'yellow' : 'gray'}>{t(o.basis)}</Badge></td>
              <td className={`${td} max-w-md text-mute`} title={o.text ?? ''}>{o.description}</td>
              <td className={td}><span className="num text-[10px] text-mute" dir="ltr">{o.source_ref}</span></td>
              <td className={td}>{canWrite && <Button size="sm" variant="ghost" title={t('Correct operation')} onClick={() => setFixOp(o)}><Pencil size={12} /></Button>}</td>
            </tr>))}</tbody>
        </table></div>
        {ops.length > n && <div className="mt-2 text-end"><Button size="sm" onClick={() => setN(n + 200)}>{t('Show more')} ({ops.length - n})</Button></div>}
      </Card>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? t('Correct tool') : t('Add tool')}>
        {edit && <ToolForm initial={edit} wellId={wellId} runs={runs} casings={casings} busy={act.busy} onCancel={() => setEdit(null)}
          onSave={x => act.run(async () => { await repo.saveTool(x); setEdit(null); reload(); })} />}
      </Modal>
      <Modal open={!!fixOp} onClose={() => setFixOp(null)} title={t('Correct operation')}>
        {fixOp && <CorrectOperation op={fixOp} busy={act.busy} onCancel={() => setFixOp(null)} onSave={code => act.run(async () => { await repo.correctOperation(fixOp, code, OP_TYPE[code].category); setFixOp(null); reload(); })} />}
      </Modal>
    </div>
  );
}

function ToolForm({ initial, wellId, runs, casings, busy, onSave, onCancel }: {
  initial: Partial<DrillingTool>; wellId: string; runs: import('../lib/types').BhaRun[]; casings: import('../lib/types').CasingString[]; busy: boolean;
  onSave: (x: Partial<DrillingTool> & { well_id: string; category: string; tool_type: string; name: string }) => void; onCancel: () => void;
}) {
  const { t } = usePrefs();
  const [f, setF] = useState<Partial<DrillingTool>>(initial);
  const num = (v: string) => (v.trim() === '' || isNaN(Number(v)) ? null : Number(v));
  const s = (k: keyof DrillingTool) => ({ value: f[k] == null ? '' : String(f[k]), onChange: (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value })) });
  const n = (k: keyof DrillingTool) => ({ value: f[k] == null ? '' : String(f[k]), inputMode: 'decimal' as const, onChange: (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: num(e.target.value) })) });
  const category = f.category ?? 'BHA';
  return (
    <div className="space-y-3 text-[13px]">
      {initial.source_ref && <p className="num text-xs text-mute" dir="ltr">{t('Source')}: {initial.source_ref}{initial.source_text ? ` — ${initial.source_text}` : ''}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label={t('Category')}><Select value={category} onChange={e => setF(p => ({ ...p, category: e.target.value, tool_type: TYPES[e.target.value][0] }))}>{CATS.map(c => <option key={c} value={c}>{t(c)}</option>)}</Select></Field>
        <Field label={t('Tool type')}><Select value={f.tool_type ?? ''} onChange={e => setF(p => ({ ...p, tool_type: e.target.value }))}>{[...new Set([f.tool_type ?? '', ...TYPES[category]])].filter(Boolean).map(x => <option key={x} value={x}>{t(x)}</option>)}</Select></Field>
        <Field label={t('Tool name') + ' *'}><Input {...s('name')} /></Field>
        <Field label={t('Description')}><Input {...s('description')} /></Field>
        <Field label={t('Outer diameter (in)')}><Input {...n('od_in')} /></Field>
        <Field label={t('Inner diameter (in)')}><Input {...n('id_in')} /></Field>
        <Field label={t('Length (ft)')}><Input {...n('length_ft')} /></Field>
        <Field label={t('Quantity')}><div className="flex gap-1"><Input className="w-24" {...n('quantity')} /><Select className="flex-1" value={f.quantity_unit ?? ''} onChange={e => setF(p => ({ ...p, quantity_unit: e.target.value || null }))}><option value="">—</option><option value="each">{t('each')}</option><option value="joints">{t('joints')}</option><option value="stands">{t('stands')}</option></Select></div></Field>
        <Field label={t('Serial No.')}><Input {...s('serial_no')} /></Field>
        <Field label={t('Manufacturer')}><Input {...s('manufacturer')} /></Field>
        <Field label={t('BHA run')}><Select value={f.bha_run_id ?? ''} onChange={e => setF(p => ({ ...p, bha_run_id: e.target.value || null, run_no: runs.find(r => r.id === e.target.value)?.run_no ?? null }))}><option value="">—</option>{runs.map(r => <option key={r.id} value={r.id}>{t('Run')} {r.run_no} · {inch(r.hole_size_in)}</option>)}</Select></Field>
        <Field label={t('Casing string')}><Select value={f.casing_string_id ?? ''} onChange={e => setF(p => ({ ...p, casing_string_id: e.target.value || null }))}><option value="">—</option>{casings.map(c => <option key={c.id} value={c.id}>{inch(c.od_in)} {t(c.kind)}</option>)}</Select></Field>
        <Field label={t('Installation date')}><Input type="datetime-local" title={zoneLabel()} value={toLocalInput(f.installed_at)} onChange={e => setF(p => ({ ...p, installed_at: fromLocalInput(e.target.value) }))} /></Field>
        <Field label={t('Retrieval date')}><Input type="datetime-local" title={zoneLabel()} value={toLocalInput(f.retrieved_at)} onChange={e => setF(p => ({ ...p, retrieved_at: fromLocalInput(e.target.value) }))} /></Field>
      </div>
      <p className="text-xs text-mute">{t('Leave a value empty when it is not known; it is shown as "Not available". Your entry is marked as entered or corrected by an engineer.')}</p>
      <div className="flex justify-end gap-2"><Button onClick={onCancel}>{t('Cancel')}</Button>
        <Button variant="primary" disabled={busy || !String(f.name ?? '').trim()} onClick={() => onSave({
          ...(f.id ? { id: f.id } : {}), well_id: wellId, category, tool_type: f.tool_type ?? TYPES[category][0], name: String(f.name).trim(), description: f.description ?? null, od_in: f.od_in ?? null, id_in: f.id_in ?? null,
          length_ft: f.length_ft ?? null, quantity: f.quantity ?? null, quantity_unit: f.quantity_unit ?? null, serial_no: f.serial_no || null, manufacturer: f.manufacturer || null, bha_run_id: f.bha_run_id ?? null, casing_string_id: f.casing_string_id ?? null,
          run_no: f.run_no ?? null, installed_at: f.installed_at ?? null, retrieved_at: f.retrieved_at ?? null, specs: f.specs ?? {}, entered_by: f.id ? f.entered_by : 'manual',
        })}>{t('Save')}</Button></div>
    </div>
  );
}
