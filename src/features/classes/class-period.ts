import { isCurrentSlot } from "./schedule-preserve";

/** 운영 기간을 가진 교시 한 줄 — `class_schedules.valid_from/valid_to`. */
export type PeriodSlot = { validFrom: string | null; validTo: string | null };

/**
 * 슬롯들의 운영 기간 → 반 단위 한 쌍으로 압축(반 수정 폼 프리필과 반 정보 표시가 **같은 함수**).
 * ⚠️ 시작일·종료일 **둘 다** 갈릴 수 있고, 갈리면 **칸을 비운다**. 폼은 항상 `periodProvided=1`을
 *    보내므로 값을 채워 보내면 그 한 값이 전 교시에 적용된다 — 예전엔 시작일을 말없이 최솟값으로
 *    평탄화해, 7/3부터 시작한 교시가 3/1부터 있었던 것으로 소급됐다(타임머신 과거 주가 거짓이 된다).
 *    비워 보내면 서버(`preserveScheduleFields`)가 교시별 기존값을 그대로 보존한다.
 */
export function commonPeriod(slots: readonly PeriodSlot[]): {
  validFrom: string | null;
  validTo: string | null;
  mixed: "from" | "to" | "both" | null;
} {
  const froms = [...new Set(slots.map((s) => s.validFrom ?? ""))];
  const tos = [...new Set(slots.map((s) => s.validTo ?? ""))];
  const fromMixed = froms.length > 1;
  const toMixed = tos.length > 1;
  return {
    validFrom: fromMixed ? null : (froms[0] || null),
    validTo: toMixed ? null : (tos[0] || null),
    mixed: fromMixed && toMixed ? "both" : fromMixed ? "from" : toMixed ? "to" : null,
  };
}

/**
 * 반의 **운영 기간**(원장 2026-09-18 *"반정보에서 이반의 시작날짜와 종강날짜를 볼 수 있게"* → 반 수정의 '운영 기간'을 쓴다).
 *
 * 🔑 기준은 반 수정 폼과 같다 — **지금 유효한 교시**(`isCurrentSlot`)의 공통값. 폼이 보여 주는 날짜와 반 정보가 갈리면 안 된다.
 * 지금 유효한 교시가 하나도 없으면(기간이 이미 끝난 반) **가장 늦게 끝난 교시 묶음**의 기간을 보이고 `ended`로 밝힌다.
 * 교시가 아예 없으면 null(모르는 것을 지어내지 않는다).
 * ⚠️ 수강을 닫는 SQL(`class_period_closed_end`, 0274a)은 여기에 **한 조건을 더 건다** — 끝난 기간의 마지막 교시들이 종료일
 *    **이전에 적혀 있던** 경우만(교시를 다 지워 생긴 마감 행을 거른다). 그래서 이 함수의 `ended`는 "지금 교시가 없다"는 표시일 뿐
 *    수강이 닫힌다는 약속이 아니다(화면은 끝난 기간에 수강 안내를 안 한다).
 */
export function classOperatingPeriod(
  slots: readonly PeriodSlot[],
  today: string,
): (ReturnType<typeof commonPeriod> & { ended: boolean }) | null {
  if (slots.length === 0) return null;
  const live = slots.filter((s) => isCurrentSlot(s.validTo, today));
  if (live.length > 0) return { ...commonPeriod(live), ended: false };
  const lastEnd = slots.reduce<string>((m, s) => ((s.validTo ?? "") > m ? (s.validTo ?? "") : m), "");
  return { ...commonPeriod(slots.filter((s) => (s.validTo ?? "") === lastEnd)), ended: true };
}
