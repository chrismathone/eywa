import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstDateOf, kstToday } from "@/lib/date-kst";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getHomeroomHistoryIndex } from "@/features/classes/server/teacher-as-of-queries";
import { buildHomeroomTeachers, EMPTY_PREV_FLOW, homeroomMonths, isHomeroomConsultClass, recentMonths, type HomeroomStats } from "../homeroom-model";
import { buildPrevMonthFlow } from "../homeroom-flow";

type ClassRow = {
  id: string;
  class_name: string;
  subject: string | null;
  teacher_id: string | null;
  is_special: boolean | null;
  math_learning_track: string | null;
  closed_at: string | null;
};
type EnrollRow = { student_id: string; class_id: string; start_date: string | null; end_date: string | null; on_hold: boolean | null; is_transferred: boolean | null };
type StudentRow = { id: string; name: string; grade: string | null; status: string | null; is_test: boolean | null; withdrawn_at: string | null };

/**
 * 담임별 상담 현황(homeroom-model.ts 주석). 강사(강사뷰 포함)는 **본인 줄만**, 사무실은 재직 담임 전원.
 * 필터(기간·카테고리…)와 무관하다 — '이 학생을 이 달에 상담했나'는 상담 분류를 가리지 않는다.
 * 행을 세려고 끌어오는 곳이 아니라 학생×달 칸을 그리는 데 상담 날짜가 필요해서 받는다(fetchAllPaged, B2 · 큰 `.in()`은 청크, B3).
 * ⚠️ 상담 칸은 지금 담임 기준(현재 명단) · 지난달 흐름(학생 수·퇴원·수강 종료)만 **그 당시 담임** 기준이다(homeroom-flow.ts).
 */
export async function getHomeroomConsultStats(): Promise<HomeroomStats> {
  const supabase = await createClient();
  const teacherId = await effectiveTeacherId();
  const today = kstToday();
  const months = homeroomMonths(today); // 2026-10부터(homeroom-model.ts HOMEROOM_START_MONTH)
  const sinceIso = `${months[0]}-01T00:00:00+09:00`;
  // 지난달 — 학생 수 비교·퇴원·수강 종료(원장 2026-10-27 *"저번 달 학생 수 이번 달 학생 수 전달 퇴원생"*).
  const prevMonth = recentMonths(today, 2)[0]!;
  const prevFirst = `${prevMonth}-01`;

  // 반은 담임과 무관하게 전부 읽는다 — 지난달엔 다른 담임이었던 반(인수인계)도 그 당시 담임 몫으로 세야 한다.
  const [allClasses, homeroomHistory] = await Promise.all([
    fetchAllPaged<ClassRow>((from, to) =>
      supabase
        .from("classes")
        .select("id, class_name, subject, teacher_id, is_special, math_learning_track, closed_at")
        .eq("is_active", true)
        .order("id")
        .range(from, to),
    ),
    getHomeroomHistoryIndex(),
  ]);
  const eligible = allClasses.filter(
    (c) =>
      (!c.closed_at || c.closed_at.slice(0, 10) >= prevFirst) &&
      isHomeroomConsultClass({ isSpecial: c.is_special, className: c.class_name, learningTrack: c.math_learning_track }),
  );
  // 지금 담임 반(상담 칸의 명단) — 오늘 열려 있고 담임이 있는 반. 강사는 본인 반만.
  const rosterClasses = eligible.filter(
    (c): c is ClassRow & { teacher_id: string } =>
      !!c.teacher_id && (!c.closed_at || c.closed_at.slice(0, 10) >= today) && (!teacherId || c.teacher_id === teacherId),
  );

  const enrollRows = await fetchAllPagedInChunks<EnrollRow>(
    eligible.map((c) => c.id),
    (chunk, from, to) =>
      supabase
        .from("enrollments")
        .select("student_id, class_id, start_date, end_date, on_hold, is_transferred")
        .in("class_id", chunk)
        .or(`end_date.is.null,end_date.gte.${prevFirst}`)
        .order("id")
        .range(from, to),
  );
  // 오늘 살아 있는 수강 — 미래 시작·휴원 제외 · 오늘 끝나는 반이동은 이미 새 반([[#125]]).
  const isLive = (e: EnrollRow) =>
    !e.on_hold && (!e.start_date || e.start_date <= today) && (!e.end_date || e.end_date > today || (e.end_date === today && !e.is_transferred));
  const rosterIds = new Set(rosterClasses.map((c) => c.id));
  const live = enrollRows.filter((e) => rosterIds.has(e.class_id) && isLive(e));
  const studentIds = [...new Set(live.map((e) => e.student_id))];
  const teacherIds = [...new Set(eligible.map((c) => c.teacher_id).filter((v): v is string => !!v))];

  const [users, students, consults] = await Promise.all([
    fetchInChunks<{ id: string; display_name: string | null; status: string | null }>(teacherIds, (chunk) =>
      supabase.from("users").select("id, display_name, status").in("id", chunk),
    ),
    // 이름은 지난달에 끝난 학생까지(퇴원·수강 종료 명단) — 상담 조회는 지금 명단만.
    fetchInChunks<StudentRow>([...new Set(enrollRows.map((e) => e.student_id))], (chunk) =>
      supabase.from("students").select("id, name, grade, status, is_test, withdrawn_at").in("id", chunk),
    ),
    fetchAllPagedInChunks<{ id: string; student_id: string; counselor_id: string | null; consulted_at: string }>(studentIds, (chunk, from, to) =>
      supabase
        .from("student_consultations")
        .select("id, student_id, counselor_id, consulted_at")
        .in("student_id", chunk)
        .gte("consulted_at", sinceIso)
        .order("id")
        .range(from, to),
    ),
  ]);
  // 담임이 아닌 상담자 이름(칸 마우스 오버 '누가 했는가') — 담임 이름 조회에 없는 id만 더 읽는다.
  const known = new Set(users.map((u) => u.id));
  const extraIds = [...new Set(consults.map((c) => c.counselor_id).filter((id): id is string => !!id && !known.has(id)))];
  const counselors = await fetchInChunks<{ id: string; display_name: string | null }>(extraIds, (chunk) =>
    supabase.from("users").select("id, display_name").in("id", chunk),
  );
  const active = new Set(users.filter((u) => u.status === "active").map((u) => u.id));
  const enrolled = new Map(students.filter((s) => s.status === "enrolled" && !s.is_test).map((s) => [s.id, { name: s.name, grade: s.grade }]));

  // 퇴사한 담임의 반 — 현황에선 빼되 몇 반·몇 명이 빠졌는지 밝힌다(빠진 걸 숨기면 '전원 상담'으로 읽힌다).
  const retiredClasses = rosterClasses.filter((c) => !active.has(c.teacher_id));
  const retiredIds = new Set(retiredClasses.map((c) => c.id));
  const retired = {
    teachers: new Set(retiredClasses.map((c) => c.teacher_id)).size,
    classes: retiredClasses.length,
    students: new Set(live.filter((e) => retiredIds.has(e.class_id) && enrolled.has(e.student_id)).map((e) => e.student_id)).size,
  };

  const flow = buildPrevMonthFlow({
    prevMonth,
    classes: new Map(eligible.map((c) => [c.id, { teacherId: c.teacher_id, subject: c.subject }])),
    homeroomHistory,
    enrollments: enrollRows.map((e) => ({
      studentId: e.student_id,
      classId: e.class_id,
      startDate: e.start_date,
      endDate: e.end_date,
      isTransferred: !!e.is_transferred,
      live: isLive(e),
    })),
    students: new Map(
      students
        .filter((s) => !s.is_test)
        .map((s) => [s.id, { name: s.name, withdrawn: s.status === "withdrawn", withdrawnAt: s.withdrawn_at ? String(s.withdrawn_at).slice(0, 10) : null }]),
    ),
  });

  const teachers = buildHomeroomTeachers({
    today,
    months,
    classes: rosterClasses.filter((c) => active.has(c.teacher_id)).map((c) => ({ id: c.id, name: c.class_name, subject: c.subject, teacherId: c.teacher_id })),
    staffNames: new Map([...users, ...counselors].map((u) => [u.id, u.display_name?.trim() || "이름 없는 직원"])),
    enrollments: live.map((e) => ({ studentId: e.student_id, classId: e.class_id, startDate: e.start_date })),
    students: enrolled,
    consults: consults.flatMap((c) => {
      const date = kstDateOf(c.consulted_at);
      return date ? [{ studentId: c.student_id, counselorId: c.counselor_id, date }] : [];
    }),
  }).map((t) => ({ ...t, prev: flow.get(t.id) ?? EMPTY_PREV_FLOW }));
  // 지금 맡은 반은 없지만 지난달에 학생을 잃은 담임(인수인계로 반을 넘긴 사람)도 줄을 세운다 — 안 세우면 그 퇴원이 아무 데도 안 보인다.
  const shown = new Set(teachers.map((t) => t.id));
  const nameOf = new Map(users.map((u) => [u.id, u.display_name?.trim() || "이름 없는 직원"]));
  for (const [id, prev] of flow) {
    if (shown.has(id) || !active.has(id) || (teacherId && id !== teacherId)) continue;
    if (prev.withdrawn.length === 0) continue;
    teachers.push({
      id,
      name: nameOf.get(id) ?? "이름 없는 직원",
      subjects: [],
      classNames: [],
      students: [],
      months: months.map(() => ({ target: 0, self: 0, other: 0, none: 0 })),
      prev,
    });
  }
  return { today, months, prevMonth, teachers, retired };
}
