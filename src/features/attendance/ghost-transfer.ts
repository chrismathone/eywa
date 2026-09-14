/**
 * 강사 전체 보기 **빗금 칸**(그 강사 몫 행 0 · 남의 기록만) 저장 계획 — 셀·범위 저장이 이 한 함수를 지난다(순수, Vitest).
 *
 * 🔴 원장 2026-09-14: *"그냥 그 날의 해당 담당 출석으로 전부 이전시켜. 다른 사람이 대신 찍었어도."* +
 *    *"대신 다른 사람이 출결하면 메모에 남겨."* — 종전엔 이 칸을 "반별 보기에서 고치세요"로 거절했다.
 *    귀속은 컬럼이 아니라 읽을 때 계산되므로(`resolveTaughtBy`) 소급으로 옮길 행은 없고, 바뀌는 건 **입력을 받는 것**뿐이다.
 * 결정 넷(원장 확정):
 *   ① 다른 선생님 교시 행(`other`)에 **상태만** 쓴다 — `session_units`는 건드리지 않는다.
 *   ② 자리(JJ·랩실) 행뿐인 칸은 지금처럼 막는다(원장 2026-09-12 *"jj는 개인강사 출석부에 넣음 안되지."*).
 *   ③ 메모는 **이 경로에서만**, 쓴 행마다 `대신 입력: {입력자}` 한 줄(`proxy-memo.ts` — 기존 메모 보존·중복 안 붙임).
 *   ④ 이 표의 칸엔 빗금 위 흐린 값으로만 보이고 합계엔 안 든다(`cell-display` `ghostGridValue` · `grid/store` `g`).
 * 기본값(원장에게 안 물음): 빗금 칸의 **지우기는 막는다** — 남의 기록 삭제는 되돌리기 어렵다.
 * ⚠️ 제 몫 행이 하나라도 있으면 여기 오지 않는다(`own` — 종전 `planDayCellUnits`·`splitOutSeatRows` 경로 그대로).
 * ⚠️ 화면이 같은 칸을 `transfer`로 보는 판정은 `cell-display` `ghostCellKind`다 — 둘이 갈리면 격자는 응답의
 *    `ghostTransfer`로 덮개를 벗긴다(`grid/store` `dropLocalIf`).
 */
import { sheetT } from "@/features/teacher-view/i18n";
import type { AttendanceSlotShare } from "./teacher-axis";
import type { DayTargetRow } from "./scoped-split";

export type ScopedDayPlan<T extends DayTargetRow> =
  /** 반별 보기 · 새 칸(행 없음) · 제 몫 행이 있다 — 종전 경로. */
  | { kind: "own" }
  /** 제 몫 0 · 다른 선생님 교시 행 ≥ 1 — 그 행들에 상태만(+ 메모). `rows`는 `targets` 순서 그대로. */
  | { kind: "transfer"; rows: T[] }
  | { kind: "reject"; reason: ScopedRejectReason };

export type ScopedRejectReason = "seatOnly" | "clearGhost" | "stale";

/**
 * @param targets 그날 교시별 최신 행(`pickSaveTargets(rows, null).updateIds` 순서) — 화면이 값으로 세는 행과 같은 대상.
 * @param share 행 하나의 몫(`buildScopeShare`). null = 반별 보기(전부 그 반 몫 = 종전).
 * @param clearing 지우기(status=null)인가 — 빗금 칸의 지우기는 막는다.
 * @param ghostIntent 화면이 이 칸을 **빗금 칸 입력으로 알고** 보냈나(격자 값 `g`). 입력(clearing=false)에서만 본다.
 *   🔴 서버 판정과 갈리면 저장하지 않는다(`stale`, 적대 리뷰 2026-09-14): 화면이 오래돼 빈칸으로 보이던 칸에 그 사이 남의
 *      교시 기록이 생겼는데 판정만 따르면 **친 시수가 버려지고 남의 기록이 조용히 덮인다**. 반대로 빗금으로 알고 보냈는데 제 몫
 *      행이 생겼으면(또는 기록이 사라졌으면) 제 기록을 덮는다. 둘 다 사람이 본 것과 다른 것을 쓰는 일이다.
 *   ⚠️ 표식은 권한이 아니다 — 옮길지는 여전히 서버가 DB로 판정하고(#77), 표식은 "사람이 그걸 보고 쳤나"만 확인한다.
 */
export function planScopedDay<T extends DayTargetRow>(input: {
  targets: readonly T[];
  share: ((row: T) => AttendanceSlotShare) | null;
  clearing: boolean;
  ghostIntent?: boolean;
}): ScopedDayPlan<T> {
  const { share } = input;
  // 반별 보기엔 빗금 칸이 없다 — 표식이 와도 뜻이 없다(종전 경로).
  if (!share) return { kind: "own" };
  const plan = classify(input.targets, share, input.clearing);
  if (input.clearing) return plan;
  const intent = input.ghostIntent === true;
  if ((plan.kind === "transfer" && !intent) || (plan.kind === "own" && intent)) {
    return { kind: "reject", reason: "stale" };
  }
  return plan;
}

function classify<T extends DayTargetRow>(
  targets: readonly T[],
  share: (row: T) => AttendanceSlotShare,
  clearing: boolean,
): ScopedDayPlan<T> {
  if (targets.length === 0 || targets.some((r) => share(r) === "mine")) return { kind: "own" };
  // 자리 행은 받을 행에서 뺀다 — 자리뿐이면 막는다(②). 순서: 자리뿐 판정이 지우기 판정보다 먼저(사유가 더 정확하다).
  const others = targets.filter((r) => share(r) === "other");
  if (others.length === 0) return { kind: "reject", reason: "seatOnly" };
  if (clearing) return { kind: "reject", reason: "clearGhost" };
  return { kind: "transfer", rows: others };
}

/**
 * 거절 문장 — 격자·칸·팝오버가 쓰는 **화면 사전(한국어)을 그대로** 쓴다. 서버 문장을 따로 지으면 같은 칸이
 * 누르기 전(격자)과 누른 뒤(서버)에 다른 이유를 댄다.
 */
export const SCOPED_REJECT_MESSAGE: Record<ScopedRejectReason, string> = {
  seatOnly: sheetT("ko", "att.lock.seatOnly"),
  clearGhost: sheetT("ko", "att.grid.ghostClearBlock"),
  stale: sheetT("ko", "att.grid.ghostStale"),
};
