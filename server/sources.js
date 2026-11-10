// Live venue sources. Each is only used when its API key is configured; results are merged
// over the seed dataset. Any failure degrades to seed-only with a note, never an error.
import { nearestCity } from './geo.js';

const cache = new Map();
const TTL = 15 * 60 * 1000;
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

export const configured = (env = process.env) => ({
  yelp: !!env.YELP_API_KEY,
  google: !!env.GOOGLE_PLACES_API_KEY,
  instagram: !!(env.IG_USER_ID && env.IG_ACCESS_TOKEN),
});

const QUERIES = {
  dinner: 'romantic dinner restaurant',
  drinks: 'cocktail bar',
  dessert: 'dessert',
  activity: 'fun date activity',
  entertainment: 'live entertainment',
};
const GUESS_VIBES = {
  dinner: ['romantic'], drinks: ['lively'], dessert: ['casual', 'cozy'], activity: ['playful'], entertainment: ['lively', 'playful'],
};

function toVenue(kind, source, f) {
  const city = nearestCity(f); // also enforces the pilot region
  if (!city || !f.name) return null;
  const price = f.price ?? 2;
  return {
    id: `${source}-${f.id}`, name: f.name, area: f.area || city.name, county: city.county, kind,
    blurb: f.blurb || '', price, vibes: [...GUESS_VIBES[kind], ...(price >= 3 ? ['upscale'] : [])], tags: [],
    lat: f.lat, lng: f.lng, day: false, source, rating: f.rating, reviews: f.reviews, phone: f.phone, url: f.url,
  };
}

async function yelp(kind, req, key) {
  const q = new URLSearchParams({
    term: QUERIES[kind], latitude: req.origin.lat, longitude: req.origin.lng,
    radius: Math.min(40000, req.maxKm * 1000), limit: 10, sort_by: 'best_match',
  });
  const res = await fetch(`https://api.yelp.com/v3/businesses/search?${q}`, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Yelp ${res.status}`);
  return ((await res.json()).businesses || []).map((b) => toVenue(kind, 'yelp', {
    id: b.id, name: b.name, area: b.location?.city, lat: b.coordinates?.latitude, lng: b.coordinates?.longitude,
    price: b.price ? b.price.length : undefined, rating: b.rating, reviews: b.review_count,
    phone: b.display_phone || b.phone, url: b.url, blurb: (b.categories || []).map((c) => c.title).join(', '),
  }));
}

const G_PRICE = { PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
async function google(kind, req, key) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.nationalPhoneNumber,places.googleMapsUri,places.primaryTypeDisplayName',
    },
    body: JSON.stringify({
      textQuery: `${QUERIES[kind]} near ${req.city}, CA`, maxResultCount: 10,
      locationBias: { circle: { center: { latitude: req.origin.lat, longitude: req.origin.lng }, radius: Math.min(50000, req.maxKm * 1000) } },
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Google Places ${res.status}`);
  return ((await res.json()).places || []).map((p) => toVenue(kind, 'google', {
    id: p.id, name: p.displayName?.text, lat: p.location?.latitude, lng: p.location?.longitude,
    price: G_PRICE[p.priceLevel], rating: p.rating, reviews: p.userRatingCount,
    phone: p.nationalPhoneNumber, url: p.googleMapsUri, blurb: p.primaryTypeDisplayName?.text,
  }));
}

// Returns { venues, notes }. Seed venues that a live source also knows get its rating/phone/url.
export async function gatherVenues(req, seed, env = process.env) {
  const on = configured(env), notes = [], live = [];
  const jobs = [];
  for (const kind of Object.keys(QUERIES)) {
    if (on.yelp) jobs.push(['Yelp', kind, yelp, env.YELP_API_KEY]);
    if (on.google) jobs.push(['Google', kind, google, env.GOOGLE_PLACES_API_KEY]);
  }
  await Promise.all(jobs.map(async ([label, kind, fn, key]) => {
    const ck = `${label}|${kind}|${req.city}|${req.maxKm}`;
    const hit = cache.get(ck);
    if (hit && Date.now() - hit.at < TTL) return live.push(...hit.rows);
    try {
      const rows = (await fn(kind, req, key)).filter(Boolean);
      cache.set(ck, { at: Date.now(), rows });
      live.push(...rows);
    } catch (e) {
      const note = `${label} search unavailable (${e.message}); using other sources.`;
      if (!notes.includes(note)) notes.push(note);
    }
  }));
  const venues = seed.map((v) => ({ ...v }));
  const index = new Map(venues.map((v) => [norm(v.name), v]));
  for (const v of live) {
    const known = index.get(norm(v.name));
    if (known) {
      for (const k of ['rating', 'reviews', 'phone', 'url']) if (v[k] != null && known[k] == null) known[k] = v[k];
      if (v.rating != null && known.source === 'seed') known.source = v.source;
    } else {
      index.set(norm(v.name), v);
      venues.push(v);
    }
  }
  return { venues, notes };
}

// Instagram Graph API hashtag search: total engagement on a hashtag's current top media.
// Requires an Instagram Business/Creator account; Meta limits each account to 30 unique
// hashtags per rolling 7 days, so the scan list is deliberately short.
export async function hashtagEngagement(tag, env = process.env) {
  const base = 'https://graph.facebook.com/v21.0';
  const auth = `user_id=${env.IG_USER_ID}&access_token=${encodeURIComponent(env.IG_ACCESS_TOKEN)}`;
  const get = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Instagram ${res.status}`);
    return res.json();
  };
  const found = await get(`${base}/ig_hashtag_search?q=${encodeURIComponent(tag)}&${auth}`);
  const id = found.data?.[0]?.id;
  if (!id) return { posts: 0, engagement: 0 };
  const media = await get(`${base}/${id}/top_media?fields=like_count,comments_count&limit=25&${auth}`);
  const rows = media.data || [];
  return { posts: rows.length, engagement: rows.reduce((n, m) => n + (m.like_count || 0) + (m.comments_count || 0), 0) };
}
