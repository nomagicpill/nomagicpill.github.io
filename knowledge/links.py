#!/usr/bin/env python3
"""Add a link (with your commentary) to the Links archive.

Splices a properly-escaped <li> into the current month's list in links.html,
creating the month's <h2>/<ul> section if the month has just rolled over.
Newest month stays on top; new entries go to the top of their month.

Usage
-----
  python3 knowledge/links.py "URL" ["NOTE"]

Examples
--------
  # URL + your commentary, all on one line
  python3 knowledge/links.py "https://example.com/post" "Why I liked it."

  # URL only: fetches the page <title>, then prompts you for the note
  python3 knowledge/links.py "https://example.com/post"

  # lead with a pulled quote (rendered inline in quotation marks), then comment
  python3 knowledge/links.py "https://example.com/post" "Loved this line." \\
      --quote "The best sentence in the piece."

  # see the <li> it would write without touching the file
  python3 knowledge/links.py "https://example.com/post" --print

Notes
-----
  • URL is the only required argument. NOTE is your commentary (the text after
    the colon); omit it and the script prompts you, or leave the prompt blank
    for a bare link.
  • --title is auto-fetched from the page if omitted; pass it to override.
  • --quote is an optional pulled snippet; it's wrapped in "quotation marks" and
    placed before your note.
  • --date accepts "25 June 2026" or "2026-06-25"; default is today. It only
    decides which month section the entry lands in.
  • Only the Python standard library is used.
"""

import argparse
import datetime
import html
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))

MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]

MONTHS = {m: i for i, ms in enumerate(
    [["jan", "january"], ["feb", "february"], ["mar", "march"], ["apr", "april"],
     ["may"], ["jun", "june"], ["jul", "july"], ["aug", "august"],
     ["sep", "sept", "september"], ["oct", "october"], ["nov", "november"],
     ["dec", "december"]], start=1) for m in ms}


def parse_date(date):
    """Return a datetime.date from 'YYYY-MM-DD' or '25 June 2026'; default today."""
    date = (date or "").strip()
    if not date:
        return datetime.date.today()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", date)
    if m:
        return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", date)
    if m and m.group(2).lower() in MONTHS:
        return datetime.date(int(m.group(3)), MONTHS[m.group(2).lower()], int(m.group(1)))
    sys.exit(f"Couldn't parse date {date!r}; use '2026-06-25' or '25 June 2026'.")


def fetch_title(url):
    """Best-effort fetch of the page's <title>; returns '' on any failure."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            charset = resp.headers.get_content_charset() or "utf-8"
            body = resp.read(200_000).decode(charset, "replace")
    except Exception as exc:
        print(f"  ! couldn't fetch title ({exc}); pass --title yourself", file=sys.stderr)
        return ""
    m = re.search(r"<title[^>]*>(.*?)</title>", body, re.S | re.I)
    if not m:
        return ""
    return re.sub(r"\s+", " ", html.unescape(m.group(1))).strip()


def build_li(url, title, note, quote):
    """Return the <li>...</li> block (trailing newline) for one entry."""
    a = f'    <a href="{html.escape(url, quote=True)}">{html.escape(title, quote=False)}</a>'
    bits = []
    if quote:
        bits.append('"' + html.escape(quote, quote=False) + '"')
    if note:
        bits.append(html.escape(note, quote=False))
    line = a + (": " + " ".join(bits) if bits else "")
    return "\n".join(["  <li>", line, "  </li>", ""])


def insert(page, li, date):
    """Splice li into the right month section, returning the new page text."""
    month_id = f"{MONTH_NAMES[date.month - 1].lower()}_{date.year}"
    heading = f'<h2 id="{month_id}">{MONTH_NAMES[date.month - 1]} {date.year}</h2>'
    if heading in page:
        idx = page.index(heading)
        anchor = "\n<ul>\n"
        ul = page.index(anchor, idx)
        at = ul + len(anchor)
        return page[:at] + li + page[at:]
    # new month: drop a fresh section above the most recent dated heading
    m = re.search(r'<h2 id="[a-z]+_\d{4}">', page)
    if not m:
        sys.exit("Couldn't find any month section to anchor against in the page.")
    block = f"{heading}\n\n<ul>\n{li}</ul>\n\n<hr>\n\n"
    return page[:m.start()] + block + page[m.start():]


def main():
    ap = argparse.ArgumentParser(
        description="Add a link + your commentary to the Links archive.",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("url", help="The link's URL.")
    ap.add_argument("note", nargs="?", help="Your commentary. Omit to be prompted interactively.")
    ap.add_argument("--title", help="Link text; auto-fetched from the page if omitted.")
    ap.add_argument("--quote", help='A pulled quote, rendered inline in "quotation marks".')
    ap.add_argument("--date", default="", help='"2026-06-25" or "25 June 2026" (default: today).')
    ap.add_argument("--file", default="links.html", help="Page in knowledge/ to edit.")
    ap.add_argument("--print", dest="dry", action="store_true",
                    help="Print the <li> without writing the file.")
    args = ap.parse_args()

    title = args.title or fetch_title(args.url)
    if not title:
        sys.exit("No title found; pass --title.")

    note = args.note
    if note is None and not args.dry:
        try:
            note = input("Note (blank for a bare link): ").strip()
        except (EOFError, KeyboardInterrupt):
            note = ""
    note = note or ""

    li = build_li(args.url, title, note, args.quote)

    if args.dry:
        print(li, end="")
        return

    date = parse_date(args.date)
    page_path = os.path.join(HERE, args.file)
    if not os.path.exists(page_path):
        sys.exit(f"Can't find {args.file} in knowledge/.")
    page = open(page_path, encoding="utf-8").read()
    page = insert(page, li, date)
    with open(page_path, "w", encoding="utf-8") as fh:
        fh.write(page)

    print(f'\nAdded "{title}" to {MONTH_NAMES[date.month - 1]} {date.year} in {args.file}.')


if __name__ == "__main__":
    main()
