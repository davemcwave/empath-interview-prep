#!/usr/bin/env python3
"""
Reddit digest for Empath Interview Prep.

Scans a list of target subreddits for posts in the last 24 hours that look like
potential Empath customers (resume help, interview prep, no-callback frustration,
salary negotiation, etc.) and emails a digest to david@empathinterviews.com.

Stdlib only. No third-party packages required.

Usage:
    python3 reddit-digest.py

Configuration via environment variables (see .env.example):
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SENDER, RECIPIENT
    USER_AGENT (optional, override default)

If SMTP_USER and SMTP_PASS are not set, the digest is printed to stdout instead
of being emailed.
"""

import json
import os
import smtplib
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage

# ----- config you can edit -----

SUBREDDITS = [
    "careeradvice",
    "engineeringresumes",
    "resumes",
    "recruiting",
    "jobs",
    "GetEmployed",
    "careerguidance",
]

HOURS_LOOKBACK = 24

# Posts must score this many points to make the digest.
SCORE_THRESHOLD = 3

# Phrases that strongly suggest a potential Empath customer (3 points each).
STRONG_SIGNALS = [
    "review my resume", "review my cv",
    "roast my resume", "roast my cv",
    "rate my resume", "rate my cv",
    "feedback on my resume", "feedback on my cv",
    "feedback on resume", "feedback on cv",
    "no callbacks", "no interviews", "no responses",
    "not getting interviews", "not getting callbacks",
    "not getting any interviews", "not getting any callbacks",
    "no callback", "no response",
    "applicant tracking",
    "behavioral interview", "system design interview",
    "tell me about yourself",
    "salary negotiation", "negotiate my salary", "negotiating my salary",
    "got an offer", "offer letter", "competing offers",
    "mock interview", "interview practice",
    "why this role", "why do you want this",
    "interview prep", "interview preparation",
    "ghosted", "ghosting",
]

# Weaker signals (1 point each). Used to catch posts that miss strong phrases.
WEAK_SIGNALS = [
    "resume", "cv",
    "interview",
    "callback",
    "ats",
    "feedback",
    "advice",
    "senior dev", "senior engineer", "staff engineer", "principal engineer",
    "data engineer", "data scientist", "software engineer",
    "backend", "frontend", "full stack",
    "applied to", "applications",
    "hiring manager",
    "linkedin",
    "cover letter",
    "referral",
    "networking",
]

# Phrases that exclude a post from the digest (job postings, etc.).
EXCLUDE_PHRASES = [
    "[hiring]", "(hiring)",
    "i'm hiring", "we're hiring", "we are hiring", "i am hiring",
    "looking to hire",
    "[for hire]", "(for hire)",
    "[freelance]",
]

# ----- env / runtime config -----

# Use `or` chains so empty-string env vars (e.g. unset GitHub Actions secrets)
# fall back to defaults instead of overriding them.
USER_AGENT = (
    os.environ.get("USER_AGENT")
    or "Empath:reddit-digest:0.1 (by Empath Interview Prep)"
)

RECIPIENT = os.environ.get("RECIPIENT") or "david@empathinterviews.com"
SENDER = os.environ.get("SENDER") or ""
SMTP_HOST = os.environ.get("SMTP_HOST") or "smtp.gmail.com"
SMTP_PORT = int(os.environ.get("SMTP_PORT") or 587)
SMTP_USER = os.environ.get("SMTP_USER") or ""
SMTP_PASS = os.environ.get("SMTP_PASS") or ""

# ----- core logic -----


def fetch_subreddit_new(subreddit, limit=50, max_retries=3):
    """Fetch the latest posts from a subreddit's /new feed with retry on 429/5xx.

    Reddit rate-limits shared cloud IPs (including GitHub Actions runners) more
    aggressively, so we retry with exponential backoff on 429 / 5xx.
    """
    url = f"https://www.reddit.com/r/{subreddit}/new.json?limit={limit}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    backoff = 5

    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.load(resp)
            return data.get("data", {}).get("children", [])
        except urllib.error.HTTPError as e:
            if e.code in (429, 502, 503, 504) and attempt < max_retries - 1:
                print(
                    f"HTTP {e.code} on r/{subreddit}, retrying in {backoff}s "
                    f"(attempt {attempt + 1}/{max_retries})...",
                    file=sys.stderr,
                )
                time.sleep(backoff)
                backoff *= 2
                continue
            print(f"HTTP {e.code} fetching r/{subreddit}: {e.reason}", file=sys.stderr)
            return []
        except Exception as e:
            print(f"Failed to fetch r/{subreddit}: {e}", file=sys.stderr)
            return []

    return []


def score_post(post):
    """Return a relevance score. Returns 0 if excluded by job-posting phrases."""
    title = (post.get("title") or "").lower()
    body = (post.get("selftext") or "").lower()
    text = f"{title} {body}"

    if any(phrase in text for phrase in EXCLUDE_PHRASES):
        return 0

    score = 0
    for phrase in STRONG_SIGNALS:
        if phrase in text:
            score += 3
    for word in WEAK_SIGNALS:
        if word in text:
            score += 1
    return score


def collect_relevant_posts():
    """Return a list of relevant post dicts from all target subs within lookback window."""
    cutoff = time.time() - HOURS_LOOKBACK * 3600
    relevant = []

    for sub in SUBREDDITS:
        children = fetch_subreddit_new(sub)
        for item in children:
            post = item.get("data", {}) or {}
            if post.get("stickied"):
                continue
            if (post.get("created_utc") or 0) < cutoff:
                continue
            score = score_post(post)
            if score < SCORE_THRESHOLD:
                continue
            relevant.append({
                "subreddit": post.get("subreddit") or sub,
                "title": post.get("title") or "",
                "url": "https://www.reddit.com" + (post.get("permalink") or ""),
                "author": post.get("author") or "[deleted]",
                "score": post.get("score") or 0,
                "num_comments": post.get("num_comments") or 0,
                "created_utc": post.get("created_utc") or 0,
                "selftext": post.get("selftext") or "",
                "relevance_score": score,
            })
        # Be polite to Reddit between sub fetches.
        time.sleep(1)

    return relevant


def render_digest(posts):
    """Return (plain_text, html) versions of the digest email body."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    if not posts:
        text = (
            f"Empath Reddit digest, {now}\n\n"
            f"No relevant posts in the last {HOURS_LOOKBACK} hours across "
            f"{len(SUBREDDITS)} subreddits.\n"
        )
        html = (
            f"<h2>Empath Reddit digest</h2>"
            f"<p><em>{now}</em></p>"
            f"<p>No relevant posts in the last {HOURS_LOOKBACK} hours.</p>"
        )
        return text, html

    # Group by subreddit, sort each group by relevance desc then recency desc.
    by_sub = {}
    for p in posts:
        by_sub.setdefault(p["subreddit"], []).append(p)
    for sub in by_sub:
        by_sub[sub].sort(
            key=lambda p: (p["relevance_score"], p["created_utc"]),
            reverse=True,
        )

    sub_order = sorted(by_sub.keys(), key=lambda s: -len(by_sub[s]))

    text_lines = [
        f"Empath Reddit digest, {now}",
        f"{len(posts)} relevant posts in the last {HOURS_LOOKBACK} hours.",
        "",
    ]
    html_parts = [
        '<h2 style="font-family: system-ui, sans-serif;">Empath Reddit digest</h2>',
        f'<p style="color:#555;"><em>{now}. {len(posts)} relevant posts in the last {HOURS_LOOKBACK} hours.</em></p>',
    ]

    for sub in sub_order:
        sub_posts = by_sub[sub]
        text_lines.append(f"=== r/{sub} ({len(sub_posts)}) ===")
        html_parts.append(
            f'<h3 style="font-family: system-ui, sans-serif; margin-top:1.5em;">r/{sub} ({len(sub_posts)})</h3>'
        )
        html_parts.append('<ul style="font-family: system-ui, sans-serif;">')

        for p in sub_posts:
            ts = datetime.fromtimestamp(p["created_utc"], timezone.utc).strftime("%m/%d %H:%M UTC")
            preview = (p["selftext"] or "").strip().replace("\n", " ")
            if len(preview) > 220:
                preview = preview[:220] + "..."

            text_lines.append(f"  [{p['relevance_score']} pts] {p['title']}")
            text_lines.append(f"    u/{p['author']} | {ts} | {p['score']} upvotes | {p['num_comments']} comments")
            text_lines.append(f"    {p['url']}")
            if preview:
                text_lines.append(f"    > {preview}")
            text_lines.append("")

            preview_html = ""
            if preview:
                preview_html = f'<br><span style="color:#444;">{preview}</span>'
            html_parts.append(
                f'<li style="margin-bottom:0.9em;">'
                f'<a href="{p["url"]}" style="color:#0d7a6c; font-weight:600;">{p["title"]}</a>'
                f' <span style="color:#888; font-size:0.9em;">[{p["relevance_score"]} pts]</span>'
                f'<br><span style="color:#777; font-size:0.9em;">'
                f'u/{p["author"]} &middot; {ts} &middot; '
                f'{p["score"]} upvotes &middot; {p["num_comments"]} comments'
                f'</span>'
                f'{preview_html}'
                f'</li>'
            )

        html_parts.append('</ul>')

    return "\n".join(text_lines), "\n".join(html_parts)


def send_email(text_body, html_body, post_count):
    """Send the digest via SMTP. Fall back to stdout if SMTP not configured."""
    today = datetime.now().strftime("%Y-%m-%d")
    subject = f"Empath Reddit digest, {today} ({post_count} posts)"

    if not (SMTP_USER and SMTP_PASS):
        print("[SMTP not configured, printing digest to stdout]\n", file=sys.stderr)
        print(text_body)
        return

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = SENDER or SMTP_USER
    msg["To"] = RECIPIENT
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")

    context = ssl.create_default_context()
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as smtp:
        smtp.starttls(context=context)
        smtp.login(SMTP_USER, SMTP_PASS)
        smtp.send_message(msg)

    print(f"Sent digest to {RECIPIENT} ({post_count} posts)", file=sys.stderr)


def main():
    posts = collect_relevant_posts()
    text_body, html_body = render_digest(posts)
    send_email(text_body, html_body, len(posts))


if __name__ == "__main__":
    main()
