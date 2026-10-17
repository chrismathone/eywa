import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFeatureOptedIn } from "@/lib/license/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import type { GradeSelection } from "../types";
import type { TodaysMathMonthly } from "../todays-math-monthly";

/**
 * 성적관리 수학 월말평가 칸 — 같은 달 오늘 수학 월말평가 결과(`todays_math_test_results`, 0371a·0372a)를 읽는다(2026-10-17 · 개발 중).
 *
 * 켜는 조건: 학원 설정 → 연동 → 오늘 수학 '성적관리 월말평가 채우기'(`report.todaysMathMonthlyFill`) ∧ 지점 라이선스 ∧ 수학 · 월말평가 칸.
 * 아니면 null(화면에 단추도 없다). 🔴 여기선 읽기만 한다 — 저장은 선생님이 격자에서 평소처럼(`writeGradeCells` 단일 경로).
 * 표는 서버 전용(정책 없는 RLS)이라 admin으로 읽고 지점 id를 반드시 건다. 조회 실패 = null(성적 화면은 그대로 산다).
 */
export async function loadTodaysMathMonthly(sel: GradeSelection, studentIds: string[]): Promise<TodaysMathMonthly | null> {
  if (sel.subject !== "math" || sel.slot !== "monthly" || studentIds.length === 0) return null;
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return null;
  const [settings, licensed] = await Promise.all([getTenantSettings(), isFeatureOptedIn(user.tenantId, "todays_math")]);
  if (!settings.report.todaysMathMonthlyFill || !licensed) return null;
  const month = sel.date.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  try {
    const rows = await fetchInChunks<{ student_id: string; score: number | string; max_score: number | string | null; test_date: string; taken_at: string; title: string | null }>(
      [...new Set(studentIds)],
      (chunk) =>
        createAdminClient()
          .from("todays_math_test_results")
          .select("student_id, score, max_score, test_date, taken_at, title")
          .eq("tenant_id", user.tenantId)
          .eq("kind", "monthly")
          .eq("absent", false)
          .not("score", "is", null)
          .gte("test_date", `${month}-01`)
          .lte("test_date", `${month}-${String(last).padStart(2, "0")}`)
          .in("student_id", chunk),
    );
    const out: TodaysMathMonthly = {};
    // 한 달에 월말평가가 둘이면 마지막에 채점한 것.
    for (const r of rows.sort((a, b) => a.taken_at.localeCompare(b.taken_at))) {
      const score = Number(r.score);
      const max = r.max_score == null ? null : Number(r.max_score);
      if (!Number.isFinite(score)) continue;
      out[r.student_id] = { score, maxScore: max != null && Number.isFinite(max) ? max : null, testDate: r.test_date, title: r.title };
    }
    return out;
  } catch (e) {
    console.error("[grades] 오늘 수학 월말평가 조회 실패 — 단추를 세우지 않는다", e instanceof Error ? e.message : "unknown");
    return null;
  }
}
