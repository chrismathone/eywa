import type { SupabaseClient } from "@supabase/supabase-js";
import { keepExamOfClass, type TrendHistoryRow } from "../trend-comment";
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
 * 이 학원의 **특강 반 id 목록**(`classes.is_special`, 0133a). 추세를 정규/특강으로 가르는 축.
 * 반 수가 극소수(실측 3)라 매번 조회해도 저렴하다. 없으면 빈 배열 = 기존 동작(안 가름).
 */
export async function fetchSpecialClassIds(
  supabase: SupabaseClient,
  // admin(service_role)로 부를 땐 **필수** — RLS를 우회하므로 남의 학원 특강 id가 섞이면
  // 그 id로 이 학원 기록을 걸러 추이가 조용히 빈다(#B6 계열 격리 규약).
  tenantId?: string,
): Promise<string[]> {
  let q = supabase.from("classes").select("id").eq("is_special", true);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q;
  return (data ?? []).map((r) => r.id as string).filter((id) => UUID_RE.test(id));
}

/** `.or()`는 값 인코딩 없는 **원시 필터 문자열**이라 id를 그대로 끼워 넣는다 → uuid만 통과시킨다(주입 방지). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 정규/특강 분리 필터를 쿼리에 건다(2026-07-23 원장 지시: "정규와 특강을 분리시켜").
 * ⚠️ 2026-10-15부터 **시험 점수는 그 보고서 반의 기록만** 쓴다(keepExamOfClass — 행을 받은 뒤 시험 칸만 비운다). 여기 쿼리는
 *    과제 수행률 표본(같은 과목 정규 반끼리)을 그대로 두려고 정규 반끼리는 계속 함께 받는다.
 *  · 대상이 **특강 보고서**(classId가 특강 목록에 있음) → **그 반 기록만**. 정규 성적을 빌려오지 않는다
 *    (특강 첫 수업에 추세가 안 나오는 건 정상 — 다른 수업 점수로 추세를 지어내는 게 더 나쁘다).
 *  · 대상이 **정규**(또는 반 미상) → 특강 반 기록만 제외. 나머지는 그대로.
 * 🔴 `class_id.not.in.(…)`만 쓰면 **NULL 행이 통째로 탈락**한다(SQL에서 NULL NOT IN … = NULL).
 *    이관분 17,478행이 전부 class_id NULL이라 그러면 거의 모든 학생의 추세가 붕괴한다 →
 *    반드시 `class_id.is.null` 분기를 OR로 함께 둔다.
 */
function applyClassScope<Q extends { or: (f: string) => Q; eq: (c: string, v: string) => Q }>(
  q: Q,
  classId: string | null | undefined,
  specialClassIds: readonly string[],
): Q {
  const cid = classId?.trim();
  if (cid && specialClassIds.includes(cid)) return q.eq("class_id", cid);
  const specials = specialClassIds.filter((id) => UUID_RE.test(id));
  if (specials.length === 0) return q;
  return q.or(`class_id.is.null,class_id.not.in.(${specials.join(",")})`);
}

/**
 * 추세용 점수 이력 — 같은 학생·과목의 저장 보고서, **beforeDate 기준 최근 30일 윈도** 안에서 최근 N
 * (beforeDate 이전, 시험 **또는 과제** 기록 있는 것) 날짜 오름차순.
 * ⚠️ 2026-07-22까지 `exam_info is not null`만 받았다 — 그런데 buildTrendInput은 '과제 흐름' 줄을 따로
 * 만들고 프롬프트도 그걸 쓰라고 지시한다. 즉 **과제만 기록된 날이 통째로 버려져 과제 흐름이 체계적으로
 * 불완전**했다(실측 최근 30일: 시험 있는 행 651 vs 과제만 있는 행 853 = 57% 유실. 윤수빈은 과제 0%가
 * 13회 연속인데 추세엔 2회만 등장). 그래프(fetchReportTrendRows)는 이미 둘 다 받으므로 표본도 어긋났다
 * — 아래 필터를 그래프와 같은 규약으로 맞춘다("그래프와 서술이 다른 기간을 말하지 않게").
 * 과목 매칭: native math("math")는 legacy 임포트(subject=null, 대부분 수학)도 포함(progress ingest 동형).
 * 그 외 과목은 정확 매칭(혼선 방지), 미지정이면 null-subject만. generateReportComment(추세 섹션)·testPrompt 공용.
 */
export async function fetchScoreHistory(
  supabase: SupabaseClient,
  studentId: string,
  subject: string | undefined,
  beforeDate: string,
  // 30일 윈도를 넉넉히 덮는 상한(실측 학생당 평균 7.4행, 최대치도 30 미만). 흐름별 최근 N개를 고르는 건
  // buildTrendInput(순수)이 하므로 여기서 자르면 시험 기록이 과제-only 행에 밀려 사라진다(실측 26/215명).
  limit = 30,
  // 정규/특강 분리(applyClassScope). 미지정이면 기존 동작(안 가름) — 데모·구 호출부 보존.
  scope?: { classId?: string | null; specialClassIds?: readonly string[] },
): Promise<TrendHistoryRow[]> {
  const windowStart = windowStartOf(beforeDate, TREND_TEXT_WINDOW_DAYS);
  if (!windowStart) return []; // 비정상 beforeDate 방어 — 추세만 조용히 생략
  let q = supabase
    .from("lesson_reports")
    .select("report_date, exam_info, homework_score, class_id, makeup_class_id")
    .eq("student_id", studentId)
    .lt("report_date", beforeDate)
    .gte("report_date", windowStart)
    .or("exam_info.not.is.null,homework_score.not.is.null")
    .order("report_date", { ascending: false })
    .limit(limit);
  if (!subject) q = q.is("subject", null);
  else if (subject === "math") q = q.or("subject.eq.math,subject.is.null");
  else q = q.eq("subject", subject);
  q = applyClassScope(q, scope?.classId, scope?.specialClassIds ?? []);
  const { data } = await q;
  const rows: TrendHistoryRow[] = (data ?? []).map((r) => ({
    date: r.report_date as string,
    examInfo: (r.exam_info as string | null) ?? null,
    homeworkScore: (r.homework_score as string | null) ?? null,
    classId: (r.class_id as string | null) ?? null,
    makeupClassId: (r.makeup_class_id as string | null) ?? null,
  }));
  // 시험은 이 보고서 반의 기록만(원장 2026-10-15 — 수요일 반 추세가 화·금 반 시험을 인용했다).
  return keepExamOfClass(rows, scope?.classId).sort((a, b) => a.date.localeCompare(b.date));
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
  // classId/specialClassIds = 정규·특강 분리(applyClassScope). 학부모 그래프도 추세 문장과 **같은 표본**을
  // 봐야 한다 — 한쪽만 가르면 "그래프와 서술이 다른 것을 말한다".
  opts: {
    tenantId?: string;
    limit?: number;
    classId?: string | null;
    specialClassIds?: readonly string[];
  } = {},
): Promise<TrendReportRow[]> {
  const limit = opts.limit ?? TREND_POINT_LIMIT;
  // 시험은 그 반 기록만 남기므로(keepExamOfClass) 넉넉히 받고 **거른 뒤에** 자른다 — 다른 반 행 중 시험만 있던 행(거르면 빈 행)이
  // 칸을 먹지 않게. ⚠️ 과제가 있는 다른 반 행은 과제 점으로 남아 칸을 쓴다(과제 수행률은 같은 과목 정규 반을 함께 보는 규칙).
  // 안전망(30일)은 "몇 달 전 점" 차단용일 뿐 — 점 개수를 정하는 건 limit(최근 7건)다.
  const windowStart = windowStartOf(reportDate, TREND_WINDOW_DAYS);
  if (!windowStart) return []; // 비정상 reportDate 방어 — throw 대신 그래프만 숨김
  let q = supabase
    .from("lesson_reports")
    .select("id, report_date, exam_info, homework_score, class_id, makeup_class_id")
    .eq("student_id", studentId)
    .lte("report_date", reportDate)
    .gte("report_date", windowStart)
    .or("exam_info.not.is.null,homework_score.not.is.null")
    .order("report_date", { ascending: false })
    .limit(opts.classId ? limit * 3 : limit);
  if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
  if (!subject) q = q.is("subject", null);
  else if (subject === "math") q = q.or("subject.eq.math,subject.is.null");
  else q = q.eq("subject", subject);
  q = applyClassScope(q, opts.classId, opts.specialClassIds ?? []);
  const { data } = await q;
  const rows: TrendReportRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    date: r.report_date as string,
    examInfo: (r.exam_info as string | null) ?? null,
    homeworkScore: (r.homework_score as string | null) ?? null,
    classId: (r.class_id as string | null) ?? null,
    makeupClassId: (r.makeup_class_id as string | null) ?? null,
  }));
  // 그래프의 시험 점도 추세 문장과 같은 표본 — 이 보고서 반의 기록만(fetchScoreHistory와 같은 규칙). 빈 행은 빼고 최근 limit건.
  return keepExamOfClass(rows, opts.classId)
    .filter((r) => r.examInfo !== null || r.homeworkScore !== null)
    .slice(0, limit);
}
