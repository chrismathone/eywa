import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { parseExamScores } from "../exam-info";
import { getTextbookOrdersForStudents } from "@/features/billing/server/textbook-queries";
import type { AttendanceMark, OneScreenStudent } from "../types";

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
  allowTeacherTestMax: boolean; // 강사가 테스트 문항수(/N) 직접 변경 허용(report 설정) — 원스크린 입력 UI 분기
  // 일일/확인테스트 사용 여부 = 보고서 '표시 항목' 토글(showDailyTest/showCheckTest) 재사용. off면 원스크린
  // 점수 입력칸을 숨겨(입력 안 함) + 학부모 보고서에도 미표시(parent-report-card). 표시·입력 단일 스위치.
  showDailyTest: boolean;
  showCheckTest: boolean;
  noticeMode: "A" | "B" | null; // 강사 본인의 AI 멘트 모드 오버라이드(null=학원 기본 따름) — 0104a
  academyNoticeMode: "A" | "B"; // 학원 기본 멘트 모드(report.noticeMode) — 토글 '학원 기본' 라벨 표시용
};

type OnescreenSessionRow = {
  student_id: string;
  study_grade: string | null;
  subject_progress: Record<
    string,
    { today?: string; draft?: string; textbook?: string; makeup?: boolean; homeworkToday?: string }
  > | null;
  daily_score: number | null;
  daily_max: number | null;
  check_score: number | null;
  check_max: number | null;
  attitude: string | null;
  homework: string | null;
  special_note: string | null;
  progress_confirmed: boolean | null;
};

function emptyRoster(
  today: string,
  teacherName: string,
  noticeMode: "A" | "B" | null = null,
  academyNoticeMode: "A" | "B" = "A",
): TeacherRoster {
  return {
    today,
    classTags: ["전체"],
    teacherName,
    students: [],
    todayClasses: [],
    allowTeacherTestMax: false,
    showDailyTest: true,
    showCheckTest: true,
    noticeMode,
    academyNoticeMode,
  };
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
  // 과목별 테스트 문항수(만점) — 원스크린 점수 입력 /N 기본값. 미설정 과목은 5.
  const subjectTestMax = new Map(settings.operations.subjects.map((su) => [su.key, su.testMax ?? 5]));
  const allowTeacherTestMax = settings.report.allowTeacherTestMax;
  const { showDailyTest, showCheckTest } = settings.report;
  const academyNoticeMode: "A" | "B" = settings.report.noticeMode ?? "A";

  // 1) 강사 담당 활성 반 + 본인 멘트 모드 오버라이드(독립 조회 → 병렬, B4)
  const [{ data: classes }, { data: meRow }] = await Promise.all([
    supabase.from("classes").select("id, class_name, subject").eq("teacher_id", user.id).eq("is_active", true),
    supabase.from("users").select("report_notice_mode").eq("id", user.id).single(),
  ]);
  const noticeMode = ((meRow?.report_notice_mode as "A" | "B" | null | undefined) ?? null);
  const allClasses = classes ?? [];
  if (allClasses.length === 0) return emptyRoster(today, teacherName, noticeMode, academyNoticeMode);

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
  if (studentIds.length === 0) return emptyRoster(today, teacherName, noticeMode, academyNoticeMode);

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
    // 테스트 만점 = 이 학생 (첫) 과목의 문항수 설정. 세션에 저장된 값이 있으면 아래에서 덮어씀.
    const tmax = subjectTestMax.get(cls.subject) ?? 5;
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
          daily: { score: null, max: tmax, prevScore: null },
          check: { score: null, max: tmax, prevScore: null },
        },
        attitude: null,
        homework: "",
        note: "",
        progressConfirmed: false,
        reportDraft: "",
        reportSent: false,
      };
      byStudent.set(stu.id, os);
    }
    if (!os.subjects.some((su) => su.subjectKey === cls.subject)) {
      os.subjects.push({ name: subjects.labelOf(cls.subject), subjectKey: cls.subject, prev: "", today: "", textbook: "", makeup: false, homeworkToday: "" });
    }
  }

  // 이전 진도/점수(직전 회차) + 오늘 발송 여부 + 오늘 출결을 실데이터로 채운다(하드코딩 초기값 대체).
  // 셋 다 studentIds에만 의존하는 독립 조회 → Promise.all 병렬(B4). 전부 fetchInChunks(B2/B3).
  const todayIso = kstToday();
  const [reportRows, attRows, sessionRows, textbookRows] = await Promise.all([
    fetchInChunks<{
      id: string;
      student_id: string;
      report_date: string;
      progress: string | null;
      exam_info: string | null;
      subject: string | null;
      share_token: string | null;
      classnote_status: string | null;
      revoked_at: string | null;
      attachments: { path: string; name: string }[] | null;
      // 이전 회차 참고행(prevReport)용 — 같은 lesson_reports 행에서 컬럼만 추가(새 쿼리 없음, B2 무위반).
      textbook: string | null;
      homework_today: string | null;
      homework_score: string | null;
      attitude: string | null;
      notes: string | null;
    }>(
      studentIds,
      (chunk) =>
        supabase
          .from("lesson_reports")
          .select(
            "id, student_id, report_date, progress, exam_info, subject, share_token, classnote_status, revoked_at, attachments, textbook, homework_today, homework_score, attitude, notes",
          )
          .in("student_id", chunk)
          .order("report_date", { ascending: false }),
    ),
    fetchInChunks<{ student_id: string; status: string; recorded_at: string }>(
      studentIds,
      (chunk) =>
        supabase
          .from("attendance_records")
          .select("student_id, status, recorded_at")
          .eq("session_date", todayIso)
          .in("student_id", chunk)
          .order("recorded_at", { ascending: false }),
    ),
    // Phase3: 오늘 "작업중" 세션(점수/진도/태도/과제/확정) 복원 — 새로고침에도 유지.
    fetchInChunks<OnescreenSessionRow>(studentIds, (chunk) =>
      supabase
        .from("onescreen_daily_sessions")
        .select(
          "student_id, study_grade, subject_progress, daily_score, daily_max, check_score, check_max, attitude, homework, special_note, progress_confirmed",
        )
        .eq("session_date", todayIso)
        .in("student_id", chunk),
    ),
    // 교재 자동입력 기본값 — 본인 담당 학생의 교재요청서(fetchInChunks, B3). studentIds 독립 → 같은 Promise.all(B4).
    getTextbookOrdersForStudents(studentIds),
  ]);
  const sessionById = new Map(sessionRows.map((r) => [r.student_id, r]));

  // 학생별 대표 교재 — 강사 본인 주문 우선, (requestDate ?? createdAt) 최신, book_name 공란 제외.
  // 교재요청서엔 과목 컬럼이 없어 (학생) 단위 대표 1건을 그 학생의 과목들에 기본값으로 적용(강사가 세션에서 덮어씀).
  const bookByStudent = new Map<string, string>();
  {
    const byStudent = new Map<string, typeof textbookRows>();
    for (const t of textbookRows) {
      if (!t.studentId || !t.bookName?.trim()) continue;
      const arr = byStudent.get(t.studentId) ?? [];
      arr.push(t);
      byStudent.set(t.studentId, arr);
    }
    for (const [sid, arr] of byStudent) {
      const pick = [...arr].sort((a, b) => {
        const at = a.teacherName === teacherName ? 0 : 1;
        const bt = b.teacherName === teacherName ? 0 : 1;
        if (at !== bt) return at - bt; // 강사 본인 주문 먼저
        return (b.requestDate ?? b.createdAt ?? "").localeCompare(a.requestDate ?? a.createdAt ?? ""); // 최신
      })[0];
      if (pick?.bookName?.trim()) bookByStudent.set(sid, pick.bookName.trim());
    }
  }

  // student별: 오늘 저장된 보고서 존재(reportSent) + 오늘 이전 최신 보고서(prev 진도/prevScore).
  // 오늘 보고서는 **과목별**로도 적재(sentToday는 학생단위 폴백, todayBySubject는 과목별 발송상태·공유링크 수명).
  const sentToday = new Set<string>();
  const todayBySubject = new Map<
    string,
    {
      reportId: string;
      shareToken: string | null;
      classnoteStatus: string | null;
      revokedAt: string | null;
      attachments: { path: string; name: string }[];
    }
  >();
  const subjKey = (studentId: string, subject: string | null) => `${studentId}::${subject ?? ""}`;
  type ReportRow = (typeof reportRows)[number];
  const priorReport = new Map<string, { progress: string | null; examInfo: string | null }>();
  // (학생×과목)별 직전 회차 전체 행 — 이전 회차 참고행(prevReport). report_date desc라 (학생,과목) 첫 건이 직전.
  const priorBySubject = new Map<string, ReportRow>();
  const todayReportIds: string[] = [];
  for (const r of reportRows) {
    if (r.report_date === todayIso) {
      sentToday.add(r.student_id);
      // report_date desc 정렬이라 (학생,과목) 첫 건이 오늘 최신 → 뒤 건은 덮지 않음.
      const k = subjKey(r.student_id, r.subject);
      if (!todayBySubject.has(k)) {
        todayBySubject.set(k, {
          reportId: r.id,
          shareToken: r.share_token,
          classnoteStatus: r.classnote_status,
          revokedAt: r.revoked_at,
          attachments: r.attachments ?? [],
        });
        todayReportIds.push(r.id);
      }
    } else {
      if (!priorReport.has(r.student_id))
        priorReport.set(r.student_id, { progress: r.progress, examInfo: r.exam_info });
      const pk = subjKey(r.student_id, r.subject);
      if (!priorBySubject.has(pk)) priorBySubject.set(pk, r); // (학생,과목) 첫(=직전) 회차
    }
  }

  // 오늘 보고서들의 학부모 열람 수(share_link_views) — PostgREST group-by 대신 행을 청크로 가져와 JS 집계(fetchInChunks).
  const viewCountByReport = new Map<string, number>();
  const viewRows = await fetchInChunks<{ lesson_report_id: string }>(todayReportIds, (chunk) =>
    supabase.from("share_link_views").select("lesson_report_id").in("lesson_report_id", chunk),
  );
  for (const v of viewRows)
    viewCountByReport.set(v.lesson_report_id, (viewCountByReport.get(v.lesson_report_id) ?? 0) + 1);
  // student별 오늘 최신 출결 status(recorded_at desc 정렬이라 첫 건이 최신).
  const attById = new Map<string, string>();
  for (const a of attRows) if (!attById.has(a.student_id)) attById.set(a.student_id, a.status);
  const toMark = (status: string | undefined): AttendanceMark =>
    status === "late" ? "지각" : status === "absent" || status === "early_leave" ? "결석" : "출석";

  for (const os of byStudent.values()) {
    os.reportSent = sentToday.has(os.id);
    // 과목별 오늘 발송상태 — report.subject ↔ subject.subjectKey 매칭(학생단위 뭉갬 방지).
    for (const su of os.subjects) {
      const t = todayBySubject.get(subjKey(os.id, su.subjectKey ?? null));
      if (t) {
        su.reportSent = true;
        su.shareToken = t.shareToken ?? undefined;
        su.classnoteStatus = t.classnoteStatus ?? undefined;
        su.revokedAt = t.revokedAt ?? undefined;
        su.viewCount = viewCountByReport.get(t.reportId) ?? 0;
        su.attachments = t.attachments;
      }
    }
    os.attendance = toMark(attById.get(os.id));
    const pr = priorReport.get(os.id);
    if (pr) {
      const { daily, check } = parseExamScores(pr.examInfo);
      os.tests.daily.prevScore = daily;
      os.tests.check.prevScore = check;
      if (pr.progress) {
        // 이전 진도 텍스트("수학 1-1-2 …")를 과목명 접두로 매칭 → 그 과목 prev. 폴백=첫 과목.
        let matched = false;
        for (const su of os.subjects) {
          if (su.name && pr.progress.startsWith(su.name)) {
            su.prev = pr.progress.slice(su.name.length).trim() || pr.progress;
            matched = true;
          }
        }
        if (!matched && os.subjects[0]) os.subjects[0].prev = pr.progress;
      }
    }
    // (학생×과목) 직전 회차 → 참고행(prevReport) + 과목 정확매칭 prev + 교재 자동입력 기본값(②교재요청서 > ③직전교재).
    // ①오늘 입력값(세션)은 아래 sess 블록이 최종으로 덮으므로 항상 우선. su.textbook 초기값은 ""(과목 push).
    const reqBook = bookByStudent.get(os.id);
    for (const su of os.subjects) {
      const pbs = priorBySubject.get(subjKey(os.id, su.subjectKey ?? null));
      if (pbs) {
        const prog =
          pbs.progress && su.name && pbs.progress.startsWith(su.name)
            ? pbs.progress.slice(su.name.length).trim() || pbs.progress
            : pbs.progress;
        su.prevReport = {
          date: pbs.report_date,
          progress: prog ?? null,
          textbook: pbs.textbook ?? null,
          homeworkToday: pbs.homework_today ?? null,
          homeworkScore: pbs.homework_score ?? null,
          attitude: pbs.attitude ?? null,
          examInfo: pbs.exam_info ?? null,
          note: pbs.notes ?? null,
        };
        if (prog) su.prev = prog; // 과목 정확매칭 prev 우선(위 startsWith 학생단위 폴백보다 정확)
      }
      const prevBook = su.prevReport?.textbook?.trim();
      if (prevBook) su.textbook = prevBook; // ③ 직전 교재
      if (reqBook) su.textbook = reqBook; // ② 교재요청서(덮음)
    }
    // Phase3: 오늘 세션(작업중) 복원 — 점수/진도/태도/과제/확정을 하드코딩 기본값 위에 덮어씀.
    const sess = sessionById.get(os.id);
    if (sess) {
      if (sess.study_grade) os.studyGrade = sess.study_grade;
      if (sess.daily_score != null) os.tests.daily.score = sess.daily_score;
      if (sess.daily_max != null) os.tests.daily.max = sess.daily_max;
      if (sess.check_score != null) os.tests.check.score = sess.check_score;
      if (sess.check_max != null) os.tests.check.max = sess.check_max;
      if (sess.attitude != null) os.attitude = sess.attitude;
      if (sess.homework != null) os.homework = sess.homework;
      if (sess.special_note != null) os.note = sess.special_note;
      if (sess.progress_confirmed != null) os.progressConfirmed = sess.progress_confirmed;
      const sp = sess.subject_progress ?? {};
      for (const su of os.subjects) {
        const entry = sp[su.subjectKey || su.name];
        if (entry?.today) su.today = entry.today;
        if (entry?.textbook != null) su.textbook = entry.textbook;
        if (entry?.makeup != null) su.makeup = entry.makeup;
        if (entry?.homeworkToday != null) su.homeworkToday = entry.homeworkToday;
      }
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

  return {
    today,
    classTags,
    teacherName,
    students,
    todayClasses,
    allowTeacherTestMax,
    showDailyTest,
    showCheckTest,
    noticeMode,
    academyNoticeMode,
  };
}
