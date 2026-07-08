// ClassNote 발송 큐 처리기 (P3 Stage 3, one-shot).
// 사용: node --env-file=.env.local scripts/_classnote/process-classnote-queue.mjs [--post]
//   기본 dry-run: queued 행을 잡아 /r 스크린샷 + Cloud Run payload 조립까지. **실게시 안 함**(처리 후 다시 queued로 반환).
//   --post: 기존 Firebase 함수(submitToClassNoteV2)로 실제 POST → 실 ClassNote 게시 + 상태 갱신.
// env: DATABASE_URL, CLASSNOTE_UPLOAD_ID/PW(--post 시), CLASSNOTE_SCREENSHOT_BASE(기본 http://localhost:3113).
//
// 무한 폴링·heartbeat·작업스케줄러 상주는 Stage 4(makeedu watch-sync-requests 패턴 재사용). 여기선 1회 처리.
import postgres from "postgres";
import { chromium } from "@playwright/test";

const CLOUD_RUN = "https://submittoclassnotev2-q4dmdhnkvq-uc.a.run.app";
const BASE = process.env.CLASSNOTE_SCREENSHOT_BASE || "http://localhost:3113";
const BATCH = 2;
const STALE_MIN = 10;
const POST = process.argv.includes("--post");

/** too_old 최소날짜 = 오늘(로컬) 기준 전 달 1일. 워커도 belt-and-suspenders 가드. */
function minDate() {
  const d = new Date();
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const m = d.getMonth() === 0 ? 12 : d.getMonth(); // getMonth()=0-based → 전 달 = 그대로(1-based로 -1)
  return `${y}-${String(m).padStart(2, "0")}-01`;
}
/** subject(subjectKey) → ClassNote 과목 라벨. injaewon ClassNote는 학생모드 보드 `(과목)학생명` 사용(실게시 검증됨). */
function subjectLabel(subject) {
  if (subject === "english") return "영어";
  return "수학"; // math·subject_1(고등수학) → 수학. ⚠️ 영어/기타 보드 관례는 실게시로 추가 확인 필요.
}
/** ClassNote 보드 target(className) = 학생모드 `(과목)학생명`. 함수가 이 prefix로 학생모드 판정. */
function boardClassName(subject, studentName) {
  return `(${subjectLabel(subject)})${studentName}`;
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL 없음"); process.exit(1); }
  if (POST && (!process.env.CLASSNOTE_UPLOAD_ID || !process.env.CLASSNOTE_UPLOAD_PW)) {
    console.error("--post엔 CLASSNOTE_UPLOAD_ID/PW env 필요"); process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const md = minDate();
  console.log(`[worker] mode=${POST ? "POST(실게시)" : "DRY-RUN"} base=${BASE} minDate=${md}`);

  // 1) stale 복구: processing 10분 초과 → queued
  const stale = await sql`update lesson_reports set classnote_status='queued'
    where classnote_status='processing' and classnote_processing_at < now() - (${STALE_MIN} || ' minutes')::interval
    returning id`;
  if (stale.length) console.log(`[worker] stale 복구 ${stale.length}건`);

  // 2) 원자 클레임: queued → processing (FOR UPDATE SKIP LOCKED)
  const claimed = await sql`
    with cte as (
      select id from lesson_reports
      where classnote_status='queued' and report_date >= ${md}
      order by classnote_queued_at nulls first limit ${BATCH}
      for update skip locked
    )
    update lesson_reports lr set classnote_status='processing', classnote_processing_at=now()
    from cte where lr.id=cte.id
    returning lr.id, lr.share_token, lr.report_date::text as report_date, lr.subject, lr.teacher_name, lr.student_id`;
  console.log(`[worker] 클레임 ${claimed.length}건`);
  if (!claimed.length) { await sql.end(); return; }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const r of claimed) {
      const [stu] = await sql`select name from students where id=${r.student_id}`;
      const studentName = stu?.name ?? "";
      try {
        // 스크린샷
        const ctx = await browser.newContext({ viewport: { width: 800, height: 1200 }, deviceScaleFactor: 2 });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/r/${r.share_token}`, { waitUntil: "networkidle", timeout: 30000 });
        await page.evaluate(() => document.fonts?.ready).catch(() => {});
        await new Promise((x) => setTimeout(x, 700));
        const card = page.locator(".max-w-md").first();
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
            reportDate: `${r.report_date}T12:00:00`, imageBase64, isExactMatchNeeded: true, shareUrl: "",
          }],
        };
        console.log(`  · ${studentName} (${r.subject ?? "-"}) 보드="${className}" img=${buf.length}B`);

        if (!POST) {
          // dry-run: 게시 안 하고 다시 queued로 반환(재처리 가능하게)
          await sql`update lesson_reports set classnote_status='queued' where id=${r.id}`;
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
          console.log(`    → success`);
        } else {
          const msg = json?.results?.[0]?.message || json?.message || `HTTP ${res.status}`;
          await sql`update lesson_reports set
            classnote_retry_count = classnote_retry_count + 1,
            classnote_status = case when classnote_retry_count + 1 >= 3 then 'failed' else 'queued' end,
            classnote_error = ${msg}
            where id=${r.id}`;
          console.log(`    → 실패: ${msg} (재시도 카운트+1)`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await sql`update lesson_reports set
          classnote_retry_count = classnote_retry_count + 1,
          classnote_status = case when classnote_retry_count + 1 >= 3 then 'failed' else 'queued' end,
          classnote_error = ${msg}
          where id=${r.id}`;
        console.log(`  · ${studentName}: 처리 오류 → ${msg}`);
      }
    }
  } finally {
    await browser.close();
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
