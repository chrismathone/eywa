import "server-only";
import { kstDateOf, kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isMergedStudent } from "@/features/students/merged";
import { REASON_LABEL, normalizeReason, type WithdrawalMetadata } from "../types";
import { getEndedSubjects } from "../subject-ended";
import { isSystemBulkWithdrawal } from "../system-bulk";
import { lastEndedByStudent, pickLastEnded } from "../window";
import { withdrawalSubjects } from "../exit-rows";
import { lastClassOf, loadEndedEnrollments } from "./window";

// Re-export common types so existing callers don't need to switch import paths
export type {
  WithdrawalReason,
  WithdrawalConsultation,
  WithdrawalMetadata,
} from "../types";
export { REASON_LABEL, reasonLabel, reasonDisplay, DEFAULT_WITHDRAWAL_METADATA } from "../types";

export type WithdrawalRow = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  enrolledAt: string | null;
  withdrawnAt: string | null;
  lastClassName: string | null;
  lastClassSubject: string | null;
  /** 마지막 수강 반의 영어 프로그램 구분(0176a) — 퇴원생 프로그램 판정(`withdrawalProgram`) 재료. 상세 화면은 안 채운다. */
  lastClassEnglishTrack?: string | null;
  withdrawalReason: string | null;
  metadata: WithdrawalMetadata | null;
  /** 수강(종료) 이력이 있는가 — '시스템 정리(날짜 미상)' 판정 입력([system-bulk.ts](../system-bulk.ts)). */
  hasEnrollmentHistory: boolean;
  /** 퇴원일이 장부상 일괄 날짜이고 수강 이력도 없어 **실제 퇴원 시점을 알 수 없는** 행. */
  systemBulk: boolean;
  /** 퇴원 무렵 끝난 수강의 과목 전부(`withdrawalSubjects`) — 과목 필터가 본다. 상세 화면은 안 채운다. */
  exitSubjects?: string[];
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
  const withdrawnRows = await fetchAllPaged((from, to) =>
    supabase
      .from("students")
      .select(
        `id, name, school, grade, enrolled_at, withdrawn_at, withdrawal_metadata, notes`,
      )
      .eq("status", "withdrawn")
      .order("withdrawn_at", { ascending: false })
      // OFFSET 페이지 안정화 — unique tie-break(id) 필수(batch.ts 계약)
      .order("id")
      .range(from, to),
  );

  // 🔴 중복 병합으로 흡수된 쪽은 퇴원이 아니다 — 운영실 '퇴원생'(window.ts)과 **같은 모집단**이어야
  //    두 화면의 숫자가 같다(원장 2026-09-13, `students/merged.ts`).
  const students = withdrawnRows.filter((s) => !isMergedStudent(s.notes));

  if (students.length === 0) return [];

  // 마지막 종료 수강 = 운영실 '퇴원생'과 **같은 조회·같은 선택**(window.ts) — 청크 × 페이징이라 청크 안 1000행
  // 절단도 없고, 종료일이 같은 두 줄은 결정적 tie-break로 고른다(조회마다 다른 반이 뽑히지 않게).
  const ended = await loadEndedEnrollments(supabase, students.map((s) => s.id));
  const lastByStudent = lastEndedByStudent(ended);
  const endedByStudent = new Map<string, { endDate: string | null; subject: string | null }[]>();
  for (const e of ended) {
    const list = endedByStudent.get(e.student_id) ?? [];
    list.push({ endDate: e.end_date, subject: lastClassOf(e).subject });
    endedByStudent.set(e.student_id, list);
  }

  return students.map((s) => {
    const lastRow = lastByStudent.get(s.id);
    const last = lastClassOf(lastRow);
    const md = parseMetadata(s.withdrawal_metadata);
    // 수강(종료) 이력 유무 = '시스템 정리(날짜 미상)' 판정 입력. lastClassName은 반 조인 실패로도 null이 될 수
    // 있어 신뢰할 수 없으므로, **enrollment 행의 존재 자체**로 본다.
    const hasEnrollmentHistory = !!lastRow;
    return {
      id: s.id,
      name: s.name,
      school: s.school,
      grade: s.grade,
      enrolledAt: s.enrolled_at,
      withdrawnAt: s.withdrawn_at,
      lastClassName: last.className,
      lastClassSubject: last.subject,
      lastClassEnglishTrack: last.englishTrack,
      withdrawalReason: md?.reason ? REASON_LABEL[md.reason] : last.reason,
      metadata: md,
      hasEnrollmentHistory,
      systemBulk: isSystemBulkWithdrawal({ withdrawnAt: s.withdrawn_at, hasEnrollmentHistory }),
      exitSubjects: withdrawalSubjects(endedByStudent.get(s.id) ?? []),
    };
  });
}

export type WithdrawalDetail = WithdrawalRow & {
  studentPhone: string | null;
  parentPhone: string | null;
  parentName: string | null;
  enrollmentHistory: {
    id: string;
    className: string;
    subject: string;
    /** 그 반의 담임(classes.teacher_id) 표시명 — 과목별 담당강사. 미배정이면 null. */
    teacherName: string | null;
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
         student_phone, parent_phone, parent_name`,
      )
      .eq("id", studentId)
      .single(),
    supabase
      .from("enrollments")
      .select(
        `id, start_date, end_date, withdrawal_reason,
         class:class_id ( id, class_name, subject, teacher:teacher_id ( display_name ) )`,
      )
      .eq("student_id", studentId)
      .order("start_date", { ascending: false }),
  ]);

  if (!s) return null;

  const history =
    (enrollments ?? []).map((e) => {
      const k = (Array.isArray(e.class) ? e.class[0] : e.class) as
        | { id?: string; class_name?: string; subject?: string; teacher?: unknown }
        | undefined;
      // classes→users 다중 FK라 컬럼명(teacher_id)으로 임베드 disambiguate. 담임 미배정이면 null.
      const kt = (Array.isArray(k?.teacher) ? k.teacher[0] : k?.teacher) as
        | { display_name?: string }
        | undefined;
      return {
        id: e.id,
        className: k?.class_name ?? "?",
        subject: k?.subject ?? "?",
        teacherName: kt?.display_name ?? null,
        startDate: e.start_date,
        endDate: e.end_date,
        reason: e.withdrawal_reason ?? null,
      };
    }) ?? [];

  const lastEnded = history.find((h) => h.endDate !== null);
  const md = parseMetadata(s.withdrawal_metadata);

  return {
    id: s.id,
    name: s.name,
    school: s.school,
    grade: s.grade,
    enrolledAt: s.enrolled_at,
    withdrawnAt: s.withdrawn_at,
    lastClassName: lastEnded?.className ?? null,
    lastClassSubject: lastEnded?.subject ?? null,
    withdrawalReason: md?.reason ? REASON_LABEL[md.reason] : lastEnded?.reason ?? null,
    metadata: md,
    studentPhone: (s as { student_phone?: string | null }).student_phone ?? null,
    parentPhone: (s as { parent_phone?: string | null }).parent_phone ?? null,
    parentName: (s as { parent_name?: string | null }).parent_name ?? null,
    enrollmentHistory: history,
    hasEnrollmentHistory: history.length > 0,
    systemBulk: isSystemBulkWithdrawal({
      withdrawnAt: s.withdrawn_at,
      hasEnrollmentHistory: history.length > 0,
    }),
  };
}

// === 수강종료(과목 이탈) — 재원 중이지만 특정 과목을 전부 끊은 학생(조기 이탈 신호) ===
export type SubjectEndedRow = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  status: string; // enrolled | on_hold
  endedSubjects: string[]; // 종료된 과목 코드
  activeSubjects: string[]; // 아직 수강 중인 과목 코드
  lastEndedAt: string | null; // 종료 과목 중 가장 최근 end_date
  /** 끊은 과목마다 — 그 과목 마지막 수강이 끝난 날·반(퇴원관리 한 목록의 한 줄, `exit-rows.ts`). */
  endedDetail: {
    subject: string;
    endedAt: string | null;
    className: string | null;
    englishTrack: string | null;
    /** 그 과목 마지막 수강의 종료 사유 원문(`enrollments.withdrawal_reason`). */
    reason: string | null;
  }[];
};

type ClassBits = { subject?: string; class_name?: string | null; english_track?: string | null };

export async function getSubjectEndedStudents(): Promise<SubjectEndedRow[]> {
  const supabase = await createClient();
  // 재원/휴원 학생 전수 — .range() 페이지네이션으로 1000행 절단 방지(#54).
  const students = await fetchAllPaged<{
    id: string;
    name: string;
    school: string | null;
    grade: string | null;
    status: string;
  }>((from, to) =>
    supabase
      .from("students")
      .select("id, name, school, grade, status")
      .in("status", ["enrolled", "on_hold"])
      .range(from, to),
  );
  if (students.length === 0) return [];

  const ids = students.map((s) => s.id);
  // 학생 enrollment + 반 과목 — id 청크로 .in()(414/error삼킴 방지, #53).
  // 🔴 학생 100명 × 수강 이력이라 한 청크가 1,000행을 넘을 수 있다 → 청크 × 페이징(B2 🔴, `.order("id")`).
  const enrollments = await fetchAllPagedInChunks<{
    id: string;
    student_id: string;
    start_date: string | null;
    end_date: string | null;
    is_transferred: boolean | null;
    withdrawal_reason: string | null;
    class: ClassBits | ClassBits[] | null;
  }>(ids, (chunk, from, to) =>
    supabase
      .from("enrollments")
      .select(
        "id, student_id, start_date, end_date, is_transferred, withdrawal_reason, class:class_id ( subject, class_name, english_track )",
      )
      .in("student_id", chunk)
      .order("id")
      .range(from, to),
  );

  type Enr = {
    id: string;
    subject: string;
    startDate: string | null;
    endDate: string | null;
    isTransferred?: boolean;
    className: string | null;
    englishTrack: string | null;
    reason: string | null;
  };
  const bySt = new Map<string, Enr[]>();
  for (const e of enrollments) {
    const klass = (Array.isArray(e.class) ? e.class[0] : e.class) ?? undefined;
    const subject = klass?.subject;
    if (!subject) continue;
    const arr = bySt.get(e.student_id) ?? [];
    arr.push({
      id: e.id,
      subject,
      startDate: e.start_date,
      endDate: e.end_date,
      isTransferred: e.is_transferred ?? undefined,
      className: klass?.class_name ?? null,
      englishTrack: klass?.english_track ?? null,
      reason: e.withdrawal_reason ?? null,
    });
    bySt.set(e.student_id, arr);
  }

  // 끝남 판정의 기준일 — 종료 예정일이 미래인 반은 아직 다니는 중이다(subject-ended.ts 주석).
  const today = kstToday();
  const rows: SubjectEndedRow[] = [];
  for (const s of students) {
    const enr = bySt.get(s.id) ?? [];
    const { ended, active } = getEndedSubjects(enr, today);
    if (ended.length === 0) continue; // 수강종료 과목이 없으면 제외
    let lastEndedAt: string | null = null;
    for (const e of enr) {
      if (ended.includes(e.subject) && e.endDate && (!lastEndedAt || e.endDate > lastEndedAt)) {
        lastEndedAt = e.endDate;
      }
    }
    // 과목마다 마지막으로 끝난 수강 — 날짜·반 이름·프로그램 재료. 고르는 규칙은 `pickLastEnded`(종료일 → 시작일 →
    // id, window.ts)와 같다 — 같은 날 끝난 두 반을 화면마다 다르게 고르면 반 이름·프로그램이 갈린다.
    const endedDetail = ended.map((subject) => {
      const best = pickLastEnded(
        enr
          .filter((e) => e.subject === subject)
          .map((e) => ({ ...e, end_date: e.endDate, start_date: e.startDate })),
      );
      return {
        subject,
        endedAt: best?.endDate ?? null,
        className: best?.className ?? null,
        englishTrack: best?.englishTrack ?? null,
        // 그 과목 마지막 수강의 종료 사유(원문) — 퇴원관리 사유 카드·필터가 퇴원 사유와 함께 센다.
        reason: best?.reason ?? null,
      };
    });
    rows.push({
      id: s.id,
      name: s.name,
      school: s.school,
      grade: s.grade,
      status: s.status,
      endedSubjects: ended,
      activeSubjects: active,
      lastEndedAt,
      endedDetail,
    });
  }
  rows.sort((a, b) => (b.lastEndedAt ?? "").localeCompare(a.lastEndedAt ?? "")); // 최근 종료순
  return rows;
}

export function enrollmentDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso) return "—";
  const start = new Date(startIso);
  const end = endIso ? new Date(endIso) : new Date();
  // 🔴 연·월은 **KST 달력**으로 센다 — `end.getFullYear()/getMonth()`는 런타임 로컬(서버=UTC)이라
  //    매달 1일 새벽(KST 00~09시)에 재원 기간이 한 달 짧게 나온다.
  const [sy, sm] = (kstDateOf(start) ?? "1970-01-01").split("-").map(Number);
  const [ey, em] = (kstDateOf(end) ?? "1970-01-01").split("-").map(Number);
  let years = (ey ?? 0) - (sy ?? 0);
  let months = (em ?? 1) - (sm ?? 1);
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
