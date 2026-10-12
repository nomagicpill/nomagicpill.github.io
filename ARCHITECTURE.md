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
css/explainer.css   Explainer shell: app layout + extra tokens (see "Explainers").
js/theme.js         Dark-mode toggle button.
js/toc.js           Scroll progress bar, collapsible sections, auto-TOC.
js/explainer.js     Explainer shell: topic drawer, Explore menu, #hash routing.
js/vendor/three/    three.js, vendored for explainers. The site's only JS library.
media/              Site-wide assets (favicons, world map SVG).

thoughts/           Essays and opinion pieces.      (~109 posts, 33 drafts)
research/           Deep-dive research writeups.    (~23 posts, 24 drafts)
knowledge/          Reference pages, archives, explainers. (~40 posts, 16 drafts)
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
  documenting the record format; follow it. `knowledge/add_book.py` and
  `knowledge/add_film.py` append records to them; `knowledge/film-bookmarklet.html`
  (not linked from the site map) installs a bookmarklet that reads a Letterboxd
  film page and copies the matching `add_film.py` command, which fetches the
  600×900 poster. The installed bookmark is only a loader; the logic lives in
  `knowledge/film-bookmarklet.js`, which it pulls from the live site cache-busted
  on each click, so editing that file updates the bookmarklet without
  reinstalling it. Stdlib Python, run by hand — not a build step.
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
- Explainers (`knowledge/powergrid.html`, …) — full-screen interactive models.
  Unlike the pages above they share a shell; see the next section.

## Explainers

Explainers are the interactive subsection of Knowledge: a full-screen live model
(usually 3D) with the prose in a drawer beside it, where clicking something in
the model opens the topic that explains it. The first is
[knowledge/powergrid.html](knowledge/powergrid.html), an interactive U.S. power
grid. On the site map they are listed in their own group under Knowledge,
`<h3 id="knowledge_explainers">Explainers</h3>`; publishing one is the usual
four-file change with its `<li>` added there.

They break the article mold on purpose, but every explainer is built from the
same pieces, so a new one starts from a known shape rather than from scratch:

```
knowledge/<name>.html      The page: app chrome, every topic as hand-written HTML, page CSS.
knowledge/media/<name>/    Its scripts: model, 3D scene, widgets, main (wiring + clock).
css/explainer.css          Shared shell styles and --xp-* tokens; loaded after main.css.
js/explainer.js            Shared shell behavior (global Explainer, no dependencies).
js/vendor/three/           three.js as a classic script, if the explainer is 3D.
```

**Every explainer works opened straight from disk** (`file://`), like the rest
of the site: no server, no build. That is why everything is a classic
`<script>`, never an ES module: browsers refuse to load modules from `file://`.
Each file wraps itself in a function and publishes what it shares on a global
(`Explainer`, `THREE`, and one namespace per explainer, e.g. `PowerGrid.sim`).

### The page format

- **Head:** the usual inline flash-free theme script, then a second small
  inline script that adds `html.xp-booting` (which hides the article while the
  model loads, with an 8-second backstop that reveals it anyway), `main.css` then
  `explainer.css`, and any page-specific tokens in an inline `<style>`.
- **Body ends** with plain `<script src>` tags: `theme.js` (the D/L toggle),
  `js/explainer.js`, then the explainer's own files with `main.js` last. No
  `toc.js`: there is no long scroll to track, and the Explore menu replaces the
  Contents list. `main.js` loads three.js and the 3D scene itself, by inserting
  script tags, and only once it has seen that WebGL works.
- **Prose** lives in the page, not in JavaScript, so it stays hand-editable and
  readable without scripts: one `<section class="xp-topic" id="…">` per topic
  inside `#xp-library`, which sits in the drawer, `<aside id="xp-drawer">`.
  Section attributes the shell understands:
  - `id`: the topic's anchor; `#id` deep-links to it and the back button works.
  - `data-title`: its name in the menu and breadcrumb.
  - `data-group`: its menu group; groups appear in order of first use.
  - `data-next`: the topic suggested at the end. Chaining these gives a guided
    tour (in powergrid, the "From plant to plug" group follows electricity from
    generator to outlet).

  A page can add its own `data-*` hooks. powergrid uses `data-focus` (where the
  camera flies), `data-voltage="on"` (colour the wires by voltage while open),
  and `data-run` on buttons (start a scenario).
- **Interactive figures** are empty placeholders, `<div class="xp-figure"
  data-widget="name">`, that the page's script mounts when the topic opens and
  destroys when it closes, so only what is on screen runs.
- **App-only chrome** (stage, HUD, controls) carries `.xp-only`; anything meant
  only for the plain article carries `.xp-article-only`.

### Progressive enhancement

Without JavaScript or WebGL an explainer is an ordinary main.css article: every
topic in order under a normal Home / title / postmeta header. `explainer.css`
hides `.xp-only`, `[data-widget]` and `[data-run]` until `js/explainer.js` stamps
`html.xp-ready`. The page's boot code loads three.js and builds its 3D scene
*before* calling `Explainer.init()`, and removes `xp-booting` whichever way it
goes, so a failure anywhere leaves the article readable. Keep that order. To check the fallback, load the page in an `<iframe sandbox="allow-same-origin">`,
which blocks its scripts.

### The shell API (`js/explainer.js`, global `Explainer`)

- `Explainer.init({ onOpen(id, section, prevId), onClose(id) })` returns
  `{ open(id), close(), current, sections, byId }`. It builds the Explore menu
  (with a filter box) from the sections, shows one topic at a time, keeps
  `location.hash` and history in sync, opens topics from any `<a href="#id">`
  or `[data-open="id"]`, and closes on Escape.
- `Explainer.cssVar(name)`, `.onThemeChange(cb)` and `.isDark()` help canvas
  drawing follow the theme.

On screens 900px and narrower the drawer becomes a bottom sheet.
`#theme-toggle` is moved into the top bar, and the drawer header leaves room for
it.

### Tokens, charts and colour

The site-wide rule holds: no hard-coded colours in the UI. `explainer.css` adds
`--xp-*` tokens (panels, secondary ink, chart grid and axis, status colours) in
the same three theme blocks as `main.css`, and a page adds its own the same way
(powergrid's `--pg-*` technology colours). Canvas widgets read tokens at draw
time with `cssVar()`; DOM swatches use `var(--…)` so they follow the toggle for
free. Categorical chart colours were chosen with a colour-blindness validator,
and the *order* of neighbors in a stack matters as much as the hues. Keep to
eight hues plus a grey "Other", one y-axis per chart, and status colours (good,
warning, critical) paired with an icon and a word. A 3D scene may use its own
naturalistic colours and day/night lighting; the panels around it follow the
theme.

### three.js (vendored)

The one deliberate exception to "no JS libraries on content pages".
`js/vendor/three/` holds three.js r186 (npm `three@0.186.1`) as classic scripts
that define a global `THREE`: `three.global.js`, `OrbitControls.global.js` and
`BufferGeometryUtils.global.js` (which attach `THREE.OrbitControls` and
`THREE.BufferGeometryUtils`), plus `LICENSE` (MIT). Nothing loads from a CDN.

three.js stopped publishing a classic build in r160, so
[js/vendor/three/to_global.py](js/vendor/three/to_global.py) makes one from the
npm package: it wraps each ES module in a function and turns its import line
and export list into plain variables, leaving the library code itself
unchanged. It is a stdlib helper run by hand when upgrading, not a build step;
its docstring has the steps (download the tarball, check its sha512 against the
registry's `integrity`, extract, run). Re-test every explainer after an
upgrade: recent releases removed `PCFSoftShadowMap` and deprecated `Clock`, for
example. three.js no longer ships minified builds either; the ~2.1 MB file
compresses to ~420 KB over the wire.

### Checking

Open the `.html` file in a browser; that's all an explainer needs. Keep each
explainer's model free of the DOM and three.js (powergrid's `sim.js`) and let it
also export itself to node (`module.exports` when `module` exists), so it can be
`require`d and sanity-checked from the command line. powergrid's fleet was
calibrated that way, until a representative year reproduced the real 2025 U.S.
generation mix to within about a point.

### powergrid specifics

- `sim.js`: the model (an island grid about an eighth of the lower 48, with the
  national fleet mix), market clearing, frequency dynamics, the scenario recipes
  with their timed captions ("beats"), and the sourced reference numbers behind
  the charts. Its numbers also appear in the prose, so when EIA, Lazard or PJM
  publish a new year, update both places and the Sources topic.
- `scene.js`: the diorama: terrain, plants, lines and towers, flow particles,
  weather, labels, picking and camera framings (`VIEWS`). Loaded by `main.js`
  after three.js.
- `widgets.js`: every chart and calculator, registered by `data-widget` name.
- `main.js`: the clock, the HUD and controls, scenario playback, and the wiring
  between topics, scene and widgets.
- **New scenario:** append to `SCENARIOS` in `sim.js` (weather, outages, beats),
  then add an `sc-<id>` topic with a `data-run="<id>"` button.
- **New topic:** add a section; give it `data-focus` (a key in `scene.js`'s
  `VIEWS`) to aim the camera.

## Third-party services

Kept to a minimum, and deliberately so:

- **Google Analytics** (`G-BRDHSW3GG3`) — only on `index.html` and
  `indexold.html`, not on content pages.
- **Substack embed** — one `<iframe>` on the homepage for subscriptions.
- No fonts, CDNs, analytics, or JS libraries are loaded on content pages. Keep it
  that way; images are downloaded into `media/` rather than hot-linked (see
  `add_book.py`'s comment about having no runtime dependency on Open Library).
  The one exception is explainers, which load three.js, and only from the copy
  committed in `js/vendor/three/`, never from a CDN.
