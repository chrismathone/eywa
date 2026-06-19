import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { REASON_LABEL, normalizeReason, type WithdrawalMetadata } from "../types";
import { getEndedSubjects } from "../subject-ended";

// Re-export common types so existing callers don't need to switch import paths
export type {
  WithdrawalReason,
  WithdrawalConsultation,
  WithdrawalMetadata,
} from "../types";
export { REASON_LABEL, DEFAULT_WITHDRAWAL_METADATA } from "../types";

export type WithdrawalRow = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  primaryTeacherName: string | null;
  enrolledAt: string | null;
  withdrawnAt: string | null;
  lastClassName: string | null;
  lastClassSubject: string | null;
  withdrawalReason: string | null;
  metadata: WithdrawalMetadata | null;
};

function parseMetadata(raw: unknown): WithdrawalMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<WithdrawalMetadata>;
  const reason = normalizeReason(m.reason); // 마이그레이션 표기 흔들림 흡수 (dissatisfied→dissatisfaction 등)
  if (!reason) return null;
  return {
    reason,
    memo: m.memo ?? null,
    consultation: {
      adminCalledParent: !!m.consultation?.adminCalledParent,
      teacherCalledParent: !!m.consultation?.teacherCalledParent,
      talkedWithStudent: !!m.consultation?.talkedWithStudent,
    },
  };
}

export async function getWithdrawnStudents(): Promise<WithdrawalRow[]> {
  const supabase = await createClient();
  // 퇴원생은 누적 집합 — .range() 페이지네이션으로 1000행 절단 방지.
  const students = await fetchAllPaged((from, to) =>
    supabase
      .from("students")
      .select(
        `id, name, school, grade, enrolled_at, withdrawn_at, withdrawal_metadata,
         teacher:primary_teacher_id ( display_name )`,
      )
      .eq("status", "withdrawn")
      .order("withdrawn_at", { ascending: false })
      .range(from, to),
  );

  if (students.length === 0) return [];

  const ids = students.map((s) => s.id);

  // id를 청크로 .in()(414 + error삼킴 방지). 한 학생 enrollment는 같은 청크에 모여 end_date desc 보존.
  const enrollments = await fetchInChunks<{
    student_id: string;
    withdrawal_reason: string | null;
    end_date: string | null;
    class: { class_name?: string; subject?: string } | { class_name?: string; subject?: string }[] | null;
  }>(ids, (chunk) =>
    supabase
      .from("enrollments")
      .select(
        `student_id, withdrawal_reason, end_date,
         class:class_id ( class_name, subject )`,
      )
      .in("student_id", chunk)
      .not("end_date", "is", null)
      .order("end_date", { ascending: false }),
  );

  const lastByStudent = new Map<
    string,
    { reason: string | null; className: string | null; subject: string | null }
  >();
  for (const e of enrollments) {
    if (lastByStudent.has(e.student_id)) continue;
    const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as
      | { class_name?: string; subject?: string }
      | undefined;
    lastByStudent.set(e.student_id, {
      reason: e.withdrawal_reason ?? null,
      className: klass?.class_name ?? null,
      subject: klass?.subject ?? null,
    });
  }

  return students.map((s) => {
    const teacher = (Array.isArray(s.teacher) ? s.teacher[0] : s.teacher) as
      | { display_name?: string }
      | undefined;
    const last = lastByStudent.get(s.id);
    const md = parseMetadata(s.withdrawal_metadata);
    return {
      id: s.id,
      name: s.name,
      school: s.school,
      grade: s.grade,
      primaryTeacherName: teacher?.display_name ?? null,
      enrolledAt: s.enrolled_at,
      withdrawnAt: s.withdrawn_at,
      lastClassName: last?.className ?? null,
      lastClassSubject: last?.subject ?? null,
      withdrawalReason: md?.reason ? REASON_LABEL[md.reason] : last?.reason ?? null,
      metadata: md,
    };
  });
}

export type WithdrawalDetail = WithdrawalRow & {
  enrollmentHistory: {
    id: string;
    className: string;
    subject: string;
    startDate: string;
    endDate: string | null;
    reason: string | null;
  }[];
};

export async function getWithdrawalDetail(studentId: string): Promise<WithdrawalDetail | null> {
  const supabase = await createClient();
  // 두 쿼리는 독립(enrollments는 studentId만 의존) → 병렬(2 round-trip → 1).
  const [{ data: s }, { data: enrollments }] = await Promise.all([
    supabase
      .from("students")
      .select(
        `id, name, school, grade, enrolled_at, withdrawn_at, withdrawal_metadata,
         teacher:primary_teacher_id ( display_name )`,
      )
      .eq("id", studentId)
      .single(),
    supabase
      .from("enrollments")
      .select(
        `id, start_date, end_date, withdrawal_reason,
         class:class_id ( id, class_name, subject )`,
      )
      .eq("student_id", studentId)
      .order("start_date", { ascending: false }),
  ]);

  if (!s) return null;

  const history =
    (enrollments ?? []).map((e) => {
      const k = (Array.isArray(e.class) ? e.class[0] : e.class) as
        | { id?: string; class_name?: string; subject?: string }
        | undefined;
      return {
        id: e.id,
        className: k?.class_name ?? "?",
        subject: k?.subject ?? "?",
        startDate: e.start_date,
        endDate: e.end_date,
        reason: e.withdrawal_reason ?? null,
      };
    }) ?? [];

  const lastEnded = history.find((h) => h.endDate !== null);
  const teacher = (Array.isArray(s.teacher) ? s.teacher[0] : s.teacher) as
    | { display_name?: string }
    | undefined;
  const md = parseMetadata(s.withdrawal_metadata);

  return {
    id: s.id,
    name: s.name,
    school: s.school,
    grade: s.grade,
    primaryTeacherName: teacher?.display_name ?? null,
    enrolledAt: s.enrolled_at,
    withdrawnAt: s.withdrawn_at,
    lastClassName: lastEnded?.className ?? null,
    lastClassSubject: lastEnded?.subject ?? null,
    withdrawalReason: md?.reason ? REASON_LABEL[md.reason] : lastEnded?.reason ?? null,
    metadata: md,
    enrollmentHistory: history,
  };
}

// === 수강종료(과목 이탈) — 재원 중이지만 특정 과목을 전부 끊은 학생(조기 이탈 신호) ===
export type SubjectEndedRow = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  status: string; // enrolled | on_hold
  primaryTeacherName: string | null;
  endedSubjects: string[]; // 종료된 과목 코드
  activeSubjects: string[]; // 아직 수강 중인 과목 코드
  lastEndedAt: string | null; // 종료 과목 중 가장 최근 end_date
};

export async function getSubjectEndedStudents(): Promise<SubjectEndedRow[]> {
  const supabase = await createClient();
  // 재원/휴원 학생 전수 — .range() 페이지네이션으로 1000행 절단 방지(#54).
  const students = await fetchAllPaged<{
    id: string;
    name: string;
    school: string | null;
    grade: string | null;
    status: string;
    teacher: { display_name?: string } | { display_name?: string }[] | null;
  }>((from, to) =>
    supabase
      .from("students")
      .select("id, name, school, grade, status, teacher:primary_teacher_id ( display_name )")
      .in("status", ["enrolled", "on_hold"])
      .range(from, to),
  );
  if (students.length === 0) return [];

  const ids = students.map((s) => s.id);
  // 학생 enrollment + 반 과목 — id 청크로 .in()(414/error삼킴 방지, #53).
  const enrollments = await fetchInChunks<{
    student_id: string;
    end_date: string | null;
    class: { subject?: string } | { subject?: string }[] | null;
  }>(ids, (chunk) =>
    supabase
      .from("enrollments")
      .select("student_id, end_date, class:class_id ( subject )")
      .in("student_id", chunk),
  );

  const bySt = new Map<string, { subject: string; endDate: string | null }[]>();
  for (const e of enrollments) {
    const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as { subject?: string } | undefined;
    const subject = klass?.subject;
    if (!subject) continue;
    const arr = bySt.get(e.student_id) ?? [];
    arr.push({ subject, endDate: e.end_date });
    bySt.set(e.student_id, arr);
  }

  const rows: SubjectEndedRow[] = [];
  for (const s of students) {
    const enr = bySt.get(s.id) ?? [];
    const { ended, active } = getEndedSubjects(enr);
    if (ended.length === 0) continue; // 수강종료 과목이 없으면 제외
    let lastEndedAt: string | null = null;
    for (const e of enr) {
      if (ended.includes(e.subject) && e.endDate && (!lastEndedAt || e.endDate > lastEndedAt)) {
        lastEndedAt = e.endDate;
      }
    }
    const teacher = (Array.isArray(s.teacher) ? s.teacher[0] : s.teacher) as
      | { display_name?: string }
      | undefined;
    rows.push({
      id: s.id,
      name: s.name,
      school: s.school,
      grade: s.grade,
      status: s.status,
      primaryTeacherName: teacher?.display_name ?? null,
      endedSubjects: ended,
      activeSubjects: active,
      lastEndedAt,
    });
  }
  rows.sort((a, b) => (b.lastEndedAt ?? "").localeCompare(a.lastEndedAt ?? "")); // 최근 종료순
  return rows;
}

export function enrollmentDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso) return "—";
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : new Date();
  let years = end.getFullYear() - start.getFullYear();
  let months = end.getMonth() - start.getMonth();
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}년`);
  if (months > 0) parts.push(`${months}개월`);
  if (parts.length === 0) {
    const days = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000));
    return `${days}일`;
  }
  return parts.join(" ");
}
