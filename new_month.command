#!/usr/bin/env python3
"""Start a new month on the monthly pages: double-click this in Finder.

Adds this month's <h2> header (e.g. <h2 id="october_2026">October 2026</h2>)
to the top of:

  knowledge/links.html
  about/changelog.html
  training/traininglinks.html

The new header goes directly above the newest existing month header, followed
by blank space for your entries and an <hr>, exactly as it's done by hand.

Notes
-----
  • Safe to run twice: a page that already has this month is left alone.
  • Only inserts text; nothing else in the files is touched.
  • From a terminal you can pick the month: ./new_month.command 2026-11
  • Only the Python standard library is used.
"""

import datetime
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# page -> blank lines between the header and its <hr> (matches the hand edits:
# room for a <ul> on links/changelog, nothing on traininglinks)
PAGES = {
    "knowledge/links.html": 3,
    "about/changelog.html": 3,
    "training/traininglinks.html": 1,
}

MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]

MONTH_HEADER = re.compile(r'<h2 id="(%s)_(\d{4})">' % "|".join(MONTHS))


def add_month(path, year, month, blank_lines):
    """Insert the header for year/month into one page; return a status line."""
    with open(path, encoding="utf-8") as f:
        text = f.read()

    slug = "%s_%d" % (MONTHS[month - 1], year)
    if 'id="%s"' % slug in text:
        return "already there"

    top = MONTH_HEADER.search(text)
    if top is None:
        return "SKIPPED: no month header found to insert above"
    top_key = (int(top.group(2)), MONTHS.index(top.group(1)) + 1)
    if top_key > (year, month):
        return "SKIPPED: newest header (%s %s) is later than this month" % (
            top.group(1).capitalize(), top.group(2))

    block = '<h2 id="%s">%s %d</h2>\n%s<hr>\n\n' % (
        slug, MONTHS[month - 1].capitalize(), year, "\n" * blank_lines)
    text = text[:top.start()] + block + text[top.start():]

    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return "added"


def main():
    if len(sys.argv) > 1:
        try:
            when = datetime.datetime.strptime(sys.argv[1], "%Y-%m").date()
        except ValueError:
            sys.exit("usage: new_month.command [YYYY-MM]")
    else:
        when = datetime.date.today()

    print("New month: %s %d\n" % (MONTHS[when.month - 1].capitalize(), when.year))
    for rel, blank_lines in PAGES.items():
        status = add_month(os.path.join(ROOT, rel), when.year, when.month,
                           blank_lines)
        print("  %-30s %s" % (rel, status))


if __name__ == "__main__":
    main()
    # A double-clicked .command runs in a Terminal window that may close on
    # exit; keep it open long enough to read the result.
    if sys.stdin.isatty():
        input("\nPress Return to close.")
