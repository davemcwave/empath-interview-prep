# Reddit digest

Scans 7 target subreddits once a day for posts that look like potential Empath customers (resume help, no-callback frustration, interview prep, salary negotiation). Emails the digest to david@empathinterviews.com.

Stdlib Python only. No `pip install` step. Runs as a scheduled GitHub Actions workflow.

## What it does

- Fetches the newest posts from each of:
  r/careeradvice, r/engineeringresumes, r/resumes, r/recruiting, r/jobs, r/GetEmployed, r/careerguidance
- Filters to posts from the last 24 hours.
- Scores each post by keyword signals (strong: "review my resume", "no callbacks", "behavioral interview"; weak: "resume", "advice", "senior engineer", etc.).
- Excludes job postings ("[hiring]", "we're hiring", etc.).
- Groups results by subreddit and emails a digest with titles, scores, links, and a 220-char preview of each post.

## Setup

### 1. Create a Gmail App Password

The script sends mail through Gmail SMTP. You need an App Password (not your regular Gmail password).

1. Make sure 2-Step Verification is on for the Gmail account you'll send from.
2. Go to https://myaccount.google.com/apppasswords
3. Create an app password for "Mail". Copy the 16-character password.

If your Empath email is on Google Workspace, you can use that account. Otherwise use any Gmail.

### 2. Add the secrets to the GitHub repo

Go to the repo's **Settings → Secrets and variables → Actions → New repository secret**.

Add these two:

| Secret name | Value |
|-------------|-------|
| `SMTP_USER` | Your Gmail address (the one with the app password) |
| `SMTP_PASS` | The 16-character app password from step 1 |

Optional secrets (defaults shown):

| Secret name | Default if unset |
|-------------|------------------|
| `RECIPIENT` | `david@empathinterviews.com` |
| `SENDER` | Same as `SMTP_USER` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |

### 3. Push the workflow

Commit and push `.github/workflows/reddit-digest.yml` and the `scripts/` directory. The workflow runs daily at 12:00 UTC (7am EST / 8am EDT) once it's on the default branch.

### 4. Run it manually to test

In the GitHub UI: **Actions → Reddit digest → Run workflow**. Pick the branch and click Run. The job takes ~30 seconds. Check your inbox.

If the job fails, click into the run and read the logs. Most common cause: typo in the app password.

## Tuning

All filters live at the top of `reddit-digest.py`:

- `SUBREDDITS`: which subs to scan. Add or remove freely.
- `STRONG_SIGNALS`: phrases worth 3 points each. Edit when you spot patterns the digest is missing.
- `WEAK_SIGNALS`: words worth 1 point each. Looser, broader.
- `EXCLUDE_PHRASES`: post is dropped if any of these appear.
- `SCORE_THRESHOLD`: minimum score to make the digest (default 3). Lower for more posts, higher for tighter relevance.
- `HOURS_LOOKBACK`: how far back to look (default 24).

If you find yourself manually skipping the same kinds of false positives in the digest, add a phrase to `EXCLUDE_PHRASES`. If you find good posts that the digest missed, add their giveaway phrases to `STRONG_SIGNALS`.

Edit, commit, push. The next scheduled run picks up the change.

## Running locally (optional)

Useful for testing keyword changes before pushing.

```bash
cd /Users/david.dalisay/code/empath-interview-prep/scripts
cp .env.example .env
# edit .env with SMTP_USER and SMTP_PASS
set -a; source .env; set +a
python3 reddit-digest.py
```

To preview the digest without sending email, run it without setting `SMTP_USER` / `SMTP_PASS`. It prints to stdout instead.

The `.env` file is gitignored.

## Troubleshooting

**Workflow runs but email never arrives.** Check the workflow logs for "Sent digest to ...". If it's there, the issue is on the receiving end (spam folder, filter, wrong RECIPIENT). If it's not, the SMTP call probably failed; check for an authentication error in the logs.

**HTTP 429 errors in logs.** Reddit is rate-limiting the Actions runner IP. The script already retries with exponential backoff. If it's persistent, you may need to use Reddit's authenticated API (OAuth client credentials).

**Empty digest every day.** Lower `SCORE_THRESHOLD` to 2 in `reddit-digest.py` and see if you get results. If yes, the threshold is too strict. If still empty, Reddit may be blocking the runner IP entirely; check the logs.

**Scheduled run didn't fire.** GitHub may delay scheduled workflows during peak load. If a run is missing, trigger it manually via workflow_dispatch and check that the `cron:` schedule is on the default branch.

**Cost.** This runs about 30 seconds per day on `ubuntu-latest`. Free for public repos. For private repos, well under the free monthly minutes allowance.
