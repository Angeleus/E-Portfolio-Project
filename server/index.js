import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITIES, COUNTIES } from './geo.js';
import { VENUES } from './venues.js';
import { loadTrends } from './trends.js';
import { normalizeRequest, buildPlans, swapStop, VIBES } from './planner.js';
import { gatherVenues, configured } from './sources.js';
import { draftReservation, sendReservation, channels, venueLinks } from './reservations.js';
import { parseAsk } from './parse.js';

const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const withLinks = (plan) => ({ ...plan, stops: plan.stops.map((s) => ({ ...s, links: venueLinks(s.venue) })) });

const routes = {
  'GET /api/status': () => ({
    counties: COUNTIES, cities: CITIES.map(({ name, county }) => ({ name, county })), vibes: VIBES,
    sources: configured(), channels: channels(), seedVenues: VENUES.length,
  }),
  'GET /api/trends': (_, url) => {
    const stage = url.searchParams.get('stage');
    return loadTrends().filter((t) => !stage || t.audience.includes(stage)).sort((a, b) => b.weight - a.weight);
  },
  'POST /api/parse': (body) => parseAsk(body.text, /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : undefined),
  'POST /api/plan': async (body) => {
    const request = normalizeRequest(body);
    const { venues, notes } = await gatherVenues(request, VENUES);
    return { request, notes, plans: buildPlans(request, venues, loadTrends()).map(withLinks) };
  },
  'POST /api/swap': async (body) => {
    const request = normalizeRequest(body.request);
    const ids = Array.isArray(body.stopIds) ? body.stopIds.map(String) : [];
    const index = Number(body.index);
    if (!Number.isInteger(index) || index < 0 || index >= ids.length) throw Object.assign(new Error('Bad stop index.'), { status: 400 });
    const { venues } = await gatherVenues(request, VENUES);
    const rejected = Array.isArray(body.rejected) ? body.rejected.map(String) : [];
    return withLinks(swapStop(request, venues, loadTrends(), ids, index, rejected));
  },
  'POST /api/reservations/draft': (body) => draftReservation(body),
  'POST /api/reservations/send': (body) => sendReservation(body),
};

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    if ((size += c.length) > 100_000) throw Object.assign(new Error('Request too large.'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw Object.assign(new Error('Invalid JSON.'), { status: 400 });
  }
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (status, data, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };
  try {
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) return send(200, await route(req.method === 'POST' ? await readJson(req) : {}, url));
    if (url.pathname.startsWith('/api/')) return send(404, { error: 'Not found.' });
    if (req.method !== 'GET') return send(405, { error: 'Method not allowed.' });
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\]|\.\.)+/, '') || 'index.html';
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) return send(403, { error: 'Forbidden.' });
    return send(200, await readFile(file), MIME[extname(file)] || 'application/octet-stream');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'EISDIR') return send(404, { error: 'Not found.' });
    if (!e.status) console.error(e);
    send(e.status || 500, { error: e.status ? e.message : 'Something went wrong.' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 3000, host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Date Night Planner running at http://${host}:${port}`));
}
