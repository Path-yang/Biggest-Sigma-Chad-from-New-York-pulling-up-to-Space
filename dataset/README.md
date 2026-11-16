---
license: other
license_name: nasa-esdis-data-use-guidance
license_link: https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance
pretty_name: NASA FIRMS active fire detections by country, 2000-2025 (Parquet)
language:
- en
tags:
- wildfire
- fire
- active-fire
- remote-sensing
- earth-observation
- modis
- viirs
- firms
- geospatial
- climate
size_categories:
- 100M<n<1B
configs:
- config_name: modis
  data_files:
  - split: train
    path: "modis/*/*.parquet"
  default: true
- config_name: viirs-snpp
  data_files:
  - split: train
    path: "viirs-snpp/*/*.parquet"
- config_name: viirs-jpss1
  data_files:
  - split: train
    path: "viirs-jpss1/*/*.parquet"
---

# NASA FIRMS active fire detections by country, 2000-2025 (Parquet)

This is an unofficial Parquet copy of the "yearly summary by country" active-fire files that NASA's Fire Information for Resource Management System (FIRMS) publishes as CSV. It holds 548,501,203 satellite fire detections from November 2000 to December 2025, for 238 countries and territories, from three sensors. It is not produced, endorsed or maintained by NASA.

Each row is one detection: a satellite pixel flagged as holding a fire or another heat source at the moment the satellite passed over. A detection is not a fire. One fire usually produces many detections, and small or short-lived fires are often missed.

The files hold the same rows, in the same order, with the same values as NASA's CSV files. Writing any file back out as CSV text reproduces the source file byte for byte.

## What is in it

| Folder | Satellite | Instrument | Pixel size | Dates covered | Files | Detections |
| --- | --- | --- | --- | --- | ---: | ---: |
| `modis` | Terra and Aqua | MODIS | 1 km | 1 Nov 2000 to 31 Dec 2025 | 5,275 | 111,424,417 |
| `viirs-snpp` | Suomi NPP | VIIRS | 375 m | 20 Jan 2012 to 31 Dec 2025 | 3,062 | 281,144,514 |
| `viirs-jpss1` | NOAA-20 | VIIRS | 375 m | 1 Apr 2018 to 31 Dec 2025 | 1,758 | 155,932,272 |
| Total | | | | | 10,095 | 548,501,203 |

The Parquet files total 7.76 GB. The CSV files they were made from total 43.47 GB.

In the MODIS files, Terra detections start on 1 November 2000 and Aqua detections on 4 July 2002.

The copy was made on 14 November 2026 from files NASA last updated on 10 October 2026. FIRMS states that these files are based on standard processing, the quality-controlled record, not the near-real-time feed. This copy does not update itself.

## Layout

```text
<sensor>/<year>/<sensor>_<year>_<Country>.parquet
summary/v3/<Country>.json and summary/v3/index.json   (v2 plus 2026 to date; see Country summaries with 2026)
summary/v2/<Country>.json and summary/v2/index.json   (derived; see Country summaries)
summary/v1/...                                         (earlier method, kept as published)
forecast/v1/<Country>.json and forecast/v1/index.json (derived; see Forecast)
stations/v3/<Country>.json and stations/v3/index.json (OpenStreetMap + Overture Maps; see Fire stations v3)
stations/v2/<Country>.json and stations/v2/index.json (OpenStreetMap, ODbL; see Fire stations)
stations/v1/...                                        (earlier fire filter, kept as published)
fine/v1/<Country>/<tx>_<ty>.json and fine/v1/index.json  (0.05 degree yearly tiles; see Fine grid)
provinces/v1/<Country>.json, index.json and rank.json    (states and provinces, monthly; see Provinces)
manifest.csv
firms_index.csv
AttributesReadme.txt
build_world_parquet.py
```

- **Data files.** There is one file per sensor, year and country, named as FIRMS names its CSV files. For example, `viirs-snpp/2020/viirs-snpp_2020_Australia.parquet`.
- **Country names.** These are NASA's, with underscores for spaces: `United_States`, `Democratic_Republic_of_the_Congo`, `Cote_d_Ivoire`, `Timor-Leste`. Dependent territories such as `Greenland` and `Guam` have their own files.
- **Missing files.** A country has a file for a year only if that sensor recorded at least one detection there in that year. Each sensor-year has between 163 and 225 files.
- **`manifest.csv`.** One line per data file: path, sensor, year, country, row count, first and last date, the size and SHA-256 of the source CSV, the Parquet size, and the date NASA last updated the source.
- **`firms_index.csv`.** NASA's own index of the source files, as it stood when this copy was made.
- **`AttributesReadme.txt`.** The readme NASA ships beside the CSV files.
- **`build_world_parquet.py`.** The script that made this copy.

Any file can be fetched directly:

```text
https://huggingface.co/datasets/rogeryzd/firms-active-fire-by-country/resolve/main/viirs-snpp/2020/viirs-snpp_2020_Australia.parquet
```

## Columns

The two VIIRS folders share one set of columns. MODIS differs in the two brightness columns and in how confidence is recorded. No column has missing values in any file.

| Column | Type | Meaning |
| --- | --- | --- |
| `latitude`, `longitude` | double | Centre of the fire pixel, in WGS84 degrees. For MODIS this is the centre of a 1 km pixel, not necessarily the location of the fire inside it. |
| `brightness` (MODIS) | double | Brightness temperature of the pixel in channel 21/22, in kelvin. |
| `bright_ti4` (VIIRS) | double | Brightness temperature of the pixel in channel I-4, in kelvin. |
| `scan`, `track` | double | Actual size of the pixel along the scan and along the track. Pixels grow toward the edge of the swath. NASA gives no unit; the values are consistent with kilometres (MODIS 1.0 to 4.8, VIIRS 0.32 to 0.80). |
| `acq_date` | date | Date of the satellite overpass, UTC. |
| `acq_time` | string | Time of the overpass, UTC, as four digits `HHMM`. `0637` is 06:37. |
| `satellite` | string | `Terra` or `Aqua` in MODIS files. `N` (Suomi NPP) in `viirs-snpp`. `N20` (NOAA-20) in `viirs-jpss1`. |
| `instrument` | string | `MODIS` or `VIIRS`. |
| `confidence` (MODIS) | integer | Detection confidence, 0 to 100 percent. NASA's classes: below 30 low, 30 to below 80 nominal, 80 and above high. |
| `confidence` (VIIRS) | string | `l` low, `n` nominal, `h` high. |
| `version` | string | Collection and processing version, as NASA wrote it. MODIS files hold `6.2` (in 2000 to 2017), `6.03` (in 2000 to 2022) and `61.03` (2023 to 2025). VIIRS files hold `2`. NASA's documentation does not define these exact values. |
| `bright_t31` (MODIS) | double | Brightness temperature of the pixel in channel 31, in kelvin. |
| `bright_ti5` (VIIRS) | double | Brightness temperature of the pixel in channel I-5, in kelvin. |
| `frp` | double | Fire radiative power of the pixel, in megawatts. |
| `daynight` | string | `D` daytime, `N` night-time. |
| `type` | integer | What NASA infers the heat source to be: `0` presumed vegetation fire, `1` active volcano, `2` other static land source, `3` offshore. |

NASA's definitions are at [Active Fire Data Attributes for MODIS and VIIRS](https://www.earthdata.nasa.gov/data/tools/firms/active-fire-data-attributes-modis-viirs).

## Reading the data

With DuckDB, one file:

```sql
SELECT acq_date, count(*) AS detections
FROM read_parquet('hf://datasets/rogeryzd/firms-active-fire-by-country/viirs-snpp/2020/viirs-snpp_2020_Australia.parquet')
GROUP BY acq_date
ORDER BY acq_date;
```

Every year for one country:

```sql
SELECT year(acq_date) AS year, count(*) AS detections
FROM read_parquet('hf://datasets/rogeryzd/firms-active-fire-by-country/modis/*/modis_*_Brazil.parquet')
WHERE type = 0
GROUP BY year
ORDER BY year;
```

The country is not a column. When reading several countries at once, add `filename = true` to `read_parquet` to get each row's file path.

With the `datasets` library, one sensor at a time, since MODIS and VIIRS have different columns:

```python
from datasets import load_dataset

modis = load_dataset("rogeryzd/firms-active-fire-by-country", "modis", split="train", streaming=True)
```

From a web page, fetch the file URL shown under Layout. As of November 2026, Hugging Face allows cross-origin requests and byte-range requests on these URLs, and limits anonymous visitors to 3,000 file requests per five minutes per IP address.

## Country summaries

`summary/v2/` holds one small JSON file per country, `summary/v2/<Country>.json`, and a list of them, `summary/v2/index.json`. They exist so a web page can show a country's fire history from one request of a few kB to 1.4 MB (median 66 kB) instead of hundreds of MB of Parquet.

Unlike the rest of this dataset, these files are derived and harmonized: they are counts and estimates computed from the raw files, not a copy of them.

**What is counted.** Vegetation fires only (`type` 0) at nominal or high confidence: MODIS `confidence` of 30 or more, VIIRS `n` or `h`. January 2001 to December 2025. On top of that, a 0.05 degree square is left out for a whole calendar year, for every sensor, when any of the three sensors flags any detection there that year as a volcano, other static land source or offshore (`type` 1, 2 or 3). The sensors do not flag the same sources: in the 2014 Holuhraun eruption in Iceland, for example, Suomi NPP reported 49,776 detections over the lava field as `type` 0, while MODIS flagged 8,169 of its 8,227 there as `type` 2. Without the mask, lava and some flares count as vegetation fire for VIIRS only, which distorts the exchange rates below. Over all countries the mask removes 1.2% of counted MODIS detections and 3.6% of Suomi NPP ones (Brazil: 1.0% and 2.5%), and far more where there are many flares or eruptions.

**What each file holds.**

- `monthly`: counts per month for Terra (`T`), Aqua (`A`), Suomi NPP VIIRS (`V`) and NOAA-20 VIIRS (`N20`), 300 values each. Month index is `(year - 2001) * 12 + (month - 1)`.
- `r_ta`, `r_t`: a VIIRS-per-MODIS exchange rate for each calendar month, for Terra and Aqua together and for Terra alone, with a 90% range for `r_ta` (`r_ta_lo`, `r_ta_hi`) and the all-months rate `r_all`.
- `pi`, `zero_hi`: 90% range multipliers for converted values, by size (bins up to 10, 100, 1000 and above), and the top of the range when a converted month is zero (at least 1).
- `val`: leave-one-year-out validation, 2012 to 2025, per year and in summary.
- `cell`, `cells`, `cell_rows`: a grid of 0.1, 0.25, 0.5 or 1 degree cells (the finest that keeps the file under about 1.5 MB). Each row is cell, year, harmonized count, raw MODIS Terra+Aqua count, raw Suomi NPP count. A cell's indices are `floor(lat / cell)` and `floor(lon / cell)`.
- `bbox`, `totals`, `source`, and a display `name`. `bbox` is the extent of the counted detections; for countries that cross the 180th meridian it runs from about -180 to 180.

**Harmonization.** VIIRS sees several times more detections than MODIS for the same burning, so the two records cannot be joined directly. On the overlap, February 2012 to December 2025, each country gets one exchange rate per calendar month: Suomi NPP detections divided by MODIS detections. From February 2012 the Suomi NPP count is used as observed. Before that, the MODIS count is multiplied by the rate, with a Terra-only rate before July 2002, when Aqua had not yet started. The harmonized grid values apply the same rule month by month and are then summed per year.

**Small countries.** A country with few detections cannot support twelve rates of its own. Each monthly rate is shrunk toward the country's all-months rate with a pseudo-count of 30 MODIS detections, and the all-months rate toward the global rate (4.04) with a pseudo-count of 300. These values were chosen by leave-one-year-out error across the 203 countries with at least 50 Suomi NPP detections on the overlap: they bring the mean held-out monthly error from 0.59 with almost no pooling to 0.39, within 1% of the best pair tried. Each file's `rate_note` says how much of its rates came from its own data. It also warns when the held-out monthly error is above 100% (29 countries, mostly small islands and territories with few detections, and Iceland, whose 2021 eruption both sensors report as vegetation fire), and when the all-months rate is more than twice the global one (7 countries, all oil and gas producers), where flares that VIIRS reports and MODIS does not may push the converted years too high.

**Ranges.** The 90% range multipliers are the 5th and 95th percentiles of observed divided by predicted over held-out months, for the country as a whole and for its 1 degree cells. A size bin with fewer than 30 such months uses the value pooled over all countries, and every range includes the estimate itself.

**Limits.** FIRMS's `type` flag, through the mask above, stands in for a hand-made mask of industrial sites, and an eruption or flare that no sensor flags stays in the counts. Converted months are estimates, and a converted zero can hide real burning. A change of method is published under a new folder rather than by rewriting an old one.

**Earlier version.** `summary/v1/` is the first method, without the static-source mask, kept for anyone who used it. Its files have `"v": 1`. On 14 November 2026 its `cells` were corrected: every grid square west of Greenwich had been written as `floor(lat / cell) - 1` and `floor(lon / cell) + 100000`. Nothing else in v1 changed.

## Country summaries with 2026 to date (v3)

`summary/v3/` is `summary/v2` extended with 2026, from 1 January to **14 November 2026**, the last complete day. It has the same files, `summary/v3/<Country>.json` and `summary/v3/index.json`, with `"v": 3`. Every value for 2001-2025 is the same as in v2; the scripts check this for every country. `summary/v2` stays as published.

**Where 2026 comes from.** FIRMS has not published 2026 country files, so 2026 was downloaded from the FIRMS API for the whole world, one request per satellite and day, and each detection was given a country by point-in-polygon on Natural Earth 1:10m boundaries. That puts 99.93% of 2025's archive detections in the same country as FIRMS does. VIIRS and MODIS are standard processing to 31 July (VIIRS) and 31 August (MODIS), and near real time after that.

**Same unit, same filters.** A count is still the number of VIIRS hotspot detections: 375 m pixels flagged as burning on one overpass, at nominal or high confidence, vegetation fires only. It measures fire activity, not the number of separate fires. There were no duplicate rows to remove. The static-source mask is rebuilt for 2026 as a same-year mask like v2's, but from VIIRS flags only: a 0.05 degree square is left out for all of 2026 when any 2026 VIIRS detection there is flagged type 1, 2 or 3. v2 also drops squares that MODIS flags. That was left out for 2026 because adding MODIS flags made the rerun on 2025 worse (median country 1.7% off v2 instead of 0.85%), and it is the main reason gas-flaring countries such as Libya and Iraq differ from v2 (`y2026.join_check_2025`). Near-real-time data have no `type` column, so from August a detection counts as flagged when a flagged archive detection (2021-2025) or a flagged 2026 standard-processing detection lies within 0.01 degree. A mask taken from 2023-2025 alone did not reproduce v2: it missed lakeside fire pixels, which VIIRS flags as offshore and which move with each year's fires, and put Canada 92% too high. Rerun on 2025 and compared with v2, this method gives the world total within 0.7% and 126 countries with at least 1,000 detections a year within a median 0.85%. 17 countries were more than 5% off, and their files carry a warning: Libya, Canada, Iraq, Uzbekistan, Italy, Fiji, Germany and Greece by 8-23%, and others by 5-7%.

**Suomi NPP stays the reference, and the satellites are never added.** `monthly.V` continues as Suomi NPP. Each day of each country comes from one source, never two:

- Suomi NPP, on the days it delivered.
- NOAA-20's count times that country's NOAA-20-to-Suomi NPP rate for the calendar month, on the 33 days Suomi NPP did not deliver in full: outages on 10-12 March, 28-30 April, 1-2 June, 10-16 July, 3-4 and 18 August and 12-13 October, and 2-14 November, after Suomi NPP stopped. The same applies, country by country, on 7 days that look complete for the world but have fewer than 22 UTC hours of Suomi NPP data (9 March, 1 May, 17 July, 9 September, 9, 28 and 30 October), where the missing hours hold at least a quarter of the country's usual detections (a satellite sees a place at about the same UTC hours every day) or Suomi NPP saw under 40% of NOAA-20's converted count there: 151 country-days, for example 9 March for the United States, Mexico and Thailand.
- On 12 October NOAA-20 also lacks hours (about 09-14 and after 17 UTC) while Suomi NPP is partial, so neither satellite saw Africa's or the Americas' afternoon passes. For each country the satellite that covered its usual hours better is used; where neither covered three quarters of them, the day is the mean of the days either side (11 and 13 October) in Suomi NPP terms, with a range from what was seen to the larger neighbour (53 countries, among them Mozambique, Zambia, Madagascar, Tanzania, Zimbabwe and the United States).

`y2026.conv_months` lists each month's converted days with the reason, `interp_days` and `v_interp` for the estimated day, and `v_interp` sits beside `v_obs` and `v_conv` (V = v_obs + v_conv + v_interp). The rates are learned on 2018-2025 from days on which both satellites delivered normally, with the same shrinkage toward the country's and the global rate (1.017) as the MODIS rates, and with pseudo-counts chosen by leave-one-year-out error. Tested by holding out each year of 2018-2025 in turn, converting its NOAA-20 counts with rates learned on the other years and comparing them with what Suomi NPP saw: whole months were off by 2.7% (all country-months pooled; 3.3% with no rate at all), the median country with at least 10,000 overlap detections was off by 1.9% a year and 5.8% a month, and the 2-14 November window was off by 5.3% pooled. 89.5% of held-out months and windows fell inside their 90% range. `y2026` in each file lists the converted days of each month, the converted part and a 90% range from the held-out errors. `monthly.N20` is NOAA-20 as observed, and `y2026.v_obs` is the part Suomi NPP observed itself.

**A partial year.** The monthly arrays now hold 311 values. Index 310 is November 2026, days 1-14 only. December 2026 is absent, not zero. `last_date`, `n_months` and `partial` say this in each file. To compare the partial month fairly, each file has `y2026.same_days`, the count for 1-14 November in every year from 2012, with its median and quartiles, and `y2026.ytd`, the count from 1 January to 14 November in every year (2012 includes January 2012 converted from MODIS, as in the monthly record, since Suomi NPP starts on 20 January 2012). Both are computed from the daily archive with v2's exact filters, and summing the daily counts reproduces v2's monthly values for all 79,968 country-months from 2012 to 2025. The history is given as in v2 and also with Suomi NPP's own past outages filled from NOAA-20 the same way as 2026. Those outage months are listed in `y2026.hist_gaps` with the v2 value, the filled value (`filled`, with `lo` and `hi`) and the converted NOAA-20 part; the largest are July-August 2022 and July 2024. `monthly.V` keeps v2's values; the site uses the filled values, so past months are built by the same rule as 2026.

**Index.** `total` in `summary/v3/index.json` runs to 14 November 2026. `total_2001_2025` is v2's total and `total_2026` is 2026 to date.

**MODIS in 2026.** `monthly.T` and `monthly.A` for 2026 are shown, not used: from February 2012 the record is VIIRS. Near-real-time MODIS from September has no `type`, so it uses the 2026 VIIRS mask plus the squares of 2026 MODIS detections flagged type 1-3.

## Monthly cells (cells/v1)

`cells/v1/<Country>.json` gives the harmonized count for every grid cell and every month, January 2001 to 14 November 2026, so a page can sum any drawn area month by month. `cells/v1/index.json` lists the 238 files with their grid size and bytes.

**Format.** `cell` (degrees), `cells` (flat pairs `floor(lat / cell)`, `floor(lon / cell)`), and `rows`, flat triples of cell index, month index (`(year - 2001) * 12 + month - 1`) and value. Values are harmonized hotspots in Suomi NPP terms, to one decimal; only nonzero values are written, sorted by cell, then month. `n_months` (311) and `partial` (November 2026 is days 1-14) are the same as in summary/v3. For 235 countries the grid is summary/v3's, with the same cell indexes. In 63 of them a few cells are appended after v3's (245 in all): squares that only have NOAA-20 detections on past Suomi NPP outage days. Brazil and the United States (0.5 to 1 degree) and the Democratic Republic of the Congo (0.25 to 0.5) are on a 2x2 coarser grid to keep each file under 4 MB; `same_grid_as_v3` and `note` say so. An appended cell can lie just outside v3's `bbox`, so map bounds should come from the file's own `cells`.

**Method.** Each cell uses the country series' rule: MODIS times the country's monthly rate to January 2012 (Terra alone before July 2002), Suomi NPP from February 2012, and 2026 by v3's day rule. In the months in `y2026.hist_gaps`, the outage days are filled per cell the way v3 fills the country: the cell's Suomi NPP detections on those days are replaced by its NOAA-20 detections times the country's NOAA-20 rate. The site's monthly value uses these filled values. Each month is rounded so that its cell total keeps the rounded country total; no value moves by 0.1 or more. Before February 2012 a cell's value is a whole MODIS count times the rate, so a small area moves in steps of the rate.

**Checks.** For every country-month, the cell sums of raw Terra, Aqua and Suomi NPP equal v3's `monthly` values exactly for 2001-2025. The cell sums of the harmonized values equal the site's monthly value within 0.9 hotspots, the remainder coming from v3's own rounding to whole numbers. Per cell and year, the unrounded values without the outage fill equal v3 `cell_rows` within 0.05. Files are 740 bytes to 3.8 MB (median 91 kB, 138 MB in all). Built by `scripts/build_cells_monthly.py`.

## Fine grid (fine/v1)

`fine/v1/` gives the harmonized count for every 0.05 degree cell (about 5.5 km) and every year, 2001 to 14 November 2026, cut into 5 x 5 degree tiles so a zoomed-in map loads only what is in view. Each country has a folder: `fine/v1/<Country>/<tx>_<ty>.json` per tile with fire, and `fine/v1/<Country>/index.json` with each file's bounding box and size and the country's yearly totals. `fine/v1/index.json` (62 kB) lists the 238 countries and, for each tile, which countries have a file there.

**Format.** Cell `[la, lo]` = `[floor(lat / 0.05), floor(lon / 0.05)]`; tile `tx = floor((lon + 180) / 5)`, `ty = floor((lat + 90) / 5)`. A tile's `rows` is a flat array of one record per cell: local row and column inside the tile (0-99, added to the file's `origin` to give `la`, `lo`), the cell's total, the number k of years with fire, then k pairs of year index (0 = 2001 ... 25 = 2026) and value. Values are harmonized hotspots in Suomi NPP terms, to one decimal; a year not listed is 0. Tiles over 1 MB (19 of them, in the tropical savanna belt) are split into latitude bands, `<tx>_<ty>_1.json` and `<tx>_<ty>_2.json`. A cell crossed by a border appears in each country's files with that country's detections (21,641 cells), so a world layer adds them.

**Method.** The same rule as `cells/v1`, cell by cell: MODIS times the country's monthly rate to January 2012, Suomi NPP from February 2012 with past outage days filled from NOAA-20, and 2026 by v3's day rule. Months are summed into years, and each country-year is rounded so that its cell total keeps the rounded country total. 2026 runs to 14 November. Rounding ties (cells with the same remainder) are broken by position, south first, which moves regional sums by up to about 0.02% in 2001-2011 (for example Minas Gerais a few dozen hotspots a year high, Pará and Roraima low); `provinces/v1` is built from exact monthly values and is not affected.

**Checks.** Raw Terra, Aqua and Suomi NPP summed over the fine cells equal v3's `monthly` values exactly for every country-month 2001-2025. Regridded to each country's v3 grid, the values equal v3 `cell_rows` within 0.05 per cell and year. Each country-month is within 0.05 of the `cells/v1` sum, and each country-year within 0.4. A spot check of 14 cell-years recomputed straight from the Parquet files above agrees to rounding. 1,892 tile files, median 14 kB, at most 1.0 MB, 186 MB in all (Brazil 17.8 MB, Russia 15.3 MB). Built by `scripts/build_fine_grid.py`.

## Provinces (provinces/v1)

`provinces/v1/` gives the harmonized monthly count, January 2001 to 14 November 2026, for every state or province (admin level 1) of the 238 countries: 4,650 in all. `provinces/v1/<Country>.json` holds each province's `monthly` series (311 values, one decimal), `per_year`, `total`, `usual` and `watch` per calendar month, `name`, `aliases`, `iso` (ISO 3166-2), `region`, `bbox`, `label`, `area_km2` and a simplified GeoJSON outline, plus the country's `country_monthly` and an `unassigned` part. `provinces/v1/index.json` lists every province with its name, Latin-script aliases, region, bbox, label point, total and 2016-2025 yearly mean, for search and world rankings, and every country's boundary source with a note where its units are out of date; `provinces/v1/rank.json` holds `usual` and `watch` for every province.

**Boundaries.** For 231 countries, [Natural Earth](https://www.naturalearthdata.com/) 1:10m Admin 1 – States, Provinces (natural-earth-vector 5.2.0-pre, not a tagged release; the file's SHA-256 is in every file's `source`), which is in the public domain; made with Natural Earth. The units are Natural Earth's: mostly the first-level division, but France's departments, Italy's and Spain's provinces and the United Kingdom's counties, with the first level in `region`. A province belongs to the FIRMS country whose Natural Earth map unit holds it, as on the globe. Where FIRMS files almost all of a province's fire under another country (85% or more), the province moves there: Crimea and Sevastopol are in `Ukraine.json`, as FIRMS files their detections. Crimea's number is therefore about 2% low: the 971 hotspots FIRMS files under Russia there stay with Russia (in Russia's `unassigned`). Outlines are simplified per country with GEOS coverage simplification, so neighbours keep identical borders, to at most 300 kB of geometry per file.

**Current units from geoBoundaries for seven countries.** Natural Earth's units are years out of date for Kenya (8 former provinces), DR Congo (11, before 2015), Ghana, Nepal, Sudan, Indonesia and Ethiopia, so these files use [geoBoundaries](https://www.geoboundaries.org/) (Runfola, D. et al. (2020) geoBoundaries: A global database of political administrative boundaries. *PLoS ONE* 15(4): e0231866) ADM1 instead: Kenya's 47 counties (gbOpen, from RCMRD GeoPortal and Africa GeoPortal, public domain), DR Congo's 26 provinces (from the Référentiel Géographique Commun), Ghana's 16 regions (Ghana Statistical Service), Nepal's 7 provinces (Survey Department of Nepal), Sudan's 18 states and the Abyei area (OCHA IMWG), Indonesia's 34 provinces of 2019 (OCHA ROAP) and Ethiopia's 11 regions and 2 cities (CSA and BoFED). The last six are gbHumanitarian files, shared through OCHA's Humanitarian Data Exchange under [CC BY 3.0 IGO](https://creativecommons.org/licenses/by/3.0/igo/); each of these country files names its source and licence in `source` and `licence`, and must be credited the same way if reused.

**Out-of-date units are marked.** Every country file and every country row of `index.json` has `boundaries` (Natural Earth or geoBoundaries), `outdated` and a note. 18 countries are marked: Angola (18 provinces; the 2024 reform made 21, so Cuando Cubango, Moxico and Luanda here are the former, larger provinces), Vietnam (63 provinces, merged into 34 in 2025), Madagascar, Tanzania, Central African Republic, Laos, Cambodia, Latvia (municipalities before 2021), Mali, Kazakhstan, Sierra Leone, Uganda, Papua New Guinea, Chad, Côte d'Ivoire, Burkina Faso, Indonesia (Papua and West Papua before the 2022 split into six) and Ethiopia (SNNP before its 2023 split into Central and South Ethiopia). A current name in those countries can find nothing, or a larger former unit.

**Names.** `name` is Natural Earth's English name, or Wikidata's English label where Natural Earth's is ambiguous or cut off ("Moscow", "Kyiv Oblast") and for geoBoundaries units. `aliases` add Natural Earth's other name fields in 26 languages and [Wikidata](https://www.wikidata.org/)'s English labels and aliases (CC0), so "Kyiv", "Moscow Oblast", "Yakutia", "Mexico City", "NSW", "Jawa Barat" and "Narok County" all match. Matching reads `&` as "and". An alias points at one province only; where two units share their own name (Cork city and Cork county) both keep it and their display names carry the unit type, "Cork (City)" and "Cork (County)". Natural Earth's errors that would mislead a lookup are fixed: Moscow's ISO codes (RU-MOW is the city), Kyiv Oblast's Wikidata item, two Afghan provinces labelled with their neighbours' names (Panjshir and Daykundi), cut-off English names such as "Federal" and "Jewish", seven unnamed placeholders (now "<Country> (unnamed area)"), mis-encoded aliases, and Russia's and Greece's `region` field, which is set to null because it is wrong for several units.

**Method.** Each 0.05 degree cell of `fine/v1` goes, month by month, to the province of its own country that contains the cell centre (full-resolution outline). A cell crossed by a province border goes wholly to the province with its centre. A centre in no province of its country (coast and border cells) goes to the nearest one within 0.1 degree, otherwise to `unassigned`: 0.45% of all fire was placed by that rule and 0.0004% is unassigned. Each country-month is rounded to 0.1 over its provinces and `unassigned` by largest remainder, so they add up exactly to `country_monthly`, which equals the `cells/v1` month sum. `usual` is the median of the calendar month over 2001-2025. `watch` is 0.6 times the median of that month over its ten latest complete years plus 0.4 times the mean of the last three, the rule of the site's outlook.

Every `bbox` in `provinces/v1` follows GeoJSON (RFC 7946): west greater than east means the box crosses 180 degrees (Russia, the United States, Fiji). `fine/v1` bboxes are plain minimum and maximum instead.

**Checks.** Every Natural Earth province is in exactly one file or replaced by a geoBoundaries country, except four that no FIRMS country covers and that hold no fire (Vatican, Kashmir in Siachen Glacier, Tuvalu, Spratly Islands). Provinces plus unassigned equal the country exactly in every month. Province totals recomputed independently from the `fine/v1` tiles and the full-resolution outlines (Natural Earth and geoBoundaries) agree within 5 hotspots or 0.5% for all 4,650 provinces. Recomputed straight from the S-NPP Parquet files with the same filters and outage fill, California 2020 is 208,524 against 208,387 (the coast cells the 0.1 degree rule adds), and Sakha 2021 matches exactly. 238 files, median 67 kB, at most 618 kB (United Kingdom), 26.3 MB in all. Built by `scripts/build_provinces.py`.

## Forecast

`forecast/v1/` holds a 2026-2027 fire forecast for every country: one file per country, `forecast/v1/<Country>.json` (median 15 kB, at most 280 kB), and `forecast/v1/index.json` (55 kB), one line per country, small enough to colour a map. They are made from `summary/v2` alone by `build_world_forecast.py` in the project repository.

**What it is and is not.** The forecast is built from the fire record alone. It has no weather, fuel, drought or ignition data, so it says what a typical month looks like for a country now, giving recent years more weight. It cannot say whether 2026 will be an unusual year. It uses data through December 2025 only, so it is a forecast made at the start of 2026, even though part of 2026 has already happened.

**Monthly, per country.** All counts are in VIIRS terms, harmonized as in Country summaries above. For each month of 2026 and 2027:

- `mean`: expected hotspots, and `lo`, `med`, `hi`: the 10th, 50th and 90th percentiles (the 80% range);
- `p_any`: the chance of at least one hotspot;
- `p_above`: the chance of more hotspots than that calendar month's 2001-2025 median (`hist.median`).

The forecast for a month is the spread of the same calendar month in 2001-2025. A year's weight halves for every 4 years back, and every value is scaled by a damped trend: half the 10-year slope of the log yearly total, at most 15% a year, applied from the weighted mean year to the target year, and never more than 3 times or less than a third. `p_any` counts only VIIRS months (from February 2012), because MODIS misses small fires that VIIRS sees; harmonization fixes expected counts, not whether a small fire is seen at all. `p_above` is capped at `p_any`.

**2027.** 2027 differs from 2026 only through the trend. The weights are the same, and nothing else is known about 2027. Where a country's trend is flat (`same_2027` true), its 2027 is identical to 2026.

**Where in the country.** `cell_rows` give, for every grid cell of the country's `summary/v2` file (same `cell` size, same cell index), the chance of at least one hotspot in 2026 and the expected hotspots. The grid in `summary/v2` is yearly, so there is no monthly map. The chance is the share of past years with a hotspot in the cell, again with a 4-year half-life, pulled toward the country's average cell by 2 pseudo-years. The expected hotspots split the country's expected 2026 total by each cell's recency-weighted share of past hotspots, so the cells add up to the country. Cells with no detection at all in 2001-2025 are not listed.

**How it was tested.** A rolling-origin backtest: for every target year from 2018 to 2025, the forecast was made from years before it only and scored against what happened, as was "history alone", which counts every past year equally, with no trend. Every setting was tried: a half-life of 2, 4 or 8 years or none; trend damping of 0, 0.5 or 1; partial pooling of sparse countries toward the global or latitude-band seasonal shape at three strengths; shrinking the chances toward 50%; and with or without MODIS years. One setting is used for every country. The setting for each test year was chosen on earlier years only, starting from 2014, and the published one was chosen the same way on 2014-2025. The monthly setting was the same for every test year from 2019 on; pooling and shrinking never helped it and are not used. The cell setting varied more (half-life 2, 4 or 8 years, with or without MODIS years). Over 234 countries with hotspots, with test years scored by the setting chosen before them:

| Score, 2018-2025, one year ahead | Forecast | History alone |
| --- | ---: | ---: |
| Monthly counts, CRPS relative to history alone (geometric mean over countries) | 0.90 | 1 |
| Countries where the counts beat history alone | 132 | 102 |
| Brier score, at least one hotspot | 0.0489 | 0.0569 |
| Brier score, above the monthly median | 0.196 | 0.214 |
| Months inside the 80% range | 79% | 82% |
| Cells: Brier score, at least one hotspot in the year | 0.121 | 0.132 |
| Cells: AUC (published setting) | 0.904 | 0.893 |

Two years ahead (2019-2025, made from years up to Y-2), the gain is about the same: CRPS ratio 0.90, Brier 0.197 against 0.215 for an above-median month.

**Where it does not beat history alone.**

- **Small countries.** In the 62 countries with fewer than 100 hotspots a year, the counts are 2% worse than history alone (worse in 43 of them). The gain is largest in countries with 100 to 1,000 a year (23% better, worse in 6 of 37).
- **Chance of any hotspot.** All of the gain comes from leaving out the MODIS years. History alone over VIIRS years only scores 0.0485, slightly better than the forecast.
- **Range too narrow in big countries.** The 80% range held the actual month 70% to 74% of the time in countries with more than 1,000 hotspots a year (history alone: 72% to 79%), and 92% in the smallest ones.
- **Single extreme years weigh a lot.** With a 4-year half-life, a year like Canada's 2023 dominates. Canada's 2026 expectation is 2.5 times its 2001-2025 average. The trend hits its 15%-a-year limit in 17 countries. `med` is less affected than `mean`.
- **Chosen with the test years.** The settings were chosen on 2014-2025, so the per-country scores in each file flatter the published setting slightly. The table above uses the honest nested choice. With the published setting the CRPS ratio is 0.89.

**Each country file holds:** `month` (24 values per measure, January 2026 first; index `(year - 2026) * 12 + (month - 1)`), `year` (expected total and trend factor per year), `same_2027`, `hist` (2001-2025 median, mean and share of years with a hotspot per calendar month, yearly mean and the 2025 total), `cell`, `ncell`, `cell_rows` (flat rows of four: cell index into `summary/v2` `cells`, chance of at least one hotspot in 2026, the same from history alone, expected 2026 hotspots), `metrics` (the backtest for this country, forecast and history alone), `verdict` (the metrics in words) and `method`. `index.json` lists per country `e26`, `e27`, `avg` (2001-2025 yearly mean), `ratio` (`e26 / avg`), and headline scores. Its `pooled` block holds the pooled scores above.

## Fire stations (OpenStreetMap)

`stations/v2/` holds, for every country, the fire stations mapped in OpenStreetMap and how far each fire grid cell of `summary/v2` is from them: one file per country, `stations/v2/<Country>.json` (median 34 kB, at most 0.88 MB), and `stations/v2/index.json`, one line per country. They are made by `build_world_stations.py --version 2` in the project repository. Later on 15 November 2026, v2 was rebuilt in place after an audit found flares, mines and gas plants still among the top gaps outside the six countries checked first. The rebuild added a fourth mask rule and changed the order of `gaps` (see Static sources and What changed). `stations/v1/` is the first release, kept as published. It counted gas flares in Algeria, Saudi Arabia and North Dakota as fire, so use v2. The stations, distances and completeness levels are the same in both. Only what counts as fire changed (see Static sources).

**Licence of this folder.** Station locations, names and operators are from OpenStreetMap, © OpenStreetMap contributors, ODbL. They are available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (see https://www.openstreetmap.org/copyright). The files in `stations/v2/` and `stations/v1/` are a derived database and are shared under the ODbL 1.0. If you use them publicly, credit "© OpenStreetMap contributors"; if you share an adapted version, keep it under the ODbL. The fire cells come from the NASA FIRMS data above. Every file carries the attribution and licence text in its `attribution` and `licence` fields.

**Stations.** All 148,391 OpenStreetMap objects tagged `amenity=fire_station` (60,089 nodes, 87,588 ways, 714 relations; the centroid of ways and relations), from the OpenStreetMap planet file of 21 September 2026, read through the QLever SPARQL endpoint (osm2rdf). The Overpass API was tried first, but every public instance was at capacity on the day. Objects within 60 m of each other are counted as one site, because a station is often mapped both as a point and as a building, or as several buildings. That leaves 142,182 sites. Each one is assigned to a country by the simplified outlines the site's globe uses (Natural Earth, 0.05 degrees). Where outlines overlap, the smallest wins. A station up to 10 km outside every outline goes to the nearest one (3,822 stations), and 330 further away are dropped.

**Distances.** For every cell in `summary/v2/<Country>.json`, the great-circle distance from the cell centre to the 3 nearest stations in the same country. Only stations in the country are searched, so near a border a closer station may exist across it. Distances are straight lines, not drive times.

**Gaps.** A cell is a gap when it burned in at least 4 of the 14 years 2012-2025 (25%), is not masked as a static source, and no station is mapped within 15 km of its centre. A year counts as burned when the cell has at least one VIIRS Suomi NPP detection that FIRMS types as vegetation fire (type 0), at nominal or high confidence, after static sources are removed. MODIS detections no longer add burn years. An audit of v1 found 4,132 gap cells that qualified through years in which only MODIS saw anything. Gaps are listed in two groups: cells that burned in at least 7 of the 14 years come first, then the rest. Within each group, gaps are ordered by detections per year, so a lone hot pixel seen in many years does not head the list. A gap means no station is mapped there. It does not mean that no station exists. In the 6 countries whose summary grid is 0.5 or 1 degree (United States, Brazil, India, Australia, China, Russia), a cell is 50 to 110 km across, so the distance from its centre says little about any one place in it.

**Static sources.** Gas flares, refineries, steel works, volcanoes and solar thermal plants such as Ivanpah in California show up as hotspots year after year. The FIRMS archive marks many of them in its `type` column (1 volcano, 2 other static land source, 3 offshore), but not all. v2 removes them in two steps.

First, single detections are dropped before anything is counted:

- detections within about 1 km (a 0.01 degree spot and the 8 around it) of a spot that FIRMS typed 1, 2 or 3 in at least 2 years, from any sensor (MODIS, Suomi NPP or NOAA-20). FIRMS flags the flare's pixel, but its neighbours often stay type 0;
- detections in a 0.01 degree spot seen in at least 6 years and 10 different calendar months, mostly at night. These are flares that FIRMS did not type. A flare's detections scatter over neighbouring spots, so the same test is also run on each spot pooled with its 8 neighbours (about 3 km). The pooled test also needs at least half of the detections to be weak night detections, and 6 months are enough when 85% are at night. A field or a patch of savanna burns in its season, by day. Daytime all-year spots are left alone, because near the equator they are sugar estates and shifting farms, and those are fire;
- the v1 persistent 0.05 degree squares, and, as in `summary/v2`, a 0.05 degree square for any year in which FIRMS typed a detection there.

Of the 249.7 million Suomi NPP detections from 2012 to 2025 at nominal or high confidence, FIRMS typed 18.4 million as 1-3. The first rule removes another 5.3 million and the second 0.59 million.

Second, a whole cell is masked (listed in `persistent`, with a reason in `persistent_why`) when what is left still looks like a static source. Seasonal below means at least 75% of the remaining detections fall in the busiest 6 calendar months. Vegetation fire has one or two burning seasons, and a flare burns all year.

- `static` (1): at least half of the cell's detections were removed, unless what is left is seasonal and at least 50 a year (a boreal or savanna cell with a flare in it stays). Or at least 20% were removed and what is left is not seasonal. Every cell v1 listed as persistent stays masked.
- `flare_field` (2): FIRMS typed detections in the cell or within about 5 km of it in at least 3 of the 14 years, and what is left is under 5 detections a year (spill-over around typed flares, such as Shaybah in Saudi Arabia). Or what is left is not seasonal, under 50 a year, and at least a quarter of it is weak night detections (Hassi Messaoud in Algeria). Or FIRMS typed detections there in at least 10 years, the typed detections outnumber what is left, and what is left is under 50 a year, seasonal or not (the Berkine basin in Algeria, with 200 to 460 typed detections per remaining one). The same holds within about 20 km when the typed detections are 50 times as many and the rest does not fall in one short season, in cells of 0.25 degrees or less. A sugar mill or a mine that FIRMS typed beside its fields has far fewer typed detections than fire, so cane fields in Senegal and Java and savanna in Mali and Arnhem Land stay.
- `night_all_season` (3): detections in at least 6 years and 10 calendar months, and most of them at night. That means at least half are weak night detections (FRP under 2 MW: flares are near 1 MW, vegetation fire at night near 3 MW), or 75% are at night, with under 90% in the busiest 6 months. A cell with 70% at night and under 80% in the busiest 6 months also counts. This catches untyped flare fields: the Bakken in North Dakota, the Eagle Ford in Texas and Ghawar in Saudi Arabia. Dry-forest fires in India and Thailand also burn weakly at night, but in one season, so they are spared.
- `night_weak` (4): whatever the months, at least half of what is left are weak night detections, and either at least 85% are at night, or at least 80% are at night over 7 or more calendar months (with at least 20 detections). This catches flares, brick kilns and mines seen in a few campaigns a year: Tavan Tolgoi and Baganuur in Mongolia, the Abu Dhabi oil fields and Kuwait. It applies to every gap, which needs 4 burn years. A Central Kalimantan peat cell, which smoulders weakly at night, is masked by it too.

29,633 cells are masked (10,410 `static`, 17,409 `flare_field`, 441 `night_all_season`, 1,373 `night_weak`). 18,775 of them have 4 or more burn years. The thresholds were set by checking known flare fields and known fire regions by hand, and they are listed in `index.json` `mask`. Some all-season night burning that is not flaring is masked too, such as in the Bolivian lowlands east of Santa Cruz and the São Francisco valley in Brazil. Crop burning on the Kirkuk plain in Iraq is masked because it sits next to the Baba Gurgur flares, which outnumber it. Some flare remnants still pass. These are desert cells in the Arabian Peninsula and the Sahara with detections in a few campaigns a year, 70-80% at night but not weak, probably drilling or well-test flares. They now head the gap lists of Saudi Arabia, Oman, Kuwait and Libya. Large wildfires are 60-70% at night too, so no rule here can separate them. Treat gaps in those deserts as unverified.

**What changed from v1.** Gap cells went from 151,100 to 136,967 (138,956 in the first v2, before the rebuild). 14,133 were removed and none were added. 3,694 were masked as `static`, 5,412 as `flare_field`, 331 as `night_all_season` and 885 as `night_weak`. 3,811 had fewer than 4 burn years once MODIS-only years and typed square-years were dropped. The top-ranked gaps in the United States, Russia, Algeria, Saudi Arabia, Nigeria and Iraq are no longer flare fields. The Bakken cell (48.75, -102.75), the Eagle Ford cell (28.25, -100.25), Ivanpah (35.75, -115.25) and the Qatif flare in Saudi Arabia (26.65, 49.85) are masked. Of the gaps in the top 10 of any country, 22 were mostly weak night detections in the first v2, and 2 are now. These are 5 detections on Nuku Hiva in French Polynesia and spring burning in Kerry, Ireland. Seasonal vegetation fire was checked before and after the rebuild: north Australian savanna (595 gap cells) and the Pantanal (99) are unchanged, the Sahel went from 11,531 to 11,504, Siberia from 1,514 to 1,509 (oil and gas fields) and the Sierra Nevada stays at 24. The next Bakken cell east (48.75, -102.25) is still a gap: its fire is in daytime in spring and autumn, which is crop burning, not flaring.

**Station ranking.** Each unmasked cell's mean yearly detections, 2012-2025, after static sources are removed, is credited to its nearest station. Stations are ranked by that total, and the top 25 are kept: the stations with the most fire nearby.

**Mapping completeness.** OpenStreetMap is far from complete in many countries, and the files must not suggest that "no station nearby" is real where the map is only empty. Each country gets a level from OSM stations per million people (Natural Earth `POP_EST`), checked two ways:

- against the median of countries with at least 1 million people in the same Natural Earth income group (OECD high income 66 per million, other high income 6.9, upper middle 10.4, lower middle 2.8, low 0.41);
- against fixed floors, because a whole group can be under-mapped. Almost every national fire service runs more than 2 stations per million people.

| Level | Rule | Countries | Gap cells |
| --- | --- | ---: | ---: |
| `fair` | ratio to peers at least 0.3 and at least 8 per million | 121 | 31,769 |
| `patchy` | neither fair nor thin | 38 | 32,991 |
| `thin` | ratio under 0.15, or under 2 per million, or under 5 stations with 200,000+ people | 68 | 72,197 |
| `unpopulated` | under 5,000 people | 11 | 10 |

Stations per 10,000 km² of land, against the same peers, are also given (`per_10k_km2`, `ratio_area`). They are not used for the level, because stations follow people, not land: Australia, Canada and Mongolia have few stations per km² because few people live in most of their area. A `fair` level means the country is mapped about as densely as its peers. It does not mean the map is complete. City-states and countries with few large stations can look `patchy` when they are not.

**Checked against national counts.** These figures are approximate, from official or industry sources, and count stations or brigades in different ways:

| Country | OSM sites | Known count (approx.) | Level |
| --- | ---: | --- | --- |
| United States | 33,615 | about 50,000-58,000 stations (USFA registry, NFPA) | fair, roughly 60-65% mapped |
| Germany | 28,129 | about 22,000 volunteer brigades with about 30,000 local units, plus about 100 professional services | fair, near complete |
| Japan | 5,714 | about 1,700 fire stations and 3,100 branch offices (FDMA), plus volunteer corps buildings | fair |
| Australia | 3,484 | more than 6,000 rural and urban brigades and stations across the state services | fair, about half |
| Brazil | 1,084 | military fire brigades in a minority of municipalities, roughly 1,500 units | patchy |
| India | 676 | about 3,400 fire stations (DG Fire Services, 2019) | thin, about 20% |
| Kenya | 15 | county fire services in most of the 47 counties, several stations in Nairobi and Mombasa | thin |

**Each country file holds:**

- `stations`: rows `[lon, lat, name, operator]`. `operator` is an index into `operators`, or -1. `name` is `""` when it is not tagged. Coordinates have 4 decimals.
- `osm`: the OSM id of each station, such as `n123` (node), `w123` (way) or `r123` (relation).
- `cell_rows`: flat rows of eight: cell index into `summary/v2` `cells`, the 3 nearest station indices into `stations`, their 3 distances in km, and the burn years (2012-2025, Suomi NPP type 0 after static sources are removed; in v1, any detection). A country with fewer than 3 stations has -1 for the missing ones.
- `fire_per_year` (v2): one value per cell, the mean yearly Suomi NPP type 0 detections 2012-2025 left after static sources are removed.
- `gaps`: the gap cell indices (v2: cells with 7 or more burn years first, then the rest, each group by `fire_per_year`, then distance; v1: by burn years, then distance).
- `persistent`: masked cells, never gaps and not ranked. In v2, `persistent_why` gives a reason code for each, explained in `why_codes`: 1 `static`, 2 `flare_field`, 3 `night_all_season`, 4 `night_weak`.
- `ranking`: rows `[station index, mean yearly detections credited, fire cells credited]`.
- `completeness`: station count, population, land area, income group, both densities, the peer medians, `ratio`, `ratio_area`, `level`, and `thin`, which is true for `thin`, `patchy` and `no_data`.
- `gap_note`: one sentence on how far to trust the gaps here.
- `method`, `attribution`, `licence`, `source`, `cell`, `years`, `gap_rule`.

Countries with more than 8,000 stations (United States, Germany, Poland) list only the stations that are among the 3 nearest to some fire cell or in the ranking. In those files `stations_subset` is true, and `stations_total` gives the full count. `index.json` gives per country `stations`, `listed`, `per_million`, `per_10k_km2`, `ratio`, `level`, `thin`, `cells`, `burn_cells` (cells burned in at least 4 of the 14 years), `gaps`, `persistent` and `median_km_burn` (the median distance to the nearest station from those cells). In v2 it also gives `persistent_why` (masked cells per reason) per country, and `mask` (every threshold) and `why_codes` at the top.

**Limits.** A missing station on the map looks the same as a missing station on the ground. Use `level` and `gap_note` before calling anything a gap. The outlines are simplified, so a station within a few km of a border can land in the neighbouring country. A distance is measured from a cell's centre, not from the fires inside it. Volunteer stations and forest or wildland fire posts are mapped very unevenly between countries.

## Fire stations v3 (OpenStreetMap + Overture Maps)

`stations/v3/` is `stations/v2` with a second station source: [Overture Maps Places](https://docs.overturemaps.org/), release 2026-10-21.0. The fire, the static-source mask, the gap rule (4 of 14 burn years, no station within 15 km) and the completeness thresholds are the same as v2. Only the stations changed. Built by `build_world_stations.py --version 3`; v1 and v2 still rebuild byte for byte. This is the second build of v3: the first (15 Nov 2026, commit 8c02500) let through shops, extinguisher firms and duplicate listings, and was overwritten in place.

**Overture stations.** Every place whose primary category (`taxonomy.primary`) is `fire_station`: 86,918 in the release. Places with confidence under 0.5 (7,495) or marked closed (191 more) are left out. The `fire_protection_service` category was left out: it is mostly extinguisher, alarm and sprinkler firms, and only 6-22% of its places lie within 250 m of an OpenStreetMap station, against 60-71% for `fire_station`.

**Name filter.** Overture's confidence does not separate stations from businesses: every Foursquare, AllThePlaces and Microsoft place scores 0.77 or more. A name filter (in many languages) drops 1,766 more places: names that are never a station (extinguisher, sprinkler and equipment firms, shops, union locals, schools, academies, training grounds, museums); security firms, police and Red Cross posts, unless the name also names a fire service; places listed only by business directories (Foursquare, Microsoft, BrightQuery, PinMeTo) whose name does not name a fire service; and 5 places at whole-degree coordinates, which were geocoded to the middle of a region. A name repeated 5 or more times among the added stations without a fire word would also be dropped as a chain; after the filter, none is left. 77,461 places remain.

**Counted once.** Overture places within 250 m of each other, within 1 km with similar names, or within 2 km with the same name are one station (70,818 sites). Names are similar when the distinctive words of one (generic fire words and abbreviations aside) are all in the other, or one name is inside the other, and they carry no different station numbers: "Feuerwehrgerätehaus Rohrbach" and "Feuerwehr Rohrbach", but not "Station 4" and "Station 7". An Overture site that is that close to an OpenStreetMap station, by the same tests, is that station. The OpenStreetMap record is kept, and its `source` is `both`. 50,512 Overture sites matched; 20,306 were added as Overture-only stations, assigned to countries in the same way as the OSM ones. With a 100 m or 500 m match radius, 21,161 or 19,583 would have been added. In all, 162,143 stations: 91,298 OpenStreetMap only, 50,554 in both, 20,291 Overture only.

**Where it helps, and where it does not.** Overture's fire stations come mostly from Meta's place pages, so they follow where those pages are common: 12,236 of the added stations are in the United States, then Germany (799), Hungary, Australia, Poland, Japan and Austria. They add almost nothing where OpenStreetMap is empty. Of the 16 countries with no OSM station (Malawi, Rwanda, Burundi, North Korea, the Solomon Islands and others), only Comoros gains one, its civil security directorate. The 46 countries with 1 to 4 OSM stations gain 2 between them (Gabon and the Northern Mariana Islands); the additions in Grenada and Saint-Martin turned out to be their OSM stations listed again. Nigeria gains 8 stations (to 36) and Kenya 5 (to 20); both stay `thin`. Gap cells fall from 136,967 to 134,774, mostly in Turkey (2,822 to 2,397), the United States (1,492 to 1,227), the Philippines, Paraguay, Mexico and Canada. No country gains a gap.

**Completeness.** The level uses the merged count, with v2's thresholds. The income-group medians are recomputed from the merged counts (OECD high income 66.3 to 95.7 per million; low income 0.41 either way). 11 countries changed level: Colombia, Dominican Republic, Guatemala, Jamaica, Kuwait, Nicaragua, Qatar and Turkey from `patchy` to `fair`; Gabon and Indonesia from `thin` to `patchy`; Italy from `fair` to `patchy`, only because the OECD median rose. Kuwait and Qatar are 1 station above the `fair` line, and Guatemala and Jamaica 2, so treat their new level as uncertain. Levels now: 128 `fair`, 33 `patchy`, 66 `thin`, 11 `unpopulated`.

**Quality.** In a random sample of 60 added stations, none was clearly not a fire station; about 10 were borderline, mostly Hungarian volunteer fire associations (Önkéntes Tűzoltó Egyesület), registered at village addresses. In 40 places that only Foursquare lists, 2 were firms. Some places are still listed twice under different names more than 1 km apart, or are a department's office rather than a station. A station near a border can be assigned to the neighbouring country (El Paso stations land in Mexico). Show Overture-only stations as "Overture Maps (from business listings; may be wrong or out of date)".

**Licence.** OpenStreetMap data © OpenStreetMap contributors, ODbL 1.0. Overture Maps Places © Overture Maps Foundation, under the [Community Data License Agreement Permissive 2.0](https://cdla.dev/permissive-2-0/); its Foursquare-sourced places are © Foursquare Labs, Inc., under the Apache License 2.0. The folder holds `LICENSE-CDLA-Permissive-2.0.txt`, `LICENSE-Apache-2.0.txt` and `NOTICE-Foursquare.txt`, as those licences require. The files are a derived database shared under the ODbL 1.0. Credit: "© OpenStreetMap contributors, ODbL; Overture Maps Foundation, overturemaps.org, CDLA Permissive 2.0 (includes data from Meta, Microsoft, Foursquare (Apache 2.0) and others)". This string is in every file's `attribution` field.

**Format changes from v2.** `v` is 3. Each `stations` row has a fifth element, its source: `"osm"`, `"both"` or `"overture"`. `osm` is `""` for an Overture-only station, and a new parallel list `overture` holds the Overture id (`""` for OSM-only stations). Each file has `station_sources` (counts by source) and `source_codes`. `index.json` adds `stations_osm` (OSM sites, the v2 count), `stations_overture_only` and `stations_both` per country, and an `overture` block at the top with the release, category, thresholds and counts. `stations` is now the merged count. The `overture` block also records the name filter, the match rules and how many places each step dropped.

## Before you use it

- **Detections are not fires or burned area.** Counts depend on pixel size, overpass times, cloud and smoke as well as on burning.
- **Do not add the sensors together.** VIIRS sees much smaller fires than MODIS and reports several times more detections for the same burning. Suomi NPP and NOAA-20 carry the same instrument, so adding those two counts the same fires twice.
- **Filter on `type` for vegetation fires.** Types 1 to 3 are volcanoes, static sources such as gas flares and industrial sites, and offshore detections.
- **Treat `confidence` with care.** NASA notes that its meaning is likely to vary in different parts of the world.
- **Overlapping orbits are not removed.** NASA notes that its gridded Level 2G products account for overlapping satellite orbits to avoid double-counting, and are better suited to many quantitative studies than these location files.
- **MODIS has gaps.** NASA lists missing data from the end of June to the start of July 2001, in places through 2002, from mid-August 2007, and on 21 and 22 April 2009.
- **How detections were assigned to countries is not documented.** NASA does not name the boundaries it used or say how it treats border pixels and offshore detections.
- **Some values look odd in the source and are kept as they are,** such as slightly negative `frp`.
- **Suomi NPP has stopped.** NASA states that Suomi NPP data end on 2 November 2026. NOAA-20 carries the VIIRS record forward.
- **Not for tactical use.** NASA advises against using these data for tactical decision-making or for conditions at a local scale.

## How this copy was made

`build_world_parquet.py` downloaded FIRMS's zip archive for each sensor and year and converted each CSV with DuckDB 2.0.0, writing zstd-compressed Parquet. Numbers are stored as 64-bit floats, `acq_date` as a date, and `acq_time` and `version` as text so that leading zeros and values such as `6.03` survive.

Each file was checked two ways:

1. The CSV had the byte size NASA's index lists for it.
2. CSV text regenerated from the Parquet file had the same SHA-256 as the CSV NASA served. This held for all 10,095 files, 43,473,701,526 bytes.

The only difference from the source is the file format.

## Source, terms and citation

**Source.** [FIRMS yearly summary by country](https://firms.modaps.eosdis.nasa.gov/country/), NASA LANCE / ESDIS.

**Acknowledgement.** NASA asks that anyone who provides FIRMS data to a third party follow its acknowledgement and disclaimer guidelines. The acknowledgement it asks for is:

> We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS).

**Disclaimer.** From NASA's [LANCE Disclaimer](https://www.earthdata.nasa.gov/data/projects/lance/disclaimer):

> LANCE is operated by the ESDIS Project. The information presented through LANCE, GIBS, Worldview, and FIRMS are provided "as is" and users bear all responsibility and liability for their use of data, and for any loss of business or profits, or for any indirect, incidental or consequential damages arising out of any use of, or inability to use, the data, even if NASA or ESDIS were previously advised of the possibility of such damages, or for any other claim by you or any other person.
>
> Due to the spatial resolution and other characteristics of these data, their use for tactical decision-making or informing about conditions at a local scale are not advised.
>
> ESDIS makes no representations or warranties of any kind, express or implied, including implied warranties of fitness for a particular purpose or merchantability, or with respect to the accuracy of or the absence or the presence or defects or errors in data, databases of other information.
>
> The designations employed in the data do not imply the expression of any opinion whatsoever on the part of ESDIS concerning the legal or development status of any country, territory, city or area or of its authorities, or concerning the delimitation of its frontiers or boundaries. For more information please contact Earthdata Support.

**Licence.** NASA attaches no separate licence statement to these files. Its general [Data Use and Citation Guidance](https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance) says:

> Unless the content is marked with a use restriction or license, data provided from a NASA-led mission are licensed as Creative Commons Zero (CC0). While there are no restrictions on the use of these data, data users are very strongly urged to cite the data used in their work products.

The FIRMS page adds: "NASA supports full and open sharing of data." This card links to NASA's guidance instead of asserting a licence on NASA's behalf.

**References.** No dataset citation or DOI for the standard-processing files could be found on NASA's pages in November 2026. The algorithms and products are described in:

- Giglio, L., Schroeder, W., & Justice, C.O. (2016). The collection 6 MODIS active fire detection algorithm and fire products. *Remote Sensing of Environment*, 178, 31-41. https://doi.org/10.1016/j.rse.2016.02.054
- Schroeder, W., Oliva, P., Giglio, L., & Csiszar, I.A. (2014). The New VIIRS 375 m active fire detection data product: algorithm description and initial assessment. *Remote Sensing of Environment*, 143, 85-96. https://doi.org/10.1016/j.rse.2013.12.008
- [MODIS Collection 6 and Collection 6.1 Active Fire Product User's Guide, version 1.0](https://www.earthdata.nasa.gov/s3fs-public/2023-09/MODIS_C6_C6.1_Fire_User_Guide_1.0.pdf)
- [Collection 2 VIIRS 375-m Active Fire Product User's Guide, version 1.2](https://www.earthdata.nasa.gov/s3fs-public/2025-06/VIIRS_C2_AF-375m_User_Guide_1.2.pdf)
