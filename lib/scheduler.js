import { tzNow } from './time.js';
import { getGroupStatus } from './status.js';
import { sendEmail, sendSms, sendNtfy } from './notify.js';

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

    let subject, body, template;
    if (!member.solvedToday) {
      subject = '⏰ You haven\'t solved a LeetCode problem today';
      body =
        `Hey ${member.name} — no accepted LeetCode submission from you yet today. ` +
        streakLine +
        ` https://leetcode.com/problemset/`;
      if (process.env.TWILIO_CONTENT_SID_SELF) {
        template = {
          contentSid: process.env.TWILIO_CONTENT_SID_SELF,
          variables: { 1: member.name, 2: streakLine },
        };
      }
    } else {
      const names = slackers.map((s) => s.name).join(' and ');
      subject = `🚨 ${names} ${slackers.length === 1 ? 'is' : 'are'} slacking on LeetCode`;
      body =
        `Hey ${member.name} — you already solved today, but ${names} hasn\'t. ` +
        streakLine +
        ` Maybe give them a nudge.`;
      if (process.env.TWILIO_CONTENT_SID_BUDDY) {
        template = {
          contentSid: process.env.TWILIO_CONTENT_SID_BUDDY,
          variables: { 1: member.name, 2: names, 3: streakLine },
        };
      }
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
        sendSms(member.phone, `${subject}\n${body}`, template)
          .then(() => sent++)
          .catch((err) => console.error(`[notify] sms to ${member.name} failed:`, err.message))
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

// Sends a clearly-marked test message to every member with a toggle+contact
// set, ignoring solve status entirely — for verifying SMTP/Twilio
// credentials actually work, independent of streak logic. Reports each
// attempt individually so a bad password/token shows up as a specific
// failure rather than a silent no-op.
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
    if (member.notifySms && member.phone) {
      try {
        const template = process.env.TWILIO_CONTENT_SID_TEST
          ? { contentSid: process.env.TWILIO_CONTENT_SID_TEST }
          : undefined;
        const r = await sendSms(
          member.phone,
          `🧪 LeetCode Buddy Streak — test message. Text reminders are set up correctly!`,
          template
        );
        results.push({ member: member.name, channel: 'sms', ok: true, fallback: Boolean(r.fallback) });
      } catch (err) {
        results.push({ member: member.name, channel: 'sms', ok: false, error: err.message });
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
      message: 'Nobody has email/text/ntfy reminders toggled on with contact info filled in — nothing to test.',
    };
  }

  const delivered = results.filter((r) => r.ok && !r.fallback);
  const loggedOnly = results.filter((r) => r.ok && r.fallback);
  const failed = results.filter((r) => !r.ok);

  const parts = [];
  if (delivered.length) parts.push(`${delivered.length} delivered`);
  if (loggedOnly.length) parts.push(`${loggedOnly.length} logged only (no SMTP/Twilio secrets configured)`);
  if (failed.length) {
    parts.push(
      `${failed.length} failed: ${failed.map((f) => `${f.member} (${f.channel}): ${f.error}`).join('; ')}`
    );
  }

  return { sent: delivered.length, results, message: `Test message — ${parts.join(', ')}.` };
}
