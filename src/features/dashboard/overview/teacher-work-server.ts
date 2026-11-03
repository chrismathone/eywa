import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstMinutesOfDay, shiftMonth } from "@/lib/date-kst";
import type { TeacherScope } from "@/lib/auth/teacher-scope";
import type { TenantSettings } from "@/features/owner/settings-types";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/enrollment/program";
import { teacherWork, withTeacherWorkExtras, type WorkClass, type WorkReport } from "./teacher-work";
import { pickCounselMonth } from "./counsel-period";
import { dowOf, sessionDates } from "@/features/report-admin/english-writing";
import { judgeUnreadReport, UNREAD_GRACE_HOURS } from "@/features/report-admin/unread-filter";
import { UNREAD_WINDOW_DAYS } from "@/features/dashboard/onescreen/server/queries";
import { judgeClassAttendanceDay } from "../unrecorded-attendance";
import { isTestClass, reportWorkObligations, resolveUnclassifiedReports, type WorkAttendance, type WorkEnrollment, type WorkSchedule } from "./work-targets";
import { isReportTrackedSubject } from "../report-subjects";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import { listExtraIssues } from "@/features/video-homework/server/extra-issues";
import { isModuleEnabled } from "@/lib/modules";
import { isLaboratoryMenuAvailable } from "@/lib/laboratory/server";

/** RLS 반 범위에서 현재 담당 반의 업무를 집계한다. 관리자 조회도 테넌트·허용 반으로 제한한다. */
export async function loadTeacherWork(
  tenantId: string,
  today: string,
  scope: TeacherScope | null,
  settings: TenantSettings,
  /** 강사 열을 무엇으로 가를지 — 없으면 반의 과목 그대로. '대시보드 전환' 카드는 영어를 EiE · 인재원 영어로 가른다. */
  subjectKeyOf?: (subject: string | null, englishTrack: string | null) => string | null,
) {
  const columnOf = (c: { subject: string; english_track: string | null }) => subjectKeyOf?.(c.subject, c.english_track) ?? c.subject;
  const db = await createClient();
  // 영상 숙제도 보고서와 같은 최근 7일(원장 2026-10-19 *"최근 7일과 맞도록 하단 표 확인"*) — 종전 30일. 학부모 미확인만 30일(학습·학부모 보고 카드와 같은 판정).
  const range = { reportFrom: addDays(today, -6), videoFrom: addDays(today, -6), to: today };
  // 출결 미입력 = **어제까지 7일**(오늘 진행 중인 수업은 거짓 경보다 — 운영실 '어제 출결 미입력'과 같은 축). 시간표·수강·출결 조회는 이 창까지 넓힌다.
  const attendanceFrom = addDays(today, -7);
  const attendanceTo = addDays(today, -1);
  // 학부모 미확인 = 학습·학부모 보고 카드(`getUnreadReports`)와 같은 창(수업일 30일)·같은 유예(48시간). 보고서 조회 창은 둘 중 이른 쪽.
  const unreadFrom = addDays(today, -(UNREAD_WINDOW_DAYS - 1));
  const reportFetchFrom = unreadFrom < range.videoFrom ? unreadFrom : range.videoFrom;
  // 반 = 출결용(운영실 신호와 같은 범위 — 보고서 미발송 반 · 창 안에 닫힌 반 포함) ⊇ 열·보고서용(보고서 받는 반 · 오늘 열린 반).
  const classes = await fetchAllPaged<{ id: string; class_name: string; subject: string; english_track: string | null; teacher_id: string | null; report_optout: boolean | null; closed_at: string | null }>((from, to) =>
    db.from("classes").select("id,class_name,subject,english_track,teacher_id,report_optout,closed_at").eq("tenant_id", tenantId).eq("is_active", true)
      .or(`closed_at.is.null,closed_at.gte.${attendanceFrom}`).order("id").range(from, to));
  const inScope = classes.filter((c) => !isTestClass(c.class_name) && (!scope || scope.classIds.includes(c.id)));
  const visible = inScope.filter((c) => c.report_optout !== true && (!c.closed_at || c.closed_at >= today));
  const classIds = visible.map((c) => c.id);
  const scopedIds = inScope.map((c) => c.id);
  // 기능이 꺼진 지점엔 그 줄이 흔적 없이 빠진다 — 발송·읽음은 ClassNote, 원생상담은 직원 평가(포트폴리오 집계 cron과 같은 두 판정).
  const deliveryShown = classnoteModuleOn(settings);
  // 실험실 판정은 다른 조회와 나란히 돈다(B4) — 원생상담 조회만 그 결과를 기다린다.
  const counselShownP: Promise<boolean> = isModuleEnabled(settings.modules.disabled, "class_review")
    ? isLaboratoryMenuAvailable(tenantId, "class_review").catch(() => false) : Promise.resolve(false);
  // 반이 없어도 표시 여부는 싣는다 — 안 실으면 카드가 꺼진 기능의 안내 문장을 낼 수 있다(리뷰 2026-10-15).
  if (!classIds.length) return withTeacherWorkExtras(teacherWork([], [], [], range, []), { unread: [], attendance: [], counsel: new Map(),
    attendanceFrom, attendanceTo, unreadFrom, counselAsOf: null, counselMonth: null, deliveryShown, counselShown: await counselShownP });
  const admin = createAdminClient();
  const [teachers, reports, outcomes, schedules, enrollments, attendance, posts, unclassified, extraIssues, counselRows] = await Promise.all([
    fetchInChunks<{ id: string; display_name: string; status: string | null }>([...new Set(visible.flatMap((c) => c.teacher_id ? [c.teacher_id] : []))], (chunk) =>
      db.from("users").select("id,display_name,status").eq("tenant_id", tenantId).in("id", chunk)),
    fetchAllPagedInChunks<{ id: string; class_id: string; student_id: string; report_date: string; covers_date: string | null; classnote_status: string | null; video_homework: boolean;
      classnote_read_at: string | null; classnote_sent_at: string | null; edutrix_share_token: string | null; source: string | null;
      student: { grade: string | null } | { grade: string | null }[] }>(classIds, (chunk, from, to) =>
      db.from("lesson_reports").select("id,class_id,student_id,report_date,covers_date,classnote_status,video_homework,classnote_read_at,classnote_sent_at,edutrix_share_token,source,student:students!inner(is_test,grade)")
        .eq("tenant_id", tenantId).eq("student.is_test", false).in("class_id", chunk).lte("report_date", today)
        .or(`report_date.gte.${reportFetchFrom},covers_date.gte.${range.reportFrom}`)
        .order("created_at", { ascending: false }).order("id").range(from, to)),
    fetchAllPagedInChunks<{ class_id: string; student_id: string; homework_date: string; status: string; observed_at: string }>(classIds, (chunk, from, to) =>
      admin.from("video_homework_auto_outcomes").select("class_id,student_id,homework_date,status,observed_at").eq("tenant_id", tenantId)
        .in("class_id", chunk).gte("homework_date", range.videoFrom).lte("homework_date", today).order("class_id").order("student_id").order("homework_date").range(from, to)),
    fetchAllPagedInChunks<WorkSchedule>(scopedIds, (chunk, from, to) =>
      db.from("class_schedules").select("class_id,day_of_week,start_time,valid_from,valid_to").eq("tenant_id", tenantId).in("class_id", chunk)
        .or(`valid_from.is.null,valid_from.lte.${today}`).or(`valid_to.is.null,valid_to.gte.${attendanceFrom}`).order("id").range(from, to)),
    fetchAllPagedInChunks<WorkEnrollment>(scopedIds, (chunk, from, to) =>
      db.from("enrollments").select("class_id,student_id,start_date,end_date,on_hold,is_transferred,attendance_days,student:students!inner(is_test)")
        .eq("tenant_id", tenantId).eq("student.is_test", false).in("class_id", chunk)
        .or(`start_date.is.null,start_date.lte.${today}`).or(`end_date.is.null,end_date.gte.${attendanceFrom}`).order("id").range(from, to)),
    fetchAllPagedInChunks<WorkAttendance>(scopedIds, (chunk, from, to) =>
      db.from("attendance_records").select("id,student_id,class_id,session_date,slot_start,status,recorded_at")
        .eq("tenant_id", tenantId).in("class_id", chunk).gte("session_date", attendanceFrom).lte("session_date", today).order("id").range(from, to)),
    classnoteModuleOn(settings) ? fetchAllPaged<{ board_name: string; posted_on: string }>((from, to) =>
      db.from("classnote_class_posts").select("board_name,posted_on").eq("tenant_id", tenantId)
        .gte("posted_on", range.reportFrom).lte("posted_on", today).order("board_name").order("posted_on").range(from, to)) : Promise.resolve([]),
    fetchAllPaged<{ id: string; student_id: string; report_date: string; covers_date: string | null; subject: string | null; teacher_name: string | null; classnote_status: string | null }>((from, to) =>
      db.from("lesson_reports").select("id,student_id,report_date,covers_date,subject,teacher_name,classnote_status,student:students!inner(is_test)")
        .eq("tenant_id", tenantId).eq("student.is_test", false).is("class_id", null).lte("report_date", today)
        .or(`report_date.gte.${range.reportFrom},covers_date.gte.${range.reportFrom}`)
        .order("created_at", { ascending: false }).order("id").range(from, to)),
    // 보고서 없이 따로 낸 영상 숙제(원장 2026-10-13) — 장부와 같은 숙제 축. 못 읽으면 보고서 쪽 숫자만 낸다(카드가 죽지 않게).
    listExtraIssues(admin, tenantId, { fromDate: range.videoFrom, toDate: today }).catch(() => []),
    // 원생상담 비율 — 직원 포트폴리오가 매일 저장하는 그 달 수치(`raws.counsel`, %) 그대로(같은 원본 · 다시 셈하지 않는다).
    // 원장 2026-10-15 결정으로 이 카드를 보는 관리자에게 이 한 수치만 연다(포트폴리오 본문·점수는 그대로 원장 역할만).
    // 큰 본문(payload)은 안 읽는다(30초마다 다시 돈다). 표·칸이 없거나 못 읽으면 칸만 '—'(카드가 죽지 않게).
    // 집계는 어제까지라 1일엔 이번 달 줄이 아직 없다 — 지난달 줄도 함께 읽어 고른다(`pickCounselMonth` · 강사 수 × 2줄).
    counselShownP.then((on) => !on ? [] : Promise.resolve(admin.from("teacher_portfolio_months").select("teacher_id,month,period_end,counsel:raws->counsel").eq("tenant_id", tenantId).in("month", [today.slice(0, 7), shiftMonth(today.slice(0, 7), -1)]))
      .then(({ data, error }) => (error ? [] : (data ?? []) as { teacher_id: string; month: string; period_end: string | null; counsel: number | null }[]))
      .catch(() => [])),
  ]);
  // 따로 낸 숙제의 학생 — 학년(학교급 제외 설정)·테스트 여부는 학생 표에서 읽는다(보고서가 없는 학생도 있다 · 장부와 같은 판정).
  // 못 읽으면 따로 낸 숙제를 빼고 보고서 쪽 숫자만 낸다.
  const extraStudents = await fetchInChunks<{ id: string; grade: string | null; is_test: boolean }>([...new Set(extraIssues.map((x) => x.studentId))],
    (chunk) => admin.from("students").select("id,grade,is_test").eq("tenant_id", tenantId).in("id", chunk)).catch(() => null);
  const extraStudentOf = new Map((extraStudents ?? []).map((s) => [s.id, s]));
  const names = new Map(teachers.map((t) => [t.id, t.display_name]));
  const subjects = new Map(visible.map((c) => [c.id, c.subject]));
  const programs = programSubjectsOf(Object.fromEntries(settings.operations.subjects.map((s) => [s.key, s.label])));
  // 퇴사한 선생님(직원 상태 '퇴사' = inactive)은 열로 세우지 않는다(원장 2026-10-19 *"퇴사한 선생님은 노출되지 않도록"*) —
  // 반에 담임이 아직 그 사람으로 남아 있어도 그 반은 이 카드에서 빠진다(담임을 바꾸면 새 담임 열로 선다).
  const retired = new Set(teachers.filter((t) => t.status === "inactive").map((t) => t.id));
  const workClasses: WorkClass[] = visible.filter((c) => !c.teacher_id || !retired.has(c.teacher_id)).map((c) => {
    const teacherName = c.teacher_id ? names.get(c.teacher_id) ?? "이름 확인 필요" : "담당 미지정";
    const english = subjectGroupOf(c.subject, programs) === "english";
    return { id: c.id, name: c.class_name, teacherId: c.teacher_id, teacherName, subject: columnOf(c),
      reportSource: settings.report.writingExemptTeachers.includes(teacherName) ? "none" : english && classnoteModuleOn(settings) ? "classnote"
        : !english && isReportTrackedSubject(c.subject, settings.report.classnoteSubjects) ? "lesson" : "none" };
  });
  const workReports: WorkReport[] = reports.map((r) => ({ id: r.id, classId: r.class_id, studentId: r.student_id, date: r.report_date,
    coversDate: r.covers_date, status: r.classnote_status,
    videoHomework: r.video_homework === true && isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, {
      classId: r.class_id, subjectKey: subjects.get(r.class_id) ?? "", grade: (Array.isArray(r.student) ? r.student[0] : r.student)?.grade ?? null }) }));
  workReports.push(...resolveUnclassifiedReports(unclassified.map((r) => ({ id: r.id, studentId: r.student_id, date: r.report_date,
    coversDate: r.covers_date, subject: r.subject, teacherName: r.teacher_name, status: r.classnote_status, videoHomework: false })), workClasses, enrollments, schedules));
  const obligations = reportWorkObligations({ classes: workClasses, reports: workReports, schedules, enrollments, attendance,
    posts: posts.map((p) => ({ boardName: p.board_name, postedOn: p.posted_on })), from: range.reportFrom, to: today,
    nowMinutes: kstMinutesOfDay(), holidays: settings.operations.holidays.map((h) => h.date) });
  const work = teacherWork(workClasses, workReports, outcomes.map((r) => ({ classId: r.class_id, studentId: r.student_id,
    date: r.homework_date, status: r.status, observedAt: r.observed_at })), range, obligations,
    // 옮겨 남긴 숙제(kept)는 선생님이 낸 숙제가 아니라 셀 일이 아니다(extra-issues.ts).
    extraIssues.filter((x) => { const student = extraStudentOf.get(x.studentId); return !x.kept && !!student && !student.is_test
      && isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, { classId: x.classId, subjectKey: subjects.get(x.classId) ?? "", grade: student.grade }); }));
  // 학부모 미확인 — 반에 붙은 이 창(30일) 보고서만(반 없는 옛 기록은 강사 열에 못 놓는다). 판정 = 보고서 목록 '안읽음'과 같은 함수.
  const cutoffMs = Date.now() - UNREAD_GRACE_HOURS * 3_600_000;
  const unread = reports.filter((r) => r.report_date >= unreadFrom).map((r) => ({ classId: r.class_id, ...judgeUnreadReport(r, cutoffMs) }));
  // 출결 미입력 — 수업이 있던 반×날(그 요일 시간표 · 휴원일 제외)마다 운영실 신호와 같은 판정. 명단이 빈 날은 대상이 아니다.
  const enrollmentsOf = new Map<string, typeof enrollments>();
  for (const e of enrollments) enrollmentsOf.set(e.class_id, [...(enrollmentsOf.get(e.class_id) ?? []), e]);
  const recordedOf = new Map<string, Set<string>>();
  for (const a of attendance) {
    const key = `${a.class_id}|${a.session_date}`;
    recordedOf.set(key, (recordedOf.get(key) ?? new Set<string>()).add(a.student_id));
  }
  const attendanceDays = sessionDates(attendanceFrom, attendanceTo, new Set(settings.operations.holidays.map((h) => h.date))).flatMap((date) =>
    inScope.flatMap((c) => {
      // 그날 닫힌 반까지는 센다(신호: 닫힌 날 < 그날이면 뺀다).
      if (c.closed_at && c.closed_at < date) return [];
      const meets = schedules.some((s) => s.class_id === c.id && s.day_of_week === dowOf(date) && !!s.valid_from && s.valid_from <= date && (!s.valid_to || s.valid_to >= date));
      if (!meets) return [];
      const judged = judgeClassAttendanceDay({ enrollments: enrollmentsOf.get(c.id) ?? [], recorded: recordedOf.get(`${c.id}|${date}`) ?? new Set(), date, dayKey: dowOf(date) });
      return judged.expected > 0 ? [{ classId: c.id, teacherId: c.teacher_id, subject: columnOf(c), unrecorded: judged.unrecorded }] : [];
    }));
  const counselShown = await counselShownP;
  const counselPick = pickCounselMonth(counselRows, today.slice(0, 7));
  const counsel = new Map(counselPick.rows.map((r) => [r.teacher_id, typeof r.counsel === "number" ? r.counsel : null] as const));
  const counselAsOf = counselPick.rows.map((r) => r.period_end?.slice(0, 10) ?? "").filter(Boolean).sort().at(-1) ?? null;
  return withTeacherWorkExtras(work, { unread: deliveryShown ? unread : [], attendance: attendanceDays, counsel, attendanceFrom, attendanceTo, unreadFrom, counselAsOf,
    counselMonth: counselPick.month, deliveryShown, counselShown });
}
