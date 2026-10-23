import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import { kstDateOf } from "@/lib/date-kst";
import { kstDayBounds } from "@/features/enrollment/kst-bounds";
import { baseNameOf } from "@/features/students/name-suffix";
import {
  schoolGradeKey,
  type FirstClassCandidate,
  type FirstClassSchedule,
} from "./admissions-class-link";
import type { AdmissionsConsultationCandidate } from "./admissions-consultation-link";


/** cron(관리 키 · 세션 없음)으로 부를 때의 재료 — 관리 키는 RLS를 건너뛰므로 모든 조회에 지점(tenant_id)을 건다. */
export type AdminDeps = { db: ReturnType<typeof createAdminClient>; tenantId: string };

/**
 * 일정 연결 후보 + 진행 판정 재료(outcome·과목) — 운영실 일정 카드와 '상담 진행' 카드가 **같은 한 번의 조회**를 나눠 쓴다
 * (갱신 30초마다 같은 표를 두 번 읽지 않게, 두 카드가 같은 상담 집합을 보게).
 */
export type ConsultationRow = AdmissionsConsultationCandidate & {
  /** outcome 원값 — 화면에 그대로 내보내지 않는다(칸반 단계 판정 재료). */
  outcome: string;
  /** 상담 과목 키(학원설정) 또는 옛 자유 텍스트 — 배정 판정은 칸반과 같은 `consultClassKeys`로 반 과목 키 목록을 만들어 견준다. */
  subject: string | null;
};

/**
 * 동명이인 가족 — 접미사 뗀 이름마다 그 이름을 쓰는 **재원·대기(퇴원 아님)** 원생들의 학교·학년 키. 일정 제목에 걸린 이름만 넘어온다(보통 몇 개).
 * 60일 창 안 상담이 한 명뿐이어도 원생 표엔 같은 이름이 더 있을 수 있다 — 매처가 그때 직접 증거를 요구한다(규칙 6).
 */
export async function homonymFamilies(
  bases: readonly string[],
  /** cron(관리 키) 경로 — 관리 키는 RLS를 건너뛰므로 `tenantId` 필수([[#104]]). 없으면 로그인 사용자(RLS). */
  deps?: AdminDeps,
): Promise<Map<string, { studentId: string; key: string }[]>> {
  const safe = [...new Set(bases)].filter((base) => /^[가-힣]{2,4}$/.test(base));
  if (!safe.length) return new Map();
  const db = deps?.db ?? (await createClient());
  const rows = await fetchAllPaged<{ id: string; name: string; school: string | null; grade: string | null }>((from, to) => {
    let q = db
      .from("students")
      .select("id,name,school,grade")
      .neq("status", "withdrawn")
      .or(safe.map((base) => `name.like.${base}*`).join(","));
    if (deps) q = q.eq("tenant_id", deps.tenantId);
    return q.order("id").range(from, to);
  });
  const families = new Map<string, { studentId: string; key: string }[]>();
  for (const row of rows) {
    const base = baseNameOf(row.name.trim());
    if (!safe.includes(base)) continue; // like 'X*'는 'X현' 같은 다른 이름도 잡는다 — 접미사 뗀 이름이 정확히 같을 때만
    families.set(base, [...(families.get(base) ?? []), { studentId: row.id, key: schoolGradeKey(row.school, row.grade) }]);
  }
  return families;
}

/**
 * 일정 ↔ 콜&상담 연결 후보 — 상담 날짜가 `sinceDate`(KST) 이후인 건. 콜&상담 열람 권한을 확인한 호출부에서만 부른다(RLS도 걸린다).
 * 보호자 번호는 서버 판정에만 쓰고 클라이언트엔 **일치한 상담 id·이름만** 간다.
 * 🔑 날짜는 `consulted_at`(NOT NULL — 이관된 옛 상담도 원래 날짜가 들어 있다; created_at은 이관 시각이라 그걸로 거르면 2024년 상담이 창에 든다).
 */
export async function admissionsConsultationCandidates(
  sinceDate: string,
  /** cron(관리 키) 경로 — `tenantId` 필수([[#104]]). */
  deps?: AdminDeps,
): Promise<ConsultationRow[]> {
  const db = deps?.db ?? (await createClient());
  const { startIso } = kstDayBounds(sinceDate);
  type Student = { name: string };
  type Row = {
    id: string;
    prospect_name: string | null;
    prospect_school: string | null;
    prospect_grade: string | null;
    parent_phone: string | null;
    student_id: string | null;
    consulted_at: string;
    outcome: string;
    subject: string | null;
    student: Student | Student[] | null;
  };
  const rows = await fetchAllPaged<Row>((from, to) => {
    let q = db
      .from("enrollment_consultations")
      .select(
        "id,prospect_name,prospect_school,prospect_grade,parent_phone,student_id,consulted_at,outcome,subject,student:students!enrollment_consultations_student_id_students_id_fk(name)",
      )
      .gte("consulted_at", startIso);
    if (deps) q = q.eq("tenant_id", deps.tenantId);
    return q.order("id").range(from, to);
  });
  return rows.flatMap((row) => {
    const name = row.prospect_name?.trim();
    const consultedOn = kstDateOf(row.consulted_at);
    if (!name || !consultedOn) return [];
    const student = Array.isArray(row.student) ? row.student[0] : row.student;
    const digits = (row.parent_phone ?? "").replace(/\D/g, "");
    return [
      {
        id: row.id,
        name,
        school: row.prospect_school,
        grade: row.prospect_grade,
        phoneDigits: digits.length >= 9 ? digits : null,
        studentId: row.student_id,
        studentName: student?.name ?? null,
        consultedOn,
        outcome: row.outcome,
        subject: row.subject || null,
      },
    ];
  });
}

/** 캘린더와 학생·수업 열람 권한을 모두 확인한 호출부에서만 사용한다. 클라이언트에는 일치한 반만 보낸다. */
export async function firstClassCandidates(
  fromDate: string,
  toDate: string,
): Promise<FirstClassCandidate[]> {
  const [db, scope] = await Promise.all([
    createClient(),
    effectiveTeacherScope(),
  ]);
  if (scope && !scope.studentIds.length) return [];
  type Student = { name: string; school: string | null; grade: string | null };
  type Class = {
    class_name: string;
    subject: string;
    closed_at: string | null;
  };
  type Row = {
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    on_hold: boolean;
    is_transferred: boolean;
    student: Student | Student[];
    class: Class | Class[];
  };
  const rows = await fetchAllPaged<Row>((from, to) =>
    db
      .from("enrollments")
      .select(
        "student_id,class_id,start_date,end_date,on_hold,is_transferred,student:student_id!inner(name,school,grade),class:class_id!inner(class_name,subject,is_active,closed_at)",
      )
      .eq("on_hold", false)
      .eq("class.is_active", true)
      .lte("start_date", toDate)
      .or(`end_date.is.null,end_date.gte.${fromDate}`)
      .order("id")
      .range(from, to),
  );
  const ids = scope ? new Set(scope.studentIds) : null;
  const classIds = scope ? new Set(scope.classIds) : null;
  return rows
    .filter(
      (row) =>
        (!ids || ids.has(row.student_id)) &&
        (!classIds || classIds.has(row.class_id)),
    )
    .flatMap((row) => {
      const student = Array.isArray(row.student) ? row.student[0] : row.student;
      const klass = Array.isArray(row.class) ? row.class[0] : row.class;
      if (!student || !klass) return [];
      return [
        {
          studentId: row.student_id,
          studentName: student.name,
          school: student.school,
          grade: student.grade,
          classId: row.class_id,
          className: klass.class_name,
          subject: klass.subject,
          startDate: row.start_date,
          endDate: row.end_date,
          onHold: row.on_hold,
          isTransferred: row.is_transferred,
          closedAt: klass.closed_at,
        },
      ];
    });
}

export async function firstClassScheduleCandidates(
  fromDate: string,
  toDate: string,
): Promise<FirstClassSchedule[]> {
  const [db, scope] = await Promise.all([
    createClient(),
    effectiveTeacherScope(),
  ]);
  if (scope && !scope.classIds.length) return [];
  type Teacher = { display_name: string };
  type Class = {
    class_name: string;
    subject: string;
    closed_at: string | null;
    teacher: Teacher | Teacher[] | null;
  };
  type Row = {
    class_id: string;
    day_of_week: string;
    start_time: string;
    valid_from: string;
    valid_to: string | null;
    slot_teacher_label: string | null;
    slotTeacher: Teacher | Teacher[] | null;
    class: Class | Class[];
  };
  const rows = await fetchAllPaged<Row>((from, to) =>
    db
      .from("class_schedules")
      .select(
        "class_id,day_of_week,start_time,valid_from,valid_to,slot_teacher_label,slotTeacher:teacher_id(display_name),class:class_id!inner(class_name,subject,is_active,closed_at,teacher:teacher_id(display_name))",
      )
      .eq("class.is_active", true)
      .lte("valid_from", toDate)
      .or(`valid_to.is.null,valid_to.gte.${fromDate}`)
      .order("id")
      .range(from, to),
  );
  const classIds = scope ? new Set(scope.classIds) : null;
  return rows
    .filter((row) => !classIds || classIds.has(row.class_id))
    .flatMap((row) => {
      const klass = Array.isArray(row.class) ? row.class[0] : row.class;
      if (!klass) return [];
      const teacher = Array.isArray(row.slotTeacher)
        ? row.slotTeacher[0]
        : row.slotTeacher;
      const homeroom = Array.isArray(klass.teacher)
        ? klass.teacher[0]
        : klass.teacher;
      return [
        {
          classId: row.class_id,
          className: klass.class_name,
          subject: klass.subject,
          dayOfWeek: row.day_of_week,
          startTime: row.start_time,
          teacherName:
            teacher?.display_name ??
            row.slot_teacher_label ??
            homeroom?.display_name ??
            null,
          validFrom: row.valid_from,
          validTo: row.valid_to,
          closedAt: klass.closed_at,
        },
      ];
    });
}
