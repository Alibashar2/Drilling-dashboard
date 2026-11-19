// Layer 4 - narrative understanding. Deterministic extraction of drilled intervals, ROP, durations, problems,
// formations, corrective actions and the rig activity from free-text operations descriptions.
// Rules of evidence:
//   - a duration is NPT only when the text says so (NPT / non-productive / downtime / lost time);
//   - waiting, repairs, stuck pipe etc. are NPT *candidates* that an engineer must accept;
//   - a problem found in text is a *suspected* problem, never a confirmed one;
//   - planned / forecast text is never read as actual operations;
//   - "no losses", "without drag" and similar negations are not problems.
import { mToFt } from '../../lib/units';

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const DUNIT = String.raw`\s*(ft|feet|foot|'|m|mtrs?|meters?|metres?)?(?![a-z])`;
const num = (s: string) => Number(s.replace(/,/g, ''));
const unitOf = (u: string | undefined): 'ft' | 'm' | null => (!u ? null : /^(m|mtrs?|meters?|metres?)$/i.test(u) ? 'm' : 'ft');

export interface Interval { from: number; to: number; unit: 'ft' | 'm' | null; kind: 'drill' | 'ream' | 'trip' | 'other'; conf: number }
export interface DurationFact { hours: number; npt: 'explicit' | 'candidate' | 'problem-related' | 'none'; phrase: string }
export interface ProblemFact { category: string; label: string; negated: boolean; sentence: string; conf: number }
export interface NarrativeFacts {
  text: string; planned: boolean;
  intervals: Interval[];
  rop: { value: number; unit: 'ft/h' | 'm/h' | null; kind: 'average' | 'instantaneous' | 'unspecified'; conf: number } | null;
  durations: DurationFact[];
  problems: ProblemFact[];
  formation: { name: string; conf: number } | null;
  actions: string[];
  activity: string | null;
  depths: { value: number; unit: 'ft' | 'm' | null }[];
}

const PROBLEMS: [RegExp, string, string][] = [
  // "No Return @ 1765 m" is total losses; "no return between CSG & DP" (stinger seal) or "No return, float holding" (float check) is not
  [/total loss(es)?|complete loss(es)?|no returns?\b(?=[^.;,]{0,25}(?:@|\bat\b)\s*\d)|lost (all|total) returns/i, 'LOST_CIRC', 'Total Lost Circulation'],
  [/seepage loss(es)?|minor loss(es)?/i, 'MUD_LOSS', 'Seepage Mud Losses'],
  [/partial loss(es)?/i, 'LOST_CIRC', 'Partial Lost Circulation'],
  [/severe loss(es)?/i, 'LOST_CIRC', 'Severe Lost Circulation'],
  // "DHL: 2 m3/hr", "downhole losses: 4 m3/hr", "losses rate: 10 m3/hr" - reported losses with a rate
  [/\bdhl\b(?:\s*rate)?\s*(?:[:=]|increased|of|\d)|down ?hole loss(es)?|loss(es)? rate|observe[ds]? loss(es)?/i, 'MUD_LOSS', 'Downhole Mud Losses'],
  [/lost circ\w*|loss(es)? (of|to) (circulation|formation|returns)|mud loss(es)?|(?<!total |cement |pressure |heat |weight )\bloss(es)?\b(?! of (pressure|weight|signal|power))|losing mud|lost returns/i, 'LOST_CIRC', 'Lost Circulation'],
  [/diff\w*[- ]?st(uck|icking)/i, 'DIFF_STICK', 'Differential Sticking'],
  [/mech\w*[- ]?st(uck|icking)|stuck pipe|pipe (got |became )?stuck|string (got |became )?stuck|\bgot stuck\b/i, 'MECH_STICK', 'Stuck Pipe'],
  [/pack(ed|ing)?[- ]?off/i, 'PACK_OFF', 'Pack-Off'],
  [/tight (hole|spot)s?|over ?pull/i, 'TIGHT_HOLE', 'Tight Hole'],
  [/cavings?|slough\w*|(wellbore|hole|borehole) instab\w*|hole collapse|unstable (hole|shale)/i, 'INSTABILITY', 'Wellbore Instability'],
  [/(poor|bad|inadequate) hole clean\w*|hole clean\w* (problem|issue)s?|cuttings bed/i, 'HOLE_CLEAN', 'Hole Cleaning Problem'],
  [/twist(ed)?[- ]?off|(?<!wash up \/ |wash up and )(pipe|string|dp|drill pipe) wash(ed)?[- ]?out|wash(ed)?[- ]?out (in|on) (the )?(pipe|string|dp)|parted (string|pipe)|pipe (failure|parted)/i, 'PIPE_FAIL', 'Pipe Failure'],
  [/(mwd|lwd|motor|bha|rss|tool|bit) (fail\w*|malfunction\w*|problem|stopped pulsing|signal (loss|issues?|problems?))|signal (issues?|problems?|loss)|bit[^.;]{0,40}(ring ?out|blades? damaged|broken|lost cutters|damaged)|blades? damaged/i, 'BHA_FAIL', 'BHA / Tool Failure'],
  [/(high|excessive|erratic|increas\w*) (torque|drag)|torque (and|&) drag|observed drag|\bdrag (@|at) \d/i, 'TORQUE_DRAG', 'Excessive Torque and Drag'],
  [/(?<!\bdrills?\b[^.;\n]*)\bkick\b(?![^.;\n]*\bdrills?\b)(?!\s+(test|tolerance|sheet))|influx|well flow(ing|ed)|pit gain|gas cut mud|well (was )?not static/i, 'PRESSURE', 'Unexpected Pressure / Influx'],
  [/(low|slow|poor|reduced) rop|rop (decreas\w*|dropped|reduced) to/i, 'LOW_ROP', 'Slow Drilling / Low ROP'],
  [/(sever\w*|high|strong)? ?vibrations?|string bouncing|stick[- ]?slip|bit bounc\w*|whirl/i, 'VIBRATION', 'Drilling Vibrations'],
  [/(?<!anti[- ])\bball(ed|ing)\b(?! pill)|balled up/i, 'BIT_BALLING', 'Bit / BHA Balling'],
];
// Safety meetings and briefings describe hazards, they are not events
const BRIEFING = /^(\*+\s*)?(-\s*)?(discussed|tofs|pjsm|hpjsm|hold(ing)? pjsm|toolbox|safety (meeting|talk|moment)|remind\w*|conducted (tofs|safety)|assign\w* responsibilit\w*|emphasi[sz]\w*|the importance of|mention\w*)\b|\b(discussed|safety meeting|safety moment|pre[- ]job safety|drill briefing)\b/i;
const NEGATION = /\b(no|not|nil|none|without|zero|free of|no sign of|no indication of)\b[^.;,]{0,28}$/i;
const NPT_EXPLICIT = /\bnpt\b|non[- ]?productive|down ?time|lost time/i;
const NPT_CANDIDATE = /wait(ed|ing)? (on|for)|\bw\.?o\.?[wcoe]\b|\bwo[wcoe]\b|rig repair|repair(ed|ing)?|stuck|fishing|\bfish\b|troubleshoot\w*|break ?down|shut ?down|standby|stand by|suspend\w*/i;
const PLANNED = /\b(plan(ned)?|will|forecast|next 24|look ?ahead|program(me)?d?|to be|intend\w*|expect(s|ed|ing)?|anticipat\w*|proposed|forward plan)\b/i;
const ACTION = /(pump(ed|ing)?[^.;]{0,40}(lcm|pill|sweep)|spot(ted|ting)?[^.;]{0,40}pill|treat(ed|ing)? [^.;]{3,60}|cur(ed|ing) [^.;]{3,40}|(increas|rais|reduc|lower|decreas)(ed|ing) (the )?(mud weight|mw|flow rate|flow|rop|rpm|wob)[^.;]{0,40}|work(ed|ing)? (the )?(pipe|string)[^.;]{0,40}|jarr(ed|ing)[^.;]{0,40}|back[- ]?ream(ed|ing)?[^.;]{0,40}|ream(ed|ing) [^.;]{3,40}|circulat(ed|ing) [^.;]{0,20}(clean|bottoms?[- ]up)[^.;]{0,30}|wiper trip[^.;]{0,30}|set (a )?cement plug[^.;]{0,30}|add(ed|ing)? lubricant[^.;]{0,30}|condition(ed|ing)? mud[^.;]{0,30})/gi;
const ACTIVITY: [RegExp, string][] = [
  [/\bslid(e|ing)?\b|\bslide drill/i, 'SLD'], [/\bdrill(ed|ing)?\b(?! ?(out|pipe|string|collar|floor|crew))|\bdrlg\b|rotary drill|\bcor(ed|ing)\b/i, 'ROT'],
  [/\bconnection\b|\bconn\b/i, 'CON'], [/\b(back[- ]?)?ream(ed|ing)?\b|\bwash(ed|ing)? (down|to)\b/i, 'REA'],
  [/\b(pooh|rih|tih|toh|trip(ped|ping)?|pull(ed|ing)? out|run(ning)? in|ran in|pull(ed)? (to|out)|l\/d|lay(ing)? down|p\/u|pick(ed|ing)? up|make up|m\/u|wiper)\b/i, 'TRP'],
  [/\bcirc(ulat\w*)?\b|\bcbu\b|condition(ed|ing)? (mud|hole)|bottoms[- ]up/i, 'CIR'],
  [/wait(ed|ing)? (on|for)|\bwo[wcoe]\b|repair|stuck|fishing|standby|shut ?down|break ?down/i, 'WOO'],
  [/casing|cement|\bbop\b|nipple|logging|wireline|test(ed|ing)?|rig (up|down)|safety|meeting|service/i, 'OTH'],
];

/** First activity keyword in the text decides the rig state; an explicit code column takes precedence upstream. */
export function activityFromText(text: string): string | null {
  let best: { i: number; code: string } | null = null;
  for (const [re, code] of ACTIVITY) { const m = re.exec(text); if (m && (!best || m.index < best.i)) best = { i: m.index, code }; }
  return best?.code ?? null;
}

export function analyzeNarrative(raw: string, knownFormations: string[] = [], forcePlanned = false): NarrativeFacts {
  const text = raw.replace(/\s+/g, ' ').trim();
  const facts: NarrativeFacts = { text, planned: forcePlanned, intervals: [], rop: null, durations: [], problems: [], formation: null, actions: [], activity: null, depths: [] };
  // lines, "- " list items and sentences are separate statements (a negation in one never applies to the next)
  const split = (s: string) => s.split(/\r?\n+|(?<=[.;])\s+(?=[A-Z0-9*])|\s+-\s+(?=[A-Za-z*])/).map(x => x.replace(/\s+/g, ' ').replace(/^[-*•\s]+/, '').trim()).filter(Boolean);
  const sentences = split(String(raw));
  // a safety moment / TOFS / PJSM paragraph talks about hazards ("monitor the well for losses and gain"): none of it is an event
  const briefing = new Set<string>();
  for (const block of String(raw).split(/\r?\n\s*\r?\n/)) { const ss = split(block); if (ss.length && (BRIEFING.test(ss[0]) || /safety moment|toolbox talk|\btofs\b|\bpjsm\b/i.test(ss[0]))) ss.forEach(x => briefing.add(x)); }
  const actual = sentences.filter(s => !PLANNED.test(s) || /\b(drilled|circulated|pumped|tripped|reamed|spent|experienced|observed|lost)\b/i.test(s));
  if (!forcePlanned && sentences.length && !actual.length) facts.planned = true;
  if (facts.planned) return facts;
  const body = actual.join(' ');
  facts.activity = activityFromText(body);

  // drilled / reamed / tripped intervals: "from 8,420 ft to 8,510 ft", "f/ 8420' t/ 8510'", "8,420 - 8,510 ft"
  const iv = new RegExp(String.raw`(?:\b(?:from|f\/|fr)\s*)${NUM}${DUNIT}\s*(?:to|t\/|-|–|—|until)\s*${NUM}${DUNIT}|\b${NUM}${DUNIT}\s*(?:-|–|—|to)\s*${NUM}\s*(ft|feet|'|m|mtrs?|meters?|metres?)(?![a-z])`, 'gi');
  for (const m of body.matchAll(iv)) {
    const a = num(m[1] ?? m[5]), b = num(m[3] ?? m[7]), unit = unitOf(m[4] ?? m[2] ?? m[8] ?? m[6]);
    if (!(a >= 0) || !(b > 0) || a === b || Math.max(a, b) < 30) continue;
    const before = body.slice(Math.max(0, m.index! - 70), m.index!).toLowerCase();
    const kind: Interval['kind'] = /ream|wash/.test(before) ? 'ream' : /pooh|rih|tih|toh|trip|pull|run in|ran in|wiper|lay|l\/d/.test(before) ? 'trip' : /drill|drlg|slid|rotat|cor(ed|ing)|sidetrack|made hole/.test(before) ? 'drill' : 'other';
    facts.intervals.push({ from: a, to: b, unit, kind, conf: m[1] ? 0.93 : 0.82 });
  }
  // single depths: "at 8,450 ft", "to 8,510 ft", "@ 8450'"
  for (const m of body.matchAll(new RegExp(String.raw`(?:\bat|@|\bto|\bdepth of)\s*${NUM}\s*(ft|feet|'|m|mtrs?|meters?)(?![a-z])`, 'gi')))
    facts.depths.push({ value: num(m[1]), unit: unitOf(m[2]) });

  // ROP: "average ROP of 45 ft/hr", "ROP 45 fph", "at 45 ft/hr"
  const rop = new RegExp(String.raw`((?:avg\.?|average|aver\.?|mean|inst\w*|on[- ]bottom)\s+)?\brop\b\s*(?:of|=|:|@|was|at|around|approx\.?|~)?\s*${NUM}\s*(ft\/hr?|fph|ft\/hour|m\/hr?|m\/hour|mph)?|\bat\s+${NUM}\s*(ft\/hr?|fph|m\/hr?)\b`, 'i').exec(body);
  if (rop) {
    const u = rop[3] ?? rop[5];
    facts.rop = {
      value: num(rop[2] ?? rop[4]), unit: !u ? null : /^m/i.test(u) ? 'm/h' : 'ft/h',
      kind: rop[1] ? (/inst|bottom/i.test(rop[1]) ? 'instantaneous' : 'average') : 'unspecified', conf: u ? 0.93 : 0.8,
    };
  }

  // problems (with negation)
  for (const s of actual) {
    if (BRIEFING.test(s) || briefing.has(s)) continue;
    const seen = new Set<string>();
    for (const [re, category, label] of PROBLEMS) {
      const m = re.exec(s);
      const family = category === 'LOST_CIRC' || category === 'MUD_LOSS' ? 'losses' : category;   // one losses problem per statement
      if (!m || seen.has(family)) continue;
      seen.add(family);
      const negated = NEGATION.test(s.slice(0, m.index));
      facts.problems.push({ category, label, negated, sentence: s, conf: negated ? 0.9 : /experienc|encounter|observ|suffer|had |occur|got |lost/i.test(s) ? 0.8 : 0.65 });
    }
  }
  const hasProblem = facts.problems.some(p => !p.negated);

  // durations and what they mean
  for (const m of body.matchAll(new RegExp(String.raw`${NUM}\s*(hours?|hrs?|hr|h|minutes?|mins?|min)\b`, 'gi'))) {
    const hours = /^m/i.test(m[2]) ? num(m[1]) / 60 : num(m[1]);
    if (!(hours > 0) || hours > 72) continue;
    // "Daily Jar hours: 12.15 hr" is a labelled counter, not the duration of an event
    if (/[:=]\s*$/.test(body.slice(Math.max(0, m.index! - 3), m.index!))) continue;
    const ctx = body.slice(Math.max(0, m.index! - 90), m.index! + m[0].length + 90);
    const npt: DurationFact['npt'] = NPT_EXPLICIT.test(ctx) ? 'explicit' : NPT_CANDIDATE.test(ctx) ? 'candidate' : hasProblem && PROBLEMS.some(([re]) => re.test(ctx)) ? 'problem-related' : 'none';
    facts.durations.push({ hours, npt, phrase: ctx.trim() });
  }

  // formation: known names first, then "Formation X" / "<Name> Formation|Shale|Sandstone..."
  const lower = body.toLowerCase();
  const kn = knownFormations.filter(f => f.length >= 3 && lower.includes(f.toLowerCase())).sort((a, b) => b.length - a.length)[0];
  if (kn) facts.formation = { name: kn, conf: 0.95 };
  else {
    const m = /\b(?:in|into|through|entered|top of|within|across|penetrated)\s+(?:the\s+)?(Formation\s+[A-Z0-9][\w-]*|(?:[A-Z][\w'-]+\s){1,2}(?:Formation|Fm\.?|Shale|Sandstone|Limestone|Carbonate|Dolomite|Anhydrite|Salt|Sand|Sst\.?|Lst\.?))/.exec(body);
    if (m) facts.formation = { name: m[1].trim(), conf: 0.75 };
  }

  if (hasProblem) for (const m of body.matchAll(ACTION)) { const a = m[0].trim().replace(/^(and|then)\s+/i, ''); if (!facts.actions.some(x => x.toLowerCase() === a.toLowerCase())) facts.actions.push(a.charAt(0).toUpperCase() + a.slice(1)); }
  return facts;
}

/** Convert a narrative depth to feet using its own unit, or the report's default when none is written. */
export const toFt = (v: number, unit: 'ft' | 'm' | null, fallback: 'ft' | 'm') => ((unit ?? fallback) === 'm' ? mToFt(v) : v);
