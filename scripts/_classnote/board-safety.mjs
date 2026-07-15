// scripts/_classnote/board-safety.mjs — ClassNote 발송 직전 보드 안전 판정(순수 함수, 의존성 0).
//
// 오발송(=한 ClassNote 보드에 서로 다른 2가족+가 연결돼 한 학생 보고서가 남의 가족에게도 감) 방지.
// 발송 워커(classnote-core.mjs)와 반 공지 워커(classnote-notice-core.mjs)가 **같은 이 함수**로 판정 →
// 두 경로가 갈라져 한쪽만 취약해지는 것을 구조적으로 차단. Vitest 단위테스트(board-safety.test.mjs).
//
// ⚠️ 순수 유지 — @playwright/test 등 무거운 모듈 import 금지(테스트가 그걸 끌어오면 안 됨). norm은 여기 정의.

/** 공백 전부 제거 — Cloud Run 게시 함수·워커의 보드 매칭 규칙과 동일(공백제거 완전일치). */
export function normBoard(s) {
  return (s || "").replace(/\s/g, "");
}

/**
 * 발송 직전 보드 안전 판정.
 * @param {object} p
 * @param {string} p.className  대상 보드명 "(과목)학생명"(boardClassName 결과)
 * @param {Array<{id:number,name:string,children?:number}>} p.boards  전체 보드(children=approved_children 연결 가족 수)
 * @param {number|null} [p.occupants]  실시간 연결 가족 수(fetchBoardChildren). 주면 우선, 없으면 board.children.
 * @param {string[]} [p.allowlist]  원장이 육안 확인한 발송 허용 공유 보드명(같은 학생 다계정 등)
 * @returns {{ok:boolean, code:string, reason?:string, boardId?:number, occupants?:number}}
 *   ok=true면 발송 진행. ok=false면 blocked_shared로 보류(발송 안 함) + reason을 classnote_error에 저장.
 */
export function evaluateBoardSafety({ className, boards, occupants = null, allowlist = [] }) {
  const key = normBoard(className);
  if (!key) return { ok: false, code: "no_class", reason: "발송 대상 보드명이 비어 있습니다" };

  const matched = (boards || []).filter((b) => normBoard(b.name) === key);
  if (matched.length === 0)
    return { ok: false, code: "no_board", reason: `ClassNote 보드 없음 — "${className}" 보드가 없어 발송할 수 없습니다(프로비저닝/학부모 초대 필요)` };
  if (matched.length > 1)
    return { ok: false, code: "dup_board", reason: `ClassNote 보드 중복 — "${className}" 이름의 보드가 ${matched.length}개라 대상을 특정할 수 없습니다` };

  const board = matched[0];
  const n = occupants != null ? occupants : board.children ?? 0;
  const allowed = new Set((allowlist || []).map(normBoard));
  if (n > 1 && !allowed.has(key))
    return {
      ok: false,
      code: "shared",
      reason: `공유 보드(연결 가족 ${n}) — 다른 가족에게 오발송될 수 있어 발송 보류. 운영관리에서 확인 후 같은 학생 다계정이면 학원설정 '공유 보드 발송 예외'에 "${className}" 등록, 남의 가족이면 ClassNote에서 제거.`,
      boardId: board.id,
      occupants: n,
    };

  return { ok: true, code: "ok", boardId: board.id, occupants: n };
}
