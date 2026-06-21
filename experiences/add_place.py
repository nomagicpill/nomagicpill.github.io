#!/usr/bin/env python3
"""Add a trip to the travel map (experiences/map.html).

It figures out the boring parts for you:
  • geocodes the place name -> latitude/longitude (OpenStreetMap Nominatim)
  • grabs a representative image from the post (first <img> in the page)
  • writes a tidy entry into the PLACES list, merging into an existing place
    marker if one with the same name already exists.

Examples
--------
  # simplest: name + year (page defaults to a slug, image auto-detected)
  python3 experiences/add_place.py --name "Tokyo" --year 2026

  # spell things out
  python3 experiences/add_place.py --name "Kyoto" --title "Kyoto" \\
      --page kyoto.html --year 2026 --img media/kyoto/temple.jpg

  # skip the network and give coordinates yourself
  python3 experiences/add_place.py --name "Base Camp" --year 2026 \\
      --lat 28.00 --lon 86.85 --no-geocode

  # see what it would write without touching the file
  python3 experiences/add_place.py --name "Tokyo" --year 2026 --dry-run

Only the Python standard library is used.
"""

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MAP_FILE = os.path.join(HERE, "map.html")
START = "// ====================== PLACES:START"
END = "// ====================== PLACES:END"


def slugify(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def geocode(name):
    """Return (lat, lon) rounded to 2 decimals, or None on failure."""
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": name, "format": "json", "limit": 1}
    )
    req = urllib.request.Request(url, headers={"User-Agent": "nomagicpill-travelmap/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
    except Exception as exc:  # network down, rate limited, etc.
        print(f"  ! geocoding failed ({exc}). Pass --lat/--lon manually.", file=sys.stderr)
        return None
    if not data:
        print(f"  ! no geocoding match for {name!r}. Pass --lat/--lon manually.", file=sys.stderr)
        return None
    return round(float(data[0]["lat"]), 2), round(float(data[0]["lon"]), 2)


def detect_image(page):
    """First media/* image referenced in experiences/<page>, or None."""
    path = os.path.join(HERE, page)
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8", errors="ignore") as fh:
        text = fh.read()
    m = re.search(r'src="(media/[^"]+\.(?:jpg|jpeg|png|webp))"', text, re.IGNORECASE)
    return m.group(1) if m else None


def split_block(html):
    """Return (prefix, inner, suffix) where inner is the text inside the data backticks."""
    if START not in html or END not in html:
        sys.exit("Could not find the PLACES:START / PLACES:END markers in map.html.")
    tick = html.index("`", html.index(START))
    close = html.index("`", tick + 1)
    return html[: tick + 1], html[tick + 1 : close], html[close:]


def find_place_line(lines, name):
    """Index of the place header line matching name (case-insensitive), or -1."""
    want = name.strip().lower()
    for i, line in enumerate(lines):
        s = line.strip()
        if s and not s.startswith("-") and s.split("|")[0].strip().lower() == want:
            return i
    return -1


def main():
    ap = argparse.ArgumentParser(
        description="Add a trip to experiences/map.html.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--name", required=True, help="Place / marker name, e.g. \"Tokyo\".")
    ap.add_argument("--year", required=True, type=int, help="Year of the trip.")
    ap.add_argument("--title", help="Link title in the popup (default: --name).")
    ap.add_argument("--page", help="Post filename in experiences/ (default: slug of title).")
    ap.add_argument("--img", help="Image path relative to experiences/ (default: auto-detect).")
    ap.add_argument("--lat", type=float, help="Latitude (default: geocode --name).")
    ap.add_argument("--lon", type=float, help="Longitude (default: geocode --name).")
    ap.add_argument("--no-geocode", action="store_true", help="Don't hit the network; requires --lat/--lon.")
    ap.add_argument("--dry-run", action="store_true", help="Print the new entry without writing.")
    args = ap.parse_args()

    title = args.title or args.name
    page = args.page or (slugify(title) + ".html")

    # coordinates
    if args.lat is not None and args.lon is not None:
        lat, lon = round(args.lat, 2), round(args.lon, 2)
    elif args.no_geocode:
        sys.exit("--no-geocode requires both --lat and --lon.")
    else:
        print(f"  geocoding {args.name!r} ...")
        coords = geocode(args.name)
        if not coords:
            sys.exit(1)
        lat, lon = coords
        print(f"  -> {lat}, {lon}")

    # image
    img = args.img
    if img is None:
        img = detect_image(page)
        if img:
            print(f"  found image in {page}: {img}")
        else:
            print(f"  no image found in {page} (popup will show title + year only)")

    trip = f"- {title} | {page} | {args.year}" + (f" | {img}" if img else "")

    html = open(MAP_FILE, encoding="utf-8").read()
    prefix, inner, suffix = split_block(html)
    lines = inner.split("\n")

    idx = find_place_line(lines, args.name)
    if idx >= 0:
        # merge into the existing marker; newest trips go first
        if any(ln.strip() == trip for ln in lines):
            sys.exit("That exact trip is already on the map — nothing to do.")
        lines.insert(idx + 1, trip)
        where = f"added under existing place \"{args.name}\""
    else:
        # append a new place block at the end
        block = f"\n{args.name} | {lat}, {lon}\n{trip}"
        text = "\n".join(lines).rstrip("\n") + "\n" + block + "\n"
        lines = text.split("\n")
        where = f"added new place \"{args.name}\""

    new_html = prefix + "\n".join(lines) + suffix

    print("\n  " + where + ":")
    print("    " + args.name + " | " + str(lat) + ", " + str(lon))
    print("    " + trip)

    if args.dry_run:
        print("\n  (dry run — map.html not modified)")
        return

    with open(MAP_FILE, "w", encoding="utf-8") as fh:
        fh.write(new_html)
    print(f"\n  Wrote {os.path.relpath(MAP_FILE)}. Open it to confirm the dot looks right.")


if __name__ == "__main__":
    main()
