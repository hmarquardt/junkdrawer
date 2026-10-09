#!/usr/bin/env python3
"""Generate JPL Horizons reference fixtures for Overhead's celestial tests.

The fixtures are committed so the browser-side astronomy layer can be validated
offline against an authoritative DE441-based reference. Re-run this script to
refresh them; every sample records the exact Horizons query string, the HTTP
status, the SHA-256 of the raw response body and the retrieval timestamp, so a
reviewer can reproduce any single number.

Usage:
    python3 tools/overhead_horizons_fixtures.py [--out tests/fixtures/overhead/horizons-planets.json]
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request

API = "https://ssd.jpl.nasa.gov/api/horizons.api"

# Horizons target codes (see https://ssd.jpl.nasa.gov/horizons/):
#   10 Sun, 301 Moon, 199 Mercury, 299 Venus, 499 Mars, 599 Jupiter,
#   699 Saturn, 799 Uranus, 899 Neptune
BODIES = [("Sun", "10"), ("Moon", "301"), ("Mercury", "199"), ("Venus", "299"),
          ("Mars", "499"), ("Jupiter", "599"), ("Saturn", "699"),
          ("Uranus", "799"), ("Neptune", "899")]

# Sites: (name, lon_deg_east, lat_deg_north, alt_km). Geocentric rows use CENTER='500@399'.
SITES = [("Princeton, Indiana", -87.5675, 38.3553, 0.0),
         ("Cape Town", 18.4241, -33.9249, 0.0),
         ("Longyearbyen", 15.65, 78.22, 0.0)]

# Sample instants (UTC): spans seasons, an opposition and a year boundary.
DATES = [("2026-10-08T00:00", "2026-10-08T06:00"), ("2026-11-15T02:00", "2026-11-15T08:00"),
         ("2026-12-31T22:00", "2027-01-01T04:00"), ("2027-01-20T03:00", "2027-01-20T09:00")]

# Bodies sampled topocentrically (Moon first: largest parallax).
TOPO_BODIES = ["Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]

MONTHS = {m: i + 1 for i, m in enumerate(
    "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def horizons(params: dict, retries: int = 3) -> tuple[str, str]:
    """GET the Horizons API. Returns (body, full_url). Retries transient failures."""
    query = urllib.parse.urlencode(params, quote_via=urllib.parse.quote)
    url = API + "?" + query
    delay = 2.0
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=90) as response:
                body = response.read().decode("utf-8", "replace")
            if "API VERSION" not in body:
                raise RuntimeError("unexpected Horizons payload: " + body[:200])
            return body, url
        except Exception as exc:  # noqa: BLE001 - retried below, re-raised at the end
            if attempt == retries - 1:
                raise
            print(f"    retry after {exc}", file=sys.stderr)
            time.sleep(delay)
            delay *= 2
    raise AssertionError("unreachable")


def rows(body: str) -> list[list[float]]:
    """Extract the numeric CSV rows between $$SOE and $$EOE as [iso_utc, numbers...]."""
    if "$$SOE" not in body or "$$EOE" not in body:
        raise RuntimeError("Horizons returned no ephemeris block: " + body[:400])
    block = body.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    out = []
    for line in block.strip().splitlines():
        fields = [f.strip() for f in line.split(",")]
        # fields[0] is the date, fields[1:3] are blank flag columns.
        parts = " ".join(fields[0].split()[:2]).split()
        yyyy, mon, dd = parts[0].split("-")
        hh, mm, ss = (parts[1].split(":") + ["00", "00"])[:3]
        stamp = dt.datetime(int(yyyy), MONTHS[mon[:3]], int(dd), int(hh), int(mm),
                            int(float(ss)), tzinfo=dt.timezone.utc)
        numbers = [float(f) for f in fields[3:] if f]
        out.append([stamp.isoformat().replace("+00:00", "Z")] + numbers)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="tests/fixtures/overhead/horizons-planets.json")
    parser.add_argument("--sleep", type=float, default=1.5)
    args = parser.parse_args()

    queries: list[dict] = []
    samples: list[dict] = []
    by_id = dict(BODIES)
    total = len(BODIES) + len(SITES) * len(TOPO_BODIES) * 2
    done = 0

    def record(kind: str, name: str, body_id: str, site, params: dict, spec: dict) -> None:
        nonlocal done
        raw, url = horizons(params)
        digest = hashlib.sha256(raw.encode()).hexdigest()
        query_id = f"{kind}:{name}" + (f":{site[0]}" if site else "")
        queries.append({"id": query_id, "url": url, "retrieved_at": now_iso(),
                        "sha256": digest, "http_status": 200, "body_chars": len(raw)})
        parsed = rows(raw)
        for row in parsed:
            samples.append({"query_id": query_id, "kind": kind, "body": name,
                            "horizons_id": body_id, "site": site[0] if site else "geocentric",
                            "site_lon": site[1] if site else None,
                            "site_lat": site[2] if site else None,
                            "site_alt_km": site[3] if site else None,
                            "refracted": spec["refracted"], "utc": row[0], "frame": spec["frame"],
                            **dict(zip(spec["columns"], row[1:]))})
        done += 1
        print(f"  [{done}/{total}] {query_id}: {len(parsed)} rows")

    # --- Geocentric astrometric RA/Dec plus heliocentric and observer ranges.
    for name, body_id in BODIES:
        record("geocentric", name, body_id, None, {
            "format": "text", "COMMAND": f"'{body_id}'", "OBJ_DATA": "'NO'",
            "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'OBSERVER'", "CENTER": "'500@399'",
            "START_TIME": f"'{DATES[0][0]}'", "STOP_TIME": f"'{DATES[-1][0]}'",
            "STEP_SIZE": "'1 d'", "QUANTITIES": "'1,19,20'", "ANG_FORMAT": "'DEG'",
            "TIME_DIGITS": "'MINUTES'", "EXTRA_PREC": "'YES'", "CSV_FORMAT": "'YES'",
        }, {"columns": ["ra_deg", "dec_deg", "r_au", "r_dot_km_s", "delta_au", "delta_dot_km_s"],
            "refracted": False,
            "frame": "geocentric astrometric ICRF/J2000 RA/Dec; geometric (light-time corrected, no aberration)"})
        time.sleep(args.sleep)

    # --- Topocentric apparent AZ/EL, airless and refracted, for three sites.
    for site in SITES:
        site_coord = f"{site[1]},{site[2]},{site[3]}"
        for body_name in TOPO_BODIES:
            for refracted in (False, True):
                record("topocentric-refracted" if refracted else "topocentric-airless",
                       body_name, by_id[body_name], site, {
                           "format": "text", "COMMAND": f"'{by_id[body_name]}'", "OBJ_DATA": "'NO'",
                           "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'OBSERVER'",
                           "CENTER": "'coord@399'", "COORD_TYPE": "'GEODETIC'",
                           "SITE_COORD": f"'{site_coord}'",
                           "START_TIME": f"'{DATES[0][0]}'", "STOP_TIME": f"'{DATES[-1][0]}'",
                           "STEP_SIZE": "'1 d'", "QUANTITIES": "'1,4'", "ANG_FORMAT": "'DEG'",
                           "TIME_DIGITS": "'MINUTES'", "EXTRA_PREC": "'YES'", "CSV_FORMAT": "'YES'",
                           "APPARENT": "'REFRACTED'" if refracted else "'AIRLESS'",
                       }, {"columns": ["ra_deg", "dec_deg", "apparent_az_deg", "apparent_alt_deg"],
                           "refracted": refracted,
                           "frame": f"topocentric apparent AZ/EL at {site_coord} (lon,lat,km) GEODETIC"})
                time.sleep(args.sleep)

    fixture = {
        "schema": "junkdrawer.overhead.horizons-fixtures/1",
        "generated_by": "tools/overhead_horizons_fixtures.py",
        "generated_at": now_iso(),
        "reference": "NASA/JPL Horizons API (DE441) - https://ssd.jpl.nasa.gov/horizons/",
        "notes": [
            "RA/Dec are astrometric ICRF/J2000 degrees (light-time corrected, no aberration).",
            "AZ/EL are apparent topocentric degrees; 'refracted' marks the standard atmospheric model.",
            "Geocentric rows use CENTER='500@399'; topocentric rows use CENTER='coord@399'.",
            "Sun rows give the Sun's geocentric direction, not an observer's zenith angle.",
        ],
        "queries": queries,
        "samples": samples,
    }
    tmp = args.out + ".tmp"
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(fixture, handle, indent=1)
        handle.write("\n")
    os.replace(tmp, args.out)
    digest = hashlib.sha256(open(args.out, "rb").read()).hexdigest()
    print(f"wrote {args.out}: {len(samples)} samples from {len(queries)} queries, sha256={digest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
