#!/usr/bin/env python3
"""Set a post's Modified date to today when a commit really changes it.

Git runs this on every commit through .githooks/pre-commit. Turn that on once
per clone:

    git config core.hooksPath .githooks

For each published page in the commit whose text changed by more than a typo
fix, it sets

    <span class="mod">Modified <time datetime="YYYY-MM-DD">YYYY-MM-DD</time></span>

to today's date, and stages that into the same commit. An existing Modified
line is updated, the template's commented-out one is uncommented, and a page
with neither gets one under its Published line.

Left alone:

  drafts       draft*.html, and any page with an empty Published date.
  publishing   the commit that publishes a page (draftfoo.html -> foo.html is
               a new file, not a change), and pages published today.
  typos        changes where no single spot touches more than TYPO_WORDS
               words. Words are the page's visible text plus alt, title and
               data-* attribute values (film and book entries live in
               data-*). Markup, link targets, scripts and the postmeta line
               don't count, so a <head> or template edit never bumps a date.
  hand-set     a Modified date you already changed in this commit.
  half-staged  a page that also has unstaged edits: re-staging it would sweep
               them into the commit. It's named so you can bump it by hand.

Bulk guard: if more than BULK_LIMIT pages qualify, it's probably a site-wide
edit, so no dates change and the commit goes through with a note. To bump them
anyway:

    MODIFIED_BULK_OK=1 git commit ...

To skip it for one commit, `git commit --no-verify`. It never blocks a commit:
on any error it prints a warning and lets the commit through.
"""

import datetime
import difflib
import os
import re
import subprocess
import sys
from html.parser import HTMLParser

TYPO_WORDS = 3   # a change touching more words than this in one spot is real
BULK_LIMIT = 10  # more qualifying pages than this in one commit = site-wide edit

PUB_RE = re.compile(r'<span class="pub">Published <time datetime="(\d{4}-\d{2}-\d{2})">')
PUB_SPAN_RE = re.compile(r'<span class="pub">.*?</span>')
MOD_RE = re.compile(r'<span class="mod">Modified <time datetime="([^"]*)">[^<]*</time></span>')
MOD_COMMENTED_RE = re.compile(r'<!--\s*' + MOD_RE.pattern + r'\s*-->')
COMMENT_RE = re.compile(r'<!--.*?-->', re.S)
POSTMETA_RE = re.compile(r'<p class="postmeta">.*?</p>', re.S)


def git(*args):
    return subprocess.run(('git',) + args, check=True,
                          stdout=subprocess.PIPE).stdout


def git_paths(*args):
    out = git(*(args + ('-z',))).decode('utf-8')
    return [p for p in out.split('\0') if p]


def active_mod(html):
    """The Modified span that isn't inside a comment, or None."""
    comments = [m.span() for m in COMMENT_RE.finditer(html)]
    for m in MOD_RE.finditer(html):
        if not any(start <= m.start() < end for start, end in comments):
            return m
    return None


def mod_date(html):
    m = active_mod(html)
    return m.group(1) if m else None


def set_mod(html, today):
    span = '<span class="mod">Modified <time datetime="%s">%s</time></span>' % (today, today)
    m = active_mod(html) or MOD_COMMENTED_RE.search(html)
    if m:
        return html[:m.start()] + span + html[m.end():]
    m = PUB_SPAN_RE.search(html)
    if not m:
        return None
    line_start = html.rfind('\n', 0, m.start()) + 1
    indent = html[line_start:m.start()]
    if indent.strip():  # Published shares its line with other markup
        return html[:m.end()] + ' ' + span + html[m.end():]
    newline = '\r\n' if '\r\n' in html else '\n'
    return html[:m.end()] + newline + indent + span + html[m.end():]


class _Text(HTMLParser):
    """Collects the text a reader sees, one chunk per text node."""

    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.chunks = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self._skip += 1
        for name, value in attrs:
            if value and (name in ('alt', 'title') or name.startswith('data-')):
                self.chunks.append(' '.join(value.split()))

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        text = ' '.join(data.split())
        if text and not self._skip:
            self.chunks.append(text)


def page_text(html):
    parser = _Text()
    parser.feed(POSTMETA_RE.sub('', html))
    parser.close()
    return parser.chunks


def biggest_change(old_html, new_html):
    """The most words touched by any one change between two versions."""
    a, b = page_text(old_html), page_text(new_html)
    # Trim the untouched start and end first; it keeps big pages fast.
    lo = 0
    while lo < min(len(a), len(b)) and a[lo] == b[lo]:
        lo += 1
    hi = 0
    while hi < min(len(a), len(b)) - lo and a[-1 - hi] == b[-1 - hi]:
        hi += 1
    a, b = a[lo:len(a) - hi], b[lo:len(b) - hi]

    biggest = 0
    chunks = difflib.SequenceMatcher(None, a, b, autojunk=False)
    for tag, i1, i2, j1, j2 in chunks.get_opcodes():
        if tag == 'equal':
            continue
        old_words = ' '.join(a[i1:i2]).split()
        new_words = ' '.join(b[j1:j2]).split()
        words = difflib.SequenceMatcher(None, old_words, new_words, autojunk=False)
        for t, x1, x2, y1, y2 in words.get_opcodes():
            if t != 'equal':
                biggest = max(biggest, x2 - x1, y2 - y1)
    return biggest


def main():
    today = datetime.date.today().isoformat()
    # M only: a page being published arrives as a rename or a new file.
    staged = git_paths('diff', '--cached', '--name-only', '--diff-filter=M')
    unstaged = set(git_paths('diff', '--name-only'))

    due, half_staged = [], []
    for path in staged:
        if not path.endswith('.html') or os.path.basename(path).startswith('draft'):
            continue
        new = git('show', ':' + path).decode('utf-8')
        pub = PUB_RE.search(new)
        if not pub or pub.group(1) == today:
            continue
        old = git('show', 'HEAD:' + path).decode('utf-8')
        if mod_date(new) != mod_date(old) or mod_date(new) == today:
            continue
        if biggest_change(old, new) <= TYPO_WORDS:
            continue
        if path in unstaged:
            half_staged.append(path)
        else:
            due.append(path)

    for path in half_staged:
        print('Modified: %s has unstaged edits too, so its date was left alone; '
              'bump it by hand if it needs one.' % path, file=sys.stderr)

    if len(due) > BULK_LIMIT and not os.environ.get('MODIFIED_BULK_OK'):
        print('Modified: %d pages changed, which looks like a site-wide edit, '
              'so no dates were touched:' % len(due), file=sys.stderr)
        for path in due:
            print('  ' + path, file=sys.stderr)
        print('To date them anyway, undo the commit (git reset --soft HEAD~1) '
              'and recommit with MODIFIED_BULK_OK=1 git commit ...', file=sys.stderr)
        return

    for path in due:
        with open(path, encoding='utf-8', newline='') as f:
            html = f.read()
        updated = set_mod(html, today)
        if updated is None:
            print('Modified: %s has no Published line to put a date under; '
                  'left alone.' % path, file=sys.stderr)
            continue
        with open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(updated)
        git('add', '--', path)
        print('Modified: %s -> %s' % (path, today), file=sys.stderr)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  # never block a commit over a date
        print('Modified: dates not updated (%s: %s)' % (type(e).__name__, e),
              file=sys.stderr)
    sys.exit(0)
