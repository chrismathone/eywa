"""Record evidence levels without treating SQL coverage as full user acceptance."""
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

BOUNDARY = "Local auth stub; actual Next server actions + makeup SQL. Attendance/report fixture preconditions; no production calls."
RESULTS = (
    "UI intake → approval → reservation; O=110,C=110",
    "UI participation → submission → independent recognition; O=0,C=0; money/ownership unchanged",
    "read-only 390px detail embed has no page-level horizontal overflow",
    "390px actual teacher shell shows scoped detail and hides self-review",
    "same-tenant unassigned teacher cannot expose case student",
    "keyboard opens reconciliation; UI scan succeeded without quantity/money changes; 390px queue fits",
    "UI dry-run reads write zero; keyboard reveals source hash; explicit link preserves source/money and stores hash/batch; 390px fits",
    "foreign tenant/off-mode cannot expose case student",
    "actual workspace iframe intake → list GET filter → detail → reload preserves embed; no nested shell",
)
FILES = (
    "desktop-detail.png", "mobile-detail.png", "mobile-teacher-detail.png",
    "mobile-reconciliation.png", "mobile-dry-run.png", "desktop-workspace.png",
)

def assert_completed_sql(root, log):
    lines = [line.strip() for line in log.splitlines() if line.strip()]
    failed = [line for line in lines if line.startswith("FAIL ") or "scenario file(s) failed" in line]
    assert not failed, "SQL log is not a completed run"
    required = sorted(path.name for path in (root / "tests/makeup-db/sql").glob("*.sql"))
    required += sorted(path.name for path in (root / "tests/makeup-db/concurrency").glob("*.mjs"))
    assert required, "SQL evidence list is empty"
    missing = [name for name in required if not any(re.fullmatch(rf"PASS {re.escape(name)} \(\d+ checks\)", line) for line in lines)]
    assert not missing, "SQL log is missing completed files"

def assert_completed_browser(path, browser):
    assert browser.get("errors") == [], "Browser journey recorded errors"
    assert browser.get("boundary") == BOUNDARY, "Browser boundary does not match the harness"
    assert browser.get("results") == list(RESULTS), "Browser results do not match the completed journey"
    files = browser.get("files")
    assert isinstance(files, dict) and set(files) == set(FILES), "Browser evidence files do not match the journey"
    for name in FILES:
        expected = files[name]
        assert isinstance(expected, str) and re.fullmatch(r"[0-9a-f]{64}", expected), name
        actual = hashlib.sha256((path.parent / name).read_bytes()).hexdigest()
        assert actual == expected, name

def source_rows(docs, name):
    with (docs / name).open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))

def main():
    evidence, sql_log, browser_json = map(Path, sys.argv[1:4])
    root = Path(__file__).resolve().parents[2]
    docs = root / "docs/features/makeups"
    report = (evidence / "implementation-claude-repair-report.md").read_text(encoding="utf-8-sig")
    db = {}
    for line in report.splitlines():
        cells = [part.strip() for part in line.strip().strip("|").split("|")]
        if len(cells) == 4 and re.fullmatch(r"MU-(?:\d{3}|X\d{2})", cells[0]):
            db[cells[0]] = (cells[2], cells[3])
    assert len(db) == 82, "Unexpected historical SQL mapping; inspect rather than silently skipping"
    browser = json.loads(browser_json.read_text(encoding="utf-8-sig")) if browser_json.exists() else None
    if browser is not None:
        assert_completed_browser(browser_json, browser)
    log = sql_log.read_text(encoding="utf-8-sig")
    assert_completed_sql(root, log)
    db["MU-054"] = ("23_legacy_dry_run.sql + 24_dry_run_evidence_tenant.sql", "DB 계층 실행 — 조회 쓰기 0·분류·1001건 페이지·원본 해시")
    browser_notes = {
        "MU-054": "합성 브라우저: 사전 점검 조회 쓰기 0·A등급·원본 해시·명시적 연결",
        "MU-060": "390px 실제 강사 계정 상세 조회·가로 잘림 점검; 전체 강사 쓰기 동선은 미실행",
        "MU-061": "대사·원본 해시 키보드 진입과 모바일 잘림 점검; 전체 접근성 수락은 미실행",
        "MU-X15": "대사·원본 해시 키보드 진입과 모바일 잘림 점검; 전체 접근성 수락은 미실행",
    }
    original = source_rows(docs, "수용테스트_단계매핑.csv")
    additional = source_rows(docs, "추가수용테스트.csv")
    assert len(original) == 81 and len(additional) == 19
    rows = []
    for source in original + additional:
        ident = source["id"]
        covered = db.get(ident)
        later = source.get("scope") == "후속"
        note = browser_notes.get(ident, "개별 브라우저 시나리오 미실행") if browser else "최종 브라우저 근거 미완료"
        rows.append({
            "id": ident, "scenario": source["scenario"],
            "expected": source.get("original_expected", source.get("expected", "")),
            "scope": source.get("scope", "추가 회귀"),
            "phase": source.get("implementation_phase", source.get("phase", "")),
            "db_evidence": covered[0] if covered else "전용 번호별 SQL 검증 없음",
            "db_level": covered[1] if covered else "미실행 또는 별도 기능 거절 회귀",
            "unit_level": "전체 단위 회귀는 별도 결과; 이 번호의 전체 기대를 수락한 판정 아님",
            "browser_level": note,
            "status": "후속 원기능 미실행" if later else "로컬 부분 검증" if covered or (browser and ident in browser_notes) else "번호별 수락 미완료",
            "remaining": "운영 DB·실제 Supabase 인증·실데이터 도입(P6) 미실행; 원문 전체 기대 자동 통과로 세지 않음",
        })
    assert len(rows) == 100 and len({row["id"] for row in rows}) == 100
    output = docs / "execution-matrix.csv"
    with output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), quoting=csv.QUOTE_ALL)
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps({"rows": len(rows), "sql_numbered": len(db), "browser_evidence": bool(browser), "full_acceptance_claimed": 0}, ensure_ascii=False))

if __name__ == "__main__":
    main()
