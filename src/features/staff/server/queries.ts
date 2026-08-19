import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import type { SystemRole } from "@/lib/permissions";
import { getSeatDuties } from "@/features/attendance/seat/server/duty";
import { getDeskAttendanceOptin } from "@/features/attendance/live/server/desk-optin";
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
  hireDate: string | null;
  jobTitle: string | null;
  subjects: string[];
  department: string | null; // 근무부서(0147a — 이력서/직원명부에서 승격)
  employmentType: string | null; // 근무형태: 정규직|아르바이트|프리랜서
  classesCount: number;
  primaryStudentsCount: number;
  /** 현재 계약(가장 큰 차수) — 직원명부 시트의 '현재 계약'·'계약조건'·'계약갱신일' 열에 대응. */
  contractStart: string | null;
  contractEnd: string | null;
  contractTerms: string | null;
  contractSeq: number | null;
  /** 계약서 파일 첨부 여부(academy_documents kind='file' + staff_user_id) — 목록 '계약서' 열. */
  contractFile: boolean;
  /** 직원 행 최근 수정 시각(users.updated_at) — 목록 '수정일' 열(원장 지시 2026-08-04). */
  updatedAt: string | null;
};

export async function getStaffList(): Promise<StaffRow[]> {
  const supabase = await createClient();
  // 계약 열은 **admin client**로 읽는다(2026-08-01) — staff_contracts RLS(0167a)는 auth_menu_access를
  // 보는데, 직원관리를 개인 예외로 좁히면서(userOverrides) DB 함수 갱신(0170a)이 원장 Supabase 접근
  // 불가로 보류됐다. 진짜 게이트는 앱(개인 예외 반영 canAccessTenant) — 통과 못 하면 빈 배열, 통과하면
  // RLS 우회 + tenant 명시 필터. ⚠️ admin 경로는 tenant_id 필터가 격리의 전부다(빼먹으면 크로스테넌트).
  const viewer = await getCurrentUser();
  const canSeeContracts = !!viewer && (await canAccessTenant(viewer.systemRole, "staff"));
  const admin = createAdminClient();

  // 세 쿼리는 서로 독립 → 병렬(3 round-trip → 1). users/classes/students 모두 단일 테넌트 ≤1000행이라
  // 절단 위험 없음(현재 users 39·classes 129·enrolled 524).
  const [{ data: users }, { data: teaching }, contracts, contractFileRows] = await Promise.all([
    // 🔴 퇴사자(inactive)도 가져온다 — 종전 `.neq("status","inactive")`가 목록에서 통째로 빼는 바람에
    // 상태 칩 '퇴사'를 눌러도 **항상 0명**이었다(원장 제보 2026-08-07, 필터가 아니라 데이터가 없던 것).
    // 기본 화면은 페이지 쪽 기본 상태 필터(재직)가 좁힌다 — 여기서 자르면 필터가 영원히 못 본다.
    supabase
      .from("users")
      .select(
        "id, display_name, email, phone, system_role, status, hire_date, job_title, subjects, department, employment_type, updated_at",
      )
      .neq("system_role", "student")
      .order("system_role", { ascending: true })
      .order("display_name", { ascending: true }),
    supabase.from("classes").select("id, teacher_id").eq("is_active", true),
    // 현재 계약(시트 '현재 계약'·'계약조건'·'계약갱신일' 열) — 기간 있는 계약만, 페이지네이션으로 전건(B2).
    !canSeeContracts
      ? Promise.resolve([] as { user_id: string; seq: number; start_date: string; end_date: string; terms: string | null }[])
      : fetchAllPaged<{ user_id: string; seq: number; start_date: string; end_date: string; terms: string | null }>(
          (from, to) =>
            admin
              .from("staff_contracts")
              .select("user_id, seq, start_date, end_date, terms")
              .eq("tenant_id", viewer.tenantId)
              .eq("kind", "contract")
              .order("user_id", { ascending: true })
              .order("seq", { ascending: true })
              .range(from, to),
        ).catch(() => []),
    // 계약서 파일 첨부 여부 — 직원 연결 파일 문서의 staff_user_id만 뽑는다(행 수 = 파일 수, 직원 41명
    // 규모라 절단 위험 없음). 게이트·클라이언트 규약은 위 계약 열과 동일.
    !canSeeContracts
      ? Promise.resolve([] as { staff_user_id: string }[])
      : admin
          .from("academy_documents")
          .select("staff_user_id")
          .eq("tenant_id", viewer.tenantId)
          .eq("kind", "file")
          .not("staff_user_id", "is", null)
          .then(({ data }) => (data ?? []) as { staff_user_id: string }[]),
  ]);

  if (!users) return [];
  const hasContractFile = new Set(contractFileRows.map((r) => r.staff_user_id));

  // 사람별 현재 계약 = 가장 큰 차수(위에서 seq 오름차순이라 마지막 것이 최신).
  const currentContractOf = new Map<string, (typeof contracts)[number]>();
  for (const c of contracts) currentContractOf.set(c.user_id, c);

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
    hireDate: (u.hire_date as string | null) ?? null,
    jobTitle: (u.job_title as string | null) ?? null,
    subjects: Array.isArray(u.subjects) ? (u.subjects as string[]) : [],
    department: (u.department as string | null) ?? null,
    employmentType: (u.employment_type as string | null) ?? null,
    classesCount: classCount.get(u.id) ?? 0,
    primaryStudentsCount: studentsByTeacher.get(u.id)?.size ?? 0,
    contractStart: currentContractOf.get(u.id)?.start_date ?? null,
    contractEnd: currentContractOf.get(u.id)?.end_date ?? null,
    contractTerms: currentContractOf.get(u.id)?.terms ?? null,
    contractSeq: currentContractOf.get(u.id)?.seq ?? null,
    contractFile: hasContractFile.has(u.id),
    updatedAt: ((u as { updated_at?: string | null }).updated_at ?? null),
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
  /**
   * 학생 출결 알림(클래스노트) 받기 — true면 **담당 반과 무관하게 전 학생**의 학부모 결석·지각·조퇴 연락이
   * 이 계정 벨에 온다(0184a). 차량(셔틀)·사무실이 담임에게 일일이 묻지 않게 하는 스위치.
   */
  attendanceAlertOptin: boolean;
  /** 랩실 출석부 담당 — 켜면 로그인 착지가 랩실 출석부이고 그 자리만 쓸 수 있다(0209a). */
  seatLabDuty: boolean;
  /** JJ실 출석부 담당. 1차에선 착지·쓰기가 아직 안 열린다(OPEN_SEAT_KEYS). */
  seatJjDuty: boolean;
  /** 오늘 출결 데스크 알림 — 강사가 미출결→출결로 바꾸면 벨(0212a). */
  deskAttendanceOptin: boolean;
  /** '강사뷰 접근'(0224a) — 다른 강사의 강사뷰 열람(열람 전용) 허용. 편집은 master(+super_admin)만. */
  teacherViewAccess: boolean;
  hourlyRate: number;
  monthlyBase: number;
  department: string | null; // 0147a — 이력서 프리필·상세 표시용
  employmentType: string | null;
};

/** '강사뷰 접근'(0224a) — 컬럼 미적용이면 에러 없이 false(#95: getStaffById 본 select에 싣지 말 것). */
async function getTeacherViewAccessFlag(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("teacher_view_access")
    .eq("id", id)
    .maybeSingle();
  return !error && data?.teacher_view_access === true;
}

export async function getStaffById(id: string): Promise<StaffDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select(
      "id, display_name, email, phone, system_role, status, hire_date, job_title, english_name, subjects, default_classroom, memo, bg_color, hourly_rate, monthly_base, department, employment_type, attendance_alert_optin",
    )
    .eq("id", id)
    .single();

  if (!data) return null;

  // 자리 담당·데스크 알림·강사뷰 접근 컬럼은 0209a/0212a/0224a 이후. 없으면 빈 값으로 — 직원 상세를 죽이지 않는다(#95).
  const [duties, deskOptin, teacherViewAccess] = await Promise.all([
    getSeatDuties(id),
    getDeskAttendanceOptin(id),
    getTeacherViewAccessFlag(id),
  ]);

  return {
    id: data.id,
    displayName: data.display_name,
    // 학생 출결 알림(클래스노트) 받기 — 켜면 담당 반과 무관하게 전 학생의 학부모 출결 연락을 받는다(0184a).
    attendanceAlertOptin: data.attendance_alert_optin === true,
    seatLabDuty: duties.lab,
    seatJjDuty: duties.jj,
    deskAttendanceOptin: deskOptin,
    teacherViewAccess,
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
    department: (data.department as string | null) ?? null,
    employmentType: (data.employment_type as string | null) ?? null,
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
  /** 과목 키(라벨·색은 학원설정 단일 소스로 변환 — 여기 라벨을 굽지 말 것) */
  subject: string;
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
      "id, class_name, subject, pending_teacher_date, pending_teacher:pending_teacher_id ( display_name )",
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
      subject: c.subject,
      pendingTeacherName: pt?.display_name ?? null,
      pendingTeacherDate:
        (c as { pending_teacher_date?: string | null }).pending_teacher_date ?? null,
    };
  });
}

/**
 * 담임은 아니지만 **교시로 들어가는** 진행중 반 — 퇴사 시 담임 목록만 보면 놓치는 두 번째 잔여.
 *
 * `class_schedules.teacher_id`는 셀 단위 오버라이드라 담임과 무관하게 사람을 가리킨다(실측 2026-08-03
 * injaewon: 재직 강사 9명이 남의 반에서 유효 교시 총 58개를 맡고 있고, 그중 2명은 **담임 반이 0개**라
 * 담임 기준 경고엔 아예 안 걸린다). 인계하지 않으면 시간표에 퇴직자가 그대로 남고, 그 반 시트를 열 수
 * 있는 사람도 퇴직자 쪽에 묶인다(ECS 부담임 스코프).
 *
 * ⚠️ 만료된 교시는 세지 않는다 — 지난 시간표는 "그때 누가 가르쳤나"의 기록이라 인계 대상이 아니다.
 */
export type AssistClassRow = { id: string; className: string; subject: string; slotCount: number };

export async function getActiveAssistSlotClasses(teacherId: string): Promise<AssistClassRow[]> {
  const supabase = await createClient();
  const actor = await getCurrentUser();
  if (!actor) return [];
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

  // 슬롯 수를 세므로 무페이징 select 금지(B2) — 페이지네이션으로 전건을 받는다.
  type Cls = { class_name: string; subject: string; teacher_id: string | null };
  type Row = { class_id: string; classes: Cls | Cls[] };
  const rows = await fetchAllPaged<Row>((from, to) =>
    supabase
      .from("class_schedules")
      .select("class_id, classes!inner(class_name, subject, teacher_id, is_active)")
      .eq("tenant_id", actor.tenantId)
      .eq("teacher_id", teacherId)
      .eq("classes.is_active", true)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order("class_id")
      .range(from, to),
  );

  const byClass = new Map<string, AssistClassRow>();
  for (const r of rows) {
    const c = (Array.isArray(r.classes) ? r.classes[0] : r.classes) as Cls | undefined;
    if (!c || c.teacher_id === teacherId) continue; // 담임인 반은 위 목록이 담당
    const hit = byClass.get(r.class_id);
    if (hit) hit.slotCount += 1;
    else
      byClass.set(r.class_id, {
        id: r.class_id,
        className: c.class_name,
        subject: c.subject,
        slotCount: 1,
      });
  }
  return [...byClass.values()].sort((a, b) => a.className.localeCompare(b.className, "ko"));
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
