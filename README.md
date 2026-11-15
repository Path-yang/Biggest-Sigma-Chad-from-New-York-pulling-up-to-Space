# Burn Calendar

**Live site: [sigmachadsinspace.gay](https://sigmachadsinspace.gay/)**

An interactive page that shows one consistent fire-hotspot record for New York and California, January 2001 to 14 November 2026, built from NASA's MODIS and VIIRS satellite sensors. Every country gets the same record from a summary on Hugging Face. 2026 is a partial year, shown "so far" (see [2026 to date](#2026-to-date)).

VIIRS reports several times more hotspots than MODIS for the same fires, so joining the two records naively creates a false jump in 2012. The page converts the MODIS years into VIIRS-equivalent counts and shows the evidence for that conversion.

## Run it

The page is live at [sigmachadsinspace.gay](https://sigmachadsinspace.gay/). To run it locally you need no build step and no install. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

Then go to <http://localhost:8000>.

The page fetches five things from the network: its fonts (Google Fonts), three.js for the globe (cdnjs), street-map tiles from OpenStreetMap (one test tile when the page opens, the rest when you zoom far in), the weather forecast from Open-Meteo for the 14-day outlooks (when you open New York or California, or any country), and, when you open a country, that country's summary file from the Hugging Face dataset described below, then its 2026–2027 forecast and fire-station files. Without a connection it uses system fonts, shows plain buttons and the country search in place of the globe, draws its own roads in place of the street map, and says the outlook is unavailable with a Retry button; country views need the connection.

## What you can do

- Start on a globe and pick New York or California, or compare the two states side by side.
- Click any country on the globe, or search for it, to open its own page: busiest months, worst years, a month-by-month calendar, a map of where it burns, the evidence for the conversion and a CSV of the monthly series. Its data is fetched from Hugging Face when you open it. Its **Next 14 days** section gives the chance that each of its regions (about 280 km across) has a busier fortnight than usual, from Open-Meteo's forecast, with how it was tested (see [Global 2-week outlook](#global-2-week-outlook)). Its **2026 and 2027** and **Fire stations** sections are described in [Country pages: 2026–2027 and fire stations](#country-pages-20262027-and-fire-stations).
- Switch the globe to **Next 14 days** to see every country coloured by how the forecast weather moves its chance of a busier fortnight than usual (from the daily snapshot).
- Drill into the hexagon map: click a county, then a hexagon, then keep zooming to 2 km hexagons, roads, and fire and EMS stations.
- Switch the map between past hotspots and the chance of fire in a chosen month. The chance can be **past odds** (how often the place burned in that month) or the **forecast for 2026 or 2027**. In California a switch shows **large fires only** (1,000 acres or more, from CAL FIRE's fire perimeter maps), for both past odds and the forecast.
- Switch the map to **Next 14 days**: each county's chance of at least one hotspot from today through the next 13 days, from Open-Meteo's live weather forecast, coloured by how much the weather raises or lowers it. The full data ranks the counties to watch and shows how the outlook was tested.
- Drag along the timeline, or press play, to see where each year burned.
- Find a town or city, draw a box on the map, or enter a point and radius.
- Click any month in the full calendar to test whether it was unusual and to show it on the map.
- Open the full data for the selected area: the busiest months, the worst years, whether a given month was unusual, the counties to watch, the full calendar and the evidence for the conversion.
- Choose a range of years and a colour palette.
- Download the monthly calendar or the hexagon hotspots as CSV for the current selection, and the 2026–2027 forecast by hexagon or by county, with past odds alongside, and the 14-day outlook by county.
- In the full data, see how the forecast did against past odds when tested on 2018–2025: Brier score, AUC, calibration charts and its limits.
- Use the fire response tools on the map card:
  - **Closest stations.** Click any spot to see the three fire or EMS stations with the shortest drive, with minutes and road km. A selected hexagon or a town you search for gets the same list. On a phone the list scrolls into view after a tap.
  - **15 km gaps.** Outline the places where fire is common in a chosen month but every station is more than 15 km away.
  - **Add crews.** Choose a month, 1 to 20 extra crews and a drive-time limit, and see where each crew would reach the most fire.
  - When the places a tool points to are mostly off screen, the map flies to them.
- In the full data, see the counties to watch and the stations first to the most fire for the chosen month, side by side, and the full list of places far from a station. These lists, the 15 km gaps and the crew planner use past odds, or the forecast when Forecast 2026 or 2027 is picked; the page says which.

## Files

| File | Contents |
| --- | --- |
| `index.html` | The page's markup and styles. |
| `world.js` | Country outlines for the globe and the country maps (Natural Earth, simplified), keyed by FIRMS country name. Built by `scripts/build_world_shapes.py`. |
| `response.js` | Drive times from fire and EMS stations to every hexagon, and a rule for estimating drive time from straight-line distance. Built by `scripts/build_response.py` from OpenStreetMap. |
| `forecast.js` | The chance of fire in every hexagon and county for each month of 2026 and 2027, the backtest against past odds, and California's large-fire layer (history and forecast). Built by `scripts/build_forecast.py`; the large-fire layer comes from `scripts/build_large_fires.py` and `scripts/build_large_layer.py` through `forecast_inputs/large.json`. |
| `outlook.js` | For the 14-day outlook: each county's usual chance of a hotspot for every day of the year, its weather point, the weather model's coefficients and the backtest. Built by `scripts/build_outlook.py`. The page fetches the weather itself. |
| `world_outlook.js` | For the global 14-day outlook: about 2,100 regions on a 2.5° grid, each one's usual chance for every half-month, its weather climate, its weather point and the per-region correction for Open-Meteo, the model's coefficients and the backtest. Built by `scripts/build_world_outlook.py`. The country page loads it (0.34 MB compressed) when a country first opens and fetches the weather itself. |
| `world_outlook_today.json` | The daily snapshot of the global outlook: every region's chance from that day's Open-Meteo forecast, and each country's summary for the globe. Written by `scripts/world_outlook_today.ts`, run twice a day by `.github/workflows/world-outlook-today.yml`. |
| `data.js` | The data, about 3.7 MB: monthly counts per county and per hexagon, the 2 km hexagon detail, county outlines, roads, towns, fire and EMS stations, the globe's outlines and Earth texture, exchange rates and validation results. |
| `app.js` | The page's logic, built from `src/`. It is committed so that the site needs no build step. It loads `response.js`, `forecast.js` and `outlook.js` itself when a state view first opens (`src/extras.ts`), so the globe does not wait for them. |
| `src/` | The TypeScript source for `app.js`. |
| `package.json`, `tsconfig.json` | Build and type-check settings. |

## Change the code

You need Node.js 18 or later.

```sh
npm install
npm run check
```

`npm run check` type-checks `src/` and rebuilds `app.js`. `npm run watch` rebuilds `app.js` each time you save.

GitHub Pages serves this repository as it is, so commit the rebuilt `app.js` together with your source change. `index.html` loads `app.js?v=19`, `data.js?v=4` and `world.js?v=1`. `app.js` loads `response.js?v=1`, `forecast.js?v=3` and `outlook.js?v=1` when New York or California first opens; their numbers are in `src/extras.ts`. It loads `world_outlook.js?v=2` when a country page first opens; that number is in `src/wol.ts`. Raise the number when a file changes (for the last four, in `src/extras.ts` or `src/wol.ts`, then rebuild `app.js` and raise its number too), so that returning visitors do not get a stale cached copy.

## Method

1. Keep vegetation fires only, at nominal or high confidence, from MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (Suomi NPP).
2. Remove industrial heat sources: 500 m spots that VIIRS flags in 5 or more years, mostly at night.
3. Count hotspots per month in each county and hexagon.
4. On the overlap, February 2012 to December 2025, learn one exchange rate per calendar month: VIIRS hotspots divided by MODIS hotspots, pulled toward the state's all-month rate where a month has few hotspots.
5. From February 2012 use VIIRS as observed. Before that, multiply the MODIS count by the rate. Before July 2002 only Terra flew, so a Terra-only rate applies.
6. The 90% range on converted months comes from held-out errors: each year from 2012 to 2025 is predicted from MODIS alone, using rates learned on the other years.

## 2026 to date

The record runs to **14 November 2026**, the last complete day. A count is still one VIIRS hotspot detection (a 375 m pixel flagged on one overpass), which measures fire activity, not the number of separate fires.

**Sources.** 2001–2025 are unchanged: the FIRMS archive, as before. 2026 comes from the [FIRMS API](https://firms.modaps.eosdis.nasa.gov/api/): standard processing (SP) for January to July and near real time (NRT) from August, for VIIRS Suomi NPP, VIIRS NOAA-20 and MODIS. The API's country endpoint is switched off, so the world was fetched one satellite-day at a time and points were placed in countries, counties and hexagons by their outlines. No duplicate rows were found (0 of 32.5 million), so none were removed.

**Same filter.** Type 0 (vegetation fire), confidence nominal or high, as before. NRT rows have no `type` column, so a 2026 NRT point counts as a non-vegetation source when a point of type 1, 2 or 3 from the archive (recent years) or from 2026 SP data lies within 0.01°. Tested on August to December 2025, this kept 98–100% of the true type-0 count in both states. New York and California keep their 2012–2025 industrial mask frozen, so past values do not move. The country summaries rebuild a same-year static-source mask for 2026 from VIIRS flags only; v2 also uses MODIS flags, which made a rerun on 2025 worse, and their absence is the main reason flaring countries such as Libya and Iraq differ (see below).

**One satellite a day, never two added.** Suomi NPP only from 2012; NOAA-20 is not added (that would count the same fires twice). Each day of each place (country or state) comes from one source:

- Suomi NPP, on the days it delivered.
- NOAA-20 times the place's NOAA-20-to-Suomi NPP ratio for that month, on the days Suomi NPP missed: 2–14 November, after Suomi NPP stopped on 2 November, and 20 outage days from March to October (10–12 Mar, 28–30 Apr, 1–2 Jun, 10–16 Jul, 3, 4 and 18 Aug, 12–13 Oct). Also on a few days when Suomi NPP's data are partial (fewer than 22 UTC hours) and the missing hours are the ones that see that place, or Suomi NPP saw under 40% of NOAA-20's count there: for example 9 March for California and the United States. The ratio is learned on the 2018–2025 days when both satellites delivered normally (New York 0.989, California 1.009 over all months; per country in the summaries), pooled toward a wider ratio where a place has few hotspots, the same way MODIS is converted.
- On 12 October both satellites lack many hours (NOAA-20 has no data from about 09 to 14 and after 17 UTC), so neither saw Africa's or the Americas' afternoon overpasses. Where neither covered a place's overpass hours, that day is the mean of the days either side, with a range from what was seen to the larger neighbour (California, and 53 countries, among them the United States and Mozambique).

Each filled month carries a range. The calendars mark those months, and the tooltips and CSVs list the days. Suomi NPP's past outages (2018–2025, for example 10–16 and 24–29 July 2024 and 27 July to 10 August 2022) are filled the same way, so 2026 is compared with past months built by the same rule: in `data.js` as `gap_county_rows`, `gap_hex_rows` and `hist_gaps`, and in the summaries as `y2026.hist_gaps` (the summaries' `monthly.V` keeps the archive's value).

**Partial year.**
- November 2026 covers 1–14 November. December 2026 has no data and is drawn blank, never as zero.
- 2026's total is labelled "so far". It is not ranked against whole years ("Worst years", the average year and the year charts use complete years only). It is compared instead with 1 January to 14 November of every year since 2012 (January 2012 converted from MODIS, as in the monthly record). The first year of the chosen range must be a complete year.
- "Was it unusual?" starts on October 2026, the latest complete month. November 2026 can be tested too, but only against 1–14 November of past years: for the state and each county in `data.js` (`states.<st>.partial`), and for every country in the summaries (`y2026.same_days`); past Suomi NPP outage days in those dates are filled the same way in both. A drawn area or a hexagon has no daily history, so it says the month is not over.
- Past odds of fire ("Chance of fire") use complete years, 2012–2025.
- The CSVs include 2026 with a `month_status` column (`complete`, or `partial_to_2026-11-14`) and the NOAA-20 days used. MODIS was not fetched for the two states in 2026, so their 2026 MODIS columns are blank.

**Forecast and outlook.** The 2026–2027 forecast, the large-fire layer, the 14-day outlook and the fire response tools were built from data to 2025 and are unchanged. They do not use the 2026 hotspots, and the page says so. The response tools ignore 2 km hexagons first seen in 2026, which have no road times.

**Country summaries.** The country page reads `summary/v3` (v2 plus 2026; 2001–2025 identical to v2) and falls back to `summary/v2` if v3 does not load. The globe's colours stay on the 2001–2025 average. For 17 countries, including Canada, Libya and Iraq, the 2026 method came out more than 5% off v2 when it was rerun on 2025; their pages say so.

The scripts that built the 2026 data are `scripts/extend_data_2026.py` (New York and California, into `data.js`) and `scripts/build_summaries_2026.py` with `scripts/summary2026/` (the country summaries).

## Limits

- The record ends on 14 November 2026, and 2026 is a partial year (see above).
- Converted months are estimates, and small areas are noisy. MODIS misses many small fires, so a converted zero can hide real burning.
- The 2 km hexagons cover 2012 onward. The chance of fire is measured on the years from 2012 whenever the chosen range includes them.
- Suomi NPP outages from 2018 on are filled from NOAA-20 (see above). Earlier gaps and cloud cover are not corrected.
- A hotspot is a detection, not a fire count or burned area.
- The industrial filter (step 2) misses heat seen by day. The Ivanpah solar power plant in San Bernardino County shows up as hotspots in most months since 2014 (its three solar towers). Its two hexagons still show those hotspots on the Past hotspots map and in the counts, but the chance of fire, the fire response tools and the forecast treat them as having no fire, and their tooltip says why.

Data: NASA FIRMS active fire archive. Street map tiles © OpenStreetMap contributors.

## Fire response tools: how they work

`response.js` gives every hexagon in New York and California its three fire or EMS stations with the shortest drive to the hexagon's centre, with minutes and road km. It also gives the fastest station for every 2 km hexagon where fire was seen.

**Roads and speeds.** Drive times come from the OpenStreetMap road network (Geofabrik extracts). Each road class has a set speed: motorway 95 km/h, primary 60, secondary 50, residential 30, track 15. Where a speed limit is tagged, a little less than the limit is used. Speeds are capped at 105 km/h, and one-way rules apply only on freeways. Where a point is off the road network, the straight line to the nearest road is counted at 20 km/h. Points more than 10 km from a road get no time.

**Stations.** These are the fire and EMS stations already in `data.js`: 2,656 in New York and 3,174 in California. Only stations inside each state are counted, so a place near a state line may have a closer station across it.

**Limits.** There is no traffic, no signal delay and no turnout time. We also do not know which stations are staffed, or with what. On the same road distance these times run longer than the NFPA/RAND formula used in fire planning, by a median 17% in New York and 33% in California. They are estimated driving times, not response times. The road searches end at each hexagon's centre, which is sometimes unrepresentative. For example, the downtown Buffalo hexagon's centre is on a river breakwater. For a clicked spot more than 1 km from the centre, the page adds an estimated last stretch from the centre to the spot (the estimating rule below) and marks the time with ~; where fire was seen in the 2 km patch at the spot, that patch's own road search is used when it finds a faster station. A station on the far side of the centre is still counted the long way round. 48 California hexagons, mostly islands, open water and deep wilderness, have no road link to a station.

**What each tool does.**

- **Closest stations** shows the road search for the hexagon under the spot you click.
- **15 km gaps** flags a hexagon when two things hold:
  - it had a hotspot in the chosen month in at least 1 year in 10, 1 in 4 (the default) or 1 in 2, counted over 2012–2025 or the years chosen;
  - its nearest station is more than 15 km away in a straight line.

  New York has no such place in any month. The 41 New York hexagons more than 15 km from a station rarely burn.
- **Stations first to the most fire** ranks stations by how often fire comes to the places they reach first by road in the chosen month.
  - Each hexagon counts by its share of years with a hotspot in that month (or its forecast chance), so a place that burns most years outweighs one huge fire in one year.
  - Each hexagon's fire is split equally among the 2 km patches inside it that burned in that month since 2012 (`data.js` has no month-by-month counts for them), and each patch goes to the station with the fastest drive to it.
  - Each station also shows the years with fire in its area and its average hotspots; the note says when a top station rests on fire in a single year.
  - Hotspots are what satellites saw burning, mostly in a few big wildfires (77% of California's VIIRS hotspots fall inside large-fire perimeters). They are not calls or incidents, and the list says nothing about how a station is staffed.
  - Counties to watch are ranked the same way: the sum of their hexagons' shares of years with fire, shown as a share of the state's, with their years with fire and average hotspots.
- **Add crews** places crews one at a time. Each one goes to the hexagon centre that brings the most still-uncovered fire risk within the time limit.
  - Fire risk is each hexagon's share of years with a hotspot in the chosen month.
  - Existing stations use their road drive times.
  - New sites use the estimating rule below.

**Estimating rule, with its test.** For new crew sites, drive time is estimated from straight-line distance: a speed for each distance band, plus a few local minutes for each hexagon. It was tested on hexagons held out of the fit. Over all distances the median error is 10.0% in New York and 14.2% in California; one speed for every distance gives 13.7% and 22.7%. Most test pairs are long, though, and the planner works at 5–20 km, where the error is larger: 17.3% (5–10 km) and 13.9% (10–20 km) in New York, 24.0% and 29.9% in California. The planner card quotes the error for the distances its time limit covers. It is good for ranking, not for promising a time.

**Hexagon size limits the planner.** A new site is placed at a hexagon centre, and centres are about 13 km apart in California. On average a site reaches 1.2–1.8 hexagons within 10–20 minutes in California, and 1.0–1.5 within 10–15 minutes in New York, its own included. So at these limits "the most uncovered fire risk" is nearly "the busiest uncovered hexagon", and the planner and its baseline below pick nearly the same places; the card says so. At 30 minutes a site reaches 3.6 hexagons in California and 11.5 in New York.

**Planner check on later years.** The page also tests its own placements. It chooses sites from the first half of the years and scores them on the second half. The baseline puts the same number of crews in the busiest places no station reaches in time. For California in August, with 15 minutes and 5 crews:

| Placement | Share of 2019–2025 August fire risk covered |
| --- | --- |
| Stations alone | 47.1% |
| Sites chosen on 2012–2018 | 48.0% |
| Busiest-place baseline | 47.8% |

The planner usually matches or slightly beats the baseline, and sometimes loses. With past odds every fire chance is history. With Forecast 2026 or 2027 picked, the gaps, the station and county lists and the planner weigh each hexagon by its forecast chance of fire instead (see below); first-due areas still split each hexagon the way its fire fell since 2012, and the planner's check stays on past years. The tools always use all fires, not only large ones, and leave out the two Ivanpah solar plant hexagons (see Limits).

Rebuild `response.js` with:

```sh
uv pip install --python .venv/bin/python numpy scipy osmium
.venv/bin/python scripts/build_response.py
```

It downloads each state's extract (about 0.5 GB and 1.3 GB) to a temporary folder and deletes it after reading. It takes about 15 minutes, most of it downloading.

Road data © OpenStreetMap contributors, ODbL.

## Forecast 2026–2027

`forecast.js` gives the chance of **at least one VIIRS hotspot** in each hexagon and county, in each month of 2026 and 2027. On the map it is the Chance of fire layer with Forecast 2026 or 2027 picked.

**It is built from fire history alone.** It knows nothing about weather, fuel or ignitions, so it is the long-run chance for that place and month, not a warning that a month will be unusual.

**Data.** VIIRS months only, February 2012 to December 2025. The older MODIS years are left out: the conversion fixes hotspot counts, but MODIS misses many small fires, so a MODIS month with no hotspot does not mean the same thing. Letting them in was tested and did not help.

**Model.** It starts from how often the place burned in that calendar month, then:

- counts recent years more (a half-life chosen by the backtest: 4 to 10 years in the published model; individual test years chose from 3 years up to no decay at all);
- pulls each hexagon toward its neighbours, and each county toward nearby counties, where its own history is thin;
- adds a statewide trend only where the backtest chose one (in the end, only California counties).

**Backtest.** Each year 2018–2025 was predicted from the years before it. The settings for each test year were chosen only on earlier years, so no year helped choose its own settings. The baseline, "past odds", is the share of earlier VIIRS years with fire in that place and month, which is what the map shows under Past odds. Lower Brier is better; AUC measures how well it ranks places.

| Tested on 2018–2025 | Brier, forecast | Brier, past odds | Lower by | AUC, forecast / past odds | Years better | 2 years ahead (2027 case), lower by |
| --- | --- | --- | --- | --- | --- | --- |
| New York hexagons | 0.0117 | 0.0125 | 5.9% | 0.786 / 0.642 | 8 of 8 | 7.2% |
| New York counties | 0.145 | 0.151 | 4.4% | 0.779 / 0.759 | 8 of 8 | 5.2% |
| California hexagons | 0.0629 | 0.0657 | 4.3% | 0.828 / 0.782 | 8 of 8 | 5.1% |
| California counties | 0.108 | 0.111 | 2.7% | 0.861 / 0.862 | 7 of 8 | 3.7% |

**Verdict: modestly better than past odds,** by 2.7–5.9% on Brier score in every state and unit. Most of the gain is in ranking hexagons. County ranking barely changes, and in California it is 0.001 worse.

**2027.** The two years differ only through the trend term, and the backtest chose one only for California counties. So for New York (hexagons and counties) and California hexagons, the 2027 chances of any fire are the same as 2026's; the page says so when Forecast 2027 is picked, and the CSV's 2027 rows repeat 2026's. Tested two years ahead, the forecast still beat past odds by 7.2% (New York hexagons) and 5.1% (California hexagons). The California large-fire layer has its own two-year fit, so its 2027 differs.

**Not fire.** The two hexagons holding the Ivanpah solar power plant count as having no fire (`NOT_FIRE` in the build script). Without that, the plant's towers gave its hexagon a 51% chance for August 2026.

**Limits.**

- **The gain is shrinking** as history piles up. For New York hexagons it was 14.5% in 2018 and 3.0% in 2025, so expect the low end for 2026.
- **Small chances run low.** Where it said under 1%, fire came 1.6–3.2 times as often as it said, though still only about 0.4–1.3% of the time.
- **New York runs low overall,** about 17%: in the tests it expected 1.0% of hexagon-months to burn and 1.2% did, because fire there has been rising since 2012. A trend term was offered and did not improve the backtest. Treat New York totals as probably too low; the page says so.
- Hexagons and counties are forecast separately. In 10 of 1,488 New York county-months the county's chance is below its likeliest hexagon's, so the page and the county CSV give the higher of the two for a county.
- Chances are stored in whole thousandths. A 0 means under 0.05%, and the page shows it as "<0.1%".

The full sheet shows these numbers with calibration charts, worked out from `forecast.js`. Rebuild with `.venv/bin/python scripts/build_forecast.py` (about 50 s, numpy only); it also merges `forecast_inputs/large.json` when present.

## Large fires (California)

NASA's hotspots do not record fire size, so "large fires only" uses CAL FIRE's official fire boundary maps instead.

**Source.** CAL FIRE Fire and Resource Assessment Program (FRAP), "California Fire Perimeters (all)", with USDA Forest Service Region 5, BLM, NPS, USFWS and local agencies. Map service: https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/California_Historic_Fire_Perimeters/FeatureServer/0 ([program page](https://www.fire.ca.gov/what-we-do/fire-resource-assessment-program/fire-perimeters)). Retrieved 2026-11-15.

**Definition.**

- A large fire is a perimeter of at least 1,000 mapped acres, 2001–2025, placed in the month it was reported (the containment month only if that date is missing; no large fire needed it).
- A hexagon is marked for a month when a large fire that started that month covers at least 1% of it, or more of that fire than any other hexagon.
- That gives 1,115 large fires and 2,570 marked hexagon-months; 1,217 of the 2,718 hexagons were marked at least once.

**Past odds of a large fire** are the share of the chosen years (2001–2025 by default) in which a large fire that started in that month reached the hexagon.

**Forecast.** A logistic regression on features from fire history only (the place's large-fire rate in that month and its neighbours', its rate in any month, a recency-weighted rate, the state's seasonal rate, its harmonized hotspot history, and whether it had a large fire recently). It is fitted separately for one and two years ahead. Tested the same way on 2018–2025:

| Large fires, 1 year ahead | Brier, forecast | Brier, past odds | Brier, state seasonal average | AUC, forecast / past odds | Large-fire hexagon-months in the top 5% |
| --- | --- | --- | --- | --- | --- |
| Hexagons | 0.00389 | 0.00402 | 0.00391 | 0.871 / 0.610 | 36% (past odds: 26%) |
| Counties | 0.04852 | 0.04860 | 0.05146 | 0.860 / 0.834 | 29% (past odds: 29%) |

Much of its AUC comes from the season: a rule that knows only the month (the state seasonal average) already scores 0.810, against the forecast's 0.871 and past odds' 0.610, which are mostly exactly 0. The fairer test of ranking places is the top 5%: it holds 36% of the hexagon-months that had a large fire, against 26% for past odds and 25% for the seasonal average. Its Brier score is only 3.3% better than past odds and 0.7% better than the plain seasonal average. For counties it is about the same as past odds: 0.2% better one year ahead, and marginally worse two years ahead.

**Limits.**

- **It cannot tell a big year from a quiet one.** It expected about 111 large-fire hexagon-months in 2020, which had 327, and about 169 in 2022, which had 50. Read it as typical odds for the place and month.
- The perimeter maps are incomplete, by CAL FIRE's own caveat: some perimeters are missing, duplicated or over-generalized, and unburned islands inside a perimeter count as burned. 8 perimeters of 300 acres or more had no date and are left out.
- A fire is marked only in its start month, though large fires can burn into the next.
- Some perimeters cross the Oregon and Nevada lines (for example Biscuit, 2002); they count where they reach a California hexagon.
- Large fires and all fires make different maps: 77% of California's VIIRS hotspots fall inside a large-fire perimeter while it burned, but only 40% in 2019 against 90% in 2020.
- New York has no large-fire layer. It needs official fire boundary maps, and this site has them only for California.

Rebuild the layer with:

```sh
.venv/bin/python scripts/build_large_fires.py --out DIR      # downloads the perimeters (6.5 MB) once; needs shapely
.venv/bin/python scripts/build_large_layer.py DIR            # writes forecast_inputs/large.json
.venv/bin/python scripts/build_forecast.py --merge-only      # merges it into forecast.js
```

Then raise `forecast.js?v=` in `index.html`.

## 2-week outlook

On the map, **Next 14 days** gives each county's chance of **at least one VIIRS (Suomi NPP) hotspot from today through the next 13 days**, and colours it by how much the weather forecast raises or lowers that chance. The full data lists the counties to watch, by chance or by how much the weather raises it, with a CSV.

**It is a small nudge on the usual odds, not a fire-danger rating.** A hotspot is a satellite detection, and many are farm or prescribed burns. In the backtest the model beat the usual odds by only about 2%, and that backtest was generous (see below).

**How it is built.**

- **Usual chance.** For each county and day of the year, the share of years 2012–2025 in which VIIRS saw a hotspot in the 14 days starting that day, pooled over nearby days (±30 days in New York, ±21 in California) and pulled toward the county's average. Both settings were chosen by leave-one-year-out Brier score. Hotspots use the same filter as the rest of the site (type 0, confidence nominal or high, industrial sites removed); monthly county totals match `data.js` to within 96 of 4,905 hotspots in New York and 2,249 of 862,949 in California.
- **Weather.** When the reader picks Next 14 days or opens the full data, the page asks [Open-Meteo](https://open-meteo.com/) (free, no key, data CC BY 4.0) for daily rain and reference evapotranspiration (ET0, how fast the air dries the ground) at one point inside each county: the past 30 days and the next 14, from the ECMWF IFS 0.25° model, the same family and grid as the ERA5 data the model was trained on. Any county ECMWF leaves a gap in is asked again with Open-Meteo's best-match model.
- **Model.** A logistic regression per state, 7 numbers: the usual chance (as log-odds), rain over the next 14 days, the share of those days with under 1 mm of rain, mean ET0 over the next 14 days, rain over the past 30 days, and the past 30 days' ET0 minus rain. The share of dry days ahead carries most of the signal. It was fitted on 2019–2025, because Open-Meteo's free quota allowed only 7 years of ERA5 weather for 120 points.
- **Weather's effect.** The map colours, the count of counties the weather raises or lowers, and the "weather raises most" ranking all use `p ÷` the model's chance with no weather input: "the weather pushes it up" from 1.1×, "pulls it down" from 0.9×. They do not use `p ÷` the raw usual chance, because the model also carries a correction learned from the record that has nothing to do with the weather: in New York it lifts the no-weather chance to a median 1.4 times the raw usual chance in November (59 of 62 counties at 1.1× or more), so against the raw usual nearly every county would look "above usual" before any weather went in. The tooltip and CSV still give the chance, the usual chance and the no-weather chance. Where the usual chance is under 3%, the effect is mostly noise: those counties are faded on the map and left out of the ranking.

**Backtest.** Each year 2019–2025 was predicted by a model fitted on the other years, every day and every county. **The next 14 days' weather in the test is ERA5 reanalysis, the weather that actually happened**, so the last row is the best the model could do. A real forecast is wrong some of the time, more so in the second week, so the live outlook will do less well. Real forecasts were not tested: Open-Meteo's archive of past forecasts was beyond its free quota.

| Brier skill: against the usual odds / against the recalibrated usual odds | New York | California |
| --- | --- | --- |
| Usual odds alone (Brier) | 0.1021 | 0.1507 |
| Usual odds, recalibrated: no weather at all | +0.13% / – | +0.37% / – |
| + past 30 days of weather (needs no forecast) | +0.45% / +0.32% | +0.09% / −0.28% |
| + the next 7 days' weather, as it turned out | +1.38% / +1.25% | +1.36% / +0.99% |
| **+ the next 14 days' weather, as it turned out (the model used)** | **+1.89% / +1.76%** (AUC 0.771 → 0.787) | **+2.21% / +1.85%** (AUC 0.843 → 0.850) |

Part of each gain needs no weather: refitting the usual odds alone (the second row) already helps a little. That refit is the model's no-weather chance, which the map compares against, so the second number in each cell is the weather's own skill. In California the past 30 days of weather add nothing beyond the refit (−0.28%); all the weather's skill there is in the days ahead. The model used beat the usual odds in every held-out year: in New York from +0.1% (2019) to +3.6% (2025), in California from +0.03% (2022) to +5.0% (2023). We expect the live outlook to land between the "past 30 days" row and the last; that was not tested.

**Requests.** The page sends 4 requests per state (16 counties each, in parallel, so a slow answer comes back sooner) with a 40-second limit, about 62 of Open-Meteo's 10,000 free daily calls per visitor for New York and 58 for California. Nothing is sent until the reader picks Next 14 days or opens the full data. The result is kept in memory and in the browser's storage for 3 hours, and not past midnight in the state, when its 14 days would start yesterday. If the weather service fails or the reader is offline, the layer and the sheet say so and offer Retry; if some requests fail, those counties show "no forecast" and the rest still show, and Retry asks again only for those counties, keeping the ones already in. The rest of the page does not depend on it.

**Limits.**

- The skill is small: about 2% with perfect weather, less with a forecast.
- The weather model has 7 years behind it.
- It does not know about fires burning now. Adding "hotspots in the last 14 days" would probably help more than the weather does, but it needs live FIRMS data, which needs a key and is not wired in.
- One weather point per county; large counties (San Bernardino) have more than one climate.
- San Bernardino County's usual chance includes the Ivanpah solar plant's daytime hotspots (see Limits above), so it runs high there. Rebuilding `outlook.js` without them needs the weather download again.
- The 14 days start on the county's local date as Open-Meteo reports it.

Rebuild `outlook.js` with `.venv/bin/python scripts/build_outlook.py [--cache DIR] [--out outlook.js]`. With its weather cache it runs in seconds; without one it downloads about 4,400 Open-Meteo calls of ERA5 weather (about 25 minutes). Then raise `outlook.js?v=` in `index.html`.

## Global 2-week outlook

Every country page has a **Next 14 days** section, and the globe has a **Next 14 days** view. Both give the chance that **the 14 days starting today bring more VIIRS (Suomi NPP) hotspots than the region's usual (median) fortnight for this half of the month**, 2012–2025. Where the usual count is 0, that means at least one hotspot. The country page shows each region's chance next to the model's chance with average weather, colours each region by the difference, writes a one-line summary weighted by where the country's fire usually is, and ranks the regions where the weather moves the odds most. The globe colours each country by that fire-weighted difference.

**It answers "will satellites see more fire than usual here this fortnight?", not "is there a fire danger warning".** Hotspots are satellite detections, not fires, and many are farm or managed burns. Clouds and rain also hide fires from the satellite, so part of the rain effect is fewer detections, not fewer fires.

**Sources.** Fire history: [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) VIIRS Suomi NPP hotspots, 2012–2025, from the yearly country files (type 0, confidence nominal or high, industrial sites removed). Training weather: [NASA POWER](https://power.larc.nasa.gov/) daily data (MERRA-2): maximum temperature, dew point and rain. Live weather: the [Open-Meteo](https://open-meteo.com/) forecast (free, no key, data CC BY 4.0): daily maximum temperature, mean dew point and rain, for the past 30 days and the next 14.

**How it is built** (`scripts/build_world_outlook.py`).

- **Regions.** A 2.5° grid (bands of 2.5° latitude, with fewer columns towards the poles, so cells are about 280 km across). Every cell with hotspots on at least 28 distinct days in 2012–2025 is a region: 2,104 of the 2,578 cells with any hotspot. Each region's weather is read at one point, the centre of its busiest 0.5° patch. Regions cross borders; a country page uses the regions holding at least 0.1% of its hotspots and draws the rest grey.
- **Usual chance.** For each region and half-month, the share of past fortnights that were busier than the median, pooled over nearby days.
- **Model.** One logistic regression for all regions, 6 numbers: the usual chance (log-odds) and four weather anomalies, each standardised against the region's own POWER climate for the day of the year: mean maximum temperature, mean daily minimum humidity and total rain over the next 14 days, and total rain over the past 30 days. Wind was tried and dropped (it added nothing).
- **Open-Meteo on POWER's footing.** The two sources disagree. Per region, the page subtracts the average gap in temperature and dew point and scales rain, learned from 48 days both sources cover (14 August to 30 September 2026). That correction does not carry over to other months: a review re-ran it on 13–30 October and 1–12 November 2026 and the two sources' predicted chances agreed about as poorly as with no correction (correlation 0.60–0.68, against 0.65 uncorrected), and live mid-November forecasts showed a standardised humidity spread of about 2 instead of 1.
- **Fitted for that gap.** So the shipped model is fitted on weather inputs blurred by the full gap between the sources (Gaussian error with standard deviations 2.0 for temperature, 1.85 for humidity, 1.1 and 1.35 for rain, in standardised units; that is at or above 1.25 times the measured mean uncorrected gap). Its weather effects are smaller than a model fitted on clean inputs, which is right for inputs that are this far off.
- **"Normal".** The colours, the summaries and the rankings compare the chance with the same model's chance for average weather (every anomaly 0), so they show the weather's effect alone.

**Backtest.** Each year 2012–2025 was left out in turn and predicted by a model fitted on the other years, with issue dates every 7 days in every region (1.48 million fortnights). **No test used a real forecast.** The next 14 days' weather in the test is NASA POWER, the weather that actually happened; the "with the gap" rows add simulated errors of the size above.

| Brier skill against the usual odds alone | |
| --- | --- |
| Usual odds, recalibrated (no weather) | −0.3% |
| Past 30 days of rain only (needs no forecast) | +1.0% |
| Fitted on clean inputs, observed next 14 days + past 30 (the first version) | +8.9% |
| The same, with errors the size of the gap in August–September | +5.3% |
| The same, with errors the size of the full gap | **−2.0%**: worse than the usual odds |
| **Fitted for the gap (the model used), observed weather** | **+6.6%** (AUC 0.646 → 0.740) |
| **The model used, with errors the size of the full gap** | **+4.3%** (AUC 0.706) |

The model used beat the usual odds in every held-out year with observed weather (+5.8% to +7.9%). With the gap added, by continent: Europe +6.1%, South America +6.0%, Asia +4.7%, North and Central America +4.4%, Oceania +3.0%, Africa +1.8%; by latitude: tropics +4.8%, subtropics +3.2%, temperate +4.8%, boreal +2.3%. Each country page quotes its own two numbers and its zone's. A country's numbers cover the regions its page forecasts, each weighted by its share of the country's hotspots, so a neighbour's fire in a shared cell counts only as much as the country's own.

**Limits, plainly.**

- **The live outlook may do no better than the usual odds.** +4.3% simulates a different weather source, not a forecast: forecasts add their own errors, more so in the second week, and archived 14-day forecasts were not tested. The pages call it a hint, not a warning.
- **No outlook in 47 of 220 countries.** A country gets an outlook only where the test with the full gap beat the usual odds by at least 1% (a margin for the forecast's own errors). That leaves out deserts, small islands and parts of West Africa (Sudan, Chad, Niger, Nigeria, Cameroon, Senegal, Liberia, Saudi Arabia, Egypt, Libya, Iceland, Greenland and others). Their pages say so and fetch no forecast, and the globe draws them dark grey. Within other countries, 506 of the 2,104 regions did not beat the usual odds with the gap; they are hatched on the map and marked in the list.
- **Weather outside the 2012–2025 record is left out.** When a region's forecast is more than 3.5 standard deviations from its usual weather for the date (about 1 in 100 fortnights in the POWER record), the model would be extrapolating. The page shows the region in grey and leaves it out of the summary and the ranking. This happens far more often live (on 15 November 2026: 23 of 186 regions in Russia, 18 of 73 in Indonesia). That may be unusual weather or a gap between the sources: a review found POWER's own 2026 data that far out in about 11% of mid-September windows, so we cannot tell which. If less than 75% of a country's fire has a usable forecast, the page says there is no reliable outlook today and does not sum up the country.
- In the test with the gap, predictions were well calibrated (the top bin, 0.81, came true 0.79 of the time); the page still shows "over 85%" above 85%.
- 14 tiny territories have too little fire history for a region, and 4 countries had no vegetation-fire hotspots at all once offshore and industrial detections are removed (Maldives, Marshall Islands, Monaco, South Georgia); their pages say so.
- It does not know about fires burning now.

**The daily snapshot.** `.github/workflows/world-outlook-today.yml` runs `npm run outlook-today` (`scripts/world_outlook_today.ts`) twice a day on GitHub's servers, and once whenever `world_outlook.js` or the outlook code changes on `main`. It fetches the forecast for all 2,104 regions in 9 requests of up to 250 points, 32 seconds apart (about 2,100 Open-Meteo calls, under the free limits of 600 a minute and 10,000 a day), works out every region with the page's own code (`src/wol.ts`), and commits `world_outlook_today.json` (about 40 KB). If a request still fails after retries, nothing is written and the old file stays. The globe's **Next 14 days** button appears only when that file is less than 36 hours old. Country pages read it first, so a visitor makes no weather calls. Without a fresh snapshot a country page fetches its own regions from Open-Meteo, about one call per region in parallel batches of 50 points (15 for Kenya, 116 for Brazil, 186 for Russia), kept in memory and in the browser's storage for 3 hours. You can also run `npm run outlook-today` by hand and commit the file.

Rebuild `world_outlook.js` with `.venv/bin/python scripts/build_world_outlook.py` (stages `extract`, `regions`, `fetch`, `overlap`, `model`; see the script). The NASA POWER download takes about 22 minutes and the model stage about 12. The Open-Meteo overlap days used for the correction can no longer be fetched, so keep the build's cache.

## Country pages: 2026–2027 and fire stations

Two sections on every country page. Both files are fetched from the Hugging Face dataset only after the country's summary has arrived, so they never hold up the page. Each gives up after 20 seconds and then says, in one line with a Try again button, that it did not load; the rest of the page is unaffected. The code is in `src/cfore.ts` and `src/cstn.ts`; their small maps are flat SVG (`src/minimap.ts`), not a second MapLibre map.

**2026 and 2027** (`forecast/v1/<Country>.json`, built by [scripts/build_world_forecast.py](scripts/build_world_forecast.py) from `summary/v2`, data through December 2025). The forecast was made before 2026 began, and most of 2026 has now happened, so the section first checks it: 2026 so far (from `summary/v3`, to 14 November) against what the forecast expected for the same dates and against the 2001–2025 average for those dates, and how many complete months fell inside its 80% range (the chart shows them as red dots on the band). Only the rest of 2026 (15 November–31 December) and 2027 are given as forecasts, each as an average with its middle path (the sum of the monthly medians), because one big past year pulls the average up. The map shows the chance of at least one hotspot in 2026 that the forecast gave each grid square (or the expected hotspots per square), and how many of those squares have burned in 2026 so far. When `summary/v3` does not load and the page falls back to `summary/v2`, the check is left out and 2026 is described as forecast, in the past tense. It uses the fire record alone: each calendar month is the spread of the same month in past years, recent years counted more (half-life 4 years), with a damped 10-year trend. There is no weather, fuel or ignition data, so it shows what a typical year looks like now, not which fires will happen. 2027 differs from 2026 only through the trend.

It was tested on 2018–2025, each year forecast from the years before it, against "history alone" (every past year counted the same, no trend). The gain is small: the median country improved by about 3% (CRPS of monthly counts), and most of it comes from counting the VIIRS years more than the older MODIS years. With the one published setting, 138 of 234 countries score above zero and 96 at zero or below; with the setting chosen afresh each test year (the cleaner, nested test), 132 are better and 102 worse. The published setting was picked on the same 2018–2025 years, so its per-country scores flatter it slightly, and the page says so. The 80% range is too narrow in big countries (it held 66% of months in India, 73% in the US). Each page shows its own country's score. The page follows the build script's own verdict: a score between −2% and +2% is "about as good as history alone". Where the forecast did not beat history alone by more than 2% (110 countries, including the US, Canada, Australia and Iceland), the page leads with the usual year and says so instead of offering a forecast. The CSV button downloads the 24 monthly values.

**Fire stations** (`stations/v2/<Country>.json`, built by [scripts/build_world_stations.py](scripts/build_world_stations.py)). The fire stations tagged `amenity=fire_station` in OpenStreetMap (planet file of 21 September 2026), set against the grid squares where VIIRS (Suomi NPP) saw fire in at least 4 of the 14 years 2012–2025. A gap is such a square with no fire station mapped in OpenStreetMap within 15 km of its middle. The page shows the count of stations, a map, the first 10 gaps and a table of distances. Squares whose heat looks steady (gas flares, industrial sites, mines, kilns) are greyed out and never called gaps.

OpenStreetMap is mapped unevenly, and the file rates each country against others in its income group. Where the mapping is "fair" (121 countries) the gaps are listed. Where it is "patchy" (38, including Brazil and Saudi Arabia) they are hidden behind a button, under a note. Where it is "thin" (68, including India, China, Nigeria and Sudan) gaps are not shown at all, only stations and distances. Distances are straight lines, not drive times, and stations across a border are not counted. Gaps in the Arabian Peninsula and the Sahara are marked unverified, because drilling and well-test flares that FIRMS did not flag can look like fire there. A recheck also found day-only heat that looks like large solar plants in the UAE, Chile and Israel. The listed gaps where almost none of the detections were at night (three inland Dubai squares, one in the Atacama) carry a note, and the other two pages say that some regular-fire squares may be solar plants. Patchy countries show the median distance to a mapped station, not a gap count, until the gaps are asked for. Fire stations © OpenStreetMap contributors, ODbL.

## World fire data

Every FIRMS yearly country file (MODIS 2000-2025, VIIRS Suomi NPP 2012-2025, VIIRS NOAA-20 2018-2025; 548.5 million detections, 238 countries) is published as Parquet at [rogeryzd/firms-active-fire-by-country](https://huggingface.co/datasets/rogeryzd/firms-active-fire-by-country) on Hugging Face. A web page can fetch any file from there directly.

- [scripts/build_world_parquet.py](scripts/build_world_parquet.py) downloads the archive from NASA and converts it. Each Parquet file is checked to reproduce its source CSV byte for byte.
- The country page reads the per-country summaries in `summary/v3/` (2001 to 14 November 2026), with `summary/v2/` (2001–2025) as the fallback.
- [dataset/README.md](dataset/README.md) is the dataset's description page on Hugging Face, with NASA's acknowledgement, disclaimer and data-use terms.

To rebuild it: `uv venv .venv && uv pip install --python .venv/bin/python duckdb huggingface_hub`, then `.venv/bin/python scripts/build_world_parquet.py`. It needs about 10 GB of download and 8 GB of disk; output goes to `build/hf/`, which git ignores.
