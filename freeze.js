// Freeze or unfreeze the streak from the command line — used by the
// "Freeze streak" / "Unfreeze streak" GitHub Actions buttons, and handy
// locally too. Persists to freeze.json (committed; dates are public-safe).
//
// Usage:
//   node freeze.js freeze [days]   # default 1, max 14; starts tomorrow
//   node freeze.js unfreeze
//
// Freezing enforces the earn-it rules against live LeetCode data: everyone
// must have solved today, with at least 8 hours left before midnight.
import { createStore } from './lib/store.js';
import {
  getGroupStatus,
  freezeEligibility,
  FREEZE_MAX_DAYS,
} from './lib/status.js';
import { dayKey, addDays } from './lib/time.js';

const [action, daysArg] = process.argv.slice(2);

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const store = createStore();

if (action === 'unfreeze') {
  const hadFreeze = Boolean(store.data.freeze);
  store.data.freeze = null;
  store.save(); // always writes freeze.json so it exists for the CI commit
  console.log(
    hadFreeze
      ? 'Unfrozen ❄️→🔥 — daily solves are required again starting today.'
      : 'No freeze was active — nothing to change.'
  );
} else if (action === 'freeze') {
  const days = Number(daysArg ?? 1);
  if (!Number.isInteger(days) || days < 1 || days > FREEZE_MAX_DAYS) {
    fail(`days must be a whole number from 1 to ${FREEZE_MAX_DAYS}.`);
  }
  const status = await getGroupStatus(store, { fresh: true });
  const eligibility = freezeEligibility(store, status.todayComplete);
  if (!eligibility.ok) fail(eligibility.reason);
  const today = dayKey(new Date(), store.data.settings.timezone);
  store.data.freeze = {
    activatedOn: today,
    from: addDays(today, 1),
    until: addDays(today, days),
  };
  store.save();
  console.log(
    `Frozen ❄️ from ${store.data.freeze.from} through ${store.data.freeze.until} — enjoy the break.`
  );
} else {
  fail('first argument must be "freeze" or "unfreeze"');
}
