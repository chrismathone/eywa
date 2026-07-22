import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getTodaySchedule, getWeeklySchedule, getTeacherLabelsBySubject } from "@/features/timetable/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { needsAttention, summarizeQueue, type QueueSummary, HUMAN_RESOLVED_STATUSES } from "../classnote-queue";
import {
  extractWorkerEnv,
  formatWorkerResults,
  type WorkerEnvInfo,
  type WorkerResultRow,
} from "../worker-results";
import {
  computeWritingRates,
  type TeacherRate,
  type TodayTarget,
  type DailyTarget,
  type TodayPending,
} from "../writing-rate";

/**
 * 대상(분모) 산출용 수강 행 — **그 날 실제로 오는 학생만** 세려면 기간·휴원·분리등원을 다 봐야 한다.
 * ⚠️ 옛 구현은 `.is("end_date", null)`만 봐서 그 요일에 안 오는 분리등원 학생까지 분모에 넣었다
 * (실측 2026-07-21 화: 김윤하 21→18, 이수진 14→11). 판정은 enrollments/eligibility 단일 소스로.
 */
type TargetEnrollment = {
  student_id: string;
  class_id: string;
  start_date: string;
  end_date: string | null;
  on_hold: boolean;
  is_transferred: boolean | null;
  attendance_days: string[] | null;
};
const TARGET_ENROLLMENT_COLS =
  "student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days";

/** 기준일에 그 반 수업을 실제로 듣는 수강인지 — 기간(반이동 규약 포함)·휴원·분리등원 요일. */
function attendsOn(e: TargetEnrollment, date: string): boolean {
  return (
    isEnrollmentActiveOn(
      { startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, isTransferred: e.is_transferred === true },
      date,
    ) && enrollmentAttendsOnDay(e.attendance_days, weekdayKeyOf(date))
  );
}

// 날짜(YYYY-MM-DD) → 요일 키("mon"~"sun") — 주간 스케줄 dayOfWeek와 매칭(결정적 UTC).
const DOW_KEY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const weekdayKeyOf = (ymd: string): string => DOW_KEY[new Date(`${ymd}T00:00:00Z`).getUTCDay()]!;

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

export type WorkerStatus = {
  hostname: string;
  lastSeenMinutes: number;
  online: boolean;
  /** 폴러별 마지막 실행 요약(0123a last_results → 한글 표시행). 구워커(컬럼 미기록)는 빈 배열. */
  results: WorkerResultRow[];
  /** 워커 실행환경(로그 폴더·최근 경고) — 연동 PC가 다른 컴퓨터라 웹에서 보이게. 구워커는 빈 값. */
  env: WorkerEnvInfo;
};

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

  const COLS =
    "id, student_id, subject, report_date, classnote_status, classnote_error, classnote_processing_at, share_token";
  // 창 안 전체 + **창 무관 '사람이 풀어야 하는' 잔여분**(blocked_shared·name_conflict)을 함께 본다.
  // 후자는 원장이 조치할 때까지 며칠이고 남는데, 창에 걸려 사라지면 재발송 UI(이 카드가 유일)도 같이 사라져
  // 해소 불가능한 막다른 길이 된다(HUMAN_RESOLVED_STATUSES 주석 참조). 독립 조회라 병렬(B4).
  const [{ data: rowsRaw }, { data: stuckRaw }] = await Promise.all([
    supabase
      .from("lesson_reports")
      .select(COLS)
      .gte("report_date", since)
      .not("classnote_status", "is", null)
      .order("report_date", { ascending: false })
      .limit(1000),
    supabase
      .from("lesson_reports")
      .select(COLS)
      .in("classnote_status", [...HUMAN_RESOLVED_STATUSES])
      .order("report_date", { ascending: false })
      .limit(200), // 사람 조치 대기분이 200을 넘을 일은 없다(넘으면 운영이 이미 무너진 것)
  ]);
  // 창 안/밖이 겹치므로 id로 중복 제거 — 안 그러면 집계가 두 번 세어진다.
  const byId = new Map<string, (typeof rowsRaw extends null ? never : NonNullable<typeof rowsRaw>)[number]>();
  for (const r of [...(rowsRaw ?? []), ...(stuckRaw ?? [])]) byId.set(r.id as string, r);
  const rows = [...byId.values()];

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

  const { data: wk } = await supabase.from("classnote_workers").select("hostname, last_seen, last_results");
  const workers: WorkerStatus[] = (wk ?? []).map((w) => {
    const mins = Math.floor((nowMs - Date.parse(w.last_seen as string)) / 60_000);
    return {
      hostname: w.hostname as string,
      lastSeenMinutes: Math.max(0, mins),
      online: mins < WORKER_OFFLINE_MINUTES,
      results: formatWorkerResults(w.last_results),
      env: extractWorkerEnv(w.last_results),
    };
  });

  const settings = await getTenantSettings();
  return { summary, items, pending, workers, since, days, sendEnabled: settings.report.classnoteSendEnabled };
}

// 강사 행 + 과목 태그(반 담당·슬롯 라벨 기준) — 카드의 [전체/과목] 분류 칩 소스.
export type TeacherRateRow = TeacherRate & { subjects: string[] };
export type WritingRatesView = {
  dates: string[];
  rates: TeacherRateRow[];
  /** 이 뷰가 담은 범위 — 화면이 "주간/월간" 라벨과 월 이동을 결정한다. */
  range: { kind: "week" | "month"; month: string };
};

/** 월 키("2026-07") → 그 달 1일~말일 날짜 배열(오름차순). */
function monthDates(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return [];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * 강사별 주간 작성률(원장 보고서 관리 Part B) — 이번 주(월~일) 작성 건수(강사×일별) + 오늘 대상 대비 작성률·미작성.
 * 오늘 대상 = 오늘 시작된 반(getTodaySchedule status≠upcoming)의 활성 수강생 − 결석. 작성 = 오늘 lesson_report 존재.
 * RLS 테넌트 스코프. edutrix WeeklyTeacherSummary 이식(session snapshot 대신 스케줄+출결로 대상 산출).
 */
export async function getWeeklyWritingRates(month?: string): Promise<WritingRatesView | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const today = kstToday();
  // 범위 = 이번 주(기본) 또는 지정한 달. **날짜 배열만 달라지고 아래 로직은 그대로**다 —
  // 대상(분모) 산출이 이미 날짜 단위(분리등원·휴원·그날 결석)라 7일이든 31일이든 같은 코드가 돈다.
  // ⚠️ 비용도 거의 안 늘어난다: class_schedules는 **요일 단위**(7행)라 달이어도 그대로고, 작성기록은
  //    fetchAllPaged(전건), 반 집합도 동일하다. 늘어나는 건 JS 날짜 루프뿐.
  const isMonth = !!month && /^\d{4}-\d{2}$/.test(month);
  const dowIdx = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=일 … 6=토
  const monday = daysBefore(today, (dowIdx + 6) % 7); // 이번 주 월요일(월=0 기준 오프셋)
  const dates = isMonth
    ? monthDates(month!)
    : Array.from({ length: 7 }, (_, i) => daysBefore(monday, -i)); // 월→일 오름차순
  if (dates.length === 0) return null;
  const since = dates[0]!;
  const until = dates[dates.length - 1]!;
  const range = { kind: (isMonth ? "month" : "week") as "week" | "month", month: (month ?? today).slice(0, 7) };
  // 오늘이 범위 밖(지난 달·다음 달)이면 '오늘' 열이 의미 없다 — 무거운 오늘 스케줄 조회를 건너뛴다.
  const includesToday = today >= since && today <= until;

  // 1) 이번 주 작성 기록·오늘 스케줄·설정(예외 강사)·강사→과목 라벨·퇴사(비활성) 직원 — 상호 독립이라 병렬(B4).
  // ⚠️ 작성 기록은 강사×일 집계 소스라 절단되면 작성률이 과소집계된다. `.limit(5000)`은 방어가 안 됨 —
  // PostgREST max-rows(≈1000)가 명시 limit도 덮어 1000행에서 silent 절단(실측 확인, #54). fetchAllPaged로 전건.
  const [reps, schedule, weekly, settings, labelsBySubject, { data: inactiveStaff }] = await Promise.all([
    // ⚠️ 집계 기준은 **유효일 = covers_date ?? report_date**(0136a) — 미리/나중에 쓴 보고서를 실제 수업일로 귀속.
    //   그래서 범위 조회도 두 날짜 **중 하나라도** 걸치면 가져온 뒤(or) JS에서 유효일로 다시 거른다.
    //   report_date만으로 자르면 "6/28에 쓰고 7/2 수업분"인 보고서가 7월 뷰에서 통째로 사라진다.
    fetchAllPaged<{
      teacher_name: string | null;
      report_date: string;
      covers_date: string | null;
      student_id: string;
    }>((from, to) =>
      supabase
        .from("lesson_reports")
        .select("teacher_name, report_date, covers_date, student_id")
        .or(
          `and(report_date.gte.${since},report_date.lte.${until}),and(covers_date.gte.${since},covers_date.lte.${until})`,
        )
        // OFFSET 페이지 안정화 — unique tie-break(id) 포함 order(batch.ts 계약)
        .order("report_date")
        .order("id")
        .range(from, to),
    ),
    // 오늘이 범위 밖이면 '오늘' 정밀 계산이 무의미하다 — 조회 자체를 건너뛴다(지난 달 열람 비용 절감).
    includesToday ? getTodaySchedule() : Promise.resolve([]),
    getWeeklySchedule(), // 요일별 대상(분모) 계산용 — 요일 단위라 주/월 무관하게 같은 비용
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
  // 보고서는 **쓴 날(report_date)에 그대로** 집계한다. covers_date는 집계를 옮기는 게 아니라
  // "그 날 수업의 의무를 이 보고서가 대신했다"는 표시라, 아래에서 **분모(대상)에서 빼는** 데 쓴다(0136a).
  // ⚠️ 옮기면 연속수업(7/3에 2타임 몰아서 하고 보고서 1건)에서 7/3이 거꾸로 미작성이 된다.
  const reports = (reps ?? [])
    .map((r) => ({
      teacher: (r.teacher_name as string | null) ?? "(미지정)",
      date: r.report_date as string,
      studentId: r.student_id as string,
    }))
    // or() 조회로 범위 밖 행(covers_date만 걸친 것)이 섞여 온다 — 쓴 날 기준으로 다시 좁힌다.
    .filter((r) => r.date >= since && r.date <= until)
    .filter((r) => !exempt.has(r.teacher));

  /**
   * **의무가 면제된 (학생, 날짜)** — 보고서에 실제 수업일(covers_date)이 지정된 건(0136a).
   * 그 날은 그 학생이 오지 않는다(미리 했거나 앞 수업에 몰아서 했다) → 대상에서 뺀다.
   * 두 케이스 모두 이 한 규칙으로 풀린다:
   *   · 선발송  = 7/19분을 7/3에 미리 함 → 7/19 대상에서 제외
   *   · 연속수업 = 7/19분을 7/3에 2타임으로 함(보고서 1건) → 7/19 대상에서 제외(7/3은 보고서가 있어 그대로 충족)
   */
  const discharged = new Set(
    (reps ?? [])
      .filter((r) => r.covers_date)
      .map((r) => `${r.student_id}|${r.covers_date as string}`),
  );

  // 2) 오늘 시작된 반 → 강사별 classIds (예외 강사 반 제외).
  // 귀속 = 반 담당(teacherName) 우선, 없으면 **슬롯 강사 라벨 폴백** — 반 담당 없이 슬롯 라벨로만 도는
  // 영어반(RTT2류)이 "(미지정)"으로 뭉치지 않게. 라벨 인물이 예외면 그 슬롯도 예외로 빠진다.
  const started = schedule.filter((s) => s.status !== "upcoming");
  const teacherOfClass = new Map<string, string>();
  for (const s of started) {
    const t = s.teacherName ?? s.slotTeacherLabel ?? "(미지정)";
    if (exempt.has(t)) continue;
    teacherOfClass.set(s.classId, t);
  }
  const classIds = [...teacherOfClass.keys()];

  // 2-b) 오늘 **아직 시작 안 한** 수업 — 분모엔 안 넣지만(시작 전을 미작성으로 몰면 안 됨) "수업 없음"과
  // 구분해야 한다. 옛 화면은 둘 다 "수업 없음"이라 저녁 수업만 있는 강사가 낮엔 수업이 없는 것처럼 보였다.
  const pendingByTeacher = new Map<string, { classes: number; firstStart: string }>();
  for (const s of schedule) {
    if (s.status !== "upcoming") continue;
    const t = s.teacherName ?? s.slotTeacherLabel ?? "(미지정)";
    if (exempt.has(t)) continue;
    const cur = pendingByTeacher.get(t);
    const start = s.startTime.slice(0, 5); // "20:10:00" → "20:10"
    if (!cur) pendingByTeacher.set(t, { classes: 1, firstStart: start });
    else pendingByTeacher.set(t, { classes: cur.classes + 1, firstStart: start < cur.firstStart ? start : cur.firstStart });
  }
  const todayPendings: TodayPending[] = [...pendingByTeacher].map(([teacher, v]) => ({ teacher, ...v }));

  let todayTargets: TodayTarget[] = [];
  if (classIds.length > 0) {
    // 3) 오늘 시작 반의 **오늘 오는** 수강생(기간·휴원·분리등원 반영).
    const enr = (
      await fetchAllPagedInChunks<TargetEnrollment>(classIds, (chunk, from, to) =>
        supabase
          .from("enrollments")
          .select(TARGET_ENROLLMENT_COLS)
          .in("class_id", chunk)
          .lte("start_date", today)
          .or(`end_date.is.null,end_date.gte.${today}`)
          // OFFSET 페이지 안정화 — unique tie-break 포함 order(batch.ts 계약)
          .order("id", { ascending: true })
          .range(from, to),
      )
    ).filter((e) => attendsOn(e, today));
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
      // 결석 제외 + **의무 면제(covers_date로 이미 처리된 수업)** 제외 — 오지 않는 학생을 미작성으로 몰지 않는다.
      const target = [...ids].filter((id) => !absent.has(id) && !discharged.has(`${id}|${today}`));
      const written = target.filter((id) => reported.has(id)).length;
      const missing = target.filter((id) => !reported.has(id)).map((id) => nameById.get(id) ?? "(학생)").slice(0, 20);
      return { teacher, target: target.length, written, missing };
    });
  }

  // 6) 과거일(월~어제) 강사×날짜 대상 — 오늘 로직(반 활성 수강생 − 그날 결석)을 이번 주 지난 요일로 일반화.
  //    주간 스케줄로 그 요일 반→강사(예외 제외), 활성 수강(end_date null), 그날 결석을 빼 대상 수를 구한다.
  //    오늘은 위 todayTargets(정밀)로 별도, 미래일은 대상 없음(pure 함수가 null 처리). 작성분은 min(건수,대상) 근사.
  const pastDates = dates.filter((d) => d < today);
  const dailyTargets: DailyTarget[] = [];
  if (pastDates.length > 0) {
    // 과거일별 반→강사(예외 제외) + 주간 반 id 집합.
    const teacherOfClassByDate = new Map<string, Map<string, string>>();
    const weekClassIds = new Set<string>();
    for (const d of pastDates) {
      const key = weekdayKeyOf(d);
      const m = new Map<string, string>();
      for (const s of weekly) {
        if (s.dayOfWeek !== key) continue;
        // 오늘 로직과 동일: 반 담당 → 슬롯 라벨 폴백(반 담당 없는 영어반 "(미지정)" 방지).
        const t = s.teacherName ?? s.slotTeacherLabel ?? "(미지정)";
        if (exempt.has(t)) continue;
        m.set(s.classId, t);
        weekClassIds.add(s.classId);
      }
      teacherOfClassByDate.set(d, m);
    }
    if (weekClassIds.size > 0) {
      // 수강 행(오늘 로직과 동일 판정: 기간·휴원·분리등원) + 주간(월~어제) 결석.
      // ⚠️ 날짜마다 오는 학생이 다르므로(분리등원) 반→학생 집합을 미리 굳히지 않고 **날짜별로** 판정한다.
      const wenr = await fetchAllPagedInChunks<TargetEnrollment>([...weekClassIds], (chunk, from, to) =>
        supabase
          .from("enrollments")
          .select(TARGET_ENROLLMENT_COLS)
          .in("class_id", chunk)
          .lte("start_date", pastDates[pastDates.length - 1]!)
          .or(`end_date.is.null,end_date.gte.${pastDates[0]!}`)
          .order("id", { ascending: true })
          .range(from, to),
      );
      const enrollmentsByClass = new Map<string, TargetEnrollment[]>();
      const weekStudentIds = new Set<string>();
      for (const e of wenr) {
        (enrollmentsByClass.get(e.class_id) ?? enrollmentsByClass.set(e.class_id, []).get(e.class_id)!).push(e);
        weekStudentIds.add(e.student_id);
      }
      const absRows = weekStudentIds.size
        ? await fetchInChunks<{ student_id: string; session_date: string }>([...weekStudentIds], (chunk) =>
            supabase
              .from("attendance_records")
              .select("student_id, session_date")
              .eq("status", "absent")
              .gte("session_date", pastDates[0]!)
              .lte("session_date", pastDates[pastDates.length - 1]!)
              .in("student_id", chunk),
          )
        : [];
      const absentByDate = new Map<string, Set<string>>();
      for (const a of absRows)
        (absentByDate.get(a.session_date) ?? absentByDate.set(a.session_date, new Set()).get(a.session_date)!).add(a.student_id);
      // 강사×날짜 대상 = 그날 강사 반들의 **그날 오는** 학생(중복 제거) − 그날 결석.
      for (const d of pastDates) {
        const absent = absentByDate.get(d) ?? new Set<string>();
        const studentsByTeacher = new Map<string, Set<string>>();
        for (const [classId, teacher] of teacherOfClassByDate.get(d)!) {
          const rows = enrollmentsByClass.get(classId);
          if (!rows) continue;
          const ts = studentsByTeacher.get(teacher) ?? studentsByTeacher.set(teacher, new Set()).get(teacher)!;
          for (const e of rows) if (attendsOn(e, d)) ts.add(e.student_id);
        }
        for (const [teacher, ids] of studentsByTeacher) {
          // 오늘과 같은 규칙: 결석 + 의무 면제(covers_date) 제외.
          const target = [...ids].filter((id) => !absent.has(id) && !discharged.has(`${id}|${d}`)).length;
          dailyTargets.push({ teacher, date: d, target });
        }
      }
    }
  }

  // 강사→과목 태그(반 담당·슬롯 라벨 역인덱스) — 미지의 이름은 빈 배열(카드에서 '전체'에만 노출).
  const subjectsOfTeacher = new Map<string, Set<string>>();
  for (const [subj, names] of Object.entries(labelsBySubject))
    for (const n of names)
      (subjectsOfTeacher.get(n) ?? subjectsOfTeacher.set(n, new Set()).get(n)!).add(subj);

  // 학원이 휴일로 지정한 날은 분모에서 뺀다(원장 2026-07-22) — 스케줄상 반이 있어도 수업을 안 했으므로
  // 그날 0%는 거짓 빨강이다. ⚠️ **공휴일 자동 포함은 하지 않는다** — 학원이 설정에 넣은 날짜만 본다
  // (공휴일에도 여는 학원이 있어 임의로 빼면 진짜 미작성을 가린다). 필요하면 학원설정에 추가하면 된다.
  const rates: TeacherRateRow[] = computeWritingRates(
    dates,
    reports,
    todayTargets,
    dailyTargets,
    today,
    todayPendings,
    settings.operations.holidays,
  ).map((r) => ({
    ...r,
    subjects: [...(subjectsOfTeacher.get(r.teacher) ?? [])],
  }));
  return { dates, rates, range };
}

export type ReportFilterOptions = { teachers: string[]; subjects: string[] };

/**
 * 보고서 목록 필터 옵션(원장 보고서 관리 Part C) — 최근 보고서에서 강사·과목 distinct.
 *
 * ⚠️ 전건 select 금지(B2). 옛 구현은 `.select("teacher_name, subject").limit(5000)`으로 전건을 받아
 * JS Set으로 distinct를 만들었는데, PostgREST max-rows(≈1000)가 명시 limit을 덮어 **에러 없이** 잘렸다:
 * 최근 60일 4,010행 중 1,000행만 도달 → distinct 강사 14명 중 3명이 옵션에서 통째로 누락됐고,
 * 소비처가 자유입력 없는 <select>라 그 강사의 보고서는 어떤 경로로도 필터할 수 없었다(2026-07-21).
 * distinct = 집계이므로 group-by RPC(0126a)로 내린다 — 4,010행 스캔 → 17행 반환.
 */
export async function getReportFilterOptions(): Promise<ReportFilterOptions> {
  const user = await getCurrentUser();
  if (!user) return { teachers: [], subjects: [] };
  const supabase = await createClient();
  const since = daysBefore(kstToday(), 60);
  const { data, error } = await supabase.rpc("lesson_report_filter_options", { p_since: since });
  if (error) {
    // 옵션이 비면 필터를 못 쓸 뿐 목록 자체는 보이므로 화면을 죽이지 않는다. 단 조용히 넘기면
    // "필터에 강사가 안 뜬다"가 또 원인 불명이 되므로 로그는 남긴다.
    console.error("[report-admin] 필터 옵션 조회 실패", error);
    return { teachers: [], subjects: [] };
  }
  const teachers = new Set<string>();
  const subjects = new Set<string>();
  for (const r of (data ?? []) as { teacher_name: string | null; subject: string | null }[]) {
    if (r.teacher_name) teachers.add(r.teacher_name);
    if (r.subject) subjects.add(r.subject);
  }
  return { teachers: [...teachers].sort(), subjects: [...subjects].sort() };
}
