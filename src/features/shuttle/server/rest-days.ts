import "server-only";

import { buildHolidayMap } from "@/features/attendance/calendar";
import { holidayShortName } from "@/features/calendar/holidays";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";

/**
 * 학부모 셔틀 화면의 **쉬는 날** — 학원 휴원일(학원설정 `operations.holidays`) ∪ 법정공휴일(내장 표).
 * 요일별 화면 · 월별 달력 · 서버 문(`parentDayGate`)이 같은 판정을 쓴다(사용자 2026-10-01 *"공휴일은 대체로 학원도 쉰다"*).
 * 🔑 이름은 학원설정이 먼저(학원이 붙인 이름이 더 구체적이다).
 * ⚠️ 학원설정을 못 읽으면 법정공휴일만으로 판정한다(fail-soft — 화면·저장을 멈추지 않는다).
 * ⚠️ 학부모 셔틀 한정 규약이다 — 출석부·시수는 법정공휴일 ≠ 학원 휴원일 그대로.
 */
export async function loadAcademyHolidays(tenantId: string): Promise<Record<string, string>> {
  try {
    const settings = await getTenantSettingsByTenantId(tenantId);
    return buildHolidayMap(settings.operations.holidays);
  } catch {
    return {};
  }
}

/** 그 날짜가 쉬는 날이면 이름, 아니면 null. */
export function restDayName(academyHolidays: Readonly<Record<string, string>>, ymd: string): string | null {
  return academyHolidays[ymd] ?? holidayShortName(ymd);
}
