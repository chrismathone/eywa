/**
 * scripts/_classnote/process-classnote-notices.mjs — 반 공지 큐 1회 처리(원샷).
 * 상주는 watch-classnote-queue.mjs(연동 PC)가 담당 — 이 스크립트는 수동 점검·로컬 검증용.
 *
 * 실행: node --env-file=.env.local scripts/_classnote/process-classnote-notices.mjs [--post]
 *   기본 dry-run(대기 건수만 보고). 실게시는 --post + 학원설정 classnoteSendEnabled ON 둘 다 필요.
 */
import postgres from "postgres";
import { launchBrowser, resolveTenant } from "./classnote-core.mjs";
import { processNoticesOnce } from "./classnote-notice-core.mjs";

const POST = process.argv.includes("--post");
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const browser = await launchBrowser();
try {
  const tenant = await resolveTenant(sql);
  console.log(`반 공지 큐 1회 처리 — mode=${POST ? "POST(실게시)" : "dry-run"} tenant=${tenant}`);
  const res = await processNoticesOnce(sql, browser, { tenant, post: POST });
  console.log("결과:", JSON.stringify(res));
} finally {
  await browser.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
