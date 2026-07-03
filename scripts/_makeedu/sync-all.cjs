/**
 * scripts/_makeedu/sync-all.cjs — makeedu → eywa **증분 동기화 오케스트레이터**.
 *
 * 전역 토글 확인 → 라이브 스크래핑(1 로그인) → 안전·멱등 도메인만 additive 임포트(--apply). 도메인별 실패 격리.
 * 임포터는 전부 additive(makeedu_id/자연키 매칭 + on-conflict-do-nothing/backfill)라 **재실행 = 증분**(새 행만 추가).
 *
 * 포함 도메인(멱등): students(DOM)·classes·prospects·invoices·consultations(증분 — sync-consultations-incremental,
 *                    최근 창만 목록 걷고 신규만 상세 fetch. 초기 대량은 엑셀 부트스트랩 import-consultations-excel).
 * 제외(수동): enrollments(엑셀 '수업' 컬럼 의존)·catalog(tuition 기타가 이름 insert라 재실행 중복)·
 *            prospects 상세본문(sync-prospects = 레코드별 상세 fetch).
 *
 * 실행 로그(0070a makeedu_sync_runs): 매 실행을 running→ok|partial|error(+skipped)로 기록 — 연동 면 이력 표시.
 * 트리거 라벨은 호출자가 env MAKEEDU_TRIGGER로 주입(scheduled|button|relay|manual — 미지정 시 manual).
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
const TRIGGER = process.env.MAKEEDU_TRIGGER || "manual";
// "누가 실행했는지"(0076a) — 앱 '지금 동기화' 버튼을 누른 user id(로컬 spawn=현재 사용자 / 원격=요청자).
// 자동(scheduled)·CLI는 미주입 → null → UI에서 "[자동 실행]". uuid 형식만 신뢰(잘못된 값은 null 처리).
const TRIGGERED_BY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
  process.env.MAKEEDU_TRIGGERED_BY || "",
)
  ? process.env.MAKEEDU_TRIGGERED_BY
  : null;

// cron이 도는 안전·멱등 도메인만(위 헤더 '제외' 참고). 스크래핑 리스트 키와 임포터를 1:1로.
const SCRAPE_LISTS = ["students", "classes", "prospects", "invoices"];
const IMPORTERS = [
  ["students", "import-students-list.cjs"],
  ["classes", "import-classes.cjs"],
  ["prospects", "import-prospects.cjs"],
  ["invoices", "import-invoices.cjs"],
  // 재원생 상담 증분(마지막 — 자체 Playwright 로그인·상세 fetch. 실패해도 앞 4개 도메인은 무사).
  ["consultations", "sync-consultations-incremental.cjs"],
];

function run(label, file, args) {
  console.log(`\n──── ${label}: ${path.basename(file)} ${args.join(" ")} ────`);
  // timeout 8분 = 공통 안전망 — Playwright 임포터가 행 걸려도 워처/스케줄러를 영구 블록하지 않게
  // (킬되면 status가 0이 아니어서 아래 throw → 도메인 실패로 격리·기록).
  const r = spawnSync(process.execPath, [path.join(HERE, file), ...args], {
    stdio: "inherit",
    env: process.env,
    timeout: 8 * 60_000,
  });
  if (r.status !== 0) throw new Error(`${file} exited ${r.status}`);
}

// 짧은 DB 작업용(스크래핑/임포트 동안 유휴 연결을 안 들고 있게 매번 열고 닫는다 — 기존 sql/sql2 패턴).
async function withDb(fn) {
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

// 실행 로그(0070a) — 실패해도 동기화 자체를 막지 않게 best-effort.
let runId = null;
let tenantIdG = null;
const t0 = Date.now();

async function finishRun(status, { failed = [], error = null } = {}) {
  if (!runId) return;
  try {
    await withDb(async (sql) => {
      // 이번 실행이 갱신한 도메인 스냅샷(sync_state.updated_at >= 시작 시각)을 함께 보존.
      const rows = await sql`
        select domain, status, row_count from makeedu_sync_state
        where tenant_id = ${tenantIdG} and updated_at >= to_timestamp(${t0 / 1000})`;
      const domains = {};
      for (const r of rows) domains[r.domain] = { status: r.status, rows: r.row_count };
      await sql`
        update makeedu_sync_runs
        set status = ${status}, finished_at = now(), duration_ms = ${Date.now() - t0},
            domains = ${sql.json(domains)}, failed_domains = ${failed}, error = ${error}
        where id = ${runId}`;
    });
  } catch (e) {
    console.error("(실행 로그 기록 실패 — 동기화 결과와 무관)", e.message);
  }
}

(async () => {
  // 1) 전역 토글 + 실행 로그 시작 — user_integrations(provider=makeedu).sync_enabled=false면 스킵(행 없으면 기본 ON).
  let skipped = false;
  await withDb(async (sql) => {
    tenantIdG = await L.resolveTenantId(sql);
    const [row] = await sql`
      select sync_enabled from user_integrations
      where tenant_id = ${tenantIdG} and provider = 'makeedu' limit 1`;
    // MAKEEDU_FORCE=true(앱 '지금 동기화' 버튼/워처)면 토글을 무시하고 강제 실행. cron/일반 실행은 토글 존중.
    const FORCE = process.env.MAKEEDU_FORCE === "true";
    if (!FORCE && row && row.sync_enabled === false) {
      skipped = true;
      // 건너뛴 실행도 로그로 남긴다("cron이 돌긴 했는데 토글 OFF였다"까지 추적).
      await sql`
        insert into makeedu_sync_runs (tenant_id, trigger_source, triggered_by, status, finished_at, duration_ms)
        values (${tenantIdG}, ${TRIGGER}, ${TRIGGERED_BY}, 'skipped', now(), 0)`.catch(() => {});
      return;
    }
    const [r] = await sql`
      insert into makeedu_sync_runs (tenant_id, trigger_source, triggered_by)
      values (${tenantIdG}, ${TRIGGER}, ${TRIGGERED_BY}) returning id`.catch(() => [null]);
    runId = r ? r.id : null;
    console.log("▶  makeedu 동기화 시작 — tenant:", tenantIdG, "| trigger:", TRIGGER);
  });
  if (skipped) {
    console.log("⏸  makeedu 동기화 OFF (user_integrations.sync_enabled=false) — 스킵.");
    return;
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
  if (APPLY && failed.length && tenantIdG) {
    await withDb(async (sql2) => {
      for (const d of failed) await L.recordSync(sql2, tenantIdG, d, null, "error", "sync-all 임포터 실패");
    });
  }

  await finishRun(failed.length ? "partial" : "ok", { failed });
  console.log(`\n✅ 동기화 완료. 실패 도메인: ${failed.length ? failed.join(", ") : "없음"}`);
  if (failed.length) process.exit(1); // CI가 부분 실패를 인지(다음 cron이 멱등 재시도)
})().catch(async (e) => {
  // 전체 실패(스크래핑 크래시 등)도 실행 로그에 남긴다.
  await finishRun("error", { error: (e && e.message) || String(e) });
  console.error("ERR", e.message);
  process.exit(1);
});
