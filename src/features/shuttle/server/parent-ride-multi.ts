import "server-only";

import { parentGate, type Ctx, type ParentRideActionState } from "./parent-ride-state";
import { loadAcademyHolidays, restDayName } from "./rest-days";

/**
 * 학부모 **하루짜리** 변경의 문 + **여러 날 한꺼번에**(월별 달력에서 끌어서 고른 날짜들, 사용자 2026-10-01).
 * ⚠️ 일반 서버 모듈이다(`"use server"` 아님) — 동기 함수·상수를 내보낸다([[#119]]).
 *
 * 🔴 쉬는 날(법정공휴일 · 학원 휴원일, `rest-days.ts`)은 못 바꾼다 — "공휴일은 대체로 학원도 쉰다"(사용자 2026-10-01).
 *    화면이 막아도 서버가 다시 본다([[#77]]).
 *    매주 반복되는 **고정 시간 변경**은 이 문을 안 탄다(`parentGate` 그대로) — 다음 그 요일이 공휴일이어도
 *    고정 시간은 바꿀 수 있어야 한다.
 */

/** 한 번에 고를 수 있는 날짜 수 — 한 달 평일을 넉넉히 덮는다. */
export const MAX_RIDE_DATES = 31;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
export const HOLIDAY_CLOSED_MESSAGE = "학원이 쉬는 날이에요 · 수정할 수 없어요";

/** 하루짜리 변경(자리 바꾸기 · 되돌리기 · 타지 않기 · 결석)의 문 — `parentGate` + 쉬는 날 잠금. */
export async function parentDayGate(input: {
  studentId: string;
  onDate: string;
  ioKind: string;
}): Promise<Ctx | { error: string }> {
  const ctx = await parentGate(input);
  if ("error" in ctx) return ctx;
  const rest = restDayName(await loadAcademyHolidays(ctx.viewer.tenantId), ctx.onDate);
  if (rest) return { error: `${HOLIDAY_CLOSED_MESSAGE}(${rest})` };
  return ctx;
}

/** 폼이 보낸 날짜 묶음 — 둘 이상일 때만 '여러 날'로 본다(형식·중복·개수를 다시 확인). */
export function multiDates(dates: readonly string[] | undefined): string[] | null {
  if (!Array.isArray(dates)) return null;
  const list = [...new Set(dates.filter((d) => typeof d === "string" && YMD.test(d)))].sort();
  return list.length > 1 ? list.slice(0, MAX_RIDE_DATES) : null;
}

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/**
 * 같은 변경을 날짜마다 적용하고 결과를 한 문장으로 접는다. 날짜끼리는 서로 독립이라 함께 보낸다(B4).
 * 🔑 날짜마다 **같은 규칙**(마감 · 탄 뒤 잠금 · 짝 규칙 · 공휴일)을 따로 통과해야 한다 — 못 바꾼 날은 이유와 함께 알린다.
 */
export async function forDates(
  dates: readonly string[],
  run: (onDate: string) => Promise<ParentRideActionState>,
): Promise<ParentRideActionState> {
  const results = await Promise.all(dates.map((d) => run(d)));
  const failed = dates.flatMap((d, i) => {
    const r = results[i]!;
    return "error" in r ? [`${md(d)} ${r.error}`] : [];
  });
  const okCount = dates.length - failed.length;
  if (okCount === 0) return { error: `선택한 ${dates.length}일 모두 바꾸지 못했어요 — ${failed[0]}` };
  if (failed.length === 0) return { ok: true, message: `선택한 ${dates.length}일 모두 같은 내용으로 저장했어요` };
  const more = failed.length > 2 ? ` 외 ${failed.length - 2}일` : "";
  return {
    ok: true,
    message: `${okCount}일 저장했어요 · ${failed.length}일은 못 바꿨어요(${failed.slice(0, 2).join(" · ")}${more})`,
  };
}
