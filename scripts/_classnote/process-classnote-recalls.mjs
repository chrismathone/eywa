/**
 * scripts/_classnote/process-classnote-recalls.mjs — 수업보고서 회수 큐 1회 처리(원샷).
 *
 * 상주 데몬(watch-classnote-queue.mjs)이 매 폴 같은 코어를 부르므로 평소엔 필요 없다.
 * **급히 한 건을 지금 회수해야 할 때** 연동 PC에서 직접 돌린다(데몬 폴을 기다리지 않음).
 *
 * 실행(연동 PC): node --env-file=.env.local scripts/_classnote/process-classnote-recalls.mjs --post
 *   기본은 dry-run(대기 건수만 보고) — 실삭제는 `--post` 필요.
 *   ⚠️ 발송 킬스위치(classnoteSendEnabled)와 무관하게 동작한다(회수는 사고 수습이라 의도적).
 */
import postgres from "postgres";
import { launchBrowser, resolveTenant } from "./classnote-core.mjs";
import { processRecallsOnce } from "./classnote-recall-core.mjs";

const POST = process.argv.includes("--post");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const browser = await launchBrowser();
try {
  const tenant = await resolveTenant(sql);
  console.log(`수업보고서 회수 1회 처리 — mode=${POST ? "POST(실삭제)" : "dry-run"} tenant=${tenant}`);
  const res = await processRecallsOnce(sql, browser, { tenant, post: POST });
  console.log("결과:", JSON.stringify(res));
} finally {
  await browser.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
