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
  keep running. GitHub checks the streak every hour, sends the reminders,
  and hosts the dashboard page. The whole group is configured with **one
  secret**.

## Set it up (10 minutes, all in the browser)

You need a free [GitHub account](https://github.com/signup). No coding, no
command line — every step below is clicking around github.com.

Two GitHub features do all the work, so here's what they are in one line
each:

- **GitHub Actions** — GitHub runs small jobs for you on its own computers,
  on a schedule. This project uses it to check LeetCode and send reminders.
- **GitHub Pages** — GitHub hosts a website for your repository for free.
  This project uses it for the dashboard.

### Step 1 — Make your own copy of this project

1. At the top of this page, click the green **Use this template** button →
   **Create a new repository**.
2. Give it any name (e.g. `leetcode-streak`), leave it set to **Public**,
   and click **Create repository**.

> Why Public? GitHub Pages is only free on public repositories. Don't worry:
> the dashboard only ever shows LeetCode usernames and solve activity —
> which are already public on leetcode.com. Your emails and phone numbers
> live in a *secret* (next step), which nobody but your own repo's workflows
> can read.

Everything from here happens **in your new copy**, not in this original repo.

### Step 2 — Configure your group with one secret

A **secret** is a value stored with your repo that only your own workflows
can read — it never appears in code or on the dashboard, even though the
repo is public.

1. In your repo: **Settings** tab → **Secrets and variables** → **Actions**
   → green **New repository secret** button.
2. Name: `BUDDY_CONFIG`
3. Value: copy this and edit it for your group (keep every quote and brace):

```json
{
  "settings": {
    "timezone": "America/Chicago",
    "reminderHours": [12, 18, 21]
  },
  "members": [
    {
      "name": "You",
      "leetcodeUsername": "your-leetcode-username",
      "email": "you@gmail.com",
      "phone": "+15551234567",
      "notifyEmail": true,
      "notifySms": true
    },
    {
      "name": "Your buddy",
      "leetcodeUsername": "their-leetcode-username",
      "email": "buddy@gmail.com",
      "notifyEmail": true
    }
  ]
}
```

What the fields mean:

- `timezone` — a "day" for the streak is a calendar day here (so an 11:58pm
  solve still counts). Pick the exact name from
  [this list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones),
  e.g. `America/New_York`.
- `reminderHours` — hours (0–23) when slackers get pinged.
- `leetcodeUsername` — the name in your leetcode.com profile URL. If it's
  mistyped, the dashboard shows a ❓ for that person with an error message.
- `notifyEmail` / `notifySms` — that person's reminder toggles; leave out
  `phone`/`notifySms` for someone who only wants email, and so on. Add a
  third member the same way — the streak then requires *all* of you.

To change anything later (add a buddy, change hours, toggle reminders):
come back here, open the secret, and paste an updated value. GitHub never
shows you the old value, so keep a copy somewhere handy (a note, a gist —
anywhere).

### Step 3 — Turn on the dashboard website

1. **Settings** tab → **Pages** (left sidebar).
2. Under "Build and deployment", set **Source** to **GitHub Actions**.
3. Click the **Actions** tab. If GitHub shows *"I understand my workflows,
   go ahead and enable them"*, click it (fresh template copies start with
   workflows off).
4. In the left sidebar click **Streak check & dashboard** → **Run workflow**
   to do the first run now (afterwards it runs itself every hour).

Your dashboard is at `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/` —
it shows the streak, everyone's status today, and links back to the secret
for making changes.

### Step 4 — Make reminders actually send (optional)

Without this step, reminders are only written into the workflow's log. To
really deliver them, add more secrets (same as Step 2):

**Email — via a Gmail app password** (needs 2-step verification on your
Google account): create one at
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
then add these five secrets:

| Secret name | Value (for Gmail) |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your full Gmail address |
| `SMTP_PASS` | the 16-character app password |
| `SMTP_FROM` | your full Gmail address |

(Any other email provider's SMTP details work the same way.)

**Texts — via [Twilio](https://www.twilio.com/)** (free trial works): sign
up, get a phone number, find your Account SID and Auth Token on the console
home page, and add:

| Secret name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | your Account SID (starts with `AC`) |
| `TWILIO_AUTH_TOKEN` | your Auth Token |
| `TWILIO_FROM` | your Twilio number, like `+15559876543` |

To test: Actions → **Streak check & dashboard** → Run workflow → open the
run → expand "Send reminders" to see exactly what it did.

### If something looks wrong

- **Dashboard is a 404** — check Step 3 (Pages source must be "GitHub
  Actions") and that at least one workflow run finished green.
- **A run failed (red X)** — click it and read the log; the errors are
  written to be understood (malformed `BUDDY_CONFIG` JSON, wrong SMTP
  password, …).
- **Reminders arrive a bit late** — GitHub's scheduler can lag up to ~15
  minutes past the hour. Normal.
- **Everything stopped after ~2 months** — GitHub pauses schedules after 60
  days with no repo activity. Open the Actions tab and click the banner's
  re-enable button (any commit also resets the clock).

## How the streak works

- A day counts only if **every** member has at least one *accepted* LeetCode
  submission that calendar day (in the group's timezone).
- The streak is the run of consecutive complete days. Today counts once
  everyone has solved; until then it shows as ⚠️ at risk.
- Each check backfills the last 30 days from members' recent accepted
  submissions, so missed runs don't lose history.

### Freezing the streak

Going on a trip? Finals week? You can **freeze** the streak for 1–14 days:
frozen days need no solves, can't kill the streak, and don't grow it either
— it picks up where it left off.

To earn a freeze, the group must **already have solved today**, and it must
be at least **8 hours before midnight** (your timezone) — freezes are
planned ahead, not a midnight escape hatch. It starts tomorrow and covers
the number of days you choose.

The dashboard has the controls: when you're eligible, a **Freeze streak**
button appears; while frozen, an **Unfreeze early** button appears. On the
hosted dashboard these take you to a one-click GitHub form ("Run workflow")
that checks the rules and updates the page; on the local app they apply
instantly. The freeze state itself lives in [freeze.json](freeze.json) —
just dates, nothing private — so the workflows can update it with a plain
commit.

**Optional: true one-click controls on the hosted page.** The freeze card
offers "⚡ Connect GitHub" — paste in a token once, and the Freeze/Unfreeze
buttons run the workflows directly from the page, no trip to the Actions
tab. (The same earn-it rules are still enforced by the workflow itself.)

Creating that token, exactly:

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   (GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Generate new token). Don't use the "classic"
   token page — classic tokens can't be limited to one repo.
2. Under **Repository access**, choose **Only select repositories** and
   pick your streak repo. ⚠️ Not "Public repositories" — that option forces
   the whole token to read-only and hides the write permissions.
3. Under **Permissions → Repository permissions** you'll see a long list of
   specific permissions, each with its own **Access** dropdown on the
   right. Find the **Actions** row ("Workflows, workflow runs and
   artifacts") and set it to **Read and write**. Leave every other row on
   "No access" — you don't need *Workflows* (editing workflow files) or
   *Contents* (repo code), and *Metadata: Read-only* switches on by itself,
   which is normal and required.
4. **Generate token**, copy the `github_pat_…` value (it's shown once), and
   paste it into the dashboard's Connect panel.

Scoped this way, the token can only trigger and read workflow runs on this
one repo — it can't touch code, secrets, or any other repository, so even
the worst-case leak from your browser is somebody toggling your freeze.

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
