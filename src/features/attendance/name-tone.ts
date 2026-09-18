/**
 * 월별 출석부 **이름 칸 서식** 판정 — 시간표 학생 줄과 **같은 규칙**(원장 2026-09-18 *"학생 리스트 시간표와 동일한
 * 서식으로 신입생 빨강 배경 흰글씨, 퇴원생 검은배경 흰글씨 같은것"*). 순수 함수(Vitest).
 *
 * 규칙(시간표 조회 `timetable/server/queries.ts`와 같은 창 · 같은 순서):
 * - **퇴원** = 이 반 수강이 기준일에 끝났고 **그 과목 수강이 완전히 끝났다**, 또는 학생 퇴원일 ≤ 기준일.
 *   🔴 **반이동으로 끝난 건 퇴원이 아니다**(옮겨 갔다) — 시간표는 그 줄을 옛 반에서 아예 안 그린다.
 *   🔴 **같은 과목 다른 반을 계속 다니는 '종강'도 퇴원이 아니다** — 서식 없음(원장 2026-09-18 *"다른 수업이 존재하는
 *      종강의 경우는 색변경 하지말것. 해당 과목의 수강이 완전히 종료된 경우를 퇴원으로"*). 판정은 **표식과 같은 것**을
 *      읽는다 — 그 종료일의 표식이 `classEnded`(종강)·`transferOut`(전출)이면 서식 없음, `left`(퇴원)면 검정.
 *      표식 판정(`lifecycleBadgesInRange`)이 이미 같은 과목 다른 반을 조회해 가른다 — 규칙을 여기서 다시 적지 않는다
 *      (다시 적으면 같은 줄에 '종강' 라벨과 퇴원 검정이 함께 선다).
 * - **전입** = 반이동으로 시작 + 시작일이 기준일 30일 이내. 🔴 신입보다 **먼저** 본다(반이동도 새 수강이라 신입 창에 든다).
 * - **신입** = 시작일이 기준일 30일 이내.
 * - **등록 31~60일** = 그 다음 30일.
 * 🔑 기준일 = **min(오늘, 그 달 마지막 날)** — 지난 달 출석부는 그 달 끝 기준의 사실이고, 이번 달은 오늘 기준이다.
 * 🔴 판정 재료는 **이 반의 가장 최근 구간** 하나다(재등록이면 마지막 등록이 지금의 사실).
 */
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { NEW_STUDENT_DAYS, RECENT_STUDENT_DAYS, type StudentToneKind } from "@/features/timetable/lib/student-tone";
import type { EnrollSpan, LifecycleBadge } from "./enrollment-span";
import { addDays } from "@/lib/date-kst";

export function attendanceNameTone(
  spans: readonly EnrollSpan[],
  withdrawnAt: string | null | undefined,
  referenceDate: string,
  /** 이 반 줄의 표식(표시용으로 거르기 **전** 원본) — 종료가 종강·전출인지 가른다. 없으면 종전대로 퇴원. */
  badges: readonly LifecycleBadge[] = [],
): StudentToneKind | null {
  if (spans.length === 0) return null;
  const last = [...spans].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)).at(-1)!;
  if (last.start > referenceDate) return null; // 아직 안 들어온 학생 — 서식 없음(시간표는 '대기').
  const ended = isEnrollmentEndedOn(last.end, referenceDate, last.isTransferred ?? false);
  if (ended && last.isTransferred) return null; // 옮겨 갔다 — 퇴원이 아니다.
  if (withdrawnAt != null && withdrawnAt <= referenceDate) return "withdrawn";
  if (ended) {
    // 그 과목의 다른 반이 이어받았거나(전출) 계속된다(종강) — 과목을 끝낸 게 아니다.
    const continues = badges.some(
      (b) => (b.kind === "classEnded" || b.kind === "transferOut") && b.date === last.end,
    );
    return continues ? null : "withdrawn";
  }
  const newCutoff = addDays(referenceDate, -NEW_STUDENT_DAYS);
  const recentCutoff = addDays(referenceDate, -RECENT_STUDENT_DAYS);
  if (last.start >= newCutoff) return last.isTransferredIn ? "transferIn" : "new";
  if (last.start >= recentCutoff && !last.isTransferredIn) return "recent";
  return null;
}
