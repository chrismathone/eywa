import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isMergedStudent } from "@/features/students/merged";
import { bookkeepingOnlyIds } from "@/features/withdrawals/server/bookkeeping";
import {
  SENT_STATUS_SUCCESS,
  UNREAD_GRACE_HOURS,
  UNREAD_MATCHABLE_OR,
} from "@/features/report-admin/unread-filter";
import { buildHomeworkRisk, type HomeworkRisk } from "../homework-risk";
import { buildWeeklyChange, weeklyChangeStart, type WeeklyChangeBucket } from "../weekly-change";

/**
 * 한 화면 대시보드가 새로 필요로 하는 조회 — 지금은 **4주 등록/퇴원** 하나뿐이다.
 *
 * 🔴 기존 대시보드 조회(`features/dashboard/server/queries.ts`)를 건드리지 않고 여기 따로 둔다 —
 *    옛 화면과 새 화면이 같은 파일을 밀면 한쪽을 고칠 때 다른 쪽이 조용히 바뀐다.
 */

/**
 * 최근 4주 주별 등록·퇴원 수.
 *
 * 🔴 **집계를 JS에서 하되 창이 조회를 이미 좁힌다** — 4주면 이 학원 기준 수십 행이라 1000행 절단([[#54]])
 *    과 무관하다. 창을 넓힐 일이 생기면 그때는 group-by RPC로 옮길 것(창 없는 전건 select 금지).
 * 🔴 세는 것은 **등록 처리일**(`enrolled_at`)과 **퇴원 처리일**(`withdrawn_at`)이다 — 수강 시작일이
 *    아니다(둘을 섞으면 이 차트와 학생목록이 다른 학원이 된다, 설계서 §8-5).
 * ⚠️ 퇴원은 `status`를 보지 않고 **날짜가 그 창에 있는지**로 센다 — 퇴원했다가 복구된 학생은 지금
 *    상태가 `enrolled`라 상태로 거르면 그 주의 퇴원이 통째로 사라진다(그 주엔 실제로 나갔다).
 */
export async function getWeeklyChange(weeks = 4): Promise<WeeklyChangeBucket[]> {
  const today = kstToday();
  const from = weeklyChangeStart(today, weeks);
  const supabase = await createClient();
  const [enrolledRes, withdrawnRes] = await Promise.all([
    supabase.from("students").select("id, enrolled_at, notes, withdrawal_metadata").gte("enrolled_at", from),
    supabase.from("students").select("id, withdrawn_at, notes, withdrawal_metadata").gte("withdrawn_at", from),
  ]);
  // 🔴 조회 실패를 빈 배열로 삼키지 않는다 — 그러면 "이번 달 아무도 안 들어왔다"는 **사실 주장**이 된다.
  //    호출부(페이지)가 실패 허용 래퍼로 감싸 카드만 비운다.
  if (enrolledRes.error) throw new Error(`주별 등록 조회 실패: ${enrolledRes.error.message}`);
  if (withdrawnRes.error) throw new Error(`주별 퇴원 조회 실패: ${withdrawnRes.error.message}`);
  const ymd = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : "");
  // 🔴 중복 병합으로 흡수된 쪽은 **양쪽 모두에서** 뺀다(원장 2026-09-13) — 그 학생은 등록한 적도 그만둔
  //    적도 없다. 한쪽만 빼면 같은 사람이 등록 막대에만 남아 증감이 어긋난다(김지유B가 그랬다).
  const notMerged = (r: unknown): boolean => !isMergedStudent((r as { notes: unknown }).notes as string | null);
  // 수업 기록 없는 장부 정리(단체 정리)도 **양쪽 모두에서** 뺀다 — 병합과 같은 이유(퇴원관리·운영실과 같은 판정 — `isBookkeepingOnlyExit`).
  type Row = { id: string; enrolled_at?: unknown; withdrawn_at?: unknown; withdrawal_metadata: unknown };
  const enrolledRows = (enrolledRes.data ?? []).filter(notMerged) as Row[];
  const withdrawnRows = (withdrawnRes.data ?? []).filter(notMerged) as Row[];
  const bookkeeping = await bookkeepingOnlyIds(supabase, [...enrolledRows, ...withdrawnRows]);
  return buildWeeklyChange(
    {
      enrolledOn: enrolledRows.filter((r) => !bookkeeping.has(r.id)).map((r) => ymd(r.enrolled_at)),
      withdrawnOn: withdrawnRows.filter((r) => !bookkeeping.has(r.id)).map((r) => ymd(r.withdrawn_at)),
    },
    today,
    weeks,
  );
}

/** 며칠 전 KST 날짜(YYYY-MM-DD) — 결정적 UTC 산술(date-kst 규칙). */
function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** 숙제 신호가 보는 창(일). 🔴 화면엔 상수 이름이 아니라 이 값이 만든 문장을 적는다([[#121]]). */
export const HOMEWORK_WINDOW_DAYS = 7;
/** 학부모 미확인이 보는 창(일) — 발송 후 유예(48시간)를 넘긴 건을 이 기간 안에서 센다. */
export const UNREAD_WINDOW_DAYS = 30;

export type HomeworkRiskView = HomeworkRisk & {
  windowDays: number;
  /** 실제로 좁힌 과목 키(빈 배열 = 안 좁혔다). 🔴 화면 라벨이 **이 값**을 읽어야 필터와 글이 안 갈린다. */
  subjects: string[];
};

/**
 * 이 집계가 셀 과목 — `report.classnoteSubjects`.
 * 🔴 **fail-open**: 설정이 비었거나 조회가 실패하면 좁히지 않는다([`report-subjects.ts`](../../report-subjects)).
 *    발송 게이트 `isClassnoteSubjectEnabled`(fail-closed)를 여기 쓰면 설정이 비는 순간 신호가 "0"으로 사라진다.
 */
async function trackedSubjects(): Promise<string[]> {
  const settings = await getTenantSettings().catch(() => null);
  return (settings?.report.classnoteSubjects ?? [])
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
}

/**
 * 숙제 위험 — 최근 `HOMEWORK_WINDOW_DAYS`일 수업보고서의 `homework_score`를 학생 단위로 접는다.
 *
 * 🔴 **과목 축을 조회에서 좁힌다** — `report.classnoteSubjects`(현 운영 `['math']`)가 비어 있으면
 *    좁히지 않는다(fail-open, [`report-subjects.ts`](../../report-subjects) 규약). 🔴 발송 게이트
 *    `isClassnoteSubjectEnabled`(fail-closed)를 집계에 쓰지 말 것 — 설정이 비는 순간 신호가 조용히 사라진다.
 * 🔴 **세려고 전건을 긁지 않는다** — 창(7일)이 조회를 이미 좁히고 `fetchAllPaged`가 1,000행 절단을 막는다
 *    (실측 2026-09-10: 30일 1,856건 = 7일 약 430건). 창을 넓힐 일이 생기면 group-by RPC로 옮길 것.
 * ⚠️ 값 해석은 순수 함수(`buildHomeworkRisk` → `parseHomeworkRate`)가 한다 — 여기선 행만 가져온다.
 */
export async function getHomeworkRisk(): Promise<HomeworkRiskView> {
  return (await loadHomeworkRisk())(null);
}

/**
 * 숙제 위험 — 조회는 한 번, 과목으로 다시 접는 것은 돌려준 함수가 한다(운영실 과목 관리자, 원장 2026-10-14 2단계).
 * `only` = 담당 과목 키(null = 좁히지 않음). 설정 과목(`report.classnoteSubjects`)이 있으면 그 교집합만 세고,
 * 교집합이 비면 0건 — 라벨은 담당 과목으로 적는다('전체 과목'으로 적으면 거짓이다).
 */
export async function loadHomeworkRisk(): Promise<(only: readonly string[] | null) => HomeworkRiskView> {
  const today = kstToday();
  const since = daysBefore(today, HOMEWORK_WINDOW_DAYS - 1);
  const [supabase, tracked] = await Promise.all([createClient(), trackedSubjects()]);
  const rows = await fetchAllPaged<{ student_id: string; homework_score: string | null; subject: string | null }>((from, to) => {
    let q = supabase
      .from("lesson_reports")
      .select("student_id, homework_score, subject")
      .gte("report_date", since)
      .lte("report_date", today);
    if (tracked.length > 0) q = q.in("subject", tracked);
    // OFFSET 페이지가 흔들리지 않게 unique tie-break로 정렬한다.
    return q.order("id", { ascending: true }).range(from, to);
  });
  return (only) => {
    const counted = only ? (tracked.length ? tracked.filter((k) => only.includes(k)) : [...only]) : tracked;
    return {
      ...buildHomeworkRisk(
        rows
          // 학생이 안 붙은 행은 셀 수 없다(있으면 안 되는 값이지만 있으면 "null"이라는 가짜 학생이 생긴다).
          .filter((r) => !!r.student_id && (!only || (!!r.subject && counted.includes(r.subject))))
          .map((r) => ({ studentId: r.student_id, homeworkScore: r.homework_score })),
      ),
      windowDays: HOMEWORK_WINDOW_DAYS,
      subjects: only && !counted.length ? [...only] : counted,
    };
  };
}

export type UnreadReportsView = {
  /** 발송됐지만 유예 시간이 지나도록 학부모가 안 연 보고서 **건수**(학생 수가 아니다). */
  reports: number;
  windowDays: number;
  graceHours: number;
  /** 실제로 좁힌 과목 키(빈 배열 = 안 좁혔다). */
  subjects: string[];
};

/**
 * 학부모 미확인 보고서 — **발송 성공 + 매칭 가능 + 미읽음 + 발송 후 유예 초과**.
 *
 * 🔴 판정 문자열은 [`unread-filter.ts`](@/features/report-admin/unread-filter) 단일 소스다 — 보고서
 *    목록의 '안읽음' 필터와 **같은 집합**이라야 "444건이라더니 목록엔 다른 수"가 안 생긴다.
 * 🔴 `classnote_read_at IS NULL`만 보면 **매칭 키 없는 옛 이관분**이 통째로 '미확인'이 된다(거짓).
 * 🔴 **행을 받지 않는다** — `count: exact, head: true`(B2).
 * ⚠️ 세는 단위는 **보고서 건수**다(한 학생이 여러 건일 수 있다 — 화면 라벨이 '건'을 그대로 적는다).
 */
export async function getUnreadReports(
  /** 운영실 과목 관리자(원장 2026-10-14 2단계) — 담당 과목 키. 설정 과목과의 교집합만 세고, 비면 조회 없이 0건. */
  only: readonly string[] | null = null,
): Promise<UnreadReportsView> {
  const today = kstToday();
  const since = daysBefore(today, UNREAD_WINDOW_DAYS - 1);
  const cutoff = new Date(Date.now() - UNREAD_GRACE_HOURS * 3_600_000).toISOString();
  const [supabase, allTracked] = await Promise.all([createClient(), trackedSubjects()]);
  const tracked = only ? (allTracked.length ? allTracked.filter((k) => only.includes(k)) : [...only]) : allTracked;
  if (only && tracked.length === 0) {
    return { reports: 0, windowDays: UNREAD_WINDOW_DAYS, graceHours: UNREAD_GRACE_HOURS, subjects: [...only] };
  }
  let q = supabase
    .from("lesson_reports")
    .select("*", { count: "exact", head: true })
    .eq("classnote_status", SENT_STATUS_SUCCESS)
    .is("classnote_read_at", null)
    .or(UNREAD_MATCHABLE_OR)
    .lt("classnote_sent_at", cutoff)
    .gte("report_date", since);
  if (tracked.length > 0) q = q.in("subject", tracked);
  const { count, error } = await q;
  // 🔴 실패를 0으로 삼키지 않는다 — 호출부의 실패 허용 래퍼가 칸을 `—`로 그린다.
  if (error) throw new Error(`학부모 미확인 조회 실패: ${error.message}`);
  return {
    reports: count ?? 0,
    windowDays: UNREAD_WINDOW_DAYS,
    graceHours: UNREAD_GRACE_HOURS,
    subjects: tracked,
  };
}
