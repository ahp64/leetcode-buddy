# 🔥 LeetCode Buddy Streak

A shared accountability streak for you and your buddy (or a whole group).
**If anyone misses a day, the streak dies for everyone.**

- People are tracked by **LeetCode username** — solves are checked against
  LeetCode's public API (accepted submissions only), so nothing is
  self-reported.
- A live dashboard shows whether each person solved today, who's slacking,
  and the shared streak count.
- Slackers get reminded by **email and/or text** (per-person toggles), and
  buddies who already solved get a "your buddy is slacking" heads-up.
- **Runs entirely on GitHub** — Actions checks the streak hourly and sends
  reminders, Pages hosts the dashboard, and the group is managed from your
  browser. Nothing to install, no server to keep awake.

## Setup — all in the browser

1. **Use this template** (button above) to create your own copy.
2. Enable the dashboard: your repo → **Settings → Pages → Source: GitHub
   Actions**.
3. Add people: **Actions → Manage buddies → Run workflow** — enter a
   LeetCode username (validated automatically) and an optional display name.
   Repeat per person. Your dashboard appears at
   `https://<you>.github.io/<repo>/` and refreshes hourly.
4. Wire up reminders (optional): **Settings → Secrets and variables →
   Actions**, add:
   - `CONTACTS` — who to notify and how:
     ```json
     {
       "your-leetcode-username": { "email": "you@x.com", "phone": "+1555…", "notifyEmail": true, "notifySms": true },
       "buddys-username":        { "email": "them@x.com", "notifyEmail": true }
     }
     ```
   - Email delivery (any SMTP provider, e.g. a Gmail app password):
     `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
   - Text delivery (Twilio): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
     `TWILIO_FROM`

   Any secret you skip just logs to the workflow console instead of sending.
5. Timezone and reminder hours (default 12:00, 18:00, 21:00
   `America/Chicago`): edit [config.json](config.json) right on GitHub.

**What's public vs private:** the repo and dashboard show display names,
LeetCode usernames, and solve status — data that's already public on
leetcode.com. Emails and phone numbers only ever live in Actions secrets
(invisible to others, not copied on fork). That's also why the "Manage
buddies" form doesn't ask for contact info: workflow inputs are publicly
visible on a public repo.

**Scheduler caveats:** GitHub cron can lag up to ~15 minutes, and schedules
pause after 60 days without repo activity (re-enable from the Actions tab).

## How the streak works

- A day counts only if **every** member has at least one *accepted* LeetCode
  submission that calendar day (in the group's timezone).
- The streak is the run of consecutive complete days. Today counts once
  everyone has solved; until then it shows as ⚠️ at risk.
- Each check backfills the last 30 days from members' recent accepted
  submissions, so missed runs don't lose history.

## Running locally (optional)

The same app runs as a local server with a full management UI (add people,
toggles, settings — no GitHub round-trips):

```bash
npm install
npm start        # http://localhost:3000
```

Local state: members/settings in `config.json` (commit + push to sync your
GitHub instance), contacts in `data/contacts.json` (gitignored; push to the
secret with `npm run sync-contacts`). Reminder credentials go in `.env` — see
[.env.example](.env.example). While the server runs it schedules reminders
itself; `npm run remind` does a one-shot check for your own cron.

## Tests

```bash
npm test
```
