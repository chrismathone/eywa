// scripts/_classnote/classnote-class-route.mjs — 수학 **반 보드 경로**의 대상 확정 + 게시 후 교차 확인(워커 전용).
//
// 원장 2026-09-29: 반 보드(aywa 반과 이름이 같은 ClassNote 반)에 학생 1:1로 보낸다. 🔴 가장 위험한 경로 =
// **같은 반 동명이인** — 그래서 원아는 이름으로 절대 찾지 않고, 0302a `classnote_class_board_members`에
// 가드(1인 보드 원아·보호자 전화·생년·역방향 유일성·같은 반 동명이인·이름 연속성)를 통과해 ok로 적힌 원아만 쓴다.
// 게시 직전 ClassNote를 **다시 읽어** 그 원아가 아직 그 반에 배정돼 있는지 확인하고(TOCTOU), 게시 뒤에는
// 같은 반 다른 원아의 알림장을 훑어 이 보고서 링크가 새지 않았는지 본다(마지막 차단).
import { fetchBoardChildren, fetchChildDetail, findChildReportId } from "./classnote-admin-core.mjs";
import { normalizeRouteConfig } from "./class-route-decide.mjs";

/** 설정 직독(allowlist와 같은 패턴 — 앱 캐시 무관, 커밋값 즉시). */
export async function getClassnoteMathRoute(sql, tenant) {
  const [row] = await sql`select data->'report' as report from tenant_settings where tenant_id = ${tenant}`;
  return normalizeRouteConfig(row?.report ?? null);
}

/**
 * 이 반이 반 보드 대상인가 — 반 보드를 만든 기준(math-class-boards-load.mjs `loadAywa`)과 **같은 조건**.
 * 특강·종강·미발송·폐지 반은 반 보드가 없으므로 기존 1인 보드로 보낸다(멈추면 그 보고서가 영영 안 나간다).
 */
export async function isClassRouteEligible(sql, tenant, classId) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const [row] = await sql`select 1 as ok from classes c
    where c.tenant_id = ${tenant} and c.id = ${classId} and c.is_active and not c.report_optout
      and c.subject in ('math', 'subject_1') and not coalesce(c.is_special, false) and strpos(c.class_name, '특강') = 0
      and (c.closed_at is null or c.closed_at >= ${today})`;
  return !!row;
}

/**
 * 반 보드 대상 확정. 실패는 전부 **결정적**(재시도해도 같은 답) — 호출부가 failed로 고정하고 사유를 남긴다.
 * ⚠️ 0302a 표가 없으면(SQL 미적용) 조회가 throw한다 → 호출부가 잡아 1인 보드로 보내지 않고 실패로 둔다
 *    (설정을 반별로 바꿨는데 조용히 옛 경로로 가면 원장이 시험 결과를 오해한다).
 * @returns {Promise<{ok:true, boardId:number, boardName:string, targets:Array<{child:{id:number,name:string}, enrollment:{id:number}}>, others:number[]}
 *                 | {ok:false, error:string}>}
 */
export async function resolveClassTargets(sql, page, { tenant, centerId, classId, studentId }) {
  const [board] = await sql`select board_id, board_name from classnote_class_boards
    where tenant_id = ${tenant} and class_id = ${classId}`;
  if (!board) return { ok: false, error: "반별 발송: 이 반의 ClassNote 반 연결이 없습니다(C.N 빨강) — 반 매칭 후 다시 발송하세요" };
  const rows = await sql`select child_id, child_name, status, reason from classnote_class_board_members
    where tenant_id = ${tenant} and class_id = ${classId} and student_id = ${studentId}`;
  const held = rows.filter((x) => x.status !== "ok");
  if (!rows.length || held.length)
    return {
      ok: false,
      error: `반별 발송: 이 학생의 ClassNote 원아 매칭이 끝나지 않았습니다(C.N 빨강)${
        held.length ? ` — ${held.map((h) => h.reason).filter(Boolean).join(" / ").slice(0, 160)}` : ""
      }`,
    };
  const boardId = Number(board.board_id);
  // 실시간 재확인 — 그 사이 원장이 ClassNote에서 배정을 바꿨을 수 있다.
  const live = await fetchBoardChildren(page, centerId, boardId);
  const liveIds = new Set(live.map((m) => Number(m.id)));
  const targets = [];
  for (const r of rows) {
    const childId = Number(r.child_id);
    if (!liveIds.has(childId))
      return { ok: false, error: `반별 발송: 원아 "${r.child_name ?? childId}"가 ClassNote 반(${board.board_name})에 없습니다 — 반 매칭 후 다시 발송하세요` };
    const detail = await fetchChildDetail(page, childId);
    const enrollment = (detail?.enrollment ?? []).find((e) => e.belong_to_class === boardId && !e.removed_child);
    if (!enrollment)
      return { ok: false, error: `반별 발송: 원아 "${r.child_name ?? childId}"의 반 배정 기록을 찾지 못했습니다` };
    targets.push({ child: { id: childId, name: r.child_name ?? "" }, enrollment });
  }
  const mine = new Set(targets.map((t) => t.child.id));
  return { ok: true, boardId, boardName: board.board_name, targets, others: [...liveIds].filter((id) => !mine.has(id)) };
}

/**
 * 게시 후 교차 확인 — 같은 반 **다른** 원아의 최근 알림장에 이 보고서 링크가 있으면 새어 나간 것이다.
 * @returns {Promise<{ok:true} | {ok:false, leakedTo:number[], unknown:boolean}>}
 *   unknown=true = 조회 실패로 확인 못 함(새었다고 단정하지 않지만 호출부는 경고를 남긴다).
 */
export async function crossCheckOthers(page, { centerId, boardId, others, contents }) {
  const leakedTo = [];
  let unknown = false;
  for (const child of others) {
    const r = await findChildReportId(page, centerId, { cls: boardId, child, content: contents });
    if (!r.ok) unknown = true;
    else if (r.id) leakedTo.push(child);
  }
  return leakedTo.length || unknown ? { ok: false, leakedTo, unknown } : { ok: true };
}
