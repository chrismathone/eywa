/**
 * scripts/_classnote/process-parent-posts.mjs — 학부모 새 글 감지 1회 실행(점검·복구용).
 *
 * 상주 데몬(watch-classnote-queue.mjs)이 --post로 매 폴 자동 실행하므로 평소엔 필요 없다.
 * 이 스크립트는 ① 배선 점검 ② 데몬이 죽어 있을 때 수동 1회 ③ 매핑 확인용.
 *
 * 실행:
 *   node --env-file=.env.local scripts/_classnote/process-parent-posts.mjs            # 점검(기본) — insert도 워터마크 전진도 안 함
 *   node --env-file=.env.local scripts/_classnote/process-parent-posts.mjs --apply    # 실제 알림 insert + 워터마크 전진
 *
 * ⚠️ **읽기 전용 기능**이다 — ClassNote에는 어떤 경우에도 쓰지 않는다(학부모에게 나가는 경로 없음).
 * --apply가 건드리는 것은 eywa DB의 notifications(강사 벨) + classnote_feed_state(워터마크)뿐.
 */
import postgres from "postgres";
import { launchBrowser, resolveTenant } from "./classnote-core.mjs";
import { pollParentPostsOnce } from "./classnote-feed-core.mjs";

const APPLY = process.argv.includes("--apply");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 없음");
  if (!process.env.CLASSNOTE_UPLOAD_ID || !process.env.CLASSNOTE_UPLOAD_PW) {
    throw new Error("CLASSNOTE_UPLOAD_ID / CLASSNOTE_UPLOAD_PW env가 필요합니다(피드 조회에도 로그인 필요)");
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const browser = await launchBrowser();
  try {
    const tenant = await resolveTenant(sql);
    console.log(`tenant=${tenant} · mode=${APPLY ? "APPLY(알림 생성)" : "점검(변경 없음)"}`);
    const res = await pollParentPostsOnce(sql, browser, {
      tenant,
      post: true,
      force: true, // 1분 가드 무시(수동 실행)
      dryRun: !APPLY,
      log: console.log,
    });
    console.log("\n결과:", JSON.stringify({ ...res, plan: undefined }, null, 1));
    if (res.plan?.length) {
      console.log("\n=== 알림 예정 ===");
      for (const p of res.plan) console.log(` → 강사 ${p.recipient_id} | ${p.title} | ${p.body}`);
    }
  } finally {
    await browser.close().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
