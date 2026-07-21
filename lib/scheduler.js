import { tzNow } from './time.js';
import { getGroupStatus } from './status.js';
import { sendEmail, sendNtfy } from './notify.js';

// Minute tick instead of cron: compares wall-clock time in the group's
// timezone, so changing the timezone in settings takes effect immediately
// and a laptop waking from sleep just picks up on the next tick.
export function startScheduler(store) {
  const tick = () => runTick(store).catch((err) =>
    console.error('[scheduler] tick failed:', err.message)
  );
  setInterval(tick, 60 * 1000);
  tick();
}

async function runTick(store) {
  const { settings, members } = store.data;
  if (members.length === 0) return;

  // Congrats checks every tick (not gated to reminder hours) so they land
  // as soon as a solve is detected, not just at scheduled reminder times.
  // Uses the default (cached) LeetCode lookup rather than forcing a fresh
  // fetch every 60s — the congratsSent guard means it only ever actually
  // sends once per member per day regardless of how often this runs.
  await sendCongrats(store).catch((err) =>
    console.error('[scheduler] congrats check failed:', err.message)
  );

  const { day, hour, minute } = tzNow(settings.timezone);
  if (!settings.reminderHours.includes(hour) || minute >= 5) return;

  const record = store.dayRecord(day);
  if (record.remindersSent[hour]) return;
  record.remindersSent[hour] = true;
  store.save();

  await sendReminders(store, { fresh: true });
}

// Checks live status and messages everyone according to their toggles:
// slackers get a nudge, buddies who already solved get a heads-up that the
// shared streak is in danger. Returns a summary for the API/UI.
export async function sendReminders(store, opts = {}) {
  const status = await getGroupStatus(store, opts);
  if (status.frozenToday) {
    return {
      sent: 0,
      slackers: [],
      message: `Streak is frozen through ${status.freeze.until} — no reminders needed.`,
    };
  }
  const slackers = status.members.filter((m) => !m.solvedToday && !m.error);
  if (slackers.length === 0 || status.todayComplete) {
    return { sent: 0, slackers: [], message: 'Everyone has solved today — no reminders needed.' };
  }

  const streakLine =
    status.streak > 0
      ? `The shared ${status.streak}-day streak dies at midnight for EVERYONE unless they solve.`
      : `Get a problem in before midnight to keep the group streak alive.`;

  let sent = 0;
  const deliveries = [];
  for (const member of status.members) {
    if (member.error) continue;

    let subject, body;
    if (!member.solvedToday) {
      subject = '⏰ You haven\'t solved a LeetCode problem today';
      body =
        `Hey ${member.name} — no accepted LeetCode submission from you yet today. ` +
        streakLine +
        ` https://leetcode.com/problemset/`;
    } else {
      const names = slackers.map((s) => s.name).join(' and ');
      subject = `🚨 ${names} ${slackers.length === 1 ? 'is' : 'are'} slacking on LeetCode`;
      body =
        `Hey ${member.name} — you already solved today, but ${names} hasn\'t. ` +
        streakLine +
        ` Maybe give them a nudge.`;
    }

    if (member.notifyEmail && member.email) {
      deliveries.push(
        sendEmail(member.email, subject, body)
          .then(() => sent++)
          .catch((err) => console.error(`[notify] email to ${member.name} failed:`, err.message))
      );
    }
    if (member.notifyNtfy && member.ntfyTopic) {
      deliveries.push(
        sendNtfy(member.ntfyTopic, subject, body)
          .then(() => sent++)
          .catch((err) => console.error(`[notify] ntfy to ${member.name} failed:`, err.message))
      );
    }
  }
  await Promise.all(deliveries);
  return {
    sent,
    slackers: slackers.map((s) => s.name),
    message: `Reminder check ran — ${slackers.map((s) => s.name).join(', ')} still need${slackers.length === 1 ? 's' : ''} to solve. ${sent} notification${sent === 1 ? '' : 's'} dispatched.`,
  };
}

// Sends a one-time "nice work" message to each member the first time a
// given check sees they've solved today — a positive counterpart to the
// slacker reminders. `congratsSent` on the day record guards against
// re-sending on every subsequent check once someone's already solved.
export async function congratsForStatus(store, status) {
  const record = store.dayRecord(status.today);
  let sent = 0;
  const congratulated = [];
  const deliveries = [];

  for (const member of status.members) {
    if (member.error || !member.solvedToday) continue;
    if (record.congratsSent[member.id]) continue;
    record.congratsSent[member.id] = true;
    congratulated.push(member.name);

    const subject = '🎉 Nice work!';
    const body = member.lastSolve
      ? `Hey ${member.name} — nice job solving "${member.lastSolve.title}" today! Keep the streak going.`
      : `Hey ${member.name} — nice job, you solved a LeetCode problem today! Keep the streak going.`;

    if (member.notifyEmail && member.email) {
      deliveries.push(
        sendEmail(member.email, subject, body)
          .then(() => sent++)
          .catch((err) => console.error(`[notify] congrats email to ${member.name} failed:`, err.message))
      );
    }
    if (member.notifyNtfy && member.ntfyTopic) {
      deliveries.push(
        sendNtfy(member.ntfyTopic, subject, body)
          .then(() => sent++)
          .catch((err) => console.error(`[notify] congrats ntfy to ${member.name} failed:`, err.message))
      );
    }
  }

  if (congratulated.length > 0) store.save();
  await Promise.all(deliveries);
  return { sent, congratulated };
}

export async function sendCongrats(store, opts = {}) {
  const status = await getGroupStatus(store, opts);
  return congratsForStatus(store, status);
}

// Sends a clearly-marked test message to every member with a toggle+contact
// set, ignoring solve status entirely — for verifying email/ntfy delivery
// actually works, independent of streak logic. Reports each attempt
// individually so a bad password shows up as a specific failure rather
// than a silent no-op.
export async function sendTestNotifications(store) {
  const { members } = store.data;
  if (members.length === 0) {
    return { sent: 0, results: [], message: 'No members yet — add someone first.' };
  }

  const results = [];
  for (const member of members) {
    if (member.notifyEmail && member.email) {
      try {
        const r = await sendEmail(
          member.email,
          '🧪 LeetCode Buddy Streak — test message',
          `Hey ${member.name} — this is a test to confirm email reminders are set up correctly. If you got this, you're good to go!`
        );
        results.push({ member: member.name, channel: 'email', ok: true, fallback: Boolean(r.fallback) });
      } catch (err) {
        results.push({ member: member.name, channel: 'email', ok: false, error: err.message });
      }
    }
    if (member.notifyNtfy && member.ntfyTopic) {
      try {
        const r = await sendNtfy(
          member.ntfyTopic,
          '🧪 LeetCode Buddy Streak — test message',
          `Hey ${member.name} — this is a test to confirm ntfy reminders are set up correctly. If you got this, you're good to go!`
        );
        results.push({ member: member.name, channel: 'ntfy', ok: true, fallback: Boolean(r.fallback) });
      } catch (err) {
        results.push({ member: member.name, channel: 'ntfy', ok: false, error: err.message });
      }
    }
  }

  if (results.length === 0) {
    return {
      sent: 0,
      results,
      message: 'Nobody has email/ntfy reminders toggled on with contact info filled in — nothing to test.',
    };
  }

  const delivered = results.filter((r) => r.ok && !r.fallback);
  const loggedOnly = results.filter((r) => r.ok && r.fallback);
  const failed = results.filter((r) => !r.ok);

  const parts = [];
  if (delivered.length) parts.push(`${delivered.length} delivered`);
  if (loggedOnly.length) parts.push(`${loggedOnly.length} logged only (no SMTP secret configured)`);
  if (failed.length) {
    parts.push(
      `${failed.length} failed: ${failed.map((f) => `${f.member} (${f.channel}): ${f.error}`).join('; ')}`
    );
  }

  return { sent: delivered.length, results, message: `Test message — ${parts.join(', ')}.` };
}
