# Date Night Planner

Plans a complete date night (one, two or three stops, timed and routed) for busy couples, then
writes the reservation request for you. Pilot region: **Los Angeles, Orange and Ventura counties**.

It is a planner that sits on top of Yelp, Google and Instagram, not a replacement for them: every
stop links straight to its Yelp, Google Maps, Instagram and OpenTable pages.

## Run it

Needs Node 20.6+ and nothing else (no dependencies to install).

```
npm start        # http://127.0.0.1:3000
npm test
```

## How it works

1. **Ask in one line** ("Friday at 7pm in Pasadena, dinner then dessert, romantic, home by 11")
   or fill in the short form. Answers are remembered on the device, so next time it is one tap.
2. **Questions it asks:** where, date, start time, home-by time (sitter curfew), number of stops,
   who is going (first date, new couple, long-term, busy parents), vibe, budget, scale
   (low-key to extravagant), max drive, and whether to skip bars.
3. **It builds three options.** Each has arrival and leave times per stop, drive time between
   stops, a wrap-up and home-by estimate, a rough spend, and the reason each stop was picked.
   Any stop can be swapped.
4. **Reserve.** For any stop it writes a call script, a text message and an email, with
   one-tap call, Messages and Mail links. With Twilio or SendGrid keys it can send the text or
   email for you, after you confirm the exact message.

## Data sources

| Source | Without keys | With keys (`.env`, see `.env.example`) |
| --- | --- | --- |
| Pilot dataset | 67 hand-picked venues across the three counties | Always included |
| Yelp | Deep link per venue | Live search via Yelp Fusion, merged in with ratings and phone |
| Google | Deep link per venue | Live search via Places API (New), merged in |
| Instagram | Deep links per venue and hashtag; curated trend list | `npm run scan:trends` ranks trends by real hashtag engagement (Graph API) |
| Twilio / SendGrid | Drafts only | "Send it for me" by text or email |

Run `npm run scan:trends` on a daily cron to keep trends fresh.

## Status and limits

- The live Yelp, Google, Instagram, Twilio and SendGrid integrations are written against the
  documented APIs but **have not been exercised with real keys yet**. Everything else is covered
  by tests and was checked in a browser.
- **Instagram:** Meta offers no API for open-ended scanning of accounts or posts, and scraping
  breaks its terms. The supported route (used here) is hashtag search on a Business/Creator
  account, limited to 30 hashtags per week. Tracking specific date-night creators would need
  their permission or a licensed data provider.
- **AI phone calls are not built.** The app writes the script for you to call. A voice agent
  (for example Twilio plus a speech model) is the next step, and it must disclose that it is an
  AI on the call.
- **Grubhub and dating/relationship-research sites** are not connected. Grubhub has no public
  search API; it needs a partnership.
- Seed venue coordinates are approximate, and hours, prices and closures are not verified.
  Check the Yelp or Google link before you go.
- No accounts or database yet: preferences live in the browser. If you deploy this with send
  keys set, put it behind login first, otherwise anyone who can reach it can send messages.

## Layout

```
server/index.js         HTTP server and API routes
server/planner.js       request validation, scoring, itinerary and schedule
server/venues.js        pilot seed venues        server/trends.js   trend themes
server/sources.js       Yelp, Google Places, Instagram adapters
server/reservations.js  drafts and optional sending
server/parse.js         one-line request parser
public/                 the web app              test/              node --test suite
```
