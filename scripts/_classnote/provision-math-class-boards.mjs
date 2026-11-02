// scripts/_classnote/provision-math-class-boards.mjs — 수학 **반 보드** 생성·이름 변경·원아 추가 배정(수동 실행판).
//
// 원장 2026-09-29: 수학 발송을 aywa 반과 **이름까지 똑같은** 반 보드로 옮긴다. 1인 보드 `(수학)이름`은
// 해제하지 않고 반 보드에 **추가 배정**한다. 반을 2~3개 다니면 모든 반에 따로. 종강 제외(특강은 포함 — 2026-09-30).
// 가드(원아 출처·전화·생년·역방향·같은 반 동명이인·이름 연속성) = class-board-plan.mjs(순수·Vitest).
// 실행 코드는 매일 동기화(math-class-boards-sync.mjs)와 **같은** math-class-boards-apply.mjs를 쓴다.
//
// 🔴 발송은 하지 않는다. 🔴 기본 드라이런 — `--apply`일 때만 쓴다. `--only="반 이름"`·`--limit=N`(반 수)으로 카나리.
// 🔴 되돌리기: 배정 해제·반 삭제(원아·선생님이 있으면)는 REST가 막혀 있다 — ClassNote 화면에서 손으로.
// 🔴 보호자 전화 값은 출력·파일에 싣지 않는다.
//
// 실행: CLASSNOTE_TENANT_ID=… node --env-file=.env.local scripts/_classnote/provision-math-class-boards.mjs
//        [--apply] [--only="중등M 중3 BS3Q"] [--limit=1] [--json=계획.json] [--sync-db]
// --sync-db: 끝에서 계획을 **다시 읽어** 0302a 표에 적는다(C.N 라벨·발송 워커의 단일 소스). 드라이런에서도 동작한다.
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { fetchCenterId, launchAdminBrowser, loginClassnote } from "./classnote-admin-core.mjs";
import { resolveTenant } from "./classnote-core.mjs";
import { closedClassesToKeep, summarizePlan } from "./class-board-plan.mjs";
import { loadAywa, loadClosedLinked, loadLinkedBoards, loadPlan, loadVerifiedChildren } from "./math-class-boards-load.mjs";
import { applyClassBoardPlans, ClassBoardStop } from "./math-class-boards-apply.mjs";
import { writeClassBoardSnapshot } from "./math-class-boards-db.mjs";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const APPLY = process.argv.includes("--apply");
const ONLY = arg("only");
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const jsonPath = arg("json");
const SYNC_DB = process.argv.includes("--sync-db");

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const tenant = await resolveTenant(sql);
const aywa = await loadAywa(sql, tenant);

const browser = await launchAdminBrowser();
let exitCode = 0;
try {
  const page = await (await browser.newContext()).newPage();
  await loginClassnote(page);
  const centerId = await fetchCenterId(page);
  // strict(개명 감사 G9) — 조회 실패를 빈 지도로 삼키면 이름으로 후퇴해 개명한 반을 새로 만든다.
  const linkedBoardByClass = await loadLinkedBoards(sql, tenant, { strict: true });
  // 1인 보드가 없거나 빈 학생의 원아 출처 — 매일 동기화와 같은 판정(원장 2026-11-02, class-board-plan.mjs ①).
  const verifiedChildren = await loadVerifiedChildren(sql, tenant);
  if (!verifiedChildren) throw new ClassBoardStop("반 보드 확인 기록을 읽지 못했다 — 중단(그대로 계획하면 1인 보드가 빈 학생이 전부 보류로 기록된다)");
  const { plans, boards, membersByBoard, failed, lookedUp } = await loadPlan(page, centerId, aywa, { linkedBoardByClass, verifiedChildren });
  console.log(`센터 ${centerId} · 보드 ${boards.length}개 · 원아 조회 보드 ${lookedUp}개(실패 ${failed}) · 연결표 ${linkedBoardByClass.size}개 반`);

  const s = summarizePlan(plans);
  console.log(`\n[계획] 반 ${s.classes}개(생성 ${s.create} · 기존 ${s.exists} · 보류 ${s.blocked}) · 학생×반 배정 ${s.assignPairs} · 보류 ${s.holdPairs} · 원아 배정 ${s.enrollments}건(이미 ${s.already})`);
  for (const p of plans) {
    if (p.board.action === "block") console.log(`  ⛔ ${JSON.stringify(p.className)}: ${p.board.reason}`);
    if (p.board.rename) console.log(`  ✎ 이름 변경 ${JSON.stringify(p.board.rename.from)} → ${JSON.stringify(p.className)}`);
    if (p.board.renameBlocked) console.log(`  ⚠️ ${JSON.stringify(p.className)}: ${p.board.renameBlocked}`);
    for (const h of p.hold) console.log(`  ⛔ ${JSON.stringify(p.className)} ${h.name}: ${h.reasons.join(" / ")}`);
    if (p.extras.length) console.log(`  ⚠️ ${JSON.stringify(p.className)} 해제 필요(계획 밖 원아): ${p.extras.join(", ")}`);
  }
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary: s, plans }, null, 2));

  let targets = plans.filter((p) => p.board.action !== "block");
  if (ONLY) targets = targets.filter((p) => p.className === ONLY);
  targets = targets.slice(0, LIMIT);
  if (ONLY && !targets.length) throw new ClassBoardStop(`--only 반을 찾지 못함: ${JSON.stringify(ONLY)}`);
  console.log(`\n이번 실행 대상 반 ${targets.length}개 · 모드=${APPLY ? "🔴 실행" : "드라이런"}`);
  let done = [];
  if (!APPLY) {
    console.log("드라이런 — ClassNote 변경 없음. 실행하려면 --apply");
  } else {
    done = await applyClassBoardPlans({ page, centerId, targets, boards, membersByBoard, students: aywa.students, log: console.log });
    console.log(
      `\n✅ 완료 — 반 ${done.length}개 · 생성 ${done.filter((d) => d.created).length} · 이름 변경 ${done.filter((d) => d.renamed).length} · 원아 배정 ${done.reduce((n, d) => n + d.enrolled.length, 0)}건 · 1인 보드 그대로`,
    );
  }
  if (SYNC_DB) {
    // 실행으로 보드·원아가 바뀌었을 수 있으니 **다시 읽은 계획**으로 적는다(ok = ClassNote에서 확인된 배정만).
    // 방금 만든 보드는 번호로 얹는다(이름이 달라도 연결 — 매일 동기화와 같은 규약, G8).
    const linkedAfter = await loadLinkedBoards(sql, tenant, { strict: true });
    for (const d of done) if (d.created && d.boardId != null) linkedAfter.set(d.classId, Number(d.boardId));
    const fresh = await loadPlan(page, centerId, aywa, { linkedBoardByClass: linkedAfter, verifiedChildren });
    if (fresh.failed) throw new ClassBoardStop(`원아 조회 실패 ${fresh.failed}건 — DB 기록을 건너뛴다(불완전한 판정으로 초록불을 켜지 않는다)`);
    // 종강 반 연결 — ClassNote 보드가 살아 있으면 지킨다(원장 2026-09-30, 매일 동기화와 같은 판정).
    const keepClassIds = closedClassesToKeep({
      closedIds: await loadClosedLinked(sql, tenant),
      planClassIds: fresh.plans.map((p) => p.classId),
      // strict — 조회 실패를 빈 목록으로 삼키면 종강 반 연결이 전부 지워진다(throw = 기록을 건너뛴다).
      linkedBoardByClass: await loadLinkedBoards(sql, tenant, { strict: true }),
      liveBoardIds: fresh.boards.map((b) => Number(b.id)),
    });
    const w = await writeClassBoardSnapshot(sql, tenant, fresh.plans, { keepClassIds });
    console.log(`\n[DB 기록] 반 ${w.classes}개 · 확인된 배정 ${w.ok} · 보류 ${w.hold} · 지운 옛 행 ${w.cleared}`);
  }
} catch (e) {
  exitCode = 1;
  console.error(`\n⛔ 중단: ${e instanceof ClassBoardStop ? e.message : e?.stack ?? e}`);
} finally {
  await browser.close();
  await sql.end();
}
process.exit(exitCode);
