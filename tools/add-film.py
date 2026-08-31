#!/usr/bin/env python3
"""Add a film entry to knowledge/film.html and fetch its poster.

Normally invoked by pasting the command the film bookmarklet copies:

    python3 tools/add-film.py --title "Sinners" --year 2025 --poster "https://a.ltrbxd.com/..."

It does two things and nothing else:
  1. downloads the poster to knowledge/media/film/<slug>.jpg (600x900)
  2. inserts an <article class="film"> block at the top of #film-data,
     dated today, with an empty rating and an empty review paragraph.

Rating and review are left blank on purpose; you fill those in by hand later.
No dependencies, no build step -- stdlib only.
"""

import argparse
import datetime
import os
import re
import sys
import unicodedata
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILM_HTML = os.path.join(ROOT, "knowledge", "film.html")
COVER_DIR = os.path.join(ROOT, "knowledge", "media", "film")
ANCHOR = '<div id="film-data" hidden>\n'

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36")


def slugify(title, year):
    """'Déjà Vu', 2006 -> 'deja-vu-2006'. Matches the existing filenames:
    compatibility-decompose (so 'Accountant²' -> 'accountant2'), drop the
    combining marks, then every run of non-alphanumerics becomes one hyphen."""
    s = unicodedata.normalize("NFKD", title)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return "{}-{}".format(s, year) if year else s


def poster_600x900(url):
    """Letterboxd serves the same poster at many crops; force the 2:3 600x900
    one the rest of the covers use."""
    return re.sub(r"-\d+-\d+-\d+-\d+-crop\.jpg", "-0-600-0-900-crop.jpg", url)


def esc(s):
    return s.replace("&", "&amp;").replace('"', "&quot;")


def article_block(title, year, date, cover, rating):
    return (
        '  <article class="film"\n'
        '           data-title="{title} ({year})"\n'
        '           data-rating="{rating}"\n'
        '           data-date="{date}"\n'
        '           data-cover="media/film/{cover}.jpg">\n'
        '           <p>\n'
        '             \n'
        '           </p>\n'
        ' </article>\n'
        '\n'
    ).format(title=esc(title), year=year, rating=rating, date=date, cover=cover)


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://letterboxd.com/"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read()
    if not data.startswith(b"\xff\xd8\xff"):
        raise ValueError("that URL did not return a JPEG ({} bytes)".format(len(data)))
    with open(dest, "wb") as f:
        f.write(data)
    return len(data)


def main():
    p = argparse.ArgumentParser(description="Add a film entry to knowledge/film.html.")
    p.add_argument("--title", required=True, help='film title, no year (e.g. "Sinners")')
    p.add_argument("--year", required=True, help="release year")
    p.add_argument("--poster", default="", help="poster image URL")
    p.add_argument("--date", default="", help="watch date, ISO (default: today)")
    p.add_argument("--rating", default="", help="0-5, e.g. 4.5 (default: blank/unrated)")
    p.add_argument("--force", action="store_true", help="add even if the title is already listed; re-download the poster")
    p.add_argument("--dry-run", action="store_true", help="print what would happen, change nothing")
    a = p.parse_args()

    title = a.title.strip()
    year = a.year.strip()
    date = a.date.strip() or datetime.date.today().isoformat()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        sys.exit("error: --date must be YYYY-MM-DD, got {!r}".format(date))
    if not re.match(r"^\d{4}$", year):
        sys.exit("error: --year must be 4 digits, got {!r}".format(year))

    slug = slugify(title, year)
    cover_path = os.path.join(COVER_DIR, slug + ".jpg")
    html = open(FILM_HTML, encoding="utf-8").read()

    needle = 'data-title="{} ({})"'.format(esc(title), year)
    if needle in html and not a.force:
        sys.exit('"{} ({})" is already in film.html. Re-run with --force to add it anyway.'.format(title, year))

    block = article_block(title, year, date, slug, a.rating.strip())

    if a.dry_run:
        print("would write cover ->", os.path.relpath(cover_path, ROOT))
        print("would insert into ->", os.path.relpath(FILM_HTML, ROOT))
        print(block, end="")
        return

    # poster
    if os.path.exists(cover_path) and not a.force:
        print("poster: already have {} (kept)".format(os.path.relpath(cover_path, ROOT)))
    elif a.poster:
        try:
            n = download(poster_600x900(a.poster), cover_path)
            print("poster: {} ({:.0f} KB)".format(os.path.relpath(cover_path, ROOT), n / 1024.0))
        except Exception as e:
            print("poster: FAILED -- {}".format(e))
            print("        drop a 2:3 JPG at {} yourself".format(os.path.relpath(cover_path, ROOT)))
    else:
        print("poster: no --poster given; drop a 2:3 JPG at {}".format(os.path.relpath(cover_path, ROOT)))

    # entry
    if ANCHOR not in html:
        sys.exit('error: could not find the \'<div id="film-data" hidden>\' line in film.html')
    html = html.replace(ANCHOR, ANCHOR + "\n" + block.rstrip("\n") + "\n", 1)
    with open(FILM_HTML, "w", encoding="utf-8") as f:
        f.write(html)
    print('entry:  "{} ({})" added at the top of #film-data, dated {}'.format(title, year, date))
    print("        edit the rating and review in {}".format(os.path.relpath(FILM_HTML, ROOT)))


if __name__ == "__main__":
    main()
