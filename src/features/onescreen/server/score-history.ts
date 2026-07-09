import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrendHistoryRow } from "../trend-comment";

/**
 * 추세용 점수 이력 — 같은 학생·과목의 저장 보고서 최근 N(beforeDate 이전, exam_info 있는 것) 날짜 오름차순.
 * 과목 매칭: native math("math")는 legacy 임포트(subject=null, 대부분 수학)도 포함(progress ingest 동형).
 * 그 외 과목은 정확 매칭(혼선 방지), 미지정이면 null-subject만. generateTrendComment·testPrompt 공용.
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
