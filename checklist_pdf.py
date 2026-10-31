#!/usr/bin/env python3
"""Turn a post's lists into a printable PDF checklist.

A page opts in with data-checklist on the <h2> whose section becomes the
checklist. The value is where the PDF goes, relative to the page:

    <h2 id="preparation" data-checklist="media/internetdown/internet_down_checklist.pdf">

Everything from that <h2> to the next one is read:

  <h3>             starts a section of the checklist. A section with no
                   items (only paragraphs) is left out.
  <h3 data-checklist-write-in>
                   the same, but each item gets two blank lines to write
                   on, e.g. the name and address of the nearest pharmacy.
  <li> + list      a group: its <b> text becomes a heading, and the <li>s in
                   its own list are the items.
  <li>             an item: its <b> name plus the first sentence after it, so
                   write the specifics first and the why after.
  left out         <li data-no-checklist> (advice, not something to get or
                   do), notes (an <li> that starts with <i>), and anything
                   outside a list.
  <span class="qty">
                   an item's amount tag (see js/household.js) is kept with
                   its data-* attributes, so the PDF shows the static amount
                   (per person or per household, 30-day plan).

Beside the PDF it writes the same checklist as an HTML page (name.html),
which loads js/household.js: opened from the post's "Print my list" link,
it fills in the reader's household totals and prints the same layout.

By hand, from the repo root:

    python3 checklist_pdf.py thoughts/internetdown.html

Git also runs it through .githooks/pre-commit with --staged: each staged page
with data-checklist whose checklist changed gets its PDF and HTML page rebuilt
from the staged copy, and both are staged into the same commit. It never
blocks a commit: on any error it prints a warning and the old files stay.

Printing uses headless Google Chrome (or Chromium), the one piece that isn't
standard-library Python.
"""

import datetime
import html
import os
import pathlib
import re
import shutil
import string
import subprocess
import sys
import tempfile
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = 'https://nomagicpill.site/'
CHROMES = (
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome', 'chromium', 'chromium-browser',
)

H1_RE = re.compile(r'<h1\b[^>]*>(.*?)</h1>', re.S)
H2_RE = re.compile(r'<h2\b[^>]*\bdata-checklist="([^"]+)"[^>]*>', re.S)
COMMENT_RE = re.compile(r'<!--.*?-->', re.S)
TAG_RE = re.compile(r'<[^>]+>')
# A sentence ends at a period followed by a space and a capital or digit
# (maybe after an opening quote), except the period that ends "e.g." or "i.e.".
SENTENCE_END_RE = re.compile(r'(?<!e\.g)(?<!i\.e)\.(?=\s+["“]?[A-Z0-9])')
VOID = {'br', 'hr', 'img', 'input', 'link', 'meta', 'wbr'}
WRITE_IN = '<span class="write-in"></span><span class="write-in"></span>'

PAGE = string.Template("""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>$title: Checklist</title>
<style>
  @page {
    size: letter;
    margin: 0.5in 0.5in 0.6in;
    @bottom-left { content: "$url_short"; font: 7.5pt Arial, sans-serif; color: #555; }
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt Arial, sans-serif; color: #555; }
  }
  body { margin: 0; font: 9pt/1.3 Arial, Helvetica, sans-serif; color: #000; }
  header { border-bottom: 1.5pt solid #000; padding-bottom: 5pt; margin-bottom: 8pt; }
  h1 { font-size: 16pt; margin: 0 0 3pt; }
  header p { margin: 0; font-size: 8.5pt; }
  main { column-count: 2; column-gap: 0.3in; }
  h2 { font-size: 12pt; margin: 9pt 0 3pt; padding-bottom: 1pt; border-bottom: 0.75pt solid #000; break-after: avoid; }
  section:first-child h2 { margin-top: 0; }
  h3 { font-size: 9.5pt; margin: 6pt 0 2pt; break-after: avoid; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { position: relative; padding-left: 14pt; margin-bottom: 3pt; break-inside: avoid; }
  li::before { content: ""; position: absolute; left: 0; top: 1pt; width: 8.5pt; height: 8.5pt; border: 0.9pt solid #000; border-radius: 1.5pt; }
  .write-in { display: block; height: 15pt; border-bottom: 0.6pt solid #888; }
  .qty { font-weight: bold; white-space: nowrap; border: 0.6pt solid #000; border-radius: 2.5pt; padding: 0 2.5pt; font-size: 8pt; }
  a { color: inherit; }
  [hidden] { display: none !important; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12pt; margin-bottom: 10pt; padding: 8pt; border: 1pt solid #000; font-size: 11pt; }
  .toolbar button { font: inherit; padding: 4pt 12pt; cursor: pointer; }
  @media print { .toolbar { display: none !important; } }
</style>
</head>
<body>
<div class="toolbar" id="hh-toolbar" hidden>
  <button id="hh-print-now">Print or Save as PDF</button>
  <a href="$url#household">Change the household</a>
</div>
<header>
  <h1>$title: Checklist</h1>
  <p>Why each item matters, and the rest of the post: <a href="$url">$url_short</a>. Updated $updated.</p>
  <p id="hh-note">Amounts are per person or per household, for a 30-day plan. For your household's totals, <a href="$url#household">enter it on the page</a> and print your own list.</p>
</header>
<main>
$body
</main>
$script
</body>
</html>
""")


class Node:
    def __init__(self, tag, attrs):
        self.tag = tag
        self.attrs = dict(attrs)
        self.children = []


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('root', [])
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def parse(fragment):
    builder = TreeBuilder()
    builder.feed(fragment)
    builder.close()
    return builder.root


def squash(s):
    return re.sub(r'\s+', ' ', s)


def text(node):
    if isinstance(node, str):
        return node
    return ''.join(text(c) for c in node.children)


def inline(nodes):
    """Re-emit nodes as HTML, keeping only <b>, <i> and absolute links."""
    out = []
    for n in nodes:
        if isinstance(n, str):
            out.append(html.escape(n, quote=False))
        elif n.tag in ('b', 'i'):
            out.append('<%s>%s</%s>' % (n.tag, inline(n.children), n.tag))
        elif n.tag == 'a' and n.attrs.get('href', '').startswith('http'):
            out.append('<a href="%s">%s</a>' % (html.escape(n.attrs['href']),
                                                inline(n.children)))
        elif n.tag == 'span' and 'qty' in (n.attrs.get('class') or '').split():
            attrs = ''.join(' %s="%s"' % (k, html.escape(v or ''))
                            for k, v in n.attrs.items()
                            if k == 'class' or k.startswith('data-'))
            out.append('<span%s>%s</span>' % (attrs, inline(n.children)))
        elif n.tag not in ('ul', 'ol'):
            out.append(inline(n.children))
    return ''.join(out)


def first_sentence(s):
    m = SENTENCE_END_RE.search(s)
    return s[:m.end()] if m else s


def entries(lst):
    """A list's checklist entries: ('item', html) or ('group', heading, entries)."""
    out = []
    number = int(lst.attrs.get('start') or 1) - 1
    for li in lst.children:
        if isinstance(li, str) or li.tag != 'li':
            continue
        number += 1
        if 'data-no-checklist' in li.attrs:
            continue
        kids = [k for k in li.children if not (isinstance(k, str) and not k.strip())]
        if not kids or (not isinstance(kids[0], str) and kids[0].tag == 'i'):
            continue
        sublists = [k for k in kids if not isinstance(k, str) and k.tag in ('ul', 'ol')]
        if sublists:
            heading = squash(text(kids[0])).strip().rstrip('.')
            if lst.tag == 'ol':
                heading = '%d. %s' % (number, heading)
            group = []
            for sub in sublists:
                group.extend(entries(sub))
            out.append(('group', heading, tuple(group)))
        elif not isinstance(kids[0], str) and kids[0].tag == 'b':
            after = li.children[li.children.index(kids[0]) + 1:]  # keeps the space before a tag
            rest = first_sentence(squash(inline(after)).rstrip())
            out.append(('item', '<b>%s</b>%s' % (squash(inline(kids[0].children)).strip(), rest)))
        else:
            out.append(('item', first_sentence(squash(inline(kids)).strip())))
    return tuple(out)


def checklist(page_html):
    """(pdf path relative to the page, title, sections), or None if the page has none."""
    page = COMMENT_RE.sub('', page_html)
    h2 = H2_RE.search(page)
    if not h2:
        return None
    end = page.find('<h2', h2.end())
    section = page[h2.end():] if end == -1 else page[h2.end():end]
    h1 = H1_RE.search(page)
    title = squash(html.unescape(TAG_RE.sub('', h1.group(1)))).strip() if h1 else ''

    sections = [['', [], False]]
    for node in parse(section).children:
        if isinstance(node, str):
            continue
        if node.tag == 'h3':
            sections.append([squash(text(node)).strip(), [],
                             'data-checklist-write-in' in node.attrs])
        elif node.tag in ('ul', 'ol'):
            sections[-1][1].extend(entries(node))
    sections = tuple((heading, tuple(items), write_in)
                     for heading, items, write_in in sections if items)
    return h2.group(1), title, sections


def render(items, write_in=False):
    out, run = [], []
    for entry in items + (None,):
        if entry and entry[0] == 'item':
            run.append('<li>%s%s</li>' % (entry[1], WRITE_IN if write_in else ''))
            continue
        if run:
            out.append('<ul>\n%s\n</ul>' % '\n'.join(run))
            run = []
        if entry:
            out.append('<h3>%s</h3>' % html.escape(entry[1], quote=False))
            out.append(render(entry[2], write_in))
    return '\n'.join(out)


def document(page, found, script=None):
    """The checklist page. Without a script it stays static, as in the PDF."""
    _, title, sections = found
    url = SITE + page.replace(os.sep, '/')
    today = datetime.date.today()
    body = '\n'.join('<section>\n<h2>%s</h2>\n%s\n</section>'
                     % (html.escape(heading, quote=False), render(items, write_in))
                     for heading, items, write_in in sections)
    return PAGE.substitute(
        title=html.escape(title, quote=False), url=html.escape(url),
        url_short=url.split('://', 1)[1],
        updated='%d %s %d' % (today.day, today.strftime('%B'), today.year),
        body=body,
        script='<script src="%s"></script>' % html.escape(script) if script else '')


def outputs(page, found):
    """The PDF and HTML checklist paths, relative to the repo root."""
    pdf = os.path.normpath(os.path.join(os.path.dirname(page), found[0]))
    return pdf, os.path.splitext(pdf)[0] + '.html'


def build(page, found):
    """Write the page's checklist HTML and print its PDF."""
    pdf, page_html = outputs(page, found)
    script = os.path.relpath(os.path.join('js', 'household.js'), os.path.dirname(page_html))
    os.makedirs(os.path.join(ROOT, os.path.dirname(pdf)), exist_ok=True)
    with open(os.path.join(ROOT, page_html), 'w', encoding='utf-8') as f:
        f.write(document(page, found, script.replace(os.sep, '/')))
    print_pdf(document(page, found), os.path.join(ROOT, pdf))
    return pdf, page_html


def find_chrome():
    for c in CHROMES:
        path = c if os.path.isabs(c) else shutil.which(c)
        if path and os.path.exists(path):
            return path
    return None


def print_pdf(doc, out):
    chrome = find_chrome()
    if not chrome:
        raise RuntimeError('no Google Chrome or Chromium found to print with')
    with tempfile.TemporaryDirectory() as tmp:
        src = os.path.join(tmp, 'checklist.html')
        pdf = os.path.join(tmp, 'checklist.pdf')
        with open(src, 'w', encoding='utf-8') as f:
            f.write(doc)
        # A throwaway profile, so this doesn't collide with a Chrome that's open.
        subprocess.run([chrome, '--headless', '--disable-gpu', '--no-first-run',
                        '--no-default-browser-check',
                        '--user-data-dir=' + os.path.join(tmp, 'profile'),
                        '--no-pdf-header-footer', '--print-to-pdf-no-header',
                        '--print-to-pdf=' + pdf, pathlib.Path(src).as_uri()],
                       check=True, timeout=120,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not os.path.exists(pdf):
            raise RuntimeError('Chrome made no PDF')
        os.makedirs(os.path.dirname(out), exist_ok=True)
        shutil.copyfile(pdf, out)


def git(*args):
    return subprocess.run(('git',) + args, check=True, stdout=subprocess.PIPE,
                          stderr=subprocess.DEVNULL).stdout


def staged():
    names = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
    for page in names.decode('utf-8').split('\0'):
        if not page.endswith('.html'):
            continue
        found = checklist(git('show', ':' + page).decode('utf-8'))
        if not found:
            continue
        pdf, page_html = outputs(page, found)
        try:
            before = checklist(git('show', 'HEAD:' + page).decode('utf-8'))
        except subprocess.CalledProcessError:
            before = None
        if before == found and os.path.exists(pdf) and os.path.exists(page_html):
            continue
        build(page, found)
        git('add', '--', pdf, page_html)
        print('Checklist: rebuilt %s and %s' % (pdf, page_html), file=sys.stderr)


def main(argv):
    if argv[1:] == ['--staged']:
        try:
            staged()
        except Exception as e:
            print('Checklist: %s; PDF not rebuilt.' % e, file=sys.stderr)
        return 0
    if len(argv) != 2 or argv[1].startswith('-'):
        print(__doc__)
        return 1
    page = os.path.relpath(os.path.abspath(argv[1]), ROOT)
    with open(os.path.join(ROOT, page), encoding='utf-8') as f:
        found = checklist(f.read())
    if not found:
        sys.exit('%s has no <h2 data-checklist="...">' % page)
    for path in build(page, found):
        print(path)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
