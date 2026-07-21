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
