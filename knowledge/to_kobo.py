#!/usr/bin/env python3
"""Bundle a batch of article URLs into one dated EPUB for the Kobo.

A thin wrapper around `percollate epub` that gathers URLs from the command line,
a file, or your standing reading list, de-duplicates them, and writes a single
table-of-contents'd EPUB you can sideload and read (and annotate in KOReader).

Examples
--------
  # a few links, straight into one book on the Desktop
  python3 knowledge/to_kobo.py "https://a.com/x" "https://b.com/y"

  # build from a reading list you've been adding to all day
  python3 knowledge/to_kobo.py --from ~/reading.txt

  # no args: reads the standing list at knowledge/to_read.txt (if it exists)
  python3 knowledge/to_kobo.py

  # pipe URLs in (e.g. from your clipboard)
  pbpaste | python3 knowledge/to_kobo.py --from -

  # name the book and reveal it in Finder when done
  python3 knowledge/to_kobo.py --from ~/reading.txt --title "Tonight" --open

Reading-list format
-------------------
  One URL per line. Blank lines and lines starting with '#' are ignored, and
  anything after the URL on a line is treated as a note and dropped, so you can
  jot why you saved it:

      https://example.com/post   # the optimization one I want to finish

Notes
-----
  • Needs `percollate` on your PATH (npm install -g percollate).
  • Default output is ~/Desktop/kobo-YYYY-MM-DD.epub; a counter is appended if
    that name is taken, so repeat runs in a day won't clobber each other.
  • Only the Python standard library is used.
"""

import argparse
import datetime
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_LIST = os.path.join(HERE, "to_read.txt")

# percollate renders the EPUB with headless Chromium via puppeteer. Rather than
# download a second copy, point it at a browser you already have.
CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
]


def find_chrome():
    """Return a usable Chrome-family browser path, or None."""
    for path in CHROME_CANDIDATES:
        if os.access(path, os.X_OK):
            return path
    return None


def find_percollate():
    """Return a path to the percollate launcher, or exit with guidance."""
    p = shutil.which("percollate") or (
        "/usr/local/bin/percollate"
        if os.path.exists("/usr/local/bin/percollate") else None)
    if not p:
        sys.exit("Couldn't find `percollate`. Install it with:\n"
                 "  npm install -g percollate\n"
                 "and make sure its bin dir is on your PATH.")
    return p


def read_list(path):
    """Yield URLs from a reading-list file ('-' means stdin)."""
    fh = sys.stdin if path == "-" else open(path, encoding="utf-8")
    try:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            url = line.split()[0]            # drop any trailing "# note"
            if url.startswith(("http://", "https://")):
                yield url
            else:
                print(f"  ! skipping non-URL line: {line!r}", file=sys.stderr)
    finally:
        if fh is not sys.stdin:
            fh.close()


def gather_urls(args):
    """Collect, de-duplicate (order-preserving), and return the URL list."""
    urls = list(args.url)
    if args.from_:
        urls += list(read_list(args.from_))
    if not urls and not args.from_ and os.path.exists(DEFAULT_LIST):
        print(f"No URLs given; reading {os.path.relpath(DEFAULT_LIST)}.")
        urls += list(read_list(DEFAULT_LIST))
    seen, deduped = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            deduped.append(u)
    return deduped


def default_output():
    """~/Desktop/kobo-YYYY-MM-DD.epub, bumping a counter if it's taken."""
    base = os.path.expanduser(
        f"~/Desktop/kobo-{datetime.date.today():%Y-%m-%d}")
    out = base + ".epub"
    n = 2
    while os.path.exists(out):
        out = f"{base}-{n}.epub"
        n += 1
    return out


def main():
    ap = argparse.ArgumentParser(
        description="Bundle article URLs into one dated EPUB for the Kobo.",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("url", nargs="*", help="Article URLs to include.")
    ap.add_argument("-f", "--from", dest="from_", metavar="FILE",
                    help="Read URLs from a file (one per line); '-' for stdin.")
    ap.add_argument("-o", "--output", help="Output .epub path (default: dated, on Desktop).")
    ap.add_argument("-t", "--title", help="Title for the bundled EPUB.")
    ap.add_argument("--open", action="store_true",
                    help="Reveal the finished EPUB in Finder.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Print the percollate command without running it.")
    args = ap.parse_args()

    urls = gather_urls(args)
    if not urls:
        sys.exit("No URLs to bundle. Pass some URLs, --from FILE, "
                 f"or add lines to {os.path.relpath(DEFAULT_LIST)}.")

    output = os.path.expanduser(args.output) if args.output else default_output()
    cmd = [find_percollate(), "epub", "--output", output]
    if args.title:
        cmd += ["--title", args.title]
    cmd += urls

    # Let percollate borrow an installed browser instead of downloading Chromium.
    env = os.environ.copy()
    if "PUPPETEER_EXECUTABLE_PATH" not in env:
        chrome = find_chrome()
        if chrome:
            env["PUPPETEER_EXECUTABLE_PATH"] = chrome
            print(f"Using browser: {chrome}")

    print(f"Bundling {len(urls)} article(s) -> {output}")
    if args.dry_run:
        print("  " + " ".join(cmd))
        return

    try:
        subprocess.run(cmd, check=True, env=env)
    except subprocess.CalledProcessError as exc:
        hint = ("If one URL is the culprit, drop it and retry."
                if "PUPPETEER_EXECUTABLE_PATH" in env else
                "No browser found for rendering; install Chrome, or run:\n"
                "  npm install -g --allow-scripts=puppeteer percollate")
        sys.exit(f"\npercollate failed (exit {exc.returncode}). {hint}")

    print(f"\nDone -> {output}")
    print("  Sideload it to the Kobo over USB and open it in KOReader.")
    if args.open:
        subprocess.run(["open", "-R", output], check=False)


if __name__ == "__main__":
    main()
