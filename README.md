# 🔥 LeetCode Buddy Streak

A shared accountability streak for you and your buddy (or a whole group).
**If anyone misses a day, the streak dies for everyone.**

- Add people by **LeetCode username** — solves are checked against LeetCode's
  public API (accepted submissions only), so nothing is self-reported.
- The dashboard shows whether each person has solved today, who's slacking,
  and the shared streak count.
- Slackers get reminded by **email and/or text** (per-person toggles), and
  buddies who already solved get a "your buddy is slacking" heads-up.
- **Runs entirely on GitHub if you want**: Actions sends the reminders on a
  schedule and Pages hosts a live read-only dashboard — no server to keep
  awake.

This repo is a template — your personal config (emails, phone numbers) never
enters git. It lives in gitignored local files and, for GitHub-hosted mode,
in your repo's Actions secrets.

## Get your own streak

1. Click **Use this template** (or fork) → clone your copy.
2. ```bash
   npm install
   npm start        # http://localhost:3000
   ```
3. Add yourself and your buddy in the UI: LeetCode username, plus email/phone
   and reminder toggles if wanted. Timezone and reminder hours (default
   12:00, 18:00, 21:00) are editable in the UI.

That's fully functional on its own — the built-in scheduler sends reminders
while the server runs. The rest is optional.

## Host it on GitHub (recommended)

Reminders fire from GitHub Actions and a read-only dashboard is published to
GitHub Pages, so nothing needs to run on your machine.

```bash
# one-time, from your clone (needs the GitHub CLI, `gh`)
gh api repos/{owner}/{repo}/pages -X POST -f build_type=workflow   # enable Pages
npm run sync-config    # upload data/db.json (members/settings) as the BUDDY_CONFIG secret
```

Re-run `npm run sync-config` whenever you add/remove people or change
settings locally.

For real email/text delivery, add these repo secrets (any you skip just log
to the Actions console instead):

```bash
gh secret set SMTP_HOST; gh secret set SMTP_PORT; gh secret set SMTP_USER
gh secret set SMTP_PASS; gh secret set SMTP_FROM
gh secret set TWILIO_ACCOUNT_SID; gh secret set TWILIO_AUTH_TOKEN; gh secret set TWILIO_FROM
```

(Locally, the same values go in `.env` — see `.env.example`.)

The workflow ([.github/workflows/streak.yml](.github/workflows/streak.yml))
runs hourly: every run refreshes the dashboard at
`https://<you>.github.io/<repo>/`, and runs that land on one of your
configured reminder hours (in your group's timezone) also send reminders.
Trigger it manually anytime from the Actions tab.

**What's public vs private:** the Pages dashboard shows display names,
LeetCode usernames, and solve status — data that's already public on
leetcode.com. Emails, phone numbers, and toggles stay in secrets and are
stripped from the published snapshot. Never commit `data/` or `.env` (both
gitignored).

**Scheduler caveats:** GitHub cron can lag up to ~15 minutes, and schedules
pause after 60 days without repo activity (re-enable from the Actions tab).

## Other ways to run reminders

- `npm run remind` — one-shot check, for your own cron/launchd
  (`--if-scheduled` makes it a no-op outside configured reminder hours).
- The always-on server (`npm start`) schedules them itself.

## How the streak works

- A day counts only if **every** member has at least one *accepted* LeetCode
  submission that calendar day (in the group's timezone).
- The streak is the run of consecutive complete days. Today counts once
  everyone has solved; until then it shows as ⚠️ at risk.
- Daily results are recorded in `data/db.json`; gaps are backfilled from each
  member's recent accepted submissions.

## Tests

```bash
npm test
```
