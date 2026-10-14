import "server-only";
import { kstDateOf, kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { isMergedStudent } from "@/features/students/merged";
import { REASON_LABEL, normalizeReason, type WithdrawalMetadata } from "../types";
import { countsForSubjectExit, getEndedSubjects } from "../subject-ended";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { isSystemBulkWithdrawal } from "../system-bulk";
import { endedTogether, lastEndedByStudent, pickLastEnded, type EndedClassRef } from "../window";
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
      // 🔴 퇴원 **예약**(상태 재원·휴원 + 퇴원일)은 싣지 않는다 — 퇴원일 전까지 재원이다(원장 2026-09-28). 그날 cron이
      //    퇴원 처리하면 이 목록에 들어온다. 싣으면 전체 퇴원 수·사유·상담·추이에 미리 섞인다(리뷰 2026-09-28).
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
    isTransferred?: boolean;
    /**
     * 그 과목에서 함께 끝난 수강(특강 제외, 첫째 = 마지막 수강) — 시간표 X 겹침이 그때 담임·'퇴원 0'을 가리는 재료.
     * 종료일은 수강마다다 — `endedAt`은 특강까지 본 과목 종료일이라 다를 수 있다(담임은 그 반의 그 날로 찾는다).
     */
    endedTogether?: EndedClassRef[];
  }[];
};

type ClassBits = { subject?: string; class_name?: string | null; english_track?: string | null; is_special?: boolean | null };
type StudentBits = { id: string; name: string; school: string | null; grade: string | null; status: string };

/**
 * `endedWithin`을 주면 **그 기간에 끝난 수강이 있는 학생만** 후보로 읽는다(시간표 X 겹침 — 석 달 창).
 * 🔑 판정은 그대로다: 수강종료 날짜(`endedAt`)는 그 학생 수강 중 하나의 종료일이므로, 날짜가 창 안인 줄은
 *    반드시 창 안에 끝난 수강을 가진 학생에게서 나온다 — 후보를 좁혀도 창 안의 줄은 전부 같다(창 밖 줄은 호출부가 거른다).
 */
export async function getSubjectEndedStudents(opts?: {
  endedWithin?: { from: string; to: string };
}): Promise<SubjectEndedRow[]> {
  const supabase = await createClient();
  const within = opts?.endedWithin;
  const students: StudentBits[] = within
    ? await loadEndedWithinStudents(supabase, within)
    : // 재원/휴원 학생 전수 — .range() 페이지네이션으로 1000행 절단 방지(#54).
      await fetchAllPaged<StudentBits>((from, to) =>
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
    class_id: string;
    start_date: string | null;
    end_date: string | null;
    is_transferred: boolean | null;
    withdrawal_reason: string | null;
    class: ClassBits | ClassBits[] | null;
  }>(ids, (chunk, from, to) =>
    supabase
      .from("enrollments")
      .select(
        "id, student_id, class_id, start_date, end_date, is_transferred, withdrawal_reason, class:class_id ( subject, class_name, english_track, is_special )",
      )
      .in("student_id", chunk)
      .order("id")
      .range(from, to),
  );

  type Enr = {
    id: string;
    classId: string;
    subject: string;
    startDate: string | null;
    endDate: string | null;
    isTransferred?: boolean;
    isSpecial: boolean;
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
      classId: e.class_id,
      subject,
      startDate: e.start_date,
      endDate: e.end_date,
      isTransferred: e.is_transferred ?? undefined,
      isSpecial: isSpecialLecture({ isSpecial: klass?.is_special, className: klass?.class_name }),
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
    // 끝난 특강은 **판정**과 반 이름·사유에서 뺀다(subject-ended.ts 🔴). 단 **날짜**는 그 과목 수강 전부(특강 포함)의
    // 마지막 종료일 — 정규반 8/31 · 특강 10/15면 과목을 끊은 날은 10/15다(8/31로 찍으면 '최근' 목록을 건너뛰고 8월 추이가 뒤늦게 는다).
    const all = bySt.get(s.id) ?? [];
    const enr = all.filter((e) => countsForSubjectExit(e, today));
    const lastEndOf = (subject: string) =>
      all.reduce<string | null>((m, e) => (e.subject === subject && e.endDate && (!m || e.endDate > m) ? e.endDate : m), null);
    const { ended, active } = getEndedSubjects(enr, today);
    if (ended.length === 0) continue; // 수강종료 과목이 없으면 제외
    let lastEndedAt: string | null = null;
    for (const subject of ended) {
      const d = lastEndOf(subject);
      if (d && (!lastEndedAt || d > lastEndedAt)) lastEndedAt = d;
    }
    // 과목마다 마지막으로 끝난 수강 — 날짜·반 이름·프로그램 재료. 고르는 규칙은 `pickLastEnded`(종료일 → 시작일 →
    // id, window.ts)와 같다 — 같은 날 끝난 두 반을 화면마다 다르게 고르면 반 이름·프로그램이 갈린다.
    const endedDetail = ended.map((subject) => {
      const subjectRows = enr
        .filter((e) => e.subject === subject)
        .map((e) => ({ ...e, end_date: e.endDate, start_date: e.startDate, is_transferred: e.isTransferred }));
      const best = pickLastEnded(subjectRows);
      return {
        subject,
        endedAt: lastEndOf(subject) ?? best?.endDate ?? null,
        className: best?.className ?? null,
        englishTrack: best?.englishTrack ?? null,
        // 그 과목 마지막 수강의 종료 사유(원문) — 퇴원관리 사유 카드·필터가 퇴원 사유와 함께 센다.
        reason: best?.reason ?? null,
        isTransferred: best?.isTransferred === true,
        endedTogether: endedTogether(subjectRows).map((e) => ({
          enrollmentId: e.id,
          classId: e.classId,
          startDate: e.startDate,
          endDate: e.endDate,
          isTransferred: e.isTransferred === true,
        })),
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

/** 기간 안에 끝난 수강이 있는 재원·휴원 학생(수강종료 후보) — `getSubjectEndedStudents({ endedWithin })` 전용. */
async function loadEndedWithinStudents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  within: { from: string; to: string },
): Promise<StudentBits[]> {
  const endedRows = await fetchAllPaged<{ student_id: string }>((from, to) =>
    supabase
      .from("enrollments")
      .select("student_id")
      .gte("end_date", within.from)
      .lte("end_date", within.to)
      .order("id")
      .range(from, to),
  );
  const ids = [...new Set(endedRows.map((r) => r.student_id))];
  if (ids.length === 0) return [];
  return fetchAllPagedInChunks<StudentBits>(ids, (chunk, from, to) =>
    supabase
      .from("students")
      .select("id, name, school, grade, status")
      .in("id", chunk)
      .in("status", ["enrolled", "on_hold"])
      .order("id")
      .range(from, to),
  );
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
