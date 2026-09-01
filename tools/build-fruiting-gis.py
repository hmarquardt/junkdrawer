#!/usr/bin/env python3
"""Build compact, static Fruiting Forecast GIS tiles.

Python is used only at data-refresh time. The application has no runtime backend.
The default Southern Indiana build samples authoritative public services on a
0.05-degree grid and writes ordinary Parquet cells partitioned into 1-degree
tiles. Install the two preparation dependencies with:

    uv run --with duckdb --with requests tools/build-fruiting-gis.py
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import time
import urllib.request
import zipfile
from pathlib import Path

import duckdb
import requests

try:
    import rasterio
    from rasterio.warp import transform
except ImportError:
    rasterio = None

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "fruiting-forecast"
NLCD = "https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms"
CANOPY = "https://dmsdata.cr.usgs.gov/geoserver/mrlc_NLCD-Tree-Canopy-Native_conus_year_data/wms"
EPQS = "https://epqs.nationalmap.gov/v1/json"
PADUS = "https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/PADUS_Public_Access/FeatureServer/0/query"
SDA = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"
PADUS_INFO = "https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-download"
# kumi.systems first: the canonical endpoint rate-limits bulk multi-statement
# queries aggressively; per-sub-bbox results are cached so retries are cheap.
OVERPASS_MIRRORS = ["https://overpass.kumi.systems/api/interpreter",
                    "https://overpass-api.de/api/interpreter",
                    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
OSM_ATTR = "© OpenStreetMap contributors (ODbL)"

LAND = {41: "deciduous", 42: "evergreen", 43: "mixed", 52: "shrub", 71: "grass", 81: "pasture", 82: "crops", 90: "woody_wetland", 95: "wetland"}
FOREST = {41, 42, 43, 90}

# CONUS bounds (approximate lat/lon tile grid)
CONUS_LAT_MIN = 25
CONUS_LAT_MAX = 49
CONUS_LON_MIN = -125
CONUS_LON_MAX = -67


def wms_point(url: str, layer: str, lat: float, lon: float) -> float | None:
    d = 0.001
    params = {"service": "WMS", "version": "1.3.0", "request": "GetFeatureInfo", "layers": layer,
              "query_layers": layer, "crs": "EPSG:4326", "bbox": f"{lat-d},{lon-d},{lat+d},{lon+d}",
              "width": 3, "height": 3, "i": 1, "j": 1, "info_format": "application/json",
              "time": "2025-01-01T00:00:00.000Z"}
    j = requests.get(url, params=params, timeout=25).json()
    p = (j.get("features") or [{}])[0].get("properties", {})
    v = p.get("PALETTE_INDEX")
    return float(v) if v is not None else None


def soil_point(lat: float, lon: float) -> dict:
    # muaggatt fields are map-unit weighted dominant/representative values. The
    # spatial join is performed by SDA's SDA_Get_Mukey_from_intersection helper.
    q = f"""SELECT TOP 1 drclassdcd, aws025wta, aws050wta, flodfreqdcd,
      hydgrpdcd, slopegraddcp FROM muaggatt WHERE mukey IN
      (SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point({lon:.6f} {lat:.6f})'))"""
    try:
        j = requests.post(SDA, json={"query": q, "format": "JSON+COLUMNNAME"}, timeout=35).json()
        t = j.get("Table") or []
        if len(t) < 2:
            return {}
        return dict(zip([str(x).lower() for x in t[0]], t[1]))
    except Exception:
        return {}


def pad_tile_features(bbox: tuple[float, float, float, float], cache_dir: Path) -> list:
    """Fetch PAD-US polygons intersecting a padded tile bbox.

    This hosted FeatureServer fails point-geometry intersection queries, so the
    build downloads the polygons once per tile (simplified with
    maxAllowableOffset) and resolves point-in-polygon locally.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = "padus_%d_%d_%d_%d.json" % tuple(round(v * 10) for v in bbox)
    path = cache_dir / key
    if path.exists():
        return json.loads(path.read_text())
    feats, offset = [], 0
    while True:
        p = {"f": "json", "geometry": json.dumps({"xmin": bbox[0], "ymin": bbox[1], "xmax": bbox[2], "ymax": bbox[3]}),
             "geometryType": "esriGeometryEnvelope", "inSR": 4326, "outSR": 4326,
             "spatialRel": "esriSpatialRelIntersects",
             "outFields": "Pub_Access,BndryName,Unit_Nm,MngNm_Desc,Category", "returnGeometry": "true",
             "maxAllowableOffset": 0.00025, "resultOffset": offset, "resultRecordCount": 2000}
        j = requests.get(PADUS, params=p, timeout=90).json()
        fs = j.get("features") or []
        feats.extend(fs)
        if len(fs) < 2000 or offset > 20000:
            break
        offset += 2000
    path.write_text(json.dumps(feats))
    return feats


def point_in_rings(x: float, y: float, rings: list) -> bool:
    """Even-odd ray casting across all rings; holes toggle the result."""
    inside = False
    for ring in rings:
        n = len(ring)
        if n < 4:
            continue
        j = n - 1
        for i in range(n):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def pad_point(lat: float, lon: float, features: list) -> dict:
    """Classify a sample point against locally fetched PAD-US polygons.

    Multiple polygons can overlap (e.g. fee property under a restricted
    easement); the most restrictive classification wins and all property
    names are retained for provenance.
    """
    rank = {"restricted": 3, "unknown": 2, "public": 1}
    hits = []
    for f in features:
        g = f.get("geometry") or {}
        if not g.get("rings") or not point_in_rings(lon, lat, g["rings"]):
            continue
        a = f.get("attributes") or {}
        hits.append({"access_class": {"OA": "public", "RA": "restricted", "XA": "restricted"}.get(a.get("Pub_Access"), "unknown"),
                     "property_name": a.get("Unit_Nm") or a.get("BndryName"), "access_manager": a.get("MngNm_Desc"),
                     "access_category": a.get("Category")})
    if not hits:
        return {}
    best = max(hits, key=lambda h: rank[h["access_class"]])
    best["property_name"] = ", ".join(dict.fromkeys(h["property_name"] for h in hits if h["property_name"])) or None
    return best


def property_type(name: str, manager: str) -> str:
    """Infer only a broad display type from authoritative PAD-US labels."""
    text = f"{name} {manager}".lower()
    for needle, label in (("national wildlife refuge", "National Wildlife Refuge"),
                          ("national forest", "National Forest"),
                          ("fish and wildlife area", "Fish & Wildlife Area"),
                          ("wildlife management area", "Wildlife Management Area"),
                          ("state forest", "State Forest"), ("state park", "State Park"),
                          ("recreation area", "Recreation Area"),
                          ("nature preserve", "Nature Preserve"),
                          ("county park", "County Park"), ("city park", "City Park")):
        if needle in text:
            return label
    return "Protected Area"


def group_pad_properties(features: list, coverage: tuple[float, float, float, float]) -> list:
    """Deduplicate PAD-US polygons into named property records with merged rings."""
    grouped, seen = {}, set()
    for feature in features:
        attrs, geometry = feature.get("attributes") or {}, feature.get("geometry") or {}
        rings = geometry.get("rings") or []
        name = (attrs.get("Unit_Nm") or attrs.get("BndryName") or "").strip()
        manager = (attrs.get("MngNm_Desc") or "Unknown manager").strip()
        access = {"OA": "PUBLIC", "RA": "LIKELY_PUBLIC", "XA": "RESTRICTED_VERIFY"}.get(attrs.get("Pub_Access"), "UNKNOWN")
        if not name or not rings or access == "UNKNOWN":
            continue
        digest = hashlib.sha1(json.dumps(rings, separators=(",", ":")).encode()).hexdigest()
        if digest in seen:
            continue
        seen.add(digest)
        key = (name, manager, property_type(name, manager))
        rec = grouped.setdefault(key, {"rings": [], "access": set(), "bbox": [180.0, 90.0, -180.0, -90.0]})
        rec["access"].add(access)
        for ring in rings:
            if len(ring) < 4:
                continue
            ring_box = [min(p[0] for p in ring), min(p[1] for p in ring), max(p[0] for p in ring), max(p[1] for p in ring)]
            if ring_box[0] > coverage[2] or ring_box[2] < coverage[0] or ring_box[1] > coverage[3] or ring_box[3] < coverage[1]:
                continue
            rec["rings"].append(ring)
            for lon, lat, *_ in ring:
                rec["bbox"] = [min(rec["bbox"][0], lon), min(rec["bbox"][1], lat),
                               max(rec["bbox"][2], lon), max(rec["bbox"][3], lat)]
    records = []
    for (name, manager, kind), rec in grouped.items():
        if not rec["rings"]:
            continue
        bbox = rec["bbox"]
        access = next(iter(rec["access"])) if len(rec["access"]) == 1 else "MIXED"
        ownership = "PRIVATE" if "private" in manager.lower() else access
        records.append({"property_id": hashlib.sha1(f"{name}|{manager}|{kind}".encode()).hexdigest()[:16],
                        "property_name": name, "manager": manager, "property_type": kind,
                        "ownership_class": ownership, "access_class": access,
                        "rings": rec["rings"], "bbox": bbox})
    return records


def build_public_lands(features: list, out: Path, coverage: tuple[float, float, float, float]) -> dict:
    """Write compact named-property Parquet with reusable GeoJSON geometry."""
    properties = group_pad_properties(features, coverage)
    records = []
    for rec in properties:
        name, manager, kind, bbox = rec["property_name"], rec["manager"], rec["property_type"], rec["bbox"]
        geometry = {"type": "MultiPolygon", "coordinates": [[[p for p in ring]] for ring in rec["rings"]]}
        records.append({"property_id": rec["property_id"],
                        "property_name": name, "manager": manager, "property_type": kind,
                        "ownership_class": rec["ownership_class"], "access_class": rec["access_class"],
                        "geometry_json": json.dumps(geometry, separators=(",", ":")),
                        "min_lon": bbox[0], "min_lat": bbox[1], "max_lon": bbox[2], "max_lat": bbox[3],
                        "center_lon": (bbox[0] + bbox[2]) / 2, "center_lat": (bbox[1] + bbox[3]) / 2,
                        "geometry_source": "PAD-US Public Access hosted service", "source_url": PADUS_INFO})
    tmp = out.with_suffix(".jsonl")
    tmp.write_text("\n".join(json.dumps(row, separators=(",", ":")) for row in records))
    con = duckdb.connect()
    q = lambda p: "'" + str(p).replace("'", "''") + "'"
    con.execute(f"COPY (SELECT * FROM read_json_auto({q(tmp)})) TO {q(out)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 256)")
    tmp.unlink()
    return {"url": out.name, "properties": len(records), "bytes": out.stat().st_size,
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
            "format": "parquet-geojson-column", "geometryColumn": "geometry_json"}


AGENCY_KEYWORDS = ("department of natural resources", " dnr", "forest service", "usfs",
                   "fish and wildlife", "fish & wildlife", "usfws", "refuge", "state forest")


def overpass_features(bbox: tuple[float, float, float, float], cache_dir: Path) -> list:
    """Fetch OSM access features (Tier-2 source) for the coverage bbox.

    Only genuine access features are requested — public parking, trailheads,
    boat ramps, publicly passable gates, and visitor information. The region
    is queried in small sub-bboxes because Overpass rejects region-wide
    parking queries. Results are cached on disk because Overpass is slow.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)
    elements = []
    steps_lon, steps_lat = 8, 4
    for i in range(steps_lon):
        for j in range(steps_lat):
            west = bbox[0] + (bbox[2] - bbox[0]) * i / steps_lon
            east = bbox[0] + (bbox[2] - bbox[0]) * (i + 1) / steps_lon
            south = bbox[1] + (bbox[3] - bbox[1]) * j / steps_lat
            north = bbox[1] + (bbox[3] - bbox[1]) * (j + 1) / steps_lat
            box = (west, south, east, north)
            path = cache_dir / f"osm_access_{west:.2f}_{south:.2f}_{east:.2f}_{north:.2f}.json"
            if path.exists():
                elements.extend(json.loads(path.read_text()))
                continue
            q = (f"[out:json][timeout:120];("
                 f'nwr["amenity"="parking"]({south:.4f},{west:.4f},{north:.4f},{east:.4f});'
                 f'nwr["highway"="trailhead"]({south:.4f},{west:.4f},{north:.4f},{east:.4f});'
                 f'nwr["amenity"="boat_ramp"]({south:.4f},{west:.4f},{north:.4f},{east:.4f});'
                 f'nwr["barrier"="gate"]["access"~"^(yes|public|permissive)$"]({south:.4f},{west:.4f},{north:.4f},{east:.4f});'
                 f'nwr["tourism"="information"]["information"~"^(visitor_centre|visitor_center)$"]({south:.4f},{west:.4f},{north:.4f},{east:.4f});'
                 f");out center tags;")
            print(f"Querying Overpass sub-bbox {west:.2f},{south:.2f} → {east:.2f},{north:.2f}")
            batch, last = None, None
            for endpoint in OVERPASS_MIRRORS:
                for attempt in range(2):
                    try:
                        r = requests.post(endpoint, data={"data": q}, timeout=180,
                                          headers={"User-Agent": "fruiting-forecast-gis-build/1.0 (static offline preprocessing; junkdrawer local-first tool)"})
                        r.raise_for_status()
                        batch = r.json().get("elements") or []
                        break
                    except Exception as e:
                        last = e
                        print(f"  {endpoint.split('/')[2]} attempt {attempt + 1} failed: {e}")
                        time.sleep(30 if '429' in str(e) or 'Too Many' in str(e) else 10)
                if batch is not None:
                    break
            if batch is None:
                raise SystemExit(f"Overpass query failed for sub-bbox {box}: {last}")
            path.write_text(json.dumps(batch))
            elements.extend(batch)
            print(f"  {len(batch)} features")
            time.sleep(4)
    print(f"  {len(elements)} OSM access features total")
    return elements


def classify_access(tags: dict, prop: dict | None, edge_deg: float | None) -> tuple[str, str] | None:
    """Return (type, confidence) or None when the feature must be rejected.

    No coordinates are ever synthesized: a point is only kept when OSM mapped
    a genuine access feature that falls inside a named public property, or
    immediately adjacent with explicit access intent.
    """
    tags = tags or {}
    if tags.get("access") in {"private", "no", "customers"}:
        return None
    if tags.get("amenity") == "parking":
        kind = "PARKING"
    elif tags.get("highway") == "trailhead":
        kind = "TRAILHEAD"
    elif tags.get("amenity") == "boat_ramp":
        kind = "BOAT_RAMP"
    elif tags.get("barrier") in {"gate", "entrance"}:
        kind = "GATE"
    elif tags.get("tourism") == "information":
        kind = "VISITOR_AREA"
    else:
        return None
    if prop is None:
        # A nearby-but-outside point must carry explicit access intent and sit
        # within ~130 m of the boundary; otherwise it is unrelated parking.
        if kind not in {"TRAILHEAD", "GATE", "PARKING"} or edge_deg is None or edge_deg > 0.0012:
            return None
        return kind, "LOW"
    text = f"{tags.get('name', '')} {tags.get('operator', '')}".lower()
    if any(k in text for k in AGENCY_KEYWORDS) or prop["property_name"].lower() in text:
        return kind, "HIGH"
    return kind, "MEDIUM"


def build_access_points(features: list, properties: list, out: Path) -> dict:
    """Associate OSM access features with named PAD-US properties; write Parquet."""
    indexed = []
    for prop in properties:
        if prop["ownership_class"] in {"PRIVATE", "LIKELY_PRIVATE"}:
            continue
        bl = prop["bbox"]
        indexed.append((prop, (bl[2] - bl[0]) * (bl[3] - bl[1])))
    # Smallest-area property wins when polygons nest (preserve inside a forest).
    indexed.sort(key=lambda item: item[1])
    records, seen = [], set()
    for element in features:
        tags = element.get("tags") or {}
        lat = element.get("lat") or (element.get("center") or {}).get("lat")
        lon = element.get("lon") or (element.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        prop, edge = None, None
        for candidate, _area in indexed:
            bl = candidate["bbox"]
            if not (bl[0] - 0.004 <= lon <= bl[2] + 0.004 and bl[1] - 0.004 <= lat <= bl[3] + 0.004):
                continue
            if any(point_in_rings(lon, lat, [ring]) for ring in candidate["rings"]):
                prop, edge = candidate, 0.0
                break
            nearest = min(min((p[0] - lon) ** 2 + (p[1] - lat) ** 2 for p in ring) for ring in candidate["rings"]) ** 0.5
            if edge is None or nearest < edge:
                prop, edge = candidate, nearest
        if prop is None or edge is None:
            continue
        classified = classify_access(tags, prop if edge == 0.0 else None, edge)
        if not classified:
            continue
        kind, confidence = classified
        cell = (round(lat / 0.0008), round(lon / 0.0008))
        dedupe_key = (prop["property_id"], kind, cell)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        osm_type = {"node": "node", "way": "way", "relation": "relation"}.get(element.get("type"), "node")
        name = (tags.get("name") or "").strip() or f"{prop['property_name']} {kind.replace('_', ' ').title()}"
        notes = ", ".join(v for v in (tags.get("surface") and "surface: " + tags["surface"],
                                      tags.get("capacity") and "capacity: " + tags["capacity"]) if v) or None
        records.append({"access_id": hashlib.sha1(f"{prop['property_id']}|{lat:.5f}|{lon:.5f}|{kind}".encode()).hexdigest()[:16],
                        "property_id": prop["property_id"], "property_name": prop["property_name"],
                        "name": name, "lat": round(lat, 5), "lon": round(lon, 5), "type": kind,
                        "source": "OpenStreetMap", "source_url": f"https://www.osm.org/{osm_type}/{element['id']}",
                        "confidence": confidence, "official": confidence == "HIGH",
                        "operator": (tags.get("operator") or "").strip() or None, "notes": notes,
                        "verified_at": time.strftime("%Y-%m-%d")})
    tmp = out.with_suffix(".jsonl")
    tmp.write_text("\n".join(json.dumps(row, separators=(",", ":")) for row in records))
    con = duckdb.connect()
    q = lambda p: "'" + str(p).replace("'", "''") + "'"
    con.execute(f"COPY (SELECT * FROM read_json_auto({q(tmp)})) TO {q(out)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 256)")
    tmp.unlink()
    return {"url": out.name, "points": len(records), "bytes": out.stat().st_size,
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
            "datasetVersion": time.strftime("%Y.%m.%d"), "source": "OpenStreetMap", "attribution": OSM_ATTR,
            "confidenceModel": "HIGH agency/property match · MEDIUM inside boundary · LOW adjacent access intent",
            "note": "Access points are entry/parking evidence, never mushroom locations."}


def collecting_rules_descriptor() -> dict:
    path = OUT / "public-land-rules.json"
    data = json.loads(path.read_text())
    return {"url": path.name, "schemaVersion": data["schemaVersion"],
            "datasetVersion": data["datasetVersion"], "verifiedAt": data["verifiedAt"],
            "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def sample(point: tuple[float, float], pad_features: list) -> dict:
    lat, lon = point
    row = {"cell_id": f"{lat:.3f}_{lon:.3f}", "lat": lat, "lon": lon}
    try:
        lc = wms_point(NLCD, "Land-Cover-Native_conus_year_data", lat, lon)
        row.update(land_class=LAND.get(int(lc), "other") if lc is not None else None,
                   forest=1.0 if lc in FOREST else 0.0 if lc is not None else None,
                   deciduous=1.0 if lc == 41 else 0.0 if lc is not None else None,
                   open_land=1.0 if lc in {71, 81, 82} else 0.0 if lc is not None else None)
    except Exception:
        row.update(land_class=None, forest=None, deciduous=None, open_land=None)
    try:
        cc = wms_point(CANOPY, "NLCD-Tree-Canopy-Native_conus_year_data", lat, lon)
        row["canopy"] = cc / 100 if cc is not None and 0 <= cc <= 100 else None
    except Exception:
        row["canopy"] = None
    try:
        row["elevation_ft"] = float(requests.get(EPQS, params={"x": lon, "y": lat, "units": "Feet", "wkid": 4326}, timeout=20).json()["value"])
    except Exception:
        row["elevation_ft"] = None
    soil = soil_point(lat, lon)
    def num(k):
        try: return float(soil.get(k))
        except (TypeError, ValueError): return None
    row.update(drainage_class=soil.get("drclassdcd"), awc_25_cm=num("aws025wta"), awc_50_cm=num("aws050wta"),
               flood_frequency=soil.get("flodfreqdcd"), hydrologic_group=soil.get("hydgrpdcd"), slope_deg=num("slopegraddcp"))
    row.update(pad_point(lat, lon, pad_features))
    row.setdefault("access_class", "likely_private")
    row.setdefault("property_name", None)
    row.setdefault("access_manager", None)
    return row


def enrich_forest_groups(rows: list[dict], cache_dir: Path, skip: bool) -> None:
    """Sample the national FIA/GTAC 250 m forest-type-group raster."""
    for row in rows:
        row.update(forest_group=None, oak_hickory_signal=None, beech_maple_signal=None, elm_ash_cottonwood_signal=None)
    if skip:
        return
    if rasterio is None:
        raise SystemExit("rasterio is required unless --skip-forest-groups is used")
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive = cache_dir / "conus_forestgroup.zip"
    extracted = cache_dir / "conus_forestgroup"
    if not archive.exists():
        print("Downloading USDA Forest Service forest-type-group raster (about 160 MB)")
        urllib.request.urlretrieve("https://data.fs.usda.gov/geodata/rastergateway/forest_type/conus_forestgroup.zip", archive)
    if not extracted.exists():
        extracted.mkdir()
        with zipfile.ZipFile(archive) as z:
            z.extractall(extracted)
    # The archive ships a companion accuracy raster ("*_error.img"); sample only
    # the classified product. Legend: 400 oak/pine, 500 oak/hickory,
    # 600 oak/gum/cypress, 700 elm/ash/cottonwood, 800 maple/beech/birch,
    # 0 = non-forest (a real reading, not missing data).
    candidates = [p for p in list(extracted.rglob("*.img")) + list(extracted.rglob("*.tif"))
                  if "error" not in p.name.lower()]
    if not candidates:
        raise SystemExit("Forest group archive contained no supported raster")
    with rasterio.open(candidates[0]) as src:
        xs, ys = transform("EPSG:4326", src.crs, [r["lon"] for r in rows], [r["lat"] for r in rows])
        values = [int(v[0]) for v in src.sample(zip(xs, ys))]
    names = {400: "oak_pine", 500: "oak_hickory", 600: "oak_gum_cypress", 700: "elm_ash_cottonwood", 800: "maple_beech_birch"}
    for row, value in zip(rows, values):
        row["forest_group"] = names.get(value)
        row["oak_hickory_signal"] = 1.0 if value == 500 else 0.0
        row["beech_maple_signal"] = 1.0 if value == 800 else 0.0
        row["elm_ash_cottonwood_signal"] = 1.0 if value == 700 else 0.0


# ── Tile utility functions ──────────────────────────────────────────────


def tile_of(p: tuple[float, float]) -> str:
    return f"n{math.floor(p[0]):02d}_w{abs(math.floor(p[1])):03d}"


def tile_lat(tile_id: str) -> int:
    return int(tile_id.split("_")[0][1:])


def tile_lon(tile_id: str) -> int:
    return -int(tile_id.split("_")[1][1:])


def tile_bbox(tile_id: str) -> list[float]:
    lat = tile_lat(tile_id)
    lon = tile_lon(tile_id)
    return [lon, lat, lon + 1, lat + 1]


def all_conus_tiles() -> list[str]:
    tiles = []
    for lat in range(CONUS_LAT_MIN, CONUS_LAT_MAX):
        for lon in range(CONUS_LON_MIN, CONUS_LON_MAX):
            tiles.append(tile_of((lat + 0.5, lon + 0.5)))
    return sorted(tiles)


def estimate_land_fraction(tile_id: str) -> float:
    """Rough heuristic: estimate land fraction by latitudinal zone."""
    lat = tile_lat(tile_id)
    if lat >= 47:
        return 0.4
    elif lat >= 45:
        return 0.7
    elif lat >= 42:
        return 0.9
    elif lat >= 37:
        return 0.95
    elif lat >= 33:
        return 0.85
    elif lat >= 30:
        return 0.7
    elif lat >= 27:
        return 0.5
    else:
        return 0.25


def dry_run_report(bbox: tuple[float, float, float, float], step: float) -> None:
    """Print estimated tile counts and sizes for the given bbox."""
    west, south, east, north = bbox
    points = []
    lat = south + step / 2
    while lat < north:
        lon = west + step / 2
        while lon < east:
            points.append((round(lat, 5), round(lon, 5)))
            lon += step
        lat += step

    tiles_map: dict[str, int] = {}
    for p in points:
        tid = tile_of(p)
        tiles_map[tid] = tiles_map.get(tid, 0) + 1

    total_habitat = 0
    total_pl = 0
    total_ap = 0
    land_tiles = 0

    for tid, cells in sorted(tiles_map.items()):
        frac = estimate_land_fraction(tid)
        is_land = frac > 0.01
        hab_bytes = max(2000, int(cells * 75))
        pl_bytes = int(400 * cells * (0.3 + 0.7 * frac)) if is_land else 0
        ap_bytes = int(80 * cells * (0.2 + 0.8 * frac)) if is_land else 0
        total_habitat += hab_bytes
        total_pl += pl_bytes
        total_ap += ap_bytes
        if is_land:
            land_tiles += 1

    n_tiles = len(tiles_map)
    print("=" * 60)
    print(f"DRY RUN — Bbox: [{west:.2f}, {south:.2f}, {east:.2f}, {north:.2f}]")
    print(f"  Total 1° tiles in bbox      : {n_tiles}")
    print(f"  Estimated land tiles         : {land_tiles}")
    print(f"  Total 0.05° sample cells     : {len(points):,}")
    print(f"  Cells per tile (avg)         : ~{len(points) // max(n_tiles, 1)}")
    print()
    print("  Estimated storage:")
    print(f"    Habitat tiles              : {total_habitat:>10,} B  ({total_habitat/1024:>8.1f} KB)")
    print(f"    Public land tiles          : {total_pl:>10,} B  ({total_pl/1024:>8.1f} KB)")
    print(f"    Access point tiles         : {total_ap:>10,} B  ({total_ap/1024:>8.1f} KB)")
    print(f"    ─────────────────────────────────────")
    gtotal = total_habitat + total_pl + total_ap
    print(f"    Total                      : {gtotal:>10,} B  ({gtotal/1024:>8.1f} KB)")
    print()
    for radius, nt in [("25-mile (N≈9)", 9), ("50-mile (N≈16)", 16), ("100-mile (N≈49)", 49)]:
        n = min(nt, n_tiles)
        r_hab = (total_habitat // n_tiles) * n if n_tiles else 0
        r_pl = (total_pl // n_tiles) * n if n_tiles else 0
        r_ap = (total_ap // n_tiles) * n if n_tiles else 0
        r_total = r_hab + r_pl + r_ap
        print(f"  Max download {radius:20s}: {r_total:>8,} B  ({r_total/1024:>6.1f} KB)")
    print()
    print("  Tile IDs in bbox:")
    for tid in sorted(tiles_map):
        frac = estimate_land_fraction(tid)
        print(f"    {tid}  lat={tile_lat(tid)}° lon={tile_lon(tid)}°  cells={tiles_map[tid]:>4d}  land_est={frac:.0%}")
    print("=" * 60)


def build_tile_catalog(out_dir: Path) -> dict:
    """Generate tile-catalog.json with every possible CONUS 1° tile and a land boolean."""
    tiles = all_conus_tiles()
    catalog = []
    for tid in tiles:
        frac = estimate_land_fraction(tid)
        catalog.append({
            "id": tid,
            "lat": tile_lat(tid),
            "lon": tile_lon(tid),
            "land": frac > 0.01,
            "landFraction": round(frac, 4),
            "bbox": tile_bbox(tid)
        })
    catalog.sort(key=lambda t: (t["lat"], t["lon"]))
    catalog_obj = {
        "schemaVersion": 1,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tileDegrees": 1.0,
        "totalTiles": len(catalog),
        "landTiles": sum(1 for t in catalog if t["land"]),
        "tiles": catalog
    }
    (out_dir / "tile-catalog.json").write_text(json.dumps(catalog_obj, indent=2) + "\n")
    print(f"Wrote {len(catalog)} tiles to tile-catalog.json ({sum(1 for t in catalog if t['land'])} land)")
    return catalog_obj


def tile_has_data(tile_id: str, out_dir: Path) -> bool:
    """Check if a tile already has its habitat parquet."""
    hab = out_dir / "habitat" / f"{tile_id}.parquet"
    return hab.exists()


def main() -> None:
    ap = argparse.ArgumentParser(description="Build Fruiting Forecast GIS tiles from authoritative public services.")
    ap.add_argument("--bbox", default="-91,35,-83,40",
                    help="West,South,East,North (e.g. -91,35,-83,40 for Ohio+Tennessee Valleys)")
    ap.add_argument("--step", type=float, default=0.05)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--source-cache", type=Path, default=Path("/tmp/fruiting-forecast-gis-sources"))
    ap.add_argument("--skip-forest-groups", action="store_true")
    ap.add_argument("--reuse-existing", action="store_true", help="Reuse checked-in cells and refresh derived forest groups/manifest")
    ap.add_argument("--public-lands-only", action="store_true", help="Refresh named public-land geometry without rebuilding habitat cells")
    ap.add_argument("--access-points-only", action="store_true", help="Refresh public access/parking points without rebuilding habitat cells")
    ap.add_argument("--tile-id", type=str, default=None,
                    help="Process a single 1° tile (e.g. n38_w087)")
    ap.add_argument("--resume", action="store_true",
                    help="Skip tiles where output parquet already exists in habitat/ subdir")
    ap.add_argument("--dry-run", action="store_true",
                    help="Estimate tile counts and sizes without fetching data")
    ap.add_argument("--tile-catalog", action="store_true",
                    help="Generate tile-catalog.json for all CONUS tiles")
    args = ap.parse_args()
    west, south, east, north = map(float, args.bbox.split(","))
    pad_cache = args.source_cache

    if args.tile_catalog:
        OUT.mkdir(parents=True, exist_ok=True)
        build_tile_catalog(OUT)
        return

    if args.dry_run:
        dry_run_report((west, south, east, north), args.step)
        return

    # Build point grid from bbox
    points = []
    lat = south + args.step / 2
    while lat < north:
        lon = west + args.step / 2
        while lon < east:
            points.append((round(lat, 5), round(lon, 5)))
            lon += args.step
        lat += args.step

    tiles_points: dict[str, list] = {}
    for p in points:
        tiles_points.setdefault(tile_of(p), []).append(p)

    # Filter to single tile if --tile-id given
    if args.tile_id:
        if args.tile_id in tiles_points:
            tiles_points = {args.tile_id: tiles_points[args.tile_id]}
        else:
            # Generate points for this tile even if outside bbox
            tile_lat_val = tile_lat(args.tile_id)
            tile_lon_val = tile_lon(args.tile_id)
            pts = []
            lat = tile_lat_val + args.step / 2
            while lat < tile_lat_val + 1:
                lon = tile_lon_val + args.step / 2
                while lon < tile_lon_val + 1:
                    pts.append((round(lat, 5), round(lon, 5)))
                    lon += args.step
                lat += args.step
            tiles_points = {args.tile_id: pts}
        tl = tile_lat(args.tile_id)
        tln = tile_lon(args.tile_id)
        west, south, east, north = tln, tl, tln + 1, tl + 1

    # Handle --resume: skip tiles that already exist
    if args.resume and not args.tile_id:
        skip = [tid for tid in tiles_points if tile_has_data(tid, OUT)]
        if skip:
            print(f"Resume: {len(skip)} tiles exist, skipping: {', '.join(sorted(skip))}")
            for tid in skip:
                del tiles_points[tid]
        if not tiles_points:
            print("All tiles already built. Nothing to do.")
            return

    # Ensure subdirs exist
    (OUT / "habitat").mkdir(parents=True, exist_ok=True)
    (OUT / "pl").mkdir(parents=True, exist_ok=True)
    (OUT / "ap").mkdir(parents=True, exist_ok=True)

    pad_features_by_tile = {}
    for tile, pts in sorted(tiles_points.items()):
        pad_features_by_tile[tile] = pad_tile_features(
            (math.floor(min(x[1] for x in pts)) - 0.25, math.floor(min(x[0] for x in pts)) - 0.25,
             math.ceil(max(x[1] for x in pts)) + 0.25, math.ceil(max(x[0] for x in pts)) + 0.25), pad_cache)
    OUT.mkdir(parents=True, exist_ok=True)
    pad_all = [feature for features in pad_features_by_tile.values() for feature in features]
    public_lands = build_public_lands(pad_all, OUT / "public-lands.parquet", (west, south, east, north))
    access_points = None
    if args.access_points_only or args.public_lands_only or not args.reuse_existing:
        properties = group_pad_properties(pad_all, (west, south, east, north))
        access_points = build_access_points(overpass_features((west, south, east, north), pad_cache),
                                            properties, OUT / "access-points.parquet")
    def access_descriptor():
        if access_points:
            return access_points
        path = OUT / "access-points.parquet"
        if not path.exists():
            return None
        return {"url": path.name, "bytes": path.stat().st_size,
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "format": "parquet",
                "source": "OpenStreetMap", "attribution": OSM_ATTR}
    if args.access_points_only:
        manifest_path = OUT / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest.update(accessPoints=access_descriptor())
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"Wrote {access_points['points']} access points, {access_points['bytes']:,} bytes")
        return
    if args.public_lands_only:
        manifest_path = OUT / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest.update(datasetVersion=time.strftime("%Y.%m.%d"), generatedAt=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        publicLands=public_lands,
                        collectingRules=collecting_rules_descriptor())
        if access_points:
            manifest.update(accessPoints=access_points)
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"Wrote {public_lands['properties']} named properties, {public_lands['bytes']:,} bytes")
        return

    def sample_tile(item: tuple[str, list]) -> tuple[str, list]:
        tile, pts = item
        pad_feats = pad_features_by_tile[tile]
        print(f"  tile {tile}: {len(pts)} cells, {len(pad_feats)} PAD-US polygons")
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
            return tile, list(ex.map(lambda p: sample(p, pad_feats), pts))

    results = []
    existing = sorted(OUT.glob("n*.parquet")) if OUT.exists() else []
    if args.reuse_existing and existing:
        con = duckdb.connect()
        table = con.execute("SELECT * FROM read_parquet(?)", [[str(p) for p in existing]])
        columns = [d[0] for d in table.description]
        old_rows = [dict(zip(columns, row)) for row in table.fetchall()]
        for row in old_rows:
            results.append((tile_of((row["lat"], row["lon"])), row))
        grouped = {}
        for tile, row in results:
            grouped.setdefault(tile, []).append(row)
        results = sorted(grouped.items())
        print(f"Reusing {len(old_rows)} existing authoritative sample cells")
    else:
        print(f"Sampling {len(points)} cells from authoritative services")
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as tex:
            for tile, rows in tex.map(sample_tile, sorted(tiles_points.items())):
                results.append((tile, rows))
    rows = [r for _, rs in results for r in rs]
    enrich_forest_groups(rows, args.source_cache, args.skip_forest_groups)
    con = duckdb.connect()
    tile_entries = []
    for tile, records in sorted(results):
        tmp = OUT / f".{tile}.json"
        tmp.write_text("\n".join(json.dumps(r, separators=(",", ":")) for r in records))
        hab_path = OUT / "habitat" / f"{tile}.parquet"

        def sql_path(p: Path) -> str:
            return "'" + str(p).replace("'", "''") + "'"

        con.execute(f"""COPY (
          SELECT * EXCLUDE (property_name, access_manager, forest_group, oak_hickory_signal, beech_maple_signal, elm_ash_cottonwood_signal),
            CAST(property_name AS VARCHAR) property_name,
            CAST(access_manager AS VARCHAR) access_manager,
            CAST(forest_group AS VARCHAR) forest_group,
            CAST(oak_hickory_signal AS DOUBLE) oak_hickory_signal,
            CAST(beech_maple_signal AS DOUBLE) beech_maple_signal,
            CAST(elm_ash_cottonwood_signal AS DOUBLE) elm_ash_cottonwood_signal
          FROM read_json_auto({sql_path(tmp)})
        ) TO {sql_path(hab_path)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 512)""")
        tmp.unlink()
        lats, lons = [r["lat"] for r in records], [r["lon"] for r in records]

        entry = {
            "id": tile,
            "bbox": [min(lons) - args.step/2, min(lats) - args.step/2,
                     max(lons) + args.step/2, max(lats) + args.step/2],
            "habitat": {
                "url": f"habitat/{tile}.parquet",
                "cells": len(records),
                "bytes": hab_path.stat().st_size,
                "sha256": hashlib.sha256(hab_path.read_bytes()).hexdigest()
            }
        }
        pl_path = OUT / "pl" / f"{tile}.parquet"
        if pl_path.exists():
            entry["publicLands"] = {
                "url": f"pl/{tile}.parquet",
                "properties": 0,
                "bytes": pl_path.stat().st_size,
                "sha256": hashlib.sha256(pl_path.read_bytes()).hexdigest()
            }
        ap_path = OUT / "ap" / f"{tile}.parquet"
        if ap_path.exists():
            entry["accessPoints"] = {
                "url": f"ap/{tile}.parquet",
                "points": 0,
                "bytes": ap_path.stat().st_size,
                "sha256": hashlib.sha256(ap_path.read_bytes()).hexdigest()
            }
        tile_entries.append(entry)
    # Read property/point counts from existing pl/ap parquets
    for entry in tile_entries:
        tid = entry["id"]
        if "publicLands" in entry:
            pl_path = OUT / "pl" / f"{tid}.parquet"
            try:
                df = con.execute(
                    f"SELECT count(*) as c FROM read_parquet({sql_path(pl_path)})"
                ).fetchone()
                entry["publicLands"]["properties"] = df[0] if df else 0
            except Exception:
                pass
        if "accessPoints" in entry:
            ap_path = OUT / "ap" / f"{tid}.parquet"
            try:
                df = con.execute(
                    f"SELECT count(*) as c FROM read_parquet({sql_path(ap_path)})"
                ).fetchone()
                entry["accessPoints"]["points"] = df[0] if df else 0
            except Exception:
                pass

    # Build manifest v3
    manifest = {
        "schemaVersion": 3,
        "datasetVersion": time.strftime("%Y.%m.%d"),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tiles": tile_entries,
        "sources": [
            {"id": "access", "provider": "OpenStreetMap", "dataset": "OSM access features", "url": "https://www.openstreetmap.org/copyright", "attribution": OSM_ATTR},
            {"id": "nlcd", "provider": "USGS/MRLC", "dataset": "Annual NLCD 2025 Land Cover", "resolutionM": 30, "url": "https://www.mrlc.gov/data-services-page"},
            {"id": "canopy", "provider": "USDA Forest Service / MRLC", "dataset": "Annual NLCD 2025 Tree Canopy Cover", "resolutionM": 30, "url": "https://www.mrlc.gov/data-services-page"},
            {"id": "forest_type", "provider": "USDA Forest Service FIA/GTAC", "dataset": "Forest Type Groups of the United States", "resolutionM": 250, "url": "https://data.fs.usda.gov/geodata/rastergateway/forest_type/"},
            {"id": "ssurgo", "provider": "USDA NRCS", "dataset": "SSURGO / Soil Data Access", "url": "https://sdmdataaccess.nrcs.usda.gov/"},
            {"id": "3dep", "provider": "USGS", "dataset": "3DEP Elevation Point Query Service", "url": "https://apps.nationalmap.gov/epqs/"},
            {"id": "padus", "provider": "USGS GAP (Esri-hosted Public Access edition)", "dataset": "PAD-US Protected Areas, public-access schema", "url": PADUS_INFO, "note": "Hosted service does not state its PAD-US edition; field schema follows the PAD-US 3.0 public-access model. Verify against the current PAD-US release before each rebuild."}
        ],
        "publicLands": public_lands if public_lands else None,
        "collectingRules": collecting_rules_descriptor(),
        "accessPoints": access_descriptor(),
        "tileSchema": {
            "stepDegrees": args.step,
            "tileDegrees": 1.0,
            "tileFormat": "parquet",
            "compression": "zstd",
            "subdirs": {
                "habitat": "habitat/",
                "publicLands": "pl/",
                "accessPoints": "ap/"
            },
            "datasetVersions": {
                "habitat": {"version": time.strftime("%Y.%m.%d")},
                "publicLands": {"version": time.strftime("%Y.%m.%d")},
                "accessPoints": {"version": time.strftime("%Y.%m.%d")}
            }
        }
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    total_bytes = sum(e["habitat"]["bytes"] for e in tile_entries)
    print(f"Wrote {len(tile_entries)} tiles, {total_bytes:,} bytes")


if __name__ == "__main__":
    main()
