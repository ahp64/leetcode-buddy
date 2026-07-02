import { tzNow } from './time.js';
import { getGroupStatus } from './status.js';
import { sendEmail, sendSms } from './notify.js';

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
    if (member.notifySms && member.phone) {
      deliveries.push(
        sendSms(member.phone, `${subject}\n${body}`)
          .then(() => sent++)
          .catch((err) => console.error(`[notify] sms to ${member.name} failed:`, err.message))
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
