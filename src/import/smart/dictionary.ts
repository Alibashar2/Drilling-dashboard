// Layer 3 - drilling domain intelligence. A dictionary of drilling concepts recognised from labels,
// abbreviations and synonyms, checked against units and value ranges. Labels the dictionary does not know
// can be taught by the user; learned terms are stored in the database and applied to later imports.
import { detectUnit, UNITS, type Dim } from '../../lib/units';

export type Kind = 'number' | 'text' | 'datetime' | 'time';
export type Group = 'Identity' | 'Depth' | 'Performance' | 'Time' | 'Drilling' | 'Mud' | 'Geology' | 'Operations' | 'Survey';
export interface Concept {
  key: string; label: string; group: Group; kind: Kind; dim: Dim; re: RegExp;
  /** plausible range in canonical units, used as a data-pattern check */
  range?: [number, number];
  /** matching column of the drilling_records import mapping, when there is one */
  record?: string;
}

const c = (key: string, label: string, group: Group, kind: Kind, dim: Dim, re: RegExp, range?: [number, number], record?: string): Concept => ({ key, label, group, kind, dim, re, range, record });

/** Order matters only for equal scores; scoring prefers the pattern that covers most of the label. */
export const CONCEPTS: Concept[] = [
  // ---- identity / report header
  c('well_name', 'Well name', 'Identity', 'text', 'none', /^(well( ?bore)?( name| no| number| #)?|name of well)$/),
  c('well_id', 'Well ID', 'Identity', 'text', 'none', /^(well id|uwi|api( no| number| #)?|well code)$/),
  c('field', 'Field', 'Identity', 'text', 'none', /^(field|field name|oil ?field)$/),
  c('location', 'Location', 'Identity', 'text', 'none', /^(location|area|block|country|region)$/),
  c('rig', 'Rig', 'Identity', 'text', 'none', /^(rig|rig name|rig no|rig #|drilling contractor|contractor)$/),
  c('report_date', 'Report date', 'Identity', 'datetime', 'none', /^(date|report date|reporting date|day date|ddr date|report for)$/),
  c('report_no', 'Report number', 'Identity', 'number', 'none', /^(report (no|number|#)|ddr (no|number|#)|rpt (no|#)|day (no|number|#)|dfs|days? (from|since) spud)$/),
  c('spud_date', 'Spud date', 'Identity', 'datetime', 'none', /spud( date)?/),
  c('well_type', 'Well type', 'Identity', 'text', 'none', /^(well type|well profile|profile|trajectory type)$/),
  c('target_depth', 'Planned / target depth', 'Depth', 'number', 'depth', /(plan\w*|target|proposed|prog\w*) (td|total depth|depth|md)|^ptd$|^planned td$/, [0, 45000]),
  // ---- time axis
  c('timestamp', 'Date-time', 'Time', 'datetime', 'none', /^(date ?time|date and time|timestamp|time ?stamp|rig time|date\/time)$/, undefined, 'ts'),
  c('time_only', 'Time of day', 'Time', 'time', 'none', /^(time|clock|hh mm|hh mm ss)$/, undefined, 'time_part'),
  c('time_from', 'Start time', 'Time', 'time', 'none', /^(from|start|start time|time from|from time|begin|time start|start (date ?)?(time)?|start date|date from|from date ?time|begin date|op\w* start|start dt|t ?start)$/),
  c('time_to', 'End time', 'Time', 'time', 'none', /^(to|end|end time|time to|to time|finish|time end|end (date ?)?(time)?|end date|date to|to date ?time|finish date|op\w* end|end dt|t ?end)$/),
  c('duration_h', 'Duration', 'Time', 'number', 'hours', /^(hrs?|hours?|dur|duration|elapsed|total (hrs?|hours?)|time hrs?|hrs? spent)$/, [0, 24]),
  // ---- depth
  c('bit_depth', 'Bit depth', 'Depth', 'number', 'depth', /bit (depth|md|pos\w*)|^dbtm$/, [0, 45000], 'bit_depth_ft'),
  c('hole_depth', 'Hole depth', 'Depth', 'number', 'depth', /hole (depth|md)|^dmea$|total depth|^td$|depth of hole/, [0, 45000], 'hole_depth_ft'),
  c('tvd', 'True vertical depth (TVD)', 'Depth', 'number', 'depth', /tvd|true vert\w*( depth)?/, [0, 45000], 'tvd_ft'),
  c('md', 'Measured depth (MD)', 'Depth', 'number', 'depth', /^(md|m d|measured depth|depth|depth md|md depth|(current|present|midnight|end|today'?s?) depth( md)?|depth (at )?(midnight|24 ?00|report time)|mdepth)$/, [0, 45000], 'md_ft'),
  c('depth_from', 'Interval start depth', 'Depth', 'number', 'depth', /^(depth (from|start|top)|from depth|start depth|top depth|md from|from md|start md|(previous|start|morning|06 ?00) depth|depth (at )?(start|06 ?00|00 ?00))$/, [0, 45000]),
  c('depth_to', 'Interval end depth', 'Depth', 'number', 'depth', /^(depth (to|end|bottom|base)|to depth|end depth|bottom depth|base depth|md to|to md|end md)$/, [0, 45000]),
  c('depth_in', 'Depth in (run)', 'Depth', 'number', 'depth', /depth in$|^in depth$/, [0, 45000]),
  c('depth_out', 'Depth out (run)', 'Depth', 'number', 'depth', /depth out$|^out depth$/, [0, 45000]),
  // ---- performance
  c('rop_avg', 'Average ROP', 'Performance', 'number', 'rop', /(avg|average|mean|daily|overall|net|gross)\w* (rop|rate of pen\w*|drilling rate)|rop (avg|average|mean)|^arop$/, [0, 1000]),
  c('rop_inst', 'Instantaneous ROP', 'Performance', 'number', 'rop', /(inst\w*|on ?bottom|current) rop|rop (inst\w*|on ?bottom)/, [0, 2000]),
  c('rop', 'ROP', 'Performance', 'number', 'rop', /^rop$|rate of pen\w*|penetration rate|drill(ing)? rate/, [0, 2000], 'rop_fph'),
  c('footage', 'Footage drilled', 'Performance', 'number', 'depth', /footage( drilled)?|progress|meterage|drilled (today|interval|length|footage|in 24)|interval drilled|daily (drilled|footage|progress)|24 ?h\w* (progress|footage)/, [0, 6000]),
  // ---- time accounting
  c('drilling_hours', 'Drilling hours', 'Time', 'number', 'hours', /drill\w* (h\w*|time)|drlg (h\w*|time)|on ?bottom (h\w*|time)/, [0, 24], 'drilling_hours'),
  c('rotating_hours', 'Rotating hours', 'Time', 'number', 'hours', /rotat\w* (h\w*|time)|^rot h\w*/, [0, 24]),
  c('operating_hours', 'Operating hours', 'Time', 'number', 'hours', /operat\w* (h\w*|time)/, [0, 24]),
  c('npt', 'NPT', 'Time', 'number', 'hours', /\bnpt\b|non ?productive( time)?|down ?time|lost time/, [0, 24], 'npt_hours'),
  c('connection_time', 'Connection time', 'Time', 'number', 'minutes', /conn\w* (time|min\w*|h\w*)/, [0, 600], 'connection_time_min'),
  c('circ_hours', 'Circulating time', 'Time', 'number', 'hours', /circ\w* (h\w*|time)/, [0, 24], 'circulating_hours'),
  c('tripping_hours', 'Tripping time', 'Time', 'number', 'hours', /trip\w* (h\w*|time)/, [0, 24]),
  // ---- drilling parameters
  c('wob', 'WOB', 'Drilling', 'number', 'force', /\bwob\b|weight on bit/, [0, 150], 'wob_klb'),
  c('rpm', 'RPM', 'Drilling', 'number', 'none', /\brpm\b|rotary speed|rotary rpm|string rpm|surface rpm/, [0, 400], 'rpm'),
  c('torque', 'Torque', 'Drilling', 'number', 'torque', /torque|^tq\b|^trq\b/, [0, 60000], 'torque_ftlb'),
  c('diff_pressure', 'Differential pressure', 'Drilling', 'number', 'pressure', /diff\w*\.? ?p(ress\w*)?$|delta p|^dp$|differential( pressure)?/, [0, 3000], 'diff_pressure_psi'),
  c('spp', 'Standpipe pressure (SPP)', 'Drilling', 'number', 'pressure', /\bspp\b|stand ?pipe( pressure)?|pump press\w*|circ\w* press\w*/, [0, 8000], 'spp_psi'),
  c('flow', 'Flow rate', 'Drilling', 'number', 'flow', /flow ?(rate| in)?$|pump (rate|output)|^gpm$|flow rate/, [0, 2500], 'flow_gpm'),
  c('hook_load', 'Hook load', 'Drilling', 'number', 'force', /hook ?load|^hkld/, [0, 1500], 'hook_load_klb'),
  c('ecd', 'ECD', 'Mud', 'number', 'density', /\becd\b|equiv\w* circ\w*( density)?/, [6, 25]),
  c('egt', 'EGT', 'Drilling', 'number', 'none', /\begt\b|exhaust gas( temp\w*)?/),
  c('mud_weight', 'Mud weight', 'Mud', 'number', 'density', /mud ?(weight|wt|dens\w*)|^mw( in| out)?$|^density$|^m\.? ?wt$/, [6, 25], 'mud_weight_ppg'),
  // ---- geology / well construction
  c('formation', 'Formation', 'Geology', 'text', 'none', /^(formation|fm|formation name|geolog\w*( layer)?|layer|zone|stratigraph\w*)( name)?$/, undefined, 'formation_name'),
  c('lithology', 'Lithology', 'Geology', 'text', 'none', /lith\w*|rock type/),
  // "Top Depth" / "Bottom Depth" in an operations table are the interval depths (depth_from / depth_to), not formation tops
  c('fm_top', 'Formation top', 'Geology', 'number', 'depth', /^((formation|fm) top( md| depth)?|top( md)?|top of formation|md top|formation top)$/, [0, 45000]),
  c('fm_bottom', 'Formation bottom', 'Geology', 'number', 'depth', /^((formation|fm) (bottom|base)( md| depth)?|bottom( md)?|base( md)?|md bottom|base of formation)$/, [0, 45000]),
  c('casing_shoe', 'Casing shoe', 'Geology', 'number', 'depth', /shoe( depth| md)?$|casing (depth|point|set\w*)|last casing/, [0, 45000]),
  c('hole_section', 'Hole section', 'Geology', 'text', 'none', /^(hole section|section|phase|interval name|borehole section|bore ?hole size|section size|hole section size|wellbore section)$/),
  c('hole_size', 'Hole size', 'Geology', 'number', 'diameter', /hole (size|dia\w*)|bit (size|dia\w*)|^size$/, [3, 40], 'hole_size_in'),
  c('bha', 'BHA number', 'Geology', 'number', 'none', /\bbha( no| number| run| #)?$/, [0, 99], 'bha_number'),
  // ---- operations
  c('npt_flag', 'Productive / NPT class', 'Operations', 'text', 'none', /^(class|classification|time class\w*|time ?code|time type|p\/?npt|pt\/?npt|npt\??|npt flag|productive( time)?( flag)?|type of time|prod\w* ?\/ ?(npt|non\w*))$/),
  c('npt_category', 'NPT category', 'Operations', 'text', 'none', /^(category|npt (type|category|categ\w*|code|cause|class)|cause|problem type|event type|npt categ\w*)$/),
  c('npt_subcategory', 'NPT sub-category', 'Operations', 'text', 'none', /^((npt )?sub ?categ\w*|npt sub ?(type|code|cause)|sub ?cause|npt detail)$/),
  c('npt_vendor', 'NPT responsible party', 'Operations', 'text', 'none', /^(npt (vendor|responsible|party|company|owner)|responsible( party| company)?|vendor|accountable( party)?)$/),
  c('activity', 'Drilling activity', 'Operations', 'text', 'none', /^(activity|activity code|op\w* code|code|rig state|rig activity|operation type|main op\w*|major op\w*|phase code)$/, undefined, 'activity'),
  c('operation', 'Operation / task', 'Operations', 'text', 'none', /^(task|task code|sub ?code|sub ?activity|sub ?op\w*|operation|op\w* detail|sub ?task|activity detail|minor op\w*)$/),
  c('job', 'Job / phase', 'Operations', 'text', 'none', /^(job|job type|job phase|well phase|event)$/),
  c('corrective', 'Corrective action', 'Operations', 'text', 'none', /corrective( actions?)?|actions? taken|remed\w*|mitigation|resolution/),
  c('problem', 'Problems encountered', 'Operations', 'text', 'none', /problems?( encountered| description)?$|issues?$|incidents?$|troubles?$|events?$/, undefined, 'problem_text'),
  c('description', 'Operations description', 'Operations', 'text', 'none', /descr\w*|^operations?( summary| details?| performed)?$|daily operations|24 ?h\w* (summary|operations)|remarks?|comments?|^summary$|^details$|narrative|activity (details|description)|work performed/),
  // ---- survey
  c('inc', 'Inclination', 'Survey', 'number', 'none', /^(inc\w*|angle|drift|hole angle|dev\w*)$/, [0, 180]),
  c('azi', 'Azimuth', 'Survey', 'number', 'none', /^(azi\w*|az|direction|hole direction)$/, [0, 360]),
];
export const CONCEPT: Record<string, Concept> = Object.fromEntries(CONCEPTS.map(x => [x.key, x]));

/** Parameters reported in the extraction summary, in display order. */
export const CHECKLIST = ['md', 'tvd', 'bit_depth', 'hole_depth', 'footage', 'rop', 'rop_avg', 'rop_inst', 'drilling_hours', 'rotating_hours', 'npt', 'connection_time', 'circ_hours', 'tripping_hours',
  'wob', 'rpm', 'torque', 'spp', 'diff_pressure', 'flow', 'mud_weight', 'hook_load', 'ecd', 'egt', 'formation', 'lithology', 'casing_shoe', 'hole_size', 'bha', 'activity', 'description', 'problem', 'corrective'];

export const normLabel = (s: unknown) => String(s ?? '').toLowerCase().replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/[^a-z0-9/#%'.]+/g, ' ').replace(/[.:]+(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();

export interface Classified { concept: Concept; score: number; how: 'learned' | 'dictionary' }
const cache = new Map<string, Classified | null>();

/** Recognise a label. Score reflects how much of the label the matched term covers (0.72 - 0.95). */
export function classify(label: unknown, learned: Record<string, string> = {}): Classified | null {
  const n = normLabel(label);
  if (!n || n.length > 60 || /^[\d\s.,/:-]+$/.test(n)) return null;
  if (learned[n] && CONCEPT[learned[n]]) return { concept: CONCEPT[learned[n]], score: 0.97, how: 'learned' };
  if (cache.has(n)) return cache.get(n)!;
  let best: Classified | null = null;
  for (const x of CONCEPTS) {
    const m = n.match(x.re);
    if (!m) continue;
    const score = 0.72 + 0.23 * Math.min(1, m[0].length / n.length);
    if (!best || score > best.score) best = { concept: x, score, how: 'dictionary' };
  }
  cache.set(n, best);
  return best;
}

/** Unit written in a header ("MD (m)", "ROP ft/hr") and the dimension it belongs to. */
export function headerUnit(header: string): { unit: string; dim: Dim } | null {
  for (const dim of Object.keys(UNITS) as Dim[]) {
    if (dim === 'none') continue;
    const unit = detectUnit(header, dim);
    if (unit) return { unit, dim };
  }
  return null;
}
const SAME_DIM: Partial<Record<Dim, Dim[]>> = { hours: ['hours', 'minutes'], minutes: ['minutes', 'hours'] };
export const dimCompatible = (concept: Dim, unit: Dim) => concept === unit || (SAME_DIM[concept] ?? []).includes(unit);

/** Guess concepts for an unlabelled / unknown column from its unit and values (always "suspected"). */
export function suggestFromData(header: string, values: number[]): Concept[] {
  const u = headerUnit(header);
  const cands = CONCEPTS.filter(x => x.kind === 'number' && x.range && (u ? dimCompatible(x.dim, u.dim) : true));
  if (!values.length) return u ? cands.slice(0, 4) : [];
  const scored = cands.map(x => {
    const k = u && UNITS[x.dim]?.[u.unit] ? UNITS[x.dim][u.unit] : 1;
    const ok = values.filter(v => v * k >= x.range![0] && v * k <= x.range![1]).length / values.length;
    return { x, ok: ok - (x.range![1] - x.range![0]) / 1e7 };   // prefer the tighter range on ties
  }).filter(s => s.ok > 0.9);
  return (u ? scored : scored.filter(() => false)).sort((a, b) => b.ok - a.ok).slice(0, 4).map(s => s.x);
}
