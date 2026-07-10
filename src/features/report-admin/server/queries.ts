import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { fetchInChunks } from "@/lib/supabase/batch";
import { getTodaySchedule, getTeacherLabelsBySubject } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { needsAttention, summarizeQueue, type QueueSummary } from "../classnote-queue";
import { computeWritingRates, type TeacherRate, type TodayTarget } from "../writing-rate";

/** KST 날짜에서 n일 전(YYYY-MM-DD) — 결정적 UTC 산술(date-kst 규칙). */
function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 작성률 예외 강사 후보 — class_schedules에서 모은 강사 라벨(getTeacherLabelsBySubject)을 **활성 직원 목록
 * (users.status≠inactive = /staff에 보이는 사람)으로 필터**해 반환한다. 영어 슬롯 닉네임(Dom·Ellen…)·보조T·
 * 부원장·LAB 같은 users에 없는 자유입력 라벨과 퇴사(inactive) 직원은 후보에서 뺀다 — 예외 지정은 실재 직원에게만
 * 의미가 있고, 퇴사자는 이미 작성률에서 자동 제외되기 때문(getWeeklyWritingRates). staffNames는 report-section이
 * orphan(설정에만 남은 예외 이름)도 활성 직원으로 좁히는 데 쓴다(비직원 이름이 orphan으로 몰리는 것 방지).
 */
export async function getReportTeacherCandidates(): Promise<{
  bySubject: Record<string, string[]>;
  staffNames: string[];
}> {
  const supabase = await createClient();
  // users는 단일 테넌트 직원 표라 ≤ 수십 행 — 무페이징 select 안전(B2 규칙 예외, getStaffList와 동일 패턴).
  const [labels, staffRes] = await Promise.all([
    getTeacherLabelsBySubject(),
    supabase.from("users").select("display_name").neq("status", "inactive"),
  ]);
  const staffSet = new Set(
    (staffRes.data ?? [])
      .map((u) => (u.display_name as string | null)?.trim())
      .filter((n): n is string => !!n),
  );
  const bySubject: Record<string, string[]> = {};
  for (const [subject, names] of Object.entries(labels)) {
    const filtered = names.filter((n) => staffSet.has(n));
    if (filtered.length > 0) bySubject[subject] = filtered;
  }
  return { bySubject, staffNames: [...staffSet] };
}

export type QueueItem = {
  id: string;
  studentName: string;
  subject: string | null;
  reportDate: string;
  status: string | null;
  error: string | null;
  processingAt: string | null;
  shareToken: string | null;
};

export type WorkerStatus = { hostname: string; lastSeenMinutes: number; online: boolean };

export type ClassnoteQueueView = {
  summary: QueueSummary;
  items: QueueItem[]; // 주의 필요(실패·오래됨·동명이인·멈춤) 목록 — 상한 100
  pending: QueueItem[]; // 진행 중(대기·처리중, 정상 흐름) 목록 — 상한 100
  workers: WorkerStatus[];
  since: string; // 집계 시작일
  days: number;
  sendEnabled: boolean; // ClassNote 실제 발송 스위치(false=dry-run, 재발송이 실제 전송 안 함)
};

// 워커 하트비트가 이 분(minutes) 이상 끊기면 오프라인(watch 데몬 15초 폴 → 넉넉히 3분).
const WORKER_OFFLINE_MINUTES = 3;

/**
 * ClassNote 발송 큐 현황(원장 보고서 관리 Part A) — 최근 N일 발송요청 보고서의 상태 집계 + 주의목록 + 워커 상태.
 * RLS로 테넌트 스코프. 로그인만 확인(읽기). edutrix getClassNoteQueueOverview 이식.
 */
export async function getClassnoteQueue(days = 3): Promise<ClassnoteQueueView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const today = kstToday();
  const since = daysBefore(today, days);
  const nowMs = Date.now();

  const { data: rowsRaw } = await supabase
    .from("lesson_reports")
    .select("id, student_id, subject, report_date, classnote_status, classnote_error, classnote_processing_at, share_token")
    .gte("report_date", since)
    .not("classnote_status", "is", null)
    .order("report_date", { ascending: false })
    .limit(1000);
  const rows = rowsRaw ?? [];

  const summary = summarizeQueue(
    rows.map((r) => ({ status: r.classnote_status as string | null, processingAt: r.classnote_processing_at as string | null })),
    nowMs,
  );

  // 주의 필요 목록(관리 액션 대상) — 상한 100.
  const attention = rows
    .filter((r) => needsAttention(r.classnote_status as string | null, r.classnote_processing_at as string | null, nowMs))
    .slice(0, 100);
  // 진행 중(대기·처리중, 주의 대상 아닌 정상 흐름) — 원장이 발송 진행을 눈으로 확인. 상한 100.
  const pendingRows = rows
    .filter((r) => {
      const s = r.classnote_status as string | null;
      return (
        (s === "queued" || s === "processing") &&
        !needsAttention(s, r.classnote_processing_at as string | null, nowMs)
      );
    })
    .slice(0, 100);
  const ids = [...new Set([...attention, ...pendingRows].map((r) => r.student_id as string))];
  const nameRows = await fetchInChunks<{ id: string; name: string }>(ids, (chunk) =>
    supabase.from("students").select("id, name").in("id", chunk),
  );
  const nameById = new Map(nameRows.map((s) => [s.id, s.name]));
  const toItem = (r: (typeof rows)[number]): QueueItem => ({
    id: r.id as string,
    studentName: nameById.get(r.student_id as string) ?? "(학생)",
    subject: r.subject as string | null,
    reportDate: r.report_date as string,
    status: r.classnote_status as string | null,
    error: r.classnote_error as string | null,
    processingAt: r.classnote_processing_at as string | null,
    shareToken: r.share_token as string | null,
  });
  const items: QueueItem[] = attention.map(toItem);
  const pending: QueueItem[] = pendingRows.map(toItem);

  const { data: wk } = await supabase.from("classnote_workers").select("hostname, last_seen");
  const workers: WorkerStatus[] = (wk ?? []).map((w) => {
    const mins = Math.floor((nowMs - Date.parse(w.last_seen as string)) / 60_000);
    return { hostname: w.hostname as string, lastSeenMinutes: Math.max(0, mins), online: mins < WORKER_OFFLINE_MINUTES };
  });

  const settings = await getTenantSettings();
  return { summary, items, pending, workers, since, days, sendEnabled: settings.report.classnoteSendEnabled };
}

// 강사 행 + 과목 태그(반 담당·슬롯 라벨 기준) — 카드의 [전체/과목] 분류 칩 소스.
export type TeacherRateRow = TeacherRate & { subjects: string[] };
export type WritingRatesView = { dates: string[]; rates: TeacherRateRow[] };

/**
 * 강사별 주간 작성률(원장 보고서 관리 Part B) — 이번 주(월~일) 작성 건수(강사×일별) + 오늘 대상 대비 작성률·미작성.
 * 오늘 대상 = 오늘 시작된 반(getTodaySchedule status≠upcoming)의 활성 수강생 − 결석. 작성 = 오늘 lesson_report 존재.
 * RLS 테넌트 스코프. edutrix WeeklyTeacherSummary 이식(session snapshot 대신 스케줄+출결로 대상 산출).
 */
export async function getWeeklyWritingRates(): Promise<WritingRatesView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const today = kstToday();
  // 이번 주 월~일 — 요일 헤더가 월화수목금토일 순으로 읽히게(한국 표준 주 시작=월). daysBefore(음수)=이후 날짜.
  const dowIdx = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=일 … 6=토
  const monday = daysBefore(today, (dowIdx + 6) % 7); // 이번 주 월요일(월=0 기준 오프셋)
  const dates = Array.from({ length: 7 }, (_, i) => daysBefore(monday, -i)); // 월→일 오름차순
  const since = dates[0]!; // = 이번 주 월요일

  // 1) 이번 주 작성 기록·오늘 스케줄·설정(예외 강사)·강사→과목 라벨·퇴사(비활성) 직원 — 상호 독립이라 병렬(B4).
  const [{ data: reps }, schedule, settings, labelsBySubject, { data: inactiveStaff }] = await Promise.all([
    supabase.from("lesson_reports").select("teacher_name, report_date").gte("report_date", since).limit(5000),
    getTodaySchedule(),
    getTenantSettings(),
    getTeacherLabelsBySubject(),
    // 퇴사자 = users.status 'inactive'(RLS 테넌트 스코프, 직원 표라 소량). 이름으로 작성률에서 자동 제외.
    supabase.from("users").select("display_name").eq("status", "inactive"),
  ]);
  // 작성 예외 강사 = 학원설정 report.writingExemptTeachers(수동 지정) + 퇴사(비활성) 처리된 직원(자동).
  // 퇴사자는 수동 등록 없이도 주간 기록·오늘 대상 모두에서 빠진다 — 재직 중 미작성만 미작성으로 집계.
  const exempt = new Set(settings.report.writingExemptTeachers);
  for (const u of inactiveStaff ?? []) {
    const name = (u.display_name as string | null)?.trim();
    if (name) exempt.add(name);
  }
  const reports = (reps ?? [])
    .map((r) => ({
      teacher: (r.teacher_name as string | null) ?? "(미지정)",
      date: r.report_date as string,
    }))
    .filter((r) => !exempt.has(r.teacher));

  // 2) 오늘 시작된 반 → 강사별 classIds (예외 강사 반 제외).
  const started = schedule.filter((s) => s.status !== "upcoming");
  const teacherOfClass = new Map<string, string>();
  for (const s of started) {
    const t = s.teacherName ?? "(미지정)";
    if (exempt.has(t)) continue;
    teacherOfClass.set(s.classId, t);
  }
  const classIds = [...teacherOfClass.keys()];

  let todayTargets: TodayTarget[] = [];
  if (classIds.length > 0) {
    // 3) 활성 수강생(오늘 시작 반).
    const enr = await fetchInChunks<{ student_id: string; class_id: string }>(classIds, (chunk) =>
      supabase.from("enrollments").select("student_id, class_id").is("end_date", null).in("class_id", chunk),
    );
    const studentsByTeacher = new Map<string, Set<string>>();
    for (const e of enr) {
      const t = teacherOfClass.get(e.class_id);
      if (!t) continue;
      if (!studentsByTeacher.has(t)) studentsByTeacher.set(t, new Set());
      studentsByTeacher.get(t)!.add(e.student_id);
    }
    const allStudentIds = [...new Set(enr.map((e) => e.student_id))];

    // 4) 오늘 결석 + 오늘 작성 + 이름.
    const [absRows, todayRepRows, nameRows] = await Promise.all([
      fetchInChunks<{ student_id: string }>(allStudentIds, (chunk) =>
        supabase.from("attendance_records").select("student_id").eq("session_date", today).eq("status", "absent").in("student_id", chunk),
      ),
      fetchInChunks<{ student_id: string }>(allStudentIds, (chunk) =>
        supabase.from("lesson_reports").select("student_id").eq("report_date", today).in("student_id", chunk),
      ),
      fetchInChunks<{ id: string; name: string }>(allStudentIds, (chunk) =>
        supabase.from("students").select("id, name").in("id", chunk),
      ),
    ]);
    const absent = new Set(absRows.map((r) => r.student_id));
    const reported = new Set(todayRepRows.map((r) => r.student_id));
    const nameById = new Map(nameRows.map((s) => [s.id, s.name]));

    // 5) 강사별 대상(결석 제외)/작성/미작성.
    todayTargets = [...studentsByTeacher].map(([teacher, ids]) => {
      const target = [...ids].filter((id) => !absent.has(id));
      const written = target.filter((id) => reported.has(id)).length;
      const missing = target.filter((id) => !reported.has(id)).map((id) => nameById.get(id) ?? "(학생)").slice(0, 20);
      return { teacher, target: target.length, written, missing };
    });
  }

  // 강사→과목 태그(반 담당·슬롯 라벨 역인덱스) — 미지의 이름은 빈 배열(카드에서 '전체'에만 노출).
  const subjectsOfTeacher = new Map<string, Set<string>>();
  for (const [subj, names] of Object.entries(labelsBySubject))
    for (const n of names)
      (subjectsOfTeacher.get(n) ?? subjectsOfTeacher.set(n, new Set()).get(n)!).add(subj);

  const rates: TeacherRateRow[] = computeWritingRates(dates, reports, todayTargets).map((r) => ({
    ...r,
    subjects: [...(subjectsOfTeacher.get(r.teacher) ?? [])],
  }));
  return { dates, rates };
}

export type ReportFilterOptions = { teachers: string[]; subjects: string[] };

/** 보고서 목록 필터 옵션(원장 보고서 관리 Part C) — 최근 보고서에서 강사·과목 distinct. */
export async function getReportFilterOptions(): Promise<ReportFilterOptions> {
  const user = await getCurrentUser();
  if (!user) return { teachers: [], subjects: [] };
  const supabase = await createClient();
  const since = daysBefore(kstToday(), 60);
  const { data } = await supabase
    .from("lesson_reports")
    .select("teacher_name, subject")
    .gte("report_date", since)
    .limit(5000);
  const teachers = new Set<string>();
  const subjects = new Set<string>();
  for (const r of data ?? []) {
    if (r.teacher_name) teachers.add(r.teacher_name as string);
    if (r.subject) subjects.add(r.subject as string);
  }
  return { teachers: [...teachers].sort(), subjects: [...subjects].sort() };
}
