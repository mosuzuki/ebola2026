# DRC + Uganda Ebola Bundibugyo Outbreak Intelligence Dashboard

A GitHub Pages-ready MVP dashboard for the 2026 Ebola disease outbreak caused by **Bundibugyo virus** in the Democratic Republic of the Congo and Uganda.

## What it includes

1. **Epidemiological situation**
   - cumulative confirmed cases and deaths
   - suspected case data when available
   - geographic distribution
   - downloadable CSVs, including a clearly labelled aggregate-derived line-list placeholder

2. **Response tracker**
   - WHO, Africa CDC, ECDC, MSF, Gavi, CEPI and related operational/R&D updates
   - activity categories and source links

3. **Science tracker**
   - WHO technical updates, institutional R&D updates, and science/media summaries
   - topics including vaccines, therapeutics, diagnostics and response challenges

## How to publish on GitHub Pages

1. Create a new GitHub repository.
2. Upload all files in this folder.
3. Go to **Settings → Pages**.
4. Set **Source** to `Deploy from a branch`.
5. Select branch `main` and folder `/docs`.
6. Save. The dashboard will be served from GitHub Pages.

## Updating data

The seed data live in:

- `data/processed/situation_timeseries.csv`
- `data/processed/geography.csv`
- `data/processed/derived_line_list.csv`
- `data/processed/response_tracker.csv`
- `data/processed/science_tracker.csv`

Run:

```bash
python scripts/update_data.py
```

This validates the processed CSVs and copies them into `docs/data/`, where GitHub Pages can serve them.

A GitHub Actions workflow is included at `.github/workflows/update-dashboard.yml`. It runs daily and can also be triggered manually.

## Important data caveat

The current `derived_line_list.csv` is **not an official individual case line list**. It is an aggregate-derived placeholder that preserves the intended schema and download function until official line-level data become available. Do not use it as individual-level epidemiological data.

## Recommended next extensions

- Add parser functions for WHO DON, ECDC outbreak page, Africa CDC press releases, and national dashboards.
- Add an RSS or URL registry for response and science pages.
- Add a human-review step before new case counts are committed.
- Add `data/raw/` snapshots of source pages or PDFs for auditability.
- Add GitHub Issues templates for data correction requests.
