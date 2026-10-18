import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchInChunks } from "@/lib/supabase/batch";
import { applyTodaysMathFill, todaysMathSameOnSave, type TodaysMathFillRow } from "../todays-math-fill-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureOptedIn } from "@/lib/license/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { LEGACY_REPORT_SUBJECT } from "@/features/timetable/lib/report-subject";

/**
 * 원스크린 로스터 — 그날 오늘 수학 채점 결과(`todays_math_test_results`, 0371a)를 읽는다.
 *
 * 켜는 조건 둘(호출부가 확인): 학원 설정 → 연동 → 오늘 수학 '시험 결과 채우기'(`report.todaysMathTestFill`) ∧ 지점 라이선스.
 * 🔴 fail-soft — 이 로스터는 강사 전원이 매일 여는 화면이다([[#95]]). 표가 없거나 조회가 실패하면 빈 결과(채우지 않는다).
 * 표는 정책 없는 RLS(서버 전용)라 admin으로 읽고 지점 id를 반드시 건다.
 */
export async function loadTodaysMathFill(
  admin: SupabaseClient,
  tenantId: string,
  date: string,
  studentIds: string[],
): Promise<TodaysMathFillRow[]> {
  if (studentIds.length === 0) return [];
  try {
    return await fetchInChunks<TodaysMathFillRow>(studentIds, (chunk) =>
      admin
        .from("todays_math_test_results")
        .select("student_id, class_id, kind, question_count, absent, correct_count, taken_at")
        .eq("tenant_id", tenantId)
        .eq("test_date", date)
        .in("kind", ["daily", "review"])
        .in("student_id", chunk),
    );
  } catch (e) {
    console.error("[onescreen] 오늘 수학 결과 조회 실패 — 채우지 않는다", e instanceof Error ? e.message : "unknown");
    return [];
  }
}

export { applyTodaysMathFill };

/**
 * 보고서 저장 감사로그에 붙일 출처 표시(2026-10-18) — 저장한 일일·확인 칸 중 그날 오늘 수학 결과와 같은 칸.
 * 채우기 토글 ∧ 라이선스 ∧ 수학 행 ∧ 시험 글이 있을 때만 조회한다(꺼진 학원은 조회 0 — 저장은 강사 전원의 매일 경로다).
 * 🔴 실패해도 저장을 막지 않는다 — 빈 배열(표시 없음).
 */
export async function todaysMathSameForReport(
  tenantId: string,
  saved: { studentId: string; classId: string | null; subject: string | null; date: string; dailyTest?: string | null; checkTest?: string | null },
): Promise<("daily" | "check")[]> {
  try {
    if ((saved.subject?.trim() || LEGACY_REPORT_SUBJECT) !== LEGACY_REPORT_SUBJECT) return [];
    if (!saved.dailyTest?.trim() && !saved.checkTest?.trim()) return [];
    const settings = await getTenantSettings();
    if (!settings.report.todaysMathTestFill || !(await isFeatureOptedIn(tenantId, "todays_math"))) return [];
    const rows = await loadTodaysMathFill(createAdminClient(), tenantId, saved.date, [saved.studentId]);
    return todaysMathSameOnSave(rows, saved);
  } catch {
    return [];
  }
}
