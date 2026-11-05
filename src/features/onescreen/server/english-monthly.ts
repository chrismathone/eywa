import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";
import type { MonthlyEval } from "@/features/report-templates/monthly-eval";
import { pickMonthlyEvals, type MonthlyGradeRowWithClass } from "../english-monthly-pick";

/** 지난 Monthly Test를 찾아보는 창 — 월초에 지난달 시험 보고서를 쓰는 경우(시트 실례: 11/2에 10월 점수)까지. */
const LOOKBACK_DAYS = 45;

/**
 * 원스크린 영어 행의 **Monthly Test 점수**(EiE 월간 보고서, 2026-11-05) — `반|학생` → 점수.
 *
 * 🔴 원스크린은 모든 선생님이 매일 여는 화면이다([[#95]]) — 영역 점수 칸(s2_0023)이 아직 없거나 조회가 실패해도
 *    **빈 결과**로 끝난다(월간 템플릿의 점수 줄만 빠진다). 본 로스터 조회와 따로 돌린다.
 * 🔑 admin으로 읽는다 — 반 id는 로스터가 이미 이 선생님 담당 반으로 좁혔고, 격리는 tenant 조건이 맡는다.
 */
export async function loadEnglishMonthlyEvals(
  tenantId: string,
  englishClassIds: string[],
  targetDate: string,
): Promise<Map<string, MonthlyEval>> {
  if (!englishClassIds.length) return new Map();
  try {
    const admin = createAdminClient();
    const rows = await fetchInChunks<MonthlyGradeRowWithClass>(englishClassIds, (chunk) =>
      admin
        .from("student_grades")
        .select("student_id, class_id, school_year, exam_month, taken_on, max_score, area_scores")
        .eq("tenant_id", tenantId)
        .eq("subject", "english")
        .eq("exam_slot", "monthly")
        .in("class_id", chunk)
        .gte("taken_on", addDays(targetDate, -LOOKBACK_DAYS))
        .lte("taken_on", targetDate),
    );
    return pickMonthlyEvals(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 영역 칸 미적용은 정상 경로(SQL을 아직 안 돌렸다) — 로그를 쌓지 않는다.
    if (!/area_scores|exam_month/.test(msg)) console.warn("[onescreen] Monthly Test 점수 조회 실패 —", msg);
    return new Map();
  }
}
