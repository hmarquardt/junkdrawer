#!/usr/bin/env python3
"""Build data/overhead/meteor-showers.json from the IMO Meteor Shower Calendar.

Two real retrievals feed this pipeline; both are recorded with URL, timestamp and SHA-256:

  * IMO Meteor Shower Calendar (PDF), Table 5 "Working List of Visual Meteor Showers".
    imo.net currently answers every path with an HTTP 200 site-restoration shell
    (text/html), so the PDF bytes are read from a pinned Internet Archive snapshot.  A
    snapshot is immutable, which is what makes this build reproducible; the canonical URL
    is still recorded, and the rejected response is noted.  IMO publishes no machine API
    and no HTML table, so the PDF is the only documented source.
  * IAU Meteor Data Center "streamfulldata.txt" - the machine-readable shower list.  It is
    used only as an independent cross-check on the parsed radiants and as the source of
    radiant drift (dRa/dDe).

Nothing is guessed: rows that are not individual showers (the Antihelion Source has no IAU
number) are skipped and reported in `notes`, and a shower with no comparable MDC parameter
set keeps null drift values instead of an invented one.  The build refuses to publish unless
every value passes the domain checks and every MDC-matched radiant agrees to within
MAX_RADIANT_OFFSET_DEG, so a parsing bug fails the build instead of shipping bad data.

    python3 tools/overhead_meteors_build.py                 # download, parse, write artifact
    python3 tools/overhead_meteors_build.py --check         # validate the committed artifact
    python3 tools/overhead_meteors_build.py --print-row-count
"""
import argparse
import calendar
import hashlib
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import requests
from pypdf import PdfReader

SCHEMA = 'junkdrawer.overhead.meteors/1'
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / 'data/overhead/meteor-showers.json'
DEFAULT_FIXTURE_DIR = ROOT / 'tests/fixtures/overhead'

# The canonical IMO path pattern.  It is recorded in the artifact even when the bytes come
# from the archive, so a reader can see both what was asked for and what was read.
IMO_PDF_URL = 'https://www.imo.net/files/meteor-shower/cal{year}.pdf'
IMO_SITE_NOTE = ('www.imo.net served a site-restoration shell (HTTP 200, text/html) instead of the PDF; '
                 'bytes were read from the pinned Internet Archive snapshot')

# Per-edition metadata.  Only values that were read out of the PDF (page footers, title page and
# Table 5 caption) or that are part of the pinned snapshot URL appear here; a new year must be
# added by hand after verifying its snapshot, never inferred.
CALENDARS = {
    2026: {
        'name': 'IMO Meteor Shower Calendar 2026',
        'editor': 'Jürgen Rendtel',
        'publication': 'IMO INFO(3-25)',
        'correct_as_of': 'June 2025',
        'table_title': 'Table 5: Working List of Visual Meteor Showers',
        'snapshot_url': ('https://web.archive.org/web/20250712192730id_/'
                         'https://www.imo.net/files/meteor-shower/cal2026.pdf'),
        'table_page_hint': 24,  # 0-based pypdf page index of Table 5 (page 25 in the footer)
    },
}

MDC_NAME = 'IAU Meteor Data Center - List of all meteor showers'
MDC_URL = 'https://www.ta3.sk/IAUC22DB/MDC2007/Etc/streamfulldata.txt'
MDC_UPDATED = '2022-02-28'  # stated by the file's own header ("Last update: Feb 28 ... 2022")
MDC_DRIFT_SOURCE = 'IAU MDC streamfulldata.txt'

TABLE5_PAGE_MARKER = 'Working List of Visual Meteor Showers'

# Publication guards.  Every one of these is a documented invariant of the dataset, not a
# best-effort heuristic: a violation means a parsing or source change and must not ship.
MIN_SHOWERS = 30
MIN_MATCHED = 25
MAX_RADIANT_OFFSET_DEG = 5.0
ZHR_VAR_NOTE = 'IMO publishes no single ZHR value (variable)'
MONTHS = {name: number for number, name in enumerate(
    ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'), start=1)}


class BuildError(RuntimeError):
    """Anything that must stop the build rather than publish an unverified artifact."""


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def http_get(url: str) -> tuple[bytes, str, str]:
    """Retrieve `url`; return (bytes, content-type, final URL actually served)."""
    response = requests.get(url, timeout=120, allow_redirects=True, headers={
        'User-Agent': 'junkdrawer-overhead-meteors-build/1.0 (+https://github.com/hmarquardt/junkdrawer)'})
    if response.status_code != 200:
        raise BuildError(f'HTTP {response.status_code} for {url}')
    return response.content, response.headers.get('Content-Type', ''), response.url


def is_pdf(data: bytes, content_type: str) -> bool:
    return data[:5] == b'%PDF-' or 'pdf' in content_type.lower()


def resolve_pdf(year: int, pdf_path: Path | None) -> dict:
    """Get the calendar PDF plus full provenance; never silently substitutes a source."""
    canonical = IMO_PDF_URL.format(year=year)
    notes: list[str] = []
    if pdf_path is not None:
        data = pdf_path.read_bytes()
        if not is_pdf(data, ''):
            raise BuildError(f'{pdf_path} is not a PDF')
        retrieved_url = pdf_path.resolve().as_uri()
        notes.append(f'PDF read from the local file given with --pdf ({pdf_path}); '
                     'retrieved_url is that file, not a network fetch')
    else:
        data, content_type, final_url = http_get(canonical)
        retrieved_url = final_url
        if not is_pdf(data, content_type):
            meta = CALENDARS.get(year, {})
            snapshot = meta.get('snapshot_url')
            notes.append(f'{IMO_SITE_NOTE}: {canonical} answered {content_type or "unknown type"} '
                         f'with {len(data)} bytes at {utc_now()}')
            if not snapshot:
                raise BuildError(f'{canonical} did not serve a PDF and no pinned snapshot is '
                                 f'configured for {year}')
            data, content_type, final_url = http_get(snapshot)
            if not is_pdf(data, content_type):
                raise BuildError(f'snapshot {snapshot} did not serve a PDF either')
            retrieved_url = final_url
            notes.append(f'read the pinned Internet Archive snapshot instead: {retrieved_url}')
        if retrieved_url != canonical:
            notes.append(f'URL actually read ({retrieved_url}) differs from the canonical URL ({canonical})')
    reader = PdfReader(BytesIO(data))
    if len(reader.pages) < 2:
        raise BuildError('the retrieved PDF has no usable pages')
    return {'bytes': data, 'sha256': sha256(data), 'canonical_url': canonical,
            'retrieved_url': retrieved_url, 'retrieved_at': utc_now(), 'notes': notes,
            'page_count': len(reader.pages)}


def table5_page(pdf_bytes: bytes, page_hint: int | None) -> tuple[int, str]:
    """Return (0-based page index, raw page text) for Table 5, verified by its caption."""
    reader = PdfReader(BytesIO(pdf_bytes))
    order = list(range(len(reader.pages)))
    if page_hint is not None and 0 <= page_hint < len(reader.pages):
        order.remove(page_hint)
        order.insert(0, page_hint)
    for index in order:
        text = reader.pages[index].extract_text() or ''
        if TABLE5_PAGE_MARKER in text:
            return index, text
    raise BuildError(f'no page contains "{TABLE5_PAGE_MARKER}"')


# --- text normalisation -------------------------------------------------------------------
# pypdf extracts the degree glyph as U+25E6 WHITE BULLET (a property of the calendar's embedded
# fonts), sometimes *inside* the decimals ("283 .°15" for 283.15), the date dashes as en dashes
# U+2013 and the declination sign as U+2212 MINUS SIGN.  Normalising these once, before parsing,
# keeps the row regex about structure only.
_ZERO_WIDTH = dict.fromkeys(map(ord, '\u200b\u200c\u200d\ufeff\u2060'), None)
_CHAR_FIXES = (('\u2013', '-'), ('\u2014', '-'), ('\u2212', '-'), ('\u25e6', '\u00b0'), ('\u00a0', ' '))
# "283 .°15" -> "283.15" and "230 °" -> "230".  Applied to numeric fields only, so the text kept
# in the fixture shows exactly the notation the PDF produced.
_DEG_DECIMAL = re.compile(r'(?<=\d)\s*\.°\s*(\d+)')
_DEG_INT = re.compile(r'(?<=\d)\s*°')


def normalise_text(raw: str) -> list[str]:
    """Glyph/dash/whitespace normalisation; one table line per element, empty lines dropped."""
    text = raw.translate(_ZERO_WIDTH)
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    for source, target in _CHAR_FIXES:
        text = text.replace(source, target)
    return [line for line in (re.sub(r'[ \t]+', ' ', line).strip() for line in text.split('\n')) if line]


def resolve_degrees(line: str) -> str:
    """Turn the calendar's degree notation into plain numbers ("+58°" -> "+58")."""
    return _DEG_INT.sub('', _DEG_DECIMAL.sub(r'.\1', line))


# --- Table 5 rows -------------------------------------------------------------------------
# One Table 5 row, in the normalised form produced by normalise_text() then resolve_degrees():
#
#   Perseids (007 PER) Jul 17-Aug 24 Aug 13 140.0 48 +58 59 2.2 100
#   σ -Hydrids (016 HYD) Dec 03-Dec 20 Dec 09 257 125 +02 58 3.0 7
#   Puppid-Velids (301 PUP) Dec 01-Dec 15 (Dec 07) (255) 123 -45 44 2.9 10
#
# What drives the pattern: the IAU number is always three digits with a three-letter code
# ("(007 PER)"); one row ("Dayt. Sextantids(221 DSX)") has no space before its parentheses, so
# the name is non-greedy and the gap optional; the Puppid-Velids peak date and solar longitude
# are parenthesised and the parentheses are captured so the flag can be set; a ZHR is either a
# count or the literal "Var".  The conditional groups (?(name)yes|no) force an opening
# parenthesis to be closed again, so a malformed row cannot parse as a valid one.
ROW_RE = re.compile(
    r'^(?P<name>.+?)\s*\((?P<num>\d{3})\s+(?P<code>[A-Z]{3})\)\s+'
    r'(?P<start_mon>[A-Z][a-z]{2}) (?P<start_day>\d{1,2})-(?P<end_mon>[A-Z][a-z]{2}) (?P<end_day>\d{1,2})\s+'
    r'(?P<peak_open>\()?(?P<peak_mon>[A-Z][a-z]{2}) (?P<peak_day>\d{1,2})(?(peak_open)\))\s+'
    r'(?P<lam_open>\()?(?P<lam>\d{1,3}(?:\.\d+)?)(?(lam_open)\))\s+'
    r'(?P<ra_open>\()?(?P<ra>\d{1,3})(?(ra_open)\))\s+'
    r'(?P<dec>[+-]\d{1,2})\s+'
    r'(?P<vel>\d{1,2})\s+(?P<pop>\d\.\d)\s+(?P<zhr>\d{1,3}|Var)$')
# A table row that is not an individual shower: it carries a code but no IAU number, e.g.
# "Antihelion Source (ANT) Dec 10-Sep 20 ..." - a radiant region, not a shower.
NON_SHOWER_RE = re.compile(r'^.+?\s*\((?P<code>[A-Z]{3})\)')
# An IAU number is exactly three digits; this separates an unparsed *row* (a bug worth failing
# on) from page furniture such as the caption, the column headers or a wrapped sentence.
IAU_NUMBER_MARKER_RE = re.compile(r'(?<!\d)\d{3}(?!\d)')


def month_day(mon: str, day: int, year: int) -> str:
    """Validate a "Mon DD" pair against the calendar year and return "MM-DD"."""
    if mon not in MONTHS:
        raise BuildError(f'unknown month {mon!r}')
    number = MONTHS[mon]
    if not 1 <= day <= calendar.monthrange(year, number)[1]:
        raise BuildError(f'{mon} {day:02d} is not a real date')
    return f'{number:02d}-{day:02d}'


def parse_row(line: str, year: int) -> dict | None:
    """Parse one normalised table line into a shower record, or None if it is not a shower row."""
    match = ROW_RE.match(resolve_degrees(line))
    if match is None:
        return None
    field = match.groupdict()
    zhr = None if field['zhr'] == 'Var' else int(field['zhr'])
    return {
        'id': field['code'],
        'name': field['name'].strip(),
        'iau_number': int(field['num']),
        'iau_code': field['code'],
        'parenthesised_peak': bool(field['peak_open'] or field['lam_open']),
        'activity': {'start_md': month_day(field['start_mon'], int(field['start_day']), year),
                     'end_md': month_day(field['end_mon'], int(field['end_day']), year)},
        'peak': {'md': month_day(field['peak_mon'], int(field['peak_day']), year),
                 'solar_longitude_deg': round(float(field['lam']), 2)},
        # frame: Table 5 publishes no epoch for the working list, and the IMO/MDC values agree
        # to a fraction of a degree, so J2000 is the only defensible label (documented in notes).
        'radiant': {'ra_deg': float(field['ra']), 'dec_deg': float(field['dec']), 'frame': 'J2000',
                    'drift_ra_deg_per_day': None, 'drift_dec_deg_per_day': None, 'drift_source': None},
        'velocity_km_s': float(field['vel']),
        'population_index': float(field['pop']),
        'zhr': zhr,
        'zhr_note': ZHR_VAR_NOTE if zhr is None else None,
        'source_row': line,
    }


def parse_table5(lines: list[str], year: int) -> tuple[list[dict], list[str], list[str]]:
    """Split the normalised page text into (showers, skipped non-shower rows, page furniture).

    A line that carries an IAU number but does not parse is a parser bug (a dropped shower), so
    it raises instead of being quietly ignored; the remaining lines are caption, column headers
    and a wrapped sentence, and are reported in `notes` for transparency.
    """
    showers, skipped, furniture = [], [], []
    for line in lines:
        row = parse_row(line, year)
        if row is not None:
            showers.append(row)
        elif NON_SHOWER_RE.match(resolve_degrees(line)):
            skipped.append(line)
        elif IAU_NUMBER_MARKER_RE.search(line):
            raise BuildError(f'unparsed Table 5 row (carries an IAU number): {line!r}')
        else:
            furniture.append(line)
    return showers, skipped, furniture


def validate_showers(showers: list[dict]) -> None:
    """Enforce every documented domain; raise BuildError on the first violation."""
    if len(showers) < MIN_SHOWERS:
        raise BuildError(f'only {len(showers)} showers parsed, expected at least {MIN_SHOWERS}')
    seen = set()
    for shower in showers:
        code = shower['iau_code']
        if not isinstance(code, str) or not re.fullmatch(r'[A-Z]{3}', code):
            raise BuildError(f'{code!r} is not a three-letter IAU code')
        if code != shower['id']:
            raise BuildError(f'id {shower["id"]!r} does not match IAU code {code!r}')
        if code in seen:
            raise BuildError(f'duplicate IAU code {code}')
        seen.add(code)
        if shower['parenthesised_peak'] and '(' not in shower['source_row']:
            raise BuildError(f'{code}: parenthesised_peak set for an unparenthesised row')
        longitude = shower['peak']['solar_longitude_deg']
        if not isinstance(longitude, float) or not 0.0 <= longitude < 360.0:
            raise BuildError(f'{code}: solar longitude {longitude!r} outside [0,360)')
        radiant = shower['radiant']
        if not isinstance(radiant['ra_deg'], float) or not 0.0 <= radiant['ra_deg'] < 360.0:
            raise BuildError(f'{code}: RA {radiant["ra_deg"]!r} outside [0,360)')
        if not isinstance(radiant['dec_deg'], float) or not -90.0 <= radiant['dec_deg'] <= 90.0:
            raise BuildError(f'{code}: declination {radiant["dec_deg"]!r} outside [-90,90]')
        if not isinstance(shower['velocity_km_s'], float) or not 10.0 <= shower['velocity_km_s'] <= 80.0:
            raise BuildError(f'{code}: V-infinity {shower["velocity_km_s"]!r} outside [10,80] km/s')
        index = shower['population_index']
        if not isinstance(index, float) or not 1.5 <= index <= 3.5:
            raise BuildError(f'{code}: population index {index!r} outside [1.5,3.5]')
        zhr = shower['zhr']
        if zhr is None:
            if shower['zhr_note'] != ZHR_VAR_NOTE:
                raise BuildError(f'{code}: ZHR is null without the documented "Var" note')
        elif isinstance(zhr, bool) or not isinstance(zhr, int) or not 1 <= zhr <= 200:
            raise BuildError(f'{code}: ZHR {zhr!r} is neither an integer in [1,200] nor "Var"')
        elif shower['zhr_note'] is not None:
            raise BuildError(f'{code}: numeric ZHR must not carry a zhr_note')


# --- IAU MDC cross-check --------------------------------------------------------------------
# streamfulldata.txt is a pipe-delimited file of quoted fields documented in its own header
# (":LP", ":IAUNo", ":AdNo", ":Code", ..., ":dRa", ":dDe", ...).  Comment/header lines start
# with ":" or "+"; data lines start with '"'.
_MDC_UPDATED_RE = re.compile(r'Last update:\s*(?P<date>[A-Z][a-z]{2} \d{1,2}),\s*[\d:]+ UTC,\s*(?P<year>\d{4})')
_MDC_MIN_ROWS = 500  # the file has ~1500; anything smaller means the download is not the list


def _number(text: str) -> float | None:
    try:
        return float(text)
    except ValueError:
        return None


def load_mdc(data: bytes) -> dict:
    """Index the MDC list by IAU number, verifying the file's own stated update date."""
    text = data.decode('utf-8', 'replace')
    stated = _MDC_UPDATED_RE.search(text)
    if stated is None:
        raise BuildError('the MDC file does not carry its documented "Last update" header')
    stamped = datetime.strptime(f'{stated["date"]} {stated["year"]}', '%b %d %Y').strftime('%Y-%m-%d')
    if stamped != MDC_UPDATED:
        raise BuildError(f'MDC file states {stamped}, dataset metadata says {MDC_UPDATED}')
    index: dict[int, list[dict]] = {}
    for line in text.splitlines():
        if not line.startswith('"'):
            continue
        fields = [chunk.strip('"').strip() for chunk in line.split('|')]
        if len(fields) < 13:
            raise BuildError(f'MDC data row has {len(fields)} fields, expected at least 13: {line[:80]!r}')
        entry = {'iau_no': int(fields[1]), 'adno': fields[2], 'code': fields[3], 'name': fields[4],
                 'activity': fields[5], 'status': fields[6], 'ra': _number(fields[8]),
                 'dec': _number(fields[9]), 'dra': _number(fields[10]), 'dde': _number(fields[11])}
        index.setdefault(entry['iau_no'], []).append(entry)
    if sum(len(rows) for rows in index.values()) < _MDC_MIN_ROWS:
        raise BuildError('the MDC file has too few data rows to be the full shower list')
    return index


def great_circle_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Angular separation in degrees between two J2000 radiants."""
    p1, p2 = math.radians(dec1), math.radians(dec2)
    cosine = (math.sin(p1) * math.sin(p2)
              + math.cos(p1) * math.cos(p2) * math.cos(math.radians(ra2 - ra1)))
    return math.degrees(math.acos(max(-1.0, min(1.0, cosine))))


def attach_mdc(showers: list[dict], mdc: dict) -> tuple[int, float, list[str]]:
    """Cross-check every parsed radiant against the MDC and carry the MDC daily drift.

    The MDC stores several parameter sets per shower (one per AdNo).  IMO's working list describes
    the annually recurring radiant, so the match is the MDC's "annual" parameter set closest to the
    radiant IMO published (the same object described twice); if the MDC publishes no annual set
    within MAX_RADIANT_OFFSET_DEG, the closest set of any activity is used and reported in `notes`.
    A shower whose nearest set is still too far has no comparable MDC entry (its only sets describe
    other apparitions) and is left unmatched with the measured distance in `notes`, so no drift
    value is invented for it.
    """
    matched, max_offset, notes = 0, 0.0, []
    unmatched, fallback = [], []
    for shower in showers:
        radiant = shower['radiant']
        shower['mdc'] = {'matched': False, 'iau_no': shower['iau_number'], 'status': None,
                         'activity': None, 'ra_deg': None, 'dec_deg': None, 'offset_deg': None}
        candidates = [entry for entry in mdc.get(shower['iau_number'], [])
                      if entry['code'] == shower['iau_code']
                      and entry['ra'] is not None and entry['dec'] is not None]
        if not candidates:
            unmatched.append(f'{shower["id"]} (no comparable MDC parameter set)')
            continue
        scored = sorted(((great_circle_deg(radiant['ra_deg'], radiant['dec_deg'], e['ra'], e['dec']), e)
                         for e in candidates), key=lambda pair: (pair[0], pair[1]['adno']))
        within = [pair for pair in scored if pair[0] <= MAX_RADIANT_OFFSET_DEG]
        annual_within = [pair for pair in within if pair[1]['activity'] == 'annual']
        if annual_within:
            offset, entry = annual_within[0]
        elif within:
            offset, entry = within[0]
            fallback.append(f'{shower["id"]} (AdNo {entry["adno"]}, activity {entry["activity"]})')
        else:
            offset, entry = scored[0]
            unmatched.append(f'{shower["id"]} (closest MDC parameter set is AdNo {entry["adno"]}, '
                             f'activity {entry["activity"]}, {offset:.2f}° away)')
            continue
        matched += 1
        max_offset = max(max_offset, offset)
        shower['mdc'] = {'matched': True, 'iau_no': shower['iau_number'], 'status': int(entry['status']),
                         'activity': entry['activity'], 'ra_deg': round(entry['ra'], 2),
                         'dec_deg': round(entry['dec'], 2), 'offset_deg': round(offset, 2)}
        if entry['dra'] is not None or entry['dde'] is not None:
            radiant['drift_ra_deg_per_day'] = entry['dra']
            radiant['drift_dec_deg_per_day'] = entry['dde']
            # Which parameter set the drift came from matters: the MDC publishes several per shower.
            radiant['drift_source'] = f'{MDC_DRIFT_SOURCE} (AdNo {entry["adno"]})'
    if matched < MIN_MATCHED:
        raise BuildError(f'only {matched} showers matched the MDC, expected at least {MIN_MATCHED}')
    if max_offset > MAX_RADIANT_OFFSET_DEG:
        raise BuildError(f'largest radiant offset {max_offset:.2f}° exceeds {MAX_RADIANT_OFFSET_DEG}°')
    notes.append(f'IAU MDC cross-check: {matched} of {len(showers)} showers matched by IAU number and '
                 f'code against the closest "annual" parameter set; largest radiant offset '
                 f'{max_offset:.2f}° (IMO prints radiants as whole degrees, so a fraction of a degree '
                 'is expected)')
    if unmatched:
        notes.append('no comparable IAU MDC parameter set for: ' + '; '.join(unmatched))
    if fallback:
        notes.append('matched to a non-annual MDC parameter set (the MDC publishes no annual set '
                     'within the tolerance): ' + ', '.join(fallback))
    return matched, max_offset, notes


# --- artifact assembly, validation and publication -------------------------------------------

ISO_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$')
SHA256_RE = re.compile(r'^[0-9a-f]{64}$')
MDC_KEYS = {'matched', 'iau_no', 'status', 'activity', 'ra_deg', 'dec_deg', 'offset_deg'}
SOURCE_KEYS = ('name', 'editor', 'publication', 'original_url', 'retrieved_url', 'retrieved_at',
               'sha256', 'table', 'correct_as_of')
CROSS_CHECK_KEYS = ('name', 'url', 'updated', 'retrieved_at', 'sha256', 'matched',
                    'max_radiant_offset_deg')


def fixture_path(year: int) -> Path:
    return DEFAULT_FIXTURE_DIR / f'imo-calendar-{year}-table5.txt'


def calendar_metadata(year: int) -> dict:
    """Metadata for a verified edition; refuses to guess one for an unknown year."""
    if year not in CALENDARS:
        raise BuildError(f'no verified calendar metadata for {year}; add the edition to CALENDARS '
                         'after checking its snapshot URL and title page')
    return CALENDARS[year]


def fixture_text(year: int, pdf: dict, page_number: int, lines: list[str]) -> str:
    """Comment header (provenance) followed by the exact normalised text the parser consumed."""
    header = [
        f'# IMO Meteor Shower Calendar {year} - {CALENDARS[year]["table_title"]} (page {page_number})',
        f'# source_url: {pdf["canonical_url"]}',
        f'# retrieved_url: {pdf["retrieved_url"]}',
        f'# retrieved_at: {pdf["retrieved_at"]}',
        f'# pdf_sha256: {pdf["sha256"]}',
        f'# page: {page_number} (1-based page number; pypdf page index {page_number - 1})',
        '# normalisation: U+25E6 -> U+00B0 (the degree glyph pypdf extracts), U+2013/U+2014/U+2212 -> "-",',
        '#   U+00A0 -> space, zero-width characters removed, space/tab runs collapsed, lines stripped,',
        '#   empty lines dropped.  Degree notation is left exactly as the PDF produced it ("283 .°15");',
        '#   the parser resolves it in resolve_degrees(), so this fixture is a true regression input.',
        '# parser: tools/overhead_meteors_build.py; regression test: tests/overhead-meteors-data.cjs',
        '# lines below are the whole normalised page text, caption and column headers included',
    ]
    return '\n'.join(header + lines) + '\n'


def write_atomic(path: Path, text: str) -> None:
    """Publish via temp file + rename so a failure never leaves a corrupt artifact behind."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(text, encoding='utf-8')
    os.replace(temp, path)


def build_notes(pdf: dict, showers: list[dict], skipped: list[str], furniture: list[str],
                mdc_notes: list[str], fixture: Path) -> list[str]:
    notes = list(pdf['notes'])
    try:  # a --fixture path outside the repo is legal; just label it as given
        fixture_label = fixture.relative_to(ROOT)
    except ValueError:
        fixture_label = fixture
    notes.append('Table 5 was read from the PDF text layer with pypdf and normalised; that exact text, '
                 f'the pinned retrieval URL and the PDF SHA-256 are committed as {fixture_label}, '
                 'which tests/overhead-meteors-data.cjs re-parses offline without any network access.')
    notes.append('Each row is the working-list entry only: activity dates, maximum date, peak solar '
                 'longitude, radiant (alpha, delta), V-infinity, population index r and ZHR, exactly '
                 'as IMO printed them. No value is interpolated or copied between showers.')
    notes.append('Editor spelling: the PDF title page reads "edited by Jürgen Rendtel"; its text layer '
                 'renders the umlaut as a combining diaeresis, recorded here with the standard U+00FC.')
    parenthesised = [shower['id'] for shower in showers if shower['parenthesised_peak']]
    if parenthesised:
        notes.append('IMO prints a parenthesised maximum for ' + ', '.join(parenthesised) + ': per the '
                     'table caption that is a reference date for the radiant, not necessarily a true '
                     'maximum. The printed values are kept and flagged "parenthesised_peak": true.')
    variable = [shower['id'] for shower in showers if shower['zhr'] is None]
    if variable:
        notes.append('ZHR is published as "Var" (variable) for ' + ', '.join(variable) + '; those rows '
                     'carry zhr: null plus the documented zhr_note instead of a made-up number.')
    notes.append('radiant.frame is recorded as J2000 because Table 5 prints no epoch and the parsed '
                 'radiants agree with the IAU MDC J2000 radiants within the offsets in cross_check.')
    if skipped:
        notes.append(f'skipped {len(skipped)} table row(s) that are not individual showers: '
                     + ' | '.join(skipped))
    if furniture:
        joined = ' | '.join(furniture)
        notes.append(f'ignored {len(furniture)} line(s) of page furniture (caption, column headers, '
                     f'wrapped sentences): {joined[:400] + ("..." if len(joined) > 400 else "")}')
    return notes + mdc_notes


def validate_artifact(data: dict, fixture_lines: list[str] | None = None) -> dict:
    """Raise BuildError unless the artifact satisfies every documented invariant."""
    if data.get('schema') != SCHEMA:
        raise BuildError(f'schema {data.get("schema")!r} != {SCHEMA!r}')
    if not ISO_RE.match(str(data.get('generated_at', ''))):
        raise BuildError('generated_at is not an ISO-8601 UTC timestamp')
    year = data.get('calendar_year')
    if not isinstance(year, int) or year not in CALENDARS:
        raise BuildError(f'calendar_year {year!r} is not a configured calendar')
    source = data.get('source') or {}
    for key in SOURCE_KEYS:
        if not source.get(key):
            raise BuildError(f'source.{key} is missing or empty')
    if not SHA256_RE.match(source['sha256']):
        raise BuildError('source.sha256 is not a SHA-256 hex digest')
    if source['original_url'] != IMO_PDF_URL.format(year=year):
        raise BuildError('source.original_url is not the canonical IMO URL for the calendar year')
    if not ISO_RE.match(source['retrieved_at']):
        raise BuildError('source.retrieved_at is not an ISO-8601 UTC timestamp')
    cross = data.get('cross_check') or {}
    for key in CROSS_CHECK_KEYS:
        if key not in cross:
            raise BuildError(f'cross_check.{key} is missing')
    for key in ('name', 'url', 'updated', 'retrieved_at', 'sha256'):
        if not cross.get(key):
            raise BuildError(f'cross_check.{key} is empty')
    if cross['url'] != MDC_URL or not SHA256_RE.match(cross['sha256']) or not ISO_RE.match(cross['retrieved_at']):
        raise BuildError('cross_check provenance is inconsistent')
    if data.get('coverage') != {'start': f'{year}-01-01', 'end': f'{year}-12-31'}:
        raise BuildError('coverage does not span the calendar year')
    showers = data.get('showers')
    if not isinstance(showers, list):
        raise BuildError('showers is not a list')
    validate_showers(showers)
    longitudes = [shower['peak']['solar_longitude_deg'] for shower in showers]
    if longitudes != sorted(longitudes):
        raise BuildError('showers are not sorted by peak solar longitude')
    matched, max_offset = 0, 0.0
    for shower in showers:
        record = shower.get('mdc') or {}
        if set(record) != MDC_KEYS:
            raise BuildError(f'{shower["id"]}: mdc keys {sorted(record)} are not the documented set')
        radiant = shower['radiant']
        drift_values = (radiant['drift_ra_deg_per_day'], radiant['drift_dec_deg_per_day'])
        if any(value is None for value in drift_values) and any(value is not None for value in drift_values):
            raise BuildError(f'{shower["id"]}: only one component of the MDC radiant drift is set')
        if not record['matched']:
            if any(record[key] is not None for key in ('status', 'activity', 'ra_deg', 'dec_deg', 'offset_deg')):
                raise BuildError(f'{shower["id"]}: unmatched shower carries MDC values')
            if radiant['drift_source'] is not None or any(value is not None for value in drift_values):
                raise BuildError(f'{shower["id"]}: unmatched shower carries radiant drift')
            continue
        matched += 1
        if record['iau_no'] != shower['iau_number'] or not record['activity']:
            raise BuildError(f'{shower["id"]}: MDC match metadata is inconsistent')
        if record['offset_deg'] is None or not 0.0 <= record['offset_deg'] <= MAX_RADIANT_OFFSET_DEG:
            raise BuildError(f'{shower["id"]}: radiant offset {record["offset_deg"]!r} exceeds '
                             f'{MAX_RADIANT_OFFSET_DEG} degrees')
        max_offset = max(max_offset, record['offset_deg'])
    if matched != cross.get('matched') or matched < MIN_MATCHED:
        raise BuildError(f'{matched} matched showers, cross_check says {cross.get("matched")!r}')
    if cross['max_radiant_offset_deg'] != round(max_offset, 2) or max_offset > MAX_RADIANT_OFFSET_DEG:
        raise BuildError(f'cross_check.max_radiant_offset_deg {cross["max_radiant_offset_deg"]!r} '
                         f'!= recomputed {round(max_offset, 2)}')
    notes = data.get('notes')
    if not isinstance(notes, list) or not notes or not all(isinstance(note, str) and note for note in notes):
        raise BuildError('notes must be a non-empty list of non-empty strings')
    if fixture_lines is not None:
        # Compared as sets: the artifact is sorted by peak solar longitude, the fixture keeps PDF order.
        fixture_rows = sorted(row['source_row'] for row in
                              (parse_row(line, year) for line in fixture_lines) if row is not None)
        if fixture_rows != sorted(shower['source_row'] for shower in showers):
            raise BuildError('the artifact does not match the committed Table 5 fixture (row sets differ)')
    return {'showers': len(showers), 'matched': matched,
            'max_radiant_offset_deg': round(max_offset, 2),
            'fixture_lines': None if fixture_lines is None else len(fixture_lines)}


# --- command line -----------------------------------------------------------------------------

def read_fixture(path: Path) -> list[str]:
    """Fixture body without the "#" provenance header (the lines the parser consumes)."""
    return [line for line in path.read_text(encoding='utf-8').splitlines() if not line.startswith('#')]


def parsed_rows(args) -> tuple[list[dict], list[str], list[str], dict | None]:
    """Parse Table 5 rows from --pdf, else the committed fixture, else a fresh download."""
    year = args.year
    page_hint = calendar_metadata(year)['table_page_hint']
    if args.pdf is not None:
        pdf = resolve_pdf(year, args.pdf)
        _, raw = table5_page(pdf['bytes'], page_hint)
        lines, context = normalise_text(raw), pdf
    else:
        fixture = args.fixture or fixture_path(year)
        if fixture.exists():
            lines, context = read_fixture(fixture), None
        else:
            pdf = resolve_pdf(year, None)
            _, raw = table5_page(pdf['bytes'], page_hint)
            lines, context = normalise_text(raw), pdf
    showers, skipped, furniture = parse_table5(lines, year)
    return showers, skipped, furniture, context


def run_build(args) -> int:
    year = args.year
    calendar_metadata(year)
    pdf = resolve_pdf(year, args.pdf)
    page_index, raw = table5_page(pdf['bytes'], CALENDARS[year]['table_page_hint'])
    page_number = page_index + 1
    lines = normalise_text(raw)
    showers, skipped, furniture = parse_table5(lines, year)
    validate_showers(showers)
    fixture = args.fixture or fixture_path(year)
    write_atomic(fixture, fixture_text(year, pdf, page_number, lines))

    if args.mdc is not None:
        mdc_bytes = args.mdc.read_bytes()
        mdc_note = (f'MDC list read from the local file given with --mdc ({args.mdc}); the '
                    f'committed artifact records the canonical URL {MDC_URL} and the SHA-256 of these bytes')
    else:
        mdc_bytes, _, _ = http_get(MDC_URL)
        mdc_note = None
    mdc_retrieved_at = utc_now()
    index = load_mdc(mdc_bytes)
    matched, max_offset, mdc_notes = attach_mdc(showers, index)
    if mdc_note:
        mdc_notes.insert(0, mdc_note)
    showers.sort(key=lambda shower: (shower['peak']['solar_longitude_deg'], shower['id']))

    artifact = {
        'schema': SCHEMA,
        'generated_at': utc_now(),
        'calendar_year': year,
        'source': {
            'name': CALENDARS[year]['name'],
            'editor': CALENDARS[year]['editor'],
            'publication': CALENDARS[year]['publication'],
            'original_url': pdf['canonical_url'],
            'retrieved_url': pdf['retrieved_url'],
            'retrieved_at': pdf['retrieved_at'],
            'sha256': pdf['sha256'],
            'table': f'{CALENDARS[year]["table_title"]} (page {page_number})',
            'correct_as_of': CALENDARS[year]['correct_as_of'],
        },
        'cross_check': {
            'name': MDC_NAME,
            'url': MDC_URL,
            'updated': MDC_UPDATED,
            'retrieved_at': mdc_retrieved_at,
            'sha256': sha256(mdc_bytes),
            'matched': matched,
            'max_radiant_offset_deg': round(max_offset, 2),
        },
        'coverage': {'start': f'{year}-01-01', 'end': f'{year}-12-31'},
        'showers': showers,
        'notes': build_notes(pdf, showers, skipped, furniture, mdc_notes, fixture),
    }
    payload = json.dumps(artifact, indent=2, ensure_ascii=False) + '\n'
    write_atomic(args.out, payload)
    # Re-validate exactly what was published, from disk, including the fixture cross-check.
    summary = validate_artifact(json.loads(args.out.read_text(encoding='utf-8')), read_fixture(fixture))
    print(f'PDF {pdf["retrieved_url"]} sha256={pdf["sha256"]} ({pdf["page_count"]} pages)')
    print(f'fixture {fixture} ({len(lines)} normalised lines)')
    print(f'wrote {args.out}: {summary["showers"]} showers, {summary["matched"]} MDC matches, '
          f'max radiant offset {summary["max_radiant_offset_deg"]:.2f}°')
    print(f'artifact sha256={sha256(Path(args.out).read_bytes())}')
    return 0


def run_check(args) -> int:
    """Offline validation of the committed artifact (plus the fixture when it is present)."""
    if not args.out.exists():
        raise BuildError(f'{args.out} does not exist; run the build first')
    data = json.loads(args.out.read_text(encoding='utf-8'))
    fixture = args.fixture or fixture_path(args.year)
    if fixture.exists():
        fixture_lines = read_fixture(fixture)
    else:
        fixture_lines = None
        print(f'note: no fixture at {fixture}; provenance-only validation', file=sys.stderr)
    summary = validate_artifact(data, fixture_lines)
    print(f'OK {args.out}: schema {data["schema"]}, {summary["showers"]} showers, '
          f'{summary["matched"]} MDC matches, max radiant offset '
          f'{summary["max_radiant_offset_deg"]:.2f}°, fixture lines {summary["fixture_lines"]}')
    return 0


def run_print_row_count(args) -> int:
    showers, _, _, _ = parsed_rows(args)
    print(len(showers))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--year', type=int, default=2026, help='calendar year (default 2026)')
    parser.add_argument('--pdf', type=Path, help='use this local PDF instead of downloading')
    parser.add_argument('--out', type=Path, default=DEFAULT_OUT,
                        help=f'artifact path (default {DEFAULT_OUT})')
    parser.add_argument('--fixture', type=Path, help='Table 5 text fixture path (default '
                        'tests/fixtures/overhead/imo-calendar-<year>-table5.txt)')
    parser.add_argument('--mdc', type=Path, help='use this local IAU MDC text file instead of downloading')
    parser.add_argument('--check', action='store_true', help='validate the existing artifact and exit')
    parser.add_argument('--print-row-count', action='store_true', dest='print_row_count',
                        help='print the number of parsed Table 5 shower rows and exit')
    args = parser.parse_args(argv)
    try:
        calendar_metadata(args.year)
        if args.check:
            return run_check(args)
        if args.print_row_count:
            return run_print_row_count(args)
        return run_build(args)
    except BuildError as error:
        print(f'FAIL: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())

