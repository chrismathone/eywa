// scripts/_classnote/plan-class-board-release.mjs — 반 보드 동기화의 **계획만** 본다(ClassNote·DB 쓰기 0).
//
// 자동 해제(원장 2026-10-02)가 다음 동기화에서 **누구를 내보내고 누구를 보류할지**를 미리 출력한다 — 워커를 바꿨거나 반 구성이
// 크게 바뀐 날, 실제 동기화 전에 명단을 사람이 확인하는 용도다. 판정·조회는 매일 동기화와 같은 코드(`syncMathClassBoards` apply=false).
//
// 실행: CLASSNOTE_TENANT_ID=… node --env-file=.env.local scripts/_classnote/plan-class-board-release.mjs
import postgres from "postgres";
import { launchAdminBrowser, loginClassnote } from "./classnote-admin-core.mjs";
import { resolveTenant } from "./classnote-core.mjs";
import { syncMathClassBoards } from "./math-class-boards-sync.mjs";

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const browser = await launchAdminBrowser();
let exitCode = 0;
try {
  const tenant = await resolveTenant(sql);
  const page = await (await browser.newContext()).newPage();
  await loginClassnote(page);
  const r = await syncMathClassBoards(sql, page, { tenant, apply: false });
  const plan = r.releasePlan;
  if (!plan) console.log("자동 해제가 꺼져 있습니다(CLASSNOTE_BOARD_AUTO_RELEASE).");
  else {
    console.log(`\n원아 해제 예정 ${plan.children.releases.length}명`);
    for (const x of plan.children.releases) console.log(`  [${x.className}] ${x.childName} — ${x.reason}`);
    console.log(`원아 해제 보류 ${plan.children.held.length}건`);
    for (const x of plan.children.held) console.log(`  [${x.className}] ${x.text}`);
    console.log(`담임 해제 예정 ${plan.teachers.releases.length}건`);
    for (const x of plan.teachers.releases) console.log(`  [${x.className}] ${x.teacher}`);
    console.log(`담임 해제 보류 ${plan.teachers.held.length}건`);
    for (const x of plan.teachers.held) console.log(`  [${x.className}] ${x.text}`);
  }
  console.log("\n계획만 봤습니다 — ClassNote·DB 변경 없음.");
} catch (e) {
  exitCode = 1;
  console.error(`실패 — ${String(e?.message ?? e).slice(0, 300)}`);
} finally {
  await browser.close().catch(() => {});
  await sql.end({ timeout: 5 }).catch(() => {});
}
process.exit(exitCode);
