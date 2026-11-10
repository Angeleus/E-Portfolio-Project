import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Curated starting list of date-night themes. `weight` is an editorial 1-3 until
// `npm run scan:trends` replaces it with real Instagram engagement (see scripts/scan-trends.js).
const T = (id, title, hashtags, tags, audience, weight) => ({ id, title, hashtags, tags, audience, weight, source: 'curated' });
export const SEED_TRENDS = [
  T('sunset', 'Golden-hour sunset dates', ['sunsetdate', 'ladatenight'], ['sunset', 'view', 'beach'], ['first-date', 'new-couple', 'long-term', 'parents'], 3),
  T('rooftop', 'Rooftop dinner and drinks', ['rooftopla', 'datenightla'], ['rooftop', 'view'], ['new-couple', 'long-term', 'parents'], 3),
  T('foodhall', 'Food-hall crawl: order three things, share everything', ['lafoodie', 'ocfoodie'], ['foodie', 'walkable'], ['first-date', 'new-couple'], 2),
  T('playful', 'Play something: bowling, arcades, ferris wheels', ['activedate', 'dateideas'], ['game', 'novel'], ['first-date', 'new-couple', 'long-term'], 3),
  T('picnic', 'Picnic and bonfire on the beach', ['beachpicnic', 'ocdatenight'], ['picnic', 'bonfire', 'beach'], ['new-couple', 'long-term', 'parents'], 2),
  T('culture', 'Museum or bookstore, then dessert', ['museumdate', 'lamuseums'], ['museum', 'sweet', 'novel'], ['first-date', 'new-couple'], 2),
  T('onwater', 'Out on the water: gondolas, Duffy boats, harbor walks', ['newportbeach', 'coupleactivities'], ['water'], ['new-couple', 'long-term', 'parents'], 2),
  T('splurge', 'One big splurge dinner', ['finedininglosangeles', 'anniversarydinner'], ['splurge'], ['long-term', 'parents'], 2),
  T('livemusic', 'Live music or a show', ['livemusicla', 'datenight'], ['live-music', 'show'], ['new-couple', 'long-term', 'parents'], 2),
  T('garden', 'Slow garden walk', ['gardendate', 'venturacounty'], ['garden'], ['first-date', 'long-term', 'parents'], 1),
];

export const CACHE_PATH = fileURLToPath(new URL('./data/trends.cache.json', import.meta.url));

// Seed trends, overlaid with whatever the last Instagram scan measured.
export function loadTrends() {
  if (!existsSync(CACHE_PATH)) return SEED_TRENDS;
  try {
    const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    return SEED_TRENDS.map((t) => (cache.trends?.[t.id] ? { ...t, ...cache.trends[t.id], source: 'instagram', scannedAt: cache.scannedAt } : t));
  } catch {
    return SEED_TRENDS;
  }
}
