# Reddit digest

On-demand scan of 7 target subreddits for posts that look like potential Empath customers (resume help, no-callback frustration, interview prep, salary negotiation). Generates a clickable local HTML page so you can browse and click straight into Reddit to respond.

Run it whenever you're about to do outreach.

Stdlib Python only. No `pip install` step.

## Quick start

From this directory:

```bash
./digest.sh
```

That's it. The script:

1. Scans the 7 target subreddits.
2. Writes the digest to `../digest/index.html` (at the repo root, gitignored).
3. Opens it in your default browser.

Each post title in the page is a clickable link that opens the Reddit thread in a new tab. Click through, respond, come back, click the next one.

Takes ~10 seconds. Rerun any time you want a fresh scan; the HTML file gets overwritten.

**Important:** `digest/` is gitignored at the repo root. Never commit it. This repo doubles as the public GitHub Pages site for empathinterviews.com, so anything at `/digest/` would be publicly served and leak your outreach targets.

## What it does

- Fetches the newest posts from each of:
  r/careeradvice, r/engineeringresumes, r/resumes, r/recruiting, r/jobs, r/GetEmployed, r/careerguidance
- Filters to posts from the last 24 hours.
- Scores each post by keyword signals (strong: "review my resume", "no callbacks", "behavioral interview"; weak: "resume", "advice", "senior engineer", etc.).
- Excludes job postings ("[hiring]", "we're hiring", etc.).
- Groups results by subreddit, sorted by match score then recency.
- Each post shows: clickable title, author, age, upvotes, comments, match score, and a 280-char preview.

## Tuning

All filters live at the top of `reddit-digest.py`:

- `SUBREDDITS`: which subs to scan.
- `STRONG_SIGNALS`: phrases worth 3 points each.
- `WEAK_SIGNALS`: words worth 1 point each.
- `EXCLUDE_PHRASES`: post is dropped if any of these appear.
- `SCORE_THRESHOLD`: minimum score to appear in the digest (default 3).
- `HOURS_LOOKBACK`: how far back to look (default 24).

If you find yourself manually skipping the same kinds of false positives in the digest, add a phrase to `EXCLUDE_PHRASES`. If good posts are missing, add their giveaway phrases to `STRONG_SIGNALS`.

## Optional: also email yourself a copy

The HTML page is the main interface. If you also want a copy in your inbox (useful for a written record), set up Gmail SMTP.

1. Enable 2-Step Verification on your Gmail.
2. Create an App Password at https://myaccount.google.com/apppasswords. Copy the 16 characters (no spaces).
3. Copy the env template and fill in:

```bash
cp .env.example .env
# edit .env: set SMTP_USER and SMTP_PASS
```

The `.env` file is gitignored.

Next run of `./digest.sh` will both open the HTML page and email a copy to david@empathinterviews.com.

## Optional: Reddit OAuth (for cloud hosting later)

The script supports authenticated Reddit OAuth via the password grant. Not needed when running from a residential IP. Kept in the code in case you revisit cloud hosting (GitHub Actions, a VPS) later, where Reddit's unauthenticated endpoints get 403'd. To enable, fill in the four `REDDIT_*` values in `.env`. The script auto-detects and switches to the authenticated endpoint when those are set.

## Troubleshooting

**HTTP 403 from Reddit.** You're on a cloud IP or VPN that Reddit blocks. Disable VPN and try again.

**Empty digest.** Either an actually quiet day, or `SCORE_THRESHOLD` is too strict. Lower it to 2 in `reddit-digest.py` and rerun.

**Browser didn't open.** The `open` command is macOS-only. The script prints the file path; open it manually. On Linux, swap `subprocess.run(["open", ...])` for `xdg-open` in the script.

**Email not arriving.** Check the terminal output for `[Sent digest to ...]`. If it's there, check spam. If not, the SMTP step failed; look for an auth error.
