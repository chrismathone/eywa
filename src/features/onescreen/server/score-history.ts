import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrendHistoryRow } from "../trend-comment";
import type { TrendReportRow } from "../report-trend";

/**
 * 추세용 점수 이력 — 같은 학생·과목의 저장 보고서 최근 N(beforeDate 이전, exam_info 있는 것) 날짜 오름차순.
 * 과목 매칭: native math("math")는 legacy 임포트(subject=null, 대부분 수학)도 포함(progress ingest 동형).
 * 그 외 과목은 정확 매칭(혼선 방지), 미지정이면 null-subject만. generateReportComment(추세 섹션)·testPrompt 공용.
 */
export async function fetchScoreHistory(
  supabase: SupabaseClient,
  studentId: string,
  subject: string | undefined,
  beforeDate: string,
  limit = 10,
): Promise<TrendHistoryRow[]> {
  let q = supabase
    .from("lesson_reports")
    .select("report_date, exam_info, homework_score")
    .eq("student_id", studentId)
    .lt("report_date", beforeDate)
    .not("exam_info", "is", null)
    .order("report_date", { ascending: false })
    .limit(limit);
  if (!subject) q = q.is("subject", null);
  else if (subject === "math") q = q.or("subject.eq.math,subject.is.null");
  else q = q.eq("subject", subject);
  const { data } = await q;
  return (data ?? [])
    .map((r) => ({
      date: r.report_date as string,
      examInfo: (r.exam_info as string | null) ?? null,
      homeworkScore: (r.homework_score as string | null) ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 학부모 보고서 성적 추이 그래프용 이력 — 같은 학생·과목의 저장 보고서(reportDate **이하**, 현재 회차 포함) 최근 N.
 * fetchScoreHistory와 달리 (1) `exam_info` NOT NULL 강제 없음(과제-only 행 포함) (2) 현재 보고서까지 포함(inclusive).
 * 과목 매칭은 동일(math는 legacy null 포함, 그 외 정확). tenantId를 주면 tenant 필터 추가 —
 * `/r`(admin=service_role, RLS 우회)에서 **테넌트 격리 필수**. `/print`(RLS 클라이언트)는 생략 가능.
 * buildTrendPoints(report-trend.ts)가 이 rows를 파싱·정렬. id는 현재 회차 강조(isCurrent) 판정용.
 */
export async function fetchReportTrendRows(
  supabase: SupabaseClient,
  studentId: string,
  subject: string | null | undefined,
  reportDate: string,
  opts: { tenantId?: string; limit?: number } = {},
): Promise<TrendReportRow[]> {
  const limit = opts.limit ?? 10;
  let q = supabase
    .from("lesson_reports")
    .select("id, report_date, exam_info, homework_score")
    .eq("student_id", studentId)
    .lte("report_date", reportDate)
    .or("exam_info.not.is.null,homework_score.not.is.null")
    .order("report_date", { ascending: false })
    .limit(limit);
  if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
  if (!subject) q = q.is("subject", null);
  else if (subject === "math") q = q.or("subject.eq.math,subject.is.null");
  else q = q.eq("subject", subject);
  const { data } = await q;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    date: r.report_date as string,
    examInfo: (r.exam_info as string | null) ?? null,
    homeworkScore: (r.homework_score as string | null) ?? null,
  }));
}
