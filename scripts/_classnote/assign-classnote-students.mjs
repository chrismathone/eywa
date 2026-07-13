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
  enrollChild,
  childKeys,
  norm,
} from "./classnote-admin-core.mjs";

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

async function targetsOf(sql, tenant, group) {
  const rows = await sql`
    select distinct s.id, s.name, s.classnote_name
    from students s
    join enrollments e on e.student_id = s.id and e.end_date is null and e.tenant_id = ${tenant}
    join classes c on c.id = e.class_id and c.tenant_id = ${tenant}
    where s.tenant_id = ${tenant}
      and s.status = 'enrolled'
      and c.subject in ${sql(group.subjectKeys)}`;
  return rows
    .map((r) => {
      const eff = (r.classnote_name || r.name || "").trim();
      return eff ? { studentName: eff, board: `${group.prefix}${eff}`, subject: group.label } : null;
    })
    .filter(Boolean);
}

/** ClassNote 가입 원아 중 이 학생과 이름 매칭되는 후보들(접미사 무시·괄호 한글 포함). */
function matchChildren(t, children) {
  const clean = t.studentName.replace(/[a-zA-Z]/g, "").trim();
  return children.filter((c) => {
    const keys = childKeys(c.name);
    return keys.has(t.studentName) || keys.has(clean);
  });
}

/** 판정 — 배정/배정가능/미가입/보드없음/동명이인. */
function judge(t, boardByNorm, children) {
  const board = boardByNorm.get(norm(t.board));
  if (!board) return { status: "board_missing" };
  if (board.children >= 1) return { status: "assigned" };
  const cands = matchChildren(t, children);
  if (cands.length === 0) return { status: "not_signed_up" };
  if (cands.length > 1)
    return { status: "ambiguous", note: cands.map((c) => `${c.name}(${c.birth ?? "생일?"})`).join(", ") };
  return { status: "ready", child: cands[0], boardId: board.id };
}

(async () => {
  console.log(`--- ClassNote 학생↔개별반 배정 (${APPLY ? "⚠️ APPLY" : "dry-run 전수조사"} · ${groups.map((g) => g.label).join("/")}) ---`);
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const tenant = await resolveTenant(sql);

  let targets = [];
  for (const g of groups) targets.push(...(await targetsOf(sql, tenant, g)));
  await sql.end({ timeout: 5 });
  if (studentArg) {
    const exact = targets.filter((t) => t.studentName === studentArg);
    targets = exact.length ? exact : targets.filter((t) => t.studentName.includes(studentArg));
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

    const detail = targets.map((t) => ({ ...t, ...judge(t, boardByNorm, children) }));
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
      // 멱등 확인 — 그 사이 이미 배정됐으면 건너뜀
      const before = await fetchChildDetail(page, t.child.id);
      if ((before.enrollment ?? []).some((e) => e.belong_to_class === t.boardId && !e.removed_child)) {
        console.log(`  [${i + 1}/${ready.length}] ${t.board} → 이미 배정됨(건너뜀)`);
        continue;
      }
      const res = await enrollChild(page, t.child.id, t.boardId);
      if (res.status >= 200 && res.status < 300) {
        const after = await fetchChildDetail(page, t.child.id);
        const found = (after.enrollment ?? []).some((e) => e.belong_to_class === t.boardId && !e.removed_child);
        console.log(`  [${i + 1}/${ready.length}] ${t.board} → ✅ ${res.status}${found ? " (재조회 확인)" : " ⚠️ 재조회 미확인"}`);
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
