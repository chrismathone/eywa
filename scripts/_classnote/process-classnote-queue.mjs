// ClassNote 발송 큐 처리기 (P3, one-shot). 처리 로직은 classnote-core.mjs와 공용(데몬과 동일 코어).
// 사용: node --env-file=.env.local scripts/_classnote/process-classnote-queue.mjs [--post]
//   기본 dry-run: queued 행을 잡아 /r 스크린샷까지만. **실게시 안 함**(처리 후 다시 queued로 반환).
//   --post: 워커 내장 경로로 실제 ClassNote 게시 + 상태 갱신(2026-07-29 Cloud Run 분기 제거).
// env: DATABASE_URL, CLASSNOTE_TENANT_ID(테넌트 2개+면 필수), CLASSNOTE_UPLOAD_ID/PW(--post 시), CLASSNOTE_SCREENSHOT_BASE(기본 http://localhost:3113).
//
// 무한 폴링·heartbeat·작업스케줄러 상주는 watch-classnote-queue.mjs(데몬). 여기선 1회 처리.
import postgres from "postgres";
import { DEFAULT_BASE, launchBrowser, minDate, processQueueOnce, resolveTenant } from "./classnote-core.mjs";

const POST = process.argv.includes("--post");

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL 없음"); process.exit(1); }
  if (POST && (!process.env.CLASSNOTE_UPLOAD_ID || !process.env.CLASSNOTE_UPLOAD_PW)) {
    console.error("--post엔 CLASSNOTE_UPLOAD_ID/PW env 필요"); process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const tenant = await resolveTenant(sql);
  console.log(`[worker] mode=${POST ? "POST(실게시)" : "DRY-RUN"} tenant=${tenant} base=${DEFAULT_BASE} minDate=${minDate()}`);

  const browser = await launchBrowser();
  try {
    const s = await processQueueOnce(sql, browser, { tenant, post: POST });
    console.log(`[worker] 완료 — 클레임 ${s.claimed} / 성공 ${s.success} / 실패 ${s.failed} / 재큐 ${s.requeued} / stale복구 ${s.stale}`);
  } finally {
    await browser.close();
    await sql.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
