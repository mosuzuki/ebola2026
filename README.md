# DRC + Uganda Ebola Bundibugyo Intelligence Dashboard

GitHub Pages dashboard for situational awareness, epidemiological research screening, and therapeutics/vaccine/diagnostic R&D tracking for the DRC + Uganda Ebola Bundibugyo outbreak.

## What is included

- Compact current situation cards
- Japanese 48-hour digest generated at build time
- Institutional update timeline, newest first, first 10 items shown by default
- ECDC-style epidemiological situation map using Leaflet and `map_features.csv`
- Epidemic curve and geographic distribution
- Dedicated **Epidemiological Research** tracker separated from product R&D
- Dedicated **Therapeutics, vaccines and diagnostics R&D** tracker
- CSV downloads for all curated datasets
- GitHub Actions workflow scheduled every 6 hours
- Europe PMC candidate-fetch hooks for automated literature screening

## Deploy

1. Create a new GitHub repository.
2. Upload the full contents of this folder.
3. Go to **Settings → Pages**.
4. Select **Deploy from a branch**.
5. Select `main` branch and `/docs` folder.
6. Open the GitHub Pages URL after deployment.

## Update frequency

The workflow runs every 6 hours:

```yaml
schedule:
  - cron: "0 */6 * * *"
```

It can also be run manually from the GitHub Actions tab.

## Data files

Curated files:

- `data/processed/situation_timeseries.csv`
- `data/processed/geography.csv`
- `data/processed/map_features.csv`
- `data/processed/derived_line_list.csv`
- `data/processed/response_tracker.csv`
- `data/processed/epidemiological_research.csv`
- `data/processed/rd_tracker.csv`

Generated files:

- `data/processed/latest_48h_summary.csv`
- `data/processed/epidemiological_research_candidates.csv`
- `data/processed/rd_candidates.csv`

The candidate files are generated from Europe PMC searches and are **not automatically promoted** to the curated trackers. They should be reviewed before being copied into `epidemiological_research.csv` or `rd_tracker.csv`.

## Epidemiological Research screening

The epidemiological research tracker is intentionally separated from R&D. It focuses on:

- transmission dynamics
- Rt/R0 estimation
- serial interval and incubation period
- case fatality and severity
- forecasting and nowcasting
- importation risk
- contact tracing and isolation strategies
- healthcare-associated transmission
- spatial spread and mobility
- model-based evaluation of control measures

Screening scope includes epidemiological and infectious-disease journals such as *Epidemiology*, *Emerging Infectious Diseases*, *Eurosurveillance*, *The Lancet Infectious Diseases*, *PLOS Neglected Tropical Diseases*, *PLOS Pathogens*, *eLife*, *Nature Medicine*, *The Journal of Infectious Diseases*, *Clinical Infectious Diseases*, *BMC Infectious Diseases*, and *International Journal of Infectious Diseases*, plus medRxiv/bioRxiv where relevant.

## R&D tracker

The R&D tracker focuses on:

- vaccine candidates
- therapeutics and monoclonal antibodies
- antivirals
- diagnostics and assays
- animal models
- clinical trial readiness
- compassionate-use or emergency-use pathways
- manufacturing, access and procurement issues

## Map notes

`map_features.csv` drives the Leaflet map. The current polygons are schematic and the point coordinates are approximate for situational awareness. Official ECDC/national authority maps should be used for precise administrative boundaries.

## Important caveat

The downloadable line list is aggregate-derived and is not official individual-level case data. Use original national authority, WHO, ECDC, Africa CDC, CDC and other official sources for operational decision-making.


## v5 layout notes

- The epidemiological situation map is now a plain Leaflet bubble map. Bubble size is proportional to confirmed cases in `data/processed/map_features.csv`; no schematic polygons are drawn.
- The right intelligence column is split into two stacked feeds: (1) `Epidemiological Research`, limited to items directly concerning the 2026 DRC/Uganda Bundibugyo outbreak and published/posted from 2026-04-01 onward, and (2) `R&D updates` for vaccines, therapeutics and diagnostics.
- The former map-feature tracker table under the map was removed from the main page. Geographic records remain downloadable as `map_features.csv`.
- Europe PMC candidate queries in `scripts/update_data.py` now include a date filter from 2026-04-01 and current-outbreak terms. Candidate files still require human review before promotion to the curated trackers.


## v6 map update

The situation map now uses a local static SVG regional basemap with proportional case bubbles. It does not depend on external map tiles, so it renders consistently on GitHub Pages and in restricted network environments. Bubble locations and counts are driven by `docs/data/map_features.csv`.


## Automatic updating in v7

This version is designed to make the public GitHub Pages site visibly refresh every 6 hours. The workflow is `.github/workflows/update-dashboard.yml` and runs at `17 */6 * * *` plus manual `workflow_dispatch`. Each run writes a new `docs/data/manifest.json`, so the **Last build** field should change even if curated case counts do not.

The updater now does three things:

1. Copies curated epidemiology CSVs into `docs/data/`.
2. Monitors official/institutional sources listed in `scripts/update_data.py`. When page content changes, it creates an auto-generated update for review and display.
3. Searches Europe PMC for 2026-04-01 onward Bundibugyo outbreak epidemiological research and R&D candidates and displays them as `auto_candidate` records.

Important GitHub settings to check after uploading:

- **Settings → Pages**: Source should be `Deploy from a branch`, branch `main`, folder `/docs`.
- **Settings → Actions → General → Workflow permissions**: choose `Read and write permissions`.
- **Actions tab**: open `Update dashboard data` and run it once manually with **Run workflow**. After it succeeds, the public page should show a new Last build time.
- Scheduled workflows run from the latest commit on the default branch. If the workflow file is only on another branch, the schedule will not run.

Case counts remain curated because official machine-readable case-count feeds are not yet consistently available. When a stable CSV/API is identified, add its parser to `scripts/update_data.py` and update `situation_timeseries.csv` automatically.
