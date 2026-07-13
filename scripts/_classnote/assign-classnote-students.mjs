/**
 * scripts/_classnote/assign-classnote-students.mjs — 학생↔개별 보드 배정 전수조사 + (--apply) 배정.
 *
 * ClassNote 제약: 학생 엔티티는 **학부모가 가입·승인해야** 생긴다("회원가입 후 반배정 필요") — 그래서
 * 보드(provision-classnote-boards.mjs)는 미리 만들어도, 배정은 가입 후에만 가능.
 *
 * 판독·배정 모두 내부 API(2026-07-13 확정 — DOM 모달 자동화는 오탐·React 상태 미반영으로 폐기):
 * - 판독: `centers/{id}/classes`(보드별 approved_children) + `children`(가입 원아) → 전수 판정
 *   assigned(자기 보드 1명+) / ready(가입했는데 자기 보드 0명) / not_signed_up(학부모 초대 필요) /
 *   board_missing(provision 먼저) / ambiguous(동명이인 원아 — 생일로 수동 대조).
 * - 배정(--apply): `POST /api/v1/enrollments/ {child, belong_to_class}` — **원아 ID 기반**이라 동명이인
 *   안전(이름 매칭이 유일 후보일 때만 자동, 2명+이면 ambiguous로 보류). 사후 재조회 검증 포함.
 *
 * 실행(기본 dry-run — 조회·판정만, 아무것도 변경하지 않음):
 *   node --env-file=.env.local scripts/_classnote/assign-classnote-students.mjs [--subject=math|english|all] [--student=이름]
 * 실제 배정(ready 대상만):
 *   node --env-file=.env.local scripts/_classnote/assign-classnote-students.mjs --apply [--limit=N]
 * ⚠️ 배정은 실 ClassNote 변경(학부모 앱에 반 배정 알림 가능) — 원장 승인 후. 해제(제거)는 API 405라 UI에서만.
 */
import postgres from "postgres";
import { resolveTenant } from "./classnote-core.mjs";
import {
  BOARD_GROUPS,
  launchAdminBrowser,
  loginClassnote,
  fetchCenterId,
  fetchBoards,
  fetchChildren,
  fetchChildDetail,
  fetchBoardChildren,
  enrollChild,
  planChildMatches,
  hasForeignStudentBoard,
  norm,
} from "./classnote-admin-core.mjs";
import { fetchUniverseNames } from "./classnote-provision-core.mjs";

const APPLY = process.argv.includes("--apply");
const HEADED = process.argv.includes("--headed");
const subjectArg = (process.argv.find((a) => a.startsWith("--subject=")) || "--subject=math").slice(10);
const studentArg = process.argv.find((a) => a.startsWith("--student="))?.slice(10)?.trim() || null;
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Math.max(0, Number(limitArg.slice(8)) || 0) : Infinity;

const groups =
  subjectArg === "all" ? Object.values(BOARD_GROUPS) : [BOARD_GROUPS[subjectArg]].filter(Boolean);
if (!groups.length) {
  console.error(`--subject=${subjectArg} 인식 불가 (math|english|all)`);
  process.exit(1);
}

/** 그룹별 타깃 — 유효이름 norm 그룹핑으로 동명이인은 제외(collisions 별도 반환, 적대 감사 F4:
 *  같은 이름 2명이 같은 board 문자열 타깃 2건으로 들어가 한 가족이 공유 보드에 배정되는 것 차단). */
async function targetsOf(sql, tenant, group) {
  const rows = await sql`
    select distinct s.id, s.name, s.classnote_name
    from students s
    join enrollments e on e.student_id = s.id and e.end_date is null and e.tenant_id = ${tenant}
    join classes c on c.id = e.class_id and c.tenant_id = ${tenant}
    where s.tenant_id = ${tenant}
      and s.status = 'enrolled'
      and c.subject in ${sql(group.subjectKeys)}`;
  const byName = new Map();
  for (const r of rows) {
    const eff = (r.classnote_name || r.name || "").trim();
    if (!eff) continue;
    const key = norm(eff);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(eff);
  }
  const targets = [];
  const collisions = [];
  for (const [, effs] of byName) {
    if (effs.length > 1) collisions.push({ name: effs[0], count: effs.length });
    else targets.push({ studentName: effs[0], board: `${group.prefix}${effs[0]}`, subject: group.label });
  }
  return { targets, collisions };
}

/** 판정 — 배정/배정가능/미가입/보드없음/모호. 매칭은 planChildMatches(양방향 유일성 — 정방향 동명 원아
 *  + 역방향(원아 1명↔접미사 다른 학생 2+) 모두 보류. 전체 타깃 기준이어야 완전해서 밖에서 1회 계산해 주입. */
function judge(t, boardByNorm, plan) {
  const board = boardByNorm.get(norm(t.board));
  if (!board) return { status: "board_missing" };
  if (board.children >= 1) return { status: "assigned" };
  const heldReason = plan.heldByBoard.get(t.board);
  if (heldReason) return { status: "ambiguous", note: heldReason };
  const child = plan.matches.get(t.board);
  if (!child) return { status: "not_signed_up" };
  return { status: "ready", child, boardId: board.id };
}

(async () => {
  console.log(`--- ClassNote 학생↔개별반 배정 (${APPLY ? "⚠️ APPLY" : "dry-run 전수조사"} · ${groups.map((g) => g.label).join("/")}) ---`);
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const tenant = await resolveTenant(sql);

  const allTargets = [];
  for (const g of groups) {
    const { targets: ts, collisions } = await targetsOf(sql, tenant, g);
    allTargets.push(...ts);
    for (const c of collisions)
      console.log(`⚠️ [${g.label}] 동명이인 "${c.name}" ${c.count}명 — classnote_name 접미사 지정 전까지 제외`);
  }
  // 역방향 유일성 우주 = 전 학생(퇴원·타과목 포함) — --subject/--student 필터와 무관하게 항상 전수.
  const universeNames = await fetchUniverseNames(sql, tenant);
  await sql.end({ timeout: 5 });
  // ⚠️ --student 필터는 표시·실행 범위만 좁힌다 — 매칭 계획(역방향 유일성)은 반드시 전체 타깃 기준.
  let targets = allTargets;
  if (studentArg) {
    const exact = allTargets.filter((t) => t.studentName === studentArg);
    targets = exact.length ? exact : allTargets.filter((t) => t.studentName.includes(studentArg));
  }
  console.log(`대상 ${targets.length}건${studentArg ? ` (필터: ${studentArg})` : ""}`);
  if (!targets.length) return;

  const browser = await launchAdminBrowser({ headed: HEADED });
  const page = await browser.newPage();
  try {
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    console.log(`전수 조회 중(API, center ${centerId})…`);
    const boards = await fetchBoards(page, centerId);
    const boardByNorm = new Map(boards.map((b) => [norm(b.name), b]));
    const children = await fetchChildren(page, centerId);
    console.log(`보드 ${boards.length}개 · 가입 원아 ${children.length}명 수집`);

    // 매칭 계획 1회 — 우주=전 학생(universeNames), 타깃=전 그룹(allTargets). 필터는 표시·실행만 좁힘.
    const { matches, held } = planChildMatches(
      allTargets.map((t) => ({ student: t.studentName, board: t.board })),
      children,
      universeNames,
    );
    const plan = { matches, heldByBoard: new Map(held.map((h) => [h.board, h.reason])) };

    const detail = targets.map((t) => ({ ...t, ...judge(t, boardByNorm, plan) }));
    const stats = {};
    for (const d of detail) stats[d.status] = (stats[d.status] ?? 0) + 1;

    console.log("\n=== 판정 ===");
    for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
    const show = (label, arr, fmt) => {
      if (!arr.length) return;
      console.log(`\n${label} ${arr.length}건:`);
      for (const d of arr) console.log(`  - ${fmt(d)}`);
    };
    show("🏫 보드 없음(provision 먼저)", detail.filter((d) => d.status === "board_missing"), (d) => d.board);
    show("⚠️ 동명이인 원아(생일 대조 후 수동)", detail.filter((d) => d.status === "ambiguous"), (d) => `${d.board} ← 후보: ${d.note}`);
    show("✅ 배정 가능(가입 완료·보드 비어있음)", detail.filter((d) => d.status === "ready"), (d) => `${d.studentName}(원아 ${d.child.id}·${d.child.birth ?? "?"}) → ${d.board}`);
    show("📨 학부모 초대 필요(미가입)", detail.filter((d) => d.status === "not_signed_up"), (d) => `${d.studentName} (${d.subject})`);

    if (!APPLY) {
      console.log("\n(dry-run) 아무것도 변경하지 않았습니다. 배정 실행은 --apply (ready 대상만).");
      return;
    }

    const ready = detail.filter((d) => d.status === "ready").slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
    console.log(`\n--apply: ready ${ready.length}건 배정 시작(POST /api/v1/enrollments/)`);
    let ok = 0;
    let fail = 0;
    for (const [i, t] of ready.entries()) {
      // 멱등 + 잔존 가족 가드(원아가 다른 학생 개인 보드 소속이면 보류) + POST 직전 보드 실시간 재확인.
      const before = await fetchChildDetail(page, t.child.id);
      if ((before.enrollment ?? []).some((e) => e.belong_to_class === t.boardId && !e.removed_child)) {
        console.log(`  [${i + 1}/${ready.length}] ${t.board} → 이미 배정됨(건너뜀)`);
        continue;
      }
      if (hasForeignStudentBoard(before.enrollment, t.studentName)) {
        console.log(`  [${i + 1}/${ready.length}] ${t.board} → ⚠️ 보류(원아가 다른 학생 개인 보드에 이미 소속)`);
        continue;
      }
      const live = await fetchBoardChildren(page, centerId, t.boardId).catch(() => null);
      if (live === null || live.length > 0) {
        console.log(`  [${i + 1}/${ready.length}] ${t.board} → ⚠️ 중단(실행 중 보드에 다른 원아 합류)`);
        continue;
      }
      const res = await enrollChild(page, t.child.id, t.boardId);
      if (res.status >= 200 && res.status < 300) {
        const after = await fetchBoardChildren(page, centerId, t.boardId).catch(() => []);
        const extra = after.length > 1 ? ` ⚠️ 인원 ${after.length}명 — 수동 확인` : "";
        console.log(`  [${i + 1}/${ready.length}] ${t.board} → ✅ ${res.status} (보드 ${after.length}명)${extra}`);
        ok++;
      } else {
        console.log(`  [${i + 1}/${ready.length}] ${t.board} → ❌ ${res.status} ${res.body}`);
        fail++;
      }
      await page.waitForTimeout(400);
    }
    console.log(`\n=== 배정 완료: 성공 ${ok} · 실패 ${fail} ===`);
  } finally {
    await browser.close().catch(() => {});
  }
})();
