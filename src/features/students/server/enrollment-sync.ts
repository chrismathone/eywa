import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { explainDbError } from "@/lib/supabase/db-error";
import { reasonKeyOf } from "@/features/withdrawals/reason-key";

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

/** DB 오류 → 화면용 한글 이유 + 로그([[#138]]). 이 모듈의 문자열 오류는 학생 상세·퇴원관리 화면에 그대로 뜬다. */
function why(error: unknown, step: string, context: Record<string, unknown>): string {
  return explainDbError(error, {
    scope: `students.enrollmentSync.${step}`,
    context, // 퇴원 예약 크론은 이 한글 문구만 받으니 어느 학생인지는 여기서 남긴다
    fallback: "수강 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  }).message;
}

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
    // 세부 사유·종료 메모도 함께 비운다(0367a) — 다시 연 수강을 나중에 메모 없이 닫으면 옛 메모가 퇴원관리 명단에 되살아난다.
    .update({ end_date: null, withdrawal_reason: null, withdrawal_detail: null, withdrawal_memo: null, on_hold: false })
    .eq("student_id", studentId)
    .eq("end_date", withdrawnDate);
  return error ? why(error, "reopen", { studentId }) : null;
}

/**
 * 퇴원 사유를 고칠 때, 그 퇴원이 함께 닫은 수강의 사유도 같은 사유로 맞춘다 — 퇴원일에 끝난 줄 중 반 이동이 아니고 사유가
 * 옛 사유와 같은 키인 것만(그 전에 따로 끝난 수강·다른 사유로 끝난 줄은 그대로). 퇴원율·시간표 X는 수강 사유도 읽어서
 * (`excusedReasonOf` — 둘 중 하나라도 뺄 사유면 뺀다) 학생 사유만 바꾸면 '졸업'에서 고친 퇴원이 계속 빠진다(2026-10-15 리뷰).
 * 고친 줄 수를 돌려준다.
 */
export async function syncWithdrawalEnrollmentReasons(
  supabase: Supabase,
  studentId: string,
  withdrawnDate: string | null,
  fromReason: string | null | undefined,
  toReason: string,
): Promise<{ count: number; error?: string }> {
  const from = reasonKeyOf(fromReason);
  if (!withdrawnDate || !from || from === reasonKeyOf(toReason)) return { count: 0 };
  const { data, error } = await supabase
    .from("enrollments")
    .select("id, withdrawal_reason")
    .eq("student_id", studentId)
    .eq("end_date", withdrawnDate)
    .eq("is_transferred", false);
  if (error) return { count: 0, error: why(error, "reasonSyncRead", { studentId }) };
  const ids = (data ?? []).filter((r) => reasonKeyOf(r.withdrawal_reason) === from).map((r) => r.id);
  if (!ids.length) return { count: 0 };
  const { error: upErr } = await supabase.from("enrollments").update({ withdrawal_reason: toReason }).in("id", ids);
  return upErr ? { count: 0, error: why(upErr, "reasonSync", { studentId }) } : { count: ids.length };
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
  return error ? why(error, "clearOnHold", { studentId }) : null;
}

/**
 * 수강 **한 건** 종료 — 수업 탭 '수강 종료'(endSingleEnrollment)와 퇴원 다이얼로그의 **부분 종료**가
 * 공유하는 원시함수.
 *
 * 🔴 새 종료 로직을 또 짜지 말 것(#77) — 표면마다 따로 구현하면 한쪽만 고쳐진다. 종료 규약(클램프·
 * withdrawal_reason)이 여기 한 곳에 있어야 두 경로가 같은 행을 남긴다.
 *
 * ⚠️ 미래 시작(배정 예정) 수강을 date로 종료하면 daterange(start_date, date)가 lower>upper라 throw
 * ("range lower bound must be less than or equal to range upper bound") → end_date=max(start_date, date)로
 * 클램프(미래 시작 건은 start_date로 종료 = zero-length = 사실상 배정 취소).
 * students의 closeActiveEnrollmentsClamped와 동일 원리.
 */
export async function endEnrollmentById(
  supabase: Supabase,
  enrollmentId: string,
  date: string,
  reason: string,
  /**
   * 세부 사유·메모(0367a) — 넘긴 호출부만 쓴다(학생 상태 전환 창의 부분 종료). 안 넘기면 두 칸을 건드리지 않는다
   * (반 화면의 수강 종료 등 다른 호출부는 그대로).
   */
  notes?: { detail: string | null; memo: string | null },
  expectedStudentId?: string,
): Promise<{
  error: string | null;
  /** 실제 저장된 종료일(클램프 반영) — 감사로그에 그대로 싣는다. */
  endDate?: string;
  classId?: string | null;
  studentId?: string | null;
}> {
  const { data: enr, error: selErr } = await supabase
    .from("enrollments")
    .select("start_date, class_id, student_id")
    .eq("id", enrollmentId)
    .maybeSingle();
  if (selErr) return { error: why(selErr, "endOne.read", { enrollmentId }) };
  if (!enr || (expectedStudentId && enr.student_id !== expectedStudentId)) return { error: "수강 기록을 찾을 수 없습니다" };

  const endDate = enr && String(enr.start_date) > date ? String(enr.start_date) : date;
  const { error } = await supabase
    .from("enrollments")
    .update({
      end_date: endDate,
      withdrawal_reason: reason,
      ...(notes ? { withdrawal_detail: notes.detail, withdrawal_memo: notes.memo } : {}),
    })
    .eq("id", enrollmentId);
  if (error) return { error: why(error, "endOne", { enrollmentId }) };

  return {
    error: null,
    endDate,
    classId: (enr?.class_id as string | null) ?? null,
    studentId: (enr?.student_id as string | null) ?? null,
  };
}

/**
 * 학생의 **활성(end_date null) 수강** 목록 — 퇴원/부분 종료가 "무엇을 닫을지" 정하고 감사로그에 남기는 재료.
 * 판정 기준을 closeActiveEnrollmentsClamped(`end_date is null`)와 **같게** 유지할 것 —
 * 갈리면 화면이 보여준 목록과 실제로 닫히는 행이 어긋난다.
 */
export async function listOpenEnrollments(
  supabase: Supabase,
  studentId: string,
): Promise<{ error: string | null; rows: { id: string; classId: string | null; onHold: boolean }[] }> {
  // 한 학생의 열린 수강이라 수십 행 미만이지만, 결과를 whitelist로 쓰므로 명시 상한을 둔다(B2 취지).
  // `on_hold`는 부분 휴원(setStudentEnrollmentHolds)이 **지금 상태와의 차이만** 쓰기 위한 재료다 —
  // 이미 대기인 행을 또 쓰면 감사로그가 같은 사실로 부풀고, 되돌릴 행을 못 찾는다.
  const { data, error } = await supabase
    .from("enrollments")
    .select("id, class_id, on_hold")
    .eq("student_id", studentId)
    .is("end_date", null)
    .limit(200);
  if (error) return { error: why(error, "listOpen", { studentId }), rows: [] };
  return {
    error: null,
    rows: (data ?? []).map((r) => ({
      id: r.id as string,
      classId: (r.class_id as string | null) ?? null,
      onHold: (r.on_hold as boolean | null) === true,
    })),
  };
}

/**
 * 학생의 활성(end_date null) 수강을 date로 종료한다. ⚠️ 미래 시작(start_date > date) 수강에
 * end_date=date를 넣으면 daterange(start_date, date)가 lower>upper로 throw("range lower bound must be
 * less than or equal to range upper bound") → 그 건은 end_date=start_date(zero-length=미활성=사실상 취소)로 클램프.
 * 🔑 퇴원 저장(오늘·과거 퇴원일)과 퇴원 예약 cron(`apply-due-withdrawals`)이 이 한 함수를 쓴다.
 * (admin 데이터정리 closeOrphanEnrollments와 동일 원리 — 그쪽은 다중 학생 청크판.) date 없으면 원래 동작(미종료).
 */
export async function closeActiveEnrollmentsClamped(
  supabase: Supabase,
  studentId: string,
  date: string | null,
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  if (!date) {
    const { error } = await supabase
      .from("enrollments")
      .update({ end_date: null, ...extra })
      .eq("student_id", studentId)
      .is("end_date", null);
    return error ? why(error, "closeActive.reopen", { studentId }) : null;
  }
  // 정상(시작일 ≤ date): 일괄 end_date=date.
  const { error } = await supabase
    .from("enrollments")
    .update({ end_date: date, ...extra })
    .eq("student_id", studentId)
    .is("end_date", null)
    .lte("start_date", date);
  if (error) return why(error, "closeActive", { studentId });
  // 미래 시작(배정 예정): 행마다 start_date가 달라 개별 종료(end_date = 그 수강의 start_date).
  const { data: future, error: fErr } = await supabase
    .from("enrollments")
    .select("id, start_date")
    .eq("student_id", studentId)
    .is("end_date", null)
    .gt("start_date", date);
  if (fErr) return why(fErr, "closeActive.future.read", { studentId });
  for (const e of future ?? []) {
    const { error: uErr } = await supabase
      .from("enrollments")
      .update({ end_date: e.start_date, ...extra })
      .eq("id", e.id);
    if (uErr) return why(uErr, "closeActive.future", { studentId });
  }
  return null;
}
