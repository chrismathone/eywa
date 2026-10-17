import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchInChunks } from "@/lib/supabase/batch";
import { applyTodaysMathFill, type TodaysMathFillRow } from "../todays-math-fill-rules";

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
