# DRC Ebola Mobility Dashboard

Static GitHub Pages dashboard for visualising estimated movement from Ebola outbreak health zones in eastern DRC toward:

1. Kinshasa health zones; and
2. Uganda-border proxy health zones.

The included CSV files are **illustrative sample data**. Replace them with Flowminder / HDX, HDX/GRID3, IOM DTM, UNHCR, and outbreak line-list derived extracts before analytical use.

## Live dashboard structure

- `index.html` — static page
- `assets/app.js` — dashboard logic, Leaflet map, Plotly charts
- `assets/style.css` — styling
- `data/outbreak_zones.csv` — outbreak-origin health zones
- `data/destinations.csv` — destination health zones and categories
- `data/monthly_flows.csv` — origin-destination movement matrix by month
- `data/scenarios.csv` — onward-crossing assumptions for Uganda
- `scripts/prepare_data.py` — template converter for real data
- `.github/workflows/pages.yml` — GitHub Pages deployment workflow

## Expected data schemas

### data/outbreak_zones.csv

```csv
zone_id,zone_name,province,lat,lon,is_outbreak,is_uganda_border,is_kinshasa
```

### data/destinations.csv

```csv
zone_id,zone_name,province,lat,lon,category,is_uganda_border,is_kinshasa
```

Use `is_kinshasa=1` for Kinshasa health zones. Use `is_uganda_border=1` for DRC health zones representing Uganda-border proxy destinations.

### data/monthly_flows.csv

```csv
month,origin_id,destination_id,movement
```

`movement` should be the monthly estimated movement from the origin health zone to the destination health zone.

### data/scenarios.csv

```csv
scenario_id,scenario_name,cross_border_fraction,description
```

`cross_border_fraction` is the assumed fraction of movement toward Uganda-border proxy zones that continues onward into Uganda.

## Data sources to connect

- Flowminder / HDX DRC population and mobility estimates: https://data.humdata.org/dataset/democratic-republic-of-congo-population-and-relocation-estimates
- HDX DRC health-zone boundaries: https://data.humdata.org/dataset/drc-health-data
- GRID3 DRC geospatial data: https://grid3.org/geospatial-data-drc
- IOM DTM DRC: https://dtm.iom.int/democratic-republic-congo
- UNHCR Uganda Operational Data Portal: https://data.unhcr.org/en/country/uga
- UNHCR DRC situation: https://data.unhcr.org/en/situations/drc

## How to publish on GitHub Pages

1. Create a new GitHub repository, for example `drc-ebola-mobility-dashboard`.
2. Upload all files in this folder.
3. Go to **Settings → Pages**.
4. Set **Source** to **GitHub Actions**.
5. Push to the `main` branch. The included workflow will deploy the site.

## Local preview

Because the dashboard uses `fetch()` to read local CSV files, preview it through a local web server:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## Analytical interpretation

The Uganda value is not directly observed cross-border movement in the sample implementation. It is computed as:

```text
movement from outbreak health zones to Uganda-border proxy health zones
× assumed onward-crossing fraction
```

This should be calibrated with UNHCR Uganda, IOM DTM, or border-monitoring data when available.

## Recommended next steps

1. Replace `monthly_flows.csv` with Flowminder / HDX health-zone OD estimates.
2. Replace point coordinates with health-zone polygons from HDX or GRID3.
3. Add observed DRC-to-Uganda refugee or border-flow data from UNHCR/IOM for calibration.
4. Add outbreak intensity by origin health zone and compute an export pressure index:

```text
Export pressure_j,t = sum_i outbreak_intensity_i,t × movement_i,j,t
```

5. Add GitHub Actions scheduled data refresh if public downloadable data endpoints are stable.

## Limitations

- Included data are synthetic and for demonstration only.
- CDR-derived movement is affected by phone ownership, operator share, and representativeness.
- Uganda-border proxy movement should not be described as confirmed cross-border movement.
- Age- and socioeconomic-stratified movement requires additional reweighting using DHS/MICS/MAFE/UNHCR/IOM data.


## Actual Flowminder data loaded

The `data/` folder in this package has been replaced with reshaped Flowminder DRC estimated relocation data from 2020-04 to 2026-04, restricted to outbreak proxy origins: Bunia, Mongbwalu, Nyankunde, and Rwampara.
See `DATA_NOTES.md` for processing assumptions.

### Spread risk layer

The `Spread risk` button colors health zones by mobility-based Ebola spread pressure from the selected outbreak health zone(s). The current index is the estimated number of arrivals from outbreak zones to each destination health zone in the selected month. It is not divided by destination population. It is intended for relative prioritization of surveillance and preparedness; it should not be interpreted as the probability of local Ebola transmission.


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

This version adds an Air-adjusted risk layer. It applies route-specific suppression factors in `data/air_adjustment.csv` to case-weighted movement scores for long-distance, air-plausible destinations such as Kinshasa. This is a scenario-based prioritization indicator and does not represent observed passenger OD data.

Case counts are updated from SitRep N23/MVB_06/06/2026. The Ituri unventilated category (94 cases, 10 deaths) is not mapped as a case bubble because it cannot be assigned to a specific health zone.
