#!/usr/bin/env python3
"""Insert the .postmeta line into published posts.

Publish dates already live in two places -- about/changelog.html and feed.xml --
but nowhere on the post itself. This reads both, maps each post file to its
date, and splices a metadata line in directly under the <h1>:

    <p class="postmeta">
      <span class="pub">Published <time datetime="2021-05-06">2021-05-06</time></span>
      <span class="mod">Modified <time datetime="2025-07-28">2025-07-28</time></span>
    </p>

Presentation (separators, star notation) lives in the .postmeta block of
css/main.css, so this script only ever writes data.

Run by hand. Prints a preview and changes nothing unless --apply is passed.

    python3 backfill_meta.py                      # dry run over every post
    python3 backfill_meta.py --apply              # write them
    python3 backfill_meta.py thoughts/boredom.html --rank 4 --apply

--rank and --modified are per-post editorial facts with no source to backfill
from, so they are only accepted alongside a single named file. A modified date
in particular is a judgement call, not something to read out of git: most posts'
most recent commit is a sitewide mechanical edit (a viewport meta, the theme
script) that changed no prose.
"""

import argparse
import os
import re
import sys

SECTIONS = ("thoughts", "research", "knowledge", "training", "experiences", "fiction")
ROOT = os.path.dirname(os.path.abspath(__file__))

# Only for reading the two existing sources; output is always ISO.
MONTHS = {m: i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June",
     "July", "August", "September", "October", "November", "December"], 1)}
ABBR = {m[:3]: i for m, i in MONTHS.items()}


def read(path):
    with open(os.path.join(ROOT, path), encoding="utf-8") as fh:
        return fh.read()


def iso(day, month, year):
    return "%04d-%02d-%02d" % (year, month, day)


ENTRY = re.compile(
    r'<a href="\.\./([^"#]+\.html)(#[^"]*)?"[^>]*>.*?</a>'
    r'\s*\((\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\)', re.S)


def changelog_dates():
    """Two mappings out of about/changelog.html, which must not be conflated:

    pages    -- the page's own entry, href with no fragment. This is the
                publish date.
    sections -- earliest entry whose href carries a fragment. Those announce one
                section of a living page, not the page.

    knowledge/improvements.html is why: eight of its nine entries are section
    announcements (#office_chair, #slow_cooker, ...) sitting alongside the real
    2020-08-27 page entry. Reading a section's date as the page's publish date
    is wrong, and reads as a changelog/feed conflict when it happens.

    Earliest wins in both, so a page announced more than once keeps the date it
    first appeared rather than whichever entry the file happens to list first.
    """
    pages, sections = {}, {}
    for path, fragment, day, month, year in ENTRY.findall(read("about/changelog.html")):
        if month not in MONTHS:
            continue
        stamp = iso(int(day), MONTHS[month], int(year))
        target = sections if fragment else pages
        if stamp < target.get(path, "9999-99-99"):
            target[path] = stamp
    return pages, sections


def feed_dates():
    """The same page/section split out of feed.xml's RFC-822 <pubDate>. The feed
    announces living-page sections too, with the fragment on the <link>. Both
    host spellings appear in the file."""
    pages, sections = {}, {}
    item = re.compile(r"<item>(.*?)</item>", re.S)
    link = re.compile(r"<link>https://nomagicpill\.(?:github\.io|site)/([^<]+)</link>")
    pub = re.compile(r"<pubDate>[A-Za-z]{3},\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})")
    for body in item.findall(read("feed.xml")):
        found_link, found_pub = link.search(body), pub.search(body)
        if not (found_link and found_pub):
            continue
        day, month, year = found_pub.groups()
        if month not in ABBR:
            continue
        path, _, fragment = found_link.group(1).partition("#")
        stamp = iso(int(day), ABBR[month], int(year))
        target = sections if fragment else pages
        if stamp < target.get(path, "9999-99-99"):
            target[path] = stamp
    return pages, sections


def published_posts():
    posts = []
    for section in SECTIONS:
        directory = os.path.join(ROOT, section)
        if not os.path.isdir(directory):
            continue
        for name in sorted(os.listdir(directory)):
            if name.endswith(".html") and not name.startswith("draft"):
                posts.append("%s/%s" % (section, name))
    return posts


def build_line(published, modified=None, rank=None):
    """The labels are real text, not CSS ::before content, so the line still
    reads correctly with no stylesheet. Dates render in the same ISO form the
    datetime attribute carries, so the machine-readable value and the displayed
    one are literally the same string and cannot drift apart."""
    parts = ['  <span class="pub">Published '
             '<time datetime="%s">%s</time></span>' % (published, published)]
    if modified:
        parts.append('  <span class="mod">Modified '
                     '<time datetime="%s">%s</time></span>'
                     % (modified, modified))
    if rank:
        parts.append('  <span class="rank" data-rank="%s"></span>' % rank)
    return '<p class="postmeta">\n%s\n</p>\n' % "\n".join(parts)


EXISTING = re.compile(r'^<p class="postmeta">.*?^</p>\n\n?', re.M | re.S)


def unstamp(source):
    """Remove an existing meta line so a revised one can take its place."""
    return EXISTING.sub("", source, count=1)


# [ \t]*$ rather than \s*$: \s would swallow the newline ending the <h1> line
# and throw the blank-line count off by one.
H1 = re.compile(r'^<h1\b[^>]*>.*?</h1>[ \t]*$', re.M)


def splice(source, line):
    """Insert the meta line just after the first single-line top-level <h1>,
    normalised to exactly one blank line on either side."""
    match = H1.search(source)
    if not match:
        return None
    end = match.end()
    return source[:end] + "\n\n" + line + "\n" + source[end:].lstrip("\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("files", nargs="*", help="posts to stamp (default: all published)")
    parser.add_argument("--apply", action="store_true", help="write the changes")
    parser.add_argument("--rank", choices=list("12345"), help="importance 1-5 (single file)")
    parser.add_argument("--modified", metavar="YYYY-MM-DD",
                        help="date of the last substantive revision (single file)")
    parser.add_argument("--restamp", action="store_true",
                        help="replace an existing meta line instead of skipping it")
    parser.add_argument("--published", metavar="YYYY-MM-DD",
                        help="publish date when neither source knows it (single file)")
    args = parser.parse_args()

    per_post = (args.rank, args.modified, args.published)
    if any(per_post) and len(args.files) != 1:
        parser.error("--rank/--modified/--published describe one post; name exactly one file")
    if args.restamp and len(args.files) != 1:
        parser.error("--restamp rewrites one post; name exactly one file")
    for stamp in (args.modified, args.published):
        if stamp and not re.match(r"^\d{4}-\d{2}-\d{2}$", stamp):
            parser.error("dates must be YYYY-MM-DD, got %r" % stamp)

    changelog, changelog_sections = changelog_dates()
    feed, feed_sections = feed_dates()
    targets = [f.strip("./") for f in args.files] or published_posts()

    stamped, skipped, unresolved, conflicts = [], [], [], []
    for path in targets:
        full = os.path.join(ROOT, path)
        if not os.path.isfile(full):
            sys.exit("no such file: %s" % path)
        source = read(path)
        if 'class="postmeta"' in source:
            if not args.restamp:
                skipped.append((path, "already has a meta line"))
                continue
            source = unstamp(source)

        published = args.published or changelog.get(path) or feed.get(path)
        if not published:
            unresolved.append(path)
            continue
        if path in changelog and path in feed and changelog[path] != feed[path]:
            conflicts.append((path, changelog[path], feed[path]))

        result = splice(source, build_line(published, args.modified, args.rank))
        if result is None:
            skipped.append((path, "no single-line <h1> to anchor to"))
            continue
        if args.apply:
            with open(full, "w", encoding="utf-8") as fh:
                fh.write(result)
        stamped.append((path, published))

    verb = "stamped" if args.apply else "would stamp"
    print("%s %d post(s)" % (verb, len(stamped)))
    if len(targets) <= 5:
        for path, published in stamped:
            print("\n--- %s ---" % path)
            print(build_line(published, args.modified, args.rank).rstrip())
    if conflicts:
        print("\nchangelog/feed disagree (used the changelog's date):")
        for path, a, b in conflicts:
            print("  %s  changelog=%s  feed=%s" % (path, a, b))
    if skipped:
        print("\nskipped %d:" % len(skipped))
        for path, why in skipped:
            print("  %s  (%s)" % (path, why))
    if unresolved:
        print("\nno date in either source (%d) -- stamp these with --published:"
              % len(unresolved))
        for path in unresolved:
            hint = min(d for d in (changelog_sections.get(path),
                                   feed_sections.get(path)) if d) \
                if (changelog_sections.get(path) or feed_sections.get(path)) else None
            print("  %s%s" % (path, "   (only ever announced by section;"
                                    " earliest was %s)" % hint if hint else ""))
    if not args.apply and stamped:
        print("\ndry run; nothing written. re-run with --apply")


if __name__ == "__main__":
    main()
