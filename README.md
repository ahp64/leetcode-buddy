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
repository**. Give it any name, leave it **Public** (GitHub Pages, the free
hosting this uses, requires it), and create it. Your emails/phone numbers
never end up in the repo itself — they live in a **secret**, which nobody
but your own repo's workflows can read.

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
      "email": "you@gmail.com", "notifyEmail": true },
    { "name": "Your buddy", "leetcodeUsername": "their-leetcode-username",
      "email": "buddy@gmail.com", "notifyEmail": true }
  ]
}
```

`timezone` sets what counts as "today" (pick yours from
[this list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)).
`reminderHours` is when slackers get pinged. Add a third member the same
way — the streak then requires *all* of you.

**2. Add reminder delivery — do this too, it's what actually pings people.**
Without it, reminders only get written into a log nobody sees.

Email, via a Gmail app password (create one at
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)):

| Secret | Value |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your Gmail address |
| `SMTP_PASS` | the app password |
| `SMTP_FROM` | your Gmail address |

Text, via [Twilio](https://www.twilio.com/) (free trial works — sign up,
get a number, grab your Account SID and Auth Token):

| Secret | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | starts with `AC` |
| `TWILIO_AUTH_TOKEN` | your Auth Token |
| `TWILIO_FROM` | your Twilio number |

Fill in either or both. To change any of this later, come back and paste a
new value — GitHub never shows the old one, so keep a copy somewhere.

**If you're on a Twilio trial account**, plain text messages get rejected
with a `572006` error — trial accounts can only send pre-approved
**Content Templates**, not freeform text. (Paid accounts can skip this
entirely.) To fix it:

1. In the Twilio Console, go to **Messaging → Content Editor** → **Create
   new** → **Text** (a plain SMS template, not WhatsApp).
2. Create three templates with exactly this body text each (the `{{1}}`
   etc. are Twilio's placeholder syntax — leave them as-is):

   | Template name | Body |
   |---|---|
   | `leetcode-buddy-self` | `Hey {{1}} — no accepted LeetCode submission from you yet today. {{2}} https://leetcode.com/problemset/` |
   | `leetcode-buddy-buddy` | `Hey {{1}} — you already solved today, but {{2}} hasn't. {{3}} Maybe give them a nudge.` |
   | `leetcode-buddy-test` | `🧪 LeetCode Buddy Streak — test message. Text reminders are set up correctly!` (no placeholders) |

3. Submit/save each — for plain SMS this is typically immediate, no review
   wait (unlike WhatsApp templates).
4. Copy each template's **Content SID** (starts with `HX`) and add as
   secrets:

   | Secret | Value |
   |---|---|
   | `TWILIO_CONTENT_SID_SELF` | SID of `leetcode-buddy-self` |
   | `TWILIO_CONTENT_SID_BUDDY` | SID of `leetcode-buddy-buddy` |
   | `TWILIO_CONTENT_SID_TEST` | SID of `leetcode-buddy-test` |

Only set the ones you created — any left blank just falls back to the
plain-text send (fine on a paid account, will keep 572006-ing on a trial
one until all three are set).

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

### Freezing the streak

Going on a trip? Finals week? **Freeze** the streak for 1–14 days: frozen
days need no solves, can't kill the streak, and don't grow it either — it
picks up where it left off.

To earn a freeze, the group must **already have solved today**, with at
least **8 hours before midnight** left — freezes are planned ahead, not a
midnight escape hatch. It starts tomorrow.

The dashboard has the controls (**Freeze streak** / **Unfreeze early**).
Without a connected token they link to a one-click GitHub form; connected,
they apply instantly (see below).

## Managing everything from the dashboard (optional)

Rather not open GitHub Settings every time? Click **⚡ Connect GitHub** at
the top of the dashboard and paste in a token — it turns the whole
dashboard interactive: add/remove people, edit settings and reminder
credentials, and freeze/unfreeze, all with no page reload.

The dashboard itself walks you through creating the token — click Connect
GitHub for the exact current steps. In short: a **fine-grained personal
access token**, scoped to *only this repo*, with **Contents**, **Actions**,
and **Secrets** all set to **Read and write**.

Worth knowing before you do:

- **It's a broad token.** Those three permissions together can modify any
  non-workflow file in the repo and overwrite any secret (never read old
  values back, so a leak can't expose past PII — but it could redirect
  future reminders or the roster). Only paste it into a browser you trust.
  Skip it entirely and everything above still works manually.
- **It only lives in that browser** (localStorage) — connect separately on
  each device, and generate a separate token per person if your buddy wants
  the same convenience.
- **The page can't read `BUDDY_CONFIG` back** (nothing can), so the first
  time you edit members on a given browser, it asks you to paste the
  current value once — after that it stays in sync automatically.
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

All state lives in `data/db.json` (gitignored — same shape as the
`BUDDY_CONFIG` secret). Push your local config to your GitHub instance with
`npm run sync-config` (needs the [GitHub CLI](https://cli.github.com/)).
Reminder credentials go in `.env` — see [.env.example](.env.example). While
the server runs it schedules reminders itself; `npm run remind` does a
one-shot check for your own cron.

## Tests

```bash
npm test
```
