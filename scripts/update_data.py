"""
Update script for the Ebola Bundibugyo dashboard.

This MVP keeps curated seed CSVs as the source of truth. The script copies
processed data into docs/data, writes a build manifest, and generates a
Japanese 48-hour intelligence digest from the institutional and science/R&D
trackers. Extend the TODO sections to parse national/WHO/ECDC/Africa CDC pages
or to ingest manually reviewed CSV updates.
"""
from __future__ import annotations

import csv
import datetime as dt
from pathlib import Path
import shutil
from typing import Dict, Iterable, List

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
DOCS_DATA = ROOT / "docs" / "data"

REQUIRED_FILES = [
    "situation_timeseries.csv",
    "geography.csv",
    "map_features.csv",
    "derived_line_list.csv",
    "response_tracker.csv",
    "epidemiological_research.csv",
    "rd_tracker.csv",
    # Retained for backward compatibility with earlier dashboard versions.
    "science_tracker.csv",
]
GENERATED_FILES = [
    "latest_48h_summary.csv",
    "epidemiological_research_candidates.csv",
    "rd_candidates.csv",
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


def read_rows(name: str) -> List[Dict[str, str]]:
    path = PROCESSED / name
    validate_csv(path)
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def copy_for_pages() -> None:
    DOCS_DATA.mkdir(parents=True, exist_ok=True)
    for name in REQUIRED_FILES:
        src = PROCESSED / name
        validate_csv(src)
        shutil.copy2(src, DOCS_DATA / name)


def parse_date(value: str) -> dt.date | None:
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value[:10])
    except ValueError:
        return None


def jp_summary_for_response(row: Dict[str, str]) -> str:
    org = row.get("organization", "関係機関")
    title = row.get("title", "")
    details = row.get("details") or row.get("summary") or ""
    text = f"{title} {details}".lower()

    if "cepi" in org.lower() or "vaccine" in text:
        return (
            "Bundibugyo ebolavirusを標的とするワクチン開発・資金支援に関する更新。"
            "候補ワクチンのプラットフォーム、動物試験データ、臨床試験準備、製造・供給計画を継続確認する必要がある。"
        )
    if "cdc" in org.lower():
        return (
            "CDCはDRC・ウガンダのアウトブレイクに関する状況評価と旅行者・医療従事者向け情報を更新。"
            "米国内での確認例や輸入リスク評価、臨床・検疫上の備えを確認する情報源として重要。"
        )
    if "who" in org.lower() and "r&d" in text:
        return (
            "WHOは治療薬・ワクチン候補の優先順位付けや研究開発上の論点を整理。"
            "今回の流行では承認済み特異的ワクチン・治療薬が限られるため、R&D面の中心的情報源となる。"
        )
    if "who" in org.lower():
        return (
            "WHOおよび各国当局による公式の流行状況・対応方針に関する更新。"
            "症例数、地域的広がり、公衆衛生対応、国際連携の基準情報として優先的に確認する。"
        )
    if "ecdc" in org.lower():
        return (
            "ECDCは欧州からみたリスク評価、輸入例への備え、DRC・ウガンダの最新状況を更新。"
            "国際的なリスク評価や渡航・医療機関対応の整理に有用。"
        )
    if "africa" in org.lower():
        return (
            "Africa CDCは地域連携、国境を越えた監視、検査・対応能力強化に関する情報を更新。"
            "アフリカ地域内の協調対応を把握するうえで重要。"
        )
    if "msf" in org.lower():
        return (
            "MSFは現地での患者管理、感染予防・管理、地域対応、人道支援上の課題に関する情報を更新。"
            "現場対応とオペレーション上の制約を把握するために有用。"
        )
    return (
        f"{org}による最新更新。公衆衛生対応、疫学情報、研究・R&Dへの含意を確認する必要がある。"
    )


def jp_summary_for_science(row: Dict[str, str]) -> str:
    title = row.get("title", "")
    topic = row.get("topic", "")
    evidence = row.get("evidence_type", "")
    text = f"{title} {topic} {row.get('details','')} {row.get('key_message','')}".lower()

    if "vaccine" in text or "ワクチン" in text:
        return (
            "ワクチンR&Dに関する更新。候補ワクチンのプラットフォーム、免疫原性・防御効果データ、"
            "臨床試験開始可能性、製造・アクセス計画を追跡する価値が高い。"
        )
    if "therapeutic" in text or "treatment" in text or "治療" in text:
        return (
            "治療薬・臨床管理に関する知見。既存抗体医薬や候補治療薬がBundibugyo virus diseaseにどの程度適用可能か、"
            "臨床試験・同情的使用の枠組みを確認する必要がある。"
        )
    if "model" in text or "importation" in text or "risk" in text:
        return (
            "疫学モデル・リスク評価に関する知見。国際的拡散、輸入リスク、接触追跡・隔離戦略の評価に利用可能。"
        )
    if "clinical" in text or "case fatality" in text or "severity" in text:
        return (
            "臨床疫学に関する知見。潜伏期間、重症度、致命率、医療従事者感染、院内感染リスクの整理に有用。"
        )
    if "diagnostic" in text or "genomic" in text or "sequence" in text:
        return (
            "診断・ゲノム監視に関する知見。検査系、系統解析、ウイルス同定、感染連鎖の把握に関連する。"
        )
    return (
        f"{topic or evidence}に関する科学的情報。今回の流行の疫学研究、臨床研究、R&D判断への関連性を確認する。"
    )


def generate_latest_digest() -> None:
    """Generate a Japanese digest of items dated within the last 48 hours.

    Source CSVs currently contain dates without times. For operational display,
    this script treats calendar dates within the previous two UTC days as a
    48-hour watch window. If you later add ISO datetimes, this can be tightened
    to true hour-level filtering.
    """
    now_utc = dt.datetime.now(dt.timezone.utc)
    cutoff_date = (now_utc - dt.timedelta(hours=48)).date()
    rows: List[Dict[str, str]] = []

    for row in read_rows("response_tracker.csv"):
        d = parse_date(row.get("date", ""))
        if d and d >= cutoff_date:
            rows.append({
                "date": row.get("date", ""),
                "category": "関係機関・公衆衛生対応",
                "source": row.get("organization", ""),
                "title": row.get("title", ""),
                "summary_ja": jp_summary_for_response(row),
                "url": row.get("source_url", ""),
            })

    for fname, category in [
        ("epidemiological_research.csv", "疫学研究"),
        ("rd_tracker.csv", "治療薬・ワクチン・診断R&D"),
    ]:
        for row in read_rows(fname):
            d = parse_date(row.get("date", ""))
            if d and d >= cutoff_date:
                rows.append({
                    "date": row.get("date", ""),
                    "category": category,
                    "source": row.get("source", ""),
                    "title": row.get("title", ""),
                    "summary_ja": jp_summary_for_science(row),
                    "url": row.get("url", ""),
                })

    rows.sort(key=lambda r: (r["date"], r["category"], r["source"]), reverse=True)
    out = PROCESSED / "latest_48h_summary.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["date", "category", "source", "title", "summary_ja", "url"],
        )
        writer.writeheader()
        writer.writerows(rows)
    shutil.copy2(out, DOCS_DATA / out.name)



def fetch_europe_pmc_candidates(query: str, out_name: str, category: str, page_size: int = 25) -> None:
    """Fetch literature candidates from Europe PMC and save them for manual review.

    These candidate files are intentionally separate from the curated trackers.
    GitHub Actions can refresh them every 6 hours, but promotion into
    epidemiological_research.csv or rd_tracker.csv should be human-reviewed.
    """
    import urllib.parse
    import urllib.request
    import json

    url = (
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search?"
        + urllib.parse.urlencode({
            "query": query,
            "format": "json",
            "pageSize": str(page_size),
            "sort": "P_PDATE_D",
        })
    )
    out = PROCESSED / out_name
    fieldnames = ["date", "category", "title", "source", "journal", "authors", "url", "abstract_snippet", "screening_query", "review_status"]
    try:
        with urllib.request.urlopen(url, timeout=25) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        results = payload.get("resultList", {}).get("result", [])
        rows = []
        for item in results:
            pmid = item.get("pmid")
            doi = item.get("doi")
            link = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/" if pmid else (f"https://doi.org/{doi}" if doi else item.get("fullTextUrlList", {}).get("fullTextUrl", [{}])[0].get("url", ""))
            rows.append({
                "date": item.get("firstPublicationDate") or item.get("journalInfo", {}).get("printPublicationDate") or item.get("pubYear", ""),
                "category": category,
                "title": item.get("title", ""),
                "source": "Europe PMC",
                "journal": item.get("journalTitle", ""),
                "authors": item.get("authorString", ""),
                "url": link,
                "abstract_snippet": (item.get("abstractText", "") or "")[:500],
                "screening_query": query,
                "review_status": "candidate_for_manual_review",
            })
    except Exception as e:
        rows = [{
            "date": dt.datetime.now(dt.timezone.utc).date().isoformat(),
            "category": category,
            "title": "Europe PMC candidate fetch failed",
            "source": "Europe PMC",
            "journal": "",
            "authors": "",
            "url": "",
            "abstract_snippet": str(e),
            "screening_query": query,
            "review_status": "fetch_error",
        }]
    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    shutil.copy2(out, DOCS_DATA / out.name)


def generate_candidate_literature_files() -> None:
    epi_query = '((Bundibugyo OR "Bundibugyo virus" OR "Bundibugyo ebolavirus" OR Ebola OR ebolavirus) AND ("transmission dynamics" OR model* OR forecast* OR importation OR "reproduction number" OR "serial interval" OR "case fatality" OR severity OR "contact tracing" OR epidemiology))'
    rd_query = '((Bundibugyo OR "Bundibugyo virus" OR "Bundibugyo ebolavirus" OR ebolavirus) AND (vaccine OR therapeutic* OR "monoclonal antibody" OR antiviral OR diagnostic OR assay OR "animal model" OR trial))'
    fetch_europe_pmc_candidates(epi_query, "epidemiological_research_candidates.csv", "epidemiological_research_screening")
    fetch_europe_pmc_candidates(rd_query, "rd_candidates.csv", "rd_screening")


def write_manifest() -> None:
    manifest = DOCS_DATA / "manifest.json"
    updated = dt.datetime.now(dt.timezone.utc).isoformat()
    files = REQUIRED_FILES + GENERATED_FILES
    manifest.write_text(
        '{\n'
        f'  "generated_at_utc": "{updated}",\n'
        '  "update_frequency": "Every 6 hours via GitHub Actions cron: 0 */6 * * *",\n'
        '  "latest_digest_window": "Items dated within the previous 48 hours; date-only source rows are evaluated by calendar date",\n'
        '  "data_status": "curated seed data; human review recommended before operational use",\n'
        '  "files": ["' + '", "'.join(files) + '"]\n'
        '}\n',
        encoding="utf-8",
    )


def main() -> None:
    copy_for_pages()
    generate_candidate_literature_files()
    generate_latest_digest()
    write_manifest()
    print("Dashboard data copied to docs/data, candidate literature files refreshed, latest digest generated, and manifest written.")


if __name__ == "__main__":
    main()
