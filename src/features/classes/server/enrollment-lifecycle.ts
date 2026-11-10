// 반 폐지/종강 ↔ 수강(enrollments) 생명주기 동기화.
//
// 배경: archiveClass(is_active)·endClassTerm(closed_at)은 오래도록 classes 플래그만 바꿔, 그 반 학생의
// 수강이 end_date=NULL(=수강중)로 영영 남았다. 시간표는 반을 숨기는데 학생목록·학생상세·등록상담은
// 그 반 과목/강사를 계속 "수강중"으로 표시하는 사각지대(2026-07-15 원장 제보).
//
// 규칙(원장 확정):
//  · 폐지·종강 = 그 반 활성 수강을 종료한다. 폐지는 오늘, 종강은 종강일로.
//  · 학생 상태(students.status)는 **건드리지 않는다.** 활성 수강이 0이 된 학생은 재원인 채로 남아
//    대시보드 '반 미배정 재원생'(0097a)에 잡히고, 원장이 거기서 새 반에 배정한다.
//    ⚠️ 자동 퇴원 처리 금지 — 퇴원시키면 새 반 배정 경로가 학생을 재원으로 되돌리지 않아
//    (createEnrollment는 status를 안 만짐) 배정하고도 학생목록(기본 필터=재원)에서 사라진다.
//  · 과목 이탈(퇴원관리 '수강종료') 판정은 기존 getEndedSubjects를 그대로 태운다 — 그 과목에 활성
//    수강이 남아있으면 이탈 아님, 하나도 없으면 그 과목 이탈이 맞다(원장 확정). 별도 제외 장치 없음.
import type { createClient } from "@/lib/supabase/server";
import { explainDbError } from "@/lib/supabase/db-error";

type Db = Awaited<ReturnType<typeof createClient>>;

/** 폐지가 자동 종료한 수강 표식 — 재운영 복원의 매칭 키(사람이 고른 사유와 겹치지 않는 문구). */
export const ARCHIVE_REASON = "반 폐지";
/** 종강이 자동 종료한 수강 표식 — 재개강 복원의 매칭 키. */
export const CLOSE_TERM_REASON = "종강";

/** GiST enrollments_no_overlap 등 DB 원문 에러를 한글로. UI에 raw 노출 금지(작업 선호). */
function toKorean(error: { message?: string; code?: string }, step: string): string {
  const message = error.message ?? "";
  if (message.includes("conflicting_period")) {
    return "같은 학생의 다른 수강과 기간이 겹쳐 복원할 수 없습니다. 학생 상세에서 수강을 직접 정리해 주세요.";
  }
  if (message.includes("range lower bound")) {
    return "수강 종료일이 시작일보다 빠릅니다. 날짜를 확인해 주세요.";
  }
  if (/enrollments_no_overlap|exclusion constraint/i.test(message)) {
    return "같은 반에 기간이 겹치는 수강이 있어 처리할 수 없습니다. 학생 상세 '수업' 탭에서 수강 기간을 정리해 주세요.";
  }
  // 매핑 못 한 원문은 화면에 그대로 내보내지 않는다(영문 DB 에러 노출 금지) — 공용 판정 + scope 로그([[#138]]).
  return explainDbError(error, {
    scope: `classes.enrollmentLifecycle.${step}`,
    fallback: "수강 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  }).message;
}

/**
 * 폐지/종강이 자동 종료한 수강만 골라 되살린다(재운영·재개강).
 * reason 표식이 매칭 키 — 그 전에 수동 종료·반이동으로 끝난 수강은 건드리지 않는다
 * (students의 reopenEnrollmentsClosedByWithdrawal이 퇴원일로 매칭하는 것과 같은 원리).
 */
export async function reopenClassEnrollments(
  db: Db,
  classId: string,
  reason: string,
): Promise<{ error?: string; studentIds: string[] }> {
  const { data, error } = await db.rpc("reopen_class_enrollments", { p_class: classId, p_reason: reason });
  if (error) return { error: toKorean(error, "reopen"), studentIds: [] };
  return { studentIds: [...new Set(((data ?? []) as { student_id: string }[]).map((r) => r.student_id))] };
}
