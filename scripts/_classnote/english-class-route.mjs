// scripts/_classnote/english-class-route.mjs — 영어 **반 방 경로**(워커 전용). 원장 2026-10-29 *"반 방 경로로 영어 발송 만들어줘"*.
//
// 영어 배달은 그룹 반 방에 학생별 게시로 확정돼 있었다(docs/english-report-plan.md 결정 1). 연결 = s2_0006
// `classnote_english_class_boards`(사람이 확인한 반 ↔ 반 방). 연결이 있는 반의 보고서는 그 반 방의 **이 학생 원아에게만** 1:1로 올린다.
// 🔴 원아는 이름으로 찾지 않는다 — 0185a `classnote_child_links`(보호자 전화로 확정한 원아 → 학생, 한 원아는 한 학생에만)와
//    지금 그 반 방의 원아를 겹친 것만 쓴다. 같은 반 동명이인이 있어도 남의 집으로 가지 않는다.
// 🔴 연결이 있는데 원아가 그 방에 없으면 **막는다**(1인 보드로 흘리지 않는다 — 수학 반 보드 경로와 같은 원칙).
//    연결이 없는 반은 종전대로 1인 보드(이 표가 비면 동작이 지금과 같다).
// 게시 후 교차 확인(같은 방 다른 원아 알림장에 링크가 새지 않았나)은 수학 경로의 crossCheckOthers를 그대로 쓴다.
import { fetchBoardChildren, fetchChildDetail } from "./classnote-admin-core.mjs";

/** 영어 반 방 경로 대상 과목. */
export const ENGLISH_ROUTE_SUBJECTS = new Set(["english"]);

/**
 * 이 보고서가 어느 반의 반 방으로 가야 하나(순수) — 정규 = 보고서 반 · 보강(반 없음) = 보강 반(0171a).
 * 영어가 아니면 null.
 * @param {{ subject?: string|null, class_id?: string|null, makeup_class_id?: string|null }} r
 */
export function englishAnchorClass(r) {
  if (!ENGLISH_ROUTE_SUBJECTS.has(r?.subject ?? "")) return null;
  return r?.class_id ?? r?.makeup_class_id ?? null;
}

/**
 * 올릴 원아 고르기(순수) — 이 학생에게 확정된 원아 ∩ 지금 그 반 방의 원아.
 * @param {{ studentChildIds: Iterable<number|string>, liveChildIds: Iterable<number|string> }} a
 * @returns {{ ok: true, childIds: number[] } | { ok: false, code: "no_link" | "not_in_board" }}
 */
export function pickEnglishTargets({ studentChildIds, liveChildIds }) {
  const mine = [...new Set([...studentChildIds].map(Number).filter(Number.isFinite))];
  if (!mine.length) return { ok: false, code: "no_link" };
  const live = new Set([...liveChildIds].map(Number));
  const childIds = mine.filter((id) => live.has(id));
  return childIds.length ? { ok: true, childIds } : { ok: false, code: "not_in_board" };
}

/** 막힌 행의 사유(한국어) — 발송 콘솔·원스크린이 그대로 보여 준다. */
export function englishBlockedMessage(code, boardName) {
  if (code === "no_link")
    return `영어 반 방(${boardName}) 발송: 이 학생과 연결된 ClassNote 원아가 없습니다 — 학부모의 ClassNote 가입을 확인해 주세요(가입하면 다음 날 자동으로 연결됩니다)`;
  return `영어 반 방(${boardName}) 발송: 이 학생의 원아가 그 반 방에 없습니다 — ClassNote에서 그 반 방에 원아를 배정한 뒤 다시 보내 주세요(다른 보드로 보내지 않습니다)`;
}

/**
 * 반 ↔ 반 방 연결 조회. 연결이 없으면 null.
 * ⚠️ 표가 없으면(s2_0006 미적용) throw — 호출부가 42P01이면 종전 1인 보드로 둔다.
 * @returns {Promise<{ boardId: number, boardName: string } | null>}
 */
export async function loadEnglishClassBoard(sql, tenant, classId) {
  if (!classId) return null;
  const [row] = await sql`select b.board_id, b.board_name from classnote_english_class_boards b
    join classes c on c.tenant_id = b.tenant_id and c.id = b.class_id
    where b.tenant_id = ${tenant} and b.class_id = ${classId} and c.subject = 'english'`;
  return row ? { boardId: Number(row.board_id), boardName: row.board_name } : null;
}

/**
 * 아직 이 경로를 못 쓰는 상태인가 — 표가 없다(s2_0006 전 · 연동 PC 게이트웨이는 409 + 코드로 돌려준다) 또는
 * 웹 배포가 이 조회를 아직 모른다(`unknown_operation` — 질의 목록은 웹 배포에 실린다). 둘 다 종전 1인 보드로 둔다.
 */
export const isMissingTable = (e) =>
  e?.code === "42P01" || e?.code === "unknown_operation" || /42P01|does not exist/.test(String(e?.message ?? ""));

/**
 * 반 방 대상 확정 — 수학 resolveClassTargets와 같은 모양을 돌려준다(게시·교차 확인 코드를 그대로 탄다).
 * 실패(ok:false)는 결정적이다(재시도해도 같은 답) — 호출부가 failed로 두고 사유를 남긴다. 조회 실패는 throw.
 * @returns {Promise<{ok:true, boardId:number, boardName:string, targets:Array<{child:{id:number,name:string}, enrollment:{id:number}}>, others:number[]}
 *                 | {ok:false, error:string}>}
 */
export async function resolveEnglishClassTargets(sql, page, { tenant, centerId, board, studentId }) {
  const links = await sql`select child_id from classnote_child_links where tenant_id = ${tenant} and student_id = ${studentId}`;
  // 실시간 조회 — 연결은 사람이 확인한 반 방이지만 원아 배정은 선생님이 ClassNote에서 바꾼다.
  const live = await fetchBoardChildren(page, centerId, board.boardId);
  const pick = pickEnglishTargets({ studentChildIds: links.map((l) => l.child_id), liveChildIds: live.map((m) => m.id) });
  if (!pick.ok) return { ok: false, error: englishBlockedMessage(pick.code, board.boardName) };
  const nameOf = new Map(live.map((m) => [Number(m.id), String(m.name ?? m.child_name ?? "")]));
  const targets = [];
  for (const childId of pick.childIds) {
    const detail = await fetchChildDetail(page, childId);
    const enrollment = (detail?.enrollment ?? []).find((e) => e.belong_to_class === board.boardId && !e.removed_child);
    if (!enrollment)
      return { ok: false, error: `영어 반 방(${board.boardName}) 발송: 원아 "${nameOf.get(childId) || childId}"의 반 배정 기록을 찾지 못했습니다` };
    targets.push({ child: { id: childId, name: nameOf.get(childId) ?? "" }, enrollment });
  }
  const mine = new Set(pick.childIds);
  return {
    ok: true,
    boardId: board.boardId,
    boardName: board.boardName,
    targets,
    others: live.map((m) => Number(m.id)).filter((id) => !mine.has(id)),
  };
}
