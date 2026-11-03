// scripts/_classnote/plan-class-board-release.mjs — 반 보드 동기화의 **계획만** 본다(ClassNote·DB 쓰기 0).
//
// 자동 해제(원장 2026-10-02)가 다음 동기화에서 **누구를 내보내고 누구를 보류할지**를 미리 출력한다 — 워커를 바꿨거나 반 구성이
// 크게 바뀐 날, 실제 동기화 전에 명단을 사람이 확인하는 용도다. 판정·조회는 매일 동기화와 같은 코드(`syncMathClassBoards` apply=false).
// 2026-11-03 — 넓힌 대상(영어 반 방·종강 반 보드·1인 보드)과 보고서 미발송(JJ) 반의 연결·배정 계획도 함께 출력한다.
//
// 실행: CLASSNOTE_TENANT_ID=… node --env-file=.env.local scripts/_classnote/plan-class-board-release.mjs [--json 파일]
import fs from "node:fs";
import postgres from "postgres";
import { launchAdminBrowser, loginClassnote } from "./classnote-admin-core.mjs";
import { resolveTenant } from "./classnote-core.mjs";
import { syncMathClassBoards } from "./math-class-boards-sync.mjs";

const jsonAt = process.argv.indexOf("--json");
const jsonOut = jsonAt > 0 ? process.argv[jsonAt + 1] : null;
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const browser = await launchAdminBrowser();
let exitCode = 0;
/** 계획의 반 이름 머리('영어 반 방 · …')로 종류를 가른다 — 머리가 없으면 반 보드. */
const kindOf = (className) => (/^(영어 반 방|종강 반 보드|1인 보드) · /.exec(className ?? "")?.[1] ?? "반 보드");
try {
  const tenant = await resolveTenant(sql);
  const page = await (await browser.newContext()).newPage();
  await loginClassnote(page);
  const r = await syncMathClassBoards(sql, page, { tenant, apply: false });
  // 보고서 미발송(JJ) 반 — 연결·배정 계획(오늘 다니는 학생이 있을 때만 새 보드를 만든다).
  const jj = (r.plans ?? []).filter((p) => p.reportOptout);
  console.log(`\n보고서 미발송(JJ) 반 ${jj.length}개`);
  for (const p of jj) {
    const add = p.assign.reduce((n, a) => n + a.children.filter((c) => !c.already).length, 0);
    const state = p.board.action === "exists" ? `연결${p.board.adoptedFormer ? `(지난 학생 ${p.board.adoptedFormer}명 남은 보드 채택)` : ""}` : p.board.action === "create" ? "새 보드 만들기(지금 다니는 학생이 있음)" : `보류 — ${p.board.reason}`;
    console.log(`  [${p.className}] ${state} · 배정 예정 ${add} · 학생 보류 ${p.hold.length} · 명단 밖 ${p.extras.length}`);
  }
  const plan = r.releasePlan;
  if (!plan) console.log("자동 해제가 꺼져 있습니다(CLASSNOTE_BOARD_AUTO_RELEASE).");
  else {
    const count = (list) => Object.entries(list.reduce((m, x) => ({ ...m, [kindOf(x.className)]: (m[kindOf(x.className)] ?? 0) + 1 }), {})).map(([k, n]) => `${k} ${n}`).join(" · ");
    console.log(`\n원아 해제 예정 ${plan.children.releases.length}명(${count(plan.children.releases) || "없음"})`);
    for (const x of plan.children.releases) console.log(`  [${x.className}] ${x.childName} — ${x.reason}`);
    console.log(`원아 해제 보류 ${plan.children.held.length}건(${count(plan.children.held) || "없음"})`);
    for (const x of plan.children.held) console.log(`  [${x.className}] ${x.text}`);
    console.log(`담임 해제 예정 ${plan.teachers.releases.length}건`);
    for (const x of plan.teachers.releases) console.log(`  [${x.className}] ${x.teacher}`);
    console.log(`담임 해제 보류 ${plan.teachers.held.length}건`);
    for (const x of plan.teachers.held) console.log(`  [${x.className}] ${x.text}`);
    console.log(`담임 연결 예정 ${(plan.teacherLinks ?? []).length}건`);
    for (const x of plan.teacherLinks ?? []) console.log(`  [${x.className}] ${x.teacher}`);
    for (const x of plan.notes ?? []) console.log(`  (안내) ${x.className ? `[${x.className}] ` : ""}${x.text}`);
  }
  if (jsonOut) {
    // 보호자 전화 값은 계획에 없다(사유는 일치 여부만) — 그대로 적는다.
    const slim = (r.plans ?? []).map((p) => ({ classId: p.classId, className: p.className, reportOptout: !!p.reportOptout, board: p.board, assign: p.assign, hold: p.hold, extras: p.extras }));
    fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), plans: slim, releasePlan: plan }, null, 2));
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
