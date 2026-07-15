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
 * 예외 등재가 기본으로 면제해 주는 **연결 계정 수**.
 *
 * 예외 등재의 뜻 = "원장이 육안 확인 = 이 보드의 계정들은 **같은 학생**의 것"이다.
 * 실사례(원장 확인, 2026-07-15): **영어·수학을 따로 가입**했거나 **학부모와 학생이 각자 가입** — 전형적으로 2개.
 * 그 확인은 **그때 본 인원에 대한 것**이라, 나중에 계정이 하나 더 붙으면 확인의 근거가 사라진다 —
 * 그게 정확히 `(수학)박서준` 사고 모드("옛 보드에서 제거 누락")다. 그래서 기본 2를 넘으면 다시 차단해 사람이 한 번 더 본다.
 *
 * ⚠️ 다만 **3개가 정상인 집도 있을 수 있다**(아빠·엄마·학생 등). 그때 재차단이 영구 차단이 되면 등재해도 안 나가는
 * 막다른 길이 되므로, 예외 목록에 **`보드명|N`** 으로 인원을 지정할 수 있게 열어둔다(예: `(수학)홍길동|3`).
 * 기본값을 올리지 말고 **그 보드만** 올릴 것 — 전역 상향은 확인 안 된 가족까지 통과시킨다.
 */
const ALLOWLIST_DEFAULT_MAX = 2;

/**
 * 예외 목록 한 줄을 판다: `"(수학)안은지"` → 최대 2 / `"(수학)홍길동|3"` → 최대 3.
 * ⚠️ 인원 지정은 **정규화 전에** 떼야 한다 — `normBoard`는 공백만 지우므로 `|3`이 붙은 채로는 보드명과 안 맞는다.
 */
function parseAllowEntry(entry) {
  const raw = String(entry ?? "");
  const m = raw.match(/^(.*?)\s*\|\s*(\d+)\s*$/);
  if (m && Number(m[2]) >= 1) return { key: normBoard(m[1]), max: Number(m[2]) };
  return { key: normBoard(raw), max: ALLOWLIST_DEFAULT_MAX };
}

/**
 * 발송 직전 보드 안전 판정.
 * @param {object} p
 * @param {string} p.className  대상 보드명 "(과목)학생명"(boardClassName 결과)
 * @param {Array<{id:number,name:string,children?:number|null}>} p.boards  전체 보드
 *   (children=approved_children 연결 **계정** 수. **null=모름**, 0=학부모 미연결 — 둘은 다르다)
 * @param {number|null} [p.occupants]  실시간 연결 계정 수(fetchBoardChildren). 주면 우선, 없으면 board.children.
 * @param {string[]} [p.allowlist]  원장이 육안 확인한 발송 허용 공유 보드명(같은 학생 다계정 등)
 * @returns {{ok:boolean, code:string, reason?:string, boardId?:number, occupants?:number|null}}
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
  const n = occupants != null ? occupants : board.children;
  // ⚠️ **인원을 모르면 안 보낸다**(fail-closed). 예전엔 `?? 0`이라 모름이 "0가족=안전"으로 뭉개져,
  // ClassNote가 필드를 바꾸면 게이트가 무경고로 전부 통과시켰다(감시 스캔도 같은 식을 써서 동시에 실명).
  if (n == null || Number.isNaN(Number(n)))
    return {
      ok: false,
      code: "unknown_occupants",
      reason: `연결 계정 수를 확인하지 못했습니다 — "${className}" 보드의 인원 정보를 ClassNote가 주지 않아 오발송 여부를 판단할 수 없어 보류합니다(ClassNote API 변경 가능성 — 개발자 확인 필요).`,
      boardId: board.id,
      occupants: null,
    };

  const allowed = new Map((allowlist || []).map((e) => { const p = parseAllowEntry(e); return [p.key, p.max]; }));
  if (n > 1 && !allowed.has(key))
    return {
      ok: false,
      code: "shared",
      reason: `공유 보드(연결 계정 ${n}) — 다른 가족에게 오발송될 수 있어 발송 보류. 클래스노트 운영관리에서 연락처 확인 후, 같은 학생의 계정이면(영어·수학 따로 가입, 학부모·학생 각자 가입 등) 수업보고서 > 보고서 설정 > '공유 보드 발송 예외'에 "${className}" 등록, 남의 가족이면 클래스노트에서 연결 제거.`,
      boardId: board.id,
      occupants: n,
    };
  // 등재돼 있어도 **확인한 범위**를 넘으면 재차단 — 등재 후 붙은 계정은 아무도 확인한 적이 없다(박서준 사고 모드).
  const max = allowed.get(key) ?? ALLOWLIST_DEFAULT_MAX;
  if (n > max)
    return {
      ok: false,
      code: "shared_grown",
      reason: `발송 예외로 등재된 보드지만 연결 계정이 ${n}개로 늘었습니다(확인 범위 ${max}개) — 새로 붙은 계정은 확인된 적이 없어 보류합니다. 클래스노트 운영관리에서 확인 후, ${n}개가 모두 같은 학생 것이면 예외 목록을 "${className}|${n}" 으로 고쳐 주세요. 남의 가족이면 클래스노트에서 연결 제거.`,
      boardId: board.id,
      occupants: n,
    };

  return { ok: true, code: "ok", boardId: board.id, occupants: n };
}
