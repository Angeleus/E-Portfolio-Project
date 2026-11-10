// Reservation drafting and (optionally) sending.
// Drafting always works. Sending needs Twilio (text) or SendGrid (email) credentials and an
// explicit confirm flag, so nothing leaves the app without the user approving the exact message.
import { fmtTime, toMinutes } from './planner.js';

const fail = (msg, status = 400) => { throw Object.assign(new Error(msg), { status }); };
const enc = encodeURIComponent;

export const channels = (env = process.env) => ({
  sms: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER),
  email: !!(env.SENDGRID_API_KEY && env.SENDGRID_FROM_EMAIL),
  voice: false, // AI phone calls are not built yet; see README roadmap.
});

export function venueLinks(v) {
  const q = `${v.name} ${v.area}`;
  return {
    yelp: v.source === 'yelp' && v.url ? v.url : `https://www.yelp.com/search?find_desc=${enc(v.name)}&find_loc=${enc(v.area + ', CA')}`,
    google: v.source === 'google' && v.url ? v.url : `https://www.google.com/maps/search/?api=1&query=${enc(q + ' CA')}`,
    instagram: `https://www.instagram.com/explore/search/keyword/?q=${enc(q)}`,
    ...(v.kind === 'dinner' || v.kind === 'drinks' ? { opentable: `https://www.opentable.com/s?term=${enc(v.name)}` } : {}),
  };
}

function prettyDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) fail('Invalid date.');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function draftReservation(r = {}) {
  const venue = String(r.venueName || '').trim().slice(0, 120);
  const name = String(r.name || '').trim().slice(0, 80);
  if (!venue) fail('Missing venue.');
  if (!name) fail('Add the name for the reservation.');
  const min = toMinutes(r.time);
  if (min == null) fail('Invalid time.');
  const party = Math.min(12, Math.max(1, Math.round(+r.party) || 2));
  const when = `${prettyDate(r.date)} at ${fmtTime(min)}`;
  const phone = String(r.phone || '').trim().slice(0, 30);
  const notes = String(r.notes || '').trim().slice(0, 300);
  const back = phone ? ` You can reach me at ${phone}.` : '';
  const extra = notes ? ` ${notes.replace(/[.!]?$/, '.')}` : '';
  return {
    summary: `Table for ${party} at ${venue}, ${when}, under ${name}`,
    script: [
      `Hi, I'd like to make a reservation for ${party} on ${when}, under the name ${name}.`,
      notes && `One note: ${notes}`,
      `If ${fmtTime(min)} isn't available, anything within about 30 minutes works.`,
      phone && `My callback number is ${phone}.`,
      'Could you confirm the reservation and whether you need a card to hold it? Thank you!',
    ].filter(Boolean),
    sms: `Hi ${venue}! Could I reserve a table for ${party} on ${when} under ${name}?${extra} A time within 30 min also works.${back} Thank you!`,
    email: {
      subject: `Reservation request: ${party} on ${when}`,
      body: `Hello ${venue} team,\n\nI'd like to request a reservation:\n\n  Party: ${party}\n  Date: ${when}\n  Name: ${name}${phone ? `\n  Phone: ${phone}` : ''}${notes ? `\n  Notes: ${notes}` : ''}\n\nIf that time isn't available, anything within about 30 minutes works. Please reply to confirm.\n\nThank you,\n${name}`,
    },
  };
}

export async function sendReservation(r = {}, env = process.env) {
  const on = channels(env);
  if (r.channel === 'voice') fail('AI phone calls are not available yet. Use the call script instead.', 501);
  if (!['sms', 'email'].includes(r.channel)) fail('Unknown channel.');
  if (!on[r.channel]) fail(`Sending by ${r.channel} is not set up on this server. Copy the draft or use the link instead.`, 409);
  if (r.confirm !== true) fail('Confirm the message before sending.');
  const draft = draftReservation(r);
  const to = String(r.to || '').trim();
  let res;
  if (r.channel === 'sms') {
    if (!/^\+1\d{10}$/.test(to)) fail('Enter the venue phone as +1 followed by 10 digits.');
    res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64') },
      body: new URLSearchParams({ To: to, From: env.TWILIO_FROM_NUMBER, Body: draft.sms }),
      signal: AbortSignal.timeout(10000),
    });
  } else {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) fail("Enter the venue's email address.");
    const replyTo = String(r.replyTo || '').trim();
    res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: env.SENDGRID_FROM_EMAIL },
        ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo) ? { reply_to: { email: replyTo } } : {}),
        subject: draft.email.subject,
        content: [{ type: 'text/plain', value: draft.email.body }],
      }),
      signal: AbortSignal.timeout(10000),
    });
  }
  if (!res.ok) fail(`The ${r.channel} provider rejected the message (${res.status}).`, 502);
  return { sent: true, channel: r.channel, to, summary: draft.summary };
}
