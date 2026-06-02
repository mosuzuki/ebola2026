"""
Update script for the Ebola Bundibugyo dashboard.

This MVP keeps curated seed CSVs as the source of truth. Extend the TODO
sections to parse national/WHO/ECDC/Africa CDC pages or to ingest manually
reviewed CSV updates. The script copies processed data into docs/data so the
files are downloadable from GitHub Pages.
"""
from __future__ import annotations

import csv
import datetime as dt
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
DOCS_DATA = ROOT / "docs" / "data"

REQUIRED_FILES = [
    "situation_timeseries.csv",
    "geography.csv",
    "derived_line_list.csv",
    "response_tracker.csv",
    "science_tracker.csv",
]


def validate_csv(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(path)
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        if not reader.fieldnames:
            raise ValueError(f"No header found in {path}")
        if not rows:
            raise ValueError(f"No rows found in {path}")


def copy_for_pages() -> None:
    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    for name in REQUIRED_FILES:
        src = PROCESSED / name
        validate_csv(src)
        shutil.copy2(src, DOCS_DATA / name)


def write_manifest() -> None:
    manifest = DOCS_DATA / "manifest.json"
    updated = dt.datetime.now(dt.timezone.utc).isoformat()
    manifest.write_text(
        '{\n'
        f'  "generated_at_utc": "{updated}",\n'
        '  "data_status": "curated seed data; human review recommended before operational use",\n'
        '  "files": ["' + '", "'.join(REQUIRED_FILES) + '"]\n'
        '}\n',
        encoding="utf-8",
    )


def main() -> None:
    copy_for_pages()
    write_manifest()
    print("Dashboard data copied to docs/data and manifest written.")


if __name__ == "__main__":
    main()
