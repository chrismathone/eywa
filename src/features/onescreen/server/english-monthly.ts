import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";
import type { MonthlyEval } from "@/features/report-templates/monthly-eval";
import { pickMonthlyEvals, type MonthlyGradeRowWithClass } from "../english-monthly-pick";
import type { MonthlyActivity } from "@/features/report-templates/monthly-activity";
import { pickMonthlyActivities, type MonthlyReportRow } from "../english-monthly-activity-pick";
import { readEnglishTrack } from "@/features/classes/english-track";
import { RETEST_MARK, PILOT_ALIAS_TITLES } from "../math-report-pilot";

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

/** 한 달 학습 기록을 찾는 창 — 지난달 1일부터(월초에 지난달 보고서를 쓰는 경우까지). */
function monthWindowStart(targetDate: string): string {
  const [y, m] = targetDate.split("-").map(Number);
  return m === 1 ? `${y! - 1}-12-01` : `${y}-${String(m! - 1).padStart(2, "0")}-01`;
}

/**
 * 원스크린 영어 행의 **한 달 학습 기록**(EiE 월간 보고서, 원장 2026-11-06) — `반|학생` → 그 달 숙제·태도·단어 테스트.
 *
 * 🔴 원스크린은 모든 선생님이 매일 여는 화면이다([[#95]]) — **EiE 반만** 읽고(인재원 영어 반은 월간 보고서가 없다),
 *    실패하면 빈 결과로 끝난다(월간 템플릿의 기록 줄만 빠진다). Monthly Test 조회와 나란히 돈다(B4).
 * 🔑 재시험은 글 속 표시(단어 테스트 항목 맨 윗줄 `[재시험]`)로만 남아 있어 그 글이 있는 줄만 따로 좁혀 읽는다(본문 전체를 받지 않게).
 */
export async function loadEnglishMonthlyActivities(
  tenantId: string,
  englishClassIds: string[],
  targetDate: string,
  // 그 학생의 Monthly Test 달 — 점수 조회와 나란히 돌리려고 약속으로 받아 고르기 직전에 기다린다(B4).
  monthOfP: Promise<(key: string) => string | undefined>,
): Promise<Map<string, MonthlyActivity>> {
  if (!englishClassIds.length) return new Map();
  try {
    const admin = createAdminClient();
    const classes = await fetchInChunks<{ id: string; english_track: string | null }>(englishClassIds, (chunk) =>
      admin.from("classes").select("id, english_track").eq("tenant_id", tenantId).in("id", chunk),
    );
    const eieIds = classes.filter((c) => readEnglishTrack(c) === "eie").map((c) => c.id);
    if (!eieIds.length) return new Map();
    const from = monthWindowStart(targetDate);
    const [rows, retestRows] = await Promise.all([
      fetchAllPagedInChunks<MonthlyReportRow>(eieIds, (chunk, lo, hi) =>
        admin
          .from("lesson_reports")
          .select("student_id, class_id, report_date, homework_score, attitude, daily_test")
          .eq("tenant_id", tenantId)
          .in("class_id", chunk)
          .is("revoked_at", null)
          .gte("report_date", from)
          .lt("report_date", targetDate)
          .order("id")
          .range(lo, hi),
      ),
      fetchAllPagedInChunks<{ student_id: string; class_id: string | null; report_date: string }>(eieIds, (chunk, lo, hi) =>
        admin
          .from("lesson_reports")
          .select("student_id, class_id, report_date")
          .eq("tenant_id", tenantId)
          .in("class_id", chunk)
          .is("revoked_at", null)
          .gte("report_date", from)
          .lt("report_date", targetDate)
          .like("notes", `%■ ${PILOT_ALIAS_TITLES.daily}\n${RETEST_MARK}%`)
          .order("id")
          .range(lo, hi),
      ),
    ]);
    const retestKeys = new Set(retestRows.map((r) => `${r.class_id}|${r.student_id}|${r.report_date}`));
    return pickMonthlyActivities(rows, retestKeys, targetDate, await monthOfP);
  } catch (err) {
    console.warn("[onescreen] 한 달 학습 기록 조회 실패 —", err instanceof Error ? err.message : String(err));
    return new Map();
  }
}
