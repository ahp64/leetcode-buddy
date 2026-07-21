import { dayKey, hoursUntilMidnight } from './time.js';
import { memberActivity } from './leetcode.js';
import { computeStreak, backfillHistory, isFrozen } from './streak.js';
import { channelStatus } from './notify.js';

// A freeze may only be activated with a comfortable margin — at least this
// many hours before the midnight deadline — and only once today is done.
export const FREEZE_MIN_HOURS_LEFT = 8;
export const FREEZE_MAX_DAYS = 14;

export function freezeEligibility(store, todayComplete) {
  const { members, settings, freeze } = store.data;
  const today = dayKey(new Date(), settings.timezone);
  if (members.length === 0) return { ok: false, reason: 'No members yet.' };
  if (freeze && freeze.until >= today) {
    return { ok: false, reason: `Already frozen through ${freeze.until}.` };
  }
  if (!todayComplete) {
    return { ok: false, reason: 'Everyone must solve today before you can freeze.' };
  }
  const hoursLeft = hoursUntilMidnight(settings.timezone);
  if (hoursLeft < FREEZE_MIN_HOURS_LEFT) {
    return {
      ok: false,
      reason: `Freezing closes ${FREEZE_MIN_HOURS_LEFT}h before midnight — too late for today.`,
    };
  }
  return { ok: true, reason: null };
}

// Live snapshot of the whole group: who solved today, streak, risk state.
export async function getGroupStatus(store, opts = {}) {
  const { members, settings } = store.data;
  const today = dayKey(new Date(), settings.timezone);

  const results = await Promise.allSettled(
    members.map((m) => memberActivity(m.leetcodeUsername, settings.timezone, opts))
  );

  const memberDays = new Map();
  const memberStatuses = members.map((m, i) => {
    const result = results[i];
    if (result.status === 'rejected') {
      return {
        ...publicMember(m),
        solvedToday: false,
        solvedCountToday: 0,
        lastSolve: null,
        error: result.reason?.message ?? 'Failed to reach LeetCode',
      };
    }
    const { days, lastSolve } = result.value;
    memberDays.set(m.id, days);
    return {
      ...publicMember(m),
      solvedToday: (days.get(today) ?? 0) > 0,
      solvedCountToday: days.get(today) ?? 0,
      lastSolve,
      error: null,
    };
  });

  const anyErrors = memberStatuses.some((m) => m.error);
  // Don't backfill from partial data — a failed fetch would look like a miss
  // and wrongly kill the streak.
  if (!anyErrors && members.length > 0) {
    backfillHistory(store, memberDays, today);
  }

  const { freeze } = store.data;
  const frozenToday = isFrozen(freeze, today);
  const todayComplete =
    members.length > 0 && memberStatuses.every((m) => m.solvedToday);

  // Keep today's live record up to date so the scheduler can finalize it.
  if (members.length > 0) {
    const record = store.dayRecord(today);
    for (const m of memberStatuses) {
      if (!m.error) record.solved[m.id] = m.solvedToday;
    }
    record.complete = todayComplete;
    store.save();
  }

  const { streak, atRisk } = computeStreak(
    store.data.history,
    today,
    todayComplete,
    freeze
  );

  return {
    today,
    settings,
    members: memberStatuses,
    todayComplete,
    streak,
    atRisk,
    freeze: freeze && freeze.until >= today ? freeze : null,
    frozenToday,
    canFreeze: freezeEligibility(store, todayComplete),
    channels: channelStatus(),
  };
}

function publicMember(m) {
  return {
    id: m.id,
    name: m.name,
    leetcodeUsername: m.leetcodeUsername,
    email: m.email,
    ntfyTopic: m.ntfyTopic,
    notifyEmail: m.notifyEmail,
    notifyNtfy: m.notifyNtfy,
  };
}
