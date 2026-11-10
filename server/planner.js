import { km, driveMinutes, findCity, nearestCity } from './geo.js';

export const VIBES = ['romantic', 'casual', 'playful', 'cozy', 'upscale', 'scenic', 'artsy', 'lively', 'quiet', 'adventurous'];
export const STAGES = ['first-date', 'new-couple', 'long-term', 'parents'];
const DURATION = { dinner: 90, drinks: 60, dessert: 40, activity: 75, outdoors: 60, entertainment: 120 };
const PER_PERSON = [0, 15, 35, 75, 150]; // very rough spend per person by price tier
const STAGE_VIBES = {
  'first-date': ['casual', 'playful'],
  'new-couple': ['romantic', 'playful'],
  'long-term': ['scenic', 'romantic'],
  parents: ['romantic', 'quiet'],
};
const LABEL = { dinner: 'Dinner', drinks: 'Drinks', dessert: 'Dessert', activity: 'Activity', outdoors: 'Outdoors', entertainment: 'Entertainment' };

export const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  return m && +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
};
export const fmtTime = (min) => {
  const m = ((min % 1440) + 1440) % 1440, h = Math.floor(m / 60);
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

// Validates raw input into a planning request. Throws Error with .status = 400 on bad input.
export function normalizeRequest(raw = {}) {
  const fail = (msg) => { throw Object.assign(new Error(msg), { status: 400 }); };
  let city = findCity(raw.city);
  let origin = city;
  if (Number.isFinite(raw.lat) && Number.isFinite(raw.lng)) {
    const near = nearestCity({ lat: raw.lat, lng: raw.lng });
    if (!near) fail('That location is outside the pilot area (Los Angeles, Orange and Ventura counties).');
    city = near;
    origin = { lat: raw.lat, lng: raw.lng };
  }
  if (!city) fail('Pick a city in Los Angeles, Orange or Ventura county.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.date || '')) fail('Pick a date.');
  const start = toMinutes(raw.time);
  if (start == null) fail('Pick a start time.');
  const curfew = raw.homeBy ? toMinutes(raw.homeBy) : null;
  const clamp = (n, lo, hi, d) => (Number.isFinite(+n) ? Math.min(hi, Math.max(lo, Math.round(+n))) : d);
  return {
    city: city.name, county: city.county, origin: { lat: origin.lat, lng: origin.lng },
    date: raw.date, start,
    stops: clamp(raw.stops, 1, 3, 2),
    anchor: raw.anchor === 'activity' ? 'activity' : 'dinner',
    stage: STAGES.includes(raw.stage) ? raw.stage : 'long-term',
    vibes: (Array.isArray(raw.vibes) ? raw.vibes : []).filter((v) => VIBES.includes(v)),
    budget: clamp(raw.budget, 1, 4, 3),
    scale: ['small', 'balanced', 'extravagant'].includes(raw.scale) ? raw.scale : 'balanced',
    noAlcohol: !!raw.noAlcohol,
    // A curfew earlier than the start time means "after midnight".
    curfew: curfew == null ? null : curfew <= start ? curfew + 1440 : curfew,
    maxKm: clamp(raw.maxKm, 5, 80, 25),
    party: clamp(raw.party, 1, 12, 2),
  };
}

function slotsFor(req) {
  const main = ['dinner'];
  if (req.stops === 1) return [req.anchor === 'activity' ? ['activity', 'entertainment', 'outdoors'] : main];
  if (req.stops === 2) return [main, ['dessert', 'drinks', 'entertainment', 'activity', 'outdoors']];
  return [['activity', 'outdoors', 'drinks'], main, ['dessert', 'drinks', 'entertainment']];
}

function score(v, req, ref, trends) {
  const why = [];
  let s = 0;
  const wanted = req.vibes.filter((x) => v.vibes.includes(x));
  s += wanted.length * 3;
  if (wanted.length) why.push(wanted.join(' + '));
  s += STAGE_VIBES[req.stage].filter((x) => v.vibes.includes(x)).length;
  if (req.stage === 'first-date' && v.tags.includes('first-date')) { s += 3; why.push('easy first-date spot'); }
  if (req.stage === 'long-term' && v.tags.includes('novel')) { s += 2; why.push('something different'); }
  if (v.price > req.budget) s -= 4 * (v.price - req.budget);
  else if (req.scale === 'extravagant') s += v.price;
  else if (req.scale === 'small') s -= v.price;
  if (req.scale === 'extravagant' && v.tags.includes('splurge')) why.push('splurge-worthy');
  const d = km(ref, v);
  s -= d / (req.stage === 'parents' ? 2.5 : 5); // busy parents: less time in the car
  if (v.rating) { s += (v.rating - 4) * 2; if (v.rating >= 4.5) why.push(`${v.rating}★ on ${v.source}`); }
  const hot = trends
    .filter((t) => t.audience.includes(req.stage) && t.tags.some((g) => v.tags.includes(g)))
    .sort((a, b) => b.weight - a.weight)[0];
  if (hot) { s += hot.weight; why.push(`trending: ${hot.title.toLowerCase()}`); }
  return { s, why, d };
}

// Builds one itinerary. opts.fixed[i] pins a venue to slot i; opts.avoid excludes ids;
// opts.penalize makes ids less likely (used to keep alternatives different); opts.mainRank
// picks the nth-best main stop.
function assemble(req, pool, trends, opts = {}) {
  const slots = slotsFor(req);
  const { fixed = [], avoid = new Set(), penalize = new Set(), mainRank = 0 } = opts;
  const picked = [...fixed];
  const whys = [];
  const mainIdx = slots.length === 3 ? 1 : 0;
  const order = [mainIdx, ...slots.keys()].filter((i, n, a) => a.indexOf(i) === n);
  const estStart = (i) => req.start + slots.slice(0, i).reduce((t, kinds) => t + DURATION[kinds[0]] + 15, 0);

  for (const i of order) {
    if (picked[i]) continue;
    const ref = i === mainIdx ? req.origin : picked[mainIdx] || req.origin;
    const taken = new Set(picked.filter(Boolean).map((v) => v.id));
    // fitCurfew: skip long stops (a 2-hour show) that would blow the home-by time.
    const eligible = (limit, fitCurfew = req.curfew != null) => pool
      .filter((v) => slots[i].includes(v.kind) && !avoid.has(v.id) && !taken.has(v.id))
      .filter((v) => !(req.noAlcohol && v.kind === 'drinks'))
      .filter((v) => !(v.day && estStart(i) > 17 * 60))
      .filter((v) => !fitCurfew || i === mainIdx || estStart(i) + DURATION[v.kind] + 20 <= req.curfew)
      .map((v) => ({ v, ...score(v, req, ref, trends) }))
      .filter((c) => c.d <= limit)
      .map((c) => ({ ...c, s: c.s - (penalize.has(c.v.id) ? 6 : 0) }))
      .sort((a, b) => b.s - a.s);
    const limit = i === mainIdx ? req.maxKm : Math.min(req.maxKm, 15);
    let cands = eligible(limit);
    if (!cands.length) cands = eligible(limit, false);
    if (!cands.length) cands = eligible(limit * 2.5, false);
    if (!cands.length) continue;
    const c = cands[Math.min(i === mainIdx ? mainRank : 0, cands.length - 1)];
    picked[i] = c.v;
    whys[i] = c.why;
  }
  return schedule(req, picked.map((v, i) => v && { venue: v, why: whys[i] || [] }).filter(Boolean), slots.length);
}

function schedule(req, stops, wanted) {
  let t = req.start, prev = null, cost = 0;
  const out = stops.map(({ venue, why }) => {
    const travel = prev ? driveMinutes(km(prev, venue)) : 0;
    t += travel;
    const stop = { label: LABEL[venue.kind], venue, why, travelMin: travel, arrive: fmtTime(t), leave: fmtTime(t + DURATION[venue.kind]) };
    t += DURATION[venue.kind];
    cost += PER_PERSON[venue.price] * req.party;
    prev = venue;
    return stop;
  });
  const homeMin = prev ? t + driveMinutes(km(prev, req.origin)) : t;
  const warnings = [];
  if (out.length < wanted) warnings.push(`Only found ${out.length} of ${wanted} stops that fit. Try a wider drive radius or fewer filters.`);
  if (req.curfew != null && homeMin > req.curfew) {
    warnings.push(`You'd be home around ${fmtTime(homeMin)}, past your ${fmtTime(req.curfew)} home-by time. Start earlier or drop a stop.`);
  }
  return {
    title: out.length ? [...new Set(out.map((s) => s.venue.area))].join(' → ') : 'No plan found',
    stops: out, endsAt: fmtTime(t), homeBy: fmtTime(homeMin), estCost: cost, warnings,
  };
}

export function buildPlans(req, pool, trends, count = 3) {
  const plans = [], used = new Set(), seen = new Set();
  for (let rank = 0; rank < count * 2 && plans.length < count; rank++) {
    const plan = assemble(req, pool, trends, { mainRank: rank, penalize: used });
    const key = plan.stops.map((s) => s.venue.id).join('|');
    if (!plan.stops.length || seen.has(key)) continue;
    seen.add(key);
    plan.stops.forEach((s) => used.add(s.venue.id));
    plans.push(plan);
  }
  return plans;
}

// Replace the stop at `index`, keeping the others. `rejected` are ids the user already swapped away.
export function swapStop(req, pool, trends, stopIds, index, rejected = []) {
  const byId = new Map(pool.map((v) => [v.id, v]));
  const fixed = stopIds.map((id, i) => (i === index ? null : byId.get(id) || null));
  return assemble(req, pool, trends, { fixed, avoid: new Set([stopIds[index], ...rejected]) });
}
