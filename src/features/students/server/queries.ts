import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { attendanceRate } from "@/lib/calc/attendance";
import {
  slotPeriodRow,
  settingsToPeriodsConfig,
  enumDayToKo,
  type DayOfWeek,
  type PeriodsConfig,
} from "@/features/timetable/lib/periods";
import { goalAchieved } from "../grades-meta";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { isShareExpired } from "@/features/onescreen/share-expiry";

/** 임포트된 상담/메모 텍스트("[제목]\n본문\n[등록자: 이름]")를 제목·본문·등록자로 분리. */
function parseImportedNote(raw: string | null | undefined): {
  title: string | null;
  body: string | null;
  registrant: string | null;
} {
  if (!raw) return { title: null, body: null, registrant: null };
  let text = raw.trim();
  let registrant: string | null = null;
  const reg = text.match(/\[등록자:\s*([^\]]+)\]\s*$/);
  if (reg) {
    registrant = reg[1].trim();
    text = text.slice(0, reg.index).trim();
  }
  let title: string | null = null;
  const t = text.match(/^\[([^\]]+)\]/);
  if (t) {
    title = t[1].trim();
    text = text.slice(t[0].length).trim();
  }
  return { title, body: text || null, registrant };
}

// enrollments → class(subject·담당 강사) 조인 행 형태(PostgREST는 to-one도 배열로 줄 수 있어 유니온).
type EnrollClass = {
  subject?: string;
  teacher_id?: string | null;
  teacher?: { display_name?: string } | { display_name?: string }[] | null;
};

export type StudentListRow = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  status: string;
  teacherNames: string[]; // 과목별 담당 강사(반의 teacher_id) distinct — 과목제라 학생당 단일 담임 없음
  enrolledAt: string | null;
  parentPhone: string | null;
  subjects: string[]; // 수강 중인 과목 unique list
  syncNew: boolean; // 지난 동기화가 새로 추가한 학생(sync_added_at != null) → "↻ 동기화" 배지 (다음 동기화 성공 시 해제)
  dupSuspect: boolean; // 동기화 자동 접미사(동명이인 판정) → "확인 필요" 배지 (사람이 정상 확인/병합할 때까지 유지)
};

export type StudentSort = "grade" | "name" | "recent";
export type SearchField = "all" | "name" | "school" | "phone" | "address" | "email" | "memo";

export type StudentListFilters = {
  status?: string; // "all" | "enrolled" | "consulted" | "on_hold" | "withdrawn"
  subject?: string; // "all" | "math" | "english" | ...
  q?: string; // 검색어
  grade?: string; // "all" | "초4" | "중2" | ... (고급)
  teacherId?: string; // "all" | uuid (담임, 고급)
  excludeNoEnrollment?: boolean; // 활성 수강 없는 학생 제외 (고급)
  sort?: StudentSort; // 정렬 (고급) — 기본 grade
  searchField?: SearchField; // 검색 범위 필드 (고급) — 기본 all
};

// 검색 필드 → 컬럼 매핑. all은 데스크 응대 빈도 높은 이름·학교·전화·보호자명 묶음.
const SEARCH_FIELD_COLS: Record<SearchField, string[]> = {
  all: ["name", "school", "student_phone", "parent_phone", "parent_name"],
  name: ["name"],
  school: ["school"],
  phone: ["student_phone", "parent_phone"],
  address: ["address"],
  email: ["email"],
  memo: ["notes"],
};

// 검색어를 선택된 필드(들)에 ilike OR로 적용. 쉼표·괄호는 PostgREST or() 구문 충돌이라 공백 치환.
function applySearch<T extends { or: (f: string) => T }>(qb: T, q: string | undefined, field?: SearchField): T {
  const term = (q ?? "").trim().replace(/[,()]/g, " ");
  if (!term) return qb;
  const cols = SEARCH_FIELD_COLS[field ?? "all"] ?? SEARCH_FIELD_COLS.all;
  return qb.or(cols.map((c) => `${c}.ilike.%${term}%`).join(","));
}

// 수강 중인(end_date null, 휴원 포함) 반이 없는 학생 id — '미수강 제외'는 이 소수 집합을 .not in으로 뺀다
// (학원 특성상 미수강은 소수 → URL 짧음, #53 414 회피. 전건 조회는 fetchAllPaged라 .in() 없이 안전).
// 휴원(on_hold)은 반에 적은 상태라 '수강 중'으로 본다(미수강=반 자체가 없는 학생).
async function getUnenrolledStudentIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string[]> {
  const [enr, stu] = await Promise.all([
    fetchAllPaged<{ student_id: string }>((from, to) =>
      supabase.from("enrollments").select("student_id").is("end_date", null).range(from, to),
    ),
    fetchAllPaged<{ id: string }>((from, to) =>
      supabase.from("students").select("id").range(from, to),
    ),
  ]);
  const enrolled = new Set(enr.map((e) => e.student_id));
  return stu.filter((s) => !enrolled.has(s.id)).map((s) => s.id);
}

export async function getStudentsList(
  options?: StudentListFilters,
): Promise<StudentListRow[]> {
  const supabase = await createClient();
  // 학생 전건을 .range()로 페이지네이션 — export·반 상세가 전 학생을 받으므로 1000행 절단 방지.
  const data = await fetchAllPaged((from, to) => {
    let qb = supabase
      .from("students")
      .select(
        `id, name, school, grade, status, enrolled_at, parent_phone, sync_added_at, dup_suspect`,
      );
    if (options?.status && options.status !== "all") qb = qb.eq("status", options.status);
    if (options?.grade && options.grade !== "all") qb = qb.eq("grade", options.grade);
    // 강사 필터는 아래 in-memory(과목별 담당 강사 기준) — primary_teacher_id 제거로 쿼리단 필터 없음.
    qb = applySearch(qb, options?.q, options?.searchField);
    const sorted =
      options?.sort === "name"
        ? qb.order("name", { ascending: true })
        : options?.sort === "recent"
          ? qb.order("enrolled_at", { ascending: false, nullsFirst: false })
          : qb.order("grade", { ascending: true }).order("name", { ascending: true });
    return sorted.range(from, to);
  });
  if (data.length === 0) return [];

  // 학생별 수강 과목 unique + 과목별 담당 강사(반의 teacher_id). id를 청크로 .in()(414 + error삼킴 방지).
  const studentIds = data.map((r) => r.id);
  const subjectsByStudent = new Map<string, Set<string>>();
  const teachersByStudent = new Map<string, Map<string, string>>(); // student → teacher_id → 이름
  const enrolledSet = new Set<string>(); // 수강 중(end_date null, 휴원 포함) 반이 있는 학생
  {
    const ens = await fetchInChunks<{
      student_id: string;
      on_hold: boolean;
      end_date: string | null;
      class: EnrollClass | EnrollClass[] | null;
    }>(studentIds, (chunk) =>
      supabase
        .from("enrollments")
        .select(
          "student_id, on_hold, end_date, class:class_id ( subject, teacher_id, teacher:teacher_id ( display_name ) )",
        )
        .in("student_id", chunk)
        .is("end_date", null),
    );

    for (const e of ens) {
      enrolledSet.add(e.student_id); // 휴원 포함 — 반에 적힌 학생
      if (e.on_hold) continue;
      const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as EnrollClass | undefined;
      if (klass?.subject) {
        const set = subjectsByStudent.get(e.student_id) ?? new Set<string>();
        set.add(klass.subject);
        subjectsByStudent.set(e.student_id, set);
      }
      if (klass?.teacher_id) {
        const t = (Array.isArray(klass.teacher) ? klass.teacher[0] : klass.teacher) as
          | { display_name?: string }
          | undefined;
        const tm = teachersByStudent.get(e.student_id) ?? new Map<string, string>();
        tm.set(klass.teacher_id, t?.display_name ?? "");
        teachersByStudent.set(e.student_id, tm);
      }
    }
  }

  let rows = data.map(
    (r) =>
      ({
        id: r.id,
        name: r.name,
        school: r.school,
        grade: r.grade,
        status: r.status,
        teacherNames: [
          ...new Set(Array.from(teachersByStudent.get(r.id)?.values() ?? []).filter(Boolean)),
        ].sort(),
        enrolledAt: r.enrolled_at,
        parentPhone: r.parent_phone,
        subjects: Array.from(subjectsByStudent.get(r.id) ?? []).sort(),
        syncNew: r.sync_added_at != null,
        dupSuspect: r.dup_suspect === true,
      }) satisfies StudentListRow,
  );

  // 과목 필터 (in-memory — subjects가 enrollments에서 옴)
  if (options?.subject && options.subject !== "all") {
    rows = rows.filter((r) => r.subjects.includes(options.subject!));
  }
  // 담당 강사 필터 (in-memory — 그 강사 반에 수강 중인 학생만)
  if (options?.teacherId && options.teacherId !== "all") {
    rows = rows.filter((r) => teachersByStudent.get(r.id)?.has(options.teacherId!));
  }
  // 미수강 제외 (in-memory — 전건을 이미 받았으므로)
  if (options?.excludeNoEnrollment) {
    rows = rows.filter((r) => enrolledSet.has(r.id));
  }

  return rows;
}

/**
 * Stat 표시용 카운트 — 재원생 수 + 재원생의 과목별 distinct 학생 수(운영 관점: 전체/퇴원 아님).
 * 재원 수는 `count(exact, head)`(행 안 받음). 과목별은 distinct 학생이라 PostgREST count로 불가 →
 * 재원생의 활성 수강(휴원 제외)만 `fetchAllPaged` 전건 수집 후 JS distinct(B2 "전건 필요" 경로).
 * 과목별 수 = status=enrolled ∧ 그 과목 반 활성 수강(end_date null, on_hold false) — 재원+과목 필터 결과와 일치.
 */
export async function getEnrolledStatCounts(): Promise<{
  enrolled: number;
  bySubject: Record<string, number>;
}> {
  const supabase = await createClient();
  // 강사 스코프: Stat 카드도 본인 담당 학생 기준(페이지 목록과 일치). teacher 또는 겸직-강사뷰.
  const teacherStudentIds = (await effectiveTeacherScope())?.studentIds ?? null;
  if (teacherStudentIds && teacherStudentIds.length === 0)
    return { enrolled: 0, bySubject: {} };
  const scope = teacherStudentIds ? new Set(teacherStudentIds) : null;

  const enrolledCountQ = () => {
    const q = supabase
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("status", "enrolled");
    return teacherStudentIds ? q.in("id", teacherStudentIds) : q;
  };
  const [{ count }, ens] = await Promise.all([
    enrolledCountQ(),
    fetchAllPaged<{
      student_id: string;
      class: { subject?: string } | { subject?: string }[] | null;
    }>((from, to) =>
      supabase
        .from("enrollments")
        .select("student_id, class:class_id!inner ( subject ), student:student_id!inner ( status )")
        .is("end_date", null)
        .eq("on_hold", false)
        .eq("student.status", "enrolled")
        .range(from, to),
    ),
  ]);

  // 과목별 distinct 학생 — 강사 스코프는 JS로 교차(.in() 414 회피).
  const bySubject = new Map<string, Set<string>>();
  for (const e of ens) {
    if (scope && !scope.has(e.student_id)) continue;
    const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as
      | { subject?: string }
      | undefined;
    if (!klass?.subject) continue;
    const set = bySubject.get(klass.subject) ?? new Set<string>();
    set.add(e.student_id);
    bySubject.set(klass.subject, set);
  }
  return {
    enrolled: count ?? 0,
    bySubject: Object.fromEntries([...bySubject].map(([k, v]) => [k, v.size])),
  };
}

/**
 * 학생목록 페이지용 서버 페이지네이션. 전체 564명을 통째로 가져와 렌더하던 병목 해소
 * (페이지 50행 + 그 페이지 학생의 enrollments만 조회). 과목 필터는 해당 과목 active 수강 학생
 * id를 먼저 풀어 `.in()`으로 좁힌다(in-memory 전체 필터 회피).
 */
export async function getStudentsPage(
  options: StudentListFilters,
  page = 1,
  pageSize = 50,
): Promise<{ rows: StudentListRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // 강사 스코프: teacher(또는 겸직-강사뷰)면 본인 담당 반 학생만(intra-tenant 누수 차단 + 사용성). fail-safe(쿼리가 자체 스코프).
  const teacherStudentIds = (await effectiveTeacherScope())?.studentIds ?? null;
  if (teacherStudentIds && teacherStudentIds.length === 0) return { rows: [], total: 0 };

  let subjectIds: string[] | null = null;
  if (options?.subject && options.subject !== "all") {
    const { data: ens } = await supabase
      .from("enrollments")
      .select("student_id, class:class_id!inner ( subject )")
      .eq("class.subject", options.subject)
      .is("end_date", null)
      .eq("on_hold", false);
    subjectIds = [...new Set((ens ?? []).map((e) => e.student_id))];
    if (subjectIds.length === 0) return { rows: [], total: 0 };
  }

  // 미수강 제외: 활성 수강 없는(소수) 학생 id를 미리 풀어 .not in으로 뺀다(.in() 414 회피).
  let unenrolledIds: string[] | null = null;
  if (options?.excludeNoEnrollment) {
    unenrolledIds = await getUnenrolledStudentIds(supabase);
  }

  // 담당 강사 필터 → 그 강사 반에 수강 중인 학생 id(getTeacherScope 재사용, primary_teacher_id 대체).
  let teacherFilterIds: string[] | null = null;
  if (options?.teacherId && options.teacherId !== "all") {
    teacherFilterIds = (await getTeacherScope(options.teacherId)).studentIds;
    if (teacherFilterIds.length === 0) return { rows: [], total: 0 };
  }

  let qb = supabase
    .from("students")
    .select(
      `id, name, school, grade, status, enrolled_at, parent_phone, sync_added_at, dup_suspect`,
      { count: "exact" },
    );
  if (options?.status && options.status !== "all") qb = qb.eq("status", options.status);
  if (options?.grade && options.grade !== "all") qb = qb.eq("grade", options.grade);
  qb = applySearch(qb, options?.q, options?.searchField);
  // 과목(subjectIds) ∩ 강사 스코프(teacherStudentIds) ∩ 담당 강사 필터(teacherFilterIds) → 단일 id 화이트리스트.
  let idWhitelist: string[] | null = subjectIds;
  for (const list of [teacherStudentIds, teacherFilterIds]) {
    if (!list) continue;
    const s = new Set(list);
    idWhitelist = idWhitelist ? idWhitelist.filter((id) => s.has(id)) : list;
    if (idWhitelist.length === 0) return { rows: [], total: 0 };
  }
  if (idWhitelist) qb = qb.in("id", idWhitelist);
  if (unenrolledIds && unenrolledIds.length > 0)
    qb = qb.not("id", "in", `(${unenrolledIds.join(",")})`);

  // 정렬 — 필터 적용(.eq/.or/.in/.not) 다음에 .order(이후엔 transform 빌더). 기본 grade.
  const sorted =
    options?.sort === "name"
      ? qb.order("name", { ascending: true })
      : options?.sort === "recent"
        ? qb.order("enrolled_at", { ascending: false, nullsFirst: false })
        : qb.order("grade", { ascending: true }).order("name", { ascending: true });

  const { data, count } = await sorted.range(from, to);
  const pageData = data ?? [];

  const ids = pageData.map((r) => r.id);
  const subjectsByStudent = new Map<string, Set<string>>();
  const teachersByStudent = new Map<string, Set<string>>(); // student → 담당 강사명 distinct
  if (ids.length > 0) {
    const { data: ens } = await supabase
      .from("enrollments")
      .select(
        "student_id, on_hold, end_date, class:class_id ( subject, teacher_id, teacher:teacher_id ( display_name ) )",
      )
      .in("student_id", ids)
      .is("end_date", null);
    for (const e of (ens ?? []) as { student_id: string; on_hold: boolean; class: EnrollClass | EnrollClass[] | null }[]) {
      if (e.on_hold) continue;
      const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as EnrollClass | undefined;
      if (klass?.subject) {
        const set = subjectsByStudent.get(e.student_id) ?? new Set<string>();
        set.add(klass.subject);
        subjectsByStudent.set(e.student_id, set);
      }
      if (klass?.teacher_id) {
        const t = (Array.isArray(klass.teacher) ? klass.teacher[0] : klass.teacher) as
          | { display_name?: string }
          | undefined;
        if (t?.display_name) {
          const set = teachersByStudent.get(e.student_id) ?? new Set<string>();
          set.add(t.display_name);
          teachersByStudent.set(e.student_id, set);
        }
      }
    }
  }

  const rows = pageData.map((r) => {
    return {
      id: r.id,
      name: r.name,
      school: r.school,
      grade: r.grade,
      status: r.status,
      teacherNames: Array.from(teachersByStudent.get(r.id) ?? []).sort(),
      enrolledAt: r.enrolled_at,
      parentPhone: r.parent_phone,
      subjects: Array.from(subjectsByStudent.get(r.id) ?? []).sort(),
      syncNew: r.sync_added_at != null,
      dupSuspect: r.dup_suspect === true,
    } satisfies StudentListRow;
  });

  return { rows, total: count ?? rows.length };
}

export type CareFocus = {
  priority: "high" | "medium" | "low";
  area: string;
  recommendation: string;
};

export type StudentDetail = {
  id: string;
  name: string;
  englishName: string | null;
  classnoteName: string | null;
  studentCode: string | null;
  attendanceCode: string | null;
  school: string | null;
  grade: string | null;
  status: string;
  gender: string | null;
  birthDate: string | null;
  nickname: string | null;
  graduationYear: string | null;
  address: string | null;
  zipCode: string | null;
  addressDetail: string | null;
  email: string | null;
  studentPhone: string | null;
  homePhone: string | null;
  otherPhone: string | null;
  parentName: string | null;
  parentPhone: string | null;
  parentRelation: string | null;
  enrolledAt: string | null;
  withdrawnAt: string | null;
  notes: string | null;
  createdAt: string;
  dupSuspect: boolean; // 동기화 자동 접미사(동명이인 판정) → "확인 필요" 배지
  aiCareSummary: string | null;
  aiCareFocus: CareFocus[] | null;
  aiCareModelVersion: string | null;
  aiCareGeneratedAt: string | null;
};

export type TeacherOption = {
  id: string;
  displayName: string;
  systemRole: string;
};

export async function getTeacherOptions(): Promise<TeacherOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, display_name, system_role")
    .in("system_role", ["teacher", "counselor", "manager", "admin", "master"])
    .eq("status", "active")
    .order("display_name", { ascending: true });
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    systemRole: r.system_role,
  }));
}

export async function getStudentById(id: string): Promise<StudentDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select(
      `id, name, english_name, classnote_name, school, grade, status, student_code, attendance_code,
       gender, birth_date, nickname, graduation_year,
       address, zip_code, address_detail, email, student_phone, home_phone, other_phone,
       enrolled_at, withdrawn_at, created_at, notes, dup_suspect,
       parent_name, parent_phone, parent_relation,
       ai_care_summary, ai_care_focus, ai_care_model_version, ai_care_generated_at`,
    )
    .eq("id", id)
    .single();

  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    englishName: data.english_name,
    classnoteName: data.classnote_name,
    studentCode: data.student_code,
    attendanceCode: data.attendance_code,
    school: data.school,
    grade: data.grade,
    status: data.status,
    gender: data.gender,
    birthDate: data.birth_date,
    nickname: data.nickname,
    graduationYear: data.graduation_year,
    address: data.address,
    zipCode: data.zip_code,
    addressDetail: data.address_detail,
    email: data.email,
    studentPhone: data.student_phone,
    homePhone: data.home_phone,
    otherPhone: data.other_phone,
    enrolledAt: data.enrolled_at,
    withdrawnAt: data.withdrawn_at,
    notes: data.notes,
    parentName: data.parent_name,
    parentPhone: data.parent_phone,
    parentRelation: data.parent_relation,
    createdAt: data.created_at,
    dupSuspect: data.dup_suspect === true,
    aiCareSummary: data.ai_care_summary,
    aiCareFocus: Array.isArray(data.ai_care_focus)
      ? (data.ai_care_focus as CareFocus[])
      : null,
    aiCareModelVersion: data.ai_care_model_version,
    aiCareGeneratedAt: data.ai_care_generated_at,
  };
}

export type StudentEnrollment = {
  id: string;
  classId: string;
  className: string;
  subject: string;
  teacherName: string | null; // 이 반(과목)의 담당 강사 — 과목별 담당(단일 담임 대체)
  startDate: string;
  endDate: string | null;
  onHold: boolean;
};

export async function getStudentEnrollments(studentId: string): Promise<StudentEnrollment[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollments")
    .select(
      `id, start_date, end_date, on_hold,
       class:class_id ( id, class_name, subject, teacher:teacher_id ( display_name ) )`,
    )
    .eq("student_id", studentId)
    .order("start_date", { ascending: false });

  if (!data) return [];

  return data.map((r) => {
    const klass = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | { id?: string; class_name?: string; subject?: string; teacher?: { display_name?: string } | { display_name?: string }[] | null }
      | undefined;
    const teacher = (Array.isArray(klass?.teacher) ? klass?.teacher[0] : klass?.teacher) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      classId: klass?.id ?? "",
      className: klass?.class_name ?? "?",
      subject: klass?.subject ?? "?",
      teacherName: teacher?.display_name ?? null,
      startDate: r.start_date,
      endDate: r.end_date,
      onHold: r.on_hold,
    };
  });
}

// ───────── 수업 탭(ijw CoursesTab 이식) — 스케줄(요일+교시)·강사·인원 포함 ─────────
const KO_DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"];

export type ScheduleGroup = { days: string[]; label: string }; // {days:["월","목"], label:"1~3교시"}
// 개별 슬롯(요일 하나 × 시작시각 하나) — 주간 시간표 그리드 배치용(교시 체계가 과목마다 달라 시각 기준 병합).
export type ClassSlot = { day: DayOfWeek; startTime: string; periodLabel: string; room: string | null };
export type StudentClassRow = {
  enrollmentId: string;
  classId: string;
  className: string;
  subject: string;
  teacherName: string | null;
  startDate: string;
  endDate: string | null;
  onHold: boolean;
  studentCount: number; // 반 현재 인원(활성 enrollment)
  schedule: ScheduleGroup[];
  // 등원요일로 필터링된 개별 슬롯(groupSchedule과 동일 필터) — 학생 주간 시간표 그리드 소스.
  slots: ClassSlot[];
  // 분리등원 편집(EditableAttendanceCell)용: 실제 등원 요일(raw, []=전체) + 반 운영 요일(선택지).
  attendanceDays: string[];
  classDays: string[];
};

// 연속 교시 번호를 범위로 병합: [3,4,5,6]→"3-6교시", [2,3,5]→"2-3, 5교시", [2]→"2교시".
function mergePeriodRanges(nums: number[]): string {
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  const out: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (n !== undefined) {
      start = n;
      prev = n;
    }
  }
  return `${out.join(", ")}교시`;
}

// 요일별로 교시 묶기(같은 요일 연속 교시는 N-M으로 병합) → 같은 라벨 요일끼리 합침("월목 1-3교시 / 화금 1-4교시").
// attendanceDays 있으면 그 요일만(분리등원). 교시 매칭 실패 시각은 원라벨 그대로(병합 대상 아님).
function groupSchedule(
  slots: { day: DayOfWeek; startTime: string }[],
  subj: string,
  attendanceDaysKo: string[],
  config: PeriodsConfig,
): ScheduleGroup[] {
  // 1) 요일 → 교시번호[] + 매칭 안 된 원라벨[]
  const byDay = new Map<string, { nums: number[]; other: string[] }>();
  for (const s of slots) {
    const dayKo = enumDayToKo(s.day);
    if (attendanceDaysKo.length > 0 && !attendanceDaysKo.includes(dayKo)) continue;
    // 테넌트 설정 교시(과목별 override 포함)로 라벨 해석 — 무config 호출은 커스텀 교시 저장 시 라벨이 틀어진다(2026-07-06).
    const label = slotPeriodRow(subj, s.startTime, s.day, config).label;
    const entry = byDay.get(dayKo) ?? { nums: [], other: [] };
    const m = label.match(/^(\d+)교시$/);
    if (m) entry.nums.push(Number(m[1]));
    else entry.other.push(label);
    byDay.set(dayKo, entry);
  }
  // 2) 요일별 교시 라벨(연속 병합)
  const dayLabel = new Map<string, string>();
  for (const [day, { nums, other }] of byDay) {
    const parts = [mergePeriodRanges(nums), ...[...new Set(other)]].filter(Boolean);
    dayLabel.set(day, parts.join(", "));
  }
  // 3) 같은 라벨 요일끼리 묶기
  const byLabel = new Map<string, Set<string>>();
  for (const [day, label] of dayLabel) {
    const set = byLabel.get(label) ?? new Set<string>();
    set.add(day);
    byLabel.set(label, set);
  }
  const groups = [...byLabel.entries()].map(([label, days]) => ({
    label,
    days: [...days].sort((a, b) => KO_DAY_ORDER.indexOf(a) - KO_DAY_ORDER.indexOf(b)),
  }));
  groups.sort((a, b) => KO_DAY_ORDER.indexOf(a.days[0] ?? "") - KO_DAY_ORDER.indexOf(b.days[0] ?? ""));
  return groups;
}

export async function getStudentClassesDetail(studentId: string): Promise<StudentClassRow[]> {
  const supabase = await createClient();
  const { data: ens } = await supabase
    .from("enrollments")
    .select(
      `id, class_id, start_date, end_date, on_hold, attendance_days,
       class:class_id ( class_name, subject, teacher:teacher_id ( display_name ), classroom:classroom_id ( name ) )`,
    )
    .eq("student_id", studentId)
    .order("start_date", { ascending: false });
  if (!ens || ens.length === 0) return [];

  const classIds = [...new Set(ens.map((e) => e.class_id))];

  // 반별 스케줄(요일·시작시각)
  const { data: scheds } = await supabase
    .from("class_schedules")
    .select("class_id, day_of_week, start_time, slot_room_label")
    .in("class_id", classIds);
  const schedByClass = new Map<string, { day: DayOfWeek; startTime: string; roomLabel: string | null }[]>();
  for (const s of scheds ?? []) {
    const arr = schedByClass.get(s.class_id) ?? [];
    arr.push({
      day: s.day_of_week as DayOfWeek,
      startTime: String(s.start_time).slice(0, 5),
      roomLabel: (s.slot_room_label as string | null) ?? null,
    });
    schedByClass.set(s.class_id, arr);
  }

  // 반별 현재 인원(활성)
  const countByClass = new Map<string, number>();
  await Promise.all(
    classIds.map(async (cid) => {
      const { count } = await supabase
        .from("enrollments")
        .select("*", { count: "exact", head: true })
        .eq("class_id", cid)
        .is("end_date", null);
      countByClass.set(cid, count ?? 0);
    }),
  );

  // 교시 라벨은 테넌트 설정(과목별 override 포함) 기준 — getTenantSettings는 React cache라 추가 쿼리 0.
  const periodsConfig = settingsToPeriodsConfig((await getTenantSettings()).operations);

  return ens.map((e) => {
    const klass = (Array.isArray(e.class) ? e.class[0] : e.class) as
      | {
          class_name?: string;
          subject?: string;
          teacher?: { display_name?: string } | { display_name?: string }[];
          classroom?: { name?: string } | { name?: string }[];
        }
      | undefined;
    const teacher = klass
      ? ((Array.isArray(klass.teacher) ? klass.teacher[0] : klass.teacher) as { display_name?: string } | undefined)
      : undefined;
    // 반 기본 강의실(classes.classroom_id) — 슬롯 라벨(slot_room_label)이 없을 때 상속.
    const defaultRoom =
      ((Array.isArray(klass?.classroom) ? klass?.classroom[0] : klass?.classroom) as { name?: string } | undefined)
        ?.name ?? null;
    // 과목 키를 그대로 전달(string) — 커스텀 키(subject_1 등)도 과목별 교시표로 해석되고,
    // 미지의 키는 weekdayTableFor가 전역 평일표로 폴백(옛 'math 강제 coerce'와 동일 결과).
    const subject = klass?.subject ?? "other";
    const attDays = (Array.isArray(e.attendance_days) ? e.attendance_days : []) as string[];
    const attKo = attDays.map((d) => enumDayToKo(d as DayOfWeek));
    const rawSlots = schedByClass.get(e.class_id) ?? [];
    // 반 운영 요일(분리등원 선택지) = 이 반 스케줄의 distinct 요일(요일순).
    const classDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].filter((d) => rawSlots.some((s) => s.day === d));
    // 등원요일 필터(분리등원) = groupSchedule과 동일 규칙. 각 슬롯에 과목별 교시 라벨 부착(그리드 셀 힌트).
    const slots: ClassSlot[] = rawSlots
      .filter((s) => attKo.length === 0 || attKo.includes(enumDayToKo(s.day)))
      .map((s) => ({
        day: s.day,
        startTime: s.startTime,
        periodLabel: slotPeriodRow(subject, s.startTime, s.day, periodsConfig).label,
        // 슬롯별 강의실 라벨 우선, 없으면 반 기본 강의실 상속(메인 시간표와 동일 규칙).
        room: s.roomLabel ?? defaultRoom,
      }));
    return {
      enrollmentId: e.id,
      classId: e.class_id,
      className: klass?.class_name ?? "?",
      subject,
      teacherName: teacher?.display_name ?? null,
      startDate: e.start_date,
      endDate: e.end_date,
      onHold: e.on_hold,
      studentCount: countByClass.get(e.class_id) ?? 0,
      schedule: groupSchedule(
        schedByClass.get(e.class_id) ?? [],
        subject,
        attKo,
        periodsConfig,
      ),
      slots,
      attendanceDays: attDays,
      classDays,
    } satisfies StudentClassRow;
  });
}

export type AttendanceWindowStats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
};

export async function getStudentAttendanceStats(
  studentId: string,
  days = 30,
): Promise<AttendanceWindowStats> {
  const supabase = await createClient();
  const start = new Date();
  start.setDate(start.getDate() - days);

  const { data } = await supabase
    .from("attendance_records")
    .select("status")
    .eq("student_id", studentId)
    .gte("session_date", start.toISOString().slice(0, 10));

  const rows = data ?? [];
  const total = rows.length;
  const present = rows.filter((r) => r.status === "present").length;
  return {
    total,
    present,
    absent: rows.filter((r) => r.status === "absent").length,
    late: rows.filter((r) => r.status === "late").length,
    excused: rows.filter((r) => r.status === "excused").length,
    rate: attendanceRate(present, total),
  };
}

// ────────────────────── 7탭 데이터 ──────────────────────

export type StudentBillingLineItem = { description: string; amount: number };
export type StudentBillingRow = {
  id: string;
  period: string;
  category: string; // tuition/material/exam/other
  amountTotal: number;
  amountPaid: number;
  amountDiscount: number;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  notes: string | null;
  // makeedu는 (학생×월×항목) 라인 단위지만 eywa는 (학생×월) 1행으로 집계 → 항목 내역은 line_items에 보존.
  // 화면에서 "수업료" 대신 실제 항목명(강의명 등)을 펼쳐 보여주기 위해 함께 반환.
  lineItems: StudentBillingLineItem[];
};

export async function getStudentInvoices(studentId: string): Promise<StudentBillingRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select(
      "id, period, category, amount_total, amount_paid, amount_discount, status, due_date, paid_at, notes, line_items",
    )
    .eq("student_id", studentId)
    .order("period", { ascending: false });
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    period: r.period,
    category: r.category,
    amountTotal: Number(r.amount_total),
    amountPaid: Number(r.amount_paid),
    amountDiscount: Number(r.amount_discount),
    status: r.status,
    dueDate: r.due_date,
    paidAt: r.paid_at,
    notes: r.notes,
    lineItems: Array.isArray(r.line_items)
      ? (r.line_items as { description?: string; name?: string; amount?: number }[]).map((li) => ({
          description: String(li.description ?? li.name ?? "").trim(),
          amount: Number(li.amount ?? 0),
        }))
      : [],
  }));
}

export type StudentGradeRow = {
  id: string;
  examName: string;
  subject: string;
  score: number | null;
  maxScore: number | null;
  takenOn: string;
  notes: string | null;
};

export async function getStudentGrades(studentId: string): Promise<StudentGradeRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_grades")
    .select("id, exam_name, subject, score, max_score, taken_on, notes")
    .eq("student_id", studentId)
    .order("taken_on", { ascending: false });
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    examName: r.exam_name,
    subject: r.subject,
    score: r.score == null ? null : Number(r.score),
    maxScore: r.max_score == null ? null : Number(r.max_score),
    takenOn: r.taken_on,
    notes: r.notes,
  }));
}

// === 수업 진도/보고서(lesson_reports) — 학생 상세 '진도' 탭(ijw StudentDetail ProgressTab 이식) ===
export type LessonReportRow = {
  id: string;
  reportDate: string;
  progress: string | null;
  examInfo: string | null;
  homeworkScore: string | null;
  teacherName: string | null;
  classnoteStatus: string | null; // ClassNote 발송 상태(queued/processing/success/failed/too_old, null=미발송)
  linkStatus: "active" | "revoked" | "expired"; // 학부모 공유 링크 상태(P2a)
  viewCount: number; // 학부모 열람 수(share_link_views)
};

/** 학생 최근 수업보고서 N건(최신순) + 발송상태·링크상태·열람수(P2a/P3). 데이터는 Edutrix 이식(import-lesson-reports.cjs). */
export async function getStudentLessonReports(studentId: string, limit = 12): Promise<LessonReportRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lesson_reports")
    .select("id, report_date, progress, exam_info, homework_score, teacher_name, classnote_status, revoked_at")
    .eq("student_id", studentId)
    .order("report_date", { ascending: false })
    .limit(limit);
  if (!data) return [];

  // 학부모 열람 수(share_link_views) — 이 보고서 id들로 조회 후 JS 집계(roster와 동일 패턴, RLS 테넌트 격리).
  const ids = data.map((r) => r.id);
  const viewRows = await fetchInChunks<{ lesson_report_id: string }>(ids, (chunk) =>
    supabase.from("share_link_views").select("lesson_report_id").in("lesson_report_id", chunk),
  );
  const viewCountById = new Map<string, number>();
  for (const v of viewRows)
    viewCountById.set(v.lesson_report_id, (viewCountById.get(v.lesson_report_id) ?? 0) + 1);

  return data.map((r) => ({
    id: r.id,
    reportDate: r.report_date,
    progress: r.progress,
    examInfo: r.exam_info,
    homeworkScore: r.homework_score,
    teacherName: r.teacher_name,
    classnoteStatus: r.classnote_status,
    linkStatus: r.revoked_at ? "revoked" : isShareExpired(r.report_date) ? "expired" : "active",
    viewCount: viewCountById.get(r.id) ?? 0,
  }));
}

// === 성적 목표설정(grade_goals) — 실제 점수와 매칭해 달성 여부 산출 ===
export type GradeGoalRow = {
  id: string;
  examId: string | null;
  examName: string;
  subject: string;
  targetScore: number;
  maxScore: number | null;
  reason: string | null;
  createdAt: string;
  // 읽기 시점 산출(denormalize 안 함)
  actualScore: number | null;
  actualMaxScore: number | null;
  achieved: boolean | null;
};

export async function getStudentGradeGoals(studentId: string): Promise<GradeGoalRow[]> {
  const supabase = await createClient();
  const [{ data: goalsData }, { data: gradesData }] = await Promise.all([
    supabase
      .from("grade_goals")
      .select("id, exam_id, exam_name, subject, target_score, max_score, reason, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false }),
    supabase
      .from("student_grades")
      .select("exam_id, exam_name, subject, score, max_score")
      .eq("student_id", studentId),
  ]);

  // 실제 점수 매칭: exam_id 우선, 없으면 시험명+과목.
  const byExamId = new Map<string, { score: number | null; max: number | null }>();
  const byNameSubject = new Map<string, { score: number | null; max: number | null }>();
  for (const g of gradesData ?? []) {
    const score = g.score == null ? null : Number(g.score);
    const max = g.max_score == null ? null : Number(g.max_score);
    if (g.exam_id) byExamId.set(g.exam_id, { score, max });
    byNameSubject.set(`${g.exam_name}__${g.subject}`, { score, max });
  }

  return (goalsData ?? []).map((r) => {
    const target = Number(r.target_score);
    const matched =
      (r.exam_id ? byExamId.get(r.exam_id) : undefined) ??
      byNameSubject.get(`${r.exam_name}__${r.subject}`);
    const actualScore = matched?.score ?? null;
    return {
      id: r.id,
      examId: r.exam_id,
      examName: r.exam_name,
      subject: r.subject,
      targetScore: target,
      maxScore: r.max_score == null ? null : Number(r.max_score),
      reason: r.reason,
      createdAt: r.created_at,
      actualScore,
      actualMaxScore: matched?.max ?? null,
      achieved: goalAchieved(target, actualScore),
    };
  });
}

// === 성적 코멘트(grade_comments) — 학습 피드백 ===
export type GradeCommentRow = {
  id: string;
  category: string;
  subject: string | null;
  content: string;
  period: string;
  sharedWithParent: boolean;
  authorName: string | null;
  createdAt: string;
};

export async function getStudentGradeComments(studentId: string): Promise<GradeCommentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("grade_comments")
    .select(
      `id, category, subject, content, period, shared_with_parent, created_at,
       author:author_id ( display_name )`,
    )
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  if (!data) return [];
  return data.map((r) => {
    const author = (Array.isArray(r.author) ? r.author[0] : r.author) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      category: r.category,
      subject: r.subject,
      content: r.content,
      period: r.period,
      sharedWithParent: r.shared_with_parent,
      authorName: author?.display_name ?? null,
      createdAt: r.created_at,
    };
  });
}

export type LevelTestRow = {
  id: string;
  testType: string; // placement/promotion/diagnostic
  subject: string;
  testedOn: string;
  level: string | null;
  subscores: Record<string, number> | null;
  notes: string | null;
};

export async function getStudentLevelTests(studentId: string): Promise<LevelTestRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("level_tests")
    .select("id, test_type, subject, tested_on, level, subscores, notes")
    .eq("student_id", studentId)
    .order("tested_on", { ascending: false });
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    testType: r.test_type,
    subject: r.subject,
    testedOn: r.tested_on,
    level: r.level,
    subscores: (r.subscores as Record<string, number> | null) ?? null,
    notes: r.notes,
  }));
}

export type StudentMemoRow = {
  id: string;
  category: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
};

export async function getStudentMemos(studentId: string): Promise<StudentMemoRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("student_memos")
    .select(
      `id, category, content, pinned, created_at, created_by,
       author:created_by ( display_name )`,
    )
    .eq("student_id", studentId)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false });
  if (!data) return [];
  return data.map((r) => {
    const a = (Array.isArray(r.author) ? r.author[0] : r.author) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      category: r.category,
      content: r.content,
      pinned: r.pinned ?? false,
      createdAt: r.created_at,
      createdBy: r.created_by,
      createdByName: a?.display_name ?? null,
    };
  });
}

export type StudentConsultationRow = {
  id: string;
  consultedAt: string;
  category: string | null;
  subject: string | null;
  audience: string | null;
  summary: string;
  followUpAction: string | null;
  followUpDate: string | null;
  followUpDone: boolean;
  counselorName: string | null;
};

export async function getStudentConsultationHistory(
  studentId: string,
): Promise<StudentConsultationRow[]> {
  const supabase = await createClient();
  // 강사 스코프: 학생 상세의 상담 탭도 **본인이 등록한 상담**만 — 남이 쓴 상담 미노출(상담 목록/상세와 동일 불변식).
  const tId = await effectiveTeacherId();
  // ⚠️ filter(.eq)는 transform(.order)보다 먼저 — supabase-js는 transform 뒤 filter 불가.
  let qb = supabase
    .from("student_consultations")
    .select(
      `id, consulted_at, category, subject, audience, summary,
       follow_up_action, follow_up_date, follow_up_done,
       counselor:counselor_id ( display_name )`,
    )
    .eq("student_id", studentId);
  if (tId) qb = qb.eq("counselor_id", tId);
  const { data } = await qb.order("consulted_at", { ascending: false });
  if (!data) return [];
  return data.map((r) => {
    const c = (Array.isArray(r.counselor) ? r.counselor[0] : r.counselor) as
      | { display_name?: string }
      | undefined;
    return {
      id: r.id,
      consultedAt: r.consulted_at,
      category: r.category,
      subject: r.subject,
      audience: r.audience,
      summary: r.summary,
      followUpAction: r.follow_up_action,
      followUpDate: r.follow_up_date,
      followUpDone: r.follow_up_done,
      counselorName: c?.display_name ?? null,
    };
  });
}

export type StudentEnrollmentConsultRow = {
  id: string;
  date: string | null;
  subject: string | null;
  outcome: string | null;
  request: string | null;
  careerGoal: string | null;
  followUp: string | null;
};

/**
 * 학생에 연결된 **등록상담(입학 상담)** — 학생 상세 상담 탭 상단에 [입학 상담] 라벨로 고정 노출.
 * 학생당 1~3건. RLS로 테넌트 자동 격리 + 호출부(page)가 enrollment 접근권한으로 게이트(민감정보).
 * ⚠️ 이건 enrollment_consultations(입학상담) — student_consultations(재원생 상담)와 별개 테이블.
 */
export async function getStudentEnrollmentConsultations(
  studentId: string,
): Promise<StudentEnrollmentConsultRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollment_consultations")
    .select(
      "id, consulted_at, consultation_date, created_at, subject, outcome, parent_request, career_goal, follow_up_content",
    )
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  if (!data) return [];
  return data.map((r) => ({
    id: r.id,
    date: r.consulted_at ?? r.consultation_date ?? r.created_at ?? null,
    subject: r.subject,
    outcome: r.outcome,
    request: r.parent_request,
    careerGoal: r.career_goal,
    followUp: r.follow_up_content,
  }));
}

export type StudentAttendanceDay = {
  date: string;
  status: string;
  className: string;
};

export async function getStudentAttendanceCalendar(
  studentId: string,
  days = 60,
): Promise<StudentAttendanceDay[]> {
  const supabase = await createClient();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const { data } = await supabase
    .from("attendance_records")
    .select(`session_date, status, class:class_id ( class_name )`)
    .eq("student_id", studentId)
    .gte("session_date", start.toISOString().slice(0, 10))
    .order("session_date", { ascending: false });
  if (!data) return [];
  return data.map((r) => {
    const c = (Array.isArray(r.class) ? r.class[0] : r.class) as
      | { class_name?: string }
      | undefined;
    return {
      date: r.session_date,
      status: r.status,
      className: c?.class_name ?? "?",
    };
  });
}

// ───────── 출결 탭(ijw AttendanceTab 이식) — 월 달력/리스트 두 뷰용 전건 ─────────
export type StudentAttendanceFull = {
  date: string; // YYYY-MM-DD
  status: string; // present|absent|late|excused|makeup|early_leave
  className: string;
  classId: string;
  note: string | null;
};

/** 학생 전 출결 기록(월 네비·달력/리스트 뷰·반 필터를 클라에서 처리하도록 전건 반환). */
export async function getStudentAttendanceFull(studentId: string): Promise<StudentAttendanceFull[]> {
  const supabase = await createClient();
  const data = await fetchAllPaged<{
    session_date: string;
    status: string;
    note: string | null;
    class_id: string;
    class: { class_name?: string } | { class_name?: string }[] | null;
  }>((from, to) =>
    supabase
      .from("attendance_records")
      .select(`session_date, status, note, class_id, class:class_id ( class_name )`)
      .eq("student_id", studentId)
      .order("session_date", { ascending: false })
      .range(from, to),
  );
  return data.map((r) => {
    const c = (Array.isArray(r.class) ? r.class[0] : r.class) as { class_name?: string } | undefined;
    return {
      date: r.session_date,
      status: r.status,
      className: c?.class_name ?? "?",
      classId: r.class_id,
      note: r.note,
    } satisfies StudentAttendanceFull;
  });
}

// 등록상담 → 학생 timeline ↔ 학생상담 + 메모 + enrollment 변경 통합
export type TimelineEvent = {
  date: string; // ISO date
  kind: "enrollment_start" | "enrollment_end" | "consultation" | "memo" | "status_change" | "grade";
  title: string;
  description?: string | null;
  registrant?: string | null; // 등록자(상담/메모, 임포트 텍스트에서 분리)
};

export async function getStudentTimeline(studentId: string): Promise<TimelineEvent[]> {
  const supabase = await createClient();

  // 강사 스코프: 타임라인의 상담 이벤트도 **본인이 등록한 상담**만(남이 쓴 상담 내용 미노출, 상담 목록/상세와 동일).
  const tId = await effectiveTeacherId();
  let consultQuery = supabase
    .from("student_consultations")
    .select(`consulted_at, category, summary`)
    .eq("student_id", studentId);
  if (tId) consultQuery = consultQuery.eq("counselor_id", tId);

  const [
    { data: enrollments },
    { data: consultations },
    { data: memos },
    { data: grades },
  ] = await Promise.all([
    supabase
      .from("enrollments")
      .select(`start_date, end_date, withdrawal_reason, class:class_id ( class_name )`)
      .eq("student_id", studentId),
    consultQuery,
    supabase
      .from("student_memos")
      .select(`created_at, category, content`)
      .eq("student_id", studentId),
    supabase
      .from("student_grades")
      .select(`taken_on, exam_name, subject, score, max_score`)
      .eq("student_id", studentId),
  ]);

  const events: TimelineEvent[] = [];

  for (const e of enrollments ?? []) {
    const c = (Array.isArray(e.class) ? e.class[0] : e.class) as
      | { class_name?: string }
      | undefined;
    events.push({
      date: e.start_date,
      kind: "enrollment_start",
      title: `${c?.class_name ?? "—"} 수강 시작`,
    });
    if (e.end_date) {
      events.push({
        date: e.end_date,
        kind: "enrollment_end",
        title: `${c?.class_name ?? "—"} 수강 종료`,
        description: e.withdrawal_reason,
      });
    }
  }

  // category 코드 → 한글. 임포트 데이터엔 audience 값("parent")이 섞여 있어, 매핑 안 되는 코드는 접미사 생략.
  const CONSULT_CATEGORY_LABEL: Record<string, string> = {
    general: "일반",
    academic: "학습/성적",
    emotional: "정서/심리",
    career: "진로",
    social: "교우관계",
    other: "기타",
  };
  for (const c of consultations ?? []) {
    const catLabel = c.category ? CONSULT_CATEGORY_LABEL[c.category] : null;
    const p = parseImportedNote(c.summary);
    events.push({
      date: String(c.consulted_at).slice(0, 10),
      kind: "consultation",
      title: p.title ?? (catLabel ? `상담 — ${catLabel}` : "상담 기록"),
      description: p.body,
      registrant: p.registrant,
    });
  }

  for (const m of memos ?? []) {
    const p = parseImportedNote(m.content);
    events.push({
      date: String(m.created_at).slice(0, 10),
      kind: "memo",
      title: p.title ?? (m.category ? `메모 — ${m.category}` : "메모"),
      description: p.body,
      registrant: p.registrant,
    });
  }

  const subjectMaps = buildSubjectMaps((await getTenantSettings()).operations.subjects);
  for (const g of grades ?? []) {
    events.push({
      date: g.taken_on,
      kind: "grade",
      title: `${subjectMaps.labelOf(g.subject)} — ${g.exam_name}`,
      description:
        g.score == null
          ? null
          : g.max_score
            ? `${g.score} / ${g.max_score}점`
            : `${g.score}점`,
    });
  }

  // 최신 → 과거 정렬
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return events;
}

// ────────────────────── QuickPanel 경량 요약 ──────────────────────

export type StudentSummary = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  status: string;
  teacherNames: string[]; // 과목별 담당 강사 distinct(단일 담임 대체)
  attendance: {
    rate: number;
    total: number;
    present: number;
    absent: number;
    late: number;
  };
  enrollments: { className: string; subject: string; teacherName: string | null; onHold: boolean }[];
  billing: {
    unpaidCount: number;
    overdueCount: number;
    latestPeriod: string | null;
    latestStatus: string | null;
  };
};

/**
 * 학생 QuickPanel(우측 오버레이)용 경량 요약. 기존 server-only 쿼리들을
 * Promise.all로 합쳐 한 번에 반환. 리스트 로드엔 영향 없고(클릭 시 on-demand),
 * route handler(/api/students/[id]/summary)에서 호출된다.
 */
export async function getStudentSummary(studentId: string): Promise<StudentSummary | null> {
  const [detail, attendance, enrollments, invoices] = await Promise.all([
    getStudentById(studentId),
    getStudentAttendanceStats(studentId, 30),
    getStudentEnrollments(studentId),
    getStudentInvoices(studentId),
  ]);
  if (!detail) return null;

  const today = kstToday();
  const unpaid = invoices.filter((i) => i.status !== "paid");
  const overdue = unpaid.filter((i) => i.dueDate != null && i.dueDate < today);
  const latest = invoices[0] ?? null; // period desc 정렬이라 [0]이 최신

  return {
    id: detail.id,
    name: detail.name,
    school: detail.school,
    grade: detail.grade,
    status: detail.status,
    teacherNames: [
      ...new Set(enrollments.filter((e) => e.endDate == null && e.teacherName).map((e) => e.teacherName as string)),
    ].sort(),
    attendance: {
      rate: attendance.rate,
      total: attendance.total,
      present: attendance.present,
      absent: attendance.absent,
      late: attendance.late,
    },
    enrollments: enrollments
      .filter((e) => e.endDate == null)
      .map((e) => ({ className: e.className, subject: e.subject, teacherName: e.teacherName, onHold: e.onHold })),
    billing: {
      unpaidCount: unpaid.length,
      overdueCount: overdue.length,
      latestPeriod: latest?.period ?? null,
      latestStatus: latest?.status ?? null,
    },
  };
}
