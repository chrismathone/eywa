import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstMonth, kstToday, monthLabel, monthRange } from "@/lib/date-kst";
import { buildGoalRail, type GoalRail, type GoalRailStatus, type RailPoint } from "../lib/goal-rail";
import { dayPositionOf, goalEndOf } from "../lib/lesson-position";
import { classDaysOf, normalizeMonth, type ClassDay, type MathScheduleRow } from "../lib/class-days";
import {
  cellStateOf,
  foldDayAttendance,
  tallyCells,
  type MathCellState,
  type MathFillStats,
} from "../lib/cell-state";
import {
  isOffGoalRecord,
  offGoalCountByDate,
  type MathRecordLike,
  type StudentGoalMap,
} from "../lib/student-goals";
import { DEFAULT_STALL_RUN, stalledDatesOf } from "../lib/progress-stall";
import {
  isOnMathRosterAnyDay,
  mathSpansOf,
  rosterAnchorOf,
  rosterPhaseOf,
  type MathEnrollmentWindow,
  type MathRosterPhase,
} from "../lib/roster";
import type { EnrollSpan, LifecycleBadge } from "@/features/attendance/enrollment-span";
import { mathLifecycleBadges } from "./lifecycle";
import { describePosition } from "@/features/progress/curriculum-position";
import { readMcsFontSize, type McsFontSize } from "../font-size";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logDbError } from "@/lib/supabase/db-error";
import { requireMcsClassAccess } from "./access";
import { getTenantSettings } from "@/features/owner/server/queries";
// 휴일 판정 자료는 학원설정 하나뿐 — 내장 법정공휴일 표는 쓰지 않는다([[holiday.ts]]).
import { buildHolidayMap } from "@/features/attendance/calendar";
import { isHolidayOn } from "@/features/class-sheets/lib/holiday";
import type { LearningContext } from "../lib/learning-plan";
import type { StudentBasics } from "../lib/student-basics";
import { loadMcsStudentBasics } from "./student-basics";

/**
 * MCS **월간 뷰** 조회 — 반 1개 × 달 1개, 축은 **학생 × 수업일**.
 *
 * 🔴 **실제 진도를 담는 새 표는 없다.** 교재·진도·과제는 이미 `lesson_reports`에 매일 쌓인다
 *    (실측 2026-08: 1,737건 전부 수학). 이 화면은 그걸 월 단위로 세워 보여줄 뿐이고 새로 쓰는 것은
 *    학생별 월간 목표(`math_month_goals`) 하나뿐이다.
 * 🔴 **목표 표가 아직 없어도 화면은 살아야 한다**([[#95]] — SQL은 원장이 손으로 적용한다).
 *    목표 조회만 fail-soft로 빈 맵이 되고, '미작성'·'진도 정체'는 그대로 뜬다.
 * ⚠️ `math_month_goals`·`class_sheet_*`와 같은 규약으로 **admin 클라이언트 + tenant_id 명시 필터**
 *    ([[#104]] — admin은 RLS 우회라 필터를 빼면 남의 테넌트가 섞인다).
 */
export type MathStudentRow = {
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  /** 과거 진도 조회 중에도 기준일이 명시된 현재 과목·수강 시작·담임을 표시한다. */
  basicInfo?: StudentBasics;
  /** 날짜 → 그 칸의 상태. 열에 없는 날짜는 키가 없다. */
  cells: Record<string, MathCellState>;
  /** 날짜 → 그 날 기록(있을 때만). */
  records: Record<string, MathDayRecord>;
  /** 정체로 판정된 날짜(진도 문자열이 임계만큼 연속으로 같은 날). */
  stalledDates: string[];
  /**
   * **목표 레일**(Start·Plan·Now·End) — 학생마다 하나(트랙을 가르지 않는다, lesson-position.ts). 초안(able
   * 2026-09-02)의 "목표 대비 현재 진도" 그림. 판정은 [`goal-rail.ts`](../lib/goal-rail) 단일 소스이고 위치는 서버가
   * [`lesson-position.ts`](../lib/lesson-position)로 접어 숫자·차시명만 내려보낸다.
   * 위치가 한 번도 안 잡히고 목표도 없으면 null(= 말할 것이 없다).
   */
  rail: StudentRail | null;
  /**
   * 기준일(그 달 안으로 접은 오늘)에서 본 자리 — `ended`면 회색 줄로 가라앉힌다
   * (원장 2026-09-01 *"퇴원처리형식으로 회색 줄로"*).
   * 🔴 `upcoming`(아직 안 들어온 신입)을 `ended`와 한 덩어리로 묶지 말 것 — 앞으로 올 사람을
   *    나간 사람처럼 칠하게 된다.
   */
  rosterPhase: MathRosterPhase;
  /**
   * 그 달의 신입·퇴원·반이동 표식 — **출석부와 같은 판정**(`lifecycleBadgesInRange`).
   * 대부분의 학생은 빈 배열이고, 그 달에 경계가 있는 학생만 1~2개를 갖는다.
   */
  badges: LifecycleBadge[];
};

export type MathDayRecord = {
  textbook: string | null;
  progress: string | null;
  homework: string | null;
  /** 일일테스트 원문("5문제 중 4개 맞음") — 칸 표시·숫자 변환은 test-score.ts가 한다. */
  dailyTest: string | null;
  /** 확인테스트 원문(실측상 거의 비어 있다 — 있으면 칸에 적힌다). */
  checkTest: string | null;
  /** 옛 합본(`exam_info`, "일일 4/5") — 분리값이 없는 edutrix 이관분에서만 읽힌다. */
  examInfo: string | null;
  /** 지난 과제 수행률 원문("100%"·"미제출"). */
  homeworkScore: string | null;
  /** 목표 밖 교재인가(목표가 없으면 항상 false). */
  offGoal: boolean;
};

export type StudentRail = {
  rail: GoalRail;
  /** Start를 준 기록의 날짜(달 전 마지막 기록, 없으면 이 달 첫 기록). 위치 미상이면 null. */
  startDate: string | null;
  /** 네 점의 차시 이름(커리큘럼 범위 밖이면 null). */
  startLesson: string | null;
  nowLesson: string | null;
  /** Now 차시의 학년("중2") — 학생 학년과 다르면 "어느 학년을 나가는지"를 말한다. */
  nowGrade: string | null;
  planLesson: string | null;
  endLesson: string | null;
};

export type RailSummary = Record<GoalRailStatus, number>;

export type MathSheetMonthData = {
  /** Overall goals use the full timetable and holiday range, rather than only the selected month. */
  learningContext?: LearningContext;
  classId: string;
  className: string;
  month: string;
  monthLabel: string;
  today: string;
  teacherName: string | null;
  /** 열 — 그 달에 이 반이 도는 날. 비면 "이 달엔 수업이 없다". */
  days: ClassDay[];
  /**
   * 그 달 수업일 중 **이미 지난 날** 수(오늘 포함). 0이면 아직 한 번도 안 한 달이다.
   * 🔴 이걸 안 보면 다음 달 화면이 전부 빨간 '기록 0건'으로 뜬다 — 아직 안 온 수업을 안 적었다고
   *    재촉하는 거짓 경보다(원장 2026-09-01 9월 화면에서 실제로 그렇게 보였다).
   */
  elapsedDays: number;
  students: MathStudentRow[];
  goals: StudentGoalMap;
  /** 날짜 → 목표 밖 기록 수(열 머리 강조). */
  offGoalByDate: Record<string, number>;
  /** 이 달에 실제로 나간 교재 전체(목표 입력 자동완성 후보 — 표기 흔들림을 입력 단계에서 줄인다). */
  bookOptions: string[];
  fill: MathFillStats;
  /**
   * 학생마다 레일 하나의 상태를 센 것 — 툴바 "느림 N · 계획대로 N"(나간 학생은 뺀다).
   * 🔴 달 중간에 나간 학생(`ended`)은 안 센다(이미 없는 사람을 재촉하지 않는다).
   */
  railSummary: RailSummary;
  canEdit: boolean;
  /**
   * 목표를 읽을 수 있었나 — 화면이 그 사실을 조용히 삼키지 않게.
   * `missing-table` = 0237a 미적용 / `failed` = 그 밖의 조회 실패(원인 단정 금지).
   */
  goalsStatus: GoalsStatus;
  /** 글씨 크기(작음·보통·큼) — 계정 귀속. 원스크린·ECS와 같은 어휘·같은 배율. */
  fontSize: McsFontSize;
  /**
   * 이 달 범위의 학원 휴일(`YYYY-MM-DD` → 이름).
   * 🔴 **열을 없애는 값이 아니다**(원장 2026-09-01 *"입력은 가능하도록"*) — 그 날 열은 그대로 서고
   *    기록도 그대로 보인다. 달라지는 건 열 머리 표식과 칸 상태(`holiday`)뿐이다.
   */
  holidays: Record<string, string>;
};

export type GoalsStatus = "ok" | "missing-table" | "failed";

export type MathMonthResult = { ok: true; data: MathSheetMonthData } | { ok: false; error: string };

/**
 * 레일의 Start(달 시작 전 마지막 위치)를 찾는 창 — 달 시작 전 이만큼의 기록을 본다.
 * 수학 반은 주 1~2회라 45일이면 6~12번의 기록이고, 그 안에 위치가 하나도 없으면 이 달 첫 기록이 Start다.
 */
const PRIOR_WINDOW_DAYS = 45;

type MathReportRow = {
  student_id: string;
  report_date: string;
  textbook: string | null;
  progress: string | null;
  homework_today: string | null;
  daily_test: string | null;
  check_test: string | null;
  exam_info: string | null;
  homework_score: string | null;
};
type PriorReportRow = { student_id: string; report_date: string; progress: string | null };

function lessonNameOf(position: number | null): string | null {
  return position == null ? null : (describePosition(position)?.lesson ?? null);
}

function emptyRailSummary(): RailSummary {
  return { "no-data": 0, "no-goal": 0, "goal-behind": 0, "not-started": 0, done: 0, ahead: 0, on: 0, behind: 0 };
}
type MathAttRow = { student_id: string; session_date: string; status: string | null };

export async function getMathSheetMonth(
  classId: string,
  monthRaw: string | null,
): Promise<MathMonthResult> {
  const gate = await requireMcsClassAccess(classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const access = gate.access;

  const today = kstToday();
  const month = normalizeMonth(monthRaw, kstMonth());
  const { from, to } = monthRange(month);
  const admin = createAdminClient();
  const tenantId = access.tenantId;

  // 독립 조회는 병렬(B4).
  const [schedRes, enrRes, reportRows, attRows, goalRes, prefRes, teacherRes, settings] = await Promise.all([
    admin
      .from("class_schedules")
      .select("day_of_week, start_time, end_time, valid_from, valid_to")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId),
    admin
      .from("enrollments")
      .select("student_id, start_date, end_date, is_transferred, attendance_days")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId),
    // 한 반 한 달이면 수백 행이지만 상한을 두지 않는다(B2) — 큰 반 × 긴 달이면 1,000에 닿을 수 있다.
    // ⚠️ 페이지가 흔들리지 않게 **unique tie-break**(id)를 반드시 붙인다(batch.ts 규약).
    fetchAllPaged<MathReportRow>((f, t) =>
      admin
        .from("lesson_reports")
        // 시험 세 칸(0082a 분리값 + 옛 합본) — 칸의 점수 표시·평균 재료(test-score.ts). 셋 다 2026-07 이전 컬럼(#95 무관).
        .select(
          "student_id, report_date, textbook, progress, homework_today, daily_test, check_test, exam_info, homework_score",
        )
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .gte("report_date", from)
        .lte("report_date", to)
        .order("report_date")
        .order("id")
        .range(f, t),
    ),
    fetchAllPaged<MathAttRow>((f, t) =>
      admin
        .from("attendance_records")
        .select("student_id, session_date, status")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .gte("session_date", from)
        .lte("session_date", to)
        .order("id")
        .range(f, t),
    ),
    admin
      .from("math_month_goals")
      .select("student_id, textbook, target_progress")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("period_start", from),
    getCurrentUser().then(async actor => {
      if (!actor) return { data: null };
      const { data } = await admin.from("users").select("ui_prefs")
        .eq("id", actor.id).eq("tenant_id", actor.tenantId).maybeSingle();
      return { data };
    }),
    access.teacherId
      ? admin
          .from("users")
          .select("display_name")
          .eq("id", access.teacherId)
          // admin은 RLS 우회라 tenant 필터가 규약이다([[#104]]) — ECS 월간 조회와 같은 모양.
          .eq("tenant_id", tenantId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // 휴일 — 테넌트 단위 read-mostly라 요청 캐시를 탄다(추가 왕복 없음, B4·B6).
    getTenantSettings(),
  ]);

  if (schedRes.error || enrRes.error) {
    logDbError(schedRes.error ?? enrRes.error, "math-sheets.getMathSheetMonth.roster");
    return { ok: false, error: "수업 일정과 학생 명단을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }

  // 이 달 범위로 좁힌 휴일 — 전 연도를 클라로 내려보낼 이유가 없다(설정엔 2027년까지 들어 있다).
  const holidays: Record<string, string> = {};
  for (const [date, name] of Object.entries(buildHolidayMap(settings.operations.holidays))) {
    if (date >= from && date <= to) holidays[date] = name;
  }

  const days = classDaysOf(
    month,
    (schedRes.data ?? []).map(
      (r): MathScheduleRow => ({
        dayOfWeek: String(r.day_of_week),
        startTime: String(r.start_time),
        endTime: r.end_time ? String(r.end_time) : null,
        validFrom: r.valid_from ? String(r.valid_from).slice(0, 10) : null,
        validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
      }),
    ),
  );
  const dayDates = days.map((d) => d.date);
  const daySet = new Set(dayDates);

  // 🔴 목표 표가 없으면(SQL 미적용) 조용히 빈 맵 — 화면은 살고 경고만 안 뜬다([[#95]]).
  // ⚠️ **원인을 단정하지 않는다**: 표가 없는 것(42P01·PGRST205)과 그냥 조회가 실패한 것은 다른 사실이라
  //    한 문구로 뭉치면 화면이 거짓말을 한다(권한·네트워크 실패를 "SQL 미적용"이라 부르게 된다).
  const goalErrCode = goalRes.error ? String(goalRes.error.code ?? "") : "";
  const goalsStatus: GoalsStatus = !goalRes.error
    ? "ok"
    : goalErrCode === "42P01" || goalErrCode === "PGRST205" || /does not exist|could not find the table/i.test(goalRes.error.message ?? "")
      ? "missing-table"
      : "failed";
  const goals: StudentGoalMap = {};
  for (const row of goalRes.data ?? []) {
    goals[String(row.student_id)] = {
      textbook: row.textbook ?? null,
      targetProgress: row.target_progress ?? null,
    };
  }

  // 로스터 — 이 달 안에 한 번이라도 명단이었던 학생. 수강 구간은 학생마다 여러 건일 수 있다.
  const enrByStudent = new Map<string, MathEnrollmentWindow[]>();
  for (const e of enrRes.data ?? []) {
    const sid = String(e.student_id);
    const list = enrByStudent.get(sid) ?? [];
    list.push({
      startDate: e.start_date ? String(e.start_date).slice(0, 10) : null,
      endDate: e.end_date ? String(e.end_date).slice(0, 10) : null,
      // 🔴 반이동 전출은 종료일 **당일에** 끝난다 — 이 플래그를 안 넘기면 옛 반에 하루 더 남는다.
      isTransferred: e.is_transferred === true,
    });
    enrByStudent.set(sid, list);
  }

  const studentIds = [...enrByStudent.keys()];
  // 학생 행과 **달 시작 전 기록**(레일의 Start 재료)은 서로 독립이라 함께 띄운다(B4).
  // 🔴 달 전 기록도 **이 반**으로 좁힌다 — 한 학생이 정규(중3-1)와 특강(중3-2)을 **동시에** 다녀서 반을
  //    안 가리면 특강의 위치(삼각비)가 정규 반의 Start가 되고, 정규 목표(이차함수)가 "현재보다 앞이 아님"이
  //    된다(실측 2026-09-02 MS2A 3명). 레일은 **이 반의 진도선**이다(초안의 과정(course) 단위와 같다).
  //    ⚠️ 그래서 달 초에 반이동해 온 학생은 옛 반의 위치를 안 잇는다 — 이 달 첫 기록이 Start가 된다.
  //    100명 × 45일이면 1,000행을 넘을 수 있어 청크+페이지네이션(B2·B3).
  const [students, priorRows] = studentIds.length
    ? await Promise.all([
        fetchInChunks(studentIds, (chunk) =>
          admin
            .from("students")
            .select("id, name, school, grade, status, withdrawn_at")
            .eq("tenant_id", tenantId)
            .in("id", chunk),
        ),
        fetchAllPagedInChunks<PriorReportRow>(studentIds, (chunk, f, t) =>
          admin
            .from("lesson_reports")
            .select("student_id, report_date, progress")
            .eq("tenant_id", tenantId)
            .eq("class_id", classId)
            .in("student_id", chunk)
            .gte("report_date", addDays(from, -PRIOR_WINDOW_DAYS))
            .lt("report_date", from)
            .order("report_date")
            .order("id")
            .range(f, t),
        ),
      ])
    : [[], []];
  const studentById = new Map(students.map((s) => [String(s.id), s]));
  const priorByStudent = new Map<string, PriorReportRow[]>();
  for (const r of priorRows) {
    const list = priorByStudent.get(String(r.student_id)) ?? [];
    list.push(r);
    priorByStudent.set(String(r.student_id), list);
  }

  // 그 학생·그 날의 출결(교시 여럿이면 대표 하나로 접는다 — 결석이 이긴다).
  const attByKey = new Map<string, string[]>();
  for (const a of attRows) {
    const key = `${String(a.student_id)}|${String(a.session_date).slice(0, 10)}`;
    const list = attByKey.get(key) ?? [];
    list.push(String(a.status));
    attByKey.set(key, list);
  }

  const recordByKey = new Map<string, (typeof reportRows)[number]>();
  for (const r of reportRows) {
    const date = String(r.report_date).slice(0, 10);
    // 🔴 수업일이 아닌 날의 기록(보강 등)은 열이 없어 놓을 자리가 없다 — 담지 않는다.
    //    담으면 툴바 요약과 표에 보이는 칸 수가 어긋난다.
    if (!daySet.has(date)) continue;
    recordByKey.set(`${String(r.student_id)}|${date}`, r);
  }

  // 🔴 **그 달 수업일에 하루라도 명단이었으면 세운다**(원장 2026-09-01 *"중간에 나가면 퇴원처리형식으로
  //    회색 줄로 남기는게 합리적. 중간에 들어와도 마찬가지. 출석부랑 비슷하게."*).
  //    통째로 빼면 그 학생이 실제로 다닌 날의 기록까지 사라진다(실측 2026-08: 감춘 행 52개에 **이미
  //    작성된 기록 113칸**이 들어 있었다). 수강 밖 날짜는 아래 `cellStateOf`가 칸 단위로 끈다.
  // ⚠️ 기준일(`anchor`)은 이제 "지금도 다니나"(회색 처리 여부)만 정한다.
  const anchor = rosterAnchorOf(month, today);

  const rows: MathStudentRow[] = [];
  const allStates: MathCellState[] = [];
  const spansByStudent = new Map<string, EnrollSpan[]>();
  const withdrawnByStudent = new Map<string, string | null>();
  for (const sid of studentIds) {
    const info = studentById.get(sid);
    if (!info) continue; // 학생 행이 없으면(삭제 등) 그릴 것이 없다
    const enrollments = enrByStudent.get(sid) ?? [];
    const withdrawnAt = info.withdrawn_at ? String(info.withdrawn_at).slice(0, 10) : null;
    if (!isOnMathRosterAnyDay(enrollments, withdrawnAt, dayDates)) continue;
    spansByStudent.set(sid, mathSpansOf(enrollments, withdrawnAt));
    withdrawnByStudent.set(sid, withdrawnAt);
    const cells: Record<string, MathCellState> = {};
    const records: Record<string, MathDayRecord> = {};
    for (const date of dayDates) {
      const rec = recordByKey.get(`${sid}|${date}`);
      const state = cellStateOf({
        enrollments,
        withdrawnAt,
        date,
        attendance: foldDayAttendance(attByKey.get(`${sid}|${date}`) ?? []),
        hasReport: Boolean(rec),
        today,
        // 🔴 학원이 안 연 날 — 결석·무기록과 **다른 이유**로 비어 있다(cell-state.ts 규약).
        holiday: isHolidayOn(holidays, date),
      });
      cells[date] = state;
      allStates.push(state);
      if (rec) {
        records[date] = {
          textbook: rec.textbook ?? null,
          progress: rec.progress ?? null,
          homework: rec.homework_today ?? null,
          dailyTest: rec.daily_test ?? null,
          checkTest: rec.check_test ?? null,
          examInfo: rec.exam_info ?? null,
          homeworkScore: rec.homework_score ?? null,
          // 칸 테두리·열 머리·툴바 요약이 **같은 함수**를 통과한다(갈리면 한 화면에서 서로 다른 답이 된다).
          offGoal: isOffGoalRecord(
            { studentId: sid, date, textbook: rec.textbook ?? null, progress: rec.progress ?? null },
            goals,
          ),
        };
      }
    }
    // ── 목표 레일(Start·Plan·Now·End) — 재료를 숫자로 접는다. 판정은 goal-rail.ts.
    //    🔴 트랙(현행·선행)을 가르지 않는다 — 위치는 학년 관통 값이라 "중2 끝 → 중3 첫 단원" 목표도 한 줄로 서고,
    //    갈랐더니 다음 학년 목표를 적은 학생이 "목표 없음"으로 보였다(적대적 리뷰 2026-09-02, lesson-position.ts).
    const grade = info.grade ? String(info.grade) : null;
    const goalEnd = goalEndOf(goals[sid]?.targetProgress, grade)?.position ?? null;
    const points: RailPoint[] = [];
    for (const date of dayDates) {
      const rec = records[date];
      if (!rec) continue;
      const p = dayPositionOf(rec.progress, grade);
      if (p) points.push({ date, position: p.position });
    }
    // 달 시작 전 마지막 위치(+그 날짜) — 날짜 오름차순으로 왔으니 마지막에 본 것이 남는다.
    let prior: { position: number; date: string } | null = null;
    for (const r of priorByStudent.get(sid) ?? []) {
      const p = dayPositionOf(r.progress, grade);
      if (p) prior = { position: p.position, date: String(r.report_date).slice(0, 10) };
    }
    let rail: StudentRail | null = null;
    // 위치도 목표도 없으면 말할 것이 없다 — 빈 레일을 세우지 않는다.
    if (points.length > 0 || prior != null || goalEnd != null) {
      const built = buildGoalRail({ startBefore: prior?.position ?? null, goalEnd, points, dayDates, today });
      rail = {
        rail: built,
        // Start를 준 기록의 날짜 — 이 달 기록이 없을 때 "8/27 이후 기록 없음"이라 말하기 위해.
        startDate: prior?.date ?? points.find((p) => p.date <= today)?.date ?? null,
        startLesson: lessonNameOf(built.start),
        nowLesson: lessonNameOf(built.now),
        nowGrade: built.now == null ? null : (describePosition(built.now)?.grade ?? null),
        planLesson: lessonNameOf(built.plan),
        endLesson: lessonNameOf(built.end),
      };
    }

    rows.push({
      studentId: sid,
      name: String(info.name),
      school: info.school ? String(info.school) : null,
      grade,
      cells,
      records,
      rail,
      stalledDates: stalledDatesOf(
        dayDates
          .filter((d) => records[d])
          .map((d) => ({ date: d, progress: records[d]!.progress })),
        DEFAULT_STALL_RUN,
      ),
      rosterPhase: rosterPhaseOf(enrollments, withdrawnAt, anchor, dayDates),
      badges: [],
    });
  }

  // 신입·퇴원·반이동 표식 — **화면에 세운 학생만**. 경계가 없는 달이면 추가 쿼리가 0이다.
  if (rows.length > 0) {
    const [badgeMap, basicsMap] = await Promise.all([mathLifecycleBadges({
      admin,
      tenantId,
      classId: access.classId,
      range: { first: from, last: to },
      spansByStudent,
      withdrawnByStudent,
    }), loadMcsStudentBasics({ admin, tenantId, studentIds: rows.map(row => row.studentId), asOf: today, withdrawnByStudent })]);
    for (const row of rows) {
      row.badges = badgeMap.get(row.studentId) ?? [];
      row.basicInfo = basicsMap.get(row.studentId);
    }
  }

  // ⚠️ 종전 '진도 레일'이 읽던 `progress_containers`(현행·선행)는 더 이상 조회하지 않는다(2026-09-02) —
  //    컨테이너 위치가 실제와 어긋나 있었고(MS2A 전원 중3 인수분해 vs 컨테이너 중2 통계), 레일은
  //    `lesson_reports`에서 직접 접는다(위 rails). 왕복 하나가 줄었다(B4).

  rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));

  // 툴바 집계 — 학생마다 레일 하나의 상태(고정열 레일과 같은 값). 나간 학생은 뺀다.
  const railSummary = emptyRailSummary();
  for (const row of rows) {
    if (row.rosterPhase === "ended") continue;
    railSummary[row.rail?.rail.status ?? "no-data"] += 1;
  }

  // 🔴 열 머리 경고는 **화면에 실제로 그려지는 행**에서만 센다. 기록 전체로 세면 표에 없는 학생
  //    (그 달 내내 수강 밖인데 기록만 남은 경우)까지 세어 **경고 표시된 열에 정작 경고 칸이 없다**.
  const shownRecords: MathRecordLike[] = rows.flatMap((row) =>
    Object.entries(row.records).map(([date, rec]) => ({
      studentId: row.studentId,
      date,
      textbook: rec.textbook,
      progress: rec.progress,
    })),
  );
  const offGoalByDate = offGoalCountByDate(shownRecords, goals);

  const bookOptions: string[] = [];
  for (const rec of shownRecords) {
    const book = (rec.textbook ?? "").trim();
    if (book && !bookOptions.includes(book)) bookOptions.push(book);
  }
  bookOptions.sort((a, b) => a.localeCompare(b, "ko"));

  return {
    ok: true,
    data: {
      learningContext: {
        schedules: (schedRes.data ?? []).map((row) => ({
          dayOfWeek: String(row.day_of_week), startTime: String(row.start_time),
          endTime: row.end_time ? String(row.end_time) : null,
          validFrom: row.valid_from ? String(row.valid_from).slice(0, 10) : null,
          validTo: row.valid_to ? String(row.valid_to).slice(0, 10) : null,
        })),
        holidays: buildHolidayMap(settings.operations.holidays),
        spans: Object.fromEntries(rows.map(student => [student.studentId, (enrRes.data ?? [])
          .filter(e => String(e.student_id) === student.studentId)
          .flatMap(e => mathSpansOf([{ startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred === true }], withdrawnByStudent.get(student.studentId) ?? null)
            .map(span => ({ ...span, attendanceDays: e.attendance_days ?? null })))])),
      },
      classId: access.classId,
      className: access.className,
      month,
      monthLabel: monthLabel(month),
      today,
      teacherName: (teacherRes.data as { display_name?: string } | null)?.display_name ?? null,
      days,
      students: rows,
      goals,
      offGoalByDate,
      bookOptions,
      fill: tallyCells(allStates),
      railSummary,
      canEdit: access.canWrite,
      goalsStatus,
      elapsedDays: dayDates.filter((d) => d <= today).length,
      holidays,
      fontSize: readMcsFontSize((prefRes.data as { ui_prefs?: unknown } | null)?.ui_prefs),
    },
  };
}
