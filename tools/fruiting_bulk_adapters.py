#!/usr/bin/env python3
"""Normalize pinned national/regional bulk source products into per-tile Parquet.

This is the *raw bulk* half of the publication boundary. Each adapter downloads a
pinned source product once into a source cache and then samples or clips that
local product for many tiles, so a bbox/regional build never re-downloads a giant
national product per tile.

Output is the normalized input contract consumed by tools/fruiting_tile_publish.py:
  <out>/<habitat|pl|ap|fire>/<tile>.parquet
  <out>/<habitat|pl|ap|fire>/<tile>.parquet.json
Each sidecar declares datasetVersion, sourceUrl and status
(AVAILABLE / PARTIAL / VERIFIED_EMPTY). A missing file is UNBUILT; a failed query
is FAILED. Empty data is never inferred.

Unit and identifier contracts (deliberate, documented in code):
  * habitat elevation_ft is FEET. The source DEM (3DEP) is METERS and is
    converted exactly once here. Open-Meteo elevation stays METERS and must never
    be written into elevation_ft.
  * Fruiting Forecast tile IDs name the SOUTH edge latitude and the WEST edge
    longitude (n40_w106 = lat 40..41, lon -106..-105). USGS 3DEP 1-degree
    GeoTIFFs are named by their NORTH edge latitude, so usgs_dem_tile_id()
    shifts the latitude by one degree (n40_w106 -> USGS n41w106).
  * A source class of 0 in the forest-type-group product means "no forest type
    group mapped at this cell" (the product publishes no non-forest class). It is
    written as forest=0 with forest_mapped=0 and is NOT missing data.
  * Cells outside a raster extent or mask are written as NULL, never as 0.
  * Missing optional evidence (canopy, soil, access) stays NULL and the habitat
    sidecar status is PARTIAL -- never 0 and never AVAILABLE.

Usage (preparation only; the app has no runtime backend):
  uv run --with rasterio --with duckdb --with requests tools/fruiting_bulk_adapters.py sources
  uv run --with rasterio --with duckdb --with requests tools/fruiting_bulk_adapters.py prepare --tile n40_w106 --cache /tmp/ffsrc
  uv run --with rasterio --with duckdb --with requests tools/fruiting_bulk_adapters.py build --tile n40_w106 --cache /tmp/ffsrc --out /tmp/ff-normalized
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
import urllib.request
from pathlib import Path

import duckdb
import requests

ROOT = Path(__file__).resolve().parents[1]
STEP_DEGREES = 0.05

# ─ Pinned sources ─────────────────────────────────────────────────────

FOREST_GROUP = {
    "id": "forest_type_groups",
    "provider": "USDA Forest Service FIA / Remote Sensing Applications Center",
    "dataset": "Forest Type Groups of the United States (conus_forestgroup)",
    "url": "https://data.fs.usda.gov/geodata/rastergateway/forest_type/conus_forestgroup.zip",
    "member": "conus_forestgroup.img",
    "sha256": "5ef0fa8212764e5337f4aeb94569cce144e5cb5a598314bb4f6ac23bf0f7dfbf",
    "archiveBytes": 168022806,
    "archiveModified": "2012-04-26",
    "groundCondition": "2004",
    "datasetVersion": "usfs-fia-foresttypegroup-v1",
    "crs": "EPSG:5069",
    "resolutionM": 250,
    "citation": "Ruefenacht, B.; Finco, M.V.; Nelson, M.D.; and others. 2008. Conterminous U.S. and Alaska forest type mapping using Forest Inventory and Analysis data. USDA Forest Service FIA/RSAC.",
    "caveat": "Broad national product; the producer recommends it not be displayed finer than 1:2,000,000 and reports 65% overall conterminous class accuracy for the 28 forest type groups.",
}

DEM_1ARC = {
    "id": "3dep_1arcsecond",
    "provider": "USGS 3D Elevation Program",
    "dataset": "National Elevation Dataset (NED) 1 arc-second (about 30 m) 1x1 degree GeoTIFF",
    "urlTemplate": "https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1/TIFF/historical/n{lat}w{lon:03d}/USGS_1_n{lat}w{lon:03d}_{release}.tif",
    "release": "20220216",
    "datasetVersion": "usgs-3dep-ned-1arc-20220216",
    "crs": "EPSG:4269",
    "units": "meters",
    "noDataValues": (-999999.0, -32768.0),
    "citation": "USGS 3DEP seamless 1 arc-second elevation, distributed as 1x1 degree tiles from The National Map.",
    "caveat": "Tile IDs in the USGS product name the NORTH edge latitude; Fruiting Forecast tiles name the south edge.",
}

MTBS = {
    "id": "mtbs",
    "provider": "USDA Forest Service / USGS Monitoring Trends in Burn Severity",
    "dataset": "MTBS Burned Area Boundaries (All Years)",
    "query": "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MTBS_01/MapServer/63/query",
    "layer": "EDW_MTBS_01/63 Burned Area Boundaries (All Years)",
    "outFields": "fire_id,fire_name,year,acres,map_id,perim_id,irwinid,dnbr_offst,dnbr_stddv,low_threshold,moderate_threshold,high_threshold",
    "citation": "MTBS maps the location, extent and severity of large fires (>= 1000 acres in the western U.S.) from the Landsat archive, 1984 onward.",
    "caveat": "MTBS maps large fires only. The absence of a perimeter does not mean no fire; missing burn evidence must never be scored as a negative biological signal. The polygon layer carries dNBR offset/thresholds per fire but no single per-fire severity class, so severity is written NULL.",
}

STATES = {
    "id": "us_census_states",
    "provider": "U.S. Census Bureau",
    "dataset": "Cartographic Boundary File, State, 1:20,000,000 (cb_2023_us_state_20m)",
    "url": "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip",
    "sha256": "0fd2d6562708ff8182c00d5d25b5556d049ecf2794d97b89ed2dac4d5e9e2c8d",
    "archiveBytes": 186432,
    "datasetVersion": "us-census-state-cb-2023-20m",
    "citation": "U.S. Census Bureau. 2023. Cartographic Boundary Files, state boundaries (1:20,000,000).",
    "caveat": ("PAD-US ST_Name is 'Not Applicable' for federal units, so it cannot supply jurisdiction. "
               "Jurisdiction is assigned here by point-in-polygon against the Census state boundaries and the "
               "raw PAD-US label is retained separately for audit."),
}

PADUS = {
    "id": "padus",
    "provider": "USGS GAP (Esri-hosted Public Access edition)",
    "dataset": "PAD-US Protected Areas, public-access schema",
    "query": "https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/PADUS_Public_Access/FeatureServer/0/query",
    "datasetVersion": "padus-public-access-hosted-2026",
    "caveat": "The hosted service does not state its PAD-US edition; it was not freshly audited in this pass. ST_Name supplies the authoritative state jurisdiction used for collecting-rule scoping.",
}
# Authoritative class legend from the product metadata (conus_forest_type_group_metadata.htm).
FOREST_GROUPS = {
    100: "white_red_jack_pine", 120: "spruce_fir", 140: "longleaf_slash_pine",
    160: "loblolly_shortleaf_pine", 180: "pinyon_juniper", 200: "douglas_fir",
    220: "ponderosa_pine", 240: "western_white_pine", 260: "fir_spruce_mountain_hemlock",
    280: "lodgepole_pine", 300: "hemlock_sitka_spruce", 320: "western_larch",
    340: "redwood", 360: "other_western_softwood", 370: "california_mixed_conifer",
    380: "exotic_softwoods", 400: "oak_pine", 500: "oak_hickory",
    600: "oak_gum_cypress", 700: "elm_ash_cottonwood", 800: "maple_beech_birch",
    900: "aspen_birch", 910: "alder_maple", 920: "western_oak", 940: "tanoak_laurel",
    950: "other_western_hardwoods", 980: "tropical_hardwoods", 990: "exotic_hardwoods",
}

# Signal columns written for every habitat cell. Keys are the habitat host keys the
# browser profile models use; a signal is 1.0 exactly when the mapped class matches.
FOREST_SIGNAL_CLASSES = {
    "oak_hickory_signal": (500,),
    "beech_maple_signal": (800,),
    "elm_ash_cottonwood_signal": (700,),
    "spruce_fir_signal": (120,),
    "fir_spruce_mountain_hemlock_signal": (260,),
    "lodgepole_pine_signal": (280,),
    "ponderosa_pine_signal": (220,),
    "douglas_fir_signal": (200,),
    "aspen_birch_signal": (900,),
}


def tile_lat(tile_id: str) -> int:
    return int(tile_id.split("_")[0][1:])


def tile_lon(tile_id: str) -> int:
    return -int(tile_id.split("_")[1][1:])


def tile_bbox(tile_id: str) -> list[float]:
    lat, lon = tile_lat(tile_id), tile_lon(tile_id)
    return [lon, lat, lon + 1, lat + 1]


def usgs_dem_tile_id(tile_id: str) -> str:
    """Convert a Fruiting Forecast tile ID (south edge) to the USGS NED name (north edge)."""
    return f"n{tile_lat(tile_id) + 1:02d}w{abs(tile_lon(tile_id)):03d}"


def dem_tile_url(tile_id: str, release: str | None = None) -> str:
    return DEM_1ARC["urlTemplate"].format(lat=f"{tile_lat(tile_id) + 1:02d}",
                                          lon=abs(tile_lon(tile_id)),
                                          release=release or DEM_1ARC["release"])


def sample_points(tile_id: str, step: float = STEP_DEGREES) -> list[tuple[float, float]]:
    """Cell centers on the repository 0.05-degree grid, identical to the legacy grid."""
    west, south, east, north = tile_bbox(tile_id)
    points = []
    lat = south + step / 2
    while lat < north:
        lon = west + step / 2
        while lon < east:
            points.append((round(lat, 5), round(lon, 5)))
            lon += step
        lat += step
    return points


def forest_group_record(code: int | None) -> dict:
    """Map a raw forest-type-group class value to row fields. None stays missing."""
    if code is None:
        row = {"forest_type_code": None, "forest_group": None, "forest": None, "forest_mapped": None}
        row.update({column: None for column in FOREST_SIGNAL_CLASSES})
        return row
    name = FOREST_GROUPS.get(code)
    known = name is not None or code == 0
    row = {"forest_type_code": code, "forest_group": name,
           "forest": (0.0 if code == 0 else 1.0) if known else None,
           "forest_mapped": (0.0 if code == 0 else 1.0) if known else None}
    for column, classes in FOREST_SIGNAL_CLASSES.items():
        row[column] = (1.0 if code in classes else 0.0) if known else None
    return row


# ─ Normalized output helpers ──────────────────────────────────────────

HABITAT_COLUMNS = [
    ("cell_id", "VARCHAR"), ("lat", "DOUBLE"), ("lon", "DOUBLE"), ("land_class", "VARCHAR"),
    ("forest", "DOUBLE"), ("forest_mapped", "DOUBLE"), ("deciduous", "DOUBLE"), ("open_land", "DOUBLE"),
    ("canopy", "DOUBLE"), ("elevation_ft", "DOUBLE"), ("drainage_class", "VARCHAR"),
    ("awc_25_cm", "DOUBLE"), ("awc_50_cm", "DOUBLE"), ("flood_frequency", "VARCHAR"),
    ("hydrologic_group", "VARCHAR"), ("slope_deg", "DOUBLE"), ("access_class", "VARCHAR"),
    ("access_category", "VARCHAR"), ("property_name", "VARCHAR"), ("access_manager", "VARCHAR"),
    ("forest_group", "VARCHAR"), ("forest_type_code", "INTEGER"),
] + [(column, "DOUBLE") for column in FOREST_SIGNAL_CLASSES]

FIRE_COLUMNS = [
    ("perimeter_id", "VARCHAR"), ("fire_name", "VARCHAR"), ("fire_year", "INTEGER"),
    ("acres", "DOUBLE"), ("severity", "VARCHAR"), ("geometry_json", "VARCHAR"),
    ("min_lon", "DOUBLE"), ("min_lat", "DOUBLE"), ("max_lon", "DOUBLE"), ("max_lat", "DOUBLE"),
    ("center_lat", "DOUBLE"), ("center_lon", "DOUBLE"), ("source_id", "VARCHAR"),
    ("source_url", "VARCHAR"), ("retrieved_at", "VARCHAR"),
]

PUBLIC_LAND_COLUMNS = [
    ("property_id", "VARCHAR"), ("property_name", "VARCHAR"), ("manager", "VARCHAR"),
    ("property_type", "VARCHAR"), ("ownership_class", "VARCHAR"), ("access_class", "VARCHAR"),
    ("state_name", "VARCHAR"), ("state_code", "VARCHAR"), ("source_state_label", "VARCHAR"),
    ("jurisdiction_source", "VARCHAR"), ("geometry_json", "VARCHAR"),
    ("min_lon", "DOUBLE"), ("min_lat", "DOUBLE"), ("max_lon", "DOUBLE"), ("max_lat", "DOUBLE"),
    ("center_lat", "DOUBLE"), ("center_lon", "DOUBLE"), ("geometry_source", "VARCHAR"), ("source_url", "VARCHAR"),
]


def write_parquet(path: Path, rows: list[dict], columns: list[tuple[str, str]], meta: dict) -> None:
    """Deterministic Parquet + provenance sidecar. Explicit types avoid JSON inference drift."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp.parquet")
    con = duckdb.connect()
    try:
        con.execute("CREATE TABLE tile(" + ", ".join(f'"{name}" {kind}' for name, kind in columns) + ")")
        names = [name for name, _ in columns]
        if rows:
            con.executemany("INSERT INTO tile VALUES (" + ",".join("?" * len(names)) + ")",
                            [tuple(row.get(name) for name in names) for row in rows])
        con.execute("COPY tile TO ? (FORMAT PARQUET, COMPRESSION ZSTD, ROW_GROUP_SIZE 512)", [str(tmp)])
    finally:
        con.close()
    tmp.replace(path)
    path.with_suffix(".parquet.json").write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n")


# ─ Source cache preparation ───────────────────────────────────────────


def _download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_suffix(destination.suffix + ".part")
    print(f"Downloading {url}")
    with urllib.request.urlopen(url, timeout=900) as response, open(tmp, "wb") as handle:
        while chunk := response.read(1 << 20):
            handle.write(chunk)
    tmp.replace(destination)


def _raster_paths(cache: Path, tile_id: str) -> tuple[Path, Path]:
    return cache / "conus_forestgroup.zip", cache / f"dem_{usgs_dem_tile_id(tile_id)}.tif"


def prepare(cache: Path, tile_id: str, forest: bool = True, dem: bool = True) -> dict:
    """Download pinned sources once. Existing files are reused (restartable, no re-download)."""
    cache.mkdir(parents=True, exist_ok=True)
    prepared = {}
    if forest:
        archive = _raster_paths(cache, tile_id)[0]
        if not archive.exists():
            _download(FOREST_GROUP["url"], archive)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        prepared["forestTypeGroups"] = {"path": str(archive), "bytes": archive.stat().st_size,
                                        "sha256": digest, "sha256Matches": digest == FOREST_GROUP["sha256"]}
    if dem:
        target = _raster_paths(cache, tile_id)[1]
        url = dem_tile_url(tile_id)
        if not target.exists():
            _download(url, target)
        prepared["elevation"] = {"path": str(target), "bytes": target.stat().st_size, "sourceUrl": url}
    return prepared


def meters_to_feet(value: float | None) -> float | None:
    """3DEP is meters; habitat elevation_ft is feet. Single explicit conversion point."""
    return None if value is None else round(value * 3.28084, 2)


def _sample_raster(source, transform_to, points: list[tuple[float, float]]) -> list[float | None]:
    """Sample a raster at WGS84 points. Out-of-mask cells return None, never 0."""
    xs, ys = transform_to("EPSG:4326", source.crs, [p[1] for p in points], [p[0] for p in points])
    nodata = source.nodata
    values: list[float | None] = []
    for sample in source.sample(zip(xs, ys)):
        value: float | None = float(sample[0])
        if nodata is not None and abs(value - nodata) < 1e-6:
            value = None
        else:
            for candidate in DEM_1ARC["noDataValues"]:
                if abs(value - candidate) < 1e-6:
                    value = None
                    break
        values.append(value)
    return values


def build_habitat(tile_id: str, cache: Path, out: Path, step: float = STEP_DEGREES) -> dict:
    """Sample the pinned forest-type-group and 3DEP rasters onto the 0.05-degree grid."""
    import zipfile

    import rasterio
    from rasterio.warp import transform as warp_transform

    points = sample_points(tile_id, step)
    archive, dem_path = _raster_paths(cache, tile_id)
    if not archive.exists():
        raise SystemExit(f"Missing pinned forest-type-group archive: {archive} (run prepare first)")
    if not dem_path.exists():
        raise SystemExit(f"Missing pinned 3DEP DEM tile: {dem_path} (run prepare first)")
    extracted = cache / f"forestgroup_{FOREST_GROUP['sha256'][:8]}"
    image = extracted / FOREST_GROUP["member"]
    if not image.exists():
        with zipfile.ZipFile(archive) as bundle:
            bundle.extract(FOREST_GROUP["member"], extracted)

    with rasterio.open(image) as groups:
        codes = _sample_raster(groups, warp_transform, points)
    with rasterio.open(dem_path) as dem:
        elevations_m = _sample_raster(dem, warp_transform, points)

    rows = []
    for (lat, lon), code, elevation_m in zip(points, codes, elevations_m):
        record = forest_group_record(None if code is None else int(code))
        group_name = record["forest_group"]
        rows.append({
            "cell_id": f"{lat:.3f}_{lon:.3f}", "lat": lat, "lon": lon,
            # land_class mirrors the only mapped vegetation label available in this proof.
            "land_class": group_name or ("not_forest_mapped" if code is not None else None),
            "forest": record["forest"], "forest_mapped": record["forest_mapped"],
            "deciduous": None, "open_land": None, "canopy": None,
            "elevation_ft": meters_to_feet(elevation_m),
            "drainage_class": None, "awc_25_cm": None, "awc_50_cm": None,
            "flood_frequency": None, "hydrologic_group": None, "slope_deg": None,
            "access_class": None, "access_category": None, "property_name": None, "access_manager": None,
            "forest_group": group_name, "forest_type_code": record["forest_type_code"],
            **{key: record[key] for key in FOREST_SIGNAL_CLASSES},
        })
    meta = {
        "datasetVersion": f"habitat-bulk-v1:{FOREST_GROUP['datasetVersion']}+{DEM_1ARC['datasetVersion']}@step{step}",
        "sourceUrl": FOREST_GROUP["url"],
        "status": "PARTIAL",
        "statusNote": ("Mapped forest-type-group class and 3DEP elevation only. Canopy, soil and access "
                       "evidence are absent in this tile (null, not zero) and remain UNBUILT."),
        "sources": [
            {"id": FOREST_GROUP["id"], "provider": FOREST_GROUP["provider"], "dataset": FOREST_GROUP["dataset"],
             "sha256": FOREST_GROUP["sha256"], "crs": FOREST_GROUP["crs"],
             "resolutionM": FOREST_GROUP["resolutionM"], "citation": FOREST_GROUP["citation"],
             "caveat": FOREST_GROUP["caveat"]},
            {"id": DEM_1ARC["id"], "provider": DEM_1ARC["provider"], "dataset": DEM_1ARC["dataset"],
             "sourceUrl": dem_tile_url(tile_id), "crs": DEM_1ARC["crs"], "units": "meters",
             "citation": DEM_1ARC["citation"], "caveat": DEM_1ARC["caveat"]},
        ],
        "units": {"elevation_ft": "feet", "sourceElevation": "meters"},
        "unbuilt": ["canopy", "soil", "access", "nlcdLandCover"],
        "cellStepDegrees": step,
    }
    write_parquet(out / "habitat" / f"{tile_id}.parquet", rows, HABITAT_COLUMNS, meta)
    return {**meta, "cells": len(rows), "tile": tile_id}
def _esri_geojson(query: str, params: dict, cache: Path, cache_key: str, timeout: int = 120) -> list[dict]:
    """One authoritative vector query, cached per tile. No per-point service calls."""
    cached = cache / f"{cache_key}.geojson.json"
    if cached.exists():
        return json.loads(cached.read_text())
    page = int(params.pop("resultRecordCount", 2000))
    features, offset = [], 0
    while True:
        payload = {**params, "f": "geojson", "outSR": 4326,
                   "resultRecordCount": page, "resultOffset": offset}
        response = requests.get(query, params=payload, timeout=timeout)
        response.raise_for_status()
        body = response.json()
        if body.get("error"):
            raise ValueError(f"Source query failed: {body['error']}")
        batch = body.get("features") or []
        features.extend(batch)
        if len(batch) < page:
            break
        offset += page
    cache.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(features))
    return features


def esri_envelope(box: list[float]) -> str:
    """ArcGIS expects an envelope as a JSON object; a raw comma string is silently ignored."""
    west, south, east, north = box
    return json.dumps({"xmin": west, "ymin": south, "xmax": east, "ymax": north})


def clip_to_tile(features: list[dict], tile_id: str, tolerance: float = 1e-6) -> list[dict]:
    """Defensive local clip.

    A service-side envelope filter is not a guarantee: an ignored or misread envelope
    would otherwise publish nationwide records inside one tile. Every adapter clips
    the returned geometry to the tile locally.
    """
    west, south, east, north = tile_bbox(tile_id)
    kept = []
    for feature in features:
        bounds = _geometry_bounds(feature.get("geometry") or {})
        if not bounds:
            continue
        if (bounds[0] <= east + tolerance and bounds[2] >= west - tolerance
                and bounds[1] <= north + tolerance and bounds[3] >= south - tolerance):
            kept.append(feature)
    return kept


def _geometry_bounds(geometry: dict) -> tuple[float, float, float, float] | None:
    coordinates = geometry.get("coordinates")
    kind = geometry.get("type")
    if not coordinates or kind not in {"Polygon", "MultiPolygon"}:
        return None
    rings = [coordinates] if kind == "Polygon" else coordinates
    points = [point for polygon in rings for ring in polygon for point in ring]
    if not points:
        return None
    return (min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points))


def build_fire(tile_id: str, cache: Path, out: Path, min_year: int = 1984, timeout: int = 180) -> dict:
    """Clip the pinned MTBS burned-area service to one tile. Severity stays null (see MTBS['caveat'])."""
    west, south, east, north = tile_bbox(tile_id)
    features = clip_to_tile(_esri_geojson(MTBS["query"], {
        "where": f"YEAR >= {min_year}",
        "geometry": esri_envelope(tile_bbox(tile_id)),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": MTBS["outFields"],
        "returnGeometry": "true",
        "resultRecordCount": 2000,
    }, cache, f"mtbs_{tile_id}", timeout), tile_id)
    retrieved = time.strftime("%Y-%m-%d")
    rows = []
    for feature in features:
        attributes = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        bounds = _geometry_bounds(geometry)
        if not bounds or not attributes.get("fire_id"):
            continue
        rows.append({
            "perimeter_id": str(attributes.get("fire_id")),
            "fire_name": attributes.get("fire_name"),
            "fire_year": attributes.get("year"),
            "acres": attributes.get("acres"),
            # MTBS publishes per-fire dNBR offset/thresholds, not a single severity class.
            "severity": None,
            "geometry_json": json.dumps(_round_geometry(geometry), separators=(",", ":")),
            "min_lon": round(bounds[0], 5), "min_lat": round(bounds[1], 5),
            "max_lon": round(bounds[2], 5), "max_lat": round(bounds[3], 5),
            "center_lat": (bounds[1] + bounds[3]) / 2, "center_lon": (bounds[0] + bounds[2]) / 2,
            "source_id": "MTBS",
            "source_url": f"https://www.mtbs.gov/viewer/index.html?fireID={attributes.get('fire_id')}",
            "retrieved_at": retrieved,
        })
    rows.sort(key=lambda row: (row["fire_year"] or 0, row["perimeter_id"]))
    meta = {
        "datasetVersion": f"mtbs-burned-area-{retrieved}",
        "sourceUrl": MTBS["query"],
        "status": "AVAILABLE" if rows else "VERIFIED_EMPTY",
        "statusNote": ("MTBS burned-area boundaries intersecting this tile. Large fires only; the absence of a "
                       "perimeter is not evidence that no fire occurred. Severity is not published per perimeter."),
        "source": {"id": MTBS["id"], "provider": MTBS["provider"], "dataset": MTBS["dataset"],
                   "layer": MTBS["layer"], "citation": MTBS["citation"], "caveat": MTBS["caveat"]},
        "minYear": min_year,
    }
    write_parquet(out / "fire" / f"{tile_id}.parquet", rows, FIRE_COLUMNS, meta)
    return {**meta, "perimeters": len(rows), "tile": tile_id}
def _round_geometry(geometry: dict, digits: int = 5) -> dict:
    """Deterministic coordinate rounding (~1 m at 5 decimals) keeps published geometry compact."""
    def walk(value):
        if isinstance(value, float):
            return round(value, digits)
        if isinstance(value, list):
            return [walk(item) for item in value]
        if isinstance(value, dict):
            return {key: walk(item) for key, item in value.items()}
        return value
    return walk(geometry)


def _state_lookup(cache: Path):
    """Prepared Census state polygons for authoritative jurisdiction by point."""
    import shapefile
    import zipfile

    from shapely.geometry import Point, shape
    from shapely.prepared import prep

    archive = cache / "cb_2023_us_state_20m.zip"
    if not archive.exists():
        _download(STATES["url"], archive)
    with zipfile.ZipFile(archive) as bundle:
        reader = shapefile.Reader(shp=bundle.open("cb_2023_us_state_20m.shp"),
                                  shx=bundle.open("cb_2023_us_state_20m.shx"),
                                  dbf=bundle.open("cb_2023_us_state_20m.dbf"), encoding="latin1")
        entries = []
        for record in reader.iterShapeRecords():
            fields = record.record.as_dict()
            geom = shape(record.shape.__geo_interface__)
            entries.append((fields["STUSPS"], fields["NAME"], prep(geom), geom.bounds))
    return lambda lon, lat: next(((code, name) for code, name, prepared, bounds in entries
                                  if bounds[0] <= lon <= bounds[2] and bounds[1] <= lat <= bounds[3]
                                  and prepared.contains(Point(lon, lat))), (None, None))


def pad_property_type(name: str, manager: str) -> str:
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


def build_public_land(tile_id: str, cache: Path, out: Path, timeout: int = 240) -> dict:
    """Clip the pinned PAD-US public-access service to one tile, retaining state jurisdiction."""
    west, south, east, north = tile_bbox(tile_id)
    features = clip_to_tile(_esri_geojson(PADUS["query"], {
        "where": "1=1",
        "geometry": esri_envelope(tile_bbox(tile_id)),
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "Pub_Access,BndryName,Unit_Nm,MngNm_Desc,Category,ST_Name",
        "returnGeometry": "true",
        "maxAllowableOffset": 0.00025,
        "resultRecordCount": 2000,
    }, cache, f"padus_{tile_id}", timeout), tile_id)
    resolve_state = _state_lookup(cache)
    from shapely.geometry import box as shapely_box, mapping as shapely_mapping, shape as shapely_shape
    from shapely.validation import make_valid

    tile_shape = shapely_box(*tile_bbox(tile_id))
    grouped: dict[tuple, dict] = {}
    for feature in features:
        attributes = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        name = (attributes.get("Unit_Nm") or attributes.get("BndryName") or "").strip()
        manager = (attributes.get("MngNm_Desc") or "Unknown manager").strip()
        access = {"OA": "PUBLIC", "RA": "LIKELY_PUBLIC", "XA": "RESTRICTED_VERIFY"}.get(attributes.get("Pub_Access"))
        if not name or not access or not geometry:
            continue
        # The hosted service simplifies aggressively, which produces invalid rings; and
        # some records aggregate same-named units across the conterminous U.S. Clipping
        # to the tile is what makes this a tile-local, jurisdiction-scoped asset.
        clipped = make_valid(shapely_shape(geometry)).intersection(tile_shape)
        if clipped.is_empty:
            continue
        record = grouped.setdefault((name, manager), {"geometries": [], "access": set()})
        record["geometries"].append(clipped)
        record["access"].add(access)
    rows = []
    for (name, manager), record in sorted(grouped.items(), key=lambda item: item[0][0]):
        merged = record["geometries"][0]
        for extra in record["geometries"][1:]:
            merged = merged.union(extra)
        bounds = tuple(round(value, 5) for value in make_valid(merged).bounds)
        representative = make_valid(merged).representative_point()
        access = next(iter(record["access"])) if len(record["access"]) == 1 else "MIXED"
        state_code, state_name = resolve_state(representative.x, representative.y)
        rows.append({
            "property_id": hashlib.sha1(f"{name}|{manager}".encode()).hexdigest()[:16],
            "property_name": name, "manager": manager,
            "property_type": pad_property_type(name, manager),
            "ownership_class": "PRIVATE" if "private" in manager.lower() else access,
            "access_class": access, "state_name": state_name, "state_code": state_code,
            "jurisdiction_source": STATES["datasetVersion"] if state_code else None,
            "geometry_json": json.dumps(_round_geometry(shapely_mapping(make_valid(merged))), separators=(",", ":")),
            "min_lon": bounds[0], "min_lat": bounds[1],
            "max_lon": bounds[2], "max_lat": bounds[3],
            "center_lat": round((bounds[1] + bounds[3]) / 2, 5), "center_lon": round((bounds[0] + bounds[2]) / 2, 5),
            "geometry_source": "PAD-US (public access schema, hosted service)",
            "source_url": "https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-download",
        })
    rows = [row for row in rows if row["state_code"]]
    meta = {
        "datasetVersion": f"{PADUS['datasetVersion']}+{STATES['datasetVersion']}",
        "sourceUrl": PADUS["query"],
        "status": "AVAILABLE" if rows else "VERIFIED_EMPTY",
        "statusNote": ("PAD-US public-access polygons intersecting this tile, clipped to the tile and each assigned "
                       "an authoritative state jurisdiction by point-in-polygon. PAD-US ST_Name is discarded as "
                       "jurisdiction because it reads 'Not Applicable' for federal units. Same-named units are "
                       "grouped, so two different parks sharing a name inside one tile are merged. Rows without a "
                       "resolved state are dropped: an unknown jurisdiction must not inherit any state-scoped rule."),
        "source": [{"id": PADUS["id"], "provider": PADUS["provider"], "dataset": PADUS["dataset"],
                    "caveat": PADUS["caveat"]},
                   {"id": STATES["id"], "provider": STATES["provider"], "dataset": STATES["dataset"],
                    "sha256": STATES["sha256"], "citation": STATES["citation"], "caveat": STATES["caveat"]}],
    }
    write_parquet(out / "pl" / f"{tile_id}.parquet", rows, PUBLIC_LAND_COLUMNS, meta)
    return {**meta, "properties": len(rows), "tile": tile_id}
# ─ CLI ────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("sources", help="Print the pinned source registry")
    prepare_parser = sub.add_parser("prepare", help="Download pinned sources into the local cache once")
    build_parser = sub.add_parser("build", help="Normalize a tile from the local source cache")
    for target in (prepare_parser, build_parser):
        target.add_argument("--tile", required=True, help="Fruiting Forecast tile ID, e.g. n40_w106")
        target.add_argument("--cache", type=Path, default=Path("/tmp/fruiting-forecast-gis-sources"))
    prepare_parser.add_argument("--skip-forest", action="store_true")
    prepare_parser.add_argument("--skip-dem", action="store_true")
    build_parser.add_argument("--out", type=Path, default=Path("/tmp/fruiting-forecast-normalized"))
    build_parser.add_argument("--layers", default="habitat,public-land,fire",
                              help="Comma-separated subset of habitat,public-land,fire")
    build_parser.add_argument("--step", type=float, default=STEP_DEGREES)
    args = parser.parse_args()

    if args.command == "sources":
        print(json.dumps({"forestTypeGroups": FOREST_GROUP, "elevation": DEM_1ARC, "fire": MTBS,
                          "publicLand": PADUS}, indent=2))
        return
    if args.command == "prepare":
        print(json.dumps(prepare(args.cache, args.tile, not args.skip_forest, not args.skip_dem), indent=2))
        return

    builders = {"habitat": lambda: build_habitat(args.tile, args.cache, args.out, args.step),
                "public-land": lambda: build_public_land(args.tile, args.cache, args.out),
                "fire": lambda: build_fire(args.tile, args.cache, args.out)}
    for layer in [name.strip() for name in args.layers.split(",") if name.strip()]:
        if layer not in builders:
            raise SystemExit(f"Unknown layer: {layer}")
        result = builders[layer]()
        rows = result.get("cells") or result.get("properties") or result.get("perimeters") or 0
        print(f"{layer}: {result['status']} · {rows} rows · {result['datasetVersion']}")


if __name__ == "__main__":
    main()