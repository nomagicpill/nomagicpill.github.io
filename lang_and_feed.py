#!/usr/bin/env python3
"""Declare each page's language and drop its mislabeled Atom feed link.

Two sitewide fixes to the top of every page, both mechanical:

  lang  <html> becomes <html lang="en">. Without it screen readers have to
        guess which pronunciation rules to use, and browsers can't hyphenate
        or offer translation reliably. A page that already declares a language
        (the games' lang="en", the archived pages' lang="en-US") is left alone.

  atom  Removes
            <link rel="alternate" type="application/atom+xml" ... href="/feed.xml">
        feed.xml is RSS 2.0, so this link advertises the wrong format. Every
        page that has it also has the correct application/rss+xml link beside
        it; a page where the Atom link is the only feed link is reported and
        left alone. If feed.xml ever stops being RSS, the script refuses to run.

Nothing else in a file changes: line endings, a byte-order mark and
indentation are preserved, and a removed link takes its line with it only when
it was alone on that line.

Run by hand. Prints a summary and a diff and changes nothing unless --apply is
passed.

    python3 lang_and_feed.py                       # dry run over every page
    python3 lang_and_feed.py --apply               # write them
    python3 lang_and_feed.py about/draft.html --apply
"""

import argparse
import difflib
import html.parser
import os
import re
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.abspath(__file__))
LANG = ' lang="en"'
SITE = "https://nomagicpill.site/"
FEED = SITE + "feed.xml"


def pages():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(d for d in dirnames if d != ".git")
        for name in sorted(filenames):
            if name.endswith(".html"):
                yield os.path.relpath(os.path.join(dirpath, name), ROOT)


def feed_link(attrs, path):
    """'atom' or 'rss' if this <link> advertises feed.xml, else None."""
    attrs = {k: (v or "") for k, v in attrs}
    if "alternate" not in attrs.get("rel", "").lower().split():
        return None
    href = urllib.parse.urljoin(SITE + path.replace(os.sep, "/"), attrs.get("href", ""))
    if href.replace("nomagicpill.github.io", "nomagicpill.site", 1) != FEED:
        return None
    return {"application/atom+xml": "atom",
            "application/rss+xml": "rss"}.get(attrs.get("type", "").lower())


class Tags(html.parser.HTMLParser):
    """Every <html> and <link> start tag, as offsets into the text. html.parser
    skips comments and the insides of <script> and <style>, so a tag in a code
    sample or a JS string isn't counted."""

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.text = text
        self.lines = [0]
        for i, ch in enumerate(text):
            if ch == "\n":
                self.lines.append(i + 1)
        self.htmls, self.links = [], []
        self.feed(text)
        self.close()

    def handle_starttag(self, tag, attrs):
        if tag in ("html", "link"):
            line, col = self.getpos()
            start, raw = self.lines[line - 1] + col, self.get_starttag_text()
            # Belt and braces: the offset arithmetic has to land on the tag itself.
            assert self.text.startswith(raw, start), (start, raw)
            (self.htmls if tag == "html" else self.links).append(
                (start, start + len(raw), attrs))

    handle_startendtag = handle_starttag


def line_of(text, pos):
    """(start, end) of the line holding pos; end includes the newline."""
    start = text.rfind("\n", 0, pos) + 1
    end = text.find("\n", pos)
    return start, (len(text) if end == -1 else end + 1)


def fix(text, path):
    """Returns (new_text, changes, skips). new_text is None if nothing changes."""
    tags = Tags(text)
    edits, changes, skips = [], [], []

    if len(tags.htmls) != 1:
        skips.append("lang: %s <html> tags" % (len(tags.htmls) or "no"))
    elif not any(k == "lang" for k, _ in tags.htmls[0][2]):
        at = tags.htmls[0][0] + len("<html")
        edits.append((at, at, LANG))
        changes.append("lang")

    kinds = [(start, end, feed_link(attrs, path)) for start, end, attrs in tags.links]
    atoms = [(start, end) for start, end, kind in kinds if kind == "atom"]
    if atoms and not any(kind == "rss" for _, _, kind in kinds):
        skips.append("atom: it's the only feed link")
    elif atoms:
        for start, end in atoms:
            # Take the whole line if the tag is alone on it, else just the tag.
            line_start, line_end = line_of(text, start)
            if not text[line_start:start].strip() and not text[end:line_end].strip():
                start, end = line_start, line_end
            edits.append((start, end, ""))
        changes.append("atom")

    for start, end, new in sorted(edits, reverse=True):
        text = text[:start] + new + text[end:]
    return (text if edits else None), changes, skips


def events(text, path, expect=False):
    """Everything the parser sees, minus blank text. With expect=True, the
    stream as it should read after fix(): lang added, Atom feed links gone."""
    out = []

    class Rec(html.parser.HTMLParser):
        def handle_starttag(self, tag, attrs):
            if expect and tag == "html" and not any(k == "lang" for k, _ in attrs):
                attrs = [("lang", "en")] + attrs
            if expect and tag == "link" and feed_link(attrs, path) == "atom":
                return
            out.append(("start", tag, tuple(attrs)))

        handle_startendtag = handle_starttag

        def handle_endtag(self, tag):
            out.append(("end", tag))

        def handle_data(self, data):
            if data.strip():
                out.append(("data", " ".join(data.split())))

        def handle_comment(self, data):
            out.append(("comment", data))

        def handle_decl(self, decl):
            out.append(("decl", decl))

    rec = Rec(convert_charrefs=True)
    rec.feed(text)
    rec.close()
    return out


def check(old, new, path):
    """Prove new is old with exactly the intended edits and nothing else."""
    assert events(new, path) == events(old, path, expect=True), path
    again, changes, _ = fix(new, path)
    assert again is None and not changes, path


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("files", nargs="*", help="pages to fix (default: every .html)")
    parser.add_argument("--apply", action="store_true", help="write the changes")
    parser.add_argument("-q", "--quiet", action="store_true", help="summary only, no diff")
    args = parser.parse_args()

    with open(os.path.join(ROOT, "feed.xml"), encoding="utf-8") as fh:
        if not re.search(r"<rss\b", fh.read(2000)):
            sys.exit("feed.xml doesn't look like RSS any more; not touching feed links.")

    paths = [os.path.relpath(os.path.abspath(f), ROOT) for f in args.files] or list(pages())
    counts, writes = {}, []
    for path in paths:
        with open(os.path.join(ROOT, path), "rb") as fh:
            raw = fh.read()
        try:
            old = raw.decode("utf-8")
        except UnicodeDecodeError:
            new, changes, skips = None, [], ["not UTF-8"]
        else:
            new, changes, skips = fix(old, path)
        status = "+".join(changes) or "ok"
        counts[status] = counts.get(status, 0) + 1
        for skip in skips:
            counts["skip " + skip] = counts.get("skip " + skip, 0) + 1
            print("%-10s %s" % ("skip " + skip, path))
        if new is None:
            continue
        print("%-10s %s" % (status, path))
        # Every page is checked before any is written, so a surprise stops the
        # run with the tree untouched.
        check(old, new, path)
        writes.append((path, new))
        if not args.quiet:
            sys.stdout.writelines(difflib.unified_diff(
                old.splitlines(True), new.splitlines(True), path, path, n=1))

    if args.apply:
        for path, new in writes:
            with open(os.path.join(ROOT, path), "wb") as fh:
                fh.write(new.encode("utf-8"))

    print()
    for status in sorted(counts):
        print("%4d  %s" % (counts[status], status))
    if writes and not args.apply:
        print("\nDry run; nothing written. Pass --apply to write.")


if __name__ == "__main__":
    main()
