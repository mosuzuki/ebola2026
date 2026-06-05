"""
6-hourly updater for the Ebola Bundibugyo GitHub Pages dashboard.

What this script now does:
1. Copies curated seed CSVs into docs/data for GitHub Pages.
2. Writes a manifest on every run, so the public page visibly refreshes even
   when no epidemiological count has changed.
3. Fetches selected official / institutional pages and records source status.
   If a monitored page's content changes, a concise auto-generated update is
   added to docs/data/response_tracker.csv or docs/data/rd_tracker.csv.
4. Searches Europe PMC for current-outbreak epidemiological research and R&D
   items published from 2026-04-01 onward. Candidate records are displayed with
   review_status="auto_candidate" and also saved as candidate CSVs.
5. Generates a Japanese digest of items dated within the previous 48 hours.

The script is intentionally conservative for case counts. It does not scrape
case counts into the official situation time series unless a source provides a
stable machine-readable table. Counts remain curated in situation_timeseries.csv.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import html
import json
import re
import shutil
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover
    BeautifulSoup = None

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "data" / "processed"
DOCS_DATA = ROOT / "docs" / "data"
CACHE = ROOT / "data" / "cache"
CACHE.mkdir(parents=True, exist_ok=True)
DOCS_DATA.mkdir(parents=True, exist_ok=True)

CURATED_FILES = [
    "situation_timeseries.csv",
    "geography.csv",
    "map_features.csv",
    "derived_line_list.csv",
    "response_tracker.csv",
    "epidemiological_research.csv",
    "rd_tracker.csv",
    "science_tracker.csv",  # backward compatibility
]
GENERATED_FILES = [
    "latest_48h_summary.csv",
    "epidemiological_research_candidates.csv",
    "rd_candidates.csv",
    "source_monitor.csv",
    "auto_response_updates.csv",
    "auto_rd_updates.csv",
    "auto_epidemiological_research.csv",
    "manifest.json",
]

RESPONSE_FIELDS = [
    "date","organization","country","activity_type","title","summary","details",
    "source_name","source_url","confidence_level","priority_area"
]
EPI_FIELDS = [
    "date","title","source","evidence_type","topic","key_message","details","url",
    "peer_review_status","relevance","screening_query","journal_scope","outbreak_scope","current_outbreak_only"
]
RD_FIELDS = [
    "date","title","source","evidence_type","topic","key_message","details","url",
    "peer_review_status","relevance","screening_query","journal_scope","r_and_d_stage",
    "candidate_or_product","platform_or_modality","developer_or_sponsor"
]

MONITORED_SOURCES = [
    {
        "organization": "WHO",
        "country": "DRC/Uganda",
        "activity_type": "official situation update",
        "priority_area": "public health / epidemiology",
        "source_name": "WHO Ebola outbreak DRC 2026 situation page",
        "source_url": "https://www.who.int/emergencies/situations/ebola-outbreak---drc-2026",
        "kind": "response",
    },
    {
        "organization": "WHO",
        "country": "DRC/Uganda",
        "activity_type": "Disease Outbreak News",
        "priority_area": "public health / epidemiology",
        "source_name": "WHO Disease Outbreak News",
        "source_url": "https://www.who.int/emergencies/disease-outbreak-news",
        "kind": "response",
    },
    {
        "organization": "ECDC",
        "country": "DRC/Uganda",
        "activity_type": "risk assessment / situation update",
        "priority_area": "international risk assessment",
        "source_name": "ECDC Ebola outbreak DRC and Uganda",
        "source_url": "https://www.ecdc.europa.eu/en/ebola-outbreak-democratic-republic-congo-and-uganda",
        "kind": "response",
    },
    {
        "organization": "CDC",
        "country": "United States / global",
        "activity_type": "situation summary / preparedness",
        "priority_area": "clinical and travel preparedness",
        "source_name": "CDC Ebola current situation",
        "source_url": "https://www.cdc.gov/ebola/situation-summary/index.html",
        "kind": "response",
    },
    {
        "organization": "Africa CDC",
        "country": "Africa region",
        "activity_type": "regional coordination",
        "priority_area": "cross-border response",
        "source_name": "Africa CDC news",
        "source_url": "https://africacdc.org/news/",
        "kind": "response",
    },
    {
        "organization": "MSF",
        "country": "DRC/Uganda",
        "activity_type": "field operations",
        "priority_area": "case management / IPC / humanitarian operations",
        "source_name": "MSF latest news",
        "source_url": "https://www.msf.org/latest",
        "kind": "response",
    },
    {
        "organization": "CEPI",
        "country": "global R&D",
        "activity_type": "vaccine R&D",
        "priority_area": "vaccine development",
        "source_name": "CEPI news",
        "source_url": "https://cepi.net/news",
        "kind": "rd",
    },
    {
        "organization": "Gavi",
        "country": "global R&D / access",
        "activity_type": "vaccine access / outbreak response",
        "priority_area": "vaccines and access",
        "source_name": "Gavi news",
        "source_url": "https://www.gavi.org/news/media-room",
        "kind": "rd",
    },
]

USER_AGENT = "Mozilla/5.0 (compatible; ebola2026-dashboard/1.0; +https://mosuzuki.github.io/ebola2026/)"


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def today() -> str:
    return now_utc().date().isoformat()


def validate_csv(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(path)
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError(f"No header found in {path}")


def read_csv(path: Path) -> List[Dict[str, str]]:
    validate_csv(path)
    with path.open(newline="", encoding="utf-8") as f:
        return [{k: (v or "") for k, v in row.items()} for row in csv.DictReader(f)]


def write_csv(path: Path, rows: Iterable[Dict[str, str]], fieldnames: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fieldnames})


def copy_curated_for_pages() -> None:
    for name in CURATED_FILES:
        src = PROCESSED / name
        if src.exists():
            validate_csv(src)
            shutil.copy2(src, DOCS_DATA / name)


def load_state() -> Dict[str, Dict[str, str]]:
    path = CACHE / "source_state.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_state(state: Dict[str, Dict[str, str]]) -> None:
    (CACHE / "source_state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def fetch_text(url: str, timeout: int = 25) -> Tuple[int, str, str]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        raw = resp.read()
        try:
            text = raw.decode(charset, errors="replace")
        except LookupError:
            text = raw.decode("utf-8", errors="replace")
        return int(resp.status), resp.headers.get("content-type", ""), text


def normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def page_metadata(url: str) -> Dict[str, str]:
    status, content_type, text = fetch_text(url)
    if BeautifulSoup and "html" in content_type.lower():
        soup = BeautifulSoup(text, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        title = normalize_ws(soup.title.get_text(" ") if soup.title else "")
        desc = ""
        meta = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
        if meta and meta.get("content"):
            desc = normalize_ws(meta.get("content", ""))
        body_text = normalize_ws(soup.get_text(" "))[:5000]
    else:
        title = url.rsplit("/", 1)[-1] or url
        desc = ""
        body_text = normalize_ws(text)[:5000]
    digest_source = f"{title}\n{desc}\n{body_text}"
    return {
        "url": url,
        "status": str(status),
        "content_type": content_type,
        "title": title or url,
        "description": desc,
        "snippet": body_text[:700],
        "sha256": hashlib.sha256(digest_source.encode("utf-8", errors="ignore")).hexdigest(),
        "checked_at_utc": now_utc().isoformat(),
    }


def update_source_monitor() -> Tuple[List[Dict[str, str]], List[Dict[str, str]], List[Dict[str, str]]]:
    state = load_state()
    monitor_rows: List[Dict[str, str]] = []
    auto_response: List[Dict[str, str]] = []
    auto_rd: List[Dict[str, str]] = []
    current_state: Dict[str, Dict[str, str]] = {}

    for src in MONITORED_SOURCES:
        url = src["source_url"]
        try:
            meta = page_metadata(url)
            previous = state.get(url, {})
            changed = previous.get("sha256") != meta["sha256"]
            first_seen = not bool(previous)
            status_note = "changed" if changed and not first_seen else ("first_seen" if first_seen else "unchanged")
            current_state[url] = meta
            monitor_rows.append({
                "checked_at_utc": meta["checked_at_utc"],
                "organization": src["organization"],
                "kind": src["kind"],
                "status": meta["status"],
                "change_status": status_note,
                "title": meta["title"],
                "source_url": url,
                "content_hash": meta["sha256"],
                "error": "",
            })
            if changed:
                if src["kind"] == "rd":
                    auto_rd.append({
                        "date": today(),
                        "title": f"{src['organization']} source updated: {meta['title'][:180]}",
                        "source": src["organization"],
                        "evidence_type": "institutional R&D update",
                        "topic": src["priority_area"],
                        "key_message": f"Monitored R&D/access source changed during the 6-hourly dashboard update.",
                        "details": meta["description"] or meta["snippet"][:500],
                        "url": url,
                        "peer_review_status": "not peer-reviewed; source-monitor generated",
                        "relevance": "Review the source page for changes relevant to Bundibugyo therapeutics, vaccines, diagnostics, manufacturing, access, or clinical trial readiness.",
                        "screening_query": "source monitor",
                        "journal_scope": "institutional source",
                        "r_and_d_stage": src["activity_type"],
                        "candidate_or_product": "",
                        "platform_or_modality": "",
                        "developer_or_sponsor": src["organization"],
                    })
                else:
                    auto_response.append({
                        "date": today(),
                        "organization": src["organization"],
                        "country": src["country"],
                        "activity_type": src["activity_type"],
                        "title": f"Source updated: {meta['title'][:180]}",
                        "summary": "Automatically detected change in a monitored official/institutional source.",
                        "details": meta["description"] or meta["snippet"][:500],
                        "source_name": src["source_name"],
                        "source_url": url,
                        "confidence_level": "auto-detected page change; human review required",
                        "priority_area": src["priority_area"],
                    })
        except Exception as e:
            monitor_rows.append({
                "checked_at_utc": now_utc().isoformat(),
                "organization": src["organization"],
                "kind": src["kind"],
                "status": "fetch_error",
                "change_status": "error",
                "title": "",
                "source_url": url,
                "content_hash": "",
                "error": repr(e),
            })
            current_state[url] = state.get(url, {})

    if current_state:
        merged = {**state, **current_state}
        save_state(merged)

    write_csv(PROCESSED / "source_monitor.csv", monitor_rows, ["checked_at_utc","organization","kind","status","change_status","title","source_url","content_hash","error"])
    write_csv(PROCESSED / "auto_response_updates.csv", auto_response, RESPONSE_FIELDS)
    write_csv(PROCESSED / "auto_rd_updates.csv", auto_rd, RD_FIELDS)
    shutil.copy2(PROCESSED / "source_monitor.csv", DOCS_DATA / "source_monitor.csv")
    shutil.copy2(PROCESSED / "auto_response_updates.csv", DOCS_DATA / "auto_response_updates.csv")
    shutil.copy2(PROCESSED / "auto_rd_updates.csv", DOCS_DATA / "auto_rd_updates.csv")
    return monitor_rows, auto_response, auto_rd


def europe_pmc_search(query: str, page_size: int = 50) -> List[Dict[str, str]]:
    url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + urllib.parse.urlencode({
        "query": query,
        "format": "json",
        "pageSize": str(page_size),
        "sort": "P_PDATE_D",
    })
    status, content_type, text = fetch_text(url)
    payload = json.loads(text)
    return payload.get("resultList", {}).get("result", [])


def item_url(item: Dict[str, str]) -> str:
    pmid = item.get("pmid")
    doi = item.get("doi")
    if pmid:
        return f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/"
    if doi:
        return f"https://doi.org/{doi}"
    urls = item.get("fullTextUrlList", {}).get("fullTextUrl", []) if isinstance(item.get("fullTextUrlList"), dict) else []
    return urls[0].get("url", "") if urls else ""


def europe_pmc_candidates(query: str, category: str) -> List[Dict[str, str]]:
    try:
        results = europe_pmc_search(query)
    except Exception as e:
        return [{
            "date": today(), "category": category, "title": "Europe PMC candidate fetch failed",
            "source": "Europe PMC", "journal": "", "authors": "", "url": "",
            "abstract_snippet": repr(e), "screening_query": query, "review_status": "fetch_error"
        }]
    rows = []
    for item in results:
        date = item.get("firstPublicationDate") or item.get("journalInfo", {}).get("printPublicationDate") or item.get("pubYear", "")
        rows.append({
            "date": date[:10],
            "category": category,
            "title": item.get("title", ""),
            "source": "Europe PMC",
            "journal": item.get("journalTitle", ""),
            "authors": item.get("authorString", ""),
            "url": item_url(item),
            "abstract_snippet": normalize_ws(item.get("abstractText", ""))[:700],
            "screening_query": query,
            "review_status": "auto_candidate",
        })
    return rows


def generate_candidate_literature_files() -> Tuple[List[Dict[str, str]], List[Dict[str, str]]]:
    epi_query = '((Bundibugyo OR "Bundibugyo virus" OR "Bundibugyo ebolavirus") AND (2026 OR DRC OR Uganda OR Congo OR "Democratic Republic of the Congo") AND ("transmission dynamics" OR model* OR forecast* OR nowcast* OR importation OR "cross-border" OR "reproduction number" OR Rt OR R0 OR "serial interval" OR "incubation period" OR "case fatality" OR severity OR "contact tracing" OR epidemiology OR "spatial spread") AND FIRST_PDATE:[2026-04-01 TO 3000-12-31])'
    rd_query = '((Bundibugyo OR "Bundibugyo virus" OR "Bundibugyo ebolavirus") AND (vaccine OR therapeutic* OR treatment OR "monoclonal antibody" OR antiviral OR diagnostic OR assay OR "animal model" OR trial OR CEPI OR Gavi OR Moderna OR IAVI OR Oxford) AND FIRST_PDATE:[2026-04-01 TO 3000-12-31])'
    epi_rows = europe_pmc_candidates(epi_query, "epidemiological_research_screening")
    rd_rows = europe_pmc_candidates(rd_query, "rd_screening")
    cand_fields = ["date","category","title","source","journal","authors","url","abstract_snippet","screening_query","review_status"]
    write_csv(PROCESSED / "epidemiological_research_candidates.csv", epi_rows, cand_fields)
    write_csv(PROCESSED / "rd_candidates.csv", rd_rows, cand_fields)
    shutil.copy2(PROCESSED / "epidemiological_research_candidates.csv", DOCS_DATA / "epidemiological_research_candidates.csv")
    shutil.copy2(PROCESSED / "rd_candidates.csv", DOCS_DATA / "rd_candidates.csv")
    return epi_rows, rd_rows


def auto_epi_rows(candidates: List[Dict[str, str]]) -> List[Dict[str, str]]:
    rows = []
    for r in candidates:
        if r.get("review_status") == "fetch_error":
            continue
        title_abs = f"{r.get('title','')} {r.get('abstract_snippet','')}".lower()
        if not any(k in title_abs for k in ["bundibugyo", "ebola"]):
            continue
        if r.get("date", "") < "2026-04-01":
            continue
        rows.append({
            "date": r.get("date", ""),
            "title": r.get("title", ""),
            "source": r.get("source", "Europe PMC"),
            "evidence_type": "literature / preprint candidate",
            "topic": infer_epi_topic(title_abs),
            "key_message": "Automatically identified candidate for current-outbreak epidemiological research screening.",
            "details": r.get("abstract_snippet", ""),
            "url": r.get("url", ""),
            "peer_review_status": "auto_candidate; verify before citation",
            "relevance": "Screen for direct relevance to the 2026 DRC/Uganda Bundibugyo outbreak, including transmission dynamics, forecasting, importation risk, severity, or contact tracing.",
            "screening_query": r.get("screening_query", ""),
            "journal_scope": r.get("journal", ""),
            "outbreak_scope": "current outbreak candidate",
            "current_outbreak_only": "true",
        })
    return rows


def infer_epi_topic(text: str) -> str:
    if any(k in text for k in ["forecast", "nowcast", "projection", "model"]): return "forecasting / transmission modelling"
    if any(k in text for k in ["importation", "air travel", "cross-border", "spatial"]): return "importation risk / spatial spread"
    if any(k in text for k in ["serial interval", "incubation", "reproduction", " rt ", "r0"]): return "transmission parameters"
    if any(k in text for k in ["severity", "fatality", "clinical", "mortality"]): return "clinical epidemiology / severity"
    if any(k in text for k in ["contact tracing", "healthcare", "nosocomial"]): return "contact tracing / healthcare-associated transmission"
    return "current-outbreak epidemiology"


def auto_rd_rows(candidates: List[Dict[str, str]], monitored_rd: List[Dict[str, str]]) -> List[Dict[str, str]]:
    rows = list(monitored_rd)
    for r in candidates:
        if r.get("review_status") == "fetch_error":
            continue
        if r.get("date", "") < "2026-04-01":
            continue
        text = f"{r.get('title','')} {r.get('abstract_snippet','')}".lower()
        if not any(k in text for k in ["bundibugyo", "ebola", "ebolavirus"]):
            continue
        rows.append({
            "date": r.get("date", ""),
            "title": r.get("title", ""),
            "source": r.get("source", "Europe PMC"),
            "evidence_type": "literature / preprint candidate",
            "topic": infer_rd_topic(text),
            "key_message": "Automatically identified candidate R&D item for review.",
            "details": r.get("abstract_snippet", ""),
            "url": r.get("url", ""),
            "peer_review_status": "auto_candidate; verify before citation",
            "relevance": "Screen for relevance to Bundibugyo therapeutics, vaccine candidates, diagnostics, assays, animal models, or trial readiness.",
            "screening_query": r.get("screening_query", ""),
            "journal_scope": r.get("journal", ""),
            "r_and_d_stage": "candidate screening",
            "candidate_or_product": "",
            "platform_or_modality": "",
            "developer_or_sponsor": "",
        })
    return rows


def infer_rd_topic(text: str) -> str:
    if "vaccine" in text: return "vaccine R&D"
    if any(k in text for k in ["therapeutic", "treatment", "antibody", "antiviral"]): return "therapeutics R&D"
    if any(k in text for k in ["diagnostic", "assay", "pcr", "sequencing"]): return "diagnostics / assays"
    if any(k in text for k in ["animal model", "macaque", "mouse", "guinea"]): return "animal models"
    if "trial" in text: return "clinical trial readiness"
    return "R&D"


def dedupe_rows(rows: List[Dict[str, str]], key_fields: List[str]) -> List[Dict[str, str]]:
    seen = set()
    out = []
    for r in rows:
        key = tuple((r.get(k, "") or "").strip().lower() for k in key_fields)
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def build_docs_trackers(auto_response: List[Dict[str, str]], auto_epi: List[Dict[str, str]], auto_rd: List[Dict[str, str]]) -> None:
    curated_resp = read_csv(PROCESSED / "response_tracker.csv")
    curated_epi = read_csv(PROCESSED / "epidemiological_research.csv")
    curated_rd = read_csv(PROCESSED / "rd_tracker.csv")
    resp = dedupe_rows(auto_response + curated_resp, ["date", "organization", "title", "source_url"])
    epi = dedupe_rows(auto_epi + curated_epi, ["title", "url"])
    rd = dedupe_rows(auto_rd + curated_rd, ["title", "url"])
    resp.sort(key=lambda r: (r.get("date", ""), r.get("organization", ""), r.get("title", "")), reverse=True)
    epi.sort(key=lambda r: (r.get("date", ""), r.get("title", "")), reverse=True)
    rd.sort(key=lambda r: (r.get("date", ""), r.get("title", "")), reverse=True)
    write_csv(DOCS_DATA / "response_tracker.csv", resp, RESPONSE_FIELDS)
    write_csv(DOCS_DATA / "epidemiological_research.csv", epi, EPI_FIELDS)
    write_csv(DOCS_DATA / "rd_tracker.csv", rd, RD_FIELDS)
    write_csv(PROCESSED / "auto_epidemiological_research.csv", auto_epi, EPI_FIELDS)
    shutil.copy2(PROCESSED / "auto_epidemiological_research.csv", DOCS_DATA / "auto_epidemiological_research.csv")


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
    if "source updated" in title.lower():
        return f"{org}の監視対象ページに変更を検出した。症例数、リスク評価、現地対応、研究開発に関する更新の有無を原典で確認する必要がある。"
    if "cdc" in org.lower():
        return "CDCの状況評価・旅行者/医療従事者向け情報の更新。輸入リスク、臨床対応、検疫上の備えを確認する情報源として重要。"
    if "who" in org.lower() and "r&d" in text:
        return "WHOによる治療薬・ワクチン候補、研究開発上の論点に関する更新。今回の流行ではR&D面の中心的情報源となる。"
    if "who" in org.lower():
        return "WHOおよび各国当局による公式の流行状況・対応方針に関する更新。症例数、地域的広がり、公衆衛生対応を優先的に確認する。"
    if "ecdc" in org.lower():
        return "ECDCによる欧州からみたリスク評価、輸入例への備え、DRC・ウガンダの最新状況の更新。国際的なリスク評価に有用。"
    if "africa" in org.lower():
        return "Africa CDCによる地域連携、国境を越えた監視、検査・対応能力強化に関する更新。アフリカ地域内の協調対応把握に重要。"
    if "msf" in org.lower():
        return "MSFによる現地患者管理、IPC、地域対応、人道支援上の課題に関する更新。現場対応と制約把握に有用。"
    return f"{org}による最新更新。公衆衛生対応、疫学情報、研究・R&Dへの含意を確認する必要がある。"


def jp_summary_for_science(row: Dict[str, str]) -> str:
    text = f"{row.get('title','')} {row.get('topic','')} {row.get('details','')} {row.get('key_message','')}".lower()
    if "auto_candidate" in row.get("peer_review_status", ""):
        return "自動スクリーニングで検出された候補情報。今回アウトブレイクとの直接関連性、査読状況、データ品質を確認してから利用する。"
    if "vaccine" in text:
        return "ワクチンR&Dに関する更新。候補ワクチンのプラットフォーム、免疫原性・防御効果、臨床試験準備、製造・アクセス計画を追跡する。"
    if any(k in text for k in ["therapeutic", "treatment", "antibody", "antiviral"]):
        return "治療薬・臨床管理に関する知見。Bundibugyo virus diseaseへの適用可能性、臨床試験・同情的使用の枠組みを確認する。"
    if any(k in text for k in ["model", "forecast", "importation", "risk"]):
        return "疫学モデル・リスク評価に関する知見。国際的拡散、輸入リスク、接触追跡・隔離戦略の評価に利用可能。"
    if any(k in text for k in ["clinical", "fatality", "severity", "incubation"]):
        return "臨床疫学・重症度に関する知見。潜伏期間、致命率、医療従事者感染、院内感染リスクの整理に有用。"
    if any(k in text for k in ["diagnostic", "genomic", "sequence", "assay"]):
        return "診断・ゲノム監視に関する知見。検査系、系統解析、ウイルス同定、感染連鎖把握に関連する。"
    return "科学的情報の更新。今回の流行の疫学研究、臨床研究、R&D判断への関連性を確認する。"


def generate_latest_digest() -> None:
    cutoff_date = (now_utc() - dt.timedelta(hours=48)).date()
    rows: List[Dict[str, str]] = []
    for row in read_csv(DOCS_DATA / "response_tracker.csv"):
        d = parse_date(row.get("date", ""))
        if d and d >= cutoff_date:
            rows.append({"date": row.get("date", ""), "category": "関係機関・公衆衛生対応", "source": row.get("organization", ""), "title": row.get("title", ""), "summary_ja": jp_summary_for_response(row), "url": row.get("source_url", "")})
    for fname, category in [("epidemiological_research.csv", "疫学研究"), ("rd_tracker.csv", "治療薬・ワクチン・診断R&D")]:
        for row in read_csv(DOCS_DATA / fname):
            d = parse_date(row.get("date", ""))
            if d and d >= cutoff_date:
                rows.append({"date": row.get("date", ""), "category": category, "source": row.get("source", ""), "title": row.get("title", ""), "summary_ja": jp_summary_for_science(row), "url": row.get("url", "")})
    rows.sort(key=lambda r: (r["date"], r["category"], r["source"]), reverse=True)
    fields = ["date", "category", "source", "title", "summary_ja", "url"]
    write_csv(PROCESSED / "latest_48h_summary.csv", rows, fields)
    shutil.copy2(PROCESSED / "latest_48h_summary.csv", DOCS_DATA / "latest_48h_summary.csv")


def write_manifest(monitor_rows: List[Dict[str, str]], auto_response: List[Dict[str, str]], auto_epi: List[Dict[str, str]], auto_rd: List[Dict[str, str]]) -> None:
    status_counts: Dict[str, int] = {}
    for r in monitor_rows:
        status_counts[r.get("change_status", "unknown")] = status_counts.get(r.get("change_status", "unknown"), 0) + 1
    payload = {
        "generated_at_utc": now_utc().isoformat(),
        "update_frequency": "Every 6 hours via GitHub Actions cron: 17 */6 * * *",
        "latest_digest_window": "Items dated within the previous 48 hours; date-only source rows are evaluated by calendar date",
        "data_status": "curated case counts; monitored-source and literature candidates refreshed automatically; human review recommended before operational use",
        "source_monitor": status_counts,
        "auto_items_this_run": {
            "institutional_updates": len(auto_response),
            "epidemiological_research_candidates_promoted_to_display": len(auto_epi),
            "rd_items_promoted_to_display": len(auto_rd),
        },
        "files": CURATED_FILES + GENERATED_FILES,
    }
    (DOCS_DATA / "manifest.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    copy_curated_for_pages()
    monitor_rows, auto_response, monitored_rd = update_source_monitor()
    epi_candidates, rd_candidates = generate_candidate_literature_files()
    auto_epi = auto_epi_rows(epi_candidates)
    auto_rd = auto_rd_rows(rd_candidates, monitored_rd)
    build_docs_trackers(auto_response, auto_epi, auto_rd)
    generate_latest_digest()
    write_manifest(monitor_rows, auto_response, auto_epi, auto_rd)
    print("Dashboard update complete")
    print(f"Monitored sources: {len(monitor_rows)}; auto response updates: {len(auto_response)}; auto epi candidates: {len(auto_epi)}; auto R&D items: {len(auto_rd)}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc!r}", file=sys.stderr)
        raise
