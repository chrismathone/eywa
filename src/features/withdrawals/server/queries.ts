import "server-only";
import { kstDateOf, kstToday } from "@/lib/date-kst";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { reportWarning } from "@/lib/observability/report-error";
import { isMergedStudent } from "@/features/students/status/merged";
import { REASON_LABEL, normalizeReason, type WithdrawalMetadata } from "../types";
import { detailFor } from "../reason-detail";
import { countsForSubjectExit, getEndedSubjects } from "../subject-ended";
import { subjectRunStart } from "../exit-month";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { isBookkeepingOnlyExit, isCleanupExit, isSystemBulkWithdrawal } from "../system-bulk";
import { endedTogether, lastEndedByStudent, pickLastEnded, type EndedClassRef } from "../window";
import { withdrawalSubjects } from "../exit-rows";
import { lastClassOf, loadEndedEnrollments } from "./window";
import { loadExitCountDates, loadSubjectExitCountDates } from "./exit-month";
import { getTenantSettings } from "@/features/owner/server/queries";

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
  /** 기간 판정 날짜 — 퇴원월(수강료를 낸 마지막 달, `exit-month.ts`)이 앞 달이면 그 달 말일. 목록만 채운다(상세 화면은 안 채운다). */
  exitDate?: string | null;
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
  /** 퇴원 메모 원문(`withdrawal_metadata.memo` — 사유가 없어도) — 퇴원관리 명단의 사유 칸. 상세 화면은 안 채운다. */
  memoText?: string | null;
  /** 장부 정리 일괄 퇴원(`isCleanupExit` — 실제 사유가 아니다). 상세 화면은 안 채운다. */
  cleanup?: boolean;
};

function parseMetadata(raw: unknown): WithdrawalMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<WithdrawalMetadata>;
  const reason = normalizeReason(m.reason); // 마이그레이션 표기 흔들림 흡수 (dissatisfied→dissatisfaction 등)
  if (!reason) return null;
  return {
    reason,
    // 세부 사유(2단계) — 그 대분류의 것만 살린다(대분류를 바꾼 뒤 남은 옛 세부가 새 대분류 아래 서지 않게, `detailFor`).
    ...(detailFor(reason, typeof m.detail === "string" ? m.detail : null) ? { detail: m.detail } : {}),
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
        `id, tenant_id, name, school, grade, enrolled_at, withdrawn_at, withdrawal_metadata, notes`,
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
  //    두 화면의 숫자가 같다(원장 2026-09-13, `students/merged.ts`). 수업 기록 없는 장부 정리는 수강을 읽은 뒤 뺀다(아래).
  const students = withdrawnRows.filter((s) => !isMergedStudent(s.notes));

  if (students.length === 0) return [];

  // 마지막 종료 수강 = 운영실 '퇴원생'과 **같은 조회·같은 선택**(window.ts) — 청크 × 페이징이라 청크 안 1000행
  // 절단도 없고, 종료일이 같은 두 줄은 결정적 tie-break로 고른다(조회마다 다른 반이 뽑히지 않게).
  // 퇴원월(수강료를 낸 마지막 달, 원장 2026-10-29)은 수강과 따로 읽는다(B4).
  const [ended, exitDates] = await Promise.all([
    loadEndedEnrollments(supabase, students.map((s) => s.id)),
    loadExitCountDates(students.map((s) => ({ id: s.id, tenantId: s.tenant_id, withdrawnAt: s.withdrawn_at }))),
  ]);
  const lastByStudent = lastEndedByStudent(ended);
  const endedByStudent = new Map<string, { endDate: string | null; subject: string | null }[]>();
  for (const e of ended) {
    const list = endedByStudent.get(e.student_id) ?? [];
    list.push({ endDate: e.end_date, subject: lastClassOf(e).subject });
    endedByStudent.set(e.student_id, list);
  }

  // 수업 기록 없는 장부 정리(단체 정리)는 조용히 뺀다 — 운영실(window.ts)과 같은 판정(`isBookkeepingOnlyExit`, 원장 2026-10-15).
  const visible = students.filter(
    (s) => !isBookkeepingOnlyExit({ withdrawalMetadata: s.withdrawal_metadata, hasEnrollmentHistory: lastByStudent.has(s.id) }),
  );

  return visible.map((s) => {
    const lastRow = lastByStudent.get(s.id);
    const last = lastClassOf(lastRow);
    const md = parseMetadata(s.withdrawal_metadata);
    // 수강(종료) 이력 유무 = '시스템 정리(날짜 미상)' 판정 입력. lastClassName은 반 조인 실패로도 null이 될 수
    // 있어 신뢰할 수 없으므로, **enrollment 행의 존재 자체**로 본다.
    const hasEnrollmentHistory = !!lastRow;
    // 메모는 사유와 따로 읽는다 — `parseMetadata`는 사유가 없으면 메타데이터를 통째로 버린다(장부 정리 메모는 사유가 비기도 한다).
    const rawMemo = (s.withdrawal_metadata as { memo?: unknown } | null)?.memo;
    const memoText = typeof rawMemo === "string" && rawMemo.trim() ? rawMemo.trim() : null;
    return {
      id: s.id,
      name: s.name,
      school: s.school,
      grade: s.grade,
      enrolledAt: s.enrolled_at,
      withdrawnAt: s.withdrawn_at,
      exitDate: exitDates.get(s.id) ?? null,
      lastClassName: last.className,
      lastClassSubject: last.subject,
      lastClassEnglishTrack: last.englishTrack,
      withdrawalReason: md?.reason ? REASON_LABEL[md.reason] : last.reason,
      metadata: md,
      hasEnrollmentHistory,
      systemBulk: isSystemBulkWithdrawal({ withdrawnAt: s.withdrawn_at, hasEnrollmentHistory }),
      exitSubjects: withdrawalSubjects(endedByStudent.get(s.id) ?? []),
      memoText,
      // 명단에서 빼는 판정과 같은 기준(메모 + 사유 '기타') — 사유를 고쳤으면 장부 정리 막대가 아니라 그 사유로 선다.
      cleanup: isCleanupExit(s.withdrawal_metadata),
    };
  });
}

export type WithdrawalDetail = WithdrawalRow & {
  /** 지금 학생 상태 — 퇴원 예약(퇴원일이 미래라 아직 재원)과 실제 퇴원을 가른다(퇴원보고서 날짜 표시). */
  studentStatus: string | null;
  studentPhone: string | null;
  parentPhone: string | null;
  parentName: string | null;
  enrollmentHistory: {
    id: string;
    classId: string | null;
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
        `id, name, school, grade, status, enrolled_at, withdrawn_at, withdrawal_metadata,
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
        classId: k?.id ?? null,
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
    studentStatus: (s as { status?: string | null }).status ?? null,
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
  /** 지점 — 청구를 admin으로 읽을 때 좁히는 열쇠(`loadSubjectExitCountDates`). */
  tenantId: string;
  name: string;
  school: string | null;
  grade: string | null;
  status: string; // enrolled | on_hold | withdrawn(퇴원 전에 먼저 끊은 과목 — 2026-11-11)
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
    /**
     * 기간 판정 날짜 — 그 과목 수업료를 낸 마지막 달(앞 달이면 그 달 말일 · 원장 2026-10-29 · `subjectExitCountDate`). 날짜 기준 조회
     * (`basis: "date"` — 시간표 X)면 `endedAt` 그대로. 표시하는 종료일은 `endedAt`이다.
     */
    countAt: string | null;
    /** 그 과목을 마지막으로 이어 다닌 시작일(`subjectRunStart`) — 이보다 앞선 납부로 `countAt`을 정하지 않는다. */
    runStart?: string | null;
    /** 그 마지막 수강 행 id — 세부 사유·메모(`withNotes`)를 읽는 열쇠. */
    enrollmentId?: string;
    /** 세부 사유 키·메모(0367a `withdrawal_detail`·`withdrawal_memo`) — `withNotes`일 때만 채운다. */
    detail?: string | null;
    memo?: string | null;
    isTransferred?: boolean;
    /**
     * 그 과목에서 함께 끝난 수강(특강 제외, 첫째 = 마지막 수강) — 시간표 X 겹침이 그때 담임·'퇴원 0'을 가리는 재료.
     * 종료일은 수강마다다 — `endedAt`은 특강까지 본 과목 종료일이라 다를 수 있다(담임은 그 반의 그 날로 찾는다).
     */
    endedTogether?: EndedClassRef[];
  }[];
};

type ClassBits = { subject?: string; class_name?: string | null; english_track?: string | null; is_special?: boolean | null };
type StudentBits = {
  id: string; tenant_id: string; name: string; school: string | null; grade: string | null; status: string;
  withdrawn_at?: string | null; notes?: string | null; withdrawal_metadata?: unknown;
};
/**
 * 🔴 퇴원한 학생도 읽는다(원장 2026-11-11 *"과목 수강종료도 결국 수학과 퇴원이라는거잖아"*) — 한 과목을 먼저 끊고 나중에 전체 퇴원하면
 * 먼저 끊은 과목이 퇴원 줄(그 무렵 끝난 과목만 — `withdrawalSubjects`)에도 수강종료 줄에도 없어 지난달 숫자가 나중에 줄었다
 * (퇴원생 관리 차트 대조 2026-11-11 · 추이수 4/24 수학 종료 → 9/16 퇴원 등 11건).
 */
const STUDENT_COLUMNS = "id, tenant_id, name, school, grade, status, withdrawn_at, notes, withdrawal_metadata";
const ENDED_STATUSES = ["enrolled", "on_hold", "withdrawn"];

/**
 * `endedWithin`을 주면 **그 기간에 끝난 수강이 있는 학생만** 후보로 읽는다(시간표 X 겹침 — 석 달 창).
 * 🔑 판정은 그대로다: 수강종료 날짜(`endedAt`)는 그 학생 수강 중 하나의 종료일이므로, 날짜가 창 안인 줄은
 *    반드시 창 안에 끝난 수강을 가진 학생에게서 나온다 — 후보를 좁혀도 창 안의 줄은 전부 같다(창 밖 줄은 호출부가 거른다).
 */
export async function getSubjectEndedStudents(opts?: {
  endedWithin?: { from: string; to: string };
  /**
   * 세부 사유·메모도 읽는다(퇴원관리 명단·사유 카드만) — 🔴 운영실·시간표 X가 쓰는 기본 조회엔 새 칸을 넣지 않는다(#95:
   * SQL보다 앱이 먼저 나가도 그 화면들이 죽지 않게). 따로 읽고, 실패하면 메모 없이 그린다.
   */
  withNotes?: boolean;
  /**
   * 어느 달로 세나 — 기본 `"tuition"`(그 과목 수업료를 낸 마지막 달 · 운영실 '퇴원&수업종료'·퇴원관리) · `"date"` = 종료일(시간표 X — 강사평가
   * 퇴원율과 같은 달). 퇴원 쪽 `getWithdrawalsInWindow`의 `basis`와 같은 뜻.
   */
  basis?: "tuition" | "date";
  /**
   * 이 날짜 이후에 끝난 줄만 청구로 다시 판정한다(그 전 줄은 `countAt` = 종료일) — `countAt`은 종료일보다 늦지 않으므로 창 `from` 앞에서 끝난
   * 줄은 판정해도 창에 들지 않는다. 운영실 이번 달 카드가 전 기간 청구를 읽지 않게(적대 리뷰 2026-10-29).
   */
  countFrom?: string;
}): Promise<SubjectEndedRow[]> {
  const supabase = await createClient();
  const within = opts?.endedWithin;
  // 퇴원생은 세는 창보다 늦게 퇴원한 학생만 — 먼저 끊은 과목은 퇴원일보다 앞이라, 창 전에 퇴원했으면 그 줄도 창 밖이다.
  const withdrawnFloor = within?.from ?? opts?.countFrom ?? null;
  const students: StudentBits[] = within
    ? await loadEndedWithinStudents(supabase, within)
    : // 재원/휴원(+퇴원) 학생 전수 — .range() 페이지네이션으로 1000행 절단 방지(#54).
      await fetchAllPaged<StudentBits>((from, to) => {
        const q = supabase.from("students").select(STUDENT_COLUMNS).in("status", ENDED_STATUSES);
        return (withdrawnFloor ? q.or(`status.neq.withdrawn,withdrawn_at.gte.${withdrawnFloor}`) : q).order("id").range(from, to);
      });
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
    const split = getEndedSubjects(enr, today);
    let { ended, active } = split;
    if (s.status === "withdrawn") {
      // 퇴원생 = 퇴원 무렵 함께 끝난 과목(퇴원 줄이 센다 — 같은 함수 `withdrawalSubjects`)을 빼고, 퇴원일 전에 먼저 끊은 과목만.
      // 병합으로 흡수된 학생은 퇴원 줄과 같이 뺀다. 그때 계속 다니던 과목은 지금 다니는 과목이 아니라서 비운다('수강중' 표시 금지).
      const withdrawnOn = s.withdrawn_at ? kstDateOf(s.withdrawn_at) : null;
      if (!withdrawnOn || isMergedStudent(s.notes ?? null)) continue;
      // 퇴원 줄을 숨기는 장부 정리(수업 흔적 없음 표식 포함)는 먼저 끊은 과목도 숨긴다 — 퇴원 줄과 같은 판정(`isBookkeepingOnlyExit`).
      if (isBookkeepingOnlyExit({ withdrawalMetadata: s.withdrawal_metadata, hasEnrollmentHistory: all.some((e) => e.endDate) })) continue;
      const atExit = new Set(withdrawalSubjects(all.filter((e) => e.endDate).map((e) => ({ endDate: e.endDate, subject: e.subject }))));
      ended = ended.filter((subject) => !atExit.has(subject) && (lastEndOf(subject) ?? "") <= withdrawnOn);
      active = [];
    }
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
      const endedAt = lastEndOf(subject) ?? best?.endDate ?? null;
      return {
        subject,
        endedAt,
        countAt: endedAt,
        runStart: subjectRunStart(
          all.filter((e) => e.subject === subject),
          best?.startDate ?? null,
        ),
        className: best?.className ?? null,
        englishTrack: best?.englishTrack ?? null,
        // 그 과목 마지막 수강의 종료 사유(원문) — 퇴원관리 사유 카드·필터가 퇴원 사유와 함께 센다.
        reason: best?.reason ?? null,
        enrollmentId: best?.id,
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
      tenantId: s.tenant_id,
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
  await Promise.all([
    opts?.withNotes ? attachEndedNotes(supabase, rows) : null,
    opts?.basis === "date" ? null : attachSubjectCountDates(rows, opts?.countFrom),
  ]);
  return rows;
}

/** 수강종료 줄마다 그 과목 수업료를 낸 마지막 달로 `countAt`을 고친다(원장 2026-10-29). 청구를 못 읽으면 던진다(다른 달에 세지 않는다). */
async function attachSubjectCountDates(rows: SubjectEndedRow[], countFrom?: string): Promise<void> {
  const ends = rows.flatMap((r) =>
    r.endedDetail
      .filter((d) => !countFrom || (d.endedAt ?? "") >= countFrom)
      .map((d) => ({ studentId: r.id, tenantId: r.tenantId, subject: d.subject, endedAt: d.endedAt, since: d.runStart })),
  );
  if (!ends.length) return;
  const settings = await getTenantSettings();
  const dates = await loadSubjectExitCountDates(ends, settings.operations.subjects);
  for (const r of rows) for (const d of r.endedDetail) d.countAt = dates.get(`${r.id}|${d.subject}`) ?? d.endedAt;
}

/** 수강 종료 줄의 세부 사유·메모(0367a) — 그 줄의 마지막 수강 행에서. 실패(칸이 아직 없음 등)하면 경고만 남기고 비운 채 둔다. */
async function attachEndedNotes(supabase: Awaited<ReturnType<typeof createClient>>, rows: SubjectEndedRow[]): Promise<void> {
  const ids = [...new Set(rows.flatMap((r) => r.endedDetail.flatMap((d) => (d.enrollmentId ? [d.enrollmentId] : []))))];
  try {
    const notes = await fetchInChunks<{ id: string; withdrawal_detail: string | null; withdrawal_memo: string | null }>(ids, (chunk) =>
      supabase.from("enrollments").select("id, withdrawal_detail, withdrawal_memo").in("id", chunk),
    );
    const byId = new Map(notes.map((n) => [n.id, n]));
    for (const r of rows)
      for (const d of r.endedDetail) {
        const n = d.enrollmentId ? byId.get(d.enrollmentId) : undefined;
        d.detail = n ? detailFor(d.reason, n.withdrawal_detail) : null;
        d.memo = n?.withdrawal_memo?.trim() || null;
      }
  } catch (e) {
    reportWarning("수강 종료 세부 사유·메모를 읽지 못함", { scope: "withdrawals.endedNotes", message: e instanceof Error ? e.message : String(e) });
  }
}

/** 기간 안에 끝난 수강이 있는 재원·휴원·(창 뒤에 퇴원한) 퇴원 학생(수강종료 후보) — `getSubjectEndedStudents({ endedWithin })` 전용. */
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
      .select(STUDENT_COLUMNS)
      .in("id", chunk)
      .in("status", ENDED_STATUSES)
      .or(`status.neq.withdrawn,withdrawn_at.gte.${within.from}`)
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
