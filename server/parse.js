// Turns "date night Friday at 7pm in Pasadena, dinner then drinks, something romantic"
// into planner fields. Rule-based on purpose: instant, free, and predictable.
import { CITIES } from './geo.js';
import { VIBES } from './planner.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ALIASES = { dtla: 'Downtown Los Angeles', 'los angeles': 'Downtown Los Angeles', 'downtown la': 'Downtown Los Angeles', weho: 'West Hollywood', hb: 'Huntington Beach', 'la ': 'Downtown Los Angeles' };
const iso = (d) => d.toISOString().slice(0, 10);

export function parseAsk(text, today = iso(new Date())) {
  const t = ` ${String(text || '').toLowerCase().slice(0, 500)} `;
  const out = {};
  const base = new Date(`${today}T12:00:00Z`);
  const plus = (n) => iso(new Date(base.getTime() + n * 864e5));

  // Where
  const city = [...CITIES].sort((a, b) => b.name.length - a.name.length).find((c) => t.includes(c.name.toLowerCase()));
  const alias = Object.keys(ALIASES).find((a) => t.includes(a.trim() === a ? a : ` ${a}`));
  if (city) out.city = city.name; else if (alias) out.city = ALIASES[alias];

  // When (date)
  let m;
  if (/\b(tonight|today)\b/.test(t)) out.date = today;
  else if (/\btomorrow\b/.test(t)) out.date = plus(1);
  else if ((m = new RegExp(`\\b(next )?(${DAYS.join('|')})\\b`).exec(t))) {
    const ahead = (DAYS.indexOf(m[2]) - base.getUTCDay() + 7) % 7;
    out.date = plus(ahead + (m[1] && ahead < 7 ? 7 : 0));
  } else if ((m = new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.? (\\d{1,2})\\b`).exec(t)) || (m = /\b(\d{1,2})\/(\d{1,2})\b/.exec(t))) {
    const month = Number.isNaN(+m[1]) ? MONTHS.indexOf(m[1]) : +m[1] - 1;
    const d = new Date(Date.UTC(base.getUTCFullYear(), month, +m[2], 12));
    if (d < base) d.setUTCFullYear(d.getUTCFullYear() + 1);
    if (month >= 0 && month < 12 && d.getUTCDate() === +m[2]) out.date = iso(d);
  }

  // When (time)
  if ((m = /\b(\d{1,2})(?::(\d{2}))? ?(am|pm)\b/.exec(t))) {
    const h = (+m[1] % 12) + (m[3] === 'pm' ? 12 : 0);
    if (+m[1] >= 1 && +m[1] <= 12) out.time = `${String(h).padStart(2, '0')}:${m[2] || '00'}`;
  } else if ((m = /\bat (\d{1,2})(?::(\d{2}))?\b/.exec(t)) && +m[1] >= 1 && +m[1] <= 12) {
    out.time = `${String(+m[1] < 11 ? +m[1] + 12 : +m[1]).padStart(2, '0')}:${m[2] || '00'}`; // "at 7" means evening
  }
  if ((m = /\b(?:home|back) by (\d{1,2})(?::(\d{2}))? ?(am|pm)?/.exec(t))) {
    const h = m[3] === 'am' ? +m[1] % 12 : (+m[1] % 12) + 12;
    out.homeBy = `${String(h % 24).padStart(2, '0')}:${m[2] || '00'}`;
  }

  // How many stops
  const words = { one: 1, two: 2, three: 3, 1: 1, 2: 2, 3: 3 };
  if ((m = /\b(one|two|three|[123]) (?:stops?|spots?|places?|parts?)\b/.exec(t))) out.stops = words[m[1]];
  else {
    const parts = ['dinner', 'drinks|cocktail|bar\\b', 'dessert|ice cream', 'activity|museum|bowling|walk|show|concert']
      .filter((p) => new RegExp(`\\b(${p})`).test(t)).length;
    if (parts > 1) out.stops = Math.min(3, parts);
    else if (/\bjust dinner\b/.test(t)) out.stops = 1;
  }

  // Who and what kind of night
  if (/first date/.test(t)) out.stage = 'first-date';
  else if (/\b(new couple|just started|new relationship)\b/.test(t)) out.stage = 'new-couple';
  else if (/\b(kids?|sitter|babysitter|parents?)\b/.test(t)) out.stage = 'parents';
  else if (/\b(anniversary|wife|husband|married|years together)\b/.test(t)) out.stage = 'long-term';
  const vibes = VIBES.filter((v) => t.includes(v));
  if (/\bfun\b/.test(t) && !vibes.includes('playful')) vibes.push('playful');
  if (/\b(fancy|classy)\b/.test(t) && !vibes.includes('upscale')) vibes.push('upscale');
  if (/\b(chill|low[- ]key|relaxed)\b/.test(t) && !vibes.includes('casual')) vibes.push('casual');
  if (/\b(views?|sunset|beach|ocean)\b/.test(t) && !vibes.includes('scenic')) vibes.push('scenic');
  if (vibes.length) out.vibes = vibes;
  if (/\b(extravagant|splurge|go all out|anniversary|fancy)\b/.test(t)) { out.scale = 'extravagant'; out.budget = 4; }
  else if (/\b(cheap|budget|inexpensive|small|simple|low[- ]key)\b/.test(t)) { out.scale = 'small'; out.budget = 2; }
  if ((m = /(\${1,4})(?!\d)/.exec(t))) out.budget = m[1].length;
  if (/\b(no alcohol|sober|don'?t drink|non[- ]alcoholic)\b/.test(t)) out.noAlcohol = true;
  return out;
}
