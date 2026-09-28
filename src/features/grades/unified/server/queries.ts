import "server-only";

import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { testScoresOf } from "@/features/math-sheets/lib/test-score";
import { isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import { gradeTeacherClassIds } from "@/features/grades/server/teacher-classes";
import { gradeNoExamReady, gradesSchemaReady } from "@/features/grades/server/write";
import { classOrder, type UnifiedClass, type UnifiedRecord } from "../model";
import { consultationDateFor, linkedConsultationDates, type LinkedConsultation } from "./consultation-link";
import { gradeKind, isoDaysBefore, numberOrNull } from "./normalize";

type RawClass = { id: string; class_name: string; subject: string; teacher_id: string | null };
type RawEnrollment = { id: string; student_id: string; class_id: string; start_date: string; end_date: string | null; attendance_days: string[] | null; is_transferred: boolean | null };
type RawGrade = { id: string; student_id: string; exam_name: string; no_exam?: boolean | null; exam_slot?: string | null; school_year?: number | null; term?: number | null; subject: string; score: string | null; max_score: string | null; taken_on: string };
type RawReport = { id: string; student_id: string; class_id: string | null; subject: string | null; report_date: string; daily_test: string | null; check_test: string | null; exam_info: string | null };
type RawLevel = { id: string; student_id: string; test_type: string; subject: string; tested_on: string; level: string | null; subscores: Record<string, number> | null };
type RawStudent = { id: string; name: string; school: string | null; grade: string | null };
type RawSchedule = { id: string; class_id: string; day_of_week: string; valid_from: string; valid_to: string | null };

export type UnifiedStudent = { id: string; name: string; school: string | null; grade: string | null };
export type UnifiedData = {
  records: UnifiedRecord[];
  students: UnifiedStudent[];
  classes: UnifiedClass[];
  subjects: string[];
  studentClasses: Record<string, UnifiedClass[]>;
};

const EMPTY: UnifiedData = { records: [], students: [], classes: [], subjects: [], studentClasses: {} };

/**
 * 통합 성적 기록 — 성적 입력(student_grades) + 수업보고서 일일·확인테스트 + 레벨테스트를 한 모양으로.
 * `studentId`를 주면 **그 학생만** 읽는다(학생 상세 성적 탭·개요 — 통합 성적관리와 같은 기록·같은 계산이 되게).
 */
export async function getUnifiedGrades(from: string, to: string, opts: { studentId?: string } = {}): Promise<UnifiedData> {
  const user = await getCurrentUser();
  if (!user) return EMPTY;
  const supabase = await createClient();
  const [scope, schemaReady, noExamReady, classRows] = await Promise.all([
    effectiveTeacherScope(),
    gradesSchemaReady(),
    gradeNoExamReady(),
    fetchAllPaged<RawClass>((start, end) => supabase.from("classes")
      .select("id, class_name, subject, teacher_id").eq("tenant_id", user.tenantId).order("id").range(start, end)),
  ]);
  const teacherId = scope ? await effectiveTeacherId() : null;
  const myClassIds = new Set(teacherId ? await gradeTeacherClassIds(teacherId) : []);
  const visibleClasses = scope ? classRows.filter((row) => myClassIds.has(row.id) && (!scope.subjects || scope.subjects.includes(row.subject))) : classRows;
  const classIds = visibleClasses.map((row) => row.id);
  if (scope && classIds.length === 0) return EMPTY;
  const lookback = isoDaysBefore(from, 180);
  const classAnchor = kstToday();
  // 학생 하나로 좁힐 땐 tenant_id 조건 자리에 student_id를 한 번 더 건다(tenant_id는 따로 이미 걸려 있다).
  const [byCol, byVal] = opts.studentId ? ["student_id", opts.studentId] as const : ["tenant_id", user.tenantId] as const;
  const gradeCols = `id, student_id, exam_name, subject, score, max_score, taken_on${schemaReady ? ", exam_slot, school_year, term" : ""}${noExamReady ? ", no_exam" : ""}`;

  const [enrollments, schedules, gradeRows, reports, levels] = await Promise.all([
    fetchAllPagedInChunks<RawEnrollment>(classIds, (chunk, start, end) => supabase.from("enrollments")
      .select("id, student_id, class_id, start_date, end_date, attendance_days, is_transferred")
      .eq("tenant_id", user.tenantId).eq(byCol, byVal).in("class_id", chunk).lte("start_date", classAnchor)
      .or(`end_date.is.null,end_date.gte.${lookback}`).order("id").range(start, end)),
    fetchAllPagedInChunks<RawSchedule>(classIds, (chunk, start, end) => supabase.from("class_schedules")
      .select("id, class_id, day_of_week, valid_from, valid_to")
      .eq("tenant_id", user.tenantId).in("class_id", chunk).lte("valid_from", classAnchor)
      .or(`valid_to.is.null,valid_to.gte.${lookback}`).order("id").range(start, end)),
    fetchAllPaged<RawGrade>((start, end) => supabase.from("student_grades")
      .select(gradeCols).eq("tenant_id", user.tenantId).eq(byCol, byVal).lte("taken_on", to)
      .order("id").range(start, end) as unknown as PromiseLike<{ data: RawGrade[] | null; error: { message: string } | null }>),
    fetchAllPaged<RawReport>((start, end) => supabase.from("lesson_reports")
      .select("id, student_id, class_id, subject, report_date, daily_test, check_test, exam_info")
      .eq("tenant_id", user.tenantId).eq(byCol, byVal).gte("report_date", lookback).lte("report_date", to)
      .order("id").range(start, end)),
    fetchAllPaged<RawLevel>((start, end) => supabase.from("level_tests")
      .select("id, student_id, test_type, subject, tested_on, level, subscores")
      .eq("tenant_id", user.tenantId).eq(byCol, byVal).gte("tested_on", lookback).lte("tested_on", to)
      .order("id").range(start, end)),
  ]);

  const visibleStudents = new Set(enrollments.map((row) => row.student_id));
  const allStudentIds = [...new Set([
    ...enrollments.map((row) => row.student_id),
    ...gradeRows.map((row) => row.student_id),
    ...reports.map((row) => row.student_id),
    ...levels.map((row) => row.student_id),
  ].filter((id) => !scope || visibleStudents.has(id)))];
  const teacherIds = [...new Set(visibleClasses.map((row) => row.teacher_id).filter((id): id is string => !!id))];
  const [students, consultations, teachers] = await Promise.all([
    fetchInChunks<RawStudent>(allStudentIds, (chunk) => supabase.from("students")
      .select("id, name, school, grade").eq("tenant_id", user.tenantId).in("id", chunk)),
    fetchAllPagedInChunks<LinkedConsultation>(allStudentIds, (chunk, start, end) => supabase.from("student_consultations")
      .select("student_id, subject, category, consulted_at, summary").eq("tenant_id", user.tenantId)
      .in("student_id", chunk).eq("category", "academic").ilike("summary", "%[EYWA-UNIFIED:%")
      .order("id").range(start, end)),
    fetchInChunks<{ id: string; display_name: string | null }>(teacherIds, (chunk) => supabase.from("users")
      .select("id, display_name").eq("tenant_id", user.tenantId).in("id", chunk)),
  ]);

  const studentById = new Map(students.map((row) => [row.id, row]));
  const teacherById = new Map(teachers.map((row) => [row.id, row.display_name]));
  const schedulesByClass = new Map<string, Set<string>>();
  for (const row of schedules) {
    if (row.valid_from > classAnchor || (row.valid_to && row.valid_to < classAnchor)) continue;
    const days = schedulesByClass.get(row.class_id) ?? new Set<string>();
    days.add(row.day_of_week);
    schedulesByClass.set(row.class_id, days);
  }
  const classById = new Map(visibleClasses.map((row) => [row.id, {
    id: row.id,
    name: row.class_name,
    teacher: row.teacher_id ? teacherById.get(row.teacher_id) ?? null : null,
    days: schedulesByClass.get(row.id)?.size ?? 0,
  } satisfies UnifiedClass]));
  const rawClassById = new Map(visibleClasses.map((row) => [row.id, row]));
  const allClassById = new Map(classRows.map((row) => [row.id, row]));
  const enrollmentsByStudent = new Map<string, RawEnrollment[]>();
  for (const row of enrollments) enrollmentsByStudent.set(row.student_id, [...(enrollmentsByStudent.get(row.student_id) ?? []), row]);
  const classesFor = (studentId: string, subject: string, date: string): UnifiedClass[] => {
    const candidates = (enrollmentsByStudent.get(studentId) ?? [])
      .filter((row) => isEnrollmentOnRosterOn({
        startDate: row.start_date, endDate: row.end_date, isTransferred: row.is_transferred ?? false,
      }, date))
      .map((row) => {
        const cls = classById.get(row.class_id);
        const raw = rawClassById.get(row.class_id);
        return cls && raw?.subject === subject ? { ...cls, days: row.attendance_days?.length || cls.days } : null;
      }).filter((item): item is UnifiedClass => !!item);
    return classOrder(candidates);
  };
  const subjectOnDate = (studentId: string, date: string): string | null => {
    const subjects = new Set(
      (enrollmentsByStudent.get(studentId) ?? [])
        .filter((row) => isEnrollmentOnRosterOn({ startDate: row.start_date, endDate: row.end_date, isTransferred: row.is_transferred ?? false }, date))
        .map((row) => rawClassById.get(row.class_id)?.subject)
        .filter((s): s is string => !!s),
    );
    return subjects.size === 1 ? [...subjects][0]! : null;
  };
  const linkedConsultDates = linkedConsultationDates(consultations);
  const base = (studentId: string, subject: string, date: string) => {
    const student = studentById.get(studentId);
    if (!student || (scope?.subjects && !scope.subjects.includes(subject))) return null;
    const latestClasses = classesFor(studentId, subject, classAnchor);
    const historicalClasses = classesFor(studentId, subject, date);
    return {
      studentId,
      name: student.name,
      school: student.school,
      grade: student.grade,
      subject,
      date,
      classes: latestClasses.length ? latestClasses : historicalClasses,
      trendClasses: historicalClasses,
      consultationDate: null,
      manualConsultationDate: null,
      editHref: `/students/${studentId}?tab=grades`,
    };
  };
  const records: UnifiedRecord[] = [];
  for (const row of gradeRows) {
    const context = base(row.student_id, row.subject, row.taken_on);
    if (!context) continue;
    const kind = gradeKind(row.exam_slot, row.exam_name);
    const key = `grade:${row.id}`;
    records.push({ ...context, key, source: "grade", sourceId: row.id, kind,
      score: numberOrNull(row.score), maxScore: numberOrNull(row.max_score), rawScore: null,
      consultationDate: consultationDateFor(linkedConsultDates, row.student_id, row.subject, key),
      slot: row.exam_slot ?? undefined, schoolYear: row.school_year ?? undefined, term: row.term ?? undefined,
      noExam: row.no_exam === true,
      editHref: `/exams/input?year=${row.school_year ?? ""}&term=${row.term ?? ""}&subject=${encodeURIComponent(row.subject)}&slot=${row.exam_slot ?? ""}&date=${row.taken_on}`,
    });
  }
  for (const report of reports) {
    // 과목이 빈 옛 보고서(0083a 이전) — 반이 있으면 그 반의 과목(**전체 반**에서 찾는다: 보이는 반만 보면 남의 반 점수가
    // 추정 과목으로 새어 든다. 범위 거르기는 `base`의 scope.subjects가 한다). 반도 없으면 그날 다니던 과목이 하나로
    // 좁혀질 때만 그 과목 — 강사 범위에선 수강을 제 반만 읽어 좁혀진 것이 사실이 아닐 수 있으니 추정하지 않는다.
    // 끝내 모르면 숨긴다(원장 2026-09-28 "과목 unknown으로 뜨는거 숨김처리" — 예전엔 원문 'unknown'이 과목 칸에 섰다).
    const subject = report.subject
      || (report.class_id ? allClassById.get(report.class_id)?.subject : scope ? null : subjectOnDate(report.student_id, report.report_date));
    if (!subject) continue;
    const found = base(report.student_id, subject, report.report_date);
    if (!found) continue;
    // 일일·확인테스트는 **그 수업보고서의 반**에서 친 시험이다(원장 2026-09-24) — 다니는 반 전부가 아니라 그 반 하나·그 반 담임으로.
    // 반을 못 찾으면(보강 반·강사 범위 밖·반 없음) 종전대로 학생의 반 목록.
    const reportClass = report.class_id ? classById.get(report.class_id) : undefined;
    const context = reportClass ? { ...found, classes: [reportClass], trendClasses: [reportClass] } : found;
    for (const test of testScoresOf({ dailyTest: report.daily_test, checkTest: report.check_test, examInfo: report.exam_info })) {
      const kind = test.kind === "legacy" ? "other" : test.kind;
      const key = `report:${report.id}:${test.kind}`;
      records.push({ ...context, key, source: "report", sourceId: report.id,
        kind, score: test.correct, maxScore: test.total,
        rawScore: test.raw, consultationDate: consultationDateFor(linkedConsultDates, report.student_id, subject, key),
        editHref: `/lesson-reports?tab=list`,
      });
    }
  }
  for (const level of levels) {
    const context = base(level.student_id, level.subject, level.tested_on);
    if (!context) continue;
    const score = numberOrNull(level.subscores?.["총점"]);
    const maxScore = numberOrNull(level.subscores?.["만점"]);
    const key = `level:${level.id}`;
    records.push({ ...context, key, source: "level", sourceId: level.id,
      kind: level.test_type === "placement" ? "admission" : "other",
      score, maxScore, consultationDate: consultationDateFor(linkedConsultDates, level.student_id, level.subject, key),
      rawScore: [level.level, ...Object.entries(level.subscores ?? {}).filter(([name]) => name !== "총점" && name !== "만점").map(([name, value]) => `${name} ${value}`)].filter(Boolean).join(" · ") || null,
    });
  }
  const studentClasses: Record<string, UnifiedClass[]> = {};
  for (const studentId of allStudentIds) {
    for (const subject of new Set(visibleClasses.map((row) => row.subject))) {
      studentClasses[`${studentId}|${subject}`] = classesFor(studentId, subject, classAnchor);
    }
  }
  return {
    records, students: students.sort((a, b) => a.name.localeCompare(b.name, "ko")), classes: classOrder([...classById.values()]),
    subjects: [...new Set(visibleClasses.map((row) => row.subject))],
    studentClasses,
  };
}
