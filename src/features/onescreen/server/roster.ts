import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { fetchInChunks } from "@/lib/supabase/batch";
import type { OneScreenStudent } from "../types";

/**
 * 선생님 원스크린 — 실데이터 로더(데모 스냅샷 대체).
 *
 * 강사 **본인의** 오늘 담당 반·학생만 조회한다(강사 스코프 = 다른 강사 데이터 누수 없음).
 * 진도/테스트/태도/보고서 값은 빈 상태로 시작 → 강사가 입력(데모 UI 흐름 동일).
 * 오늘(현재 요일) 수업이 있는 반의 학생을 보여주고, 오늘 수업이 없으면(주말 등) 전체 담당 반으로 폴백.
 */

const DOW_KEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const; // Date.getDay()
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 오늘 수업(반) 한 줄 — 원스크린 '오늘 일정' 위젯용 */
export type TodayClass = {
  id: string;
  name: string;
  subject: string;
  startTime: string | null; // "16:20"
  studentCount: number;
};

export type TeacherRoster = {
  today: string; // "2026년 6월 20일 (금)"
  classTags: string[]; // ["전체", ...현재 로스터에 있는 학년]
  teacherName: string;
  students: OneScreenStudent[];
  todayClasses: TodayClass[]; // 오늘(또는 폴백 전체) 담당 반 — 시작시각순
};

function emptyRoster(today: string, teacherName: string): TeacherRoster {
  return { today, classTags: ["전체"], teacherName, students: [], todayClasses: [] };
}

export async function getTeacherRoster(): Promise<TeacherRoster> {
  const now = new Date();
  const today = `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${DOW_KO[now.getDay()]})`;
  const dow = DOW_KEY[now.getDay()];

  const user = await getCurrentUser();
  if (!user) return emptyRoster(today, "");
  const teacherName = user.displayName ?? "";

  const supabase = await createClient();
  const settings = await getTenantSettings();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const gradeOrder = settings.operations.gradeLevels;

  // 1) 강사 담당 활성 반
  const { data: classes } = await supabase
    .from("classes")
    .select("id, class_name, subject")
    .eq("teacher_id", user.id)
    .eq("is_active", true);
  const allClasses = classes ?? [];
  if (allClasses.length === 0) return emptyRoster(today, teacherName);

  // 2) 오늘 요일에 수업 있는 반(없으면 전체 담당 반 폴백 — 주말/휴일에도 화면이 비지 않게)
  const allIds = allClasses.map((c) => c.id);
  const scheds = await fetchInChunks<{ class_id: string; start_time: string | null }>(allIds, (chunk) =>
    supabase
      .from("class_schedules")
      .select("class_id, start_time")
      .eq("day_of_week", dow)
      .in("class_id", chunk),
  );
  const todayIds = new Set(scheds.map((s) => s.class_id));
  // 반별 오늘 최초 시작시각(HH:MM)
  const startByClass = new Map<string, string | null>();
  for (const s of scheds) {
    const t = s.start_time ? String(s.start_time).slice(0, 5) : null;
    const prev = startByClass.get(s.class_id);
    if (prev === undefined) startByClass.set(s.class_id, t);
    else if (t && (prev === null || t < prev)) startByClass.set(s.class_id, t);
  }
  const activeClasses = todayIds.size > 0 ? allClasses.filter((c) => todayIds.has(c.id)) : allClasses;
  const classById = new Map(activeClasses.map((c) => [c.id, c]));
  const activeIds = activeClasses.map((c) => c.id);

  // 3) 활성 수강생(end_date null)
  const enrollments = await fetchInChunks<{ student_id: string; class_id: string }>(activeIds, (chunk) =>
    supabase.from("enrollments").select("student_id, class_id").is("end_date", null).in("class_id", chunk),
  );
  const studentIds = [...new Set(enrollments.map((e) => e.student_id))];
  if (studentIds.length === 0) return emptyRoster(today, teacherName);

  // 4) 학생 기본 정보
  const studentRows = await fetchInChunks<{ id: string; name: string; grade: string | null }>(
    studentIds,
    (chunk) => supabase.from("students").select("id, name, grade").in("id", chunk),
  );
  const studById = new Map(studentRows.map((s) => [s.id, s]));

  // 5) 학생별 OneScreenStudent — 과목 = 그 학생이 듣는 (강사 담당) 반의 과목들
  const byStudent = new Map<string, OneScreenStudent>();
  for (const e of enrollments) {
    const stu = studById.get(e.student_id);
    const cls = classById.get(e.class_id);
    if (!stu || !cls) continue;
    const grade = stu.grade ?? "";
    let os = byStudent.get(stu.id);
    if (!os) {
      os = {
        id: stu.id,
        name: stu.name,
        grade,
        tag: cls.class_name, // 반별 필터(반 이름 기준)
        className: cls.class_name,
        classId: cls.id,
        attendance: "출석",
        subjects: [],
        tests: {
          daily: { score: null, max: 20, prevScore: null },
          check: { score: null, max: 20, prevScore: null },
        },
        attitude: null,
        homework: "—",
        progressConfirmed: false,
        reportDraft: "",
        reportSent: false,
      };
      byStudent.set(stu.id, os);
    }
    if (!os.subjects.some((su) => su.subjectKey === cls.subject)) {
      os.subjects.push({ name: subjects.labelOf(cls.subject), subjectKey: cls.subject, prev: "", today: "" });
    }
  }

  const gradeRank = (g: string) => {
    const i = gradeOrder.indexOf(g);
    return i === -1 ? 999 : i;
  };
  // 오늘 수업(반) 위젯 + 반별 필터/그룹 — 반별 학생수 + 시작시각, 시각순.
  const countByClass = new Map<string, number>();
  for (const e of enrollments) countByClass.set(e.class_id, (countByClass.get(e.class_id) ?? 0) + 1);
  const todayClasses: TodayClass[] = activeClasses
    .map((c) => ({
      id: c.id,
      name: c.class_name,
      subject: subjects.labelOf(c.subject),
      startTime: startByClass.get(c.id) ?? null,
      studentCount: countByClass.get(c.id) ?? 0,
    }))
    .filter((c) => c.studentCount > 0)
    .sort((a, b) => (a.startTime ?? "99:99").localeCompare(b.startTime ?? "99:99"));

  // 학생 정렬: 반(시각순) → 그 안에서 학년 → 이름. 좌측 목록이 반별로 묶이도록.
  const classRank = new Map(todayClasses.map((c, i) => [c.name, i]));
  const students = [...byStudent.values()].sort(
    (a, b) =>
      (classRank.get(a.className ?? "") ?? 999) - (classRank.get(b.className ?? "") ?? 999) ||
      gradeRank(a.grade) - gradeRank(b.grade) ||
      a.name.localeCompare(b.name, "ko"),
  );

  // 반별 필터 칩 = 전체 + 오늘 담당 반(시각순).
  const classTags = ["전체", ...todayClasses.map((c) => c.name)];

  return { today, classTags, teacherName, students, todayClasses };
}
