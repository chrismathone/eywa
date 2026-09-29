// scripts/_classnote/provision-math-class-boards.mjs — 수학 **반 보드** 생성 + 원아 추가 배정.
//
// 원장 2026-09-29: 수학 발송을 aywa 반과 **이름까지 똑같은** 반 보드로 옮긴다. 1인 보드 `(수학)이름`은
// 해제하지 않고 반 보드에 **추가 배정**한다. 반을 2~3개 다니면 모든 반에 따로. 특강 제외.
// 가드(원아 출처·전화·생년·역방향·같은 반 동명이인·이름 연속성) = class-board-plan.mjs(순수·Vitest).
//
// 🔴 발송은 하지 않는다 — 반 생성(DOM '반 추가하기')과 원아 배정(`POST /api/v1/enrollments/`)만.
// 🔴 기본 드라이런. `--apply`일 때만 쓴다. `--only="반 이름"`·`--limit=N`(반 수)으로 카나리.
// 🔴 되돌리기: 배정 해제·반 삭제는 REST가 막혀 있다(405) — ClassNote 화면에서 손으로. 그래서 한 반씩 검증하고
//    이상하면 **전체를 멈춘다**(다음 반으로 넘어가지 않는다).
// 🔴 보호자 전화 값은 출력·파일에 싣지 않는다.
//
// 실행: CLASSNOTE_TENANT_ID=… node --env-file=.env.local scripts/_classnote/provision-math-class-boards.mjs
//        [--apply] [--only="중등M 중3 BS3Q"] [--limit=1] [--json=계획.json]
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import {
  CLASSNOTE_BASE, createBoard, dismissHonorificDialog, enrollChild, fetchBoardChildren, fetchBoards,
  fetchCenterId, launchAdminBrowser, loginClassnote,
} from "./classnote-admin-core.mjs";
import { resolveTenant } from "./classnote-core.mjs";
import { summarizePlan } from "./class-board-plan.mjs";
import { loadAywa, loadPlan, personalBoardId } from "./math-class-boards-load.mjs";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const APPLY = process.argv.includes("--apply");
const ONLY = arg("only");
const LIMIT = arg("limit") ? Number(arg("limit")) : Infinity;
const jsonPath = arg("json");

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const tenant = await resolveTenant(sql);
const aywa = await loadAywa(sql, tenant);
await sql.end();

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const ids = (list) => new Set((list ?? []).map((m) => m.id));
const log = [];
class Stop extends Error {}

const browser = await launchAdminBrowser();
let exitCode = 0;
try {
  const page = await (await browser.newContext()).newPage();
  await loginClassnote(page);
  const centerId = await fetchCenterId(page);
  const { plans, boards, membersByBoard, failed, lookedUp } = await loadPlan(page, centerId, aywa);
  console.log(`센터 ${centerId} · 보드 ${boards.length}개 · 원아 조회 보드 ${lookedUp}개(실패 ${failed})`);

  const s = summarizePlan(plans);
  console.log(`\n[계획] 반 ${s.classes}개(생성 ${s.create} · 기존 ${s.exists} · 보류 ${s.blocked}) · 학생×반 배정 ${s.assignPairs} · 보류 ${s.holdPairs} · 원아 배정 ${s.enrollments}건(이미 ${s.already})`);
  for (const p of plans) for (const h of p.hold) console.log(`  ⛔ ${JSON.stringify(p.className)} ${h.name}: ${h.reasons.join(" / ")}`);
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary: s, plans }, null, 2));

  let targets = plans.filter((p) => p.board.action !== "block");
  if (ONLY) targets = targets.filter((p) => p.className === ONLY);
  targets = targets.slice(0, LIMIT);
  if (ONLY && !targets.length) throw new Stop(`--only 반을 찾지 못함: ${JSON.stringify(ONLY)}`);
  console.log(`\n이번 실행 대상 반 ${targets.length}개 · 모드=${APPLY ? "🔴 실행" : "드라이런"}`);
  for (const p of targets) {
    const todo = p.assign.flatMap((a) => a.children.filter((c) => !c.already));
    console.log(`  ${JSON.stringify(p.className)} [${p.board.action === "create" ? "생성" : `기존 #${p.board.id}`}] 배정 ${p.assign.length}명(원아 ${todo.length}건) · 보류 ${p.hold.length}`);
  }
  if (!APPLY) {
    console.log("\n드라이런 — ClassNote 변경 없음. 실행하려면 --apply");
  } else {
    // 이번 실행에서 건드린 1인 보드의 배정 전 원아 — 끝에 다시 읽어 **그대로인지** 확인한다.
    const personalBefore = new Map();
    for (const p of targets)
      for (const a of p.assign) {
        const pid = personalBoardId(boards, aywa.students.get(a.studentId).name);
        if (pid != null && !personalBefore.has(pid)) personalBefore.set(pid, ids(membersByBoard.get(pid)));
      }

    for (const p of targets) {
      const entry = { className: p.className, boardId: null, enrolled: [], held: p.hold.map((h) => ({ name: h.name, reasons: h.reasons })) };
      log.push(entry);
      console.log(`\n▶ ${JSON.stringify(p.className)}`);

      // 1) 반 보드 — 없으면 만든다. 이름은 aywa와 **글자까지 같게**(공백 포함) 생겼는지 확인.
      let boardId = p.board.id ?? null;
      if (p.board.action === "create") {
        const before = await fetchBoards(page, centerId);
        if (before.some((b) => b.name === p.className)) throw new Stop("그 사이 같은 이름 보드가 생겼다 — 중단(계획 다시)");
        await page.goto(`${CLASSNOTE_BASE}/service/setting/class`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2500);
        await dismissHonorificDialog(page);
        const res = await createBoard(page, p.className);
        const after = await fetchBoards(page, centerId);
        const added = after.filter((b) => !before.some((x) => x.id === b.id));
        if (!res.ok || added.length !== 1 || added[0].name !== p.className || after.length !== before.length + 1)
          throw new Stop(`반 생성 검증 실패 — ${res.reason ?? ""} · 새 보드 ${added.map((b) => JSON.stringify(b.name)).join(", ") || "없음"}`);
        boardId = added[0].id;
        console.log(`  반 생성 #${boardId}`);
      }
      entry.boardId = boardId;

      // 2) 배정 — 원아마다 직전에 1인 보드를 다시 읽어 계획과 같은지 확인(그 사이 바뀌었으면 중단).
      const want = new Set();
      for (const a of p.assign) {
        const pid = personalBoardId(boards, aywa.students.get(a.studentId).name);
        const live = ids(await fetchBoardChildren(page, centerId, pid));
        const planned = new Set(a.children.map((c) => c.id));
        if (!sameSet(live, planned)) throw new Stop(`${a.name}: 1인 보드 원아가 계획과 다르다(그 사이 변경) — 중단`);
        for (const c of a.children) {
          want.add(c.id);
          if (c.already) continue;
          const r = await enrollChild(page, c.id, boardId);
          if (r.status !== 201) throw new Stop(`${a.name}: 배정 실패 HTTP ${r.status} ${r.body}`);
          entry.enrolled.push({ name: a.name, childId: c.id });
          await page.waitForTimeout(300);
        }
      }

      // 3) 반 보드 원아 = 계획과 **정확히** 같아야 한다(더도 덜도 아니게).
      const members = await fetchBoardChildren(page, centerId, boardId);
      const got = ids(members);
      for (const m of membersByBoard.get(boardId) ?? []) want.add(m.id); // 원래 있던 원아(기존 반) — 계획 밖 원아는 계획표에 이미 경고로 나온다
      if (!sameSet(got, want)) throw new Stop(`반 보드 원아가 계획과 다르다 — 실제 ${members.map((m) => m.name).join(", ")}`);
      console.log(`  배정 ${entry.enrolled.length}건 · 반 원아 ${members.length}명 확인 · 보류 ${p.hold.length}명`);
    }

    // 4) 1인 보드가 그대로인지(추가 배정만 했으니 한 명도 늘거나 줄면 안 된다)
    for (const [pid, before] of personalBefore) {
      const now = ids(await fetchBoardChildren(page, centerId, pid));
      if (!sameSet(now, before)) throw new Stop(`1인 보드 #${pid} 원아가 바뀌었다 — 확인 필요`);
    }
    console.log(`\n✅ 완료 — 반 ${log.length}개 · 원아 배정 ${log.reduce((n, e) => n + e.enrolled.length, 0)}건 · 1인 보드 ${personalBefore.size}개 그대로`);
  }
} catch (e) {
  exitCode = 1;
  console.error(`\n⛔ 중단: ${e instanceof Stop ? e.message : e?.stack ?? e}`);
} finally {
  await browser.close();
  if (APPLY && log.length) {
    const out = join(process.env.CLASSNOTE_OUT || tmpdir(), `math-class-boards-${Date.now()}.json`);
    writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), log }, null, 2));
    console.log(`실행 기록: ${out}`);
  }
}
process.exit(exitCode);
