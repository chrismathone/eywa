import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * 학생 상태 ↔ 수강(enrollments) 정합성 헬퍼.
 *
 * ⚠️ 왜 별도 모듈인가: 호출부인 `students/server/actions.ts`·`withdrawals/server/actions.ts`가 둘 다
 * `"use server"`라 그 파일에서 일반 함수를 export할 수 없다(모든 export가 async 서버 액션이어야 함).
 * 두 경로가 **같은 불변식**을 공유해야 하므로(2026-07-30 적대 리뷰: 퇴원관리의 '재원 복구'가
 * students만 되돌리고 수강 재개를 안 해서, 같은 동작인데 어느 화면에서 눌렀느냐로 결과가 갈렸다)
 * 여기 한 곳에 둔다.
 */
type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * 재원 복구 시, 그 퇴원(withdrawnDate)이 닫은 enrollment를 다시 연다.
 * 퇴원은 활성 enrollment를 end_date=퇴원일로 닫으므로, 복구는 **그 날짜로 닫힌 것만** 되돌린다
 * (그 이전에 개별 종료된 과거 수강은 유지). 안 하면 학생은 재원인데 수강이 종료로 남아
 * 시간표 셀 '퇴원' 섹션에 계속 뜬다. withdrawnDate가 없으면(휴원→재원 등) no-op.
 */
export async function reopenEnrollmentsClosedByWithdrawal(
  supabase: Supabase,
  studentId: string,
  withdrawnDate: string | null,
): Promise<string | null> {
  if (!withdrawnDate) return null;
  const { error } = await supabase
    .from("enrollments")
    .update({ end_date: null, withdrawal_reason: null, on_hold: false })
    .eq("student_id", studentId)
    .eq("end_date", withdrawnDate);
  return error?.message ?? null;
}

/**
 * 재원 복구의 나머지 절반 — 아직 활성인 수강의 on_hold를 푼다(휴원 경유 복구 대응).
 * reopen…과 짝으로 호출해야 "재원인데 휴원 표시"가 안 남는다.
 */
export async function clearOnHoldForActiveEnrollments(
  supabase: Supabase,
  studentId: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("enrollments")
    .update({ on_hold: false })
    .eq("student_id", studentId)
    .is("end_date", null);
  return error?.message ?? null;
}
