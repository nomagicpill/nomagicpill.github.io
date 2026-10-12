#!/usr/bin/env python3
"""Make <meta charset> the first thing inside <head> on every page.

The HTML spec wants the character encoding declared within the first 1024 bytes
of the file, and the safe way to guarantee that is to make it the head's first
child: everything above it (the inline theme script, a title with non-ASCII in
it, an archived page's pile of Wayback scripts) is read before the browser knows
the encoding. Servers send `charset=utf-8` in the Content-Type header, which
wins, but pages are also opened straight from disk, where the meta is all there
is.

For each page this either moves the existing charset declaration to directly
after <head>, or inserts <meta charset="utf-8"> if the page has none. The moved
tag is kept exactly as written, so `UTF-8`, `/>` and the http-equiv form in the
archived pages all survive. Nothing else in the file changes: line endings, a
byte-order mark and indentation are preserved, and the new line copies the
indentation of the line it lands above.

Run by hand. Prints a summary and a diff and changes nothing unless --apply is
passed.

    python3 charset_first.py                       # dry run over every page
    python3 charset_first.py --apply               # write them
    python3 charset_first.py about/draft.html --apply

Pages it can't place a tag in safely are reported and left alone: plain-text
drafts with no <head>, a page with two <head> tags, a charset that sits outside
the head. Fix those by hand.
"""

import argparse
import difflib
import html.parser
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
TAG = '<meta charset="utf-8">'


def pages():
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = sorted(d for d in dirnames if d != ".git")
        for name in sorted(filenames):
            if name.endswith(".html"):
                yield os.path.relpath(os.path.join(dirpath, name), ROOT)


def is_charset(attrs):
    attrs = {k.lower(): (v or "") for k, v in attrs}
    if "charset" in attrs:
        return True
    return (attrs.get("http-equiv", "").lower() == "content-type"
            and "charset=" in attrs.get("content", "").lower())


class Tags(html.parser.HTMLParser):
    """Where <head>, </head>, <body> and each charset <meta> start, as offsets
    into the text. html.parser skips comments and the insides of <script> and
    <style>, so a <head> in a code sample or a JS string isn't counted."""

    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.text = text
        self.lines = [0]
        for i, ch in enumerate(text):
            if ch == "\n":
                self.lines.append(i + 1)
        self.heads, self.head_ends, self.bodies, self.charsets = [], [], [], []
        self.feed(text)
        self.close()

    def here(self):
        line, col = self.getpos()
        return self.lines[line - 1] + col

    def handle_starttag(self, tag, attrs):
        if tag == "head":
            self.heads.append(self.span())
        elif tag == "body":
            self.bodies.append(self.here())
        elif tag == "meta" and is_charset(attrs):
            self.charsets.append(self.span())

    handle_startendtag = handle_starttag

    def handle_endtag(self, tag):
        if tag == "head":
            self.head_ends.append(self.here())

    def span(self):
        start, raw = self.here(), self.get_starttag_text()
        # Belt and braces: the offset arithmetic has to land on the tag itself.
        assert self.text.startswith(raw, start), (start, raw)
        return start, start + len(raw)


def first_in_head(before):
    """True if only whitespace and comments sit between <head> and the charset.
    A comment isn't an element, and moving the tag above one would strand
    comments like Bootstrap's "Required meta tags always come first"."""
    return not re.sub(r"<!--.*?-->", "", before, flags=re.S).strip()


def line_of(text, pos):
    """(start, end) of the line holding pos; end includes the newline."""
    start = text.rfind("\n", 0, pos) + 1
    end = text.find("\n", pos)
    return start, (len(text) if end == -1 else end + 1)


def newline_of(text, pos):
    start, end = line_of(text, pos)
    return "\r\n" if text[start:end].endswith("\r\n") else "\n"


def fix(text):
    """Returns (new_text, status). new_text is None when nothing should change."""
    tags = Tags(text)
    if not tags.heads:
        return None, "skip: no <head>"
    if len(tags.heads) > 1:
        return None, "skip: %d <head> tags" % len(tags.heads)
    if len(tags.charsets) > 1:
        return None, "skip: %d charset declarations" % len(tags.charsets)

    head_start, head_end = tags.heads[0]
    head_close = min(tags.head_ends + tags.bodies + [len(text)])

    if tags.charsets:
        start, end = tags.charsets[0]
        if not head_end <= start < head_close:
            return None, "skip: charset is outside <head>"
        if first_in_head(text[head_end:start]):
            return None, "ok"
        tag, status = text[start:end], "moved"
        # Take the whole line if the tag is alone on it, else just the tag.
        line_start, line_end = line_of(text, start)
        if not text[line_start:start].strip() and not text[end:line_end].strip():
            start, end = line_start, line_end
        text = text[:start] + text[end:]
    else:
        tag, status = TAG, "inserted"

    # Insert after <head>: inline if <head> has company on its line, otherwise
    # as its own line, indented like the line that follows.
    line_start, line_end = line_of(text, head_end)
    if text[head_end:line_end].strip():
        text = text[:head_end] + tag + text[head_end:]
    else:
        nxt = line_end
        while nxt < len(text) and not text[nxt:line_of(text, nxt)[1]].strip():
            nxt = line_of(text, nxt)[1]
        nxt_line = text[nxt:line_of(text, nxt)[1]]
        indent = nxt_line[:len(nxt_line) - len(nxt_line.lstrip(" \t"))]
        if nxt_line.lstrip().lower().startswith("</head"):
            head_line = text[line_start:head_start]
            indent = head_line[:len(head_line) - len(head_line.lstrip(" \t"))] + "  "
        text = text[:line_end] + indent + tag + newline_of(text, head_start) + text[line_end:]
    return text, status


def check(old, new):
    """Prove new is old with only the charset tag moved: one charset, first in
    <head>, and the same sequence of tags and text otherwise."""
    tags = Tags(new)
    assert len(tags.heads) == 1 and len(tags.charsets) == 1
    assert first_in_head(new[tags.heads[0][1]:tags.charsets[0][0]])
    assert len(new[:tags.charsets[0][1]].encode("utf-8")) <= 1024
    assert events(old) == events(new)
    assert fix(new) == (None, "ok")


def events(text):
    """Everything the parser sees, minus charset metas and blank text."""
    out = []

    class Rec(html.parser.HTMLParser):
        def handle_starttag(self, tag, attrs):
            if not (tag == "meta" and is_charset(attrs)):
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


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("files", nargs="*", help="pages to fix (default: every .html)")
    parser.add_argument("--apply", action="store_true", help="write the changes")
    parser.add_argument("-q", "--quiet", action="store_true", help="summary only, no diff")
    args = parser.parse_args()

    paths = [os.path.relpath(os.path.abspath(f), ROOT) for f in args.files] or list(pages())
    counts, writes = {}, []
    for path in paths:
        with open(os.path.join(ROOT, path), "rb") as fh:
            raw = fh.read()
        try:
            old = raw.decode("utf-8")
        except UnicodeDecodeError:
            new, status = None, "skip: not UTF-8"
        else:
            new, status = fix(old)
        counts[status] = counts.get(status, 0) + 1
        if status != "ok":
            print("%-10s %s" % (status, path))
        if new is None:
            continue
        # Every page is checked before any is written, so a surprise stops the
        # run with the tree untouched.
        check(old, new)
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
    if not args.apply and (counts.get("moved") or counts.get("inserted")):
        print("\nDry run; nothing written. Pass --apply to write.")


if __name__ == "__main__":
    main()
