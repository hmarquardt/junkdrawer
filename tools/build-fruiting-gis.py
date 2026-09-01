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

LAND = {41: "deciduous", 42: "evergreen", 43: "mixed", 52: "shrub", 71: "grass", 81: "pasture", 82: "crops", 90: "woody_wetland", 95: "wetland"}
FOREST = {41, 42, 43, 90}


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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bbox", default="-89.25,37.50,-85.25,39.25", help="west,south,east,north")
    ap.add_argument("--step", type=float, default=0.05)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--source-cache", type=Path, default=Path("/tmp/fruiting-forecast-gis-sources"))
    ap.add_argument("--skip-forest-groups", action="store_true")
    ap.add_argument("--reuse-existing", action="store_true", help="Reuse checked-in cells and refresh derived forest groups/manifest")
    args = ap.parse_args()
    west, south, east, north = map(float, args.bbox.split(","))
    points = []
    lat = south + args.step / 2
    while lat < north:
        lon = west + args.step / 2
        while lon < east:
            points.append((round(lat, 5), round(lon, 5)))
            lon += args.step
        lat += args.step
    pad_cache = args.source_cache

    def tile_of(p: tuple[float, float]) -> str:
        return f"n{math.floor(p[0]):02d}_w{abs(math.floor(p[1])):03d}"

    tiles_points: dict[str, list] = {}
    for p in points:
        tiles_points.setdefault(tile_of(p), []).append(p)

    def sample_tile(item: tuple[str, list]) -> tuple[str, list]:
        tile, pts = item
        pad_feats = pad_tile_features((math.floor(min(x[1] for x in pts)) - 0.25, math.floor(min(x[0] for x in pts)) - 0.25,
                                       math.ceil(max(x[1] for x in pts)) + 0.25, math.ceil(max(x[0] for x in pts)) + 0.25), pad_cache)
        print(f"  tile {tile}: {len(pts)} cells, {len(pad_feats)} PAD-US polygons")
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
            return tile, list(ex.map(lambda p: sample(p, pad_feats), pts))

    results = []
    existing = sorted(OUT.glob("*.parquet")) if OUT.exists() else []
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
    OUT.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    tiles = []
    for tile, records in sorted(results):
        tmp = OUT / f".{tile}.json"
        tmp.write_text("\n".join(json.dumps(r, separators=(",", ":")) for r in records))
        path = OUT / f"{tile}.parquet"
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
        ) TO {sql_path(path)} (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 512)""")
        tmp.unlink()
        lats, lons = [r["lat"] for r in records], [r["lon"] for r in records]
        tiles.append({"id": tile, "url": path.name, "bbox": [min(lons)-args.step/2, min(lats)-args.step/2, max(lons)+args.step/2, max(lats)+args.step/2],
                      "cells": len(records), "bytes": path.stat().st_size, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    manifest = {"schemaVersion": 1, "datasetVersion": time.strftime("%Y.%m.%d"), "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "coverage": {"bbox": [west, south, east, north], "region": "Southern Indiana and adjacent Midwest", "cellStepDegrees": args.step},
                "tiles": tiles, "sources": [
                    {"id": "nlcd", "provider": "USGS/MRLC", "dataset": "Annual NLCD 2025 Land Cover", "resolutionM": 30, "url": "https://www.mrlc.gov/data-services-page"},
                    {"id": "canopy", "provider": "USDA Forest Service / MRLC", "dataset": "Annual NLCD 2025 Tree Canopy Cover", "resolutionM": 30, "url": "https://www.mrlc.gov/data-services-page"},
                    {"id": "forest_type", "provider": "USDA Forest Service FIA/GTAC", "dataset": "Forest Type Groups of the United States", "resolutionM": 250, "url": "https://data.fs.usda.gov/geodata/rastergateway/forest_type/"},
                    {"id": "ssurgo", "provider": "USDA NRCS", "dataset": "SSURGO / Soil Data Access", "url": "https://sdmdataaccess.nrcs.usda.gov/"},
                    {"id": "3dep", "provider": "USGS", "dataset": "3DEP Elevation Point Query Service", "url": "https://apps.nationalmap.gov/epqs/"},
                    {"id": "padus", "provider": "USGS GAP (Esri-hosted Public Access edition)", "dataset": "PAD-US Protected Areas, public-access schema", "url": "https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-download", "note": "Hosted service does not state its PAD-US edition; field schema follows the PAD-US 3.0 public-access model. Verify against the current PAD-US release before each rebuild."}]}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Wrote {len(tiles)} tiles, {sum(t['bytes'] for t in tiles):,} bytes")


if __name__ == "__main__":
    main()
