#!/usr/bin/env python3
"""Bundle a batch of article URLs into one EPUB for the Kobo.

Gathers URLs from the command line, a file, or your standing reading list, then
runs `percollate` once to bundle them all into a single table-of-contents'd EPUB
you can sideload and read (and annotate in KOReader).

percollate is told to process the URLs sequentially (`--wait`) rather than
launching several headless Chromium instances at once, which is flaky on this
machine; the cover step (`--no-cover`) is skipped for the same reason.

Examples
--------
  # a few links -> one EPUB in ~/Documents/personal/books/articles
  python3 knowledge/to_kobo.py "https://a.com/x" "https://b.com/y"

  # build from a reading list you've been adding to all day
  python3 knowledge/to_kobo.py --from ~/reading.txt --open

  # no args: reads the standing list at knowledge/to_read.txt (if it exists)
  python3 knowledge/to_kobo.py

  # pipe URLs in (e.g. from your clipboard)
  pbpaste | python3 knowledge/to_kobo.py --from -

Reading-list format
-------------------
  One URL per line. Blank lines and lines starting with '#' are ignored, and
  anything after the URL on a line is treated as a note and dropped, so you can
  jot why you saved it:

      https://example.com/post   # the optimization one I want to finish

Notes
-----
  • Needs `percollate` on your PATH (npm install -g percollate) and a
    version-matched Chromium under ~/.cache/percollate-chromium (this script
    prints the one-time download command if it's missing).
  • Output is ~/Documents/personal/books/articles/kobo-YYYY-MM-DD.epub by default
    (--output to change, --title to set the book title); a counter is appended if
    the name is taken. The folder is created if it doesn't exist.
  • All URLs go into one EPUB, so a single broken link fails the batch — comment
    it out in the list and rerun.
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

# percollate ships puppeteer 19, which can only drive an old Chromium — a modern
# system Chrome crashes its (removed) old headless mode mid-render, and its own
# auto-downloader is broken on Node 26. So we keep a version-matched Chromium
# under ~/.cache and point puppeteer straight at it. (x64 build, rev 1108766, to
# match the x64 Node from Intel Homebrew running under Rosetta.)
MATCHED_CHROMIUM = os.path.expanduser(
    "~/.cache/percollate-chromium/chrome-mac/Chromium.app/Contents/MacOS/Chromium")
CHROMIUM_URL = ("https://storage.googleapis.com/chromium-browser-snapshots/"
                "Mac/1108766/chrome-mac.zip")


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


def chromium_env():
    """Return an env dict pointing puppeteer at the matched Chromium, or exit."""
    env = os.environ.copy()
    if "PUPPETEER_EXECUTABLE_PATH" in env:
        return env
    if os.access(MATCHED_CHROMIUM, os.X_OK):
        env["PUPPETEER_EXECUTABLE_PATH"] = MATCHED_CHROMIUM
        return env
    sys.exit(
        "Can't find the Chromium percollate needs at:\n"
        f"  {MATCHED_CHROMIUM}\n\n"
        "Download it once with:\n"
        "  mkdir -p ~/.cache/percollate-chromium\n"
        f"  curl -fL -o /tmp/c.zip {CHROMIUM_URL}\n"
        "  unzip -q -o /tmp/c.zip -d ~/.cache/percollate-chromium && rm /tmp/c.zip")


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


OUTPUT_DIR = os.path.expanduser("~/Documents/personal/books/articles")


def pick_output(args):
    """Return the output .epub path, bumping a counter if it's taken."""
    if args.output:
        return os.path.expanduser(args.output)
    base = os.path.join(OUTPUT_DIR, f"kobo-{datetime.date.today():%Y-%m-%d}")
    out, n = base + ".epub", 2
    while os.path.exists(out):
        out = f"{base}-{n}.epub"
        n += 1
    return out


def main():
    ap = argparse.ArgumentParser(
        description="Bundle article URLs into one EPUB for the Kobo.",
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

    output = pick_output(args)
    title = args.title or f"Reading {datetime.date.today():%Y-%m-%d}"
    percollate = find_percollate()
    # --wait: process sequentially (one Chromium at a time); --no-cover: skip the
    # screenshot-based cover, which crashes the old Chromium under Rosetta.
    cmd = [percollate, "epub", "--wait", "1", "--no-cover",
           "--title", title, "--output", output] + urls

    print(f"Bundling {len(urls)} article(s) -> {output}")
    if args.dry_run:
        print("  " + " ".join(cmd))
        return

    out_dir = os.path.dirname(output)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    try:
        subprocess.run(cmd, check=True, env=chromium_env())
    except subprocess.CalledProcessError as exc:
        sys.exit(f"\npercollate failed (exit {exc.returncode}). "
                 "If one URL is the culprit, comment it out in the list and retry.")

    print(f"\nDone -> {output}")
    print("  Sideload it to the Kobo over USB and open it in KOReader.")
    if args.open:
        subprocess.run(["open", "-R", output], check=False)


if __name__ == "__main__":
    main()
