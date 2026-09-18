/**
 * 월별 출석부 **이름 칸 서식** 판정 — 시간표 학생 줄과 **같은 규칙**(원장 2026-09-18 *"학생 리스트 시간표와 동일한
 * 서식으로 신입생 빨강 배경 흰글씨, 퇴원생 검은배경 흰글씨 같은것"*). 순수 함수(Vitest).
 *
 * 규칙(시간표 조회 `timetable/server/queries.ts`와 같은 창 · 같은 순서):
 * - **퇴원** = 이 반 수강이 기준일에 끝났다(일반 종료 — `isEnrollmentEndedOn`) 또는 학생 퇴원일 ≤ 기준일.
 *   🔴 **반이동으로 끝난 건 퇴원이 아니다**(옮겨 갔다) — 시간표는 그 줄을 옛 반에서 아예 안 그린다.
 * - **전입** = 반이동으로 시작 + 시작일이 기준일 30일 이내. 🔴 신입보다 **먼저** 본다(반이동도 새 수강이라 신입 창에 든다).
 * - **신입** = 시작일이 기준일 30일 이내.
 * - **등록 31~60일** = 그 다음 30일.
 * 🔑 기준일 = **min(오늘, 그 달 마지막 날)** — 지난 달 출석부는 그 달 끝 기준의 사실이고, 이번 달은 오늘 기준이다.
 * 🔴 판정 재료는 **이 반의 가장 최근 구간** 하나다(재등록이면 마지막 등록이 지금의 사실).
 */
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { NEW_STUDENT_DAYS, RECENT_STUDENT_DAYS, type StudentToneKind } from "@/features/timetable/lib/student-tone";
import type { EnrollSpan } from "./enrollment-span";
import { addDays } from "@/lib/date-kst";

export function attendanceNameTone(
  spans: readonly EnrollSpan[],
  withdrawnAt: string | null | undefined,
  referenceDate: string,
): StudentToneKind | null {
  if (spans.length === 0) return null;
  const last = [...spans].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)).at(-1)!;
  if (last.start > referenceDate) return null; // 아직 안 들어온 학생 — 서식 없음(시간표는 '대기').
  const ended = isEnrollmentEndedOn(last.end, referenceDate, last.isTransferred ?? false);
  if (ended && last.isTransferred) return null; // 옮겨 갔다 — 퇴원이 아니다.
  if (ended || (withdrawnAt != null && withdrawnAt <= referenceDate)) return "withdrawn";
  const newCutoff = addDays(referenceDate, -NEW_STUDENT_DAYS);
  const recentCutoff = addDays(referenceDate, -RECENT_STUDENT_DAYS);
  if (last.start >= newCutoff) return last.isTransferredIn ? "transferIn" : "new";
  if (last.start >= recentCutoff && !last.isTransferredIn) return "recent";
  return null;
}
