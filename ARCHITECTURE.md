# Architecture

A hand-written static site — no build step, no framework, no package manager, no
dependencies. Every page is an `.html` file committed as-is and served as-is.
Edits are made directly to HTML; there is nothing to compile, bundle, or
generate. **Do not introduce a build system, templating engine, or npm project.**

Site: <https://nomagicpill.site> (a personal blog: thoughts, research, knowledge,
training, experiences).

## Deployment

Two paths point at the same repo contents:

- **GitHub Pages** — repo is `nomagicpill/nomagicpill.github.io`; [CNAME](CNAME)
  maps it to `nomagicpill.site`.
- **Cloudflare Workers static assets** — [wrangler.toml](wrangler.toml) serves
  the repo root (`directory = "."`) with `not_found_handling = "404-page"`.
  [.assetsignore](.assetsignore) excludes `.git`.

Both paths serve [404.html](404.html) for unknown URLs: GitHub Pages picks it up
by convention, and Cloudflare's `not_found_handling = "404-page"` looks for that
exact filename.

Deploying = pushing to `main`. There is no CI, no workflow file, no test suite.

## Layout

```
index.html          The site map. Every published page is linked from here.
indexold.html       Previous homepage design, kept around. Not linked.
feed.xml            RSS 2.0 feed, hand-edited.
404.html            Not-found page. Self-contained; see "Pages that break the mold".
CNAME               Custom domain for GitHub Pages.
wrangler.toml       Cloudflare static-asset config.

css/main.css        The stylesheet for ~all content pages.
css/index.css       Homepage-only: two-column layout + hover tooltips.
js/theme.js         Dark-mode toggle button.
js/toc.js           Scroll progress bar, collapsible sections, auto-TOC.
media/              Site-wide assets (favicons, world map SVG).

thoughts/           Essays and opinion pieces.      (~109 posts, 33 drafts)
research/           Deep-dive research writeups.    (~23 posts, 24 drafts)
knowledge/          Reference pages and archives.   (~40 posts, 16 drafts)
training/           Endurance training / fitness.   (~32 posts, 6 drafts)
experiences/        Travel and event writeups.      (~39 posts, 9 drafts)
about/              About, Now, Praise, Changelog, and the page template.
fiction/            One draft.
docs/               Standalone PDFs linked from posts.
```

Each content directory has its own `media/` subdirectory, organized one folder
per post: `thoughts/media/<postname>/image.jpg`, referenced from the post as
`media/<postname>/image.jpg`. The repo is ~1.2 GB, almost all of it committed
images — the `.git` directory alone is ~637 MB. Be deliberate about adding large
binaries.

`.DS_Store` files are committed throughout (~60 of them). They are noise; leave
them alone unless asked.

## The page template

[about/draft.html](about/draft.html) is the canonical skeleton — copy it to start
a new page. Every content page follows this shape:

```html
<!DOCTYPE html>
<html>
<head>
  <!-- inline flash-free theme script (see below) -->
  <title>Post Title - No Magic Pill</title>
  <link rel="alternate" type="application/rss+xml" ... href="/feed.xml">
  <link rel="stylesheet" type="text/css" href="../css/main.css">
  <link rel="icon" href="../media/favicon.png">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta charset="utf-8">
</head>
<body>
<h3 id="home"><a href="../index.html">Home</a></h3>   <!-- the only nav -->
<h1 id="slug">Post Title</h1>
<p>One-line subtitle/dek.</p>
<hr>
<h2 id="contents">Contents</h2>                        <!-- auto-filled by toc.js -->
<hr>
<h2 id="section">Section</h2>
...
<hr>
<h2 id="see_also">See Also</h2>
<script src="../js/theme.js"></script>
<script src="../js/toc.js"></script>
</body>
</html>
```

All paths are relative (`../css/main.css`), so pages must stay one level deep.
Sections are separated by `<hr>`. Headings carry `id` attributes for anchoring.

## Conventions

**Drafts.** An unpublished page lives in its section directory prefixed with
`draft`: `thoughts/draftambition.html`. Drafts are not linked from `index.html`
and not in the feed, but they are committed and publicly reachable by URL.

**Publishing a post** is a four-file change (see any recent commit, e.g.
`git show 9863815`):

1. `git mv thoughts/draftfoo.html thoughts/foo.html`
2. Add an `<li>` to the right `<h3>` subsection of [index.html](index.html),
   with a `data-description` attribute (the hover tooltip text — keep it short,
   the tooltip is `white-space: nowrap` on desktop)
3. Add an `<item>` to [feed.xml](feed.xml), newest first, directly below the
   commented-out template block at the top
4. Add an `<li>` to [about/changelog.html](about/changelog.html):
   `<a href="../section/foo.html">Title</a> (16 August 2026)`

`feed.xml` `<link>`/`<guid>` URLs are inconsistent — older items use
`nomagicpill.github.io`, newer ones `nomagicpill.site`. New items should use
`nomagicpill.site`.

**Series.** Multi-part posts are numbered (`identity.html`, `identity2.html`,
`identity3.html`) and each carries an `<h2 id="series">` block of links to the
whole series, placed *above* the Contents heading. `toc.js` deliberately skips
headings that precede `#contents`, which is what keeps series links out of the
generated TOC.

**Commit messages** in this repo are all literally `a`. Match the surrounding
convention or write something real — but don't be surprised by the history.

## The three shared behaviors

### 1. Theming (`js/theme.js` + tokens in `css/main.css`)

Colors are CSS custom properties (`--bg`, `--text`, `--link`, `--border`,
`--code-bg`, `--tooltip-bg`, …) defined three times in
[css/main.css](css/main.css:1): light values on bare `:root`, dark values under
`@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`,
and dark values again under `:root[data-theme="dark"]` so an explicit toggle wins
in both directions. **Never hard-code a color in a page — use the tokens.**

Every page repeats a small inline `<script>` in `<head>` that reads
`localStorage.theme` and stamps `data-theme` on `<html>` before first paint. It
must stay inline and in the head; that is what prevents the light-mode flash.
`js/theme.js` then builds the floating `D`/`L` toggle button and animates the
swap with the View Transitions API, picking one of six PowerPoint-style effects
at random (`wipe`, `circle`, `split`, `cover`, `dissolve`, `corners` — keyframes
live in [css/main.css](css/main.css:254) keyed on `[data-transition]`).

### 2. Reading enhancements (`js/toc.js`)

Three unrelated things in one file:

- A scroll progress bar (`#scroll-progress`) appended to every page.
- **Collapsible sections**: `<button class="collapsible">` followed by
  `<div class="content">` (hidden by default). Pages that use these carry their
  own small inline toggle script; `toc.js` additionally opens a collapsed
  section when something links into it (TOC entry, shared `#anchor`,
  back/forward), setting the same inline `display` and `.active` class the
  page's own script does so the two stay compatible.
- **Auto-TOC**: if a page has `<h2 id="contents">`, `toc.js` collects every
  `h2`/`h3` *after* it, nests `h3`s under the preceding `h2`, mints slugified
  `id`s for unnamed headings, and replaces the manual `<ul>` that follows the
  Contents heading. Opt a heading out with `data-no-toc`. Headings with
  `id="home"` and `id="contents"` are always skipped.

### 3. Homepage tooltips (`css/index.css`)

`index.html` is the only page (besides `indexold.html`) using
[css/index.css](css/index.css): CSS-columns two-up layout for each section, and
pure-CSS hover tooltips driven by `data-description` on each link. Tooltips flip
to render above the link for the last three items in a list, and switch to
tap-to-reveal (`:focus`) under 768px. `index.html` also ends with an inline
"random post" script that collects every internal `.html` link on the page and
jumps to one at random.

## Utility scripts

Standard-library Python helpers that splice HTML into existing pages. All are
run manually; nothing runs them automatically.

| Script | What it does |
| --- | --- |
| [knowledge/links.py](knowledge/links.py) | Adds a link + commentary to `knowledge/links.html`, creating the month's `<h2>`/`<ul>` section if needed. Auto-fetches the page `<title>`. |
| [knowledge/add_book.py](knowledge/add_book.py) | Adds an `<article class="book">` to `knowledge/books.html` and downloads the cover from Open Library into `knowledge/media/bookcovers/`. |
| [knowledge/to_kobo.py](knowledge/to_kobo.py) | Bundles article URLs into one EPUB via `percollate` (external tool). Reads `knowledge/to_read.txt`, which is gitignored. |
| [knowledge/from_kobo.py](knowledge/from_kobo.py) | The return trip: turns a Kobo `.annot` highlight file into `<blockquote>` blocks to paste into a book's notes on `knowledge/books.html`. Keeps every `<text>` element and discards the rest. |
| [experiences/add_place.py](experiences/add_place.py) | Geocodes a place via OpenStreetMap Nominatim and writes an entry into the `PLACES` block of `experiences/map.html` (delimited by `PLACES:START` / `PLACES:END` comments). |
| `knowledge/media/*/lister.py` | Regenerates `image_widths_heights.json` for the image-gallery pages (`vibes.html`, `nostalgicimages.html`). Needs `pillow` + `pillow-heif`. |

Note: despite the helper, `knowledge/books.html` is currently maintained by hand.

### Kobo highlights -> books.html

The Kobo stores highlights as Adobe Digital Editions annotation XML, one
`.annot` file per book under `Digital Editions/Annotations` on the device.
Copy them off over USB into `knowledge/media/books/annotations/`, then:

```
python3 knowledge/from_kobo.py knowledge/media/books/annotations/BOOK.annot --order reading --copy
```

`--copy` puts the output on the clipboard (macOS `pbcopy`) indented 4 spaces, so
it drops straight into a `<p>` in `books.html`; `-o FILE` writes to a file
instead, and with neither it prints to stdout (the summary goes to stderr, so
piping stays clean). Other flags: `--order reading` sorts by position in the
book, worth using because the Kobo writes its file roughly by date rather than
in reading order; `--dedupe` drops passages highlighted twice; `--indent N`
changes the indent. Several files can be passed at once, which adds a
`<!-- Title - Author -->` comment above each book's quotes.

Highlight text is re-escaped for HTML on the way out, and whitespace inside a
passage is collapsed to single spaces. Bookmarks (a saved place rather than a
selection) carry no `<text>` element and so drop out. Typed notes, if you ever
make them, live in a separate `<content>` element and are currently discarded.

## Pages that break the mold

A handful of pages skip `css/main.css` entirely and carry self-contained inline
`<style>` and `<script>` — they are apps, not essays. Treat each as its own
world; edits there don't generalize.

- `404.html` — snake, but the snake is a peloton: a cyclist collects pills and
  each one adds a rider behind them and shortens the tick interval, so the
  growth is the hazard. Uses `css/main.css` plus a handful of extra tokens
  declared inline. Two rules to preserve when editing: every asset path must be
  **root-absolute** (`/css/main.css`), because this page is served for missing
  URLs at any depth; and the game must not capture arrow keys or swipes until
  the visitor presses Start, so anyone who just wants to leave can still scroll
  and read.
- `knowledge/books.html`, `knowledge/film.html` — card grids with search/sort
  controls. Data lives inline as hidden `<article data-*>` elements that the
  page's script reads and renders. Both files carry a "HOW TO ADD" comment block
  documenting the record format; follow it. `tools/film-bookmarklet.html` (not
  linked from the site map) installs a bookmarklet that reads a Letterboxd film
  page and copies a `tools/add-film.py` command; the script fetches the 600×900
  poster and inserts the entry. Stdlib Python, run by hand — not a build step.
- `knowledge/vibes.html`, `knowledge/nostalgicimages.html` — image galleries fed
  by a generated `image_widths_heights.json`.
- `experiences/map.html` — interactive SVG travel map over `media/worldmap.svg`,
  with place data in a delimited template literal. (Heads up: this file has a
  stray duplicated `<!DOCTYPE>`/`<head>` at the top, left over from a copy-paste,
  with a wrong `<title>`. Browsers ignore it.)
- `research/media/fabs*/` — small standalone games and simulations (LOTO,
  interlocks, valve, lot prioritization, robot) that posts link out to rather
  than embed.
- `knowledge/links.html` (~844 KB) — the largest page; a flat reverse-chronological
  archive grouped by `<h2 id="month_year">`.

## Third-party services

Kept to a minimum, and deliberately so:

- **Google Analytics** (`G-BRDHSW3GG3`) — only on `index.html` and
  `indexold.html`, not on content pages.
- **Substack embed** — one `<iframe>` on the homepage for subscriptions.
- No fonts, CDNs, analytics, or JS libraries are loaded on content pages. Keep it
  that way; images are downloaded into `media/` rather than hot-linked (see
  `add_book.py`'s comment about having no runtime dependency on Open Library).
