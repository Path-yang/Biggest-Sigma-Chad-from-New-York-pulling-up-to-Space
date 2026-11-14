# Burn Calendar

An interactive page that shows one consistent fire-hotspot record for New York and California, January 2001 to December 2025, built from NASA's MODIS and VIIRS satellite sensors.

VIIRS reports several times more hotspots than MODIS for the same fires, so joining the two records naively creates a false jump in 2012. The page converts the MODIS years into VIIRS-equivalent counts and shows the evidence for that conversion.

## Run it

There is no build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

Then go to http://localhost:8000.

The page loads its fonts from Google Fonts. Without a connection it falls back to system fonts.

## What you can do

- Switch between New York and California.
- Pick an area: the whole state, a county, a box drawn on the map, or a point and radius.
- Choose a range of years and a colour palette.
- Click any month in the calendar to test whether it was unusual for that calendar month.
- Download the monthly calendar or the gridded hotspots as CSV for the current selection.

## Files

| File | Contents |
| --- | --- |
| `index.html` | The page: markup, styles and all the logic. |
| `data.js` | The data, about 1.3 MB: monthly counts per county and per 0.1° grid cell, county outlines, exchange rates and validation results. |

## Method

1. Keep vegetation fires only, at nominal or high confidence, from MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (Suomi NPP).
2. Remove industrial heat sources: 500 m spots that VIIRS flags in 5 or more years, mostly at night.
3. Count hotspots per month in each county and 0.1° cell.
4. On the overlap, February 2012 to December 2025, learn one exchange rate per calendar month: VIIRS hotspots divided by MODIS hotspots.
5. From 2012 use VIIRS as observed. Before that, multiply the MODIS count by the rate. Before July 2002 only Terra flew, so a Terra-only rate applies.
6. The 90% range on converted months comes from held-out errors, and is wider for small counts.

## Limits

- The record ends in December 2025.
- Converted months are estimates, and small areas are noisy. MODIS misses many small fires, so a converted zero can hide real burning.
- Satellite outages and cloud cover are not corrected.
- A hotspot is a detection, not a fire count or burned area.

Data: NASA FIRMS.
