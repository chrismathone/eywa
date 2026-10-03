import "server-only";
/**
 * **출결 화면의 휴원일 판정 — 한 곳.** 오늘 출결(좌석표·확인 큐·강사 출결 모드·어제 출결) · 처리 현황
 * (`getDailyProcessingStatus` → 출석부 요약·일별 출석부·운영실) · 휴원일 입력 요약이 전부 이 함수를 읽는다.
 *
 * 🔴 **판정 자료는 학원설정 `operations.holidays` 하나뿐이다**(원장 2026-09-01 · 2026-09-07 — 강사 시트·월별 출석부·
 *    운영실 신호와 같은 규약, [`class-sheets/lib/holiday.ts`](@/features/class-sheets/lib/holiday)).
 *    청구의 양력 고정 공휴일 표(`fixedHolidaysForYear`)나 캘린더 탭의 내장 법정공휴일 표를 **여기에 다시 붙이지 말 것.**
 *    2026-08-14엔 그 폴백이 있었다 — 당시 휴일 목록이 2건뿐이었기 때문인데, 2026-09-01에 내년까지의 휴일이
 *    목록에 등록되면서 전제가 사라졌다. 폴백이 남아 있으면 **수업하는 공휴일을 목록에서 빼도** 오늘 출결이
 *    계속 비어서, 원장이 그날을 열 방법이 없다(목록 = 유일한 조작 수단: 등록 = 쉼, 삭제 = 수업).
 *    법정공휴일이라는 이유만으로 학원이 쉰다고 추정하지 않는다 — 이 학원은 실제로 공휴일에 수업한다.
 * 🔴 화면 파일에서 날짜를 직접 비교하지 말 것 — 두 벌이 되면 같은 날이 화면마다 다르게 읽힌다.
 * ⚠️ 청구(수강료 계산기·세션 회차)의 공휴일 처리는 별개다 — 돈 계산이라 이 판정과 묶지 않는다.
 */
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { holidayNameOn } from "@/features/class-sheets/lib/holiday";
import { reportError } from "@/lib/observability/report-error";

/** 그날이 학원설정 휴일이면 그 이름(아니면 null). 설정 조회 실패는 던진다 — 호출부가 정한다. */
export async function holidayNameOf(date: string): Promise<string | null> {
  const settings = await getTenantSettings();
  return holidayNameOn(buildHolidayMap(settings.operations.holidays), date);
}

/**
 * 같은 판정의 **fail-soft** 판 — 설정 조회가 실패하면 휴원일이 아닌 것으로 본다(null).
 * 처리 현황처럼 "설정 하나 때문에 화면 전체가 죽으면 안 되는" 자리에서 쓴다(운영실 신호와 같은 규약).
 * 조용히 넘기지는 않는다 — 실패는 서버 로그에 남는다.
 */
export async function holidayNameOrNull(date: string): Promise<string | null> {
  try {
    return await holidayNameOf(date);
  } catch (error) {
    reportError(error, { scope: "attendance.holidayNameOrNull", date });
    return null;
  }
}
