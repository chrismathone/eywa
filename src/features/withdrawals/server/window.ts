import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isMergedStudent } from "@/features/students/status/merged";
import { isBookkeepingOnlyExit, isCleanupExit, isSystemBulkWithdrawal } from "../system-bulk";
import { normalizeReason } from "../types";
import { loadExitCountDates } from "./exit-month";
import { endedTogether, inWithdrawalWindow, lastEndedByStudent, pickLastEnded, withdrawalSubjects, type EndedClassRef } from "../window";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type One<T> = T | T[] | null;

export type EndedEnrollmentRow = {
  id: string;
  student_id: string;
  class_id: string;
  start_date: string | null;
  end_date: string | null;
  /** 반이동으로 닫힌 수강 — 옛 반 마지막 수업일은 종료일 전날(`enrollmentLastDate`). */
  is_transferred: boolean | null;
  withdrawal_reason: string | null;
  class: One<{ class_name?: string | null; subject?: string | null; english_track?: string | null }>;
};

/**
 * 학생들의 **종료된** 수강 전건 — 퇴원관리 목록과 운영실 '퇴원생'이 같은 조회·같은 선택(`lastEndedByStudent`)을 쓴다.
 * 🔴 청크 × 페이징(`fetchAllPagedInChunks`) — 청크만 나누면 청크 안에서 1000행에 조용히 잘려 마지막 반이
 *    바뀐다(CLAUDE.md B2, 2026-09-07 수업목록 사고와 같은 모양).
 */
export async function loadEndedEnrollments(
  supabase: Supabase,
  studentIds: string[],
): Promise<EndedEnrollmentRow[]> {
  return fetchAllPagedInChunks<EndedEnrollmentRow>(studentIds, (chunk, from, to) =>
    supabase
      .from("enrollments")
      .select(
        "id, student_id, class_id, start_date, end_date, is_transferred, withdrawal_reason, class:class_id ( class_name, subject, english_track )",
      )
      .in("student_id", chunk)
      .not("end_date", "is", null)
      .order("id")
      .range(from, to),
  );
}

/** 마지막 종료 수강 한 줄의 반 정보. */
export function lastClassOf(row: EndedEnrollmentRow | undefined) {
  const klass = row ? ((Array.isArray(row.class) ? row.class[0] : row.class) ?? undefined) : undefined;
  return {
    className: klass?.class_name ?? null,
    subject: klass?.subject ?? null,
    englishTrack: klass?.english_track ?? null,
    reason: row?.withdrawal_reason ?? null,
  };
}

/**
 * 퇴원 사유·메모. 사유 = 퇴원 메타데이터의 키, 없으면 **마지막 종료 수강의 종료 사유 원문** — 퇴원관리 목록의
 * `withdrawalReason`과 같은 폴백(`md?.reason ? … : last.reason`). 메모는 메타데이터에만 있다.
 */
function exitReasonOf(raw: unknown, lastReason: string | null): { reason: string | null; memo: string | null } {
  const m = raw && typeof raw === "object" ? (raw as { reason?: unknown; memo?: unknown }) : {};
  return {
    reason: normalizeReason(typeof m.reason === "string" ? m.reason : null) ?? lastReason,
    memo: typeof m.memo === "string" && m.memo.trim() ? m.memo.trim() : null,
  };
}

export type WindowWithdrawal = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  /** 등록일(`students.enrolled_at`) — 운영실 '등록 후 3개월 내 퇴원'(`early-exit.ts`) 재료. 모르면 null. */
  enrolledAt: string | null;
  withdrawnAt: string;
  /**
   * 기간 판정 날짜 — 퇴원월이 수강료를 낸 마지막 달이라(원장 2026-10-29, `exit-month.ts`) 퇴원일보다 앞 달이면 그 달 말일.
   * 달·창에 넣을 때는 이 값, 화면에 보이는 퇴원일·재원 일수는 `withdrawnAt`.
   */
  exitDate: string;
  lastClassName: string | null;
  lastClassSubject: string | null;
  lastClassEnglishTrack: string | null;
  /**
   * 퇴원 무렵 종료된 과목 각각의 마지막 반. KPI의 과목별 집계에 사용한다.
   * `endedTogether` = 그 과목에서 함께 끝난 수강(첫째 = 마지막 반) — 시간표 X 겹침이 그때 담임·'퇴원 0'을 가리는 재료다.
   */
  exitClasses: {
    subject: string;
    englishTrack: string | null;
    className: string | null;
    endedTogether: EndedClassRef[];
  }[];
  /** 퇴원 사유 — 메타데이터 키(표기 흔들림 흡수), 없으면 마지막 종료 수강의 사유 원문(퇴원관리와 같은 폴백). */
  reason: string | null;
  /** 퇴원 메모(사람이 적은 사유) — 없으면 null. */
  memo: string | null;
  /**
   * 사유 없는 단체 장부 정리(`isCleanupExit` — 수업 기록이 있는 쪽만 여기 남는다). 퇴원 수·명단은 그대로 세고, **추세선**(운영실·원생 통계
   * '등록·퇴원 추이' · '3개월 내 퇴원' 달마다 줄)만 이 줄을 뺀다(원장 2026-10-20 *"단체로 장부 정리한 건에 대해서는 추세선에서 배제시킬것"*).
   */
  cleanup: boolean;
};

/**
 * [from, to](YYYY-MM-DD, 양끝 포함) 안에 퇴원한 학생 — 운영실 '퇴원생' 카드·팝업의 **단일 소스**.
 * 창 판정은 `basis`로 — 기본 `tuition` = 퇴원월(수강료를 낸 마지막 달, `exitDate`) · `date` = 퇴원일 그대로(시간표 X처럼 강사평가 퇴원율과
 * 같은 달을 써야 하는 곳).
 * 퇴원관리 `range=month`는 같은 판정(`inWithdrawalWindow`)을 같은 행(`loadEndedEnrollments`)에 건다.
 * ⚠️ 강사 스코프를 걸지 않는다 — 퇴원관리(강사 none, 테넌트 전역)와 같은 모집단이어야 두 숫자가 같다.
 * `keepProcessedFrom` = 그날 ~ `to`에 **퇴원일**이 든 학생은 센 날짜(`exitDate`)가 창보다 앞이어도 돌려준다 — 운영실 '마지막 수업일이 그 달이지만
 * 앞 달로 센' 목록(원장 2026-11-03 · 오래 휴원 뒤 퇴원은 6개월 창보다 앞 달로 센다). 🔴 받는 쪽이 `exitDate`로 다시 걸러야 한다(운영실 세 소비처는
 * 그렇게 한다 — 월 칸 밖 날짜는 `monthlyChanges`가 버린다).
 */
export async function getWithdrawalsInWindow(
  from: string,
  to: string,
  opts: { basis?: "tuition" | "date"; keepProcessedFrom?: string } = {},
): Promise<WindowWithdrawal[]> {
  const byTuition = (opts.basis ?? "tuition") === "tuition";
  const supabase = await createClient();
  const withdrawnRows = await fetchAllPaged<{
    id: string;
    tenant_id: string;
    name: string;
    school: string | null;
    grade: string | null;
    enrolled_at: string | null;
    withdrawn_at: string | null;
    notes: string | null;
    withdrawal_metadata: unknown;
  }>((f, t) => {
    const q = supabase
      .from("students")
      .select("id, tenant_id, name, school, grade, enrolled_at, withdrawn_at, notes, withdrawal_metadata")
      .eq("status", "withdrawn")
      .gte("withdrawn_at", from);
    // 퇴원월은 퇴원일의 달 이하라 창 끝보다 늦게 퇴원한 학생도 창 안 달로 셀 수 있다 — 수강료 기준이면 끝을 막지 않는다(아래에서 판정).
    return (byTuition ? q : q.lte("withdrawn_at", to)).order("withdrawn_at", { ascending: false }).order("id").range(f, t);
  });
  // 🔴 중복 병합으로 흡수된 쪽은 **모집단 단계에서** 뺀다(집계 뒤 빼기가 아니라) — 병합은 퇴원이 아니다
  //    (원장 2026-09-13, [`students/merged.ts`](../../students/merged.ts)). 여기서 빼면 퇴원 수·프로그램
  //    분포·추이가 **한 번에** 맞는다. 병합된 학생은 수강이 0건이라 과목이 null이어서, 안 빼면 '기타·미상'
  //    칸만 근거 없이 부푼다(김지유B·권민서B 실측). 수업 기록 없는 장부 정리도 뺀다(수강을 읽은 뒤 — 아래).
  const students = withdrawnRows.filter((s) => !isMergedStudent(s.notes));
  if (students.length === 0) return [];
  const [ended, exitDates] = await Promise.all([
    loadEndedEnrollments(supabase, students.map((s) => s.id)),
    byTuition ? loadExitCountDates(students.map((s) => ({ id: s.id, tenantId: s.tenant_id, withdrawnAt: s.withdrawn_at }))) : Promise.resolve(new Map<string, string>()),
  ]);
  const last = lastEndedByStudent(ended);
  const byStudent = new Map<string, EndedEnrollmentRow[]>();
  for (const row of ended) {
    const list = byStudent.get(row.student_id) ?? [];
    list.push(row);
    byStudent.set(row.student_id, list);
  }
  return students.flatMap((s) => {
    const row = last.get(s.id);
    // 수업 기록 없는 장부 정리(단체 정리)는 퇴원이 아니다 — 퇴원관리와 같은 판정(`isBookkeepingOnlyExit`, 원장 2026-10-15).
    if (isBookkeepingOnlyExit({ withdrawalMetadata: s.withdrawal_metadata, hasEnrollmentHistory: !!row })) return [];
    const klass = lastClassOf(row);
    const history = byStudent.get(s.id) ?? [];
    const exitClasses = withdrawalSubjects(history.map((e) => ({ endDate: e.end_date, subject: lastClassOf(e).subject })))
      .map((subject) => {
        const rows = history.filter((e) => lastClassOf(e).subject === subject);
        const lastSubject = lastClassOf(pickLastEnded(rows) ?? undefined);
        return {
          subject,
          englishTrack: lastSubject.englishTrack,
          className: lastSubject.className,
          endedTogether: endedTogether(rows).map((e) => ({
            enrollmentId: e.id,
            classId: e.class_id,
            startDate: e.start_date,
            endDate: e.end_date,
            isTransferred: e.is_transferred === true,
          })),
        };
      });
    const systemBulk = isSystemBulkWithdrawal({ withdrawnAt: s.withdrawn_at, hasEnrollmentHistory: !!row });
    const withdrawnAt = (s.withdrawn_at ?? "").slice(0, 10);
    const exitDate = exitDates.get(s.id) ?? withdrawnAt;
    const keep = !!opts.keepProcessedFrom && inWithdrawalWindow({ withdrawnAt, systemBulk }, opts.keepProcessedFrom, to);
    if (!inWithdrawalWindow({ withdrawnAt: exitDate, systemBulk }, from, to) && !keep) return [];
    return [
      {
        id: s.id,
        name: s.name,
        school: s.school,
        grade: s.grade,
        enrolledAt: s.enrolled_at ? s.enrolled_at.slice(0, 10) : null,
        withdrawnAt,
        exitDate,
        lastClassName: klass.className,
        lastClassSubject: klass.subject,
        lastClassEnglishTrack: klass.englishTrack,
        exitClasses,
        ...exitReasonOf(s.withdrawal_metadata, klass.reason),
        cleanup: isCleanupExit(s.withdrawal_metadata),
      },
    ];
  });
}
