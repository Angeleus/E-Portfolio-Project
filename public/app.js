const $ = (id) => document.getElementById(id);
// Tiny DOM builder. Everything goes through textContent, so venue names from live sources can't inject markup.
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (v != null && v !== false) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((x) => x != null && x !== false));
  return el;
}
async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}
const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---- form state: remembered between visits so a busy user answers the questions once
const state = { stops: '2', anchor: 'dinner', stage: 'parents', budget: '3', scale: 'balanced', maxKm: '25', vibes: [], ...store.get('dn.profile', {}) };
let coords = null, status = null, session = null; // session = { request, plans, active, rejected }

function syncForm() {
  for (const seg of document.querySelectorAll('.seg')) {
    for (const b of seg.children) b.setAttribute('aria-pressed', String(state[seg.dataset.name]) === b.dataset.v);
  }
  for (const b of $('vibes').children) b.setAttribute('aria-pressed', state.vibes.includes(b.dataset.v));
  $('anchorField').hidden = String(state.stops) !== '1';
  $('noAlcohol').checked = !!state.noAlcohol;
  const { vibes, stops, anchor, stage, budget, scale, maxKm, noAlcohol, city } = state;
  store.set('dn.profile', { vibes, stops, anchor, stage, budget, scale, maxKm, noAlcohol, city });
}

function readForm() {
  return {
    city: $('city').value, ...(coords || {}), date: $('date').value, time: $('time').value, homeBy: $('homeBy').value || undefined,
    stops: +state.stops, anchor: state.anchor, stage: state.stage, vibes: state.vibes, budget: +state.budget,
    scale: state.scale, maxKm: +state.maxKm, noAlcohol: $('noAlcohol').checked, party: 2,
  };
}

async function plan() {
  $('formError').textContent = '';
  try {
    const out = await api('/api/plan', readForm());
    session = { request: readForm(), plans: out.plans, notes: out.notes, active: 0, rejected: {} };
    renderResults();
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    $('formError').textContent = e.message;
  }
}

function renderResults() {
  const { plans, notes, active } = session;
  $('results').hidden = false;
  $('notes').replaceChildren(...notes.map((n) => h('p', { class: 'note' }, n)));
  if (!plans.length) {
    $('tabs').replaceChildren();
    $('plan').replaceChildren(h('p', { class: 'note' }, 'Nothing matched. Try a wider drive radius, a higher budget, or fewer vibes.'));
    return;
  }
  $('tabs').replaceChildren(...plans.map((p, i) =>
    h('button', { role: 'tab', 'aria-selected': i === active, on: { click: () => { session.active = i; renderResults(); } } },
      `Option ${i + 1}`, h('small', {}, p.title))));
  const p = plans[active];
  const items = [];
  p.stops.forEach((s, i) => {
    if (i) items.push(h('li', { class: 'travel' }, `About ${s.travelMin} min drive`));
    const v = s.venue;
    items.push(h('li', { class: 'stop' },
      h('div', { class: 'when' }, `${s.arrive} – ${s.leave} · ${s.label}`),
      h('h3', {}, v.name),
      h('div', { class: 'meta' }, [v.area, `${v.county} County`, v.price ? '$'.repeat(v.price) : 'Free',
        v.rating && `${v.rating}★${v.reviews ? ` (${v.reviews})` : ''}`].filter(Boolean).join(' · ')),
      v.blurb && h('p', {}, v.blurb),
      s.why.length ? h('div', { class: 'why' }, s.why.map((w) => h('span', {}, w))) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'go', on: { click: () => openReserve(s) } }, v.kind === 'dinner' || v.kind === 'drinks' ? 'Reserve' : 'Ask about booking'),
        Object.entries(s.links).map(([k, url]) => h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' },
          { yelp: 'Yelp', google: 'Google Maps', instagram: 'Instagram', opentable: 'OpenTable' }[k])),
        h('button', { on: { click: () => swap(i) } }, 'Swap this stop'))));
  });
  $('plan').replaceChildren(
    h('div', { class: 'summary' },
      h('span', {}, 'Wraps up ', h('b', {}, p.endsAt)), h('span', {}, 'Home around ', h('b', {}, p.homeBy)),
      h('span', {}, 'Rough spend for two ', h('b', {}, p.estCost ? `~$${p.estCost}` : 'free'))),
    ...p.warnings.map((w) => h('p', { class: 'note' }, w)),
    h('ol', { class: 'timeline' }, items));
}

async function swap(index) {
  const p = session.plans[session.active];
  const key = `${session.active}:${index}`;
  const rejected = (session.rejected[key] ||= []);
  try {
    const next = await api('/api/swap', { request: session.request, stopIds: p.stops.map((s) => s.venue.id), index, rejected });
    if (next.stops.length < p.stops.length) throw new Error('No other good match for that stop. Try widening the drive radius.');
    rejected.push(p.stops[index].venue.id);
    session.plans[session.active] = next;
    renderResults();
  } catch (e) {
    $('notes').replaceChildren(h('p', { class: 'note' }, e.message));
  }
}

// ---- reservations
const to24 = (label) => { // "7:30 PM" -> "19:30"
  const [, hh, mm, ap] = /(\d+):(\d+) (AM|PM)/.exec(label);
  return `${String((+hh % 12) + (ap === 'PM' ? 12 : 0)).padStart(2, '0')}:${mm}`;
};
let reserving = null;
function openReserve(stop) {
  reserving = stop;
  const me = store.get('dn.me', {});
  $('rName').value = me.name || ''; $('rPhone').value = me.phone || '';
  $('reserveTitle').textContent = `Reserve at ${stop.venue.name}`;
  $('reserveWhen').textContent = `${session.request.date} · arriving ${stop.arrive}`;
  $('drafts').hidden = true; $('reserveError').textContent = '';
  $('reserve').showModal();
}

function copyBtn(text) {
  const b = h('button', { class: 'btn', type: 'button', on: { click: async () => {
    try { await navigator.clipboard.writeText(text); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy manually'; }
  } } }, 'Copy');
  return b;
}

function sendRow(channel, base, placeholder, known) {
  if (!status.channels[channel]) return null;
  const to = h('input', { placeholder, value: known || '', 'aria-label': placeholder });
  const out = h('span', { class: 'hint', role: 'status' });
  const btn = h('button', { class: 'btn go', type: 'button', on: { click: async () => {
    if (!confirm(`Send this ${channel === 'sms' ? 'text' : 'email'} to ${to.value}?`)) return;
    try {
      await api('/api/reservations/send', { ...base, channel, to: to.value.trim(), confirm: true });
      out.textContent = 'Sent. Watch for their reply to confirm.';
    } catch (e) { out.textContent = e.message; }
  } } }, 'Send it for me');
  return h('div', { class: 'row' }, to, btn, out);
}

$('reserveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = reserving.venue;
  const base = { venueName: v.name, date: session.request.date, time: to24(reserving.arrive), name: $('rName').value,
    phone: $('rPhone').value, party: +$('rParty').value, notes: $('rNotes').value };
  store.set('dn.me', { name: base.name, phone: base.phone });
  try {
    const d = await api('/api/reservations/draft', base);
    const digits = (v.phone || '').replace(/[^\d+]/g, '');
    const e164 = digits ? (digits.startsWith('+') ? digits : `+1${digits.slice(-10)}`) : '';
    const section = (title, text, ...extra) => h('div', { class: 'draft' }, h('h3', {}, title), h('pre', {}, text), h('div', { class: 'row' }, copyBtn(text), ...extra));
    $('drafts').replaceChildren(...[
      h('p', {}, h('b', {}, d.summary)),
      reserving.links.opentable && h('p', { class: 'hint' }, 'Fastest: check ',
        h('a', { href: reserving.links.opentable, target: '_blank', rel: 'noopener noreferrer' }, 'OpenTable'), ' or the venue page on ',
        h('a', { href: reserving.links.yelp, target: '_blank', rel: 'noopener noreferrer' }, 'Yelp'), ' for instant booking. Otherwise:'),
      section('Call script', d.script.join('\n\n'),
        digits ? h('a', { class: 'btn go', href: `tel:${digits}` }, `Call ${v.phone}`)
          : h('a', { class: 'btn', href: reserving.links.google, target: '_blank', rel: 'noopener noreferrer' }, 'Find their number')),
      section('Text message', d.sms, digits && h('a', { class: 'btn', href: `sms:${digits}?&body=${encodeURIComponent(d.sms)}` }, 'Open in Messages')),
      sendRow('sms', base, 'Venue phone, e.g. +13105551234', e164),
      section('Email', `Subject: ${d.email.subject}\n\n${d.email.body}`,
        h('a', { class: 'btn', href: `mailto:?subject=${encodeURIComponent(d.email.subject)}&body=${encodeURIComponent(d.email.body)}` }, 'Open in Mail')),
      sendRow('email', base, 'Venue email address'),
      !status.channels.sms && !status.channels.email && h('p', { class: 'hint' }, 'Automatic sending is off on this server, so nothing is sent until you tap a button above.'),
    ].filter(Boolean));
    $('drafts').hidden = false; $('reserveError').textContent = '';
  } catch (err) {
    $('reserveError').textContent = err.message;
  }
});

// ---- quick ask
$('ask').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('askText').value.trim();
  if (!text) return $('askText').focus();
  try {
    const got = await api('/api/parse', { text, today: localISO() });
    if (got.city) { $('city').value = got.city; coords = null; $('locStatus').textContent = ''; state.city = got.city; }
    if (got.date) $('date').value = got.date;
    if (got.time) $('time').value = got.time;
    if (got.homeBy) $('homeBy').value = got.homeBy;
    for (const k of ['stops', 'stage', 'scale', 'budget', 'vibes', 'noAlcohol']) if (got[k] != null) state[k] = Array.isArray(got[k]) ? got[k] : typeof got[k] === 'boolean' ? got[k] : String(got[k]);
    syncForm();
    const missing = [!got.city && 'where', !got.date && 'which day', !got.time && 'what time'].filter(Boolean);
    $('askHint').textContent = missing.length ? `Used your saved defaults for ${missing.join(', ')}. Adjust below if needed.` : '';
    await plan();
  } catch (err) { $('askHint').textContent = err.message; }
});

// ---- wiring
document.addEventListener('click', (e) => {
  const b = e.target.closest('.seg button, .chips button');
  if (!b) return;
  const seg = b.closest('.seg');
  if (seg) state[seg.dataset.name] = b.dataset.v;
  else state.vibes = state.vibes.includes(b.dataset.v) ? state.vibes.filter((v) => v !== b.dataset.v) : [...state.vibes, b.dataset.v];
  syncForm();
  if (seg?.dataset.name === 'stage') loadTrends();
});
$('noAlcohol').addEventListener('change', () => { state.noAlcohol = $('noAlcohol').checked; syncForm(); });
$('city').addEventListener('change', () => { coords = null; $('locStatus').textContent = ''; state.city = $('city').value; syncForm(); });
$('planForm').addEventListener('submit', (e) => { e.preventDefault(); plan(); });
$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return ($('locStatus').textContent = ' Location is not available in this browser.');
  $('locStatus').textContent = ' Finding you…';
  navigator.geolocation.getCurrentPosition(
    (pos) => { coords = { lat: pos.coords.latitude, lng: pos.coords.longitude }; $('locStatus').textContent = ' Using your current location. Pick a city to switch back.'; },
    () => { $('locStatus').textContent = ' Could not get your location. Pick a city instead.'; },
    { timeout: 8000 });
});

async function loadTrends() {
  const list = await api(`/api/trends?stage=${encodeURIComponent(state.stage)}`);
  $('trendSource').textContent = list.some((t) => t.source === 'instagram')
    ? 'Ranked by Instagram engagement from the latest scan.' : 'Curated starter list. Connect Instagram to rank these by live engagement.';
  $('trends').replaceChildren(...list.map((t) => h('li', {}, h('b', {}, t.title),
    t.hashtags.map((tag) => h('a', { href: `https://www.instagram.com/explore/tags/${tag}/`, target: '_blank', rel: 'noopener noreferrer' }, `#${tag}`)))));
}

(async function init() {
  status = await api('/api/status');
  $('city').replaceChildren(...status.counties.map((county) => h('optgroup', { label: `${county} County` },
    status.cities.filter((c) => c.county === county).map((c) => h('option', {}, c.name)))));
  if (state.city && status.cities.some((c) => c.name === state.city)) $('city').value = state.city;
  $('vibes').replaceChildren(...status.vibes.map((v) => h('button', { type: 'button', 'data-v': v }, v)));
  $('date').value = $('date').min = localISO();
  const live = Object.entries(status.sources).filter(([, on]) => on).map(([k]) => k[0].toUpperCase() + k.slice(1));
  $('sourceLine').textContent = live.length ? `Live sources connected: ${live.join(', ')}.` : `Running on the built-in pilot list of ${status.seedVenues} venues. Add API keys to pull live Yelp and Google results.`;
  syncForm();
  loadTrends();
})();
