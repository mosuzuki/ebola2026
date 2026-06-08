# DRC Ebola mobility dashboard data

Generated from:
- drc-estimated-relocations-2020_03-2026_04-v2.0-external.csv

Files to upload into the GitHub repository `data/` folder:
- monthly_flows.csv
- destinations.csv
- outbreak_zones.csv
- scenarios.csv

Processing:
- Source file is wide-format Flowminder estimated relocation data.
- Main estimate columns `est_flows_YYYY_MM` were reshaped to long format.
- Lower/upper bound columns (`_LB`, `_UB`) were not used.
- Redacted cells reported as `redacted (count <15)` were imputed as 7.5 and rounded to 8 for dashboard display.
- Blank cells were treated as 0 and omitted from `monthly_flows.csv`.
- Origins were restricted to the current outbreak proxy health zones:
  Bunia, Mongbwalu, Nyankunde, Rwampara

Caveat:
- Latitude/longitude values in `destinations.csv` are approximate fallback coordinates for dashboard visualization.
- For analytic maps, replace these with official health-zone centroids from HDX/GRID3 boundary data.
- Uganda estimates are proxy/scenario-based, using movement to selected Uganda-border DRC health zones.

## Population layer

The uploaded relocation file contains OD movement estimates only. To enable the population layer, add a Flowminder population extract at:

`data/population_by_hz.csv`

Required columns:

- `month` (e.g. `2026-04`)
- `zone_id`
- `zone_name`
- `province`
- `lat`
- `lon`
- `population`

Once this file is populated, the dashboard's Population / Movement buttons will switch between the population bubble map and the movement flow map.


## Population data added

`data/population_by_hz.csv` was generated from `drc-estimated-residents-2020_03-2026_04-v2.0-external.csv`. Columns `est_pop_YYYY_MM` were reshaped to long format. Coordinates were merged from the existing dashboard health-zone coordinate table where available. For health zones without a coordinate in the existing table, province-level approximate coordinates with small deterministic jitter were used for display only; replace with official GRID3/HDX health-zone centroids for analytical mapping.


## Optional health-zone polygon layer

To display population and population density as health-zone choropleth polygons, add a GeoJSON file at:

```text
data/health_zones.geojson
```

The GeoJSON should contain one polygon or multipolygon feature per health zone. The dashboard tries to join polygons to `data/population_by_hz.csv` using common property names such as `zone_id`, `hz_id`, `HZ_ID`, `health_zone_id`, or by health-zone name such as `zone_name`, `hz_name`, `HZ_NAME`, or `name`.

Population density is calculated in the browser as:

```text
population density = estimated population / polygon area in km²
```

If the GeoJSON has an `area_km2` property, that value is used. Otherwise, the dashboard calculates polygon area with Turf.js.

## Spread risk layer

The dashboard includes a `Spread risk` map layer. This is a mobility-based prioritization index, not a predicted transmission probability.

For each destination health zone and selected month:

```text
risk index = incoming estimated movements from selected outbreak health zone(s)
```

If `data/health_zones.geojson` is provided, health zones are colored as polygons. If not, the dashboard falls back to proportional risk bubbles using available latitude/longitude coordinates.

To make this epidemiologically stronger, add an outbreak intensity file in a future version, for example cases by outbreak health zone and month. Then the numerator can be weighted by case counts or transmission intensity rather than treating all outbreak health zones equally.


## Uganda projection layer

The Uganda projection layer is intentionally labelled as a scenario-based estimate. It combines DRC-side Flowminder health-zone movement toward Uganda-border proxy zones with a historical IOM DTM Uganda-DRC border Flow Monitoring Point destination profile from January-March 2020. It is not observed 2026 cross-border movement and is not a prediction of Ebola transmission.

Required file: `data/uganda_projection_profile.csv` with columns `uganda_id, uganda_name, type, district, lat, lon, weight, source_basis`. The current profile allocates projected Uganda-side movement to Bufumbira, Bukonzo, Bwamba, Padyere, Kisoro, Kampala, and other Uganda destinations using approximate weights derived from the uploaded IOM DTM dashboard summaries. Replace this file when current FMP, UNHCR, or Uganda-side settlement data become available.


## Case-count, weighted-risk and forecast layers

This version adds `data/cases_by_hz.csv`, derived from SitRep N22/MVB_05/06/2026, reporting date 05 June 2026. The file contains cumulative confirmed Ebola cases and confirmed deaths by affected health zone where ventilated in the SitRep. Ituri also includes an unventilated category, which is included in totals but cannot be mapped to a specific polygon.

New layers:

- `Cases`: colors health zones by cumulative confirmed cases.
- `Weighted risk`: colors destination health zones by case-weighted movement pressure, defined as Σ confirmed_cases(origin) × estimated movement(origin→destination) for the selected month.
- `Forecast`: uses the same case-weighted score but applies the next available mobility month; when the selected month is the latest available mobility month, it uses the average of the latest three mobility months. This is a scenario-style forward-looking prioritization indicator, not a transmission probability.


## Air-adjusted risk layer

`data/air_adjustment.csv` defines suppression factors for air-plausible destinations. Default assumptions: Kinshasa-bound long-distance air-plausible risk is multiplied by 0.25; selected regional air hubs are partially down-weighted. This reflects a scenario in which infected traveller risk via passenger flights is lower than the pre-outbreak baseline because of flight suspension/reopening and health screening. It is not observed airline passenger OD.

`data/cases_by_hz.csv` is updated from SitRep N23/MVB_06/06/2026. Unventilated Ituri cases are stored separately in `data/cases_unventilated.csv` and are not shown as bubbles.
