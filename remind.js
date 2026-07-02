// Standalone reminder check for running from cron/launchd/GitHub Actions
// instead of (or in addition to) the always-on server.
//
// Usage: node remind.js [--if-scheduled] [--force]
//   --if-scheduled  exit quietly unless the current hour (in the group's
//                   timezone) is one of the configured reminder hours; lets
//                   an hourly runner (e.g. GitHub Actions cron, which is
//                   UTC-only) delegate hour/DST logic to the app settings
//   --force         send even if this hour was already marked sent
//
// Shares data/db.json and the per-hour sent-guard with the server's built-in
// scheduler, so whichever fires first for a given hour wins and the other
// skips — no double texts.
import 'dotenv/config';
import { createStore } from './lib/store.js';
import { sendReminders } from './lib/scheduler.js';
import { tzNow } from './lib/time.js';

const store = createStore();

if (store.data.members.length === 0) {
  console.log('No members in the streak yet — nothing to do.');
  process.exit(0);
}

const { day, hour } = tzNow(store.data.settings.timezone);
const { reminderHours, timezone } = store.data.settings;
if (process.argv.includes('--if-scheduled') && !reminderHours.includes(hour)) {
  console.log(
    `${String(hour).padStart(2, '0')}:00 ${timezone} is not a reminder hour (${reminderHours.join(', ')}) — skipping.`
  );
  process.exit(0);
}

const record = store.dayRecord(day);
if (record.remindersSent[hour] && !process.argv.includes('--force')) {
  console.log(
    `Reminders already sent for ${day} ${String(hour).padStart(2, '0')}:00 — pass --force to resend.`
  );
  process.exit(0);
}
record.remindersSent[hour] = true;
store.save();

const result = await sendReminders(store, { fresh: true });
console.log(`[${day} ${String(hour).padStart(2, '0')}:00] ${result.message}`);
