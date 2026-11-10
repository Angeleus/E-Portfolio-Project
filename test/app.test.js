import test from 'node:test';
import assert from 'node:assert/strict';
import { VENUES } from '../server/venues.js';
import { SEED_TRENDS } from '../server/trends.js';
import { COUNTIES, nearestCity } from '../server/geo.js';
import { normalizeRequest, buildPlans, swapStop, VIBES } from '../server/planner.js';
import { draftReservation, sendReservation } from '../server/reservations.js';
import { parseAsk } from '../server/parse.js';
import { gatherVenues } from '../server/sources.js';

const base = { city: 'Pasadena', date: '2026-11-13', time: '18:30', stops: 3, stage: 'parents', vibes: ['romantic'], budget: 3 };
const plans = (over = {}) => { const r = normalizeRequest({ ...base, ...over }); return { r, p: buildPlans(r, VENUES, SEED_TRENDS) }; };

test('seed data stays inside the pilot region and uses known vocab', () => {
  assert.equal(new Set(VENUES.map((v) => v.id)).size, VENUES.length);
  for (const v of VENUES) {
    assert.ok(COUNTIES.includes(v.county), v.name);
    assert.equal(nearestCity(v)?.county, v.county, `${v.name} county`);
    for (const vibe of v.vibes) assert.ok(VIBES.includes(vibe), `${v.name}: ${vibe}`);
  }
});

test('every pilot city gets full 1, 2 and 3 stop plans', async () => {
  const { CITIES } = await import('../server/geo.js');
  for (const c of CITIES) for (const stops of [1, 2, 3]) {
    const { p } = plans({ city: c.name, stops, maxKm: 50 });
    assert.ok(p.length >= 1, `${c.name} ${stops}`);
    assert.equal(p[0].stops.length, stops, `${c.name} ${stops}`);
    assert.equal(p[0].warnings.length, 0, `${c.name} ${stops}: ${p[0].warnings}`);
  }
});

test('three stops run before, dinner, after with a timed schedule', () => {
  const { p } = plans();
  assert.equal(p.length, 3);
  const [a, b, c] = p[0].stops;
  assert.equal(b.venue.kind, 'dinner');
  assert.equal(a.arrive, '6:30 PM');
  assert.ok(['dessert', 'drinks', 'entertainment'].includes(c.venue.kind));
  assert.notDeepEqual(p[0].stops.map((s) => s.venue.id), p[1].stops.map((s) => s.venue.id));
});

test('respects budget, no-alcohol, daytime-only and curfew', () => {
  for (const plan of plans({ budget: 1, noAlcohol: true, time: '19:00' }).p) for (const s of plan.stops) {
    assert.notEqual(s.venue.kind, 'drinks');
    assert.equal(s.venue.day, false);
  }
  const { p } = plans({ city: 'Downtown Los Angeles', budget: 2, stops: 1 });
  assert.ok(p[0].stops[0].venue.price <= 2);
  assert.match(plans({ homeBy: '20:00' }).p[0].warnings.join(), /home-by/);
  assert.equal(plans({ homeBy: '00:30' }).p[0].warnings.length, 0);
});

test('rejects locations outside the pilot counties', () => {
  assert.throws(() => normalizeRequest({ ...base, city: undefined, lat: 37.77, lng: -122.42 }), /outside the pilot area/);
  assert.throws(() => normalizeRequest({ ...base, city: 'San Diego' }), /Pick a city/);
  assert.equal(normalizeRequest({ ...base, lat: 33.62, lng: -117.93 }).county, 'Orange');
});

test('swap replaces only the chosen stop', () => {
  const { r, p } = plans();
  const ids = p[0].stops.map((s) => s.venue.id);
  const next = swapStop(r, VENUES, SEED_TRENDS, ids, 2).stops.map((s) => s.venue.id);
  assert.deepEqual(next.slice(0, 2), ids.slice(0, 2));
  assert.notEqual(next[2], ids[2]);
});

test('quick ask parsing', () => {
  const got = parseAsk('Date night this Friday at 7pm in Laguna Beach, dinner then drinks, romantic with a view, home by 11', '2026-11-10');
  assert.deepEqual(got, { city: 'Laguna Beach', date: '2026-11-13', time: '19:00', homeBy: '23:00', stops: 2, vibes: ['romantic', 'scenic'] });
  assert.equal(parseAsk('tomorrow at 6:30 in DTLA', '2026-11-10').time, '18:30');
  assert.equal(parseAsk('first date tomorrow, something fun and cheap', '2026-12-31').date, '2027-01-01');
  assert.equal(parseAsk('anniversary on Dec 5', '2026-11-10').date, '2026-12-05');
  assert.deepEqual(parseAsk(''), {});
});

test('reservation drafts, and sending is refused unless configured and confirmed', async () => {
  const req = { venueName: 'Union', date: '2026-11-13', time: '19:30', name: 'Sam', party: 2, notes: 'Anniversary' };
  const d = draftReservation(req);
  assert.match(d.summary, /Table for 2 at Union, Friday, November 13 at 7:30 PM, under Sam/);
  assert.match(d.sms, /Anniversary\./);
  assert.throws(() => draftReservation({ ...req, name: '' }), /name/);
  await assert.rejects(sendReservation({ ...req, channel: 'sms', to: '+13105550100', confirm: true }, {}), /not set up/);
  await assert.rejects(sendReservation({ ...req, channel: 'voice' }, {}), /not available yet/);
  const env = { TWILIO_ACCOUNT_SID: 'x', TWILIO_AUTH_TOKEN: 'y', TWILIO_FROM_NUMBER: '+13105550101' };
  await assert.rejects(sendReservation({ ...req, channel: 'sms', to: '+13105550100' }, env), /Confirm/);
});

test('without API keys the venue pool is the seed list', async () => {
  const { venues, notes } = await gatherVenues(normalizeRequest(base), VENUES, {});
  assert.equal(venues.length, VENUES.length);
  assert.deepEqual(notes, []);
});
