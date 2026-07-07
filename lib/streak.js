import { prevDayKey } from './time.js';

// A freeze ({ from, until } inclusive day keys) waives the daily requirement:
// frozen days can't break the streak, but they don't grow it either.
export function isFrozen(freeze, day) {
  return Boolean(freeze && day >= freeze.from && day <= freeze.until);
}

// Streak = consecutive days (ending today or yesterday) where EVERY member
// solved at least one problem, skipping over frozen days. Today only adds to
// the count once everyone has solved; until then the streak survives on
// yesterday's record but is flagged as at-risk (unless today is frozen).
export function computeStreak(history, todayKey, todayComplete, freeze = null) {
  let count = 0;
  let day = prevDayKey(todayKey);
  while (true) {
    if (isFrozen(freeze, day)) {
      day = prevDayKey(day); // preserved, not counted
      continue;
    }
    if (!history[day]?.complete) break;
    count += 1;
    day = prevDayKey(day);
  }
  const frozenToday = isFrozen(freeze, todayKey);
  const streak = count + (todayComplete && !frozenToday ? 1 : 0);
  return {
    streak,
    atRisk: !todayComplete && !frozenToday && count > 0,
  };
}

// Fill in past days we have no record for (server was off, or first run)
// using each member's recent accepted submissions. Only fills days where we
// have live data for every member; stops at the first gap it can't judge.
export function backfillHistory(store, memberDays, todayKey, maxDays = 30) {
  const members = store.data.members;
  if (members.length === 0) return;
  let day = prevDayKey(todayKey);
  for (let i = 0; i < maxDays; i++) {
    if (!store.data.history[day]) {
      const solved = {};
      for (const m of members) {
        solved[m.id] = (memberDays.get(m.id)?.get(day) ?? 0) > 0;
      }
      const record = store.dayRecord(day);
      record.solved = solved;
      record.complete = members.every((m) => solved[m.id]);
      record.backfilled = true;
    }
    day = prevDayKey(day);
  }
  store.save();
}
