import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isMergedStudent } from "@/features/students/merged";
import { isSystemBulkWithdrawal } from "../system-bulk";
import { inWithdrawalWindow, lastEndedByStudent, pickLastEnded, withdrawalSubjects } from "../window";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type One<T> = T | T[] | null;

export type EndedEnrollmentRow = {
  id: string;
  student_id: string;
  start_date: string | null;
  end_date: string | null;
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
        "id, student_id, start_date, end_date, withdrawal_reason, class:class_id ( class_name, subject, english_track )",
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

export type WindowWithdrawal = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  withdrawnAt: string;
  lastClassName: string | null;
  lastClassSubject: string | null;
  lastClassEnglishTrack: string | null;
  /** 퇴원 무렵 종료된 과목 각각의 마지막 반. KPI의 과목별 집계에 사용한다. */
  exitClasses: { subject: string; englishTrack: string | null; className: string | null }[];
};

/**
 * [from, to](YYYY-MM-DD, 양끝 포함) 안에 퇴원한 학생 — 운영실 '퇴원생' 카드·팝업의 **단일 소스**.
 * 퇴원관리 `range=month`는 같은 판정(`inWithdrawalWindow`)을 같은 행(`loadEndedEnrollments`)에 건다.
 * ⚠️ 강사 스코프를 걸지 않는다 — 퇴원관리(강사 none, 테넌트 전역)와 같은 모집단이어야 두 숫자가 같다.
 */
export async function getWithdrawalsInWindow(from: string, to: string): Promise<WindowWithdrawal[]> {
  const supabase = await createClient();
  const withdrawnRows = await fetchAllPaged<{
    id: string;
    name: string;
    school: string | null;
    grade: string | null;
    withdrawn_at: string | null;
    notes: string | null;
  }>((f, t) =>
    supabase
      .from("students")
      .select("id, name, school, grade, withdrawn_at, notes")
      .eq("status", "withdrawn")
      .gte("withdrawn_at", from)
      .lte("withdrawn_at", to)
      .order("withdrawn_at", { ascending: false })
      .order("id")
      .range(f, t),
  );
  // 🔴 중복 병합으로 흡수된 쪽은 **모집단 단계에서** 뺀다(집계 뒤 빼기가 아니라) — 병합은 퇴원이 아니다
  //    (원장 2026-09-13, [`students/merged.ts`](../../students/merged.ts)). 여기서 빼면 퇴원 수·프로그램
  //    분포·추이가 **한 번에** 맞는다. 병합된 학생은 수강이 0건이라 과목이 null이어서, 안 빼면 '기타·미상'
  //    칸만 근거 없이 부푼다(김지유B·권민서B 실측).
  const students = withdrawnRows.filter((s) => !isMergedStudent(s.notes));
  if (students.length === 0) return [];
  const ended = await loadEndedEnrollments(supabase, students.map((s) => s.id));
  const last = lastEndedByStudent(ended);
  const byStudent = new Map<string, EndedEnrollmentRow[]>();
  for (const row of ended) {
    const list = byStudent.get(row.student_id) ?? [];
    list.push(row);
    byStudent.set(row.student_id, list);
  }
  return students.flatMap((s) => {
    const row = last.get(s.id);
    const klass = lastClassOf(row);
    const history = byStudent.get(s.id) ?? [];
    const exitClasses = withdrawalSubjects(history.map((e) => ({ endDate: e.end_date, subject: lastClassOf(e).subject })))
      .map((subject) => {
        const lastSubject = lastClassOf(pickLastEnded(history.filter((e) => lastClassOf(e).subject === subject)) ?? undefined);
        return { subject, englishTrack: lastSubject.englishTrack, className: lastSubject.className };
      });
    const systemBulk = isSystemBulkWithdrawal({ withdrawnAt: s.withdrawn_at, hasEnrollmentHistory: !!row });
    if (!inWithdrawalWindow({ withdrawnAt: s.withdrawn_at, systemBulk }, from, to)) return [];
    return [
      {
        id: s.id,
        name: s.name,
        school: s.school,
        grade: s.grade,
        withdrawnAt: (s.withdrawn_at ?? "").slice(0, 10),
        lastClassName: klass.className,
        lastClassSubject: klass.subject,
        lastClassEnglishTrack: klass.englishTrack,
        exitClasses,
      },
    ];
  });
}
