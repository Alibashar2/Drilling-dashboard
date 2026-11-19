// Drilling and well-construction operations: catalogue, categories and the classifier that names an operation
// from what the daily report actually says (task code, phase, operation text). When the report does not say
// enough, the operation is "Not specified in report" - it is never guessed - and an engineer can correct it.

export const OP_CATEGORIES = ['Drilling', 'Tripping', 'Casing', 'Cementing', 'Logging', 'Well Control', 'Maintenance', 'NPT', 'Other Operations'] as const;
export type OpCategory = (typeof OP_CATEGORIES)[number];
export const CATEGORY_COLOR: Record<OpCategory, string> = {
  Drilling: '#16a34a', Tripping: '#3b82f6', Casing: '#8b5cf6', Cementing: '#a8a29e', Logging: '#0ea5c4',
  'Well Control': '#f59e0b', Maintenance: '#64748b', NPT: '#e11d48', 'Other Operations': '#475569',
};

export interface OpType { code: string; name: string; category: OpCategory; activity: string }
const o = (code: string, name: string, category: OpCategory, activity: string): OpType => ({ code, name, category, activity });

/** `activity` is the rig-state code used by the KPIs (ROT, SLD, CON, TRP, CIR, REA, WOO, OTH). */
export const OP_TYPES: OpType[] = [
  // A. drilling
  o('DRL_ROT', 'Drilling Rotary', 'Drilling', 'ROT'), o('DRL_SLD', 'Drilling Slide', 'Drilling', 'SLD'), o('DRL_AHEAD', 'Drilling Ahead', 'Drilling', 'ROT'),
  o('REAM', 'Reaming', 'Drilling', 'REA'), o('BACKREAM', 'Back Reaming', 'Drilling', 'REA'), o('CIRC', 'Circulating', 'Drilling', 'CIR'),
  o('HOLE_CLEAN', 'Hole Cleaning', 'Drilling', 'CIR'), o('CONN', 'Connection', 'Drilling', 'CON'), o('CONDITION', 'Wellbore Conditioning', 'Drilling', 'CIR'),
  o('LC_TREAT', 'Lost Circulation Treatment', 'Drilling', 'CIR'), o('MUD_COND', 'Mud Conditioning', 'Drilling', 'CIR'), o('MW_ADJUST', 'Mud Weight Adjustment', 'Drilling', 'CIR'),
  // tripping
  o('WIPER', 'Wiper Trip', 'Tripping', 'TRP'), o('SHORT_TRIP', 'Short Trip', 'Tripping', 'TRP'), o('TRIP_IN', 'Tripping In', 'Tripping', 'TRP'), o('TRIP_OUT', 'Tripping Out', 'Tripping', 'TRP'),
  o('MU_BHA', 'Making Up BHA', 'Tripping', 'TRP'), o('BO_BHA', 'Breaking Out BHA', 'Tripping', 'TRP'), o('PU_LD_DP', 'Picking Up / Laying Down Drill Pipe', 'Tripping', 'TRP'),
  o('SLUG', 'Pumping Slug', 'Tripping', 'CIR'),
  // logging
  o('SURVEY', 'Surveying', 'Logging', 'OTH'), o('MWD', 'Measurement While Drilling (MWD)', 'Logging', 'OTH'), o('LWD', 'Logging While Drilling (LWD)', 'Logging', 'OTH'),
  o('WL_LOG', 'Wireline Logging', 'Logging', 'OTH'),
  // B. casing
  o('CSG_RUN', 'Casing Running', 'Casing', 'OTH'), o('LNR_RUN', 'Liner Running', 'Casing', 'OTH'), o('CSG_CONN', 'Casing Connection', 'Casing', 'OTH'),
  o('CSG_CIRC', 'Casing Circulation', 'Casing', 'CIR'), o('CSG_FILL', 'Casing Filling', 'Casing', 'OTH'), o('CSG_LAND', 'Casing Landing', 'Casing', 'OTH'),
  o('CSG_SET', 'Casing Setting', 'Casing', 'OTH'), o('CSG_TEST', 'Casing Testing', 'Casing', 'OTH'), o('PT_CSG', 'Pressure Testing Casing', 'Casing', 'OTH'),
  o('SHOE_DRILL', 'Casing Shoe Drilling', 'Casing', 'OTH'), o('DO_CMT', 'Drill Out Cement', 'Casing', 'OTH'), o('DO_FLOAT', 'Drill Out Float Equipment', 'Casing', 'OTH'),
  // C. cementing
  o('CMT_PREP', 'Cementing Preparation', 'Cementing', 'OTH'), o('CMT_MIX', 'Cement Mixing', 'Cementing', 'OTH'), o('CMT_PUMP', 'Cement Pumping', 'Cementing', 'OTH'),
  o('SPACER', 'Spacer Pumping', 'Cementing', 'OTH'), o('CMT_LEAD', 'Lead Cement Pumping', 'Cementing', 'OTH'), o('CMT_TAIL', 'Tail Cement Pumping', 'Cementing', 'OTH'),
  o('DISPLACE', 'Displacement', 'Cementing', 'OTH'), o('BUMP', 'Bumping Plug', 'Cementing', 'OTH'), o('WOC', 'Waiting on Cement (WOC)', 'Cementing', 'OTH'),
  o('REV_CIRC', 'Reverse Circulation', 'Cementing', 'CIR'), o('CMT_EVAL', 'Cement Evaluation', 'Cementing', 'OTH'), o('CBL', 'Cement Bond Logging (CBL)', 'Cementing', 'OTH'),
  // D. well control and other
  o('BOP_INST', 'BOP Installation', 'Well Control', 'OTH'), o('BOP_REMOVE', 'BOP Removal', 'Well Control', 'OTH'), o('BOP_TEST', 'BOP Testing', 'Well Control', 'OTH'),
  o('WELLHEAD', 'Wellhead Installation', 'Well Control', 'OTH'), o('PRESS_TEST', 'Pressure Testing', 'Well Control', 'OTH'), o('FLOW_CHECK', 'Flow Check', 'Well Control', 'OTH'),
  o('WC_DRILL', 'Well Control Drill', 'Well Control', 'OTH'), o('WELL_CONTROL', 'Well Control Operations', 'Well Control', 'WOO'),
  o('STUCK_TREAT', 'Stuck Pipe Treatment', 'Other Operations', 'WOO'), o('FISHING', 'Fishing Operations', 'Other Operations', 'WOO'),
  o('RIG_MAINT', 'Rig Maintenance', 'Maintenance', 'OTH'), o('RIG_REPAIR', 'Rig Repair', 'Maintenance', 'WOO'), o('SLIP_CUT', 'Slip and Cut Drilling Line', 'Maintenance', 'OTH'),
  o('WAIT_EQUIP', 'Waiting on Equipment', 'NPT', 'WOO'), o('WAIT_WEATHER', 'Waiting on Weather', 'NPT', 'WOO'), o('WAIT_INSTR', 'Waiting on Instructions', 'NPT', 'WOO'),
  o('WAIT', 'Waiting (reason not stated)', 'NPT', 'WOO'), o('NPT', 'NPT', 'NPT', 'WOO'),
  o('RIG_UPDOWN', 'Rig Up / Rig Down Equipment', 'Other Operations', 'OTH'), o('SAFETY', 'Safety Meeting', 'Other Operations', 'OTH'), o('WEAR_BUSHING', 'Wear Bushing Run / Retrieval', 'Other Operations', 'OTH'),
  o('COMPLETION', 'Completion Operations', 'Other Operations', 'OTH'), o('HOUSEKEEPING', 'Rig Floor Housekeeping', 'Other Operations', 'OTH'),
  o('OTHER', 'Other Operations', 'Other Operations', 'OTH'), o('UNSPECIFIED', 'Not specified in report', 'Other Operations', 'OTH'),
];
export const OP_TYPE: Record<string, OpType> = Object.fromEntries(OP_TYPES.map(x => [x.code, x]));

export interface OpClass { code: string; basis: 'task code' | 'operation text' | 'insufficient information' | 'engineer'; confidence: number; steps: string[] }

/** Cementing steps stated in an operation's text (they share the operation's time; the report gives no separate times). */
export function cementSteps(text: string): string[] {
  const s = text.toLowerCase(), out: string[] = [];
  if (/\bmix(ed|ing)?\b/.test(s)) out.push('Cement Mixing');
  if (/spacer|scavenger|mudpush|pre-?flush|chemical wash/.test(s)) out.push('Spacer Pumping');
  if (/\blead\b/.test(s)) out.push('Lead Cement Pumping');
  if (/\btail\b/.test(s)) out.push('Tail Cement Pumping');
  if (/displac/.test(s)) out.push('Displacement');
  if (/bump(ed)?\s+(the\s+)?plug|plug\s+bumped/.test(s)) out.push('Bumping Plug');
  return out;
}

const T = (re: RegExp, s: string) => re.test(s);
/**
 * Name an operation. `task` is the most specific code the report gives (sub-code / task), `phase` the activity
 * group ("Run casing", "Cement liner"), `text` the operation description. `progress` = the depth columns show new hole.
 */
export function classifyOperation(task: string | null, phase: string | null, text: string, progress: boolean): OpClass {
  const t = (task ?? '').toLowerCase(), p = (phase ?? '').toLowerCase(), head = (text.split(/\r?\n/)[0] ?? '').toLowerCase(), all = text.toLowerCase();
  const r = (code: string, basis: OpClass['basis'] = 'task code', confidence = 0.92): OpClass => ({ code, basis, confidence, steps: code === 'CMT_PUMP' ? cementSteps(text) : [] });
  if (t) {
    // drilling
    if (T(/drill (to depth|ahead)|^drill(ing)?$|drill new hole/, t)) return r(/\bslid/.test(head) ? 'DRL_SLD' : /\brotary\b|\brotat/.test(head) ? 'DRL_ROT' : 'DRL_AHEAD');
    if (T(/drill shoe( track)?/, t)) return r(progress ? 'DRL_AHEAD' : 'SHOE_DRILL');
    if (T(/drill (dual stage|dv|stage) ?(cementing )?tool|drill (float|plug)/, t)) return r('DO_FLOAT');
    if (T(/drill (out )?cement/, t)) return r('DO_CMT');
    if (T(/back ?ream/, t)) return r('BACKREAM');
    if (T(/ream|wash/, t)) return r('REAM');
    if (T(/connection/, t)) return r('CONN');
    if (T(/lost circulation|lcm/, t)) return r('LC_TREAT');
    if (T(/pump slug/, t)) return r('SLUG');
    if (T(/pump pill|spot pill/, t)) return r(/\blcm\b|lost circ|loss/.test(all) ? 'LC_TREAT' : 'HOLE_CLEAN');
    if (T(/condition (drilling )?fluid|condition mud|change fluid/, t)) return r(/(increas|rais|weight(ed)? up|reduc|cut)\w*[^.]{0,30}\b(mw|mud weight)|\b(mw|mud weight)[^.]{0,30}(increas|rais|reduc)/.test(all) ? 'MW_ADJUST' : 'MUD_COND');
    if (T(/circulat\w* (in|out) (casing|liner)|circulate.*prior to cement/, t) || (T(/circulat/, t) && /casing|liner|cement/.test(p))) return r('CSG_CIRC');
    if (T(/condition hole/, t)) return r(/sweep|swept|hi-?vis|hvp|shakers? clean|bottoms? up/.test(all) ? 'HOLE_CLEAN' : 'CONDITION');
    if (T(/reverse circ/, t)) return r(/cement|liner/.test(p) ? 'REV_CIRC' : 'CIRC');
    if (T(/circulat|open circulation sub|close circulation sub/, t)) return r('CIRC');
    // tripping
    if (T(/make up bha|pick up bha|m\/u bha/, t)) return r('MU_BHA');
    if (T(/lay down bha|break out bha|rack back bha/, t)) return r('BO_BHA');
    if (T(/(pick up|lay down) drill ?pipe/, t)) return r('PU_LD_DP');
    if (T(/trip/, t) && /casing|liner/.test(t)) return r(/liner/.test(t + p) ? 'LNR_RUN' : 'CSG_RUN');
    if (T(/trip|pull out of hole|run in hole/, t) && !/wireline|casing|liner|tubing/.test(t)) {
      if (/wiper/.test(all)) return r('WIPER');
      if (/short trip/.test(all)) return r('SHORT_TRIP');
      return r(/out|pull|pooh/.test(t) ? 'TRIP_OUT' : 'TRIP_IN');
    }
    // logging and surveys
    if (T(/survey|checkshot/, t)) return r('SURVEY');
    if (T(/mwd|sht|shallow hole test|roll test/, t)) return r('MWD');
    if (T(/lwd/, t)) return r('LWD');
    if (T(/stuck|free stuck/, t)) return r('STUCK_TREAT');
    if (T(/wireline|log/, t) || /wireline/.test(p)) return r(/\bcbl\b|usit|vdl|cement bond|cement evaluation/.test(all) ? 'CBL' : 'WL_LOG');
    // casing
    if (T(/(make up|run|trip) (in )?(casing|liner)|shoe track|run (in )?casing|make up (dual stage|dv|liner hanger)|run casing other/, t)) return r(/liner/.test(t + p) ? 'LNR_RUN' : 'CSG_RUN');
    if (T(/land casing|casing hanger|set casing slips/, t)) return r('CSG_LAND');
    if (T(/set liner hanger|inflate (casing )?packer|cut casing|cut and dress|final cut/, t)) return r('CSG_SET');
    if (T(/casing integrity|\bcit\b|test liner top|pressure test (casing|liner)/, t)) return r('PT_CSG');
    if (T(/fill (up )?casing|casing fill/, t)) return r('CSG_FILL');
    // cementing
    if (T(/waiting on cement|\bwoc\b/, t)) return r('WOC');
    if (T(/cement job|pump slurry|perform .*cement|squeeze/, t)) return r('CMT_PUMP');
    if (T(/cement head|stinger|sting into|rig up to cement|rig down after cement/, t) || (T(/pressure test surface/, t) && /cement/.test(p))) return r('CMT_PREP');
    // well control and wellhead
    if (T(/nipple up b\.?o\.?p|install b\.?o\.?p/, t)) return r('BOP_INST');
    if (T(/nipple down b\.?o\.?p/, t)) return r('BOP_REMOVE');
    if (T(/test b\.?o\.?p|function test b\.?o\.?p/, t)) return r('BOP_TEST');
    if (T(/wellhead|christmas tree|bell nipple|diverter/, t)) return r(/christmas tree/.test(t) ? 'COMPLETION' : /wellhead/.test(t) ? 'WELLHEAD' : 'RIG_UPDOWN');
    if (T(/flow check/, t)) return r('FLOW_CHECK');
    if (T(/(choke|kick|kill|pit|stripping)\b.*drill|drill.*(choke|kick|kill)/, t)) return r('WC_DRILL');
    if (T(/well control|kill well|shut in/, t)) return r('WELL_CONTROL');
    if (T(/pressure test/, t)) return r('PRESS_TEST');
    if (T(/wear bushing/, t)) return r('WEAR_BUSHING');
    // maintenance and waiting
    if (T(/slip and cut/, t)) return r('SLIP_CUT');
    if (T(/repair/, t)) return r('RIG_REPAIR');
    if (T(/service|maintenance|inspect/, t)) return r('RIG_MAINT');
    if (T(/fishing|fish/, t) || /fishing/.test(p)) return r('FISHING');
    if (T(/wait/, t)) {
      if (/weather|wind|storm|sand ?storm|fog/.test(t + ' ' + all)) return r('WAIT_WEATHER');
      if (/downhole tools?|equipment|tools?|parts|material|truck|service company/.test(t)) return r('WAIT_EQUIP');
      if (/decision|instruction|approval|client|program|orders?/.test(t + ' ' + all)) return r('WAIT_INSTR');
      if (/equipment|tools?|spare|parts/.test(all)) return r('WAIT_EQUIP', 'operation text', 0.75);
      return r('WAIT');
    }
    if (T(/safety|pjsm|stand down/, t)) return r('SAFETY');
    if (T(/rig up|rig down|handling equipment|change out/, t)) return r('RIG_UPDOWN');
    if (T(/clean and tidy|housekeeping/, t)) return r('HOUSEKEEPING');
    if (T(/tubing|completion|kill string/, t) || /completion|kill string/.test(p)) return r('COMPLETION');
    if (T(/\bnpt\b/, t)) return r('NPT');
  }
  // no (usable) task code: the first line of the operation text, with lower confidence
  const x = (code: string) => r(code, 'operation text', 0.72);
  if (/\bslide drill|\bslid(e|ing)\b/.test(head)) return x('DRL_SLD');
  if (/\brotary drill/.test(head)) return x('DRL_ROT');
  if (/^(cont\w*\.? )?(drill(ed|ing)? (ahead|\d|new|from)|drlg)/.test(head) || (/\bdrill(ed|ing)\b/.test(head) && progress)) return x('DRL_AHEAD');
  if (/back ?ream/.test(head)) return x('BACKREAM');
  if (/^(wash|ream)/.test(head)) return x('REAM');
  if (/wiper trip/.test(head)) return x('WIPER');
  if (/^(pooh|pull(ed)? out|trip(ped)? out)/.test(head)) return x('TRIP_OUT');
  if (/^(rih|tih|trip(ped)? in|run in hole)/.test(head)) return x(/csg|casing/.test(head) ? 'CSG_RUN' : /liner/.test(head) ? 'LNR_RUN' : 'TRIP_IN');
  if (/cement(ed|ing)? job|pump(ed)? .*slurry/.test(head)) return x('CMT_PUMP');
  if (/wait(ing)? on cement|\bwoc\b/.test(head)) return x('WOC');
  if (/test(ed)? b\.?o\.?p/.test(head)) return x('BOP_TEST');
  if (/^(circulat|swept|sweep|chc|cbu)/.test(head)) return x('CIRC');
  if (/flow check/.test(head)) return x('FLOW_CHECK');
  if (/wait(ing)? on weather/.test(head)) return x('WAIT_WEATHER');
  if (/fishing/.test(head)) return x('FISHING');
  if (/\blog(ging)?\b|wireline/.test(head)) return x('WL_LOG');
  return { code: 'UNSPECIFIED', basis: 'insufficient information', confidence: 0, steps: [] };
}
