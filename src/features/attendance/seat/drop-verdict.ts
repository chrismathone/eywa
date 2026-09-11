/**
 * 자리(랩실) 드래그 한 번의 **가부** — 순수 규칙(IO 없음, Vitest).
 *
 * 원장 2026-09-10: *"다른시간으로 옮기는게 목적. 같은 시간은 의미없음."* → 2026-09-11: *"LAB실에서 내가 드래그하고
 * 싶은건, '다른 시간대'의 수업임. 같은 시간대의 수업으로 옮기고 싶은게 아니야."* · *"아니 드래그는 '전체' 에서도 다른
 * 시간으로 이동하려고하면 경고 문구 뜨면서 안됨"*.
 *
 * 🔑 **드래그의 뜻은 하나 = 다른 시간으로.** 같은 교시에 놓으면 아무것도 안 바뀐다(`same`). 막힌 게 아니라 취소라
 *    빗금을 치지 않는다 — 치면 원래 자리가 금지 구역으로 보인다(시간표 `SAME_SPOT`과 같은 규약).
 * 🔑 **한 함수가 세 자리를 판정한다** — 집는 순간 놓을 곳마다 칠하는 표식(교시 칩·교시 판) · 끄는 카드 아래 한 줄 ·
 *    놓았을 때의 거절. 이 함수는 서버 쓰기 경로(`moveSeatStudentPeriod`)와 **같은 판정**(`validateSeatPeriodMove`)을
 *    부르므로 문장까지 같다([[#77]]: 서버는 자기 조회로 다시 돌린다).
 * 🔴 "경고 문구 뜨면서 안 됨"의 원인은 판정이 아니라 **안 보이는 것**이었다 — 가장 자연스러운 이웃 교시가 대개 그 반의
 *    정규 수업이라(실측 금 2026-09-11: 교시 사이 이동 49개 중 18개가 반 축 거절) 놓고 나서야 끄는 카드 아래 작은 한
 *    줄로 이유를 봤다. 그래서 집는 순간 모든 놓을 곳에 가부를 먼저 칠한다.
 */
import { seatMoveBlockReason } from "./placement";
import { SEAT_PERIOD_SAME, validateSeatPeriodMove } from "./period-choice";
import type { SeatStudentClass } from "./student-classes";

/** 드래그로 집은 카드 — 판정에 필요한 것만(화면의 `CardDrag`가 구조적으로 들어온다). */
export type SeatDropCard = { studentId: string; homeClassId: string; start: string; marked: boolean };

/** 놓을 곳 하나의 가부 — `same`(제자리·취소) · `ok`(옮긴다) · `blocked`(못 옮긴다 — 이유). */
export type SeatDropVerdict = { kind: "same" | "ok" | "blocked"; text: string };

/** 판정 재료 — 하루치(서버 `SeatDay`의 칸 그대로 + 학생 축). 화면이 이미 들고 있는 값이라 새 조회가 없다. */
export type SeatDropInputs = {
  /** 교시 이동을 쓸 수 있나(로그인 + 쓰기 가능 + 0255a 적용됨). */
  canMove: boolean;
  /** 그날 이 자리의 교시들. */
  periodStarts: readonly string[];
  /** 교시 → 끝 시각들(`SeatPeriod.ends`). */
  endsByStart: Readonly<Record<string, readonly string[]>>;
  slotsByClass: Readonly<Record<string, readonly string[]>>;
  busyStartsByClass: Readonly<Record<string, readonly string[]>>;
  /** 학생 → 그날 이 자리 밖 수업. 키가 없으면(모름) 학생 축은 화면이 안 막는다 — 서버가 다시 본다. */
  studentClasses?: Readonly<Record<string, readonly SeatStudentClass[]>>;
};

export const SEAT_PERIOD_LOCKED = "다른 시간으로 옮기기는 지금 잠겨 있습니다";
/** 놓을 곳 위가 아닐 때 끄는 카드 아래 적는 안내 — 어디에 놓아야 하는지부터 말한다. */
export const SEAT_DROP_GUIDE = "다른 시간 교시(위 칩)에 놓으면 그 시간으로 옮깁니다";
export const seatDropOkText = (toSlot: string): string => `${toSlot} 수업으로 옮기기`;

export function seatDropVerdict(card: SeatDropCard, toSlot: string, v: SeatDropInputs): SeatDropVerdict {
  // 🔴 제자리가 먼저다 — 찍힌 카드·잠긴 화면이어도 원래 교시는 "막힌 곳"이 아니다.
  if (toSlot === card.start) return { kind: "same", text: SEAT_PERIOD_SAME };
  if (!v.canMove) return { kind: "blocked", text: SEAT_PERIOD_LOCKED };
  const check = validateSeatPeriodMove({
    fromSlot: card.start,
    toSlot,
    classSlots: v.slotsByClass[card.homeClassId] ?? [],
    periodStarts: v.periodStarts,
    busyStarts: v.busyStartsByClass[card.homeClassId] ?? [],
    // 잠긴 카드는 애초에 안 잡히지만 같은 함수를 한 번 더 태운다 — 두 사람이 같은 카드를 열어 두면 한쪽이 찍는
    // 사이 다른 쪽이 끌 수 있다(그 순간이 고아 행이 생기는 지점이다).
    markedReason: seatMoveBlockReason(card.marked ? "marked" : null),
    studentClasses: v.studentClasses?.[card.studentId],
    toEnds: v.endsByStart[toSlot],
  });
  return "error" in check ? { kind: "blocked", text: check.error } : { kind: "ok", text: seatDropOkText(toSlot) };
}

/** 끄는 카드 아래 한 줄 — `ok: null`은 행동이 아니라 안내다(제자리·놓을 곳 밖). */
export type SeatDragHint = { text: string; ok: boolean | null };

/** 놓을 곳이 없으면 안내, 있으면 그곳의 판정 그대로 — 표식과 문장이 갈리지 않게 판정을 받아 옮겨 적기만 한다. */
export function seatDragHint(verdict: SeatDropVerdict | null): SeatDragHint {
  if (!verdict) return { text: SEAT_DROP_GUIDE, ok: null };
  if (verdict.kind === "same") return { text: verdict.text, ok: null };
  return { text: verdict.text, ok: verdict.kind === "ok" };
}
