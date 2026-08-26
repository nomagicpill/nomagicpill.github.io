#!/usr/bin/env python3
"""Turn Kobo/Adobe .annot highlight files into <blockquote> blocks for books.html.

The Kobo stores its highlights as Adobe Digital Editions annotation XML (one
`.annot` file per book, under `Digital Editions/Annotations` on the device).
Every highlight is a `<text>` element buried in scaffolding — identifiers,
timestamps, EPUB fragment offsets. This script keeps the `<text>` contents and
throws the rest away, printing each highlight as a `<blockquote>` you can paste
straight into a book's notes on knowledge/books.html.

Bookmarks (annotations with no `<text>`, i.e. a saved place rather than a
selection) are skipped, since there is nothing to quote.

Examples
--------
  # highlights -> stdout
  python3 knowledge/from_kobo.py knowledge/media/books/annotations/shadowofthesun.libgen.li.epub.annot

  # straight to the clipboard, ready to paste into books.html (macOS)
  python3 knowledge/from_kobo.py *.annot --copy

  # in reading order rather than the order the Kobo wrote them
  python3 knowledge/from_kobo.py book.annot --order reading

  # to a file
  python3 knowledge/from_kobo.py book.annot -o quotes.html

Notes
-----
  • Highlight text is unescaped by the XML parser and then re-escaped for HTML,
    so an ampersand or angle bracket in the passage comes out as a valid entity.
  • Newlines and runs of spaces inside a highlight are collapsed to one space;
    the Kobo often ends a selection mid-sentence, and that whitespace is noise.
  • Output goes to stdout and the summary to stderr, so piping stays clean.
  • Only the Python standard library is used.
"""

import argparse
import html
import re
import subprocess
import sys
import xml.etree.ElementTree as ET


def localname(tag):
    """Strip the XML namespace from a tag: '{ns}text' -> 'text'."""
    return tag.rsplit("}", 1)[-1]


def highlights(path):
    """Yield (text, progress) for every highlight in one .annot file.

    `progress` is the fraction-through-the-book the Kobo recorded for the
    highlight (used only for --order reading); it is None if absent.
    """
    try:
        root = ET.parse(sys.stdin if path == "-" else path).getroot()
    except ET.ParseError as exc:
        sys.exit(f"{path}: doesn't parse as XML ({exc}).\n"
                 "Expected an Adobe Digital Editions .annot file.")
    except OSError as exc:
        sys.exit(f"Can't read {path}: {exc}")

    for parent in root.iter():
        # progress lives on the <fragment> that wraps the <text>
        progress = parent.get("progress")
        for el in parent:
            if localname(el.tag) != "text":
                continue
            text = re.sub(r"\s+", " ", "".join(el.itertext())).strip()
            if text:
                yield text, (float(progress) if progress else None)


def book_title(path):
    """Return 'Title — Author' from the file's <publication>, or the filename."""
    if path == "-":
        return "stdin"
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        return path
    fields = {localname(e.tag): (e.text or "").strip()
              for e in root.iter() if localname(e.tag) in ("title", "creator")}
    title, author = fields.get("title", ""), fields.get("creator", "")
    return " — ".join(p for p in (title, author) if p) or path


def render(text, indent):
    """Wrap one highlight in a <blockquote>, indented like books.html."""
    pad = " " * indent
    return (f"{pad}<blockquote>\n"
            f"{pad}  {html.escape(text, quote=False)}\n"
            f"{pad}</blockquote>")


def main():
    ap = argparse.ArgumentParser(
        description="Turn Kobo .annot highlights into <blockquote> blocks.",
        formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("annot", nargs="+", help="One or more .annot files ('-' for stdin).")
    ap.add_argument("-o", "--output", help="Write to a file instead of stdout.")
    ap.add_argument("-i", "--indent", type=int, default=4, metavar="N",
                    help="Spaces to indent each <blockquote> (default: 4, "
                         "matching books.html).")
    ap.add_argument("--order", choices=("file", "reading"), default="file",
                    help="'file' keeps the Kobo's own order (default); "
                         "'reading' sorts by position in the book.")
    ap.add_argument("--dedupe", action="store_true",
                    help="Drop highlights whose text repeats exactly.")
    ap.add_argument("--copy", action="store_true",
                    help="Also copy the output to the clipboard (macOS pbcopy).")
    args = ap.parse_args()

    blocks, total, dupes = [], 0, 0
    seen = set()
    for path in args.annot:
        found = list(highlights(path))
        total += len(found)
        if args.order == "reading":
            # highlights with no progress recorded keep their spot at the end
            found.sort(key=lambda h: (h[1] is None, h[1]))
        if len(args.annot) > 1 and found:
            blocks.append(" " * args.indent + f"<!-- {book_title(path)} -->")
        for text, _ in found:
            if text in seen:
                dupes += 1
                if args.dedupe:
                    continue
            seen.add(text)
            blocks.append(render(text, args.indent))
        if not found:
            print(f"  ! no highlights in {path}", file=sys.stderr)

    out = "\n".join(blocks) + ("\n" if blocks else "")
    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(out)
    else:
        sys.stdout.write(out)

    if args.copy:
        try:
            subprocess.run(["pbcopy"], input=out.encode("utf-8"), check=True)
            print("Copied to the clipboard.", file=sys.stderr)
        except (OSError, subprocess.CalledProcessError) as exc:
            print(f"  ! couldn't copy to the clipboard: {exc}", file=sys.stderr)

    kept = total - (dupes if args.dedupe else 0)
    summary = f"{kept} highlight(s)"
    if dupes:
        summary += f" ({dupes} duplicate(s) " + ("dropped" if args.dedupe else "kept") + ")"
    if args.output:
        summary += f" -> {args.output}"
    print(summary, file=sys.stderr)


if __name__ == "__main__":
    main()
