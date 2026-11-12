/**
 * scripts/_makeedu/sync-all.cjs — makeedu → aywa **증분 동기화 오케스트레이터**.
 *
 * 전역 토글 확인 → 라이브 스크래핑(1 로그인) → 안전·멱등 도메인만 additive 임포트(--apply). 도메인별 실패 격리.
 * 임포터는 전부 additive(makeedu_id/자연키 매칭 + on-conflict-do-nothing/backfill)라 **재실행 = 증분**(새 행만 추가).
 *
 * 포함 도메인(멱등): students(DOM)·classes·prospects·invoices·textbook_checks(교재 자동 체크 —
 *                    mirror-textbook-checks: 수납 라인 생성=등록·완납=납부, 입력자='자동화', ON만/OFF 없음)·
 *                    consultations(증분 — sync-consultations-incremental, 최근 창만 목록 걷고 신규만 상세 fetch.
 *                    초기 대량은 엑셀 부트스트랩 import-consultations-excel).
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
// ⚠️ `withdrawn`(퇴원생 목록)은 import-invoices의 **삭제 판정 5번째 가드** 재료다 — 없으면 그 가드가 꺼진다.
// 스크랩 실패는 scrape.cjs가 목록 단위로 격리하므로(빈 JSON) invoices 적재는 그대로 진행된다.
// 📌 이전 실행의 withdrawn.json이 남아 낡아도 **양방향으로 안전하게** 실패한다:
//    재등원한 학생은 활성 수강 가드(④)가 막고, 새로 퇴원한 학생은 목록에 없어 보류될 뿐이다.
const SCRAPE_LISTS = ["students", "classes", "prospects", "invoices", "withdrawn", "staff_attendance"];
const IMPORTERS = [
  ["students", "import-students-list.cjs"],
  ["classes", "import-classes.cjs"],
  ["prospects", "import-prospects.cjs"],
  ["invoices", "import-invoices.cjs"],
  // 교재 자동 체크 — scrape가 갱신한 invoices.json(라인 단위)을 소비하므로 invoices 뒤·DB만 접근(Playwright 無).
  ["textbook_checks", "mirror-textbook-checks.cjs"],
  // 직원 출퇴근(강사평가 근태 — 시각만 옮기고 지각·결근 판정은 aywa가 한다). DB만 접근(Playwright 無).
  ["staff_attendance", "import-staff-attendance.cjs"],
  // 재원생 상담 증분(마지막 — 자체 Playwright 로그인·상세 fetch. 실패해도 앞 도메인은 무사).
  ["consultations", "sync-consultations-incremental.cjs"],
];

// 자식 stderr에서 "진짜 원인" 한 줄을 뽑는다 — DB(makeedu_sync_runs.error)엔 이 줄이 실려야
// 화면에 "scrape.cjs exited 1"(무의미) 대신 "로그인 실패…/재인증 벽…/세션 만료…"가 뜬다. 로그인 오류엔 PII 없음.
function lastMeaningfulLine(stderr) {
  if (!stderr) return "";
  const lines = String(stderr)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return "";
  // scrape.cjs 최종 catch는 `ERR <메시지>`로 뱉는다 — 있으면 그걸(접두어 제거), 없으면 마지막 비어있지 않은 줄.
  const err = [...lines].reverse().find((l) => /^ERR\b/.test(l));
  return (err ? err.replace(/^ERR\s*/, "") : lines[lines.length - 1]).slice(0, 300);
}

function run(label, file, args) {
  console.log(`\n──── ${label}: ${path.basename(file)} ${args.join(" ")} ────`);
  // timeout 8분 = 공통 안전망 — Playwright 임포터가 행 걸려도 워처/스케줄러를 영구 블록하지 않게
  // (킬되면 status가 0이 아니어서 아래 throw → 도메인 실패로 격리·기록).
  // stderr만 pipe로 캡처(stdout은 그대로 스트리밍) → 실패 시 자식이 뱉은 실제 원인을 throw 메시지에 실어 DB까지 전달.
  const r = spawnSync(process.execPath, [path.join(HERE, file), ...args], {
    stdio: ["inherit", "inherit", "pipe"],
    env: process.env,
    timeout: 8 * 60_000,
    encoding: "utf8",
  });
  if (r.stderr) process.stderr.write(r.stderr); // 로그 파일(.makeedu-tmp\sync-local.log)엔 그대로 남긴다.
  if (r.status !== 0) {
    const reason = lastMeaningfulLine(r.stderr) || (r.signal ? `시그널 ${r.signal}(타임아웃 등)` : "");
    throw new Error(`${file} exited ${r.status ?? r.signal ?? ""}${reason ? ` — ${reason}` : ""}`);
  }
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
// 직원 출퇴근은 강사평가를 쓰는 지점만(0366a — 직원 포트폴리오 집계가 있는 지점). 꺼진 지점은 화면을 열지도 않는다(기능 스위치 = 워커까지).
let staffAttendanceOn = false;
const t0 = Date.now();

async function finishRun(status, { failed = [], error = null, reasons = {} } = {}) {
  if (!runId) return;
  try {
    await withDb(async (sql) => {
      // 이번 실행이 갱신한 도메인 스냅샷(sync_state.updated_at >= 시작 시각)을 함께 보존.
      const rows = await sql`
        select domain, status, row_count from makeedu_sync_state
        where tenant_id = ${tenantIdG} and updated_at >= to_timestamp(${t0 / 1000})`;
      const domains = {};
      for (const r of rows) domains[r.domain] = { status: r.status, rows: r.row_count };
      // 실패 사유를 도메인 칸에도 붙인다. sync_state는 **다음 성공 실행이 덮어쓰는 현재상태 테이블**이라
      // 거기에만 두면 원인이 몇 시간 만에 증발한다 — run 행(이력)이 사유의 영구 보관처다.
      for (const [d, reason] of Object.entries(reasons)) {
        domains[d] = { status: "error", rows: null, ...(domains[d] ?? {}), reason };
      }
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
    if (!(await L.isMakeeduModuleEnabled(sql, tenantIdG))) {
      skipped = true;
      return;
    }
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
    const [g] = await sql`select public.sync_agent_staff_attendance_ready(${tenantIdG}) as ready`.catch(() => [null]);
    staffAttendanceOn = Boolean(g && g.ready);
    console.log("▶  makeedu 동기화 시작 — tenant:", tenantIdG, "| trigger:", TRIGGER);
  });
  if (skipped) {
    console.log("⏸  makeedu 동기화가 꺼져 있어 건너뜁니다.");
    return;
  }

  // 2) 스크래핑(1 로그인, 4 리스트). --no-scrape면 기존 JSON 재사용(로컬 테스트).
  const lists = SCRAPE_LISTS.filter((k) => k !== "staff_attendance" || staffAttendanceOn);
  if (!SKIP_SCRAPE) run("scrape", "scrape.cjs", [`--list=${lists.join(",")}`]);
  else console.log("\n(--no-scrape: 기존 JSON 재사용)");

  // 3) 임포터(--apply) 순차 — 한 도메인 실패가 나머지를 막지 않게 격리.
  const flags = APPLY ? ["--apply"] : [];
  // 🔴 사유(reason)를 도메인과 **함께** 들고 간다. 예전엔 도메인 이름만 모아서, 화면엔 "실패: invoices,
  //    textbook_checks"만 뜨고 **왜인지는 어디에도 안 남았다**(2026-08-03 06:00 실행 — 원인 추적 불가).
  //    run()이 자식 stderr에서 진짜 원인을 뽑아 e.message에 실어 주는데(lastMeaningfulLine) 그걸 버리고 있었다.
  const failed = [];
  for (const [domain, file] of IMPORTERS) {
    if (domain === "staff_attendance" && !staffAttendanceOn) continue;
    try {
      if (domain === "textbook_checks" && failed.some((f) => f.domain === "invoices")) {
        throw new Error("수납 수집·검증 실패로 교재 자동 체크도 중단합니다");
      }
      run(domain, file, flags);
    } catch (e) {
      const reason = ((e && e.message) || String(e)).slice(0, 300);
      console.error(`✖ ${domain} 실패: ${reason}`);
      failed.push({ domain, reason });
    }
  }

  // 4) 실패 도메인은 makeedu_sync_state에 error 기록(성공 도메인은 임포터가 ok로 기록함 → 화면 배지에 노출).
  // ⚠️ **임포터가 이미 자기 진단을 남겼으면 덮지 않는다.** 예전엔 무조건 "sync-all 임포터 실패" 상수로
  //    덮어써서, import-invoices의 0행 가드가 남긴 "스크랩 0행 — makeedu 상세수납 목록을 못 읽었다
  //    (세션 만료·URL/셀렉터 변경 의심)"처럼 **원인을 특정한 문장이 지워졌다**. 오케스트레이터가 아는 것
  //    (자식이 죽었다)보다 임포터가 아는 것(왜 죽었다)이 항상 더 구체적이다.
  if (APPLY && failed.length && tenantIdG) {
    await withDb(async (sql2) => {
      const own = await sql2`
        select domain from makeedu_sync_state
        where tenant_id = ${tenantIdG} and status = 'error' and error is not null
          and updated_at >= to_timestamp(${t0 / 1000})`;
      const selfReported = new Set(own.map((r) => r.domain));
      for (const f of failed) {
        if (selfReported.has(f.domain)) continue;
        await L.recordSync(sql2, tenantIdG, f.domain, null, "error", f.reason);
      }
    });
  }

  // run 행의 error = 화면이 이미 한글로 풀어 보여주는 자리(humanizeMakeeduSyncError + 원문 툴팁)인데
  // partial 경로에서만 null로 비어 있었다 — **소비처는 다 만들어 두고 아무도 안 쓰던 칸**이다.
  const summary = L.summarizeFailures(failed);
  await finishRun(failed.length ? "partial" : "ok", {
    failed: summary.domains,
    error: summary.error,
    reasons: summary.reasons,
  });
  console.log(`\n✅ 동기화 완료. 실패 도메인: ${failed.length ? summary.domains.join(", ") : "없음"}`);
  if (failed.length) process.exit(1); // CI가 부분 실패를 인지(다음 cron이 멱등 재시도)
})().catch(async (e) => {
  // 전체 실패(스크래핑 크래시 등)도 실행 로그에 남긴다.
  await finishRun("error", { error: (e && e.message) || String(e) });
  console.error("ERR", e.message);
  process.exit(1);
});
