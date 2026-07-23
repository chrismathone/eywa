import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { SystemRole } from "@/lib/permissions";
import {
  WORK_DAYS,
  WORK_TIME_RANGE,
  sanitizeWorkSchedule,
  type WorkDay,
  type WorkSchedule,
} from "@/features/staff/work-schedule";

// 근무 일정 순수 로직 재노출(기존 import 경로 호환 — classes-tab·schedule-editor가 여기서 가져감).
export { WORK_DAYS, WORK_TIME_RANGE, sanitizeWorkSchedule };
export type { WorkDay, WorkSchedule };

export type StaffRow = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  systemRole: SystemRole;
  status: string;
  classesCount: number;
  primaryStudentsCount: number;
};

export async function getStaffList(): Promise<StaffRow[]> {
  const supabase = await createClient();

  // 세 쿼리는 서로 독립 → 병렬(3 round-trip → 1). users/classes/students 모두 단일 테넌트 ≤1000행이라
  // 절단 위험 없음(현재 users 39·classes 129·enrolled 524).
  const [{ data: users }, { data: teaching }] = await Promise.all([
    supabase
      .from("users")
      .select("id, display_name, email, phone, system_role, status")
      .neq("status", "inactive")
      .order("system_role", { ascending: true })
      .order("display_name", { ascending: true }),
    supabase.from("classes").select("id, teacher_id").eq("is_active", true),
  ]);

  if (!users) return [];

  const classCount = new Map<string, number>();
  const classTeacher = new Map<string, string>(); // class_id → teacher_id(과목 담당)
  for (const c of teaching ?? []) {
    if (!c.teacher_id) continue;
    classCount.set(c.teacher_id, (classCount.get(c.teacher_id) ?? 0) + 1);
    classTeacher.set(c.id, c.teacher_id);
  }

  // 담당 학생 수 = 강사의 활성 반에 수강 중(end_date null)인 distinct 학생(과목 담당=classes.teacher_id 기준).
  // (구 primary_teacher_id 카운트 대체 — 과목제라 단일 담임 없음.)
  const studentsByTeacher = new Map<string, Set<string>>();
  const activeClassIds = [...classTeacher.keys()];
  if (activeClassIds.length > 0) {
    const ens = await fetchInChunks<{ class_id: string; student_id: string }>(activeClassIds, (chunk) =>
      supabase.from("enrollments").select("class_id, student_id").is("end_date", null).in("class_id", chunk),
    );
    for (const e of ens) {
      const tid = classTeacher.get(e.class_id);
      if (!tid) continue;
      const set = studentsByTeacher.get(tid) ?? new Set<string>();
      set.add(e.student_id);
      studentsByTeacher.set(tid, set);
    }
  }

  return users.map((u) => ({
    id: u.id,
    displayName: u.display_name,
    email: u.email,
    phone: u.phone ?? null,
    systemRole: u.system_role as SystemRole,
    status: u.status,
    classesCount: classCount.get(u.id) ?? 0,
    primaryStudentsCount: studentsByTeacher.get(u.id)?.size ?? 0,
  }));
}

export type StaffDetail = {
  id: string;
  displayName: string;
  email: string;
  phone: string | null;
  systemRole: SystemRole;
  status: "active" | "inactive" | "pending";
  hireDate: string | null;
  jobTitle: string | null;
  /**
   * 영어 닉네임(`users.english_name`). 비우면 이름을 그대로 쓰고, 채우면 영어 표면에서 이 값으로 매핑한다.
   * 이미 소비처가 있다: 영어 시간표 임포트가 시트의 `Jane 중1 정규A` 같은 라벨을 이 값으로 강사에 붙이고
   * (`features/timetable/import/structure/match`), 통합 시트 내보내기가 `이름 (닉네임)`으로 표기한다.
   * 입력 UI만 없어서 임포트가 채운 값이 화면에서 안 보이던 것을 배선했다(2026-07-22).
   */
  englishName: string | null;
  subjects: string[];
  defaultClassroom: string | null;
  memo: string | null;
  bgColor: string | null;
  hourlyRate: number;
  monthlyBase: number;
};

export async function getStaffById(id: string): Promise<StaffDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select(
      "id, display_name, email, phone, system_role, status, hire_date, job_title, english_name, subjects, default_classroom, memo, bg_color, hourly_rate, monthly_base",
    )
    .eq("id", id)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    displayName: data.display_name,
    email: data.email,
    phone: data.phone ?? null,
    systemRole: data.system_role as SystemRole,
    status: data.status as "active" | "inactive" | "pending",
    hireDate: data.hire_date,
    jobTitle: data.job_title,
    englishName: data.english_name ?? null,
    subjects: Array.isArray(data.subjects) ? (data.subjects as string[]) : [],
    defaultClassroom: data.default_classroom,
    memo: data.memo,
    bgColor: data.bg_color ?? null,
    hourlyRate: Number(data.hourly_rate ?? 0),
    monthlyBase: Number(data.monthly_base ?? 0),
  };
}

/**
 * 이 직원 계정이 **한 번이라도 로그인한 적 있는지**(auth.users.last_sign_in_at).
 * 초대만 해두고 아직 안 들어온 계정이면 이메일 오타를 화면에서 고칠 수 있다(`canEditLoginEmail`).
 * auth 스키마는 admin 클라이언트로만 읽힌다 — 호출부(직원 수정 화면·액션)가 이미 canManageStaff로 잠겨 있다.
 * ⚠️ 조회 실패·계정 없음은 **"로그인한 적 있음"(=이메일 잠금)** 으로 떨어뜨린다 — 모르면 안 여는 쪽.
 */
export async function hasStaffEverSignedIn(id: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error || !data?.user) return true;
  return Boolean(data.user.last_sign_in_at);
}

// Alias for backward-compat (별칭 — payroll/leaves 페이지에서 사용)
export const getStaffDetail = getStaffById;

// === 근무 일정 (work_schedule jsonb) — 순수 로직은 ../work-schedule.ts ===
export async function getStaffWorkSchedule(id: string): Promise<WorkSchedule> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("work_schedule")
    .eq("id", id)
    .single();
  // 오류 시 빈 일정으로 폴백(상세 페이지 보호) — 단 조용히 삼키지 않고 로깅해 누락을 진단 가능하게.
  if (error || !data) {
    if (error) console.warn(`[getStaffWorkSchedule] ${id} 조회 실패 — 빈 일정으로 폴백:`, error.message);
    return {};
  }
  return sanitizeWorkSchedule((data as { work_schedule?: unknown }).work_schedule);
}

// === 퇴사 처리 경고 — 이 직원이 담임(classes.teacher_id)인 진행중 반 ===
// 퇴사해도 담임 배정은 자동 해제되지 않아(FK는 on delete set null뿐, status 변경은 무전파)
// 시간표·출석부에 "(퇴직)" 담임으로 남는다 → 퇴사 확인 다이얼로그가 이 목록으로 사전 경고한다.
export type HomeroomClassRow = {
  id: string;
  className: string;
  /** 강사 인수인계(0044a)가 예약돼 있으면 새 담임 이름·적용일 — 이미 조치된 반임을 표시 */
  pendingTeacherName: string | null;
  pendingTeacherDate: string | null;
};

export async function getActiveHomeroomClasses(teacherId: string): Promise<HomeroomClassRow[]> {
  const supabase = await createClient();
  const actor = await getCurrentUser();
  if (!actor) return [];

  // 강사 1인의 담임 반은 수십 이하 — 절단 위험 없음(getStaffClasses와 동일 전제).
  const { data } = await supabase
    .from("classes")
    .select(
      "id, class_name, pending_teacher_date, pending_teacher:pending_teacher_id ( display_name )",
    )
    .eq("tenant_id", actor.tenantId)
    .eq("teacher_id", teacherId)
    .eq("is_active", true)
    .order("class_name", { ascending: true });

  return (data ?? []).map((c) => {
    const pt = (Array.isArray(c.pending_teacher) ? c.pending_teacher[0] : c.pending_teacher) as
      | { display_name?: string }
      | null
      | undefined;
    return {
      id: c.id,
      className: c.class_name,
      pendingTeacherName: pt?.display_name ?? null,
      pendingTeacherDate:
        (c as { pending_teacher_date?: string | null }).pending_teacher_date ?? null,
    };
  });
}

// === 강사 담당 수업 이력 ===
export type StaffClassRow = {
  id: string;
  className: string;
  subject: string;
  isActive: boolean;
  studentCount: number;
  schedules: { day: WorkDay; startTime: string; endTime: string }[];
};

export async function getStaffClasses(teacherId: string): Promise<StaffClassRow[]> {
  const supabase = await createClient();
  // RLS가 테넌트를 강제하지만(인증 클라이언트), 방어적으로 명시 tenant_id 필터도 건다(#S1 정신).
  const actor = await getCurrentUser();
  if (!actor) return [];

  const { data: classes } = await supabase
    .from("classes")
    .select("id, class_name, subject, is_active")
    .eq("tenant_id", actor.tenantId)
    .eq("teacher_id", teacherId)
    .order("is_active", { ascending: false })
    .order("class_name", { ascending: true });

  if (!classes || classes.length === 0) return [];

  const ids = classes.map((c) => c.id);

  // 강사 1인의 반은 소수(수십)라 단일 .in()로 안전.
  const [{ data: schedules }, { data: enrolls }] = await Promise.all([
    supabase
      .from("class_schedules")
      .select("class_id, day_of_week, start_time, end_time")
      .in("class_id", ids),
    supabase.from("enrollments").select("class_id, end_date").in("class_id", ids),
  ]);

  const schedByClass = new Map<string, StaffClassRow["schedules"]>();
  for (const s of schedules ?? []) {
    const list = schedByClass.get(s.class_id) ?? [];
    list.push({
      day: s.day_of_week as WorkDay,
      startTime: String(s.start_time).slice(0, 5),
      endTime: String(s.end_time).slice(0, 5),
    });
    schedByClass.set(s.class_id, list);
  }

  const countByClass = new Map<string, number>();
  for (const e of enrolls ?? []) {
    if (e.end_date) continue; // 진행 중 등록만 카운트
    countByClass.set(e.class_id, (countByClass.get(e.class_id) ?? 0) + 1);
  }

  const dayOrder: Record<WorkDay, number> = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };
  return classes.map((c) => ({
    id: c.id,
    className: c.class_name,
    subject: c.subject,
    isActive: c.is_active,
    studentCount: countByClass.get(c.id) ?? 0,
    schedules: (schedByClass.get(c.id) ?? []).sort(
      (a, b) => dayOrder[a.day] - dayOrder[b.day] || a.startTime.localeCompare(b.startTime),
    ),
  }));
}
