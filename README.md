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

The page fetches five things from the network: its fonts (Google Fonts), three.js for the globe (cdnjs), street-map tiles from OpenStreetMap (one test tile when the page opens, the rest when you zoom far in), the weather forecast from Open-Meteo for the 14-day outlook (when you open New York or California), and, when you open a country, that country's summary file from the Hugging Face dataset described below. Without a connection it uses system fonts, shows plain buttons and the country search in place of the globe, draws its own roads in place of the street map, and says the outlook is unavailable with a Retry button; country views need the connection.

## What you can do

- Start on a globe and pick New York or California, or compare the two states side by side.
- Click any country on the globe, or search for it, to open its own page: busiest months, worst years, a month-by-month calendar, a map of where it burns, the evidence for the conversion and a CSV of the monthly series. Its data is fetched from Hugging Face when you open it.
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

GitHub Pages serves this repository as it is, so commit the rebuilt `app.js` together with your source change. `index.html` loads `app.js?v=15`, `data.js?v=4` and `world.js?v=1`. `app.js` loads `response.js?v=1`, `forecast.js?v=3` and `outlook.js?v=1` when New York or California first opens; their numbers are in `src/extras.ts`. Raise the number when a file changes (for the last three, in `src/extras.ts`, then rebuild `app.js` and raise its number too), so that returning visitors do not get a stale cached copy.

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

## World fire data

Every FIRMS yearly country file (MODIS 2000-2025, VIIRS Suomi NPP 2012-2025, VIIRS NOAA-20 2018-2025; 548.5 million detections, 238 countries) is published as Parquet at [rogeryzd/firms-active-fire-by-country](https://huggingface.co/datasets/rogeryzd/firms-active-fire-by-country) on Hugging Face. A web page can fetch any file from there directly.

- [scripts/build_world_parquet.py](scripts/build_world_parquet.py) downloads the archive from NASA and converts it. Each Parquet file is checked to reproduce its source CSV byte for byte.
- The country page reads the per-country summaries in `summary/v3/` (2001 to 14 November 2026), with `summary/v2/` (2001–2025) as the fallback.
- [dataset/README.md](dataset/README.md) is the dataset's description page on Hugging Face, with NASA's acknowledgement, disclaimer and data-use terms.

To rebuild it: `uv venv .venv && uv pip install --python .venv/bin/python duckdb huggingface_hub`, then `.venv/bin/python scripts/build_world_parquet.py`. It needs about 10 GB of download and 8 GB of disk; output goes to `build/hf/`, which git ignores.
