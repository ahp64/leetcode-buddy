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
- **Runs entirely on GitHub, for free** — nothing to install, no server to
  keep running. GitHub checks the streak every hour, sends the reminders,
  and hosts the dashboard page.

## Set it up (10 minutes, all in the browser)

You need a free [GitHub account](https://github.com/signup). No coding, no
command line — every step below is clicking around github.com.

Two GitHub features do all the work, so here's what they are in one line
each:

- **GitHub Actions** — GitHub runs small jobs for you on its own computers,
  on a schedule or when you press a button. This project uses it to check
  LeetCode and send reminders.
- **GitHub Pages** — GitHub hosts a website for your repository for free.
  This project uses it for the dashboard.

### Step 1 — Make your own copy of this project

1. At the top of this page, click the green **Use this template** button →
   **Create a new repository**.
2. Give it any name (e.g. `leetcode-streak`), leave it set to **Public**,
   and click **Create repository**.

> Why Public? GitHub Pages is only free on public repositories. Don't worry:
> the only personal things a copy of this project ever shows are LeetCode
> usernames and solve activity — which are already public on leetcode.com.
> Emails and phone numbers are stored as *secrets* (Step 4), which nobody
> but your own workflows can read.

Everything from here happens **in your new copy**, not in this original repo.

### Step 2 — Turn on the dashboard website

1. In your repo, click the **Settings** tab (top of the page).
2. In the left sidebar, click **Pages**.
3. Under "Build and deployment", set **Source** to **GitHub Actions**.

That's it — your dashboard's address will be
`https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`. It will show content
after the first workflow run (next step).

### Step 3 — Add yourself and your buddy

1. Click the **Actions** tab. If GitHub shows a button saying
   *"I understand my workflows, go ahead and enable them"*, click it (GitHub
   disables workflows on fresh template copies until you opt in).
2. In the left sidebar, click **Manage buddies**.
3. On the right, click the **Run workflow** dropdown. Fill in:
   - **Add or remove?** → `add`
   - **LeetCode username** → your exact LeetCode username (the one in your
     leetcode.com profile URL)
   - **Display name** → whatever you want the dashboard to call you
     (optional)
4. Click the green **Run workflow** button. A run appears in the list —
   yellow dot means running, green check means done (~1 minute). If the
   username has a typo, the run fails with a red X and the log tells you why.
5. Repeat for your buddy (and anyone else — the streak then requires *all*
   of you to solve daily).

Now open your dashboard URL from Step 2 — you should see everyone listed
with today's status. It refreshes itself every hour. (Want it fresher right
now? Actions → **Streak check & dashboard** → Run workflow.)

The dashboard itself has links back to these GitHub forms, so you can manage
everything from the page you'll actually be looking at.

### Step 4 — Turn on email/text reminders (optional but recommended)

Without this step everything still works — you just won't get pinged when
someone's slacking.

Reminder settings live in **secrets**: values only your repo's workflows can
read. Even on a public repo, nobody else can ever see them. To add one:
**Settings** tab → **Secrets and variables** → **Actions** → green
**New repository secret** button.

**4a. Who gets notified — add a secret named `CONTACTS`**

Its value is a snippet in this shape (edit the usernames and details, keep
the quotes and braces):

```json
{
  "your-leetcode-username": {
    "email": "you@gmail.com",
    "phone": "+15551234567",
    "notifyEmail": true,
    "notifySms": true
  },
  "buddys-leetcode-username": {
    "email": "buddy@gmail.com",
    "notifyEmail": true
  }
}
```

`notifyEmail` / `notifySms` are the per-person toggles. Leave out `phone`
and `notifySms` for someone who only wants email, etc. To change it later,
open the secret and paste a new value (GitHub never shows you the old one —
keep a copy somewhere if you like).

**4b. How email gets sent — add SMTP secrets**

The easiest route is a Gmail **app password** (requires 2-step verification
on your Google account): go to
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
create one, and copy the 16-character password. Then add these five secrets:

| Secret name | Value (for Gmail) |
|---|---|
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | your full Gmail address |
| `SMTP_PASS` | the 16-character app password |
| `SMTP_FROM` | your full Gmail address |

(Any other email provider's SMTP details work the same way.)

**4c. How texts get sent — add Twilio secrets**

Texts need a [Twilio](https://www.twilio.com/) account (free trial works:
sign up, get a phone number, find your Account SID and Auth Token on the
console home page). Add:

| Secret name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | your Account SID (starts with `AC`) |
| `TWILIO_AUTH_TOKEN` | your Auth Token |
| `TWILIO_FROM` | your Twilio phone number, like `+15559876543` |

Skip any of 4b/4c you don't want — whatever isn't configured is simply
logged inside the workflow run instead of sent, which is also how you can
test: Actions → **Streak check & dashboard** → Run workflow → open the run →
click the **streak** job → expand "Send reminders" to see what it did.

### Step 5 — Set your timezone and reminder times

Reminder times default to **12:00, 18:00, and 21:00 in America/Chicago**.
To change them:

1. In your repo's file list, click **`config.json`**, then the pencil icon
   (✏️) to edit it in the browser.
2. Set `"timezone"` to yours — pick the exact name from
   [this list](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
   (e.g. `America/New_York`), and `"reminderHours"` to any hours 0–23.
3. Click **Commit changes**.

A "day" for the streak = a calendar day in this timezone, so a 11:58pm solve
still counts.

### If something looks wrong

- **Dashboard is a 404** — check Step 2 (Pages source must be "GitHub
  Actions") and that at least one **Streak check & dashboard** run has
  finished green in the Actions tab.
- **A run failed (red X)** — click it and read the log; the error messages
  are written to be understood (bad username, malformed `CONTACTS` JSON,
  wrong SMTP password, …).
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

## Running locally (optional, for developers)

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
