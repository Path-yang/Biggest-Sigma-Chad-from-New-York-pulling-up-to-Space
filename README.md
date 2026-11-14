# Burn Calendar

**Live site: [sigmachadsinspace.gay](https://sigmachadsinspace.gay/)**

An interactive page that shows one consistent fire-hotspot record for New York and California, January 2001 to December 2025, built from NASA's MODIS and VIIRS satellite sensors.

VIIRS reports several times more hotspots than MODIS for the same fires, so joining the two records naively creates a false jump in 2012. The page converts the MODIS years into VIIRS-equivalent counts and shows the evidence for that conversion.

## Run it

The page is live at [sigmachadsinspace.gay](https://sigmachadsinspace.gay/). To run it locally you need no build step and no install. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

Then go to <http://localhost:8000>.

The page fetches three things from the network: its fonts (Google Fonts), three.js for the globe (cdnjs), and street-map tiles when you zoom far in (OpenStreetMap). Without a connection it uses system fonts, shows plain buttons in place of the globe, and draws its own roads in place of the street map.

## What you can do

- Start on a globe and pick New York or California, or compare the two states side by side.
- Drill into the hexagon map: click a county, then a hexagon, then keep zooming to 2 km hexagons, roads, and fire and EMS stations.
- Switch the map between past hotspots and the chance of fire in a chosen month.
- Drag along the timeline, or press play, to see where each year burned.
- Find a town or city, draw a box on the map, or enter a point and radius.
- Open the full data for the selected area: the busiest months, the worst years, whether a given month was unusual, the counties to watch, the full calendar and the evidence for the conversion.
- Choose a range of years and a colour palette.
- Download the monthly calendar or the hexagon hotspots as CSV for the current selection.

## Files

| File | Contents |
| --- | --- |
| `index.html` | The page's markup and styles. |
| `data.js` | The data, about 3.7 MB: monthly counts per county and per hexagon, the 2 km hexagon detail, county outlines, roads, towns, fire and EMS stations, the globe's outlines and Earth texture, exchange rates and validation results. |
| `app.js` | The page's logic, built from `src/`. It is committed so that the site needs no build step. |
| `src/` | The TypeScript source for `app.js`. |
| `package.json`, `tsconfig.json` | Build and type-check settings. |

## Change the code

You need Node.js 18 or later.

```sh
npm install
npm run check
```

`npm run check` type-checks `src/` and rebuilds `app.js`. `npm run watch` rebuilds `app.js` each time you save.

GitHub Pages serves this repository as it is, so commit the rebuilt `app.js` together with your source change. `index.html` loads `app.js?v=2` and `data.js?v=2`. Raise that number when either file changes, so that returning visitors do not get a stale cached copy.

## Method

1. Keep vegetation fires only, at nominal or high confidence, from MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (Suomi NPP).
2. Remove industrial heat sources: 500 m spots that VIIRS flags in 5 or more years, mostly at night.
3. Count hotspots per month in each county and hexagon.
4. On the overlap, February 2012 to December 2025, learn one exchange rate per calendar month: VIIRS hotspots divided by MODIS hotspots.
5. From 2012 use VIIRS as observed. Before that, multiply the MODIS count by the rate. Before July 2002 only Terra flew, so a Terra-only rate applies.
6. The 90% range on converted months comes from held-out errors, and is wider for small counts.

## Limits

- The record ends in December 2025.
- Converted months are estimates, and small areas are noisy. MODIS misses many small fires, so a converted zero can hide real burning.
- The 2 km hexagons cover 2012 onward. The chance of fire is measured on the years from 2012 whenever the chosen range includes them.
- Satellite outages and cloud cover are not corrected.
- A hotspot is a detection, not a fire count or burned area.

Data: NASA FIRMS active fire archive. Street map tiles © OpenStreetMap contributors.

## World fire data

Every FIRMS yearly country file (MODIS 2000-2025, VIIRS Suomi NPP 2012-2025, VIIRS NOAA-20 2018-2025; 548.5 million detections, 238 countries) is published as Parquet at [rogeryzd/firms-active-fire-by-country](https://huggingface.co/datasets/rogeryzd/firms-active-fire-by-country) on Hugging Face. A web page can fetch any file from there directly.

- [scripts/build_world_parquet.py](scripts/build_world_parquet.py) downloads the archive from NASA and converts it. Each Parquet file is checked to reproduce its source CSV byte for byte.
- [dataset/README.md](dataset/README.md) is the dataset's description page on Hugging Face, with NASA's acknowledgement, disclaimer and data-use terms.

To rebuild it: `uv venv .venv && uv pip install --python .venv/bin/python duckdb huggingface_hub`, then `.venv/bin/python scripts/build_world_parquet.py`. It needs about 10 GB of download and 8 GB of disk; output goes to `build/hf/`, which git ignores.
