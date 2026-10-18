import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFeatureOptedIn } from "@/lib/license/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import type { UnifiedRow } from "../model";
import { todaysMathCandidate, todaysMathMarkedKeys, type TodaysMathMarkRow } from "../todays-math-marks";

const COLUMNS = "student_id, kind, test_date, absent, score, max_score, correct_count, question_count";

/**
 * 성적 현황 한 쪽(화면에 선 줄만)의 '오늘 수학' 표시 줄 key. 켜는 조건 = 지점 라이선스 ∧ 오늘 수학 채우기 토글(일일·확인 =
 * '원스크린 시험 칸 채우기', 월말 = '성적관리 월말평가 채우기') — 원장 *"모든 배선이 on 상태라면"*. 꺼져 있으면 조회 없음.
 * 표는 서버 전용(정책 없는 RLS)이라 admin으로 읽고 지점 id를 건다. 🔴 표시 전용이라 실패는 빈 배열(성적 화면은 그대로).
 * 조회 폭: 일일·확인은 **화면 줄의 날짜만**, 월말은 **화면 줄의 달만** — 달 통째로 읽으면 50명 × 한 달이 1,000행을 넘어
 * 조용히 잘린다([[#54]]). 그래도 넘칠 수 있어 페이징(`fetchAllPagedInChunks`)으로 읽는다.
 */
export async function loadTodaysMathMarks(rows: readonly UnifiedRow[]): Promise<string[]> {
  if (!rows.some(todaysMathCandidate)) return []; // 수학 일일·확인·월말 줄이 없으면 설정·라이선스도 안 읽는다
  try {
    const user = await getCurrentUser({ teacherView: true });
    if (!user) return [];
    const [settings, licensed] = await Promise.all([getTenantSettings(), isFeatureOptedIn(user.tenantId, "todays_math")]);
    if (!licensed) return [];
    const candidates = rows.filter((r) => todaysMathCandidate(r)
      && (r.kind === "monthly" ? settings.report.todaysMathMonthlyFill : settings.report.todaysMathTestFill));
    const tests = candidates.filter((r) => r.kind !== "monthly");
    const monthly = candidates.filter((r) => r.kind === "monthly");
    const ids = (subset: UnifiedRow[]) => [...new Set(subset.map((r) => r.studentId))];
    const base = (chunk: string[]) => createAdminClient().from("todays_math_test_results").select(COLUMNS).eq("tenant_id", user.tenantId).in("student_id", chunk);
    const dates = [...new Set(tests.map((r) => r.date))];
    const months = [...new Set(monthly.map((r) => r.date.slice(0, 7)))];
    const [testResults, monthlyResults] = await Promise.all([
      tests.length ? fetchAllPagedInChunks<TodaysMathMarkRow>(ids(tests), (chunk, from, to) =>
        base(chunk).in("kind", ["daily", "review"]).in("test_date", dates).order("source_test_id").order("student_id").range(from, to)) : [],
      monthly.length ? fetchAllPagedInChunks<TodaysMathMarkRow>(ids(monthly), (chunk, from, to) =>
        base(chunk).eq("kind", "monthly").or(months.map((m) => `and(test_date.gte.${m}-01,test_date.lte.${monthEnd(m)})`).join(","))
          .order("source_test_id").order("student_id").range(from, to)) : [],
    ]);
    return todaysMathMarkedKeys(candidates, [...testResults, ...monthlyResults]);
  } catch (e) {
    console.error("[grades] 오늘 수학 표시 조회 실패 — 표시하지 않는다", e instanceof Error ? e.message : "unknown");
    return [];
  }
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(y!, m!, 0)).getUTCDate()).padStart(2, "0")}`;
}
