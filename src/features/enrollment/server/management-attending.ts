import "server-only";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { loadActiveEnrolledEnrollments } from "@/features/students/server/enrolled-programs";
import { enrolledSubjectCounts } from "@/features/students/enrollment/enrolled-composition";
import { reportWarning } from "@/lib/observability/report-error";
import { classKeysOfGroups } from "../consult-subject";
import type { AttendingCounter } from "../management-sheet";

/**
 * 관리현황 **지금 재원**의 판정 — 새로 만들지 않고 원생목록·운영실 재원생과 같은 것을 쓴다(2026-10-23 · Codex 검토):
 * 재원생의 활성 수강(`loadActiveEnrolledEnrollments` — 재원 상태 · 휴원 제외 · 종료일 없음, 요청 캐시) → `enrolledSubjectCounts`
 * (시작일 도래 · 사람 단위). 상담 학생 집합을 스코프로, 과목 묶음은 상담 판정과 같은 반 과목 키(`classKeysOfGroups`)를 축으로 넘긴다.
 * 🔴 `assignedClassCount`(칸반 배정)로 세지 말 것 — 미래 시작·휴원 수강까지 '배정'이라 재원과 다르다.
 * 조회가 실패하면 null(화면이 '—') — 관리현황 전체를 죽이지 않고 0명으로 위장하지도 않는다.
 */
export async function loadAttendingCounter(subjects: readonly SubjectSetting[], today: string): Promise<AttendingCounter | null> {
  try {
    const rows = await loadActiveEnrolledEnrollments();
    const keysOf = new Map<string, string[]>();
    return (studentIds, group) => {
      if (studentIds.length === 0) return 0;
      // 축이 빈 배열이면 좁히지 않는다(어느 반이든 — 전체 칸) · 묶음이면 그 묶음 반 과목 키만.
      let axis: string[] = [];
      if (group) {
        axis = keysOf.get(group) ?? classKeysOfGroups([group], subjects);
        keysOf.set(group, axis);
      }
      return enrolledSubjectCounts(rows, { studentIds: [...studentIds], subjects: axis }, today).students;
    };
  } catch (error) {
    reportWarning("관리현황 재원 조회 실패", { scope: "enrollment.managementAttending", cause: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
