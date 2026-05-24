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

import base64
import html
import json
import os
import re
import smtplib
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

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

# Posts must score this many points to make the digest. Lowered to 2 because
# the US-only and tech-required filters now do most of the precision work; the
# score is mostly used for ranking within the kept set.
SCORE_THRESHOLD = 2

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

# Non-US signals. Posts that match any of these are dropped because Empath
# is US-focused. Reddit doesn't expose post location, so these are heuristics
# based on country/city mentions, non-USD currencies, and UK/Commonwealth terms.
# Will occasionally drop US posts that happen to mention non-US locations;
# acceptable tradeoff to avoid triaging non-viable leads.
NON_US_KEYWORDS = [
    # UK and Ireland
    "UK", "U.K.", "United Kingdom", "Britain", "British",
    "England", "English", "Scotland", "Scottish", "Wales", "Welsh",
    "Ireland", "Irish",
    "London", "Manchester", "Birmingham", "Edinburgh", "Glasgow", "Dublin",
    "Leeds", "Liverpool", "Bristol", "Cambridge", "Oxford",
    "made redundant", "redundancy", "annual leave", "fortnight",
    "HMRC", "limited company", "VAT",
    # India and South Asia
    "India", "Indian", "Pakistan", "Pakistani", "Bangladesh", "Sri Lanka",
    "Bangalore", "Bengaluru", "Hyderabad", "Mumbai", "Delhi", "Pune",
    "Chennai", "Kolkata", "Gurgaon", "Noida", "Ahmedabad",
    "fresher", "freshers", "TCS", "Infosys", "Wipro", "Cognizant", "HCL",
    "rupees", "lakh", "lakhs", "crore", "crores", "INR",
    # Canada
    "Canada", "Canadian", "Toronto", "Vancouver", "Montreal", "Ottawa",
    "Calgary", "Edmonton", "Quebec", "CAD",
    # Australia and New Zealand
    "Australia", "Australian", "Aussie", "Sydney", "Melbourne", "Brisbane",
    "Perth", "Adelaide", "Canberra",
    "New Zealand", "Auckland", "Wellington", "Christchurch", "Kiwi",
    "AUD", "NZD",
    # Western and Northern Europe
    "Germany", "German", "Berlin", "Munich", "Hamburg", "Frankfurt",
    "France", "French", "Paris", "Lyon",
    "Netherlands", "Dutch", "Amsterdam", "Rotterdam",
    "Spain", "Spanish", "Madrid", "Barcelona",
    "Italy", "Italian", "Rome", "Milan",
    "Sweden", "Swedish", "Stockholm", "Gothenburg",
    "Norway", "Norwegian", "Oslo",
    "Denmark", "Danish", "Copenhagen",
    "Finland", "Finnish", "Helsinki",
    "Portugal", "Portuguese", "Lisbon", "Porto",
    "Switzerland", "Swiss", "Zurich", "Geneva",
    "Austria", "Austrian", "Vienna",
    "Belgium", "Belgian", "Brussels",
    "Europe", "European", "EU",
    # Eastern Europe
    "Poland", "Polish", "Warsaw", "Krakow",
    "Czech", "Prague",
    "Romania", "Romanian", "Bucharest",
    "Hungary", "Hungarian", "Budapest",
    "Greece", "Greek", "Athens",
    "Russia", "Russian", "Moscow",
    "Ukraine", "Ukrainian", "Kyiv", "Kiev",
    # East and Southeast Asia
    "Singapore", "Hong Kong",
    "Japan", "Japanese", "Tokyo", "Osaka",
    "Korea", "Korean", "Seoul",
    "China", "Chinese", "Beijing", "Shanghai", "Shenzhen", "Hangzhou",
    "Taiwan", "Taiwanese", "Taipei",
    "Vietnam", "Vietnamese", "Hanoi",
    "Philippines", "Filipino", "Manila",
    "Indonesia", "Indonesian", "Jakarta",
    "Malaysia", "Malaysian", "Kuala Lumpur",
    "Thailand", "Bangkok",
    # Latin America
    "Brazil", "Brazilian", "Sao Paulo", "São Paulo", "Rio de Janeiro",
    "Mexico", "Mexican", "Mexico City",
    "Argentina", "Argentinian", "Buenos Aires",
    "Colombia", "Colombian", "Bogota",
    "Chile", "Chilean", "Santiago",
    # Middle East and Africa
    "Israel", "Israeli", "Tel Aviv",
    "UAE", "U.A.E.", "Dubai", "Abu Dhabi",
    "Saudi Arabia", "Riyadh",
    "Turkey", "Turkish", "Istanbul",
    "South Africa", "Johannesburg", "Cape Town",
    "Nigeria", "Nigerian", "Lagos",
    "Egypt", "Egyptian", "Cairo",
    "Kenya", "Kenyan", "Nairobi",
    # Currency codes
    "GBP", "EUR", "JPY", "CHF", "SGD", "HKD",
    "pounds sterling", "British pounds", "euros", "yen",
]

# Compiled once. Word boundaries prevent "UK" matching "luck".
_NON_US_REGEX = re.compile(
    r"\b(?:" + "|".join(re.escape(kw) for kw in NON_US_KEYWORDS) + r")\b",
    re.IGNORECASE,
)

# Currency symbols handled separately since they aren't word characters
# and \b doesn't bound them properly.
_NON_US_SYMBOLS = ("£", "€", "₹", "¥", "C$", "CA$", "A$", "AU$", "NZ$")


def looks_non_us(text):
    """Return True if the text contains strong non-US location/context signals."""
    if any(sym in text for sym in _NON_US_SYMBOLS):
        return True
    return bool(_NON_US_REGEX.search(text))


# Tech / software engineering signals. Empath targets tech ICs, so a post must
# mention at least one of these to make the digest. Generic career-advice posts
# from non-tech roles get dropped.
TECH_SIGNALS = [
    # Roles
    "software engineer", "software developer", "software dev",
    "developer", "developers",
    "engineer", "engineers", "engineering",
    "data engineer", "data scientist", "data analyst", "data science",
    "ml engineer", "machine learning", "ai engineer",
    "backend", "back-end", "back end",
    "frontend", "front-end", "front end",
    "full stack", "fullstack", "full-stack",
    "devops", "sre", "site reliability",
    "platform engineer", "infrastructure engineer", "cloud engineer",
    "mobile developer", "ios developer", "android developer",
    "qa engineer", "test engineer",
    "security engineer", "cybersecurity", "cyber security",
    "programmer", "programming", "coding", "coder",
    "tech lead", "technical lead",
    "staff engineer", "principal engineer", "senior engineer", "junior engineer",
    "engineering manager", "technical program manager",
    "product manager", "technical product",
    "computer science", "cs major", "cs degree",
    # Common shorthand
    "swe", "sde", "tpm", "yoe",
    # Languages / runtimes (specific enough to be unambiguous)
    "python", "javascript", "typescript", "golang", "kotlin", "swift",
    "rust", "scala", "ruby on rails",
    "c++", "c#", ".net", "node.js", "nodejs",
    # Frameworks
    "react", "angular", "vue", "django", "flask", "spring boot", "rails",
    # Cloud / infra
    "aws", "gcp", "azure", "kubernetes", "docker", "terraform",
    # Tech-job context
    "leetcode", "system design", "coding interview", "technical interview",
    "tech interview", "faang", "maang",
    "tech industry", "tech job", "tech role", "tech worker",
    "saas",
]

_TECH_REGEX = re.compile(
    r"\b(?:" + "|".join(re.escape(kw) for kw in TECH_SIGNALS) + r")\b",
    re.IGNORECASE,
)


def looks_tech(text):
    """Return True if the text contains at least one tech/engineering signal."""
    return bool(_TECH_REGEX.search(text))

# ----- env / runtime config -----

# Use `or` chains so empty-string env vars (e.g. unset GitHub Actions secrets)
# fall back to defaults instead of overriding them.

# Reddit OAuth (required when running from cloud IPs like GitHub Actions runners,
# which are blocked by Reddit's unauthenticated endpoints).
REDDIT_CLIENT_ID = os.environ.get("REDDIT_CLIENT_ID") or ""
REDDIT_CLIENT_SECRET = os.environ.get("REDDIT_CLIENT_SECRET") or ""
REDDIT_USERNAME = os.environ.get("REDDIT_USERNAME") or ""
REDDIT_PASSWORD = os.environ.get("REDDIT_PASSWORD") or ""

USER_AGENT = os.environ.get("USER_AGENT") or (
    f"Empath:reddit-digest:0.1 (by /u/{REDDIT_USERNAME})"
    if REDDIT_USERNAME
    else "Empath:reddit-digest:0.1 (by Empath Interview Prep)"
)

RECIPIENT = os.environ.get("RECIPIENT") or "david@empathinterviews.com"
SENDER = os.environ.get("SENDER") or ""
SMTP_HOST = os.environ.get("SMTP_HOST") or "smtp.gmail.com"
SMTP_PORT = int(os.environ.get("SMTP_PORT") or 587)
SMTP_USER = os.environ.get("SMTP_USER") or ""
SMTP_PASS = os.environ.get("SMTP_PASS") or ""

# ----- core logic -----


def get_oauth_token():
    """Fetch a Reddit OAuth access token via the password grant.

    Returns None if Reddit OAuth credentials are not configured, in which case
    the caller should fall back to the unauthenticated endpoint (which works
    from residential IPs but is 403'd from cloud IPs like GitHub Actions).
    """
    if not (REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET and REDDIT_USERNAME and REDDIT_PASSWORD):
        return None

    auth = base64.b64encode(
        f"{REDDIT_CLIENT_ID}:{REDDIT_CLIENT_SECRET}".encode()
    ).decode()
    data = urllib.parse.urlencode({
        "grant_type": "password",
        "username": REDDIT_USERNAME,
        "password": REDDIT_PASSWORD,
    }).encode()

    req = urllib.request.Request(
        "https://www.reddit.com/api/v1/access_token",
        data=data,
        headers={
            "Authorization": f"Basic {auth}",
            "User-Agent": USER_AGENT,
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = json.load(resp)
        token = payload.get("access_token")
        if not token:
            print(f"OAuth response missing access_token: {payload}", file=sys.stderr)
        return token
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"OAuth token fetch failed: HTTP {e.code} {e.reason}: {body}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"OAuth token fetch failed: {e}", file=sys.stderr)
        return None


def fetch_subreddit_new(subreddit, token=None, limit=50, max_retries=3):
    """Fetch the latest posts from a subreddit's /new feed with retry on 429/5xx.

    If `token` is provided, hits oauth.reddit.com (works from cloud IPs).
    Otherwise hits www.reddit.com (works from residential IPs only).
    """
    if token:
        url = f"https://oauth.reddit.com/r/{subreddit}/new?limit={limit}"
        headers = {
            "Authorization": f"Bearer {token}",
            "User-Agent": USER_AGENT,
        }
    else:
        url = f"https://www.reddit.com/r/{subreddit}/new.json?limit={limit}"
        headers = {"User-Agent": USER_AGENT}

    req = urllib.request.Request(url, headers=headers)
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
    """Return a relevance score. Returns 0 if the post is excluded by any filter.

    Drop reasons:
      - matches a job-posting / hiring phrase
      - looks non-US (we target US-based tech ICs)
      - no tech / engineering signals (we target software engineers, not general
        career-advice posters)
    """
    title = (post.get("title") or "").lower()
    body = (post.get("selftext") or "").lower()
    text = f"{title} {body}"

    if any(phrase in text for phrase in EXCLUDE_PHRASES):
        return 0
    if looks_non_us(text):
        return 0
    if not looks_tech(text):
        return 0

    score = 0
    for phrase in STRONG_SIGNALS:
        if phrase in text:
            score += 3
    for word in WEAK_SIGNALS:
        if word in text:
            score += 1
    return score


def collect_relevant_posts(token=None):
    """Return a list of relevant post dicts from all target subs within lookback window."""
    cutoff = time.time() - HOURS_LOOKBACK * 3600
    relevant = []

    for sub in SUBREDDITS:
        children = fetch_subreddit_new(sub, token=token)
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


def render_full_html(posts):
    """Return a complete HTML document suitable for opening in a browser."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    if not posts:
        body_html = (
            f'<p class="empty">No relevant posts in the last {HOURS_LOOKBACK} hours.</p>'
        )
    else:
        by_sub = {}
        for p in posts:
            by_sub.setdefault(p["subreddit"], []).append(p)
        for sub in by_sub:
            by_sub[sub].sort(
                key=lambda p: (p["relevance_score"], p["created_utc"]),
                reverse=True,
            )

        sub_order = sorted(by_sub.keys(), key=lambda s: -len(by_sub[s]))

        nav_links = " · ".join(
            f'<a href="#sub-{html.escape(sub)}">r/{html.escape(sub)} ({len(by_sub[sub])})</a>'
            for sub in sub_order
        )

        sections = []
        for sub in sub_order:
            sub_posts = by_sub[sub]
            section_parts = [
                f'<section class="sub" id="sub-{html.escape(sub)}">',
                f'<h2>r/{html.escape(sub)} <span class="count">({len(sub_posts)})</span></h2>',
            ]
            for p in sub_posts:
                ts = datetime.fromtimestamp(p["created_utc"], timezone.utc).strftime(
                    "%m/%d %H:%M UTC"
                )
                preview = (p["selftext"] or "").strip().replace("\n", " ")
                if len(preview) > 280:
                    preview = preview[:280] + "..."

                title_safe = html.escape(p["title"])
                author_safe = html.escape(p["author"])
                url_safe = html.escape(p["url"], quote=True)
                preview_safe = html.escape(preview) if preview else ""

                meta_line = (
                    f'u/{author_safe} · {ts} · '
                    f'{p["score"]} upvotes · {p["num_comments"]} comments · '
                    f'<span class="score">match {p["relevance_score"]}</span>'
                )

                section_parts.append('<article class="post">')
                section_parts.append(
                    f'<h3><a href="{url_safe}" target="_blank" rel="noopener noreferrer">{title_safe}</a></h3>'
                )
                section_parts.append(f'<p class="meta">{meta_line}</p>')
                if preview_safe:
                    section_parts.append(f'<p class="preview">{preview_safe}</p>')
                section_parts.append("</article>")
            section_parts.append("</section>")
            sections.append("\n".join(section_parts))

        body_html = (
            f'<nav class="subs">{nav_links}</nav>\n' + "\n".join(sections)
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Empath Reddit digest</title>
<style>
:root {{
    --teal: #0d7a6c;
    --teal-dark: #0a6157;
    --bg: #f3f6f4;
    --text: #1a1a1a;
    --muted: #666;
    --border: #e6e6e6;
}}
* {{ box-sizing: border-box; }}
body {{
    font-family: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", sans-serif;
    color: var(--text);
    max-width: 780px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
    line-height: 1.55;
}}
h1 {{
    font-family: Georgia, "Times New Roman", serif;
    font-size: 2rem;
    margin: 0 0 0.4rem;
}}
h2 {{
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.4rem;
    margin: 2.5rem 0 0.75rem;
    padding-bottom: 0.4rem;
    border-bottom: 2px solid var(--teal);
}}
.count {{
    color: var(--muted);
    font-size: 0.9em;
    font-weight: normal;
}}
.lede {{
    color: var(--muted);
    margin: 0.25rem 0 1.5rem;
    font-size: 0.95rem;
}}
nav.subs {{
    background: var(--bg);
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.95rem;
    margin: 1rem 0 2rem;
    line-height: 1.9;
}}
nav.subs a {{
    color: var(--teal);
    text-decoration: none;
    margin-right: 0.5rem;
    white-space: nowrap;
}}
nav.subs a:hover {{ text-decoration: underline; }}
article.post {{
    padding: 1rem 0;
    border-bottom: 1px solid var(--border);
}}
article.post:last-child {{ border-bottom: none; }}
article.post h3 {{
    margin: 0 0 0.35rem;
    font-size: 1.05rem;
    font-weight: 600;
    line-height: 1.4;
}}
article.post h3 a {{
    color: var(--teal-dark);
    text-decoration: none;
}}
article.post h3 a:hover {{ text-decoration: underline; }}
article.post h3 a:visited {{ color: #6a4a8a; }}
.meta {{
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0 0 0.5rem;
}}
.score {{
    background: #fff4cc;
    padding: 0.1rem 0.45rem;
    border-radius: 3px;
    font-weight: 500;
    color: #745b00;
}}
.preview {{
    color: #444;
    font-size: 0.92rem;
    margin: 0;
}}
.empty {{
    color: var(--muted);
    font-style: italic;
    padding: 2rem 0;
}}
</style>
</head>
<body>
<h1>Empath Reddit digest</h1>
<p class="lede">Generated {now} · {len(posts)} relevant posts in the last {HOURS_LOOKBACK} hours</p>
{body_html}
</body>
</html>
"""


def write_and_open_html(posts):
    """Write the digest to digest/index.html at the repo root and open in browser.

    Note: digest/ is gitignored. The file is for local use only. Never commit it,
    since this repo is also the public GitHub Pages site for empathinterviews.com.
    """
    repo_root = Path(__file__).resolve().parent.parent
    output_dir = repo_root / "digest"
    output_dir.mkdir(exist_ok=True)
    output_path = output_dir / "index.html"
    output_path.write_text(render_full_html(posts), encoding="utf-8")
    print(f"[Wrote {output_path}]", file=sys.stderr)

    try:
        subprocess.run(["open", str(output_path)], check=False)
    except FileNotFoundError:
        # `open` is macOS-only. Print the path so user can open manually.
        print(f"Open this file in your browser: {output_path}", file=sys.stderr)


def send_email(text_body, html_body, post_count):
    """Send the digest via Gmail SMTP. Caller has already checked creds are set."""
    today = datetime.now().strftime("%Y-%m-%d")
    subject = f"Empath Reddit digest, {today} ({post_count} posts)"

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

    print(f"\n[Sent digest to {RECIPIENT}]", file=sys.stderr)


def main():
    token = get_oauth_token()
    if token:
        print("[Using authenticated Reddit OAuth]", file=sys.stderr)
    else:
        print("[Using unauthenticated Reddit endpoint, residential IP only]", file=sys.stderr)

    posts = collect_relevant_posts(token=token)
    print(f"[Found {len(posts)} relevant posts]", file=sys.stderr)

    text_body, html_body = render_digest(posts)

    # Primary output: write a clickable HTML page and open it in the browser.
    write_and_open_html(posts)

    # Optional: also send the email if SMTP is configured.
    if SMTP_USER and SMTP_PASS:
        send_email(text_body, html_body, len(posts))


if __name__ == "__main__":
    main()
