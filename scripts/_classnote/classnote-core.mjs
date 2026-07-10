// scripts/_classnote/classnote-core.mjs — ClassNote 발송 처리 코어 (one-shot·데몬 공용).
//
// stale 복구 + SKIP LOCKED 원자 클레임 + 건별 스크린샷·Cloud Run 게시·재시도 로직을 processQueueOnce로 묶어
// one-shot(process-classnote-queue.mjs)과 상주 데몬(watch-classnote-queue.mjs)이 동일 코어를 공유한다.
//
// ⚠️ tenant 격리 필수 — DATABASE_URL 직결(RLS 우회)이라 필터 없으면 다른 테넌트 보고서를 이 계정으로 게시.
import { chromium } from "@playwright/test";

export const CLOUD_RUN = "https://submittoclassnotev2-q4dmdhnkvq-uc.a.run.app";
export const DEFAULT_BASE = process.env.CLASSNOTE_SCREENSHOT_BASE || "http://localhost:3113"; // 스크린샷용(로컬 dev 가능)
export const DEFAULT_SHARE_BASE = process.env.CLASSNOTE_SHARE_BASE || "https://eywa-alpha.vercel.app"; // 게시글 상단 공유 링크(/r) 공개 도메인
export const BATCH = 2;
export const STALE_MIN = 10;
// /r이 이 secret 헤더를 보면 조회로그(share_link_views)를 안 남김 — 워커 스크린샷을 "학부모 열람"으로 오집계 방지(P2a).
const INTERNAL_SECRET = process.env.CLASSNOTE_INTERNAL_SECRET;

/** too_old 최소날짜 = 오늘(로컬) 기준 전 달 1일. 워커도 belt-and-suspenders 가드. */
export function minDate() {
  const d = new Date();
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const m = d.getMonth() === 0 ? 12 : d.getMonth(); // getMonth()=0-based → 전 달 = 그대로(1-based로 -1)
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/**
 * subject(subjectKey) → ClassNote 과목 라벨. injaewon ClassNote는 학생모드 보드 `(과목)학생명` 사용(실게시 검증됨).
 * P0-3(2026-07-10): 화이트리스트 — math·subject_1(고등수학)→수학, english→영어, **그 외/불명 = null(발송 불가)**.
 * 구버전은 else→"수학"이라 비수학 과목이 전부 (수학) 보드로 오게시될 수 있었음. 앱 게이트(classnote-guard.ts
 * CLASSNOTE_SENDABLE_SUBJECTS)와 동일 목록 유지할 것. (영어 학생모드 보드 실존 = 2026-07-10 기관설정 실사.)
 */
export function subjectLabel(subject) {
  if (subject === "english") return "영어";
  if (subject === "math" || subject === "subject_1") return "수학";
  return null;
}

/** ClassNote 보드 target(className) = 학생모드 `(과목)학생명`. 함수가 이 prefix로 학생모드 판정. */
export function boardClassName(subject, studentName) {
  const label = subjectLabel(subject);
  if (!label) throw new Error(`지원하지 않는 발송 과목(${subject ?? "없음"}) — ClassNote 보드 매핑 없음`);
  return `(${label})${studentName}`;
}

/** CLASSNOTE_TENANT_ID env 우선, 없으면 단일 테넌트 자동 해석, 여럿이면 오발송 방지 위해 중단. */
export async function resolveTenant(sql) {
  const env = process.env.CLASSNOTE_TENANT_ID;
  if (env) return env;
  const rows = await sql`select id from tenants`;
  if (rows.length === 1) return rows[0].id;
  throw new Error(`테넌트 ${rows.length}개 — CLASSNOTE_TENANT_ID env를 지정해야 함(공유 DB 오발송 방지)`);
}

/**
 * ClassNote 발송 큐 한 주기 처리 — stale 복구 → 원자 클레임 → 건별 스크린샷·게시·상태전이.
 * browser는 호출자가 관리(데몬은 루프 밖 1회 launch 재사용, one-shot은 매 실행 launch). tenant 격리 필수.
 * @returns {Promise<{stale:number, claimed:number, success:number, failed:number, requeued:number}>}
 */
export async function processQueueOnce(sql, browser, opts) {
  const {
    tenant,
    post = false,
    base = DEFAULT_BASE,
    shareBase = DEFAULT_SHARE_BASE,
    log = console.log,
  } = opts;
  const md = minDate();

  // 1) stale 복구: processing 10분 초과 → queued (tenant 격리)
  const stale = await sql`update lesson_reports set classnote_status='queued'
    where tenant_id = ${tenant} and classnote_status='processing'
      and classnote_processing_at < now() - (${STALE_MIN} || ' minutes')::interval
    returning id`;
  if (stale.length) log(`[worker] stale 복구 ${stale.length}건`);

  // 2) 원자 클레임: queued → processing (FOR UPDATE SKIP LOCKED, tenant 격리)
  const claimed = await sql`
    with cte as (
      select id from lesson_reports
      where tenant_id = ${tenant} and classnote_status='queued' and report_date >= ${md}
        and revoked_at is null
      order by classnote_queued_at nulls first limit ${BATCH}
      for update skip locked
    )
    update lesson_reports lr set classnote_status='processing', classnote_processing_at=now()
    from cte where lr.id=cte.id
    returning lr.id, lr.share_token, lr.report_date::text as report_date, lr.subject, lr.teacher_name, lr.student_id`;
  const summary = { stale: stale.length, claimed: claimed.length, success: 0, failed: 0, requeued: 0 };
  if (!claimed.length) return summary;
  log(`[worker] 클레임 ${claimed.length}건`);

  for (const r of claimed) {
    const [stu] = await sql`select name, classnote_name from students where id=${r.student_id} and tenant_id=${tenant}`;
    // ClassNote 보드명·원아 = 유효이름(classnote_name 오버라이드 || name). 동명이인은 오버라이드로 구분(0088a).
    const studentName = (stu?.classnote_name?.trim() || stu?.name || "").trim();
    // P0-3: 보드 라벨이 없는 과목(비수학·비영어·subject null)은 재시도 무의미한 결정적 실패 — 즉시 failed.
    if (!subjectLabel(r.subject)) {
      await sql`update lesson_reports set classnote_status='failed',
        classnote_error=${`지원하지 않는 발송 과목(${r.subject ?? "없음"}) — ClassNote 보드 매핑이 없어 발송 불가`}
        where id=${r.id}`;
      summary.failed++;
      log(`  · ${studentName}: 과목 ${r.subject ?? "없음"} — 보드 매핑 없음 → failed`);
      continue;
    }
    try {
      // 스크린샷 (INTERNAL_SECRET 헤더 → /r이 조회로그 skip)
      const ctx = await browser.newContext({
        viewport: { width: 800, height: 1200 },
        deviceScaleFactor: 2,
        ...(INTERNAL_SECRET ? { extraHTTPHeaders: { "x-eywa-internal": INTERNAL_SECRET } } : {}),
      });
      const page = await ctx.newPage();
      // waitUntil은 'domcontentloaded' — 'networkidle'은 /r이 로고 이미지를 Firebase 서명 URL로 불러오는데
      // 발송 PC 망에서 그 요청이 늘어지면 '네트워크 완전 정지'가 영영 안 떠 30초 타임아웃(실측 2026-07-10).
      // DOM 로드 후 fonts.ready + 700ms 정착으로 렌더 완성도는 확보되므로 취약한 networkidle 의존을 뺀다.
      await page.goto(`${base}/r/${r.share_token}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      // 로고·학생사진 등 이미지가 스크린샷에 담기도록 로드 대기(최대 8초, 실패해도 진행 — 캡처는 계속).
      await page
        .waitForLoadState("load", { timeout: 8000 })
        .catch(() => {});
      await new Promise((x) => setTimeout(x, 700));
      const card = page.locator(".report-capture").first(); // ParentReportCard 루트(공유 컴포넌트) — 폭 유틸과 분리된 안정 마커
      const buf = (await card.count())
        ? await card.screenshot({ type: "jpeg", quality: 90 })
        : await page.screenshot({ type: "jpeg", quality: 90, fullPage: true });
      await ctx.close();
      const imageBase64 = `data:image/jpeg;base64,${buf.toString("base64")}`;
      const className = boardClassName(r.subject, studentName); // 학생모드 보드 `(과목)학생명`
      const payload = {
        loginId: process.env.CLASSNOTE_UPLOAD_ID,
        loginPw: process.env.CLASSNOTE_UPLOAD_PW,
        reports: [{
          reportId: r.id, studentName, className, teacherName: className,
          reportDate: `${r.report_date}T12:00:00`, imageBase64, isExactMatchNeeded: true,
          shareUrl: `${shareBase}/r/${r.share_token}`,
        }],
      };
      log(`  · ${studentName} (${r.subject ?? "-"}) 보드="${className}" img=${buf.length}B`);

      if (!post) {
        // dry-run: 게시 안 하고 다시 queued로 반환(재처리 가능하게)
        await sql`update lesson_reports set classnote_status='queued' where id=${r.id}`;
        summary.requeued++;
        continue;
      }
      // 게시 직전 취소(revoke) 재확인 — claim~여기 사이에 강사가 취소했을 수 있음(死링크 게시 방지).
      const [fresh] = await sql`select revoked_at from lesson_reports where id=${r.id}`;
      if (fresh?.revoked_at) {
        await sql`update lesson_reports set classnote_status='queued' where id=${r.id}`;
        summary.requeued++;
        log(`  · ${studentName}: 취소됨 → 게시 skip`);
        continue;
      }
      // 실게시
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), 120000);
      const res = await fetch(CLOUD_RUN, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ac.signal });
      clearTimeout(to);
      const json = await res.json().catch(() => ({}));
      const ok = json?.success && json?.results?.[0]?.success;
      if (ok) {
        await sql`update lesson_reports set classnote_status='success', classnote_sent_at=now(), classnote_error=null where id=${r.id}`;
        summary.success++;
        log(`    → success`);
      } else {
        const msg = json?.results?.[0]?.message || json?.message || `HTTP ${res.status}`;
        await sql`update lesson_reports set
          classnote_retry_count = classnote_retry_count + 1,
          classnote_status = case when classnote_retry_count + 1 >= 3 then 'failed' else 'queued' end,
          classnote_error = ${msg}
          where id=${r.id}`;
        summary.failed++;
        log(`    → 실패: ${msg} (재시도 카운트+1)`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await sql`update lesson_reports set
        classnote_retry_count = classnote_retry_count + 1,
        classnote_status = case when classnote_retry_count + 1 >= 3 then 'failed' else 'queued' end,
        classnote_error = ${msg}
        where id=${r.id}`;
      summary.failed++;
      log(`  · ${studentName}: 처리 오류 → ${msg}`);
    }
  }
  return summary;
}

/** Playwright chromium 실행 헬퍼(코어와 데몬 공용 — 옵션 통일). */
export function launchBrowser() {
  return chromium.launch({ headless: true });
}
