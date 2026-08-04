import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getTeacherScope } from "@/lib/auth/teacher-scope";
import { attendanceRate } from "@/lib/calc/attendance";
import { kstToday } from "@/lib/date-kst";
import { ASSIGNABLE_TEACHER_ROLES } from "@/lib/permissions";
import type { ClassroomAssignData } from "../lib/classroom-assign";

/**
 * "만료되지 않은 스케줄" PostgREST `or` 절 — `valid_to`가 무기한(null)이거나 오늘 이후(**포함**).
 * `class_schedules`는 운영 이력을 함께 담는다(영어 시트 구조 가져오기가 옛 배치를 `valid_to`로 마감하고
 * 새 배치를 넣는다) — injaewon 실측 1,068행 중 480행이 이미 만료다. 시간표 쿼리·`isCurrentSlot`과 같은 경계.
 * ⚠️ 종강 반은 슬롯이 전부 만료라 이 필터를 걸면 요일이 통째로 사라진다 → **운영 중 반을 다루는 곳에만** 쓸 것.
 */
const liveValidTo = (today: string) => `valid_to.is.null,valid_to.gte.${today}`;

/** 운영 요일 + 그 요일의 최초 시작시각(HH:MM). 같은 요일 여러 교시면 가장 이른 시각. */
export type ClassDaySlot = { day: string; start: string | null };

export type ClassListRow = {
  id: string;
  className: string;
  subject: string;
  teacherId: string | null;
  teacherName: string | null;
  classroomName: string | null;
  isActive: boolean;
  /** 종강일(0059a) — 있으면 종강(운영 종료). is_active=false(폐지)와 구분. */
  closedAt: string | null;
  studentCount: number;
  days: ClassDaySlot[]; // 운영 요일(+시작시각), 요일순 정렬
  notes: string | null;
};

/** 수업목록 정렬 기준 — ijw 패리티(수업명/학생수/강사명). */
export type ClassSort = "name" | "students" | "teacher";

export type ClassListFilters = {
  subject?: string; // "all" | "math" | ...
  teacherId?: string; // "all" | uuid
  day?: string; // "all" | "mon" | ... (getClassesList 단일 요일 — 레거시)
  days?: string[]; // 다중 요일(getClassesPage) — 하나라도 포함하면 매칭(ijw 의미)
  q?: string;
  active?: "all" | "active" | "closed";
  sort?: ClassSort; // 미지정 시 "name"
};

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type ClassScheduleSlot = {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string; // HH:MM
  endTime: string;
  validFrom: string | null;
  validTo: string | null;
  // 교시별 오버라이드 — null이면 반의 담임/기본 강의실 상속.
  teacherId: string | null;
  classroomId: string | null;
};

export type ClassDetail = {
  id: string;
  className: string;
  subject: string;
  teacherId: string | null;
  teacherName: string | null;
  classroomId: string | null;
  classroomName: string | null;
  isActive: boolean;
  /** 종강일(0059a) — 있으면 종강. is_active=false(폐지)와 구분. */
  closedAt: string | null;
  /** 특강(0133a) 토글값 **그대로**. ⚠️ "이 반이 특강인가"는 이름 폴백까지 보는 `isSpecialLecture()`로 판정할 것. */
  isSpecial: boolean;
  /** '수업보고서 미발송'(0174a) 토글값. 판정 = `isReportOptout()`(이름 폴백 없음 — 컬럼이 전부다). */
  reportOptout: boolean;
  notes: string | null;
  bgColor: string | null;
  // 강사 인수인계 예약(0044a) — pendingTeacherId 있으면 예약 존재.
  pendingTeacherId: string | null;
  pendingTeacherName: string | null;
  pendingTeacherDate: string | null;
  pendingTeacherReason: string | null;
  scheduleSlots: ClassScheduleSlot[];
  studentCount: number;
};

export type ClassStudentRow = {
  enrollmentId: string;
  studentId: string;
  name: string;
  grade: string | null;
  school: string | null;
  enrolledAt: string;
  onHold: boolean;
  /** 분리등원 요일 — []=수업 전 요일 등원, ['mon','thu']=월·목만. */
  attendanceDays: string[];
};

export type ClassAttendanceStats = {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  rate: number;
};

const DOW_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** PostgREST .or()/ilike 안전화 — 구분자·와일드카드 제거(한글/공백 보존). search/queries.ts와 동일. */
function sanitizeTerm(q: string): string {
  return q.replace(/[%,()*\\]/g, " ").trim();
}

/** class_schedules 행들 → classId별 (요일→최초 시작시각) 맵. */
function buildDaySlots(
  scheds: { class_id: string; day_of_week: string; start_time?: string | null }[] | null,
): Map<string, Map<string, string | null>> {
  const byClass = new Map<string, Map<string, string | null>>();
  for (const s of scheds ?? []) {
    const m = byClass.get(s.class_id) ?? new Map<string, string | null>();
    const start = s.start_time ? String(s.start_time).slice(0, 5) : null;
    const prev = m.get(s.day_of_week);
    if (prev === undefined) m.set(s.day_of_week, start);
    else if (start !== null && (prev === null || start < prev)) m.set(s.day_of_week, start);
    byClass.set(s.class_id, m);
  }
  return byClass;
}

/** (요일→시작시각) 맵 → 요일순 정렬된 ClassDaySlot[]. */
function sortedDaySlots(m: Map<string, string | null> | undefined): ClassDaySlot[] {
  return [...(m?.entries() ?? [])]
    .sort((a, b) => DOW_ORDER.indexOf(a[0]) - DOW_ORDER.indexOf(b[0]))
    .map(([day, start]) => ({ day, start }));
}

export async function getClassesList(options?: ClassListFilters): Promise<ClassListRow[]> {
  const supabase = await createClient();

  let qb = supabase
    .from("classes")
    .select(
      `id, class_name, subject, is_active, closed_at, notes, teacher_id,
       teacher:teacher_id ( display_name ),
       classroom:classroom_id ( name )`,
    )
    .order("class_name");

  if (options?.subject && options.subject !== "all") qb = qb.eq("subject", options.subject);
  if (options?.teacherId && options.teacherId !== "all") qb = qb.eq("teacher_id", options.teacherId);
  if (options?.active === "active") qb = qb.eq("is_active", true);
  if (options?.active === "closed") qb = qb.eq("is_active", false);
  if (options?.q) {
    const term = options.q.trim();
    if (term) qb = qb.ilike("class_name", `%${term}%`);
  }

  const { data: classes } = await qb;
  if (!classes) return [];

  // 학생 수 카운트 — 표시 중인 반 id로 청크 조회. 전건 fetch는 ~1000행에서 잘려(#54) 학생 수가 과소집계되고,
  // 표시 안 하는 반 enrollment까지 끌어와 낭비된다. getClassesPage와 동일 패턴(fetchInChunks).
  const classIds = classes.map((c) => c.id);
  const counts = new Map<string, number>();
  if (classIds.length > 0) {
    const enrollments = await fetchInChunks<{ class_id: string }>(classIds, (chunk) =>
      supabase.from("enrollments").select("class_id").is("end_date", null).in("class_id", chunk),
    );
    for (const e of enrollments) {
      counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
    }
  }

  // 요일 + 시작시각 — 동일하게 청크 조회(반 많아지면 단일 .in()이 414, 스케줄 1000행 절단).
  let daysByClass = new Map<string, Map<string, string | null>>();
  if (classIds.length > 0) {
    const scheds = await fetchInChunks<{
      class_id: string;
      day_of_week: string;
      start_time: string | null;
    }>(classIds, (chunk) =>
      supabase
        .from("class_schedules")
        .select("class_id, day_of_week, start_time")
        .in("class_id", chunk),
    );
    daysByClass = buildDaySlots(scheds);
  }

  let rows = classes.map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
      | { display_name?: string }
      | undefined;
    const room = (Array.isArray(c.classroom) ? c.classroom[0] : c.classroom) as
      | { name?: string }
      | undefined;
    return {
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherId: c.teacher_id,
      teacherName: teacher?.display_name ?? null,
      classroomName: room?.name ?? null,
      isActive: c.is_active,
      closedAt: (c as { closed_at?: string | null }).closed_at ?? null,
      studentCount: counts.get(c.id) ?? 0,
      days: sortedDaySlots(daysByClass.get(c.id)),
      notes: c.notes ?? null,
    } satisfies ClassListRow;
  });

  // 요일 필터 (in-memory)
  if (options?.day && options.day !== "all") {
    rows = rows.filter((r) => r.days.some((d) => d.day === options.day));
  }

  return rows;
}

/**
 * 수업목록 Stat 카드용 경량 집계 — head:true 카운트만(행 fetch 없이, 전건 enrollment 절단도 회피).
 * totalSeats = end_date null 활성 수강 총합.
 */
export async function getClassesStats(): Promise<{ total: number; active: number; totalSeats: number }> {
  const supabase = await createClient();
  // 강사 스코프: teacher(또는 겸직-강사뷰)면 본인 담당 반·그 반 수강만 카운트(목록과 일치).
  const tId = await effectiveTeacherId();
  const classBase = () => {
    const q = supabase.from("classes").select("*", { count: "exact", head: true });
    return tId ? q.eq("teacher_id", tId) : q;
  };
  let seatsQuery = supabase.from("enrollments").select("*", { count: "exact", head: true }).is("end_date", null);
  if (tId) {
    const { classIds } = await getTeacherScope(tId);
    if (classIds.length === 0) return { total: 0, active: 0, totalSeats: 0 };
    seatsQuery = seatsQuery.in("class_id", classIds);
  }
  const [total, active, seats] = await Promise.all([
    classBase(),
    classBase().eq("is_active", true),
    seatsQuery,
  ]);
  return { total: total.count ?? 0, active: active.count ?? 0, totalSeats: seats.count ?? 0 };
}

/** 수업목록 정렬 — 수업명(기본)·학생수(많은순)·강사명(가나다, 미정은 끝). 동률은 수업명 보조정렬. */
function sortClassRows(rows: ClassListRow[], sort: ClassSort): void {
  const byName = (a: ClassListRow, b: ClassListRow) => a.className.localeCompare(b.className, "ko");
  rows.sort((a, b) => {
    if (sort === "students") return b.studentCount - a.studentCount || byName(a, b);
    if (sort === "teacher")
      return (a.teacherName ?? "힣").localeCompare(b.teacherName ?? "힣", "ko") || byName(a, b);
    return byName(a, b);
  });
}

/**
 * 수업목록 — 모집단이 작아(학원 단위 수업 ~수백) 매칭 전건을 가져와 메모리에서 정렬·페이지네이션한다.
 * 학생수·강사명 정렬은 파생/조인 필드라 PostgREST 부모행 order로 표현 불가 → 전건 후 메모리 정렬이 정답.
 * subject/teacher/q는 SQL, 요일(다중)은 class_schedules에서 "선택 요일 중 하나라도" 가진 수업 id로 먼저 좁힌다.
 * 학생수·요일 enrich는 매칭 수업 id를 청크로 조회(414/1000행 절단 회피, lib/supabase/batch).
 */
export async function getClassesPage(
  options: ClassListFilters,
  page = 1,
  pageSize = 50,
): Promise<{ rows: ClassListRow[]; total: number }> {
  const supabase = await createClient();
  const sort: ClassSort = options.sort ?? "name";

  // 강사 스코프: teacher(또는 겸직-강사뷰)면 본인 담당 반만(옵션 teacherId 무시하고 강제).
  const forcedTeacherId = await effectiveTeacherId();

  // 요일(다중) 필터 — 선택 요일 중 하나라도 운영하는 수업 id로 좁힘(ijw "하나라도 포함" 의미).
  let dayClassIds: string[] | null = null;
  const days = (options.days ?? []).filter(Boolean);
  if (days.length > 0) {
    const { data: scheds, error } = await supabase
      .from("class_schedules")
      .select("class_id")
      .in("day_of_week", days);
    if (error) throw new Error(`getClassesPage(days): ${error.message}`);
    dayClassIds = [...new Set((scheds ?? []).map((s) => s.class_id))];
    if (dayClassIds.length === 0) return { rows: [], total: 0 };
  }

  let qb = supabase
    .from("classes")
    .select(
      `id, class_name, subject, is_active, closed_at, notes, teacher_id,
       teacher:teacher_id ( display_name ),
       classroom:classroom_id ( name )`,
    )
    .order("class_name");
  if (options.subject && options.subject !== "all") qb = qb.eq("subject", options.subject);
  const teacherFilter =
    forcedTeacherId ?? (options.teacherId && options.teacherId !== "all" ? options.teacherId : null);
  if (teacherFilter) qb = qb.eq("teacher_id", teacherFilter);
  if (options.active === "active") qb = qb.eq("is_active", true);
  if (options.active === "closed") qb = qb.eq("is_active", false);
  if (options.q) {
    const term = sanitizeTerm(options.q);
    if (term) {
      // 반이름 OR 강사명: 강사명에 매칭되는 강사 id를 먼저 풀어 teacher_id로 좁힌다(null 강사 안전).
      const { data: matchTeachers } = await supabase
        .from("users")
        .select("id")
        .ilike("display_name", `%${term}%`);
      const teacherIds = (matchTeachers ?? []).map((u) => u.id);
      const orParts = [`class_name.ilike.%${term}%`];
      if (teacherIds.length) orParts.push(`teacher_id.in.(${teacherIds.join(",")})`);
      qb = qb.or(orParts.join(","));
    }
  }
  if (dayClassIds) qb = qb.in("id", dayClassIds);

  const { data: classes, error } = await qb;
  if (error) throw new Error(`getClassesPage: ${error.message}`);
  const matched = classes ?? [];
  const classIds = matched.map((c) => c.id);

  // 학생수·요일 — 매칭 수업 id를 청크로 조회(전건 .in() 414/1000행 절단 회피).
  const counts = new Map<string, number>();
  let daysByClass = new Map<string, Map<string, string | null>>();
  if (classIds.length > 0) {
    const [enrollments, scheds] = await Promise.all([
      fetchInChunks<{ class_id: string }>(classIds, (chunk) =>
        supabase.from("enrollments").select("class_id").is("end_date", null).in("class_id", chunk),
      ),
      fetchInChunks<{ class_id: string; day_of_week: string; start_time: string | null }>(
        classIds,
        (chunk) =>
          supabase
            .from("class_schedules")
            .select("class_id, day_of_week, start_time")
            .in("class_id", chunk),
      ),
    ]);
    for (const e of enrollments) counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
    daysByClass = buildDaySlots(scheds);
  }

  const rows = matched.map((c) => {
    const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
      | { display_name?: string }
      | undefined;
    const room = (Array.isArray(c.classroom) ? c.classroom[0] : c.classroom) as
      | { name?: string }
      | undefined;
    return {
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherId: c.teacher_id,
      teacherName: teacher?.display_name ?? null,
      classroomName: room?.name ?? null,
      isActive: c.is_active,
      closedAt: (c as { closed_at?: string | null }).closed_at ?? null,
      studentCount: counts.get(c.id) ?? 0,
      days: sortedDaySlots(daysByClass.get(c.id)),
      notes: c.notes ?? null,
    } satisfies ClassListRow;
  });

  sortClassRows(rows, sort);

  const total = rows.length;
  const from = (page - 1) * pageSize;
  return { rows: rows.slice(from, from + pageSize), total };
}

/**
 * 담임 **배정** 선택지 — 반을 맡을 수 있는 재직자(새 반·반 수정·강사 인수인계 공용).
 *
 * ⚠️ 화이트리스트가 좁히는 건 **재직 여부**(`status=active`)다 — 퇴직자가 '새 반 담임' 후보로 뜨는 걸
 *    막는 게 목적. **역할로 좁히는 게 아니다.** 여기서 `admin`(관리자)이 빠져 있어 실제로 반을 맡고 있는
 *    관리자 3명이 배정·인수인계 드롭다운에서 통째로 사라졌다(2026-08-03 원장 제보 "강사 인수인계에
 *    허은진이 없음" — 실측 김민주 3반·정유진 2반·허은진 1반 = 활성 6반, 전부 admin/active).
 *    역할 목록은 [`ASSIGNABLE_TEACHER_ROLES`](../../../lib/permissions.ts) 단일 소스 — 여기 새로 적지 말 것.
 *
 * ⚠️ 역할을 더 좁히고 싶어지면 **화면에서 안 보이는 것과 데이터에서 없는 것은 다르다**는 걸 먼저 볼 것 —
 *    담임은 이미 데이터에 있고, 후보에서 빼도 그 반은 그대로다. 대신 그 반을 수정하면 컨트롤드 select가
 *    빈 칸이 되어 저장 한 번에 담임이 NULL로 지워진다(반 수정 페이지의 '현재 담임 고정' 참조).
 */
export async function getClassTeacherOptions(): Promise<
  { id: string; name: string; subjects: string[] }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("id, display_name, system_role, subjects")
    .in("system_role", [...ASSIGNABLE_TEACHER_ROLES])
    .eq("status", "active")
    .order("display_name");
  return (data ?? []).map((u) => ({
    id: u.id,
    name: u.display_name,
    subjects: u.subjects ?? [],
  }));
}

/**
 * 수업목록 **강사 필터** 선택지 — 배정 가능한 사람(위 `getClassTeacherOptions`) **∪ 실제로 담임인 사람**.
 *
 * 왜 배정용과 갈라놨나(2026-07-22 원장 제보 "수업목록에서 왜 허은진이 필터에 없지?"):
 *   배정용은 **재직자**(`status=active`)로 좁혀야 한다 — 안 그러면 **퇴직자가 '새 반 담임' 후보로 뜬다**.
 *   그런데 필터는 정반대 질문이다: "이 목록에 실제로 있는 담임이 누구냐". 배정용을 그대로 필터에 쓰면
 *   **퇴직 처리됐거나 역할이 다른 담임의 반이 필터에서 통째로 사라진다**
 *   (실측 4명·12반: 김민주 7 · 김태건 viewer 2 · 신명진 manager/inactive 2 · 허은진 1).
 *
 * 🔴 그때 고친 건 **필터 한 쪽뿐**이었다. 같은 뿌리(배정용 화이트리스트에 `admin` 누락)가 배정·인수인계
 *    드롭다운에 그대로 살아 있어서, 정확히 6주 뒤 같은 사람으로 같은 제보가 다시 왔다
 *    (2026-08-03 "강사 인수인계에 허은진이 없음"). **한 화면에서 증상을 지웠다고 원인이 사라진 게 아니다** —
 *    같은 값을 읽는 형제 표면(필터·배정·인수인계·새 반)을 함께 확인할 것.
 *
 * ⚠️ 이 함수는 **필터 전용**이다. 담임 배정·변경 드롭다운에 쓰지 말 것(퇴직자가 후보로 샌다).
 */
export async function getClassTeacherFilterOptions(): Promise<
  { id: string; name: string; subjects: string[] }[]
> {
  const supabase = await createClient();
  const [assignable, assignedRows] = await Promise.all([
    getClassTeacherOptions(),
    // 활성 반의 실제 담임 id + 그 반 과목 — 역할·재직상태 무관(데이터에 있는 그대로).
    // ⚠️ 결과를 distinct·whitelist로 쓰므로 **무페이징 select 금지**(B2: PostgREST 1000행 silent 절단).
    //    잘리면 담임이 또 조용히 사라진다 — 이 함수가 고치려던 바로 그 증상이다.
    fetchAllPaged<{ teacher_id: string; subject: string }>((from, to) =>
      supabase
        .from("classes")
        .select("teacher_id, subject")
        .eq("is_active", true)
        .not("teacher_id", "is", null)
        .order("id")
        .range(from, to),
    ),
  ]);
  // 담임 → 실제로 맡고 있는 반의 과목 집합.
  const taught = new Map<string, Set<string>>();
  for (const r of assignedRows) {
    const id = r.teacher_id;
    (taught.get(id) ?? taught.set(id, new Set()).get(id)!).add(r.subject);
  }
  const known = new Set(assignable.map((t) => t.id));
  const missing = [...taught.keys()].filter((id) => !known.has(id));
  // 화이트리스트 밖 담임만 보강 조회(대개 0~5명이지만 id가 수십 될 수 있어 청크 — B3).
  const extra = missing.length
    ? await fetchInChunks<{ id: string; display_name: string; subjects: string[] | null }>(
        missing,
        (chunk) => supabase.from("users").select("id, display_name, subjects").in("id", chunk),
      )
    : [];
  // ⚠️ 과목은 `users.subjects` **∪ 실제 담당반 과목**. 필터바가 과목 선택 시 이 목록으로 강사를 다시
  //    좁히는데(teacherTeaches), users.subjects가 비었거나 어긋난 담임은 그 순간 또 사라진다 — 같은 결함의
  //    반복이라 여기서 막는다(프로필 값이 아니라 **실제로 맡은 반**이 진실).
  const withTaught = (id: string, subjects: string[]) => [...new Set([...subjects, ...(taught.get(id) ?? [])])];
  return [
    ...assignable.map((t) => ({ ...t, subjects: withTaught(t.id, t.subjects) })),
    ...extra.map((u) => ({
      id: u.id,
      name: u.display_name,
      subjects: withTaught(u.id, u.subjects ?? []),
    })),
  ].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export async function getClassDetail(id: string): Promise<ClassDetail | null> {
  const supabase = await createClient();
  const { data: c } = await supabase
    .from("classes")
    .select(
      `id, class_name, subject, is_active, closed_at, is_special, report_optout, notes, bg_color,
       teacher_id, classroom_id,
       pending_teacher_id, pending_teacher_date, pending_teacher_reason,
       teacher:teacher_id ( display_name ),
       pending_teacher:pending_teacher_id ( display_name ),
       classroom:classroom_id ( name )`,
    )
    .eq("id", id)
    .single();

  if (!c) return null;

  // 독립 두 쿼리 병렬(2 round-trip → 1). count는 head:true라 행 미전송.
  const [{ data: schedules }, { count: studentCount }] = await Promise.all([
    supabase
      .from("class_schedules")
      .select("id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id")
      .eq("class_id", id)
      .order("day_of_week")
      .order("start_time"),
    supabase
      .from("enrollments")
      .select("*", { count: "exact", head: true })
      .eq("class_id", id)
      .is("end_date", null),
  ]);

  const teacher = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as
    | { display_name?: string }
    | undefined;
  const pendingTeacher = (Array.isArray(c.pending_teacher) ? c.pending_teacher[0] : c.pending_teacher) as
    | { display_name?: string }
    | undefined;
  const room = (Array.isArray(c.classroom) ? c.classroom[0] : c.classroom) as
    | { name?: string }
    | undefined;

  return {
    id: c.id,
    className: c.class_name,
    subject: c.subject,
    teacherId: c.teacher_id,
    teacherName: teacher?.display_name ?? null,
    classroomId: c.classroom_id,
    classroomName: room?.name ?? null,
    isActive: c.is_active,
    closedAt: (c as { closed_at?: string | null }).closed_at ?? null,
    isSpecial: (c as { is_special?: boolean | null }).is_special ?? false,
    reportOptout: (c as { report_optout?: boolean | null }).report_optout ?? false,
    notes: c.notes,
    bgColor: (c as { bg_color?: string | null }).bg_color ?? null,
    pendingTeacherId: (c as { pending_teacher_id?: string | null }).pending_teacher_id ?? null,
    pendingTeacherName: pendingTeacher?.display_name ?? null,
    pendingTeacherDate: (c as { pending_teacher_date?: string | null }).pending_teacher_date ?? null,
    pendingTeacherReason:
      (c as { pending_teacher_reason?: string | null }).pending_teacher_reason ?? null,
    scheduleSlots: (schedules ?? []).map((s) => ({
      id: s.id,
      dayOfWeek: s.day_of_week as DayOfWeek,
      startTime: String(s.start_time).slice(0, 5),
      endTime: String(s.end_time).slice(0, 5),
      validFrom: s.valid_from,
      validTo: s.valid_to,
      teacherId: (s.teacher_id as string | null) ?? null,
      classroomId: (s.classroom_id as string | null) ?? null,
    })),
    studentCount: studentCount ?? 0,
  };
}

export async function getClassStudents(classId: string): Promise<ClassStudentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollments")
    .select(
      `id, start_date, on_hold, attendance_days,
       student:student_id ( id, name, grade, school )`,
    )
    .eq("class_id", classId)
    .is("end_date", null)
    .order("start_date", { ascending: false });

  if (!data) return [];

  return data
    .map((e) => {
      const s = (Array.isArray(e.student) ? e.student[0] : e.student) as
        | { id: string; name: string; grade: string | null; school: string | null }
        | undefined;
      if (!s) return null;
      return {
        enrollmentId: e.id,
        studentId: s.id,
        name: s.name,
        grade: s.grade,
        school: s.school,
        enrolledAt: e.start_date,
        onHold: e.on_hold,
        attendanceDays: (e.attendance_days as string[] | null) ?? [],
      } satisfies ClassStudentRow;
    })
    .filter((r): r is ClassStudentRow => r !== null);
}

/**
 * 강의실 자동배정 입력 — 활성 반(슬롯·학생수·현재 강의실) + 전체 강의실.
 * 학생수·슬롯은 매칭 반 id를 청크 조회(전건 .in() 414 / 1000행 절단 회피, #53·#54).
 * 순수 배정 알고리즘([../lib/classroom-assign])이 이 데이터로 미리보기를 만든다.
 */
export async function getClassroomAssignmentData(): Promise<ClassroomAssignData> {
  const supabase = await createClient();
  const [{ data: cls }, { data: rooms }] = await Promise.all([
    supabase
      .from("classes")
      .select("id, class_name, subject, classroom_id")
      .eq("is_active", true)
      .order("class_name"),
    supabase.from("classrooms").select("id, name, capacity").order("name"),
  ]);

  const classes = cls ?? [];
  const classIds = classes.map((c) => c.id);
  const counts = new Map<string, number>();
  const slotsByClass = new Map<string, { day: string; start: string; end: string }[]>();

  if (classIds.length > 0) {
    const [enrollments, scheds] = await Promise.all([
      fetchInChunks<{ class_id: string }>(classIds, (chunk) =>
        supabase.from("enrollments").select("class_id").is("end_date", null).in("class_id", chunk),
      ),
      fetchInChunks<{
        class_id: string;
        day_of_week: string;
        start_time: string;
        end_time: string;
      }>(classIds, (chunk) =>
        supabase
          .from("class_schedules")
          .select("class_id, day_of_week, start_time, end_time")
          .in("class_id", chunk)
          // ⚠️ 만료 슬롯 제외(실측 1,068행 중 480행이 지난 배치). 안 거르면 자동배정이 이제 안 하는
          // 3~7월 교시를 "그 시간에 수업 중"으로 보고 **없는 강의실 충돌**을 만든다.
          // 시작 전(valid_from 미래) 슬롯은 남긴다 — 곧 자리가 필요하니 배정 계획에 들어가야 한다.
          .or(liveValidTo(kstToday())),
      ),
    ]);
    for (const e of enrollments) counts.set(e.class_id, (counts.get(e.class_id) ?? 0) + 1);
    for (const s of scheds) {
      const arr = slotsByClass.get(s.class_id) ?? [];
      arr.push({
        day: s.day_of_week,
        start: String(s.start_time).slice(0, 5),
        end: String(s.end_time).slice(0, 5),
      });
      slotsByClass.set(s.class_id, arr);
    }
  }

  return {
    classes: classes.map((c) => ({
      id: c.id,
      className: c.class_name,
      subject: c.subject,
      studentCount: counts.get(c.id) ?? 0,
      currentRoomId: c.classroom_id ?? null,
      slots: slotsByClass.get(c.id) ?? [],
    })),
    rooms: (rooms ?? []).map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
  };
}

export async function getClassAttendanceStats(
  classId: string,
  days = 30,
): Promise<ClassAttendanceStats> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const { data } = await supabase
    .from("attendance_records")
    .select("status")
    .eq("class_id", classId)
    .gte("session_date", since);

  const rows = data ?? [];
  const total = rows.length;
  const present = rows.filter((r) => r.status === "present").length;
  const absent = rows.filter((r) => r.status === "absent").length;
  const late = rows.filter((r) => r.status === "late").length;
  const excused = rows.filter((r) => r.status === "excused").length;
  return {
    total,
    present,
    absent,
    late,
    excused,
    rate: attendanceRate(present, total),
  };
}
