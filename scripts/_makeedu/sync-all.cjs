/**
 * scripts/_makeedu/sync-all.cjs — makeedu → eywa **증분 동기화 오케스트레이터** (Phase 2, GitHub Actions cron).
 *
 * 전역 토글 확인 → 라이브 스크래핑(1 로그인) → 안전·멱등 도메인만 additive 임포트(--apply). 도메인별 실패 격리.
 * 임포터는 전부 additive(makeedu_id/자연키 매칭 + on-conflict-do-nothing/backfill)라 **재실행 = 증분**(새 행만 추가).
 *
 * 포함 도메인(멱등): students(DOM)·classes·prospects·invoices.
 * 제외(수동): enrollments(엑셀 '수업' 컬럼 의존)·consultations(import-consultations deprecated, No≠counselSeq)·
 *            catalog(tuition 기타가 이름 insert라 재실행 중복)·prospects 상세본문(sync-prospects = 레코드별 상세 fetch).
 *
 * 사용:
 *   node --env-file=.env.local scripts/_makeedu/sync-all.cjs --apply               # 스크래핑 + 적재
 *   node --env-file=.env.local scripts/_makeedu/sync-all.cjs --apply --no-scrape   # 기존 JSON으로 적재만(로컬 테스트)
 * 필요 env: MAKEEDU_ID / MAKEEDU_PW(스크래핑) · DATABASE_URL(Supabase) · MAKEEDU_OUT(JSON 디렉터리, CI는 ./.makeedu-tmp).
 */
const { spawnSync } = require("child_process");
const path = require("path");
const postgres = require("postgres");
const L = require("./lib.cjs");

const APPLY = process.argv.includes("--apply");
const SKIP_SCRAPE = process.argv.includes("--no-scrape");
const HERE = __dirname;

// cron이 도는 안전·멱등 도메인만(위 헤더 '제외' 참고). 스크래핑 리스트 키와 임포터를 1:1로.
const SCRAPE_LISTS = ["students", "classes", "prospects", "invoices"];
const IMPORTERS = [
  ["students", "import-students-list.cjs"],
  ["classes", "import-classes.cjs"],
  ["prospects", "import-prospects.cjs"],
  ["invoices", "import-invoices.cjs"],
];

function run(label, file, args) {
  console.log(`\n──── ${label}: ${path.basename(file)} ${args.join(" ")} ────`);
  const r = spawnSync(process.execPath, [path.join(HERE, file), ...args], { stdio: "inherit", env: process.env });
  if (r.status !== 0) throw new Error(`${file} exited ${r.status}`);
}

(async () => {
  // 1) 전역 토글 — user_integrations(provider=makeedu).sync_enabled=false면 스킵(행 없으면 기본 ON).
  let tenantId;
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    tenantId = await L.resolveTenantId(sql);
    const [row] = await sql`
      select sync_enabled from user_integrations
      where tenant_id = ${tenantId} and provider = 'makeedu' limit 1`;
    // MAKEEDU_FORCE=true(앱 '지금 동기화' 버튼)면 토글을 무시하고 강제 실행. cron/일반 실행은 토글 존중.
    const FORCE = process.env.MAKEEDU_FORCE === "true";
    if (!FORCE && row && row.sync_enabled === false) {
      console.log("⏸  makeedu 동기화 OFF (user_integrations.sync_enabled=false) — 스킵.");
      return;
    }
    console.log("▶  makeedu 동기화 시작 — tenant:", tenantId);
  } finally {
    await sql.end();
  }

  // 2) 스크래핑(1 로그인, 4 리스트). --no-scrape면 기존 JSON 재사용(로컬 테스트).
  if (!SKIP_SCRAPE) run("scrape", "scrape.cjs", [`--list=${SCRAPE_LISTS.join(",")}`]);
  else console.log("\n(--no-scrape: 기존 JSON 재사용)");

  // 3) 임포터(--apply) 순차 — 한 도메인 실패가 나머지를 막지 않게 격리.
  const flags = APPLY ? ["--apply"] : [];
  const failed = [];
  for (const [domain, file] of IMPORTERS) {
    try {
      run(domain, file, flags);
    } catch (e) {
      console.error(`✖ ${domain} 실패: ${e.message}`);
      failed.push(domain);
    }
  }

  // 4) 실패 도메인은 makeedu_sync_state에 error 기록(성공 도메인은 임포터가 ok로 기록함 → 화면 배지에 노출).
  if (APPLY && failed.length && tenantId) {
    const sql2 = postgres(process.env.DATABASE_URL, { prepare: false });
    try {
      for (const d of failed) await L.recordSync(sql2, tenantId, d, null, "error", "sync-all 임포터 실패");
    } finally {
      await sql2.end();
    }
  }

  console.log(`\n✅ 동기화 완료. 실패 도메인: ${failed.length ? failed.join(", ") : "없음"}`);
  if (failed.length) process.exit(1); // CI가 부분 실패를 인지(다음 cron이 멱등 재시도)
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
