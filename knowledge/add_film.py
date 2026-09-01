#!/usr/bin/env python3
"""Add a film to the reviews page, and fetch its poster from Letterboxd.

The posters are downloaded once into knowledge/media/film/ so the page has no
runtime dependency on any external service.

Examples
--------
  # add a film watched today (rating and review left blank for you to fill in)
  python3 knowledge/add_film.py --title "Sinners" --year 2025 \\
      --poster "https://a.ltrbxd.com/resized/film-poster/.../...-0-600-0-900-crop.jpg"

  # then open the page and paste your review between the new <article> tags

Notes
-----
  • Usually you don't type this by hand: knowledge/film-bookmarklet.html installs
    a bookmarklet that reads a Letterboxd film page and copies the whole command.
  • --date defaults to today; --rating defaults to blank (shows as "Unrated").
  • Any Letterboxd poster URL works — it's rewritten to the 600x900 crop the rest
    of the covers use. Without --poster, drop a 2:3 JPG in knowledge/media/film/
    yourself.
  • Adding a title that's already listed is refused; pass --force to override.
  • Only the Python standard library is used.
"""

import argparse
import datetime
import html
import os
import re
import sys
import unicodedata
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
POSTERS_DIR = os.path.join(HERE, "media", "film")
DATA_OPEN = '<div id="film-data" hidden>'

def rel(path):
    """Repo-relative, so messages read the same from any working directory."""
    return os.path.relpath(path, ROOT)


UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36")


def slugify(title, year):
    """"Déjà Vu", 2006 -> "deja-vu-2006". Matches the existing poster filenames:
    compatibility-decompose (so "Accountant²" -> "accountant2"), drop the
    combining marks, then every run of non-alphanumerics becomes one hyphen."""
    t = unicodedata.normalize("NFKD", title)
    t = "".join(c for c in t if not unicodedata.combining(c))
    t = re.sub(r"[^a-zA-Z0-9]+", "-", t).strip("-").lower()
    return f"{t}-{year}" if year else t


def poster_600x900(url):
    """Letterboxd serves the same poster at many crops; force the 2:3 600x900
    one the rest of the covers use."""
    return re.sub(r"-\d+-\d+-\d+-\d+-crop\.jpg", "-0-600-0-900-crop.jpg", url)


def download_poster(slug, url):
    os.makedirs(POSTERS_DIR, exist_ok=True)
    dest = os.path.join(POSTERS_DIR, slug + ".jpg")
    req = urllib.request.Request(
        poster_600x900(url),
        headers={"User-Agent": UA, "Referer": "https://letterboxd.com/"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        img = resp.read()
    if not img.startswith(b"\xff\xd8\xff"):        # not a JPEG — don't write junk
        print(f"  ! that URL didn't return a JPEG ({len(img)} bytes)", file=sys.stderr)
        return False
    with open(dest, "wb") as fh:
        fh.write(img)
    print(f"  saved {rel(dest)} ({len(img) // 1024} KB)")
    return True


def fetch_for(slug, url, force=False):
    dest = os.path.join(POSTERS_DIR, slug + ".jpg")
    if os.path.exists(dest) and not force:
        print(f"  {slug}.jpg already exists — skipping")
        return True
    if not url:
        print(f"  ! no --poster given (page will show a text placeholder)")
        print(f"    drop a 2:3 JPG at {rel(dest)} yourself")
        return False
    try:
        return download_poster(slug, url)
    except Exception as exc:
        print(f"  ! poster download failed ({exc})", file=sys.stderr)
        print(f"    drop a 2:3 JPG at {rel(dest)} yourself")
        return False


def main():
    ap = argparse.ArgumentParser(
        description="Add a film + fetch its poster for the reviews page.",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--file", default="film.html",
                    help="Page file in knowledge/ to edit (default: film.html).")
    ap.add_argument("--title", help='Film title, no year (e.g. "Sinners").')
    ap.add_argument("--year", help="Release year, 4 digits.")
    ap.add_argument("--poster", default="", help="Poster image URL from Letterboxd.")
    ap.add_argument("--rating", help="0–5, halves allowed (e.g. 4.5). Omit if unrated.")
    ap.add_argument("--date", default="", help="Watch date, ISO. Defaults to today.")
    ap.add_argument("--force", action="store_true",
                    help="Add even if the title is already listed; re-download the poster.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print what would happen and change nothing.")
    args = ap.parse_args()

    if not args.title or not args.year:
        sys.exit("Provide --title and --year.")
    title, year = args.title.strip(), args.year.strip()
    if not re.match(r"^\d{4}$", year):
        sys.exit(f"--year must be 4 digits, got {year!r}.")
    iso = args.date.strip() or datetime.date.today().isoformat()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", iso):
        sys.exit(f"--date must be YYYY-MM-DD, got {iso!r}.")

    page_path = os.path.join(HERE, args.file)
    if not os.path.exists(page_path):
        sys.exit(f"Can't find {args.file} in knowledge/.")
    page = open(page_path, encoding="utf-8").read()

    slug = slugify(title, year)
    shown = f"{html.escape(title, quote=True)} ({year})"
    if f'data-title="{shown}"' in page and not args.force:
        sys.exit(f'"{title} ({year})" is already in {args.file}. Use --force to add it anyway.')

    article = (
        '  <article class="film"\n'
        f'           data-title="{shown}"\n'
        f'           data-rating="{args.rating or ""}"\n'
        f'           data-date="{iso}"\n'
        f'           data-cover="media/film/{slug}.jpg">\n'
        '           <p>\n'
        '             \n'
        '           </p>\n'
        ' </article>\n')

    if args.dry_run:
        print(f"would fetch  {rel(os.path.join(POSTERS_DIR, slug + '.jpg'))}")
        print(f"would insert into {args.file}:\n")
        print(article)
        return

    fetch_for(slug, args.poster, args.force)

    if DATA_OPEN not in page:
        sys.exit("Couldn't find the film-data block in the page.")
    page = page.replace(DATA_OPEN, DATA_OPEN + "\n\n" + article.rstrip("\n"), 1)
    with open(page_path, "w", encoding="utf-8") as fh:
        fh.write(page)

    print(f'\nAdded "{title} ({year})" to {args.file}, dated {iso}.')
    print("  -> open the page and paste your review between the new <article> tags.")


if __name__ == "__main__":
    main()
