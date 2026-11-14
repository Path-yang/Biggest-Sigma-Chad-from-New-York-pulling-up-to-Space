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
summary/v1/<Country>.json and summary/v1/index.json   (derived; see Country summaries)
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

`summary/v1/` holds one small JSON file per country, `summary/v1/<Country>.json`, and a list of them, `summary/v1/index.json`. They exist so a web page can show a country's fire history from one request of a few kB to 1.4 MB (median 66 kB) instead of hundreds of MB of Parquet.

Unlike the rest of this dataset, these files are derived and harmonized: they are counts and estimates computed from the raw files, not a copy of them.

**What is counted.** Vegetation fires only (`type` 0) at nominal or high confidence: MODIS `confidence` of 30 or more, VIIRS `n` or `h`. January 2001 to December 2025.

**What each file holds.**

- `monthly`: counts per month for Terra (`T`), Aqua (`A`), Suomi NPP VIIRS (`V`) and NOAA-20 VIIRS (`N20`), 300 values each. Month index is `(year - 2001) * 12 + (month - 1)`.
- `r_ta`, `r_t`: a VIIRS-per-MODIS exchange rate for each calendar month, for Terra and Aqua together and for Terra alone, with a 90% range for `r_ta` (`r_ta_lo`, `r_ta_hi`) and the all-months rate `r_all`.
- `pi`, `zero_hi`: 90% range multipliers for converted values, by size (bins up to 10, 100, 1000 and above), and the top of the range when a converted month is zero.
- `val`: leave-one-year-out validation, 2012 to 2025, per year and in summary.
- `cell`, `cells`, `cell_rows`: a grid of 0.1, 0.25, 0.5 or 1 degree cells (the finest that keeps the file under about 1.5 MB). Each row is cell, year, harmonized count, raw MODIS Terra+Aqua count, raw Suomi NPP count. A cell's indices are `floor(lat / cell)` and `floor(lon / cell)`.
- `bbox`, `totals`, `source`, and a display `name`. `bbox` is the extent of the counted detections; for countries that cross the 180th meridian it runs from about -180 to 180.

**Harmonization.** VIIRS sees several times more detections than MODIS for the same burning, so the two records cannot be joined directly. On the overlap, February 2012 to December 2025, each country gets one exchange rate per calendar month: Suomi NPP detections divided by MODIS detections. From February 2012 the Suomi NPP count is used as observed. Before that, the MODIS count is multiplied by the rate, with a Terra-only rate before July 2002, when Aqua had not yet started. The harmonized grid values apply the same rule month by month and are then summed per year.

**Small countries.** A country with few detections cannot support twelve rates of its own. Each monthly rate is shrunk toward the country's all-months rate with a pseudo-count of 30 MODIS detections, and the all-months rate toward the global rate (4.10) with a pseudo-count of 3,000. These values were chosen by leave-one-year-out error across the 206 countries with at least 50 Suomi NPP detections on the overlap: they bring the mean held-out monthly error from 0.57 with almost no pooling to 0.41, within 1% of the best pair tried. Each file's `rate_note` says how much of its rates came from its own data.

**Ranges.** The 90% range multipliers are the 5th and 95th percentiles of observed divided by predicted over held-out months, for the country as a whole and for its 1 degree cells. A size bin with fewer than 30 such months uses the value pooled over all countries, and every range includes the estimate itself.

**Limits.** FIRMS's `type` flag stands in for a hand-made mask of industrial sites. Converted months are estimates, and a converted zero can hide real burning. A change of method would be published under a new folder, such as `summary/v2/`, rather than by rewriting `v1`.

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
