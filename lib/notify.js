import nodemailer from 'nodemailer';

// Both channels degrade gracefully: with no credentials configured, the
// message is printed to the server console so the app still works end to end.

let transport = null;
function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transport;
}

export function channelStatus() {
  return {
    email: Boolean(process.env.SMTP_HOST),
    sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
    // No account/secret needed — ntfy.sh's public server accepts
    // unauthenticated posts to any topic. Always available; the only
    // per-person setup is picking a topic name and subscribing in the app.
    ntfy: true,
  };
}

export async function sendEmail(to, subject, text) {
  const t = getTransport();
  if (!t) {
    console.log(`[email:console-fallback] to=${to} subject="${subject}"\n${text}`);
    return { sent: false, fallback: true };
  }
  await t.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text,
  });
  return { sent: true };
}

// `template` is optional: { contentSid, variables }. Twilio trial accounts
// reject freeform SMS bodies (error 572006) and require a pre-approved
// Content Template instead — see README for how to create one and which
// env var maps to which message. Paid/non-trial accounts can ignore this
// and keep sending plain text.
export async function sendSms(to, body, template) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } =
    process.env;
  if (!sid || !token || !from) {
    console.log(`[sms:console-fallback] to=${to}\n${body}`);
    return { sent: false, fallback: true };
  }
  const params = { To: to, From: from };
  if (template?.contentSid) {
    params.ContentSid = template.contentSid;
    if (template.variables) params.ContentVariables = JSON.stringify(template.variables);
  } else {
    params.Body = body;
  }
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(params),
    }
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Twilio error ${res.status}: ${detail}`);
  }
  return { sent: true };
}

const NTFY_SERVER = process.env.NTFY_SERVER ?? 'https://ntfy.sh';

// ntfy.sh: a free, unauthenticated push-notification pub/sub service — the
// topic name is the shared secret, no account or API key involved. The
// recipient subscribes to the same topic in the ntfy app to receive posts.
// Uses the JSON publish endpoint rather than the Title/… HTTP headers ntfy
// also supports, since HTTP headers are Latin-1 only and these messages
// contain emoji — JSON keeps titles UTF-8 safe.
export async function sendNtfy(topic, title, message) {
  if (!topic) {
    console.log(`[ntfy:console-fallback] no topic set — title="${title}"\n${message}`);
    return { sent: false, fallback: true };
  }
  const res = await fetch(NTFY_SERVER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, title, message }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`ntfy error ${res.status}: ${detail}`);
  }
  return { sent: true };
}
