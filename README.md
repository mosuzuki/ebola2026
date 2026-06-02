# DRC + Uganda Ebola Bundibugyo Research & R&D Intelligence Dashboard

A GitHub Pages-ready dashboard for the 2026 Ebola disease outbreak caused by **Bundibugyo virus** in the Democratic Republic of the Congo and Uganda.

This version is biased toward **epidemiological research, therapeutics, diagnostics, and vaccine R&D**, while retaining core public-health situational awareness.

## Main screen layout

1. **Compact current situation header**
   - Latest DRC and Uganda confirmed cases/deaths from curated seed data
   - Download buttons for situation, institutional updates, and science/R&D CSVs

2. **Japanese 48-hour digest**
   - Automatically generated at each GitHub Actions run from institutional and science/R&D trackers
   - Displays Japanese summaries for items dated within the previous 48 hours
   - Output file: `latest_48h_summary.csv`

3. **Two-column intelligence board**
   - Left: WHO, CDC, ECDC, Africa CDC, INRB/national authority-related, MSF, Gavi, CEPI and other institutional updates
   - Right: epidemiology, modelling, clinical evidence, therapeutics, diagnostics, vaccine R&D and cross-protection evidence
   - Both lists are sorted newest first
   - Only the latest 10 items are shown initially; older items are revealed with a button

4. **Epidemiology section**
   - Cumulative confirmed-case curve
   - Geographic distribution
   - Latest situation records

5. **R&D matrix**
   - Detailed table of science/R&D items including evidence type, topic, review status and R&D relevance

## How to publish on GitHub Pages

1. Create a GitHub repository.
2. Upload all files in this folder.
3. Go to **Settings → Pages**.
4. Set **Source** to `Deploy from a branch`.
5. Select branch `main` and folder `/docs`.
6. Save.

## Updating data

Curated data live in:

- `data/processed/situation_timeseries.csv`
- `data/processed/geography.csv`
- `data/processed/derived_line_list.csv`
- `data/processed/response_tracker.csv`
- `data/processed/science_tracker.csv`

Run:

```bash
python scripts/update_data.py
```

This validates processed CSVs, generates `data/processed/latest_48h_summary.csv`, copies all public CSVs into `docs/data/`, and writes `docs/data/manifest.json`.

GitHub Actions is configured to run every 6 hours:

```yaml
schedule:
  - cron: "0 */6 * * *"
```

You can also run it manually from the GitHub Actions tab using `workflow_dispatch`.

## Important caveat

`derived_line_list.csv` is **not an official individual case line list**. It is an aggregate-derived placeholder that preserves the intended schema and download function until official line-level data become available.

## Recommended next extensions

- Add a source registry for WHO, CDC, ECDC, Africa CDC, MSF, Gavi, CEPI, PubMed, Europe PMC, medRxiv and clinicaltrials.gov.
- Add automated but review-gated PubMed/Europe PMC/medRxiv ingestion.
- Add product-level candidate matrix for vaccines, therapeutics and diagnostics.
- Add data/raw snapshots of source pages/PDFs for auditability.
- Add issue templates for external corrections and source suggestions.
