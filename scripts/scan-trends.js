// Refreshes trend weights from Instagram hashtag engagement. Run on a schedule, e.g. daily cron:
//   0 6 * * *  cd /path/to/app && npm run scan:trends
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SEED_TRENDS, CACHE_PATH } from '../server/trends.js';
import { configured, hashtagEngagement } from '../server/sources.js';

if (!configured().instagram) {
  console.error('IG_USER_ID and IG_ACCESS_TOKEN are not set; nothing scanned. Trends stay on the curated list.');
  process.exit(1);
}
const measured = {};
for (const t of SEED_TRENDS) {
  let engagement = 0, posts = 0;
  for (const tag of t.hashtags) {
    try {
      const r = await hashtagEngagement(tag);
      engagement += r.engagement; posts += r.posts;
    } catch (e) {
      console.error(`#${tag}: ${e.message}`);
    }
  }
  if (posts) measured[t.id] = { engagement, posts };
}
// Rank measured themes into weights 1-3 so they stay comparable with the curated scale.
const ranked = Object.entries(measured).sort((a, b) => b[1].engagement - a[1].engagement);
ranked.forEach(([id], i) => { measured[id].weight = 3 - Math.floor((i * 3) / ranked.length); });
mkdirSync(dirname(CACHE_PATH), { recursive: true });
writeFileSync(CACHE_PATH, JSON.stringify({ scannedAt: new Date().toISOString(), trends: measured }, null, 2));
console.log(`Scanned ${ranked.length} of ${SEED_TRENDS.length} themes -> ${CACHE_PATH}`);
