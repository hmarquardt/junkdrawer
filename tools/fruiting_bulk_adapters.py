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
  * Canopy is stored as a 0..1 fraction in the `canopy` column. The pinned source
    product publishes 0..100 percent, so the conversion happens here once.
  * Land cover is a point-sampled categorical class (`land_class`) plus explicit
    derived cover signals (`forest`, `deciduous`, `open_land`, `evergreen`,
    `mixed_forest`, `wetland`). The adapter does not invent biology: it exposes
    the mapped product classes and the documented derivation, and regional
    species models decide how to weight them.

Source preparation scopes are explicit because a national product must never be
re-downloaded per tile:
  * national products (forest type groups, NLCD land cover, NLCD tree canopy,
    Census states): `prepare national`
  * state/regional products (SSURGO/gSSURGO/gNATSGO soil): `prepare state --state CO`
  * tile products (a 3DEP 1x1 degree DEM): `prepare tile --tile n40_w106`

Soil has one normalized contract regardless of upstream packaging. The default
source in 2026 is the authoritative NRCS Soil Data Access (SSURGO) tabular
service: one query per state for the mapunit attribute table and one batched
point-to-MUKEY query per tile. A gSSURGO or gNATSGO state package can be
substituted with `prepare state --source gssurgo|gnatsgo`; the habitat build
consumes the same normalized rows either way.

Usage (preparation only; the app has no runtime backend):
  uv run --with rasterio --with duckdb --with requests tools/fruiting_bulk_adapters.py sources
  uv run --with rasterio --with duckdb --with requests tools/fruiting_bulk_adapters.py prepare national --sources forest-type,land-cover,canopy --cache /tmp/ffsrc
  uv run --with rasterio --with duckdb --with requests tools/fruiting_bulk_adapters.py prepare state --state CO --cache /tmp/ffsrc
  uv run --with rasterio --with duckdb --with requests tools/fruiting_bulk_adapters.py prepare tile --tile n40_w106 --cache /tmp/ffsrc
  uv run --with rasterio --with duckdb --with requests tools/fruiting_bulk_adapters.py build --tile n40_w106 --soil-states CO --cache /tmp/ffsrc --out /tmp/ff-normalized
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ElementTree
import zipfile
from pathlib import Path

import duckdb
import requests

def service_request(method, url, **kwargs):
    """Bounded serial retries for transient hosted-service failures."""
    import random
    from email.utils import parsedate_to_datetime
    from fruiting_metrics import emit
    start = time.monotonic()
    for attempt in range(5):
        response = None
        try:
            response = getattr(requests, method)(url, **kwargs)
            if response.status_code not in {408, 429, 500, 502, 503, 504}:
                emit('service', url=url, seconds=time.monotonic()-start, retries=attempt, status=response.status_code)
                return response
            response.raise_for_status()
        except requests.RequestException:
            status = response.status_code if response is not None else 0
            emit('service-retry', url=url, attempt=attempt+1, status=status)
            if attempt == 4: raise
            after = response.headers.get('Retry-After', '') if response is not None else ''
            try: delay = float(after)
            except ValueError:
                try: delay = max(0, parsedate_to_datetime(after).timestamp()-time.time())
                except (ValueError, TypeError): delay = 0
            time.sleep(max(delay, 2**(attempt+1)+random.random()))
    raise RuntimeError('Service retries exhausted')


ROOT = Path(__file__).resolve().parents[1]
STEP_DEGREES = 0.05
CACHE_MANIFEST = "source-manifest.json"

# ─ Pinned sources ─────────────────────────────────────────────────────

FOREST_GROUP = {
    "id": "forest_type_groups",
    "scope": "national",
    "provider": "USDA Forest Service FIA / Remote Sensing Applications Center",
    "dataset": "Forest Type Groups of the United States (conus_forestgroup)",
    "url": "https://data.fs.usda.gov/geodata/rastergateway/forest_type/conus_forestgroup.zip",
    "archiveName": "conus_forestgroup.zip",
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
    "scope": "tile",
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

# Annual NLCD Land Cover (CONUS), Collection 1 Version 2, year 2023. The archive
# is cached once and point-sampled for every tile; the full 16-class legend is the
# authoritative product legend (GDAL raster attribute table in the .aux.xml).
NLCD_LANDCOVER = {
    "id": "nlcd_land_cover",
    "scope": "national",
    "provider": "USGS / MRLC (Multi-Resolution Land Characteristics Consortium)",
    "dataset": "Annual NLCD Land Cover, CONUS, 2023, Collection 1 Version 2",
    "productPage": "https://www.mrlc.gov/data/nlcd-2023-land-cover-conus",
    "url": "https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/Annual_NLCD_LndCov_2023_CU_C1V2.zip",
    "archiveName": "Annual_NLCD_LndCov_2023_CU_C1V2.zip",
    "cacheAliases": ["nlcd_landcover_2023.zip"],
    "member": "Annual_NLCD_LndCov_2023_CU_C1V2.tif",
    "sha256": "da50297bc65c07a8210999d20e2b59e69a8d1470273e1ed9344884988fd47aaf",
    "archiveBytes": 1427423034,
    "datasetVersion": "annual-nlcd-lndcov-2023-c1v2",
    "crs": "CONUS Albers Equal Area (EPSG:5070 parameters; file proj string 'AEA WGS84')",
    "resolutionM": 30,
    "units": "categorical class code (see legend)",
    "noDataValues": (250,),
    "legend": {
        11: "open_water", 12: "perennial_ice_snow",
        21: "developed_open_space", 22: "developed_low_intensity",
        23: "developed_medium_intensity", 24: "developed_high_intensity",
        31: "barren_land", 41: "deciduous_forest", 42: "evergreen_forest",
        43: "mixed_forest", 52: "shrub_scrub", 71: "grassland_herbaceous",
        81: "pasture_hay", 82: "cultivated_crops", 90: "woody_wetlands",
        95: "emergent_herbaceous_wetlands",
    },
    "citation": "U.S. Geological Survey, 2025, Annual NLCD (National Land Cover Database) Collection 1 Version 2 land cover, 2023.",
    "caveat": ("Categorical 30 m product. Land cover is point-sampled at the 0.05-degree cell center, so a cell "
               "represents the class at its center, not a fraction of its area; cell means across a zone are the "
               "proportion of sampled centers in each class. The derived cover signals use the same class mapping "
               "as the legacy NLCD sampler so eastern and western semantics stay identical."),
    "urlCaveat": ("MRLC hosts products behind dated links that move between releases. The pinned archive name, byte "
                  "count and SHA256 are authoritative here; an operator may place a byte-identical archive in the "
                  "cache (or refresh the URL from productPage) when the hosted link changes."),
}

# NLCD Tree Canopy Cover (CONUS) v2021-4. This is the current NLCD TCC release
# distributed by MRLC/USGS alongside the Annual NLCD land cover product. The
# 2021 vintage is deliberate: it is the pinned product this repository cached and
# measured. Canopy and land cover are separate environmental signals.
NLCD_TCC = {
    "id": "nlcd_tree_canopy",
    "scope": "national",
    "provider": "USDA Forest Service / USGS MRLC",
    "dataset": "NLCD Tree Canopy Cover (CONUS), v2021-4",
    "productPage": "https://www.mrlc.gov/data/nlcd-2021-tree-canopy-cover-conus",
    "url": "https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles/nlcd_tcc_conus_2021_v2021-4.zip",
    "archiveName": "nlcd_tcc_conus_2021_v2021-4.zip",
    "cacheAliases": ["nlcd_tcc_2021.zip"],
    "member": "nlcd_tcc_conus_2021_v2021-4.tif",
    "sha256": "7afe3a6856eacd30eb557515e821ab9a491df0e18231b107a2fe129e27541fb0",
    "archiveBytes": 3740022899,
    "datasetVersion": "nlcd-tcc-conus-2021-v2021-4",
    "crs": "CONUS Albers Equal Area (EPSG:5070 parameters; file proj string 'Albers Conical Equal Area')",
    "resolutionM": 30,
    "units": "percent tree canopy cover (0-100); stored in habitat as a 0..1 fraction",
    "noDataValues": (254, 255),
    "citation": ("USDA Forest Service, 2023. NLCD Tree Canopy Cover (CONUS) v2021-4. "
                 "Housman, I.; Heyer, J.; et al., methods documented in the distributed product metadata."),
    "caveat": ("Percent canopy cover pixel values 0-100; 254 is the non-processing area and 255 the background, both "
               "stored as NULL. The canopy product is 2021 while the pinned land-cover product is 2023; the two-year "
               "difference is documented rather than corrected. Canopy is forest-structure evidence, never a host "
               "substitute: a spruce-specific mapped forest type stays more informative than generic canopy."),
    "urlCaveat": NLCD_LANDCOVER["urlCaveat"],
}

MTBS = {
    "id": "mtbs",
    "scope": "tile",
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
    "scope": "national",
    "provider": "U.S. Census Bureau",
    "dataset": "Cartographic Boundary File, State, 1:20,000,000 (cb_2023_us_state_20m)",
    "url": "https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_20m.zip",
    "archiveName": "cb_2023_us_state_20m.zip",
    "sha256": "0fd2d6562708ff8182c00d5d25b5556d049ecf2794d97b89ed2dac4d5e9e2c8d",
    "archiveBytes": 186432,
    "datasetVersion": "us-census-state-cb-2023-20m",
    "toleranceDegrees": 0.02,
    "citation": "U.S. Census Bureau. 2023. Cartographic Boundary Files, state boundaries (1:20,000,000).",
    "caveat": ("PAD-US ST_Name is 'Not Applicable' for federal units, so it cannot supply jurisdiction. "
               "Jurisdiction is assigned here by point-in-polygon against the Census state boundaries and the "
               "raw PAD-US label is retained separately for audit."),
}

PADUS = {
    "id": "padus",
    "scope": "tile",
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
    # Pacific Northwest host evidence. Class 300 is "hemlock / Sitka spruce" in the
    # authoritative FIA legend; it is distinct from Douglas-fir (200) and from the
    # fir/spruce/mountain-hemlock group (260), and no PNW model may substitute one
    # for another. Added additively: legacy and earlier western tiles read it as NULL.
    "hemlock_sitka_spruce_signal": (300,),
    # California host evidence, added additively for the revision-12 profiles. The
    # authoritative FIA legend places California oaks in class 920 (Western Oak
    # Group) — NOT the eastern Oak/Hickory group (500) that oak_hickory_signal
    # maps — and tanoak in 940 (Tanoak/Laurel), redwood in 340, and the Sierra/
    # coastal mixed-conifer belt in 370 (California Mixed Conifer). Each is
    # distinct; no model may substitute one for another. Legacy and earlier
    # western tiles read them as NULL.
    "western_oak_signal": (920,),
    "tanoak_laurel_signal": (940,),
    "redwood_signal": (340,),
    "california_mixed_conifer_signal": (370,),
    # Southwestern display evidence: pinyon-juniper woodland (180) is exposed
    # for habitat context only. No implemented target weights it — tree presence
    # alone does not establish mushroom habitat.
    "pinyon_juniper_signal": (180,),
}

# Land-cover evidence derived from the pinned Annual NLCD class legend. The
# adapter exposes mapped evidence only; it does not assign species weights.
# `forest`/`deciduous`/`open_land` deliberately reuse the legacy NLCD sampler's
# class mapping so eastern and western tiles keep identical semantics. The
# evergreen/mixed/wetland columns are additive western-era fields: legacy tiles
# do not have them and read as NULL, never as 0.
LAND_COVER_CLASSES = NLCD_LANDCOVER["legend"]
LAND_COVER_FOREST = {41, 42, 43, 90}
LAND_COVER_DECIDUOUS = {41}
LAND_COVER_OPEN = {71, 81, 82}
# Pasture/meadow evidence for open-habitat targets: grassland/herbaceous (71) and
# pasture/hay (81). Cultivated crops (82) are deliberately EXCLUDED — cropland is
# never substituted for pasture/meadow mushroom habitat.
LAND_COVER_PASTURE = {71, 81}


def land_cover_record(code: int | None) -> dict:
    """Map a raw Annual NLCD class value to row fields. Unknown codes stay missing."""
    if code is None or code not in LAND_COVER_CLASSES:
        return {"land_class": None, "forest": None, "deciduous": None, "open_land": None,
                "pasture": None, "evergreen": None, "mixed_forest": None, "wetland": None}
    return {
        "land_class": LAND_COVER_CLASSES[code],
        "forest": 1.0 if code in LAND_COVER_FOREST else 0.0,
        "deciduous": 1.0 if code in LAND_COVER_DECIDUOUS else 0.0,
        "open_land": 1.0 if code in LAND_COVER_OPEN else 0.0,
        "pasture": 1.0 if code in LAND_COVER_PASTURE else 0.0,
        "evergreen": 1.0 if code == 42 else 0.0,
        "mixed_forest": 1.0 if code == 43 else 0.0,
        "wetland": 1.0 if code in {90, 95} else 0.0,
    }


def canopy_fraction(percent: float | None) -> float | None:
    """NLCD TCC publishes 0..100 percent; habitat stores a 0..1 fraction. Values
    outside 0..100 (254 non-processing, 255 background) stay missing."""
    if percent is None or not 0 <= percent <= 100:
        return None
    return round(percent / 100.0, 4)


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
] + [(column, "DOUBLE") for column in FOREST_SIGNAL_CLASSES] + [
    # Additive western-era land-cover fields. Appended after the original columns so a
    # legacy tile remains positionally readable; mixed-schema reads use union_by_name.
    ("evergreen", "DOUBLE"), ("mixed_forest", "DOUBLE"), ("wetland", "DOUBLE"),
]

# The core habitat stack a release requires before a tile can be called AVAILABLE.
# Soil is intentionally optional: it is valuable but not part of the core release.
HABITAT_REQUIRED_COMPONENTS = ("forestType", "elevation", "canopy", "landCover")
HABITAT_OPTIONAL_COMPONENTS = ("soil",)

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
    # Additive identity/provenance fields. The hosted PAD-US public-access layer
    # publishes no stable unit ID (BndryID reads "Not Applicable"), so identity is
    # the authoritative name+manager+category+designation composite plus the
    # Census-resolved state; name alone must never merge two different properties.
    ("source_category", "VARCHAR"), ("source_designation", "VARCHAR"),
    ("jurisdiction_confidence", "VARCHAR"),
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


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 24):
            digest.update(chunk)
    return digest.hexdigest()


def _download_once(url: str, destination: Path, expected_sha256: str | None = None, resume: bool = True) -> str:
    """Download once, resuming a partial file when the server supports it.

    The `.part` file is never treated as ready. The pinned SHA256 is verified
    before the file is promoted, so an interrupted or corrupted download cannot
    masquerade as a prepared source.
    """
    destination.parent.mkdir(parents=True, exist_ok=True)
    tmp = destination.with_suffix(destination.suffix + ".part")
    start = tmp.stat().st_size if resume and tmp.exists() else 0
    headers = {"User-Agent": "fruiting-forecast-bulk-adapters/1.0"}
    if start:
        headers["Range"] = f"bytes={start}-"
    print(f"Downloading {url}" + (f" (resuming at {start:,} bytes)" if start else ""))
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=900)
        if start and getattr(response, "status", 200) != 206:
            print("  Server ignored the range request; restarting the download")
            start = 0
        mode = "ab" if start else "wb"
        with response, open(tmp, mode) as handle:
            while chunk := response.read(1 << 22):
                handle.write(chunk)
    except urllib.error.HTTPError as exc:
        if start and exc.code == 416:
            print("  Partial file is already complete; verifying it")
        else:
            raise
    digest = _sha256(tmp)
    if expected_sha256 and digest != expected_sha256:
        tmp.rename(tmp.with_suffix(tmp.suffix + ".mismatch"))
        raise SystemExit(f"Checksum mismatch for {destination.name}: got {digest}, expected {expected_sha256}. "
                         f"The mismatched partial was kept as {tmp.name}.mismatch and is NOT ready.")
    tmp.replace(destination)
    return digest


def _download(url, destination, expected_sha256=None, resume=True):
    import random
    from fruiting_metrics import emit
    started = time.monotonic()
    before = destination.with_suffix(destination.suffix+'.part').stat().st_size if destination.with_suffix(destination.suffix+'.part').exists() else 0
    for attempt in range(5):
        try:
            result = _download_once(url, destination, expected_sha256, resume)
            emit('download', url=url, bytes=max(0,destination.stat().st_size-before), seconds=time.monotonic()-started, retries=attempt)
            return result
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            status = getattr(e,'code',0)
            if status and status not in {408,429,500,502,503,504}: raise
            emit('download-retry',url=url,status=status,attempt=attempt+1)
            if attempt == 4: raise
            after = getattr(e,'headers',{}).get('Retry-After','0')
            time.sleep(max(float(after) if str(after).isdigit() else 0,2**(attempt+1)+random.random()))


def cache_manifest_path(cache: Path) -> Path:
    return cache / CACHE_MANIFEST


def load_cache_manifest(cache: Path) -> dict:
    path = cache_manifest_path(cache)
    if path.exists():
        return json.loads(path.read_text())
    return {"schemaVersion": 1, "sources": {}}


def save_cache_manifest(cache: Path, manifest: dict) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    manifest["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    tmp = cache_manifest_path(cache).with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, cache_manifest_path(cache))


def _validate_archive(archive: Path, source: dict) -> dict:
    """Structural validation: readable zip, expected member present, member size
    matches the archive directory. Returns member metadata. Does not CRC-scan
    multi-gigabyte archives (the pinned SHA256 is the integrity check)."""
    with zipfile.ZipFile(archive) as bundle:
        names = bundle.namelist()
        member = source.get("member")
        if member and member not in names:
            raise ValueError(f"{archive.name} does not contain expected member {member}")
        info = bundle.getinfo(member) if member else None
    return {"members": len(names), "member": member,
            "memberBytes": info.file_size if info else None}


def _archive_path(cache: Path, source: dict) -> Path:
    """Canonical pinned archive name, or a documented cache alias when an older
    cache used a shorter local filename."""
    canonical = cache / source.get("archiveName", Path(source["url"]).name)
    if canonical.exists():
        return canonical
    for alias in source.get("cacheAliases", []):
        candidate = cache / alias
        if candidate.exists():
            return candidate
    return canonical


def _record(cache: Path, manifest: dict, key: str, entry: dict) -> dict:
    entry = {"validatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **entry}
    manifest.setdefault("sources", {})[key] = entry
    save_cache_manifest(cache, manifest)
    return entry


def prepare_national(cache: Path, names: list[str] | None = None) -> dict:
    """Prepare the pinned national products once. Existing verified archives are
    reused; a present-but-wrong archive is FAILED, never silently re-downloaded."""
    registry = {"forest-type": FOREST_GROUP, "land-cover": NLCD_LANDCOVER,
                "canopy": NLCD_TCC, "states": STATES}
    chosen = names or list(registry)
    manifest = load_cache_manifest(cache)
    prepared = {}
    for name in chosen:
        source = registry.get(name)
        if source is None:
            raise SystemExit(f"Unknown national source: {name} (choose from {', '.join(registry)})")
        archive = _archive_path(cache, source)
        if not archive.exists():
            digest = _download(source["url"], archive, expected_sha256=source.get("sha256"))
        else:
            digest = _sha256(archive)
        if source.get("sha256") and digest != source["sha256"]:
            entry = _record(cache, manifest, source["id"], {
                "status": "FAILED", "scope": "national", "archive": archive.name, "bytes": archive.stat().st_size,
                "sha256": digest, "expectedSha256": source["sha256"], "sha256Matches": False,
                "datasetVersion": source["datasetVersion"],
                "error": "Cached archive does not match the pinned checksum; delete it and prepare again."})
            prepared[name] = entry
            continue
        try:
            structure = _validate_archive(archive, source)
            entry = _record(cache, manifest, source["id"], {
                "status": "READY", "scope": "national", "archive": archive.name, "bytes": archive.stat().st_size,
                "sha256": digest, "expectedSha256": source.get("sha256"), "sha256Matches": True,
                "datasetVersion": source["datasetVersion"], "productPage": source.get("productPage"),
                "sourceUrl": source["url"], **structure})
        except Exception as exc:
            entry = _record(cache, manifest, source["id"], {
                "status": "FAILED", "scope": "national", "archive": archive.name, "bytes": archive.stat().st_size,
                "sha256": digest, "datasetVersion": source["datasetVersion"], "error": str(exc)})
        prepared[name] = entry
    return prepared


def dem_path(cache: Path, tile_id: str) -> Path:
    return cache / f"dem_{usgs_dem_tile_id(tile_id)}.tif"


def dem_release_listing_url(tile_id: str) -> str:
    usgs = usgs_dem_tile_id(tile_id)
    return ("https://prd-tnm.s3.amazonaws.com/?list-type=2&max-keys=1000&prefix="
            f"StagedProducts/Elevation/1/TIFF/historical/{usgs}/USGS_1_{usgs}_")


def list_dem_releases(tile_id: str, timeout: int = 120) -> list[str]:
    """Latest-first list of 3DEP releases for a tile from the public TNM bucket.

    The pinned global release does not exist for every tile, so tile scope must
    resolve its own release instead of assuming one date nationwide.
    """
    usgs = usgs_dem_tile_id(tile_id)
    response = service_request('get', dem_release_listing_url(tile_id), timeout=timeout)
    response.raise_for_status()
    root = ElementTree.fromstring(response.content)
    namespace = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
    releases = set()
    for key in root.findall(".//s3:Key", namespace):
        match = re.search(rf"USGS_1_{usgs}_(\d{{8}})\.tif$", key.text or "")
        if match:
            releases.add(match.group(1))
    return sorted(releases, reverse=True)


def prepare_tile(cache: Path, tile_id: str) -> dict:
    """Prepare tile-scoped sources (the 3DEP 1x1 degree DEM). Never touches national products."""
    manifest = load_cache_manifest(cache)
    usgs = usgs_dem_tile_id(tile_id)
    key = f"{DEM_1ARC['id']}:{usgs}"
    target = dem_path(cache, tile_id)
    previous = (manifest.get("sources") or {}).get(key) or {}
    if target.exists():
        # A cached tile keeps the release it was fetched with; never silently swap.
        match = re.search(r"_(\d{8})\.tif$", previous.get("sourceUrl") or "")
        release = match.group(1) if match else DEM_1ARC["release"]
        note = previous.get("releaseNote") or "Cached file reused; release recorded from its download URL."
    else:
        releases = list_dem_releases(tile_id)
        release = releases[0] if releases else DEM_1ARC["release"]
        note = f"Latest of {len(releases)} releases listed by the TNM bucket." if releases else \
            "Listing unavailable; fell back to the pinned release."
        _download(dem_tile_url(tile_id, release), target, resume=True)
    validated = {"status": "READY", "scope": "tile", "tile": tile_id, "archive": target.name,
                 "bytes": target.stat().st_size, "datasetVersion": f"{DEM_1ARC['datasetVersion']}-{release}",
                 "sourceUrl": dem_tile_url(tile_id, release), "release": release, "releaseNote": note,
                 "releaseListingUrl": dem_release_listing_url(tile_id)}
    try:
        import rasterio
        with rasterio.open(target) as source:
            if source.width <= 0 or source.height <= 0:
                raise ValueError("empty raster")
            validated.update(rasterSize=[source.width, source.height], crs=str(source.crs), nodata=source.nodata)
    except Exception as exc:
        validated = {**validated, "status": "FAILED", "error": f"DEM is not a readable raster: {exc}"}
    return _record(cache, manifest, key, validated)


def _prepared_member(cache: Path, source: dict) -> Path | None:
    """Return the extracted member path for a READY national source, else None.

    Extraction is cached with a completion marker; a partial extraction is never
    reused. A missing/unprepared source stays missing instead of being invented.
    """
    manifest = load_cache_manifest(cache)
    entry = (manifest.get("sources") or {}).get(source["id"]) or {}
    archive = _archive_path(cache, source)
    if entry.get("status") != "READY" or not archive.exists():
        return None
    target_dir = cache / "extracted" / source["sha256"][:12]
    member = target_dir / source["member"]
    marker = member.with_suffix(member.suffix + ".ready")
    if marker.exists() and member.exists():
        return member
    target_dir.mkdir(parents=True, exist_ok=True)
    if member.exists():
        member.unlink()
    with zipfile.ZipFile(archive) as bundle:
        bundle.extract(source["member"], target_dir)
    expected = entry.get("memberBytes")
    if expected and member.stat().st_size != expected:
        member.unlink()
        raise SystemExit(f"Extraction of {source['member']} produced {member.stat().st_size} bytes, expected {expected}")
    marker.write_text(json.dumps({"archiveSha256": source["sha256"], "memberBytes": member.stat().st_size}) + "\n")
    return member


def meters_to_feet(value: float | None) -> float | None:
    """3DEP is meters; habitat elevation_ft is feet. Single explicit conversion point."""
    return None if value is None else round(value * 3.28084, 2)


def _sample_raster(source, transform_to, points: list[tuple[float, float]],
                   extra_nodata: tuple[float, ...] = ()) -> list[float | None]:
    """Sample a raster at WGS84 points. Out-of-mask cells return None, never 0."""
    xs, ys = transform_to("EPSG:4326", source.crs, [p[1] for p in points], [p[0] for p in points])
    nodata = source.nodata
    candidates = tuple(DEM_1ARC["noDataValues"]) + tuple(extra_nodata)
    values: list[float | None] = []
    for sample in source.sample(zip(xs, ys)):
        value: float | None = float(sample[0])
        missing = nodata is not None and abs(value - nodata) < 1e-6
        if not missing:
            missing = any(abs(value - candidate) < 1e-6 for candidate in candidates)
        values.append(None if missing else value)
    return values


# ─ Soil ──────────────────────────────────────────────────────────────
#
# Soil evidence has ONE normalized contract no matter how the upstream product
# is packaged:
#
#   mukey -> {drainage_class, awc_25_cm, awc_50_cm, flood_frequency,
#             hydrologic_group, slope_deg}
#
# Three authoritative NRCS sources can fill that contract:
#   * "sda"      Soil Data Access SSURGO tabular + batched point->MUKEY queries
#                (state attribute table fetched once, one point query per tile);
#   * "gssurgo"  a gSSURGO state package (mapunit raster + muaggatt table);
#   * "gnatsgo"  a gNATSGO state package (same shape, gap-filled).
#
# The habitat build never inspects the packaging format: it consumes normalized
# rows and preserves NULL for any point or attribute the source does not cover.
# Units are explicit; a missing survey or attribute is never a fabricated
# neutral value.
SOIL_COMPONENT = "soil"
SOIL_COLUMNS = ("drainage_class", "awc_25_cm", "awc_50_cm", "flood_frequency",
                "hydrologic_group", "slope_deg")
SOIL_ATTRIBUTE_COLUMNS = [
    ("mukey", "BIGINT"), ("musym", "VARCHAR"), ("areasymbol", "VARCHAR"),
    ("drainage_class", "VARCHAR"), ("awc_25_cm", "DOUBLE"), ("awc_50_cm", "DOUBLE"),
    ("flood_frequency", "VARCHAR"), ("hydrologic_group", "VARCHAR"), ("slope_deg", "DOUBLE"),
]
# Authoritative muaggatt attribute names (SSURGO/gSSURGO/gNATSGO all share them).
SOIL_MUAGGATT_ATTRIBUTES = ("drclassdcd", "aws025wta", "aws050wta", "flodfreqdcd",
                            "hydgrpdcd", "slopegraddcp")
SOIL_UNITS = {"awc_25_cm": "centimeters", "awc_50_cm": "centimeters", "slope_deg": "percent slope"}
SOIL_ATTRIBUTE_DESCRIPTIONS = {
    "drainage_class": "drainage class (dominant condition, text)",
    "awc_25_cm": "available water storage 0-25 cm (weighted average, cm)",
    "awc_50_cm": "available water storage 0-50 cm (weighted average, cm)",
    "flood_frequency": "flooding frequency class (dominant condition, text)",
    "hydrologic_group": "hydrologic soil group (dominant condition, text)",
    "slope_deg": "slope gradient (dominant condition, percent)",
}

SDA_ENDPOINT = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"
SDA_SOIL = {
    "id": "ssurgo_sda",
    "kind": "sda",
    "scope": "state",
    "provider": "USDA Natural Resources Conservation Service",
    "dataset": "SSURGO (Soil Survey Geographic Database) via Soil Data Access",
    "productPage": "https://sdmdataaccess.sc.egov.usda.gov/",
    "sourceUrl": SDA_ENDPOINT,
    "datasetVersion": "ssurgo-sda",
    "attributes": SOIL_ATTRIBUTE_DESCRIPTIONS,
    "units": SOIL_UNITS,
    "caveat": ("SSURGO coverage only. One query per state supplies the authoritative mapunit aggregate "
               "attributes; one batched point-in-mapunit query per tile resolves the sampled grid cells. "
               "A sampled point with no mapunit, and any attribute the mapunit does not publish, stays "
               "NULL. STATSGO2 gap filling is deliberately NOT applied here because it would present "
               "coarse state-level data as survey-grade soil."),
}
GSSURGO = {
    "id": "gssurgo",
    "kind": "package",
    "scope": "state",
    "provider": "USDA Natural Resources Conservation Service",
    "dataset": "Gridded Soil Survey Geographic (gSSURGO) Database, state package",
    "productPage": "https://www.nrcs.usda.gov/resources/data-and-reports/gridded-soil-survey-geographic-gssurgo-database",
    "archiveNameTemplate": "gSSURGO_{state}.zip",
    "datasetVersion": "gssurgo-state",
    "attributes": SOIL_ATTRIBUTE_DESCRIPTIONS,
    "units": SOIL_UNITS,
    "caveat": ("gSSURGO NRCS state packages do not publish one stable public URL for every state; the archive name "
               "and the SHA256 recorded in the cache manifest are authoritative, and an operator may place a state "
               "archive in the cache. The mapunit raster is sampled locally and joined to the shipped muaggatt "
               "table; survey areas without data stay missing. Missing soil is never a neutral biological value."),
}
GNATSGO = {
    "id": "gnatsgo",
    "kind": "package",
    "scope": "state",
    "provider": "USDA Natural Resources Conservation Service",
    "dataset": "Gridded National Soil Survey Geographic (gNATSGO) Database, state package",
    "productPage": "https://www.nrcs.usda.gov/resources/data-and-reports/gridded-national-soil-survey-geographic-gnatsgo-database",
    "archiveNameTemplate": "gNATSGO_{state}.zip",
    "datasetVersion": "gnatsgo-state",
    "attributes": SOIL_ATTRIBUTE_DESCRIPTIONS,
    "units": SOIL_UNITS,
    "caveat": ("gNATSGO is the NRCS annually refreshed national gridded soil product: primarily SSURGO with "
               "STATSGO2 gap filling. Mapunit raster + muaggatt are read with the same normalized contract as "
               "gSSURGO, from a FileGDB, GeoPackage or SQLite package. Points sourced from STATSGO2 rather than "
               "SSURGO are coarse by construction; the package's source raster that would separate them is not "
               "yet consumed here, so such points should be treated as missing for survey-grade questions."),
}
SOIL_ARCHIVE_SOURCES = {"gssurgo": GSSURGO, "gnatsgo": GNATSGO}


def _discover_mukey_raster(root: Path) -> Path | None:
    candidates = [path for path in sorted(root.rglob("*.tif")) if "mukey" in path.name.lower()]
    if not candidates:
        candidates = [path for path in sorted(root.rglob("*.tif*")) if path.suffix.lower() in {".tif", ".tiff"}]
    return candidates[0] if candidates else None


def _discover_soil_tables(root: Path) -> Path | None:
    """Locate the packaged mapunit aggregate table.

    gSSURGO ships a FileGDB; gNATSGO 2026 ships GeoPackage/SQLite; deterministic
    fixtures also use a plain CSV. Any of them maps to the same normalized rows.
    """
    preferred = [
        next((path for path in sorted(root.rglob("muaggatt.csv"))), None),
        next((path for path in sorted(root.rglob("*.gdb")) if path.is_dir()), None),
        next((path for path in sorted(root.rglob("*.gpkg"))), None),
        next((path for path in sorted(root.rglob("*.sqlite"))), None),
        next((path for path in sorted(root.rglob("*.sqlite3"))), None),
    ]
    return next((path for path in preferred if path is not None), None)


def _read_muaggatt(extracted: Path, table_source: Path | None = None) -> list[dict]:
    """Read the authoritative mapunit aggregate table from whatever the package ships."""
    source = table_source or _discover_soil_tables(extracted)
    if source is None:
        raise SystemExit("Soil package supplies no muaggatt.csv, FileGDB, GeoPackage or SQLite table")
    if source.suffix.lower() == ".csv":
        import csv
        with open(source, newline="") as handle:
            return [{key.lower(): value for key, value in row.items()} for row in csv.DictReader(handle)]
    if source.suffix.lower() in {".gpkg", ".sqlite", ".sqlite3"}:
        # GeoPackage is SQLite; read the table directly so no GDAL dependency is needed.
        import sqlite3
        connection = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        try:
            cursor = connection.execute("SELECT * FROM muaggatt")
            columns = [description[0].lower() for description in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        except sqlite3.Error as exc:
            raise SystemExit(f"Soil SQLite/GeoPackage has no readable muaggatt table: {exc}") from exc
        finally:
            connection.close()
    if source.suffix.lower() == ".gdb":
        try:
            import pyogrio
        except ImportError as exc:
            raise SystemExit("Reading soil FileGDB tables requires pyogrio: uv run --with pyogrio ...") from exc
        frame = pyogrio.read_dataframe(source, layer="muaggatt", read_geometry=False)
        return [{str(key).lower(): value for key, value in record.items()} for record in frame.to_dict("records")]
    raise SystemExit(f"Unsupported soil table source: {source.name}")


def _parse_us_date(value):
    """Parse the survey save dates SDA publishes (for example 8/29/2025 3:26:00 PM)."""
    if not value:
        return None
    text = str(value).strip()
    for pattern in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y", "%Y-%m-%d"):
        try:
            return time.strptime(text, pattern)
        except ValueError:
            continue
    return None


def _to_float(value) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_soil_attribute(row: dict) -> dict:
    """Normalize any upstream packaging (muaggatt, SDA result columns) to the contract."""
    return {
        "drainage_class": row.get("drainage_class", row.get("drclassdcd")),
        "awc_25_cm": _to_float(row.get("awc_25_cm", row.get("aws025wta"))),
        "awc_50_cm": _to_float(row.get("awc_50_cm", row.get("aws050wta"))),
        "flood_frequency": row.get("flood_frequency", row.get("flodfreqdcd")),
        "hydrologic_group": row.get("hydrologic_group", row.get("hydgrpdcd")),
        "slope_deg": _to_float(row.get("slope_deg", row.get("slopegraddcp"))),
    }


# ─ Soil: Soil Data Access (SSURGO tabular + batched point lookup) ─────


def _sda_query(query: str, timeout: int = 300) -> list[list]:
    """One authoritative SDA query. Returns the raw Table (first row is the header)."""
    response = service_request('post', SDA_ENDPOINT, json={"query": query, "format": "JSON+COLUMNNAME"}, timeout=timeout)
    response.raise_for_status()
    try:
        body = response.json()
    except ValueError as exc:
        raise ValueError(f"Soil Data Access returned non-JSON: {response.text[:200]}") from exc
    if "Table" not in body:
        raise ValueError(f"Soil Data Access rejected the query: {str(body)[:300]}")
    return body["Table"] or []


def sda_attribute_query(state: str) -> str:
    if not re.fullmatch(r"[A-Z]{2}", state):
        raise ValueError(f"Invalid state code: {state}")
    return ("SELECT m.mukey, m.musym, l.areasymbol, sc.saverest, ma.drclassdcd, ma.aws025wta, ma.aws050wta, "
            "ma.flodfreqdcd, ma.hydgrpdcd, ma.slopegraddcp "
            "FROM mapunit m JOIN legend l ON m.lkey = l.lkey "
            "JOIN sacatalog sc ON sc.areasymbol = l.areasymbol "
            "LEFT JOIN muaggatt ma ON m.mukey = ma.mukey "
            f"WHERE l.areasymbol LIKE '{state}%' ORDER BY m.mukey")


def sda_point_query(points: list[tuple[float, float]]) -> str:
    """Batched point -> MUKEY lookup. One query per tile, never one per point."""
    values = ",".join(f"('{lat:.3f}_{lon:.3f}','point({lon} {lat})')" for lat, lon in points)
    return ("SELECT p.pt AS point_id, m.mukey FROM (VALUES " + values + ") AS p(pt,wkt) "
            "CROSS APPLY SDA_Get_Mukey_from_intersection_with_WktWgs84(p.wkt) m")


def fetch_sda_attributes(state: str) -> list[dict]:
    query = sda_attribute_query(state)
    table = _sda_query(query)
    if len(table) < 2:
        return []
    header = [str(name).lower() for name in table[0]]
    rows = []
    for record in table[1:]:
        raw = dict(zip(header, record))
        normalized = normalize_soil_attribute(raw)
        normalized.update({"mukey": int(raw["mukey"]), "musym": raw.get("musym"),
                           "areasymbol": raw.get("areasymbol"), "saverest": raw.get("saverest")})
        rows.append(normalized)
    return rows


def fetch_sda_point_mukeys(points: list[tuple[float, float]], timeout: int = 300) -> dict:
    """Resolve MUKEY for sample points in batches. A point can intersect more than
    one mapunit at a boundary; the smallest MUKEY wins deterministically."""
    resolved: dict[str, int] = {}
    ambiguous: dict[str, list[int]] = {}
    chunk = 400
    for start in range(0, len(points), chunk):
        table = _sda_query(sda_point_query(points[start:start + chunk]), timeout=timeout)
        if len(table) < 2:
            continue
        grouped: dict[str, list[int]] = {}
        for point_id, mukey in table[1:]:  # row 0 is the column-name header
            if point_id is None or mukey in (None, ""):
                continue
            grouped.setdefault(str(point_id), []).append(int(mukey))
        for point_id, mukeys in grouped.items():
            unique = sorted(set(mukeys))
            resolved[point_id] = unique[0]
            if len(unique) > 1:
                ambiguous[point_id] = unique
    return {"mukeys": resolved, "ambiguous": ambiguous}


def prepare_state(cache: Path, state: str, source: str = "sda", archive: Path | None = None) -> dict:
    """Prepare one authoritative NRCS soil source for a state.

    `sda` fetches the normalized SSURGO attribute table once (cache/soil/<ST>-attributes.parquet).
    `gssurgo`/`gnatsgo` validate an operator-provided state package instead. Either way the
    completion marker is written only after the data validates.
    """
    state = state.upper()
    manifest = load_cache_manifest(cache)
    if source in SOIL_ARCHIVE_SOURCES:
        descriptor = SOIL_ARCHIVE_SOURCES[source]
        key = f"{descriptor['id']}:{state}"
        target = cache / descriptor["archiveNameTemplate"].format(state=state)
        if archive is not None and archive.exists() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read_bytes())
        if not target.exists():
            return _record(cache, manifest, key, {
                "status": "FAILED", "scope": "state", "state": state, "archive": target.name,
                "datasetVersion": descriptor["datasetVersion"], "productPage": descriptor["productPage"],
                "error": ("No soil archive is present for this state. Place the NRCS state package in the cache "
                          "or use the default `--source sda` Soil Data Access path.")})
        digest = _sha256(target)
        try:
            with zipfile.ZipFile(target) as bundle:
                members = bundle.namelist()
            packaging = (".gdb/", ".gpkg", ".sqlite")
            if not any(any(token in name.lower() for token in packaging) for name in members) and \
                    not any("mukey" in name.lower() for name in members):
                raise ValueError("archive contains no FileGDB/GeoPackage/SQLite package or mukey raster")
            entry = {"status": "READY", "scope": "state", "source": source, "state": state,
                     "archive": target.name, "bytes": target.stat().st_size, "sha256": digest,
                     "members": len(members), "datasetVersion": descriptor["datasetVersion"],
                     "productPage": descriptor["productPage"]}
        except Exception as exc:
            entry = {"status": "FAILED", "scope": "state", "source": source, "state": state,
                     "archive": target.name, "bytes": target.stat().st_size, "sha256": digest,
                     "datasetVersion": descriptor["datasetVersion"], "error": str(exc)}
        return _record(cache, manifest, key, entry)

    if source != "sda":
        raise SystemExit(f"Unknown soil source: {source} (choose sda, gssurgo or gnatsgo)")
    key = f"{SDA_SOIL['id']}:{state}"
    query = sda_attribute_query(state)
    fingerprint = hashlib.sha256(query.encode()).hexdigest()[:16]
    existing = (manifest.get("sources") or {}).get(key) or {}
    if (existing.get("status") == "READY" and existing.get("queryFingerprint") == fingerprint
            and (cache / existing.get("attributesPath", "")).exists()):
        # Unchanged source metadata with the prepared table present: reuse, never re-query.
        return {**existing, "reused": True}
    retrieved = time.strftime("%Y-%m-%d")
    try:
        rows = fetch_sda_attributes(state)
    except Exception as exc:
        return _record(cache, manifest, key, {
            "status": "FAILED", "scope": "state", "source": "sda", "state": state,
            "datasetVersion": SDA_SOIL["datasetVersion"], "sourceUrl": SDA_ENDPOINT,
            "error": f"Soil Data Access query failed: {exc}"})
    if not rows:
        return _record(cache, manifest, key, {
            "status": "EMPTY", "scope": "state", "source": "sda", "state": state,
            "datasetVersion": SDA_SOIL["datasetVersion"], "sourceUrl": SDA_ENDPOINT,
            "statusNote": "Soil Data Access returned no mapunits for this state; soil stays UNBUILT."})
    attributes_path = cache / "soil" / f"{state}-attributes.parquet"
    mukeys = [int(row["mukey"]) for row in rows if row.get("mukey") is not None]
    vintages = sorted(v for v in (_parse_us_date(row.get("saverest")) for row in rows) if v)
    survey_areas = {str(row.get("areasymbol")) for row in rows if row.get("areasymbol")}
    meta = {
        "datasetVersion": f"{SDA_SOIL['datasetVersion']}-{retrieved}",
        "sourceUrl": SDA_ENDPOINT,
        "status": "AVAILABLE",
        "state": state,
        "rowCount": len(rows),
        "queryFingerprint": fingerprint,
        "collectedAt": retrieved,
        "mukeyMin": min(mukeys) if mukeys else None,
        "mukeyMax": max(mukeys) if mukeys else None,
        "surveyAreaCount": len(survey_areas),
        "surveyVintage": time.strftime("%Y-%m-%d", vintages[-1]) if vintages else None,
        "surveyVintageOldest": time.strftime("%Y-%m-%d", vintages[0]) if vintages else None,
        "source": {**SDA_SOIL},
        "units": SOIL_UNITS,
        "attributes": SOIL_ATTRIBUTE_DESCRIPTIONS,
    }
    write_parquet(attributes_path, rows, SOIL_ATTRIBUTE_COLUMNS, meta)
    entry = _record(cache, manifest, key, {
        "status": "READY", "scope": "state", "source": "sda", "state": state,
        "datasetVersion": meta["datasetVersion"], "sourceUrl": SDA_ENDPOINT,
        "productPage": SDA_SOIL["productPage"], "attributesPath": str(attributes_path.relative_to(cache)),
        "rows": len(rows), "queryFingerprint": fingerprint, "collectedAt": retrieved,
        "mukeyMin": meta["mukeyMin"], "mukeyMax": meta["mukeyMax"],
        "surveyAreaCount": meta["surveyAreaCount"], "surveyVintage": meta["surveyVintage"],
        "surveyVintageOldest": meta["surveyVintageOldest"]})
    return entry


def _package_soil_entry(cache: Path, state: str, entry: dict) -> dict | None:
    descriptor = SOIL_ARCHIVE_SOURCES.get(entry.get("source"))
    if descriptor is None:
        return None
    archive = cache / descriptor["archiveNameTemplate"].format(state=state)
    if not archive.exists():
        return None
    extracted = cache / "extracted" / f"{archive.stem}-{entry['sha256'][:8]}"
    marker = extracted / ".ready"
    if not marker.exists():
        extracted.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as bundle:
            bundle.extractall(extracted)
        marker.write_text(json.dumps({"sha256": entry["sha256"]}) + "\n")
    raster = _discover_mukey_raster(extracted)
    table_source = _discover_soil_tables(extracted)
    if raster is None and table_source is None:
        return None
    table = _read_muaggatt(extracted, table_source)
    attributes = {int(row["mukey"]): normalize_soil_attribute(row)
                  for row in table if row.get("mukey") not in (None, "")}
    return {"state": state, "kind": "package", "raster": raster, "attributes": attributes,
            "point_mukeys": None,
            "source": {"id": descriptor["id"], "provider": descriptor["provider"],
                       "dataset": descriptor["dataset"], "productPage": descriptor["productPage"],
                       "sha256": entry["sha256"], "state": state,
                       "attributes": descriptor["attributes"], "units": descriptor["units"],
                       "caveat": descriptor["caveat"]},
            "datasetVersion": f"{entry['datasetVersion']}:{state}"}


def _load_sda_attributes(cache: Path, state: str, entry: dict) -> dict:
    path = cache / entry.get("attributesPath", f"soil/{state}-attributes.parquet")
    connection = duckdb.connect()
    try:
        table = connection.execute("SELECT * FROM read_parquet(?)", [str(path)])
        columns = [description[0] for description in table.description]
        return {int(row[columns.index("mukey")]): dict(zip(columns, row)) for row in table.fetchall()}
    finally:
        connection.close()


def _tile_point_mukeys(cache: Path, tile_id: str, points: list[tuple[float, float]], step: float) -> dict:
    """Cached per-tile point -> MUKEY resolution. One batched SDA call per tile."""
    path = cache / "soil" / f"{tile_id}-points.json"
    if path.exists():
        try:
            cached = json.loads(path.read_text())
            if cached.get("step") == step and cached.get("pointCount") == len(points):
                return cached
        except (ValueError, OSError):
            pass  # A damaged cache is re-queried, never trusted.
    result = fetch_sda_point_mukeys(points)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"tile": tile_id, "step": step, "retrievedAt": time.strftime("%Y-%m-%d"),
               "pointCount": len(points), "resolved": len(result["mukeys"]),
               "unresolved": len(points) - len(result["mukeys"]),
               "ambiguous": result["ambiguous"], "mukeys": result["mukeys"]}
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
    return payload


def _ready_sda_states(sources: dict) -> dict:
    return {key.split(":", 1)[1]: entry for key, entry in sources.items()
            if key.startswith(f"{SDA_SOIL['id']}:") and entry.get("status") == "READY"}


def _state_covers_any_mukey(cache: Path, entry: dict, tile_mukeys: set[int]) -> bool:
    """Exact membership check: does this prepared state own any of the tile's mukeys?

    MUKEYs are national identifiers and CO/NM numeric ranges overlap, so a range
    heuristic cannot decide coverage; the check is a filtered read of the small
    normalized attribute table.
    """
    if not tile_mukeys:
        return False
    low, high = entry.get("mukeyMin"), entry.get("mukeyMax")
    if low is not None and high is not None and not any(low <= value <= high for value in tile_mukeys):
        return False
    path = cache / entry.get("attributesPath", "")
    if not path.exists():
        return False
    placeholders = ",".join("?" * len(tile_mukeys))
    connection = duckdb.connect()
    try:
        count = connection.execute(
            f"SELECT count(*) FROM read_parquet(?) WHERE mukey IN ({placeholders})",
            [str(path), *sorted(tile_mukeys)]).fetchone()[0]
        return count > 0
    finally:
        connection.close()


def soil_inputs(cache: Path, states: list[str], tile_id: str | None = None,
                step: float = STEP_DEGREES) -> list[dict]:
    """Normalized soil inputs for a state list, optionally resolved for one tile.

    The gSSURGO/gNATSGO package path supplies a mapunit raster; the SDA path
    supplies a point -> MUKEY map. Both become the same attribute lookup, so the
    habitat build does not know which product produced the evidence.

    When a tile is given, any other prepared state that owns one of the tile's
    resolved mukeys is included automatically (an exact membership check, because
    MUKEY ranges overlap across states). A tile that crosses a state line therefore
    gets each point's own state evidence; the caller's state list never suppresses
    a neighbour's soil just because the tile was requested from the other side of
    the line. MUKEYs are national identifiers, so the join itself can never mix two
    states' attributes.
    """
    manifest = load_cache_manifest(cache)
    sources = manifest.get("sources") or {}
    requested = list(dict.fromkeys(name.upper() for name in states))
    point_cache = None
    if tile_id:
        point_cache = _tile_point_mukeys(cache, tile_id, sample_points(tile_id, step), step)
    tile_mukeys = {int(value) for value in (point_cache or {}).get("mukeys", {}).values()
                   if value is not None}
    auto_included = []
    if tile_mukeys:
        for state, entry in sorted(_ready_sda_states(sources).items()):
            if state in requested:
                continue
            if _state_covers_any_mukey(cache, entry, tile_mukeys):
                auto_included.append(state)
    prepared = []
    for state in requested + auto_included:
        sda_entry = sources.get(f"{SDA_SOIL['id']}:{state}") or {}
        package_entry = None
        for descriptor in (GNATSGO, GSSURGO):
            candidate = sources.get(f"{descriptor['id']}:{state}") or {}
            if candidate.get("status") == "READY":
                package_entry = candidate
                break
        if sda_entry.get("status") == "READY":
            attributes = _load_sda_attributes(cache, state, sda_entry)
            entry = {"state": state, "kind": "sda", "raster": None, "attributes": attributes,
                     "point_mukeys": (point_cache or {}).get("mukeys"),
                     "source": {"id": SDA_SOIL["id"], "provider": SDA_SOIL["provider"],
                                "dataset": SDA_SOIL["dataset"], "sourceUrl": SDA_ENDPOINT,
                                "productPage": SDA_SOIL["productPage"],
                                "attributes": SDA_SOIL["attributes"], "units": SDA_SOIL["units"],
                                "caveat": SDA_SOIL["caveat"], "state": state,
                                "collectedAt": sda_entry.get("collectedAt"),
                                "surveyVintage": sda_entry.get("surveyVintage"),
                                "mukeyRange": [sda_entry.get("mukeyMin"), sda_entry.get("mukeyMax")],
                                "inclusion": "requested" if state in requested else "tile-mukey-match",
                                "pointLookup": f"{tile_id}-points.json" if tile_id else None,
                                "ambiguousPoints": len((point_cache or {}).get("ambiguous") or {})},
                     "datasetVersion": f"{sda_entry['datasetVersion']}:{state}"}
            prepared.append(entry)
        elif package_entry:
            entry = _package_soil_entry(cache, state, package_entry)
            if entry:
                entry["inclusion"] = "requested"
                prepared.append(entry)
    return prepared


def merge_soil_samples(soil_prepared: list[dict], points: list[tuple[float, float]]) -> dict:
    """Join normalized soil evidence onto the tile's grid points.

    A point covered by an earlier state is not overwritten by a later one; points
    with no mapunit or no attribute remain None. Raster sampling needs rasterio
    only when a package raster is actually present.
    """
    columns = {key: [None] * len(points) for key in SOIL_COLUMNS}
    for entry in soil_prepared:
        values = [None] * len(points)
        if entry.get("raster") is not None:
            import rasterio
            from rasterio.warp import transform as warp_transform
            with rasterio.open(entry["raster"]) as source:
                values = _sample_raster(source, warp_transform, points)
        elif entry.get("point_mukeys") is not None:
            mukeys = entry["point_mukeys"]
            values = [mukeys.get(f"{lat:.3f}_{lon:.3f}") for lat, lon in points]
        lookup = entry.get("attributes") or {}
        for index, value in enumerate(values):
            if value is None or columns["drainage_class"][index] is not None:
                continue
            row = lookup.get(int(value))
            if not row:
                continue
            normalized = normalize_soil_attribute(row)
            columns["drainage_class"][index] = normalized["drainage_class"]
            columns["awc_25_cm"][index] = normalized["awc_25_cm"]
            columns["awc_50_cm"][index] = normalized["awc_50_cm"]
            columns["flood_frequency"][index] = normalized["flood_frequency"]
            columns["hydrologic_group"][index] = normalized["hydrologic_group"]
            columns["slope_deg"][index] = normalized["slope_deg"]
    return columns


def habitat_components(forest: bool, elevation: bool, land_cover: bool, canopy: bool, soil: bool) -> dict:
    """Explicit component completeness. A tile is never AVAILABLE just because a
    Parquet file exists: every required component must be present."""
    return {
        "forestType": "AVAILABLE" if forest else "UNBUILT",
        "elevation": "AVAILABLE" if elevation else "UNBUILT",
        "landCover": "AVAILABLE" if land_cover else "UNBUILT",
        "canopy": "AVAILABLE" if canopy else "UNBUILT",
        "soil": "AVAILABLE" if soil else "UNBUILT",
    }


def build_habitat(tile_id: str, cache: Path, out: Path, step: float = STEP_DEGREES,
                  soil_prepared: list[dict] | None = None) -> dict:
    """Compose one habitat tile from every prepared source on the 0.05-degree grid.

    Required: forest-type-group + 3DEP elevation. Optional and composed when
    prepared: Annual NLCD land cover, NLCD tree canopy, NRCS soil (SDA SSURGO or a
    gSSURGO/gNATSGO package, normalized identically). A missing optional source
    stays NULL/UNBUILT and lowers the declared completeness; it is never imputed.
    The caller never stitches intermediate Parquet fragments.
    """
    import rasterio
    from rasterio.warp import transform as warp_transform

    points = sample_points(tile_id, step)
    archive = _archive_path(cache, FOREST_GROUP)
    elevation_path = dem_path(cache, tile_id)
    # Provenance follows the actual prepared DEM entry: 3DEP releases differ per tile.
    cache_manifest = load_cache_manifest(cache)
    dem_entry = (cache_manifest.get("sources") or {}).get(f"{DEM_1ARC['id']}:{usgs_dem_tile_id(tile_id)}") or {}
    dem_source_url = dem_entry.get("sourceUrl") or dem_tile_url(tile_id)
    dem_version = dem_entry.get("datasetVersion") or DEM_1ARC["datasetVersion"]
    if not archive.exists():
        raise SystemExit(f"Missing pinned forest-type-group archive: {archive} (run prepare national first)")
    if not elevation_path.exists():
        raise SystemExit(f"Missing pinned 3DEP DEM tile: {elevation_path} (run prepare tile first)")
    forest_image = _prepared_member(cache, FOREST_GROUP)
    if forest_image is None:
        raise SystemExit(f"Forest-type-group archive is not prepared/validated in {cache} (run prepare national)")

    land_cover_image = _prepared_member(cache, NLCD_LANDCOVER)
    canopy_image = _prepared_member(cache, NLCD_TCC)

    with rasterio.open(forest_image) as groups:
        codes = _sample_raster(groups, warp_transform, points)
    with rasterio.open(elevation_path) as dem:
        elevations_m = _sample_raster(dem, warp_transform, points)
    land_cover_codes = None
    if land_cover_image is not None:
        with rasterio.open(land_cover_image) as cover:
            values = _sample_raster(cover, warp_transform, points, extra_nodata=NLCD_LANDCOVER["noDataValues"])
        land_cover_codes = [None if value is None else int(value) for value in values]
    canopy_percent = None
    if canopy_image is not None:
        with rasterio.open(canopy_image) as canopy:
            canopy_percent = _sample_raster(canopy, warp_transform, points,
                                            extra_nodata=NLCD_TCC["noDataValues"])
    soil_columns = ({key: [None] * len(points) for key in SOIL_COLUMNS}
                    if not soil_prepared else merge_soil_samples(soil_prepared, points))

    rows = []
    for index, (lat, lon) in enumerate(points):
        record = forest_group_record(None if codes[index] is None else int(codes[index]))
        group_name = record["forest_group"]
        cover = land_cover_record(None if land_cover_codes is None else land_cover_codes[index])
        land_cover_ready = land_cover_codes is not None
        rows.append({
            "cell_id": f"{lat:.3f}_{lon:.3f}", "lat": lat, "lon": lon,
            "land_class": cover["land_class"] if land_cover_ready
                          else (group_name or ("not_forest_mapped" if codes[index] is not None else None)),
            "forest": cover["forest"] if land_cover_ready else record["forest"],
            "forest_mapped": record["forest_mapped"],
            "deciduous": cover["deciduous"] if land_cover_ready else None,
            "open_land": cover["open_land"] if land_cover_ready else None,
            "pasture": cover["pasture"] if land_cover_ready else None,
            "canopy": canopy_fraction(None if canopy_percent is None else canopy_percent[index]),
            "elevation_ft": meters_to_feet(elevations_m[index]),
            "drainage_class": soil_columns["drainage_class"][index],
            "awc_25_cm": soil_columns["awc_25_cm"][index],
            "awc_50_cm": soil_columns["awc_50_cm"][index],
            "flood_frequency": soil_columns["flood_frequency"][index],
            "hydrologic_group": soil_columns["hydrologic_group"][index],
            "slope_deg": soil_columns["slope_deg"][index],
            "access_class": None, "access_category": None, "property_name": None, "access_manager": None,
            "forest_group": group_name, "forest_type_code": record["forest_type_code"],
            **{key: record[key] for key in FOREST_SIGNAL_CLASSES},
            "evergreen": cover["evergreen"] if land_cover_ready else None,
            "mixed_forest": cover["mixed_forest"] if land_cover_ready else None,
            "wetland": cover["wetland"] if land_cover_ready else None,
        })

    soil_ready = soil_prepared is not None and len(soil_prepared) > 0
    components = habitat_components(True, True, land_cover_image is not None, canopy_image is not None, soil_ready)
    status = "AVAILABLE" if all(components[key] == "AVAILABLE" for key in HABITAT_REQUIRED_COMPONENTS) else "PARTIAL"
    unbuilt = []
    if components["canopy"] != "AVAILABLE":
        unbuilt.append("canopy")
    if components["landCover"] != "AVAILABLE":
        unbuilt.append("nlcdLandCover")
    if components["soil"] != "AVAILABLE":
        unbuilt.append(SOIL_COMPONENT)
    unbuilt.append("access")
    sources = [
        {"id": FOREST_GROUP["id"], "provider": FOREST_GROUP["provider"], "dataset": FOREST_GROUP["dataset"],
         "sha256": FOREST_GROUP["sha256"], "crs": FOREST_GROUP["crs"],
         "resolutionM": FOREST_GROUP["resolutionM"], "citation": FOREST_GROUP["citation"],
         "caveat": FOREST_GROUP["caveat"]},
        {"id": DEM_1ARC["id"], "provider": DEM_1ARC["provider"], "dataset": DEM_1ARC["dataset"],
         "sourceUrl": dem_source_url, "datasetVersion": dem_version, "crs": DEM_1ARC["crs"],
         "units": "meters", "citation": DEM_1ARC["citation"], "caveat": DEM_1ARC["caveat"]},
    ]
    units = {"elevation_ft": "feet", "sourceElevation": "meters", "canopy": "fraction 0..1 (source percent / 100)"}
    if land_cover_ready:
        sources.append({"id": NLCD_LANDCOVER["id"], "provider": NLCD_LANDCOVER["provider"],
                        "dataset": NLCD_LANDCOVER["dataset"], "sha256": NLCD_LANDCOVER["sha256"],
                        "crs": NLCD_LANDCOVER["crs"], "resolutionM": NLCD_LANDCOVER["resolutionM"],
                        "citation": NLCD_LANDCOVER["citation"], "caveat": NLCD_LANDCOVER["caveat"],
                        "legend": {str(code): name for code, name in NLCD_LANDCOVER["legend"].items()},
                        "derivation": {"forest": sorted(LAND_COVER_FOREST), "deciduous": sorted(LAND_COVER_DECIDUOUS),
                                       "open": sorted(LAND_COVER_OPEN), "evergreen": [42], "mixedForest": [43],
                                       "wetland": [90, 95]}})
        units["landCover"] = "categorical class sampled at the cell center"
    if canopy_image is not None:
        sources.append({"id": NLCD_TCC["id"], "provider": NLCD_TCC["provider"], "dataset": NLCD_TCC["dataset"],
                        "sha256": NLCD_TCC["sha256"], "crs": NLCD_TCC["crs"],
                        "resolutionM": NLCD_TCC["resolutionM"], "citation": NLCD_TCC["citation"],
                        "caveat": NLCD_TCC["caveat"], "sourceUnits": "percent 0..100"})
        units["canopySourcePercent"] = "percent 0..100"
    if soil_ready:
        sources.extend(entry["source"] for entry in soil_prepared)
    version_parts = [FOREST_GROUP["datasetVersion"], dem_version]
    if land_cover_ready:
        version_parts.append(NLCD_LANDCOVER["datasetVersion"])
    if canopy_image is not None:
        version_parts.append(NLCD_TCC["datasetVersion"])
    if soil_ready:
        version_parts.extend(entry["datasetVersion"] for entry in soil_prepared)
    meta = {
        "datasetVersion": f"habitat-bulk-v2:{'+'.join(version_parts)}@step{step}",
        "sourceUrl": FOREST_GROUP["url"],
        "status": status,
        "components": components,
        "requiredComponents": list(HABITAT_REQUIRED_COMPONENTS),
        "statusNote": ("Composed from mapped FIA forest-type-group classes and 3DEP elevation"
                       + (", Annual NLCD land cover" if land_cover_ready else "")
                       + (", NLCD tree canopy" if canopy_image is not None else "")
                       + (", NRCS soil" if soil_ready else "")
                       + (". Soil is absent in this tile (null, not zero) and remains UNBUILT."
                          if not soil_ready else ".")
                       + ("" if status == "AVAILABLE" else " Required habitat components are missing; the tile is PARTIAL.")),
        "sources": sources,
        "units": units,
        "unbuilt": unbuilt,
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
        response = service_request('get', query, params=payload, timeout=timeout)
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
        # Some perimeter-heavy tiles make ArcGIS fail while serializing one
        # large GeoJSON response. Small, stable pages return the same records
        # and keep restart/retry behavior bounded. The service-side geometry
        # offset matches the five-decimal precision persisted below.
        "orderByFields": "objectid",
        "maxAllowableOffset": 0.00001,
        "resultRecordCount": 50,
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
    """Prepared Census state polygons for authoritative jurisdiction by point.

    Returns (state_code, state_name, ambiguous). `ambiguous` is True when the point
    lies within the dataset's simplification tolerance of the resolved state's
    boundary, where the published geometry cannot distinguish this state from its
    neighbour. Ambiguous jurisdiction is left unresolved so no state-scoped rule can
    leak across the line; the property geometry is still published.
    """
    import shapefile
    import zipfile

    from shapely.geometry import Point, shape
    from shapely.prepared import prep

    tolerance = float(STATES.get("toleranceDegrees", 0.02))
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
            entries.append((fields["STUSPS"], fields["NAME"], prep(geom), geom.bounds, geom))

    def resolve(lon: float, lat: float):
        point = Point(lon, lat)
        for code, name, prepared, bounds, geom in entries:
            if bounds[0] <= lon <= bounds[2] and bounds[1] <= lat <= bounds[3] and prepared.contains(point):
                return code, name, geom.boundary.distance(point) < tolerance
        return None, None, False

    return resolve


def public_land_property_id(name: str, manager: str, category: str | None,
                            designation: str | None, state_code: str | None) -> str:
    """Stable identity for a published public-land record.

    The hosted PAD-US layer exposes no reliable unit identifier, so identity is a
    composite of authoritative attributes plus the Census-resolved state. Two
    different properties that share a name in different states (or with different
    designations) never collapse into one record; the same unit clipped into two
    tiles in the same state keeps one identity and is deduplicated by the browser.
    """
    key = "|".join([name or "", manager or "", category or "", designation or "", state_code or "UNKNOWN"])
    return hashlib.sha1(key.encode()).hexdigest()[:16]


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
        "outFields": "Pub_Access,BndryName,Unit_Nm,MngNm_Desc,Category,DesTp_Desc,FeatClass,ST_Name",
        "returnGeometry": "true",
        "maxAllowableOffset": 0.00025,
        "resultRecordCount": 2000,
    }, cache, f"padus_v2_{tile_id}", timeout), tile_id)
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
        category = (attributes.get("Category") or "").strip() or None
        designation = (attributes.get("DesTp_Desc") or "").strip() or None
        record = grouped.setdefault((name, manager, category, designation),
                                    {"geometries": [], "access": set()})
        record["geometries"].append(clipped)
        record["access"].add(access)
    rows = []
    for (name, manager, category, designation), record in sorted(grouped.items(), key=lambda item: item[0][0]):
        merged = record["geometries"][0]
        for extra in record["geometries"][1:]:
            merged = merged.union(extra)
        bounds = tuple(round(value, 5) for value in make_valid(merged).bounds)
        representative = make_valid(merged).representative_point()
        access = next(iter(record["access"])) if len(record["access"]) == 1 else "MIXED"
        state_code, state_name, ambiguous = resolve_state(representative.x, representative.y)
        if ambiguous:
            state_code, state_name = None, None
        rows.append({
            "property_id": public_land_property_id(name, manager, category, designation, state_code),
            "property_name": name, "manager": manager,
            "property_type": pad_property_type(name, manager),
            "ownership_class": "PRIVATE" if "private" in manager.lower() else access,
            "access_class": access, "state_name": state_name, "state_code": state_code,
            "jurisdiction_confidence": ("ambiguous-near-boundary" if ambiguous
                                        else ("authoritative" if state_code else "unresolved")),
            "jurisdiction_source": STATES["datasetVersion"] if state_code else None,
            "geometry_json": json.dumps(_round_geometry(shapely_mapping(make_valid(merged))), separators=(",", ":")),
            "min_lon": bounds[0], "min_lat": bounds[1],
            "max_lon": bounds[2], "max_lat": bounds[3],
            "center_lat": round((bounds[1] + bounds[3]) / 2, 5), "center_lon": round((bounds[0] + bounds[2]) / 2, 5),
            "geometry_source": "PAD-US (public access schema, hosted service)",
            "source_url": "https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-download",
            "source_category": category, "source_designation": designation,
        })
    meta = {
        "datasetVersion": f"{PADUS['datasetVersion']}+{STATES['datasetVersion']}",
        "sourceUrl": PADUS["query"],
        "status": "AVAILABLE" if rows else "VERIFIED_EMPTY",
        "statusNote": ("PAD-US public-access polygons intersecting this tile, clipped to the tile and each assigned "
                       "an authoritative state jurisdiction by point-in-polygon against Census boundaries. PAD-US "
                       "ST_Name is discarded as jurisdiction because it reads 'Not Applicable' for federal units, and "
                       "BndryID likewise reads 'Not Applicable', so property identity is the authoritative "
                       "name+manager+category+designation composite plus the resolved state. Same-named units inside "
                       "one tile/state are grouped; the same unit clipped into two same-state tiles keeps one identity "
                       "and is deduplicated by the browser; a unit on a state line becomes one jurisdiction-scoped "
                       "record per state. A property whose point lies within the simplification tolerance of a state "
                       "boundary is published with jurisdiction_confidence='ambiguous-near-boundary' and no state, so "
                       "its geometry remains visible while no state-scoped collecting rule can apply; properties "
                       "outside every state are kept as 'unresolved' for the same reason."),
        "source": [{"id": PADUS["id"], "provider": PADUS["provider"], "dataset": PADUS["dataset"],
                    "caveat": PADUS["caveat"]},
                   {"id": STATES["id"], "provider": STATES["provider"], "dataset": STATES["dataset"],
                    "sha256": STATES["sha256"], "citation": STATES["citation"], "caveat": STATES["caveat"]}],
    }
    write_parquet(out / "pl" / f"{tile_id}.parquet", rows, PUBLIC_LAND_COLUMNS, meta)
    return {**meta, "properties": len(rows), "tile": tile_id}
# ─ CLI ────────────────────────────────────────────────────────────────


def source_registry() -> dict:
    return {"forestTypeGroups": FOREST_GROUP, "elevation": DEM_1ARC, "landCover": NLCD_LANDCOVER,
            "canopy": NLCD_TCC, "fire": MTBS, "publicLand": PADUS,
            "soilSda": SDA_SOIL, "soilGssurgo": GSSURGO, "soilGnatsgo": GNATSGO, "states": STATES}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sources_parser = sub.add_parser("sources", help="Print the pinned source registry and cache readiness")
    sources_parser.add_argument("--cache", type=Path, default=None)

    prepare_parser = sub.add_parser("prepare", help="Prepare pinned sources before any tile build")
    prepare_sub = prepare_parser.add_subparsers(dest="scope", required=True)
    national = prepare_sub.add_parser("national", help="Download/validate national products once")
    national.add_argument("--sources", default="forest-type,land-cover,canopy,states")
    national.add_argument("--cache", type=Path, default=Path("/tmp/fruiting-forecast-gis-sources"))
    tile = prepare_sub.add_parser("tile", help="Download/validate tile-scoped products (3DEP DEM)")
    tile.add_argument("--tile", required=True)
    tile.add_argument("--cache", type=Path, default=Path("/tmp/fruiting-forecast-gis-sources"))
    state = prepare_sub.add_parser("state", help="Prepare a state-scoped soil source (default: SDA SSURGO)")
    state.add_argument("--state", required=True)
    state.add_argument("--source", choices=["sda", "gssurgo", "gnatsgo"], default="sda",
                       help="sda = NRCS Soil Data Access SSURGO (default); gssurgo/gnatsgo = operator-supplied state package")
    state.add_argument("--archive", type=Path, default=None,
                       help="Operator-supplied NRCS state package for --source gssurgo|gnatsgo")
    state.add_argument("--cache", type=Path, default=Path("/tmp/fruiting-forecast-gis-sources"))

    access_prepare = prepare_sub.add_parser("access", help="Prepare a Geofabrik state PBF once (requires osmium, shapely and pyproj)")
    access_prepare.add_argument("--state", required=True, choices=["CO", "OR", "NM", "WA", "MI", "ME", "FL", "GA", "ID", "MT", "WY", "CA", "AZ", "NV"])
    access_prepare.add_argument("--snapshot", default="latest")
    access_prepare.add_argument("--refresh", action="store_true")
    access_prepare.add_argument("--pbf", type=Path, default=None)
    access_prepare.add_argument("--cache", type=Path, default=Path("/tmp/fruiting-forecast-gis-sources"))

    build_parser = sub.add_parser("build", help="Compose normalized tile layers from the local source cache")
    build_parser.add_argument("--tile", required=True, help="Fruiting Forecast tile ID, e.g. n40_w106")
    build_parser.add_argument("--cache", type=Path, default=Path("/tmp/fruiting-forecast-gis-sources"))
    build_parser.add_argument("--out", type=Path, default=Path("/tmp/fruiting-forecast-normalized"))
    build_parser.add_argument("--layers", default="habitat,public-land,fire",
                              help="Comma-separated subset of habitat,public-land,fire,access")
    build_parser.add_argument("--access-states", default="", help="Comma-separated prepared OSM state codes for --layers access")
    build_parser.add_argument("--step", type=float, default=STEP_DEGREES)
    build_parser.add_argument("--soil-states", default="",
                              help="Comma-separated state codes whose prepared NRCS soil should be composed into habitat")
    args = parser.parse_args()

    if args.command == "sources":
        output = source_registry()
        if args.cache:
            output["cache"] = {"path": str(args.cache), "manifest": load_cache_manifest(args.cache).get("sources", {})}
        print(json.dumps(output, indent=2))
        return
    if args.command == "prepare":
        if args.scope == "national":
            names = [name.strip() for name in args.sources.split(",") if name.strip()]
            print(json.dumps(prepare_national(args.cache, names), indent=2))
        elif args.scope == "tile":
            print(json.dumps(prepare_tile(args.cache, args.tile), indent=2))
        elif args.scope == "access":
            from fruiting_osm_access import prepare as prepare_access
            print(json.dumps(prepare_access(args.cache, args.state, args.refresh, args.snapshot, args.pbf), indent=2))
        else:
            print(json.dumps(prepare_state(args.cache, args.state, args.source, args.archive), indent=2))
        return

    soil_states = [name.strip() for name in args.soil_states.split(",") if name.strip()]
    soil_prepared = (soil_inputs(args.cache, soil_states, args.tile, args.step)
                     if soil_states else None)
    builders = {"habitat": lambda: build_habitat(args.tile, args.cache, args.out, args.step, soil_prepared),
                "public-land": lambda: build_public_land(args.tile, args.cache, args.out),
                "fire": lambda: build_fire(args.tile, args.cache, args.out)}
    if "access" in args.layers.split(","):
        from fruiting_osm_access import build as build_access
        if not args.access_states:
            raise SystemExit("--layers access requires --access-states with prepared state codes")
        builders["access"] = lambda: build_access(args.cache, args.access_states.split(","), args.tile, args.out)
    for layer in [name.strip() for name in args.layers.split(",") if name.strip()]:
        if layer not in builders:
            raise SystemExit(f"Unknown layer: {layer}")
        result = builders[layer]()
        if layer == "access":
            print(json.dumps(result, indent=2))
            continue
        rows = result.get("cells") or result.get("properties") or result.get("perimeters") or 0
        print(f"{layer}: {result['status']} · {rows} rows · {result['datasetVersion']}")


if __name__ == "__main__":
    main()
