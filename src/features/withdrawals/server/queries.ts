import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { REASON_LABEL, normalizeReason, type WithdrawalMetadata } from "../types";

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
  const { data: s } = await supabase
    .from("students")
    .select(
      `id, name, school, grade, enrolled_at, withdrawn_at, withdrawal_metadata,
       teacher:primary_teacher_id ( display_name )`,
    )
    .eq("id", studentId)
    .single();

  if (!s) return null;

  const { data: enrollments } = await supabase
    .from("enrollments")
    .select(
      `id, start_date, end_date, withdrawal_reason,
       class:class_id ( id, class_name, subject )`,
    )
    .eq("student_id", studentId)
    .order("start_date", { ascending: false });

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
