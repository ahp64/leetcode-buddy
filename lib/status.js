import { dayKey } from './time.js';
import { memberActivity } from './leetcode.js';
import { computeStreak, backfillHistory } from './streak.js';
import { channelStatus } from './notify.js';

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

  const { streak, atRisk } = computeStreak(store.data.history, today, todayComplete);

  return {
    today,
    settings,
    members: memberStatuses,
    todayComplete,
    streak,
    atRisk,
    channels: channelStatus(),
  };
}

function publicMember(m) {
  return {
    id: m.id,
    name: m.name,
    leetcodeUsername: m.leetcodeUsername,
    email: m.email,
    phone: m.phone,
    notifyEmail: m.notifyEmail,
    notifySms: m.notifySms,
  };
}
