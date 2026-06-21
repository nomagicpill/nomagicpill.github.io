#!/usr/bin/env python3
"""Add a book to the reviews page, and fetch its cover from Open Library.

The covers are downloaded once into knowledge/media/bookcovers/ so the page
has no runtime dependency on any external service.

Examples
--------
  # download covers for every book that's missing one (run this first)
  python3 knowledge/add_book.py --backfill

  # add a new book (also fetches its cover)
  python3 knowledge/add_book.py --title "Dune" --author "Frank Herbert" \\
      --rating 5 --date "2026-07-01"

  # then open the page and paste your review between the new <article> tags

Notes
-----
  • --date accepts "1 July 2026" or "2026-07-01"; it's stored as ISO so sorting works.
  • Cover lookup is by title + author via Open Library; a few obscure books may
    miss — pass --cover-id <id> (from openlibrary.org) or drop a JPG into
    knowledge/media/bookcovers/<slug>.jpg yourself.
  • Only the Python standard library is used.
"""

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
COVERS_DIR = os.path.join(HERE, "media", "bookcovers")
DATA_OPEN = '<div id="book-data" hidden>'

MONTHS = {m: i for i, ms in enumerate(
    [["jan", "january"], ["feb", "february"], ["mar", "march"], ["apr", "april"],
     ["may"], ["jun", "june"], ["jul", "july"], ["aug", "august"],
     ["sep", "sept", "september"], ["oct", "october"], ["nov", "november"],
     ["dec", "december"]], start=1) for m in ms}


def slugify(title):
    t = title.split(":")[0].lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:40].strip("-")


def to_iso(date):
    date = (date or "").strip()
    if not date:
        return ""
    if re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return date
    m = re.match(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", date)
    if m and m.group(2).lower() in MONTHS:
        return f"{int(m.group(3)):04d}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    print(f"  ! couldn't parse date {date!r}; storing as-is", file=sys.stderr)
    return date


def _get(url, retries=3):
    req = urllib.request.Request(url, headers={"User-Agent": "nomagicpill-books/1.0"})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:       # rate limited: back off
                time.sleep(2 * (attempt + 1))
                continue
            raise
    raise RuntimeError("exhausted retries")


def lookup_cover_id(title, author):
    """Return an Open Library cover id for title/author, or None."""
    # first author only — "X and Y" / "X, Y" won't match Open Library's author filter
    first_author = re.split(r"\s+and\s+|,|&", author)[0].strip() if author else ""
    # build cleaned title variants: drop series tags "(Series, #1)", subtitles, dashes
    titles = [title]
    no_paren = re.sub(r"\s*\([^)]*\)\s*", " ", title).strip()
    if no_paren and no_paren != title:
        titles.append(no_paren)
    for t in list(titles):
        if ":" in t:
            titles.append(t.split(":")[0].strip())
        if " - " in t:
            titles.append(t.split(" - ")[0].strip())
    seen, deduped = set(), []
    for t in titles:
        if t and t not in seen:
            seen.add(t)
            deduped.append(t)
    titles = deduped
    # try most-specific (title+author) first, then progressively looser, ending title-only
    queries = []
    for t in titles:
        if first_author:
            queries.append({"title": t, "author": first_author})
    for t in titles:
        queries.append({"title": t})
    for q in queries:
        q.update({"limit": 1, "fields": "cover_i,title,author_name"})
        try:
            data = json.loads(_get("https://openlibrary.org/search.json?" +
                                   urllib.parse.urlencode(q)))
        except Exception as exc:
            print(f"  ! Open Library lookup failed ({exc})", file=sys.stderr)
            return None
        docs = data.get("docs") or []
        if docs and docs[0].get("cover_i"):
            return docs[0]["cover_i"]
    return None


def download_cover(slug, cover_id):
    os.makedirs(COVERS_DIR, exist_ok=True)
    dest = os.path.join(COVERS_DIR, slug + ".jpg")
    img = _get(f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg")
    if len(img) < 1000:                       # Open Library returns a 1px blank for misses
        print(f"  ! cover for {slug} came back empty", file=sys.stderr)
        return False
    with open(dest, "wb") as fh:
        fh.write(img)
    print(f"  saved {os.path.relpath(dest)} ({len(img) // 1024} KB)")
    return True


def fetch_for(title, author, slug, cover_id=None):
    dest = os.path.join(COVERS_DIR, slug + ".jpg")
    if os.path.exists(dest):
        print(f"  {slug}.jpg already exists — skipping")
        return True
    if cover_id is None:
        print(f"  looking up cover for {title!r} ...")
        cover_id = lookup_cover_id(title, author)
    if not cover_id:
        print(f"  ! no cover found for {title!r} (page will show a text placeholder)")
        return False
    return download_cover(slug, cover_id)


def parse_articles(text):
    """Yield (title, author, cover_path) for each article in the data block."""
    for block in re.findall(r"<article class=\"book\"(.*?)</article>", text, re.S):
        attrs = dict(re.findall(r'data-([\w-]+)="([^"]*)"', block))
        yield (html.unescape(attrs.get("title", "")),
               html.unescape(attrs.get("author", "")),
               attrs.get("cover", ""))


def main():
    ap = argparse.ArgumentParser(
        description="Add a book + fetch its cover for the reviews page.",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--file", default="books.html",
                    help="Page file in knowledge/ to edit (default: books.html).")
    ap.add_argument("--backfill", action="store_true",
                    help="Download covers for every book missing one, then exit.")
    ap.add_argument("--delay", type=float, default=0.5,
                    help="Seconds to pause between lookups during --backfill (be polite to Open Library).")
    ap.add_argument("--title")
    ap.add_argument("--author", default="")
    ap.add_argument("--rating", help="0–5, halves allowed (e.g. 4.5). Omit if unrated.")
    ap.add_argument("--date", default="", help='"1 July 2026" or "2026-07-01".')
    ap.add_argument("--cover-id", help="Open Library cover id, if auto-lookup misses.")
    args = ap.parse_args()

    page_path = os.path.join(HERE, args.file)
    if not os.path.exists(page_path):
        sys.exit(f"Can't find {args.file} in knowledge/.")
    page = open(page_path, encoding="utf-8").read()

    if args.backfill:
        books = list(parse_articles(page))
        miss = 0
        for i, (title, author, cover) in enumerate(books, 1):
            slug = os.path.splitext(os.path.basename(cover))[0] if cover else slugify(title)
            dest = os.path.join(COVERS_DIR, slug + ".jpg")
            already = os.path.exists(dest)
            print(f"[{i}/{len(books)}]", end=" ")
            try:
                ok = fetch_for(title, author, slug)
            except Exception as exc:
                print(f"  ! error on {title!r}: {exc}", file=sys.stderr)
                ok = False
            if not ok:
                miss += 1
            if not already:                       # only pause when we actually hit the network
                time.sleep(args.delay)
        print(f"\nDone. {miss} cover(s) missing out of {len(books)}."
              if miss else f"\nDone. All {len(books)} covers present.")
        return

    if not args.title:
        sys.exit("Provide --title (and usually --author), or use --backfill.")

    slug = slugify(args.title)
    iso = to_iso(args.date)
    fetch_for(args.title, args.author, slug, args.cover_id)

    article = (
        '  <article class="book"\n'
        f'           data-title="{html.escape(args.title, quote=True)}"\n'
        f'           data-author="{html.escape(args.author, quote=True)}"\n'
        f'           data-rating="{args.rating or ""}"\n'
        f'           data-date="{iso}"\n'
        f'           data-date-display="{html.escape(args.date, quote=True)}"\n'
        f'           data-cover="media/bookcovers/{slug}.jpg">\n'
        '\n'
        '  </article>\n')

    if DATA_OPEN not in page:
        sys.exit("Couldn't find the book-data block in the page.")
    page = page.replace(DATA_OPEN, DATA_OPEN + "\n" + article, 1)
    with open(page_path, "w", encoding="utf-8") as fh:
        fh.write(page)

    print(f"\nAdded \"{args.title}\" to {args.file}.")
    print("  -> open the page and paste your review between the new <article> tags.")


if __name__ == "__main__":
    main()
