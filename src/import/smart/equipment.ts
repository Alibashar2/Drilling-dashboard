// Layer 6 - operations, BHA runs, drilling tools, casing strings, cement jobs, well-control equipment and hole
// sections, read from the operations of a daily report. Everything is taken from what the report writes:
// a dimension, serial number or specification that is not written stays null ("Not available") - never estimated.
// Every item keeps the worksheet!cell and the line it came from.
import { classifyOperation, OP_TYPE, type OpCategory } from '../../lib/operations';
import type { InCellHit } from './incell';

export interface EqOp {
  id: string; t0: number; t1: number; text: string; task: string | null; phase: string | null; src: string;
  holeSize: number | null; md0: number | null; md1: number | null; progress: boolean; hits: InCellHit[];
  nptCounted: boolean; nptCategory: string | null; activity: string;
}
export interface OperationEx {
  seq: number; code: string; name: string; category: OpCategory; basis: string; confidence: number; steps: string[];
  start: string; end: string; hours: number; startMd: number | null; endMd: number | null; holeSize: number | null;
  bhaRun: number | null; casingOd: number | null; description: string; text: string; task: string | null; phase: string | null;
  isNpt: boolean; nptCategory: string | null; activity: string; src: string;
}
export type ToolCategory = 'Drill String' | 'BHA' | 'Casing Equipment' | 'Cementing Equipment' | 'Well Control';
export interface ToolEx {
  key: string; category: ToolCategory; type: string; name: string; description: string;
  od: number | null; id: number | null; lengthFt: number | null; quantity: number | null; quantityUnit: string | null;
  serial: string | null; manufacturer: string | null; specs: Record<string, string | number>;
  bhaRun: number | null; casingOd: number | null; holeSize: number | null; installedAt: string | null; retrievedAt: string | null; src: string; line: string;
}
export interface BhaRunEx {
  runNo: number; bhaType: string | null; holeSize: number | null; bitSize: number | null; bitType: string | null; bitModel: string | null; bitSerial: string | null; bitCondition: string | null;
  nozzles: string | null; dullGrade: string | null; start: string; end: string | null; depthIn: number | null; depthOut: number | null; description: string; src: string;
}
export interface CasingEx {
  kind: 'casing' | 'liner'; od: number; weights: { ppf: number; from: number | null; to: number | null }[]; grades: string[]; connections: string[];
  topMd: number | null; shoeMd: number | null; shoeBasis: string; floatCollarMd: number | null; landingCollarMd: number | null; holeSize: number | null;
  start: string; end: string; description: string; src: string;
}
export interface CementJobEx {
  casingOd: number | null; kind: 'casing' | 'liner' | 'unknown'; stages: number; start: string; end: string; steps: string[];
  fluids: { fluid: string; densityPpg: number; text: string; src: string }[]; displacementBbl: number | null; fcpPsi: number | null; bumpPsi: number | null;
  plugs: string[]; lossesText: string | null; wocHours: number; tocMd: number | null; description: string; src: string;
}
export interface HoleSectionEx {
  no: number; holeSize: number | null; bitSizes: number[]; bitTypes: string[]; casingOd: number | null; casingKind: string | null; shoeMd: number | null;
  topMd: number | null; bottomMd: number | null; formations: string[]; bhaRuns: number[]; tools: number;
  drillStart: string | null; drillEnd: string | null; start: string; end: string; hours: number; avgRopFph: number | null; nptHours: number; src: string;
}

const iso = (ms: number) => new Date(ms).toISOString();
const r2 = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const FT = 3.280839895;

// ------------------------------------------------------------------ sizes written in reports
/** `9 1/2"`, `9-1/2"`, `9.5"`, `22 7/8"`, `14 3/16"`, `5-1/2'`, `3-1/2´`, `6-3/4''`, `23 "`, `9 1/2“` -> inches; null when not a plausible diameter. */
const SIZE = /(\d{1,2})(?:(?:[\s-]+|\s?)(\d{1,2})\s?\/\s?(\d{1,2})|\.(\d{1,3}))?\s?("|''|“|”|´|'(?!')|\s?in(?:ch(?:es)?)?\b)/g;
export function sizesIn(s: string): { v: number; i: number; end: number }[] {
  const out: { v: number; i: number; end: number }[] = [];
  for (const m of s.matchAll(SIZE)) {
    const v = +m[1] + (m[2] ? +m[2] / +m[3] : m[4] ? Number(`0.${m[4]}`) : 0);
    if (v >= 1 && v <= 36 && !(m[2] && +m[2] >= +m[3])) out.push({ v: r2(v), i: m.index!, end: m.index! + m[0].length });
  }
  return out;
}
const SERIAL = /(?:s\s*\/\s*n|s\.n\.?|\bsn)\s*[:#.]?\s*(?:(?:s\s*\/\s*n|sn)\s*[:#.]?\s*)?(?!s\s*\/\s*n\b)\(?([A-Z0-9][A-Z0-9\-\/]{2,25})/i;
/** "SP0912" and "0912" written for the same bit are one serial number */
const sameSerial = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && (a.endsWith(b) || b.endsWith(a) || a.startsWith(b) || b.startsWith(a)));
const BRANDS = /\b(Weatherford|WFD|Halliburton|HLB|Schlumberger|SLB|Cameron|Baker(?: Hughes)?|NOV|Smith|Hughes|Varel|Ulterra|Scientific Drilling|Gyrodata|Tenaris|Vallourec|Dril-?Quip)\b/i;
const NUMW: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };

interface TypeRule { re: RegExp; type: string; category: ToolCategory }
// order matters: the most specific first
const BHA_RULES: TypeRule[] = [
  { re: /\bbit(?![a-z])(?!\s*sub)/i, type: 'Bit', category: 'BHA' },
  { re: /scraper|junk basket|magnet|\bmill\b/i, type: 'Other BHA Component', category: 'BHA' },
  { re: /\bpd\s*\d+|power ?drive|\borbit\b|\brss\b|auto ?trak|geo-?pilot|xceed/i, type: 'Rotary Steerable System (RSS)', category: 'BHA' },
  { re: /motor|\ba\d{3}m\d+\w*|\bpdm\b/i, type: 'Motor', category: 'BHA' },
  { re: /\blwd\b|\barc[- ]?\d|neo ?scope|eco ?scope|\badn\b|sonic ?scope|\bgvr\b|peri ?scope/i, type: 'LWD Tool', category: 'BHA' },
  { re: /\bmwd|tele ?scope|impulse|slim ?pulse/i, type: 'MWD Tool', category: 'BHA' },
  { re: /nmdc|non[- ]?mag/i, type: 'Non-Magnetic Drill Collar', category: 'BHA' },
  { re: /\bjar\b/i, type: 'Jar', category: 'BHA' },
  { re: /shock/i, type: 'Shock Sub', category: 'BHA' },
  { re: /reamer|\bgdr\b|hole opener/i, type: 'Reamer', category: 'BHA' },
  { re: /near[- ]?bit|\bnb\.?\s*stab/i, type: 'Near Bit Stabilizer', category: 'BHA' },
  { re: /stab(?:ili[sz]er)?\b|st\.\s?stab/i, type: 'String Stabilizer', category: 'BHA' },
  { re: /\bx\.?\s?o\b|x[- .]?over|cross ?over/i, type: 'Crossover', category: 'Drill String' },
  { re: /float sub|bit sub|b\/sub|pbl|filter sub|circulation sub|saver sub|\bsub\b/i, type: 'Sub', category: 'Drill String' },
  { re: /hwdp|heavy ?weight/i, type: 'Heavy Weight Drill Pipe (HWDP)', category: 'Drill String' },
  { re: /\bdc'?s?\b|drill ?collar|spiral dc/i, type: 'Drill Collar', category: 'Drill String' },
  { re: /\bdp\b|drill ?pipe/i, type: 'Drill Pipe', category: 'Drill String' },
];
const CSG_RULES: TypeRule[] = [
  { re: /float shoe|f\.\s?shoe|\bfs\b|guide shoe|stab-?in (?:float )?shoe/i, type: 'Float Shoe', category: 'Casing Equipment' },
  { re: /float collar|f\.\s?collar|\bfc\b/i, type: 'Float Collar', category: 'Casing Equipment' },
  { re: /landing collar|\bl\.?\s?c\b|latch[- ]down baffle/i, type: 'Landing Collar', category: 'Casing Equipment' },
  { re: /baffle/i, type: 'Baffle Adapter', category: 'Casing Equipment' },
  { re: /\bdv\b|stage (?:cementing )?tool/i, type: 'Stage Cementing (DV) Tool', category: 'Casing Equipment' },
  { re: /centrali[sz]er/i, type: 'Centralizers', category: 'Casing Equipment' },
  { re: /liner\s*(?:hgr|hanger)(?!\s*setting tool)/i, type: 'Liner Hanger', category: 'Casing Equipment' },
  { re: /cement head|cmt head/i, type: 'Cementing Head', category: 'Cementing Equipment' },
  { re: /(?:top|bottom|shut-?off|closing|dart|wiper|opening)\s*plug|cement(?:ing)? plug/i, type: 'Cementing Plug', category: 'Cementing Equipment' },
  { re: /cement(?:ing)? lines|cmt lines/i, type: 'Cementing Lines', category: 'Cementing Equipment' },
  { re: /stinger|stab-?in (?:cementing )?(?:assy|tool)/i, type: 'Other Cementing Equipment', category: 'Cementing Equipment' },
];
const WC_RULES: TypeRule[] = [
  { re: /annular/i, type: 'Annular Preventer', category: 'Well Control' },
  { re: /\brams?\b|shear ram|blind ram|pipe ram/i, type: 'Ram Preventer', category: 'Well Control' },
  { re: /choke manifold/i, type: 'Choke Manifold', category: 'Well Control' },
  { re: /kill line/i, type: 'Kill Line', category: 'Well Control' },
  { re: /choke line/i, type: 'Choke Line', category: 'Well Control' },
  { re: /diverter/i, type: 'Diverter', category: 'Well Control' },
  { re: /\bb\.?o\.?p\b/i, type: 'BOP', category: 'Well Control' },
];

const ACTION = /^(?:[-*•\s]*)(?:(?:p\/u|m\/u|r\/b|l\/d|b\/o|r\/u|pick(?:ed)? up|made up|lay(?:ed)? down|rack(?:ed)? back)\s*(?:,|&|and|\+)?\s*)+/i;
const NOT_COMPONENT = /wt\.? below|bha (?:wt|weight)|weight below|monitor|observed|discuss|wash(?:ed)? down|flush|physical(?:ly)? check|total |daily |\bpjsm|tofs|drift|function test|applied|recorded|confirm|change elevator|dull grad/i;
/** the line that describes the operation itself ("RIH 17-1/2" Motor BHA to 287 m", "POOH ... from 290 m to surface") */
const HEADLINE = /\bbha\b(?!\s*\()|^(?:[-*•\s]*)(?:cont\w*\.?\s+)?(?:(?:p\/u,?\s*)?(?:m\/u\s*(?:&|and)\s*)?(?:rih|pooh|tih|toh|trip\w*|run in|pull(?:ed)? out)\b)|\bfrom\s+[\d.]+\s*m?\s+to\s+(?:[\d.]+|surface)/i;

function splitComponents(line: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (const ch of line) {
    if (ch === '(') depth++; if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '+' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}
function splitList(line: string): string[] {
  const out: string[] = []; let depth = 0, cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '(') depth++; if (ch === ')') depth = Math.max(0, depth - 1);
    const and = depth === 0 && /^\s+and\s+/i.test(line.slice(i)) ? /^\s+and\s+/i.exec(line.slice(i))![0].length : 0;
    if (depth === 0 && (ch === ',' || ch === '&')) { out.push(cur); cur = ''; }
    else if (and) { out.push(cur); cur = ''; i += and - 1; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}
function qty(s: string): { q: number | null; unit: string | null } {
  let m = /(?:^|\(|\s)(\d{1,3})\s*(?:x|\*)\s*(?:(jts?|joints?|stds?|stands?)\b)?/i.exec(s) ?? /(?:^|\(|\s)(\d{1,3})\s*(jts?|joints?|stds?|stands?)\b/i.exec(s);
  if (m) { const u = m[2] ?? /\b(jts?|joints?|stds?|stands?)\b/i.exec(s)?.[1] ?? null; return { q: +m[1], unit: u ? (/^j/i.test(u) ? 'joints' : 'stands') : null }; }
  m = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(stands?|joints?|jts?|stds?)\b/i.exec(s);
  if (m) return { q: NUMW[m[1].toLowerCase()], unit: /^j/i.test(m[2]) ? 'joints' : 'stands' };
  return { q: null, unit: null };
}

/** Parse one component written in a BHA / casing / BOP list. Returns null when the text names no known equipment. */
export function parseComponent(raw: string, rules: TypeRule[], src: string, line: string): Omit<ToolEx, 'bhaRun' | 'casingOd' | 'holeSize' | 'installedAt' | 'retrievedAt'> | null {
  const s = raw.replace(ACTION, '').replace(/^[-*•\s]+/, '').trim();
  if (!s || NOT_COMPONENT.test(s)) return null;
  const sn = SERIAL.exec(s);
  const typed = sn ? s.replace(sn[0], ' ') : s;   // a serial number ("A829933-1") must not decide the type
  const rule = rules.find(x => x.re.test(typed));
  if (!rule) return null;
  const specs: Record<string, string | number> = {};
  let type = rule.type;
  const sizes = sizesIn(s);
  // a size followed by stab / sleeve / stabilizer is a stabilizer gauge, not the tool body
  const gauge = sizes.filter(z => /^\s*(?:"|'')?\s*(?:od\s*)?(?:st\.?\s?)?(?:sleeve\s*)?stab/i.test(s.slice(z.end, z.end + 18)) || /(?:sleeve|stab\w*)\s*$/i.test(s.slice(Math.max(0, z.i - 14), z.i)));
  let od: number | null = null;
  if (type === 'Crossover') { const c = /\(([^)]*)\)/.exec(s); if (c && !/^\s*(?:s\s*\/\s*n|sn|s\.n)/i.test(c[1])) specs.connections = c[1].trim(); }
  else if (type === 'Ram Preventer' || type === 'BOP' || type === 'Annular Preventer') {
    // "13-5/8" 10K" is the preventer bore; "(5-1/2" Fixed rams)" / "4-1/2" to 7"" are the pipe sizes the rams close on
    const bore = sizes.find(z => /^\s*\d+\s*k\b/i.test(s.slice(z.end, z.end + 6)));
    od = bore?.v ?? null;
    const pipes = sizes.filter(z => z !== bore).map(z => z.v);
    if (pipes.length && type === 'Ram Preventer') specs.ram_pipe_size_in = pipes.join(' – ');
  }
  if (type !== 'Crossover' && type !== 'Ram Preventer' && type !== 'BOP' && type !== 'Annular Preventer') {
    const body = sizes.filter(z => !gauge.includes(z));
    if (type === 'String Stabilizer' || type === 'Near Bit Stabilizer') od = (gauge[0] ?? sizes[0])?.v ?? null;
    else if (rule.category === 'Casing Equipment' || rule.category === 'Cementing Equipment') {
      // for casing / cementing equipment a size counts only when written before the item ("13-3/8" 3K Cement head", "HLB 7" Float Shoe")
      const at = rule.re.exec(typed)?.index ?? s.length;
      od = body.filter(z => z.i < at)[0]?.v ?? null;
    } else od = body[0]?.v ?? null;
    if (gauge.length && type !== 'String Stabilizer' && type !== 'Near Bit Stabilizer') specs.stabilizer_od_in = gauge[0].v;
  }
  if (type === 'Bit') {
    type = /pdc/i.test(s) ? 'PDC Bit' : /tci|trc|tricone|tri-cone|roller ?cone|insert|milled tooth|\bmt\b/i.test(s) ? 'Roller Cone Bit' : 'Bit';
    const model = /type\s*[:]?\s*([A-Z][A-Z0-9-]{2,15})/i.exec(s) ?? /\(\s*(?:type\s*:\s*)?([A-Z]{1,4}[a-z]?\d{2,4}[A-Z]{0,3})\b/.exec(s);
    if (model) specs.model = model[1];
    if (/\b(rr|re-?run)\b/i.test(s)) specs.condition = 'Re-run'; else if (/refurbish/i.test(s)) specs.condition = 'Refurbished'; else if (/\bnew\b/i.test(s)) specs.condition = 'New';
    const nz = /(?:nozzles?(?:\s*size)?\s*[:]?\s*|jets\s*[:]?\s*\(?|dressed with\s*)([0-9][0-9xX*\/\s+´'"]*[0-9"])/i.exec(s);
    if (nz) specs.nozzles = nz[1].replace(/\s+/g, ' ').trim();
    if (/without nozzles/i.test(s)) specs.nozzles = 'none (stated)';
  }
  if (type === 'Motor') { const b = /(\d(?:\.\d+)?)\s*°?\s*(?:deg\w*\s*)?(?:bh\b|bent)/i.exec(s); if (b) specs.bend_deg = +b[1]; }
  if (/pony/i.test(s)) specs.variant = 'pony';
  if (/spiral/i.test(s)) specs.variant = 'spiral';
  const conn = /\b(\d-\d\/\d"?\s*(?:reg|if|fh|nc\d+)[^,)*]*)/i.exec(s); if (conn && type !== 'Crossover') specs.connection = conn[1].trim();
  const brand = BRANDS.exec(s);
  const single = !/Drill Pipe|HWDP|Drill Collar|Centralizers|Non-Magnetic/.test(type);
  // a single tool is one item; "12x12" / "3X 20/32" after a bit are nozzles, not a count
  const q = single && !/^\s*\d{1,2}\s*(?:x|\*)\s*\d{1,2}\s*["“”´']/.test(s) ? { q: null, unit: null } : qty(s.replace(/(?:nozzles?|jets)[^)]*\)?/i, ''));
  const name = s.replace(/\s*[,;]?\s*(?:s\s*\/\s*n|s\.n\.?|\bsn)\s*[:#.]?\s*[A-Z0-9][A-Z0-9\-\/]{2,25}\)?/i, '').replace(/\s+/g, ' ').replace(/[.,;]+$/, '').trim();
  return {
    key: `${type}|${od ?? ''}|${sn?.[1] ?? ''}`, category: rule.category, type, name: name.slice(0, 120), description: s.slice(0, 300), od, id: null, lengthFt: null,
    quantity: q.q ?? (single ? 1 : null), quantityUnit: q.q ? q.unit : single ? 'each' : null, serial: sn?.[1]?.replace(/[).,]+$/, '') ?? null, manufacturer: brand?.[1] ?? null, specs, src, line,
  };
}

const bulletLines = (text: string) => text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
const tubularOd = (s: string) => { const m = /(\d{1,2}(?:[-\s]\d{1,2}\/\d{1,2}|\.\d+)?)\s*["“”]?\s*(?:csg|casing|liner)\b/i.exec(s); return m ? sizesIn(m[1] + '"')[0]?.v ?? null : null; };

export function extractEquipment(opsIn: EqOp[]) {
  const ops = [...opsIn].sort((a, b) => a.t0 - b.t0);
  type OpenRun = BhaRunEx & { closed: boolean; drilled: boolean };
  const operations: OperationEx[] = [], tools: ToolEx[] = [], runs: OpenRun[] = [], casings: CasingEx[] = [], jobs: CementJobEx[] = [], warnings: string[] = [];
  let run = null as OpenRun | null;
  const addTool = (t: Omit<ToolEx, 'bhaRun' | 'casingOd' | 'holeSize' | 'installedAt' | 'retrievedAt'>, extra: Partial<ToolEx>) => {
    // the same component listed again in the same run / string (e.g. when laid down) updates it instead of duplicating it
    const sameSlot = (x: ToolEx) => x.bhaRun === (extra.bhaRun ?? null) && x.casingOd === (extra.casingOd ?? null) && x.type === t.type && (x.od === t.od || x.od == null || t.od == null) && (t.category !== 'Drill String' || x.od === t.od);
    const same = tools.find(x => sameSlot(x) && (!x.serial || !t.serial || sameSerial(x.serial, t.serial)));
    // the same single tool listed with two different serial numbers in one run is an inconsistency of the report
    const clash = !same && t.serial && extra.retrievedAt && /Bit$|Motor|RSS|MWD|LWD|Sub|Jar/.test(t.type) ? tools.find(x => sameSlot(x) && x.serial && !sameSerial(x.serial, t.serial!) && x.retrievedAt == null) : null;
    if (clash) warnings.push(`${t.type} of BHA run ${extra.bhaRun}: serial ${clash.serial} at make-up (${clash.src}) but ${t.serial} when laid down (${t.src}). Both are kept; check the report.`);
    if (same) {
      same.serial ??= t.serial; same.od ??= t.od; same.manufacturer ??= t.manufacturer;
      for (const [k, v] of Object.entries(t.specs)) if (same.specs[k] == null) same.specs[k] = v;
      if (extra.retrievedAt) same.retrievedAt = extra.retrievedAt;
      return same;
    }
    const full: ToolEx = { ...t, bhaRun: null, casingOd: null, holeSize: null, installedAt: null, retrievedAt: null, ...extra };
    tools.push(full);
    return full;
  };
  const casingFor = (od: number | null) => (od == null ? casings[casings.length - 1] : casings.find(c => c.od === od)) ?? null;

  ops.forEach((op, seq) => {
    const cls = classifyOperation(op.task, op.phase, op.text, op.progress);
    const type = OP_TYPE[cls.code];
    const lines = bulletLines(op.text);
    const head = lines[0] ?? '';
    // ---------------------------------------------------------------- BHA runs and components
    // "... BHA (bit ...) + Motor + float sub + ..." and "R/B ( a + b + c )" are lists; "+" inside a component's own brackets is not
    const compLines = lines.flatMap(l => {
      if (/bha\s*\(/i.test(l) && l.includes('+')) return splitComponents(l.replace(/^.*?bha\s*\(/i, '')).map(c => ({ c, l }));
      const wrapped = /^[-*•\s]*(?:[a-z/&,\s]{0,14})\(\s*(.+\+.+)\)\s*\.?$/i.exec(l);
      return (wrapped ? splitComponents(wrapped[1]) : splitComponents(l)).map(c => ({ c, l }));
    });
    // a BHA listed line by line under any entry that names the BHA ("Wash down W/ 23" Drilling BHA ... - 23" PDC Bit ... - 9-1/2" NMDC ...")
    const listsBha = /\bbha\b/i.test(op.text) && lines.filter(l => /^[-*•]/.test(l) && !HEADLINE.test(l) && BHA_RULES.some(r => r.re.test(l))).length >= 3;
    const bhaComps = (cls.code === 'MU_BHA' || cls.code === 'BO_BHA' || listsBha || /bha\s*\(/i.test(op.text) || /\bl\/d\b[^.\n]{0,40}\bbit\b/i.test(op.text))
      ? compLines.filter(({ c, l }) => !(HEADLINE.test(l) && !/bha\s*\(/i.test(l)) || (/\bbha\s*\(/i.test(l) && c !== l)).map(({ c, l }) => ({ comp: parseComponent(c, BHA_RULES, op.src, l), laidDown: /\b(l\/d|b\/o|r\/b|lay(ed)? down|rack(ed)? back)\b/i.test(l) || cls.code === 'BO_BHA' })).filter(x => x.comp)
      : [];
    const makesUp = cls.code === 'MU_BHA' || (bhaComps.length >= 3 && bhaComps.filter(x => !x.laidDown).length >= 3);
    if (makesUp && (!run || run.closed || (run.drilled && !/\b(rest|continu\w*|cont\.)\b/i.test(head)))) {
      if (run && !run.closed) run.end = iso(op.t0);
      const typeWord = /(motor|rss|rotary|vortex|clean ?out|scraper|fishing|steerable|pendulum|packed|milling|tandem scraper)\b[^.\n]{0,12}\bbha/i.exec(op.text)?.[1] ?? null;
      run = { runNo: runs.length + 1, bhaType: typeWord ? (/^rss$/i.test(typeWord) ? 'RSS' : typeWord.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())) : null, holeSize: op.holeSize, bitSize: null, bitType: null, bitModel: null, bitSerial: null, bitCondition: null, nozzles: null, dullGrade: null,
        start: iso(op.t0), end: null, depthIn: null, depthOut: null, description: head.slice(0, 200), src: op.src, closed: false, drilled: false };
      runs.push(run);
    }
    if (run && !run.closed) {
      for (const { comp, laidDown } of bhaComps) {
        const t = addTool(comp!, { bhaRun: run.runNo, holeSize: run.holeSize, installedAt: laidDown ? null : iso(op.t0), retrievedAt: laidDown ? iso(op.t1) : null });
        if (t.installedAt == null && !laidDown) t.installedAt = iso(op.t0);
        if (/Bit$/.test(t.type)) {
          run.bitSize ??= t.od; run.bitType ??= t.type; run.bitSerial ??= t.serial;
          run.bitModel ??= (t.specs.model as string) ?? null; run.nozzles ??= (t.specs.nozzles as string) ?? null; run.bitCondition ??= (t.specs.condition as string) ?? null;
        }
      }
      // drill pipe is usually named only in the trip lines: "RIH ... on 5-1/2" DP"
      const dp = /\bon\s+(?:drifted\s+)?(\d{1,2}(?:[-\s]\d\/\d)?\s*["'´”])\s*(?:dp|drill ?pipe)\b/i.exec(op.text);
      if (dp && !tools.some(x => x.bhaRun === run!.runNo && x.type === 'Drill Pipe')) {
        const v = sizesIn(dp[1])[0]?.v ?? null;
        addTool({ key: `Drill Pipe|${v}`, category: 'Drill String', type: 'Drill Pipe', name: `${dp[1].trim()} DP`, description: dp[0], od: v, id: null, lengthFt: null, quantity: null, quantityUnit: null, serial: null, manufacturer: null, specs: {}, src: op.src, line: lines.find(l => l.includes(dp[0])) ?? head },
          { bhaRun: run.runNo, holeSize: run.holeSize, installedAt: iso(op.t0) });
      }
      const dg = op.hits.find(h => h.key === 'dull_grade');
      if (dg) { run.dullGrade = String(dg.value); const bit = tools.find(x => x.bhaRun === run!.runNo && /Bit$/.test(x.type)); if (bit) bit.specs.dull_grade = String(dg.value); }
      if (type.category === 'Drilling' && /^DRL_/.test(cls.code)) { run.drilled = true; if (run.depthIn == null) run.depthIn = op.md0; }
      if (op.md1 != null && run.drilled) run.depthOut = Math.max(run.depthOut ?? 0, op.md1);
      // the bit coming out of the hole ends the run
      if (bhaComps.some(x => x.laidDown && /Bit$/.test(x.comp!.type)) || (cls.code === 'BO_BHA' && /to surface/i.test(op.text) && /\bbit\b/i.test(op.text))) { run.closed = true; run.end = iso(op.t1); }
    }
    // ---------------------------------------------------------------- casing strings and their equipment
    if (cls.code === 'CSG_RUN' || cls.code === 'LNR_RUN' || ((cls.code === 'CSG_CIRC' || cls.code === 'CSG_LAND' || cls.code === 'CSG_SET') && /casing|liner/i.test(op.phase ?? ''))) {
      const od = tubularOd(head) ?? tubularOd(op.text) ?? (cls.code !== 'CSG_RUN' && cls.code !== 'LNR_RUN' ? casings[casings.length - 1]?.od ?? null : null);
      if (od != null) {
        let cs = casings.find(c => c.od === od);
        const kind: 'casing' | 'liner' = /liner/i.test(`${op.task} ${op.phase} ${head}`) ? 'liner' : 'casing';
        if (!cs && cls.code !== 'CSG_RUN' && cls.code !== 'LNR_RUN') { /* a casing named outside a running entry does not start a string */ }
        else if (!cs) { cs = { kind, od, weights: [], grades: [], connections: [], topMd: kind === 'casing' ? 0 : null, shoeMd: null, shoeBasis: '', floatCollarMd: null, landingCollarMd: null, holeSize: op.holeSize, start: iso(op.t0), end: iso(op.t1), description: head.slice(0, 200), src: op.src }; casings.push(cs); }
        if (cs) {
        cs.end = iso(op.t1);
        const par = new RegExp(String.raw`(?:csg|casing|liner)\s*(?:shoe track\s*)?\(([^)]*)\)`, 'i').exec(op.text)?.[1] ?? '';
        const w = /([\d.]+)\s*(?:#|ppf|lb\/ft)/i.exec(par); const iv = /(?:from\s*(surface|[\d.]+)\s*m?\s*)?\bto\s*([\d.]+)\s*m\b/i.exec(head);
        const toFtM = (v: string | undefined) => (v == null ? null : v === 'surface' ? 0 : r2(+v * FT, 1));
        if (w) {
          // consecutive running entries with the same weight are one segment of the string
          const from = iv ? toFtM(iv[1]) : null, to = iv ? toFtM(iv[2]) : null, lastW = cs.weights[cs.weights.length - 1];   // "to 490 m" alone: start not written
          if (lastW && lastW.ppf === +w[1]) { if (from != null) lastW.from = lastW.from == null ? from : Math.min(lastW.from, from); if (to != null) lastW.to = Math.max(lastW.to ?? 0, to); }
          else cs.weights.push({ ppf: +w[1], from, to });
        }
        const g = /\b([JKLNPQTC]-?\d{2,3}[A-Z]?(?:Cr\d+\w*)?)\b/.exec(par); if (g && !cs.grades.includes(g[1].replace('-', ''))) cs.grades.push(g[1].replace('-', ''));
        const cn = /(TSH[- ]?[A-Za-z]+(?:\s+BLUE)?|\bBTC\b|\bLTC\b|\bSTC\b|VAM\s?\w*|Tenaris\s?\w*)/i.exec(par); if (cn && !cs.connections.includes(cn[1].toUpperCase())) cs.connections.push(cn[1].toUpperCase());
        // shoe depth: the report's own statement first, otherwise the deepest depth the string was run to (inferred)
        // "... to 1806 m [OH]. (13 3/8" CSG setting depth)": the last depth written before "setting depth" (not a "planned" one)
        const sd = /(?<!planned\s)(?:setting depth|shoe setting depth)/i.exec(op.text);
        const before = sd ? [...op.text.slice(Math.max(0, sd.index - 70), sd.index).matchAll(/([\d.]+)\s*m\b/gi)].pop() : null;
        const set = before ?? /(?:set (?:the )?(?:casing|csg|liner) at)\s*([\d.]+)\s*m/i.exec(op.text);
        const fsAt = /(?:float shoe|f\.\s?shoe|\bshoe)\s*@\s*([\d.]+)\s*m/i.exec(op.text);
        if (fsAt) { cs.shoeMd = r2(+fsAt[1] * FT, 1); cs.shoeBasis = 'shoe depth stated in the report'; }
        else if (set && cs.shoeBasis !== 'shoe depth stated in the report') { cs.shoeMd = r2(+set[1] * FT, 1); cs.shoeBasis = 'setting depth stated in the report'; }
        else if (iv && !/stated/.test(cs.shoeBasis)) { const d = r2(+iv[2] * FT, 1); if (cs.shoeMd == null || d > cs.shoeMd) { cs.shoeMd = d; cs.shoeBasis = 'deepest depth the string was run to (inferred)'; } }
        const fc = /float collar\s*@\s*([\d.]+)\s*m/i.exec(op.text); if (fc) cs.floatCollarMd = r2(+fc[1] * FT, 1);
        const lc = /landing collar\s*@\s*([\d.]+)\s*m/i.exec(op.text); if (lc) cs.landingCollarMd = r2(+lc[1] * FT, 1);
        const tol = /\bTOL\s*@\s*([\d.]+)\s*m/i.exec(op.text); if (tol) cs.topMd = r2(+tol[1] * FT, 1);
        }
      }
    }
    // equipment is read only where it is installed or used: running, circulating, landing, cementing - not where it is drilled out or removed
    const csgCtx = ['CSG_RUN', 'LNR_RUN', 'CSG_CIRC', 'CSG_LAND', 'CSG_SET', 'CSG_FILL', 'CMT_PREP', 'CMT_PUMP', 'CMT_MIX', 'SPACER', 'DISPLACE', 'BUMP'].includes(cls.code);
    if (csgCtx) {
      const odHere = tubularOd(op.text);
      // "Float Shoe and Float Collar made up", "FS + 2 Jts + FC": several items in one line (commas inside brackets do not split)
      const items = (l: string) => splitComponents(l).flatMap(c => { const parts = splitList(c); return parts.filter(x => CSG_RULES.some(r => r.re.test(x))).length >= 2 ? parts : [c]; });
      for (const l of lines) for (const c of items(l)) {
        const comp = parseComponent(c, CSG_RULES, op.src, l);
        if (!comp) continue;
        const cs = casingFor(sizesIn(c)[0]?.v ?? odHere);
        if (comp.type === 'Centralizers') { const per = /(one|two|three|\d+)\s+centrali[sz]ers?\s+per\s+(joint|jt)/i.exec(l); if (per) comp.specs.placement = `${per[1]} per joint`; else if (/as per program/i.test(l)) comp.specs.placement = 'as per program'; const ty = /type\s*[:]?\s*([^).]+)/i.exec(l); if (ty) comp.specs.model = ty[1].trim(); comp.quantity = null; comp.quantityUnit = null; }
        const t = addTool(comp, { casingOd: cs?.od ?? null, holeSize: op.holeSize, installedAt: iso(op.t0) });
        const wt = /\(([\d.]+)\s*#/.exec(c); if (wt) t.specs.weight_ppf = +wt[1];
      }
    }
    // ---------------------------------------------------------------- well-control equipment
    if (cls.code === 'BOP_INST' || cls.code === 'BOP_TEST') {
      for (const l of lines.flatMap(x => splitComponents(x))) {
        if (!/bop\s*(?:stack)?|annular|\brams?\b|choke manifold|kill line|choke line|diverter/i.test(l) || /spacer|maintenance|valve was|lift(?:ed)?/i.test(l)) continue;
        const comp = parseComponent(l, WC_RULES, op.src, l);
        if (!comp) continue;
        const rating = /(\d{1,2})\s*k\b/i.exec(l); if (rating) comp.specs.pressure_rating_psi = +rating[1] * 1000;
        addTool(comp, { holeSize: op.holeSize, installedAt: iso(op.t0) });
      }
    }
    // ---------------------------------------------------------------- cement jobs (one per casing / liner string)
    if (type.category === 'Cementing' || cls.code === 'CSG_CIRC' && /cement/i.test(op.task ?? '')) {
      const od = tubularOd(op.text) ?? casings[casings.length - 1]?.od ?? null;
      let job = jobs.find(j => j.casingOd === od);
      if (!job) { const cs = casingFor(od); job = { casingOd: od, kind: cs?.kind ?? 'unknown', stages: 0, start: iso(op.t0), end: iso(op.t1), steps: [], fluids: [], displacementBbl: null, fcpPsi: null, bumpPsi: null, plugs: [], lossesText: null, wocHours: 0, tocMd: null, description: head.slice(0, 200), src: op.src }; jobs.push(job); }
      job.end = iso(op.t1);
      if (cls.code === 'CMT_PUMP') {
        const nums = [...op.text.matchAll(/\b(\d)(?:st|nd|rd|th)\s+stage|\b(first|second|third)\s+stage/gi)].map(m => (m[1] ? +m[1] : { first: 1, second: 2, third: 3 }[m[2].toLowerCase() as 'first']));
        job.stages = Math.max(job.stages, 1, ...nums);
      }
      if (cls.code === 'WOC') job.wocHours = r2(job.wocHours + (op.t1 - op.t0) / 3600000, 2);
      for (const st of cls.steps) if (!job.steps.includes(st)) job.steps.push(st);
      for (const h of op.hits) {
        if (h.status === 'rejected') continue;
        if (h.key === 'fluid_density' && h.canonical != null) job.fluids.push({ fluid: (h.qualifier ?? 'fluid').replace(/^(of|the|with)\s+/i, ''), densityPpg: r2(h.canonical, 2), text: h.text, src: h.src });
        if (h.key === 'displacement' && h.canonical != null) job.displacementBbl = r2(h.canonical, 1);
        if (h.key === 'fcp' && h.canonical != null) job.fcpPsi = h.canonical;
        if (h.key === 'bump_pressure' && h.canonical != null) job.bumpPsi = h.canonical;
        if (h.key === 'loss_volume' || (h.key === 'loss_rate' && typeof h.value === 'number' && h.value > 0)) job.lossesText = [job.lossesText, h.text].filter(Boolean).join('; ');
        if (h.key === 'toc' && h.canonical != null) job.tocMd = h.canonical;
      }
      for (const m of op.text.matchAll(/\b(top|bottom|shut-?off|closing|dart|wiper|opening)\s*plug/gi)) { const p = `${m[1].toLowerCase()} plug`; if (!job.plugs.includes(p)) job.plugs.push(p); }
    }
    operations.push({
      seq: seq + 1, code: cls.code, name: type.name, category: type.category, basis: cls.basis, confidence: cls.confidence, steps: cls.steps,
      start: iso(op.t0), end: iso(op.t1), hours: r2((op.t1 - op.t0) / 3600000, 2), startMd: op.md0, endMd: op.md1, holeSize: op.holeSize,
      bhaRun: run && !run.closed ? run.runNo : run && run.closed && Date.parse(run.end!) >= op.t1 ? run.runNo : null,
      casingOd: type.category === 'Casing' || type.category === 'Cementing' ? (tubularOd(op.text) ?? casings[casings.length - 1]?.od ?? null) : null,
      description: head.slice(0, 300), text: op.text, task: op.task, phase: op.phase, isNpt: op.nptCounted, nptCategory: op.nptCategory, activity: op.activity, src: op.src,
    });
  });
  const last = runs[runs.length - 1];
  if (last && !last.closed && !last.end) last.end = operations[operations.length - 1]?.end ?? null;
  return { operations, tools, bhaRuns: runs.map(({ closed: _c, drilled: _d, ...r }) => r), casings, cementJobs: jobs, warnings };
}

/** Structured hole sections: one per hole size, in the order drilled. Hole, bit and casing diameters stay separate. */
export function holeSections(eq: ReturnType<typeof extractEquipment>, recs: { ts: string; hole_depth_ft: number | null; hole_size_in: number | null; activity_code: string | null; npt_hours: number | null; formation_name: string | null; rop_fph: number | null }[]): HoleSectionEx[] {
  const out: HoleSectionEx[] = [];
  const sizes: number[] = [];
  for (const op of eq.operations) if (op.holeSize != null && !sizes.includes(op.holeSize)) sizes.push(op.holeSize);
  let prevBottom: number | null = null;
  sizes.forEach((size, i) => {
    const ops = eq.operations.filter(o => o.holeSize === size);
    const rs = recs.filter(r => r.hole_size_in === size);
    const drill = ops.filter(o => /^DRL_/.test(o.code));
    const depths = rs.map(r => r.hole_depth_ft).filter((v): v is number => v != null);
    const bottom = depths.length ? Math.max(...depths) : null;
    const runsHere = eq.bhaRuns.filter(b => b.holeSize === size || (b.holeSize == null && ops.some(o => o.bhaRun === b.runNo)));
    const bits = eq.tools.filter(t => /Bit$/.test(t.type) && runsHere.some(b => b.runNo === t.bhaRun));
    const cs = eq.casings.find(c => c.holeSize === size) ?? null;
    const dh = rs.filter(r => r.activity_code === 'ROT' || r.activity_code === 'SLD');
    const t0 = Date.parse(ops[0].start), t1 = Date.parse(ops[ops.length - 1].end);
    const top = prevBottom ?? (depths.length ? Math.min(...depths) : null);
    const footage = bottom != null && top != null ? bottom - top : null;
    const drillH = dh.length ? (Date.parse(dh[dh.length - 1].ts) - Date.parse(dh[0].ts) >= 0 ? drill.reduce((s, o) => s + o.hours, 0) : 0) : 0;
    out.push({
      no: i + 1, holeSize: size, bitSizes: [...new Set(bits.map(b => b.od).filter((v): v is number => v != null))], bitTypes: [...new Set(bits.map(b => [b.type, b.specs.model].filter(Boolean).join(' ')))],
      casingOd: cs?.od ?? null, casingKind: cs?.kind ?? null, shoeMd: cs?.shoeMd ?? null,
      topMd: top, bottomMd: bottom,
      formations: [...new Set(rs.filter(r => r.activity_code === 'ROT' || r.activity_code === 'SLD').map(r => r.formation_name).filter((f): f is string => !!f))],
      bhaRuns: runsHere.map(b => b.runNo), tools: eq.tools.filter(t => runsHere.some(b => b.runNo === t.bhaRun) || (cs && t.casingOd === cs.od)).length,
      drillStart: drill[0]?.start ?? null, drillEnd: drill[drill.length - 1]?.end ?? null, start: ops[0].start, end: ops[ops.length - 1].end, hours: r2((t1 - t0) / 3600000, 2),
      avgRopFph: footage != null && drillH > 0 ? r2(footage / drillH, 1) : null, nptHours: r2(rs.reduce((s, r) => s + (r.npt_hours ?? 0), 0), 2), src: ops[0].src,
    });
    if (bottom != null) prevBottom = bottom;
  });
  return out;
}
