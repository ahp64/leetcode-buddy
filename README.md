# 🔥 LeetCode Buddy Streak

A shared accountability streak for you and your buddy (or a whole group).
**If anyone misses a day, the streak dies for everyone.**

- People are tracked by **LeetCode username** — solves are checked against
  LeetCode's public API (accepted submissions only), so nothing is
  self-reported.
- A live dashboard shows whether each person solved today, who's slacking,
  and the shared streak count.
- Slackers get reminded by **email and/or free push notification**
  (per-person toggles), and buddies who already solved get a "your buddy is
  slacking" heads-up. Solve today and you'll get a **"nice work!" message**
  the first time a check notices it.
- Earned a break? **Freeze the streak** for a few days — allowed only while
  today is already solved with at least 8 hours to spare.
- **Runs entirely on GitHub, for free** — nothing to install, no server to
  keep running. GitHub checks the streak every 15 minutes, sends the
  reminders, and hosts the dashboard page.

## Set it up (10 minutes, all in the browser)

You need a free [GitHub account](https://github.com/signup). No coding, no
command line — every step below is clicking around github.com.

### Step 1 — Make your own copy

Click the green **Use this template** button above → **Create a new
repository**. Give it any name and leave it **Public** — GitHub Pages, the
free hosting this uses, requires it. Your email never ends up in the repo
itself; it lives in a **secret**, which nobody but your own repo's
workflows can read.

### Step 2 — Configure your group and reminders

Everything — members, timezone, and reminder delivery — is set with
secrets on your repo: **Settings → Secrets and variables → Actions →
Repository secrets tab → New repository secret**.

**1. Add `BUDDY_CONFIG`** — your roster:

```json
{
  "settings": { "timezone": "America/Chicago", "reminderHours": [12, 18, 21] },
  "members": [
    { "name": "You", "leetcodeUsername": "your-leetcode-username",
      "email": "you@gmail.com", "notifyEmail": true,
      "ntfyTopic": "leetcode-buddy-x7k2p9", "notifyNtfy": true },
    { "name": "Your buddy", "leetcodeUsername": "their-leetcode-username",
      "email": "buddy@gmail.com", "notifyEmail": true }
  ]
}
```

`timezone` sets what counts as "today" (pick yours from
[this list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)).
`reminderHours` is when slackers get pinged. Add a third member the same
way — the streak then requires *all* of you. `ntfyTopic`/`notifyNtfy` are
for free push notifications, covered below.

**2. Add reminder delivery — do this too, it's what actually pings people.**
Without it, reminders only get written into a log nobody sees. Two options,
mix and match per person:

- **Push notifications, via [ntfy](https://ntfy.sh)** — free, no account,
  no secret, and the easiest to set up. Each person picks a made-up "topic"
  name (long and random, since it doubles as the shared secret — anyone who
  knows it can read/post to it), puts it in their `ntfyTopic` field above
  with `notifyNtfy: true`, and installs the
  [ntfy app](https://ntfy.sh/#subscribe) (iOS/Android/desktop), subscribing
  to that same topic name. That's the entire setup.
- **Email, via a Gmail app password** (create one at
  [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)):
  add secrets `SMTP_HOST` (`smtp.gmail.com`), `SMTP_PORT` (`587`),
  `SMTP_USER` and `SMTP_FROM` (your Gmail address), and `SMTP_PASS` (the
  app password).

Fill in whichever you want, including just ntfy — it needs no secret at
all. (Texting via Twilio isn't supported — its free trial rejects
freeform SMS and only works with pre-approved templates you can't create
without upgrading off the trial first, so there's no way to make it work
without paying.) To change any secret later, come back and paste a new
value; GitHub never shows the old one, so keep a copy somewhere.

### Step 3 — Turn on the dashboard

1. **Settings → Pages** → set **Source** to **GitHub Actions**.
2. **Actions** tab → if prompted, click *"I understand my workflows, go
   ahead and enable them"*.
3. **Streak check & dashboard** → **Run workflow** (it also runs itself
   every 15 minutes after this).

Your dashboard is `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`.

### If something looks wrong

- **Dashboard is a 404** — check Step 3, and that a workflow run finished green.
- **A run failed (red X)** — click it and read the log; errors are written
  to be understood (bad `BUDDY_CONFIG` JSON, wrong SMTP password, …).
- **Reminders a bit late / a run skipped** — GitHub's scheduler can lag or
  skip under load; the next run 15 minutes later catches it.
- **Everything stopped after ~2 months** — GitHub pauses schedules after 60
  days with no repo activity; re-enable from the Actions tab (any commit
  also resets the clock).

## How the streak works

- A day counts only if **every** member has at least one *accepted* LeetCode
  submission that calendar day (in the group's timezone).
- The streak is the run of consecutive complete days. Today counts once
  everyone has solved; until then it shows as ⚠️ at risk.
- Each check backfills the last 30 days from members' recent accepted
  submissions, so missed runs don't lose history.
- The first check that sees you've solved today sends a "nice work!"
  message (same channels as reminders) — a one-time pat on the back, not
  repeated on every later check that day.

### Freezing the streak

Going on a trip? Finals week? **Freeze** the streak for 1–14 days: frozen
days need no solves, can't kill the streak, and don't grow it either — it
picks up where it left off. To earn one, the group must **already have
solved today**, with at least **8 hours before midnight** left — freezes
are planned ahead, not a midnight escape hatch. It starts tomorrow.

The dashboard has the controls (**Freeze streak** / **Unfreeze early**).
Without a connected token they link to a one-click GitHub form; connected,
they apply instantly (see below).

## Managing everything from the dashboard (optional)

Rather not open GitHub Settings every time? Click **⚡ Connect GitHub** at
the top of the dashboard and paste in a token — it turns the whole
dashboard interactive: add/remove people, edit settings and reminder
credentials, and freeze/unfreeze, all with no page reload. The dashboard
itself walks you through creating the token — click Connect GitHub for the
exact current steps. In short: a **fine-grained personal access token**,
scoped to *only this repo*, with **Contents**, **Actions**, and
**Secrets** all set to **Read and write**.

Worth knowing before you do:

- **It's a broad token.** Those three permissions together can modify any
  non-workflow file in the repo and overwrite any secret — never read old
  values back, so a leak can't expose past PII, but it could redirect
  future reminders or the roster. Only paste it into a browser you trust;
  skip it entirely and everything above still works manually.
- **It only lives in that browser** (localStorage) — connect separately on
  each device, and generate a separate token per person if your buddy wants
  the same convenience.
- **The page can't read `BUDDY_CONFIG` back** (nothing can), so the first
  time you edit members on a given browser, it asks you to paste the
  current value once; after that it stays in sync automatically.
- It loads a small encryption library ([libsodium](https://doc.libsodium.org/))
  from a CDN to do the writes, pinned to exact versions with integrity
  hashes so the browser won't run anything but the verified bytes.

## Running locally (optional, for developers)

The same app runs as a local server with a full management UI (add people
with automatic username validation, toggles, settings, freezing):

```bash
npm install
npm start        # http://localhost:3000
```

Members/settings live in `data/db.json` (gitignored — same shape as the
`BUDDY_CONFIG` secret); freeze state and daily history live in the
committed `freeze.json`/`history.json`. Push your local config to your
GitHub instance with `npm run sync-config` (needs the
[GitHub CLI](https://cli.github.com/)). Reminder credentials go in `.env`
— see [.env.example](.env.example). While the server runs it schedules
reminders (and congrats) itself; `npm run remind` does a one-shot reminder
check for your own cron.

## Tests

```bash
npm test
```
