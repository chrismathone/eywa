import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrendHistoryRow } from "../trend-comment";
import type { TrendReportRow } from "../report-trend";

/** 기준일 − N일(YYYY-MM-DD). 비정상 날짜면 null(호출부가 빈 결과로 처리). UTC 고정 산술 = KST 경계 무관. */
function windowStartOf(date: string, days: number): string | null {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** 학습 추세(AI 텍스트) 조회 윈도(일) — 2026-07-10 원장: 그래프 7일 제한 후 "추세 텍스트는 최근 30일".
 *  풀 이력 이전(1.6만 행) 후 무윈도 최근 10회가 몇 달 전 점수까지 인용해 그래프(7일)와 모순 서술하던 것 차단.
 *  30일 내 기록 2개 미만이면 추세 미생성(기존 표본 부족 경로와 동일). */
const TREND_TEXT_WINDOW_DAYS = 30;

/**
 * 추세용 점수 이력 — 같은 학생·과목의 저장 보고서, **beforeDate 기준 최근 30일 윈도** 안에서 최근 N
 * (beforeDate 이전, exam_info 있는 것) 날짜 오름차순.
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
  const windowStart = windowStartOf(beforeDate, TREND_TEXT_WINDOW_DAYS);
  if (!windowStart) return []; // 비정상 beforeDate 방어 — 추세만 조용히 생략
  let q = supabase
    .from("lesson_reports")
    .select("report_date, exam_info, homework_score")
    .eq("student_id", studentId)
    .lt("report_date", beforeDate)
    .gte("report_date", windowStart)
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
 * 대상 날짜 '이후'(엄밀히 초과)에 이미 채점된(exam_info 또는 homework_score 있는) 보고서가 있는지.
 * 과거 날짜 보고서 자동작성 시 **추세 반영 여부 판정** — 뒤에 이미 채점 이력이 있으면 뒤늦게 끼워넣는 과거 점이
 * 추세 그래프/서술을 흐트러뜨리므로 추세를 생성하지 않는다(원장 2026-07-14). 과목 매칭은 fetchScoreHistory와 동일
 * (math=legacy null 포함, 그 외 정확, 미지정=null-subject만). count/head라 행을 안 받음(B2). tenant는 RLS 위임.
 */
export async function hasLaterScoredReport(
  supabase: SupabaseClient,
  studentId: string,
  subject: string | undefined,
  date: string,
): Promise<boolean> {
  let q = supabase
    .from("lesson_reports")
    .select("*", { count: "exact", head: true })
    .eq("student_id", studentId)
    .gt("report_date", date)
    .or("exam_info.not.is.null,homework_score.not.is.null");
  if (!subject) q = q.is("subject", null);
  else if (subject === "math") q = q.or("subject.eq.math,subject.is.null");
  else q = q.eq("subject", subject);
  const { count } = await q;
  return (count ?? 0) > 0;
}

/**
 * 학습 추이 그래프 = **최근 N'건'**(보고서 개수). 2026-07-10에 "7일치만"으로 넣었던 게 실은 날짜 7일이라
 * 그래프에 점이 1~2개밖에 안 찍혔다(실측 2026-07-21: 최근 보고서를 받은 학생 178명 중 **73명(41%)이
 * 점 2개 미만이라 그래프가 아예 숨음**, 중앙값 2점). 원장 의도는 "최근 7**건**"이라 개수 기준으로 바꾼다.
 * ⚠️ 개수만 쓰면 기록이 드문 학생에서 몇 달 전 점이 딸려온다(2026-07-10 원래 불만) → **30일 안전망**을 함께 둔다.
 * 30일은 AI 추세 텍스트 윈도(TREND_TEXT_WINDOW_DAYS)와 같은 값 — 그래프와 서술이 다른 기간을 말하지 않게.
 */
const TREND_POINT_LIMIT = 7;
const TREND_WINDOW_DAYS = TREND_TEXT_WINDOW_DAYS;

/**
 * 학부모 보고서 학습 추이 그래프용 이력 — 같은 학생·과목의 저장 보고서 **최근 7건**
 * (30일 안전망 안에서, 현재 회차 포함). fetchScoreHistory와 달리 (1) `exam_info` NOT NULL
 * 강제 없음(과제-only 행 포함) (2) 현재 보고서까지 포함(inclusive).
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
  const limit = opts.limit ?? TREND_POINT_LIMIT;
  // 안전망(30일)은 "몇 달 전 점" 차단용일 뿐 — 점 개수를 정하는 건 limit(최근 7건)다.
  const windowStart = windowStartOf(reportDate, TREND_WINDOW_DAYS);
  if (!windowStart) return []; // 비정상 reportDate 방어 — throw 대신 그래프만 숨김
  let q = supabase
    .from("lesson_reports")
    .select("id, report_date, exam_info, homework_score")
    .eq("student_id", studentId)
    .lte("report_date", reportDate)
    .gte("report_date", windowStart)
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
