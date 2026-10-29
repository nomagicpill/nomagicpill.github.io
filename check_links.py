#!/usr/bin/env python3
"""Find broken links across the site, and get live ones into the Wayback Machine.

Three lists, printed in this order:

  dead           external links that answer 404 or 410, or whose host no
                 longer exists. Each comes with the newest good Wayback Machine
                 copy, if there is one, to swap in by hand. Those lookups go
                 at the Archive's pace (see --save), about four seconds each.
  couldn't tell  external links that answered anything else: 403, 429, 5xx, a
                 timeout, a bad certificate, or a redirect to the site's front
                 page (the usual sign a page was taken down). Most are sites
                 that turn scripts away and load fine in a browser. A host with
                 more than three of these is folded into one line; -v lists
                 every link.
  missing        links and images inside the site (relative paths, /root paths,
                 nomagicpill.site URLs) that point at a file that isn't there.
                 The match is case-sensitive, as on GitHub Pages and
                 Cloudflare, even though the Mac's disk isn't.

Run by hand. Changes no files. Exits 1 if anything is dead or missing.

    python3 check_links.py                           # every published page
    python3 check_links.py thoughts/foo.html         # just these pages
    python3 check_links.py --drafts                  # drafts too
    python3 check_links.py thoughts/foo.html --save  # and archive its links

--save asks the Wayback Machine to capture each live link it has no copy of
yet (YouTube and Vimeo excepted: a capture holds the page, not the video).
Run it on a post when you publish it. It goes one request at a time,
because the Internet Archive blocks clients that go faster (roughly 15 a
minute), so the whole site at once is a run of hours; interrupting it loses
nothing already saved.

Links into web.archive.org and archive.today are not checked: they are already
the fallback, and fetching Wayback pages counts against that same limit.
Outside the site only <a href> is checked, not images or embeds.
"""

import argparse
import collections
import concurrent.futures
import html.parser
import http.client
import itertools
import json
import os
import posixpath
import re
import shutil
import socket
import ssl
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
SECTIONS = ("thoughts", "research", "knowledge", "training", "experiences", "fiction", "about")
TOP_PAGES = ("index.html", "404.html")

OWN_HOSTS = {"nomagicpill.site", "www.nomagicpill.site", "nomagicpill.github.io"}
ARCHIVE_HOSTS = {"web.archive.org", "wayback.archive.org", "archive.ph", "archive.today",
                 "archive.is", "archive.li", "archive.md", "archive.vn", "archive.fo"}
NOT_LINKS = ("#", "mailto:", "tel:", "sms:", "javascript:", "data:")
NOT_SAVED = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "vimeo.com", "www.vimeo.com"}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; nomagicpill-linkcheck/1.0; +https://nomagicpill.site)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
WORKERS = 16
PER_HOST = 2          # at most this many requests to one host at a time
TIMEOUT = 20

CDX = "https://web.archive.org/cdx/search/cdx?"
SAVE = "https://web.archive.org/save/"
LOOKUP_GAP = 4.0      # seconds between Wayback lookups (one a second got refused)
SAVE_GAP = 5.0        # and between capture requests

NO_SUCH_HOST = {socket.EAI_NONAME} | ({socket.EAI_NODATA} if hasattr(socket, "EAI_NODATA") else set())
RETRY = {"timed out", "connection reset", "DNS lookup failed"}


def pages(drafts):
    found = [p for p in TOP_PAGES if os.path.isfile(os.path.join(ROOT, p))]
    for section in SECTIONS:
        directory = os.path.join(ROOT, section)
        if not os.path.isdir(directory):
            continue
        for name in sorted(os.listdir(directory)):
            if name.endswith(".html") and (drafts or not name.startswith("draft")):
                found.append("%s/%s" % (section, name))
    return found


class Refs(html.parser.HTMLParser):
    """Every href and src on a page, with its line. Comments and script bodies
    are skipped by the parser, so commented-out links don't count."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.refs = []

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ("href", "src") and value and value.strip():
                self.refs.append((self.getpos()[0], tag, value.strip()))


# ---------------------------------------------------------------------------
# Inside the site: does the file exist?

_listings = {}


def is_file_exact(rel):
    """True if ROOT/rel is a file, matching each path component's case exactly.
    The Mac's disk would happily open media/Foo.jpg for media/foo.jpg; the
    servers won't."""
    directory = ROOT
    parts = [p for p in rel.split("/") if p]
    for part in parts:
        if directory not in _listings:
            try:
                _listings[directory] = {unicodedata.normalize("NFC", n) for n in os.listdir(directory)}
            except OSError:
                _listings[directory] = set()
        if unicodedata.normalize("NFC", part) not in _listings[directory]:
            return False
        directory = os.path.join(directory, part)
    return bool(parts) and os.path.isfile(directory)


def site_path(page, path):
    """Where a link from `page` to `path` (the URL's path part, still
    percent-encoded) points, relative to ROOT."""
    path = urllib.parse.unquote(path)
    if not path.startswith("/"):
        path = posixpath.join("/" + posixpath.dirname(page), path)
    return posixpath.normpath(path).lstrip("/")


def lands_on_file(page, path):
    """Whether that link reaches a file, the way the live site would serve it:
    a directory means its index.html, and both hosts serve foo.html for /foo."""
    rel = site_path(page, path)
    if path.endswith("/") or not rel:
        return is_file_exact(posixpath.join(rel, "index.html"))
    return (is_file_exact(rel) or is_file_exact(rel + "/index.html")
            or (not posixpath.splitext(rel)[1] and is_file_exact(rel + ".html")))


# ---------------------------------------------------------------------------
# Outside the site: does anything answer?

def ascii_url(url):
    """urllib only takes ASCII: IDNA the host, percent-encode the rest."""
    parts = urllib.parse.urlsplit(url)
    netloc = parts.netloc
    if not netloc.isascii():
        netloc = netloc.encode("idna").decode("ascii")
    safe = "/%:@!$&'()*+,;=~"
    return urllib.parse.urlunsplit((parts.scheme, netloc, urllib.parse.quote(parts.path, safe=safe),
                                    urllib.parse.quote(parts.query, safe=safe + "?"), ""))


def network_note(reason):
    if isinstance(reason, socket.gaierror):
        return "no such host" if reason.errno in NO_SUCH_HOST else "DNS lookup failed"
    if isinstance(reason, ssl.SSLCertVerificationError):
        return "bad certificate"
    if isinstance(reason, ssl.SSLError):
        return "TLS error"
    if isinstance(reason, TimeoutError):
        return "timed out"
    if isinstance(reason, ConnectionRefusedError):
        return "connection refused"
    if isinstance(reason, ConnectionResetError):
        return "connection reset"
    return str(reason) or reason.__class__.__name__


# status is None when nothing answered; wait is a 429's Retry-After.
Answer = collections.namedtuple("Answer", "status final note wait")


def probe(url):
    """A plain GET, closed as soon as the headers are in, so a linked 20 MB PDF
    costs one packet or so. HEAD would be lighter still, but enough servers
    answer HEAD wrongly (405, or 404 for a page that's there) to make it a
    false-alarm generator."""
    try:
        request = urllib.request.Request(ascii_url(url), headers=HEADERS)
    except (ValueError, UnicodeError):
        return Answer(None, None, "malformed URL", 0)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as resp:
            return Answer(resp.status, resp.geturl(), None, 0)
    except urllib.error.HTTPError as err:
        headers = err.headers or {}
        challenged = headers.get("cf-mitigated") == "challenge"
        return Answer(err.code, None, "bot check" if challenged else None, retry_after(headers))
    except urllib.error.URLError as err:
        return Answer(None, None, network_note(err.reason), 0)
    except (OSError, http.client.HTTPException, ValueError) as err:
        return Answer(None, None, network_note(err), 0)
    except Exception as err:            # one odd URL mustn't sink a ten-minute run
        return Answer(None, None, "%s: %s" % (err.__class__.__name__, err), 0)


def ask(url, calm):
    """probe(), politely. `calm` is shared by every lane on the URL's host and
    holds the time the host may next be asked anything: a 429 pushes it back
    by the Retry-After (a minute at most), for all of them."""
    for attempt in range(4):
        pause = calm[0] - time.monotonic()
        if pause > 0:
            time.sleep(pause)
        answer = probe(url)
        if answer.status == 429 and attempt < 3:
            calm[0] = max(calm[0], time.monotonic() + min(answer.wait, 60))
        elif answer.note in RETRY and attempt == 0:
            time.sleep(2)
        else:
            break
    return answer


def host_of(url):
    return (urllib.parse.urlsplit(url).hostname or "").lower()


def check_external(urls):
    by_host = collections.defaultdict(list)
    for url in urls:
        by_host[host_of(url)].append(url)
    # Each host gets PER_HOST lanes that work through its links one at a time,
    # so no host sees more than that many requests at once, and a slow or
    # throttling host ties up only its own lanes. Biggest hosts first: Wikipedia
    # alone is a fifth of the site's links, and its lanes set the run's length.
    lanes = []
    for host, group in sorted(by_host.items(), key=lambda item: -len(item[1])):
        calm = [0.0]
        lanes += [(group[i::PER_HOST], calm) for i in range(min(PER_HOST, len(group)))]

    results = {}
    done = itertools.count(1)

    def run(lane, calm):
        for url in lane:
            results[url] = ask(url, calm)
            progress("checking %d/%d" % (next(done), len(urls)))

    pool = concurrent.futures.ThreadPoolExecutor(WORKERS)
    try:
        for future in concurrent.futures.as_completed([pool.submit(run, *lane) for lane in lanes]):
            future.result()
    except KeyboardInterrupt:
        pool.shutdown(wait=False, cancel_futures=True)
        raise
    pool.shutdown()
    progress(None)
    return results


def lands_on_front_page(url, final):
    """A deep link that now redirects to the bare domain: the page is gone and
    the site is papering over it."""
    before, after = urllib.parse.urlsplit(url), urllib.parse.urlsplit(final or url)
    return (before.path.strip("/") not in ("", "index.html", "index.htm", "index.php")
            and not after.path.strip("/") and not after.query)


def verdict(url, answer):
    """('ok' | 'dead' | 'unsure', reason)."""
    status, final, note = answer.status, answer.final, answer.note
    if status is not None and 200 <= status < 300:
        if lands_on_front_page(url, final):
            return "unsure", "sent to the front page"
        return "ok", None
    if status in (404, 410):
        return "dead", str(status)
    if note == "no such host":
        return "dead", note
    if status is None:
        return "unsure", note
    if 300 <= status < 400:
        return "unsure", "redirect loop"
    return "unsure", "%d, %s" % (status, note) if note else str(status)


# ---------------------------------------------------------------------------
# The Wayback Machine

class WaybackError(Exception):
    pass


class TooBusy(WaybackError):
    pass


class Wayback:
    """The Internet Archive, one request at a time.

    Past roughly 15 requests a minute it answers 429, or simply stops
    accepting connections for a while (a lookup a second was refused after
    about two minutes). So each call waits out a gap since the last one; a 429
    means wait as long as it asks (a minute if it doesn't say); and three 429s
    in a row, or a refused connection, mean stop for this run -- pressing on
    only lengthens the block."""

    def __init__(self):
        self.last = 0.0

    def get(self, url, gap, timeout, read):
        for _ in range(3):
            pause = self.last + gap - time.monotonic()
            if pause > 0:
                time.sleep(pause)
            try:
                request = urllib.request.Request(url, headers=HEADERS)
                with urllib.request.urlopen(request, timeout=timeout) as resp:
                    return resp.status, resp.geturl(), resp.headers, resp.read() if read else b""
            except urllib.error.HTTPError as err:
                if err.code != 429:
                    return err.code, None, err.headers, b""
                wait = retry_after(err.headers)
                progress("Wayback Machine asked us to slow down; waiting %ds" % wait)
                time.sleep(wait)
            except (urllib.error.URLError, OSError, http.client.HTTPException) as err:
                note = network_note(getattr(err, "reason", err))
                raise (TooBusy if note == "connection refused" else WaybackError)(note)
            finally:
                self.last = time.monotonic()
        raise TooBusy("still answering 429")

    def newest_copy(self, url, statuses="200"):
        """The newest capture whose status matches `statuses` (a regex), or None.

        A dead link wants a 200 to swap in. Asking whether a link has been
        captured at all wants redirects too: youtu.be/x and other short links
        are only ever recorded as a 30x, so a 200-only lookup would never find
        their copy and --save would capture them again on every run."""
        query = urllib.parse.urlencode({"url": url, "output": "json", "fl": "timestamp,original",
                                        "filter": "statuscode:" + statuses, "limit": "-1"})
        status, _, _, body = self.get(CDX + query, LOOKUP_GAP, 60, read=True)
        if status != 200:
            raise WaybackError("lookup answered %s" % status)
        try:
            rows = json.loads(body or b"[]")
        except ValueError:
            raise WaybackError("lookup answered something that isn't JSON")
        if len(rows) < 2:                       # rows[0] is the header
            return None
        timestamp, original = rows[-1]
        return "https://web.archive.org/web/%s/%s" % (timestamp, original)

    def save(self, url):
        """Capture `url` now; returns the snapshot's URL. Can take a minute."""
        status, final, headers, _ = self.get(SAVE + ascii_url(url), SAVE_GAP, 180, read=False)
        location = (headers or {}).get("Content-Location") or ""
        for candidate in (final or "", urllib.parse.urljoin("https://web.archive.org", location)):
            if re.search(r"/web/\d{14}/", candidate):
                return candidate
        raise WaybackError("capture answered %s" % status)


def retry_after(headers):
    try:
        return min(600, max(5, int((headers or {}).get("Retry-After", ""))))
    except ValueError:
        return 60


# ---------------------------------------------------------------------------

def progress(text):
    if sys.stderr.isatty():
        width = shutil.get_terminal_size().columns - 1
        sys.stderr.write("\r\033[K" + (text or "")[:width])
        sys.stderr.flush()


def plural(n, word):
    return "%d %s%s" % (n, word, "" if n == 1 else "s")


def print_entry(url, reason, places, extra=None):
    print("\n%s  [%s]" % (url, reason))
    for where in places:
        print("  %s" % where)
    if extra:
        print("  %s" % extra)


def save_all(urls, wayback):
    minutes = len(urls) * LOOKUP_GAP / 60
    print("\nSaving to the Wayback Machine: %s to look up (at least %d min), each one "
          "without a copy then captured" % (plural(len(urls), "link"), max(1, round(minutes))))
    saved = had = failed = 0
    for done, url in enumerate(urls, 1):
        progress("looking up %d/%d" % (done, len(urls)))
        try:
            if wayback.newest_copy(url, statuses="[23].."):
                had += 1
                continue
            progress("capturing %s" % url)
            copy = wayback.save(url)
            progress(None)
            print("  saved   %s\n          %s" % (url, copy))
            saved += 1
        except TooBusy:
            progress(None)
            print("  stopped: the Wayback Machine keeps refusing requests. %d links not "
                  "done; run again later." % (len(urls) - done + 1))
            break
        except WaybackError as err:
            progress(None)
            print("  failed  %s  (%s)" % (url, err))
            failed += 1
    progress(None)
    print("saved %d, %d already had a copy, %d failed" % (saved, had, failed))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("files", nargs="*", help="pages to check (default: every published page)")
    parser.add_argument("--drafts", action="store_true", help="include draft pages")
    parser.add_argument("--save", action="store_true",
                        help="ask the Wayback Machine to capture live links it has no copy of")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="list every couldn't-tell link instead of folding busy hosts")
    args = parser.parse_args()

    targets = []
    for name in args.files:
        rel = os.path.relpath(os.path.abspath(name), ROOT)
        if rel.startswith("..") or not os.path.isfile(os.path.join(ROOT, rel)):
            parser.error("not a page in the site: %s" % name)
        targets.append(rel.replace(os.sep, "/"))
    targets = targets or pages(args.drafts)

    external = collections.defaultdict(list)    # url -> ["page:line", ...]
    missing = []                                 # ("page:line", href as written)
    internal = archived = 0
    for page in targets:
        with open(os.path.join(ROOT, page), encoding="utf-8", errors="replace") as fh:
            refs = Refs()
            refs.feed(fh.read())
            refs.close()
        for line, tag, value in refs.refs:
            where = "%s:%d" % (page, line)
            if value.lower().startswith(NOT_LINKS):
                continue
            try:
                parts = urllib.parse.urlsplit("https:" + value if value.startswith("//") else value)
            except ValueError:
                missing.append((where, value + "  (malformed)"))
                continue
            scheme, host = parts.scheme.lower(), (parts.hostname or "").lower()
            if scheme == "file":
                missing.append((where, value + "  (a file: URL only works on your machine)"))
            elif scheme in ("http", "https") and host not in OWN_HOSTS:
                if tag != "a":
                    continue
                if host in ARCHIVE_HOSTS:
                    archived += 1
                else:
                    external[urllib.parse.urlunsplit(parts._replace(fragment=""))].append(where)
            elif scheme in ("http", "https") or (not scheme and parts.path):
                internal += 1
                if not lands_on_file(page, parts.path or "/"):
                    rel = site_path(page, parts.path or "/")
                    draft = posixpath.join(posixpath.dirname(rel), "draft" + posixpath.basename(rel))
                    note = "  (only a draft exists: %s)" % draft if is_file_exact(draft) else ""
                    missing.append((where, value + note))

    results = check_external(sorted(external))
    verdicts = {url: verdict(url, results[url]) for url in external}
    if len(external) >= 10 and not any(v == "ok" for v, _ in verdicts.values()):
        sys.exit("no external link answered at all -- are you offline?")
    dead = sorted(u for u, (v, _) in verdicts.items() if v == "dead")
    unsure = sorted(u for u, (v, _) in verdicts.items() if v == "unsure")

    wayback = Wayback()
    copies = {}
    for done, url in enumerate(dead, 1):
        progress("looking for Wayback copies %d/%d" % (done, len(dead)))
        try:
            copies[url] = wayback.newest_copy(url) or "no Wayback copy"
        except TooBusy:
            break
        except WaybackError as err:
            copies[url] = "Wayback lookup failed (%s)" % err
    progress(None)

    print("Checked %s on %s: %d ok, %d dead, %d couldn't tell."
          % (plural(len(external), "external link"), plural(len(targets), "page"),
             len(external) - len(dead) - len(unsure), len(dead), len(unsure)))
    if archived:
        print("Skipped %s into web.archive.org / archive.today." % plural(archived, "link"))
    print("Checked %s inside the site: %d missing." % (plural(internal, "link"), len(missing)))

    if dead:
        print("\n\nDEAD (%d)" % len(dead))
        for url in dead:
            print_entry(url, verdicts[url][1], external[url],
                        copies.get(url, "not looked up: the Wayback Machine stopped answering"))

    if unsure:
        print("\n\nCOULDN'T TELL (%d) -- usually a site that turns scripts away; "
              "open these in a browser" % len(unsure))
        by_host = collections.defaultdict(list)
        for url in unsure:
            by_host[host_of(url)].append(url)
        folded = [h for h in by_host if len(by_host[h]) > 3 and not args.verbose]
        if folded:
            print()
        for host in sorted(folded, key=lambda h: -len(by_host[h])):
            reasons = collections.Counter(verdicts[u][1] for u in by_host[host])
            print("%s: %s (%s)" % (host, plural(len(by_host[host]), "link"),
                                   ", ".join("%s x%d" % rc for rc in reasons.most_common())))
        for url in unsure:
            if host_of(url) not in folded:
                print_entry(url, verdicts[url][1], external[url])
        if folded:
            print("\n(-v lists the folded hosts' links one by one)")

    if missing:
        print("\n\nMISSING (%d)\n" % len(missing))
        for where, value in missing:
            print("%s  %s" % (where, value))

    if args.save:
        live = [u for u, (v, _) in verdicts.items() if host_of(u) not in NOT_SAVED
                and (v == "ok" or results[u].status in (403, 429))]
        save_all(sorted(live), wayback)

    return 1 if dead or missing else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        # Worker threads may still be waiting out a timeout; don't wait for them.
        progress(None)
        sys.stdout.flush()
        sys.stderr.write("interrupted\n")
        os._exit(130)
