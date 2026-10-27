"""Package reviewed SQL and operator evidence; never connects to a database."""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CHECKS = ("unit", "typecheck", "lint", "productionBuild", "sql", "browser", "manual")
PLAN = "DBE9426AD191391C6BA3A6E569D6E40A61C9FCD24F628A2B45CDAD3568348C05"
DOCS = (
    "approved-plan.md", "plan-consensus.md", "rollout.md", "consumer-inventory.md",
    "validation.md", "execution-matrix.csv", "release-review.md",
    "수용테스트_단계매핑.csv", "추가수용테스트.csv", "consensus.json",
)
SUPPORT = (
    "scripts/makeups/release_bundle.py",
    "scripts/makeups/execution_matrix.py",
    "tests/makeup-db/run.mjs",
    "tests/makeup-browser/build.mjs",
    "tests/makeup-browser/start.mjs",
    "tests/makeup-browser/loopback-env.mjs",
    "tests/makeup-browser/manifest.mjs",
    "vitest.config.ts",
)
RAW_EVIDENCE = {"sql": "sql-run.log", "browser": "journey.json"}
BROWSER_BOUNDARY = "Local auth stub; actual Next server actions + makeup SQL. Attendance/report fixture preconditions; no production calls."
HISTORY = ("round1-codex.md", "round1-claude.md", "round1-grok.md", "round2-grok-issues.md")

def digest_of(value):
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(raw).hexdigest()

def repo_file(root, relative):
    if not isinstance(relative, str) or not relative or relative.startswith(("/", "\\")) or ":" in relative:
        raise AssertionError(f"Manifest path must stay inside the repo: {relative}")
    if any(part in ("", ".", "..") for part in Path(relative).parts):
        raise AssertionError(f"Manifest path must stay inside the repo: {relative}")
    resolved = (root / relative).resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise AssertionError(f"Manifest path must stay inside the repo: {relative}")
    return resolved

def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()

def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))

def artifact_names(root):
    migrations = sorted((root / "supabase/migrations").glob("034[3-9][a-z]_makeup_*.sql"))
    # 2026-10-27 시즌2: 낱개 SQL(0343a~0350f)은 시즌1 합본(s1_season1.sql)에 들었다. 이 출시 묶음의 검증 증거는 낱개 파일 해시에
    # 묶여 있어 합본으로는 다시 만들 수 없다 — 합본 직전 커밋의 워크트리(git worktree add <폴더> <커밋>)에서 돌린다.
    if not migrations:
        raise SystemExit("시즌1 낱개 SQL이 없습니다(2026-10-27 시즌2 합본) — 합본 직전 커밋의 워크트리에서 돌리세요")
    assert len(migrations) == 43, "Packaged migration count is not 43"
    docs = root / "docs/features/makeups"
    names = [f"supabase/migrations/{item.name}" for item in migrations]
    names += [f"docs/features/makeups/{name}" for name in DOCS]
    names += [f"docs/features/makeups/{item.name}" for item in sorted(docs.glob("final-review-*.md"))]
    names.append("docs/manual/에이와-사용설명서.pdf")
    names.extend(SUPPORT)
    return migrations, sorted(names)

def require_source(root, evidence, ready):
    manifest = load_json(evidence / "release-review-source-manifest.json")
    digest = digest_of(manifest)
    assert digest == ready["digest"], "Review gate does not match the source manifest"
    for entry in manifest:
        assert sha_bytes(repo_file(root, entry["file"]).read_bytes()) == entry["sha256"], entry["file"]
    return manifest

def require_artifacts(root, evidence, ready):
    listed = load_json(evidence / "release-review-artifact-manifest.json")
    digest = digest_of(listed)
    assert digest == ready["artifactDigest"], "Artifact digest does not match the packaged bytes"
    _, expected = artifact_names(root)
    for folder in ("tests/makeup-browser", "tests/makeup-db"):
        expected.extend(path.relative_to(root).as_posix() for path in (root / folder).rglob("*") if path.suffix in (".mjs", ".sql"))
    names = [entry["file"] for entry in listed]
    assert names == sorted(set(names)), "Artifact manifest paths must be sorted and unique"
    assert set(expected).issubset(names), "Artifact manifest must include packaged files and verification harness"
    pinned = {}
    for entry in listed:
        actual = sha_bytes(repo_file(root, entry["file"]).read_bytes())
        assert actual == entry["sha256"], entry["file"]
        pinned[entry["file"]] = actual
    return digest, pinned

def require_reviews(evidence, ready, artifact_digest):
    reports = []
    for provider in ("codex", "claude", "grok"):
        report = evidence / f"final-adversarial-{provider}-release.json"
        review = load_json(report)
        assert review.get("provider") == provider, provider
        assert review.get("decision") == "APPROVE", provider
        assert review.get("digest") == ready["digest"], provider
        assert review.get("artifactDigest") == artifact_digest, provider
        reports.append(report)
    return reports

def require_verification(evidence, ready, artifact_digest):
    raw = (evidence / "release-verification.json").read_bytes()
    verification = json.loads(raw.decode("utf-8-sig"))
    assert verification.get("digest") == ready["digest"]
    assert verification.get("artifactDigest") == artifact_digest
    for name in CHECKS:
        check = verification["checks"][name]
        assert check.get("status") == "passed", name
        assert check.get("digest") == ready["digest"], name
        assert check.get("exit_code") == 0, name
        if name in RAW_EVIDENCE:
            payload = (evidence / RAW_EVIDENCE[name]).read_bytes()
            assert check.get("evidence_sha256") == sha_bytes(payload), name
            if name == "browser":
                assert json.loads(payload.decode("utf-8-sig")).get("boundary") == BROWSER_BOUNDARY
    return raw

def package(evidence, output, root=ROOT):
    evidence, output, root = Path(evidence).resolve(), Path(output).resolve(), Path(root).resolve()
    ready = load_json(evidence / "release-review-ready.json")
    require_source(root, evidence, ready)
    artifact_digest, pinned = require_artifacts(root, evidence, ready)
    reviews = require_reviews(evidence, ready, artifact_digest)
    verification = require_verification(evidence, ready, artifact_digest)
    migrations, _ = artifact_names(root)
    members = {}
    for item in migrations:
        data = item.read_bytes()
        assert sha_bytes(data) == pinned[f"supabase/migrations/{item.name}"]
        members[f"migrations/{item.name}"] = data
    docs = root / "docs/features/makeups"
    for name in DOCS:
        data = (docs / name).read_bytes()
        assert sha_bytes(data) == pinned[f"docs/features/makeups/{name}"]
        members[f"docs/{name}"] = data
    for item in sorted(docs.glob("final-review-*.md")):
        data = item.read_bytes()
        assert sha_bytes(data) == pinned[f"docs/features/makeups/{item.name}"]
        members[f"docs/{item.name}"] = data
    assert sha_bytes(members["docs/approved-plan.md"]).upper() == PLAN
    manual = (root / "docs/manual/에이와-사용설명서.pdf").read_bytes()
    assert sha_bytes(manual) == pinned["docs/manual/에이와-사용설명서.pdf"]
    members["manual/에이와-사용설명서.pdf"] = manual
    for name in SUPPORT:
        data = repo_file(root, name).read_bytes()
        assert sha_bytes(data) == pinned[name]
        members[f"support/{Path(name).name}"] = data
    for name in HISTORY:
        members[f"reviews/plan-history/{name}"] = (evidence / name).read_bytes()
    for report in reviews:
        members[f"reviews/{report.name}"] = report.read_bytes()
        members[f"reviews/{report.stem}.md"] = report.with_suffix(".md").read_bytes()
    members["reviews/source-manifest.json"] = (evidence / "release-review-source-manifest.json").read_bytes()
    members["reviews/artifact-manifest.json"] = (evidence / "release-review-artifact-manifest.json").read_bytes()
    members["reviews/verification.json"] = verification
    members["README.txt"] = (
        "AYWA 보강관리 수학 파일럿 적용 자료 — 2026-10-05\n"
        "앱은 검증한 커밋을 사용합니다. 운영 DB 변경과 배포는 이 자료가 실행하지 않습니다.\n"
        "기존 DB 백업과 적용 기준을 확인한 뒤 migrations/의 43개 파일을 파일명 순서로 모두 적용하세요.\n"
        "기본 운영 상태는 꺼짐입니다. rollout.md의 소수 수학 반 도입 절차를 따르세요.\n"
        "영어·자동 권리/소멸/환불/안내·학부모 예약은 이번 출시에서 비활성입니다.\n"
        "100개 원문 기준의 운영 수락 완료를 주장하지 않습니다. validation.md와 execution-matrix.csv를 확인하세요.\n"
        f"검토 소스 SHA-256: {ready['digest']}\n"
        f"패키지 파일 SHA-256: {artifact_digest}\n"
        "SHA256.json은 자기 해시를 담지 않습니다. 압축 파일 전체 해시는 이 명령을 실행한 출력입니다.\n"
    ).encode()
    checksums = {name: sha_bytes(data) for name, data in sorted(members.items())}
    assert "README.txt" in checksums and "SHA256.json" not in checksums
    members["SHA256.json"] = json.dumps({
        "excluded": ["SHA256.json"],
        "exclusion_reason": "SHA256.json cannot contain its own hash. Use the archive SHA-256 printed by this command.",
        "files": checksums,
    }, ensure_ascii=False, indent=2).encode()
    assert not output.exists(), "Refuse to overwrite an existing release archive"
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in members.items():
            archive.writestr(name, data)
    with zipfile.ZipFile(output) as archive:
        assert archive.testzip() is None
        for name, expected in checksums.items():
            assert sha_bytes(archive.read(name)) == expected, name
    print(json.dumps({
        "archive": str(output), "migrations": len(migrations), "members": len(members),
        "sha256": sha_bytes(output.read_bytes()), "sha256_json_excludes_itself": True,
        "readme_checksum": checksums["README.txt"],
    }, ensure_ascii=False))

if __name__ == "__main__":
    package(sys.argv[1], sys.argv[2])
