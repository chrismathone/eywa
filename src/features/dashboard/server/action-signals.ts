import "server-only";
import { judgeClassAttendanceDay } from "../unrecorded-attendance";
import { isModuleEnabled, type ModuleId } from "@/lib/modules";
import { fetchReportOptoutClassIds } from "@/features/classes/server/report-optout-ids";
import { createClient } from "@/lib/supabase/server";
import { inclusiveDateWindowStart, kstMinutesOfDay, kstToday } from "@/lib/date-kst";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { HUMAN_RESOLVED_STATUSES, STUCK_MINUTES } from "@/features/report-admin/classnote-queue";
import { getTenantSettings, getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { isHolidayOn } from "@/features/class-sheets/lib/holiday";
import { getIntakeOnDay } from "@/features/enrollment/server/intake-day";
import type { AbsentDay } from "../absent-students";
import { getAbsentStudents } from "./absent-students";
import { getDayArrivals } from "./day-arrivals-query";
import { classesWithFinishedPeriod } from "../day-recording";
import { isReportTrackedSubject } from "../report-subjects";
import { ONBOARDING_ITEMS, newcomerWindowStart, statusOf } from "@/features/newcomers/onboarding-items";
import { buildSubjectAnchors, effectiveChecks, indexChecks } from "@/features/newcomers/subject-rows";
import { loadCheckRows, loadEnrollmentSubjects, type ScopeFn } from "@/features/newcomers/server/cohort";
import { getDailyProcessingStatus } from "@/features/attendance/server/queries";
import { getUnassignedEnrolledStudents } from "./queries";
import { getTestStudentIds } from "@/features/students/server/test-students";
import {
  enrollmentAttendsOnDay,
  findMissingLessonReportPairs,
  absentClassKeysOf,
  isEnrollmentActiveOn,
  type TodayActionsRaw,
  type TodaySignalSourceIssue,
} from "../today-actions";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * makeedu 동기화 도메인 키 → 화면 한글 라벨. 원문 enum(invoices·textbook_checks…)을 그대로 노출하지
 * 않기 위한 매핑(raw 코드 노출 금지 규칙). 미등록 키는 키 그대로 폴백(새 도메인이 조용히 사라지지 않게).
 */
const DOMAIN_LABEL: Record<string, string> = {
  students: "학생",
  classes: "수업",
  enrollments: "수강",
  invoices: "수납",
  consultations: "상담",
  prospects: "예비원생",
  catalog: "교재 단가표",
  textbook_checks: "교재 체크",
  staff_attendance: "직원 출퇴근",
};

/**
 * **자동 동기화 대상이 아닌** 도메인 — 미동기 경과시간(stale) 판정에서 제외한다.
 *
 * 🔴 2026-07-31 실측: 6개 도메인이 방금(0시간) 동기화됐는데 브리핑이 "makeedu 동기화 이상"을 띄웠다.
 *    범인은 `catalog`(교재 단가표) — [scripts/_makeedu/sync-all.cjs] IMPORTERS에 **의도적으로 없는**
 *    수동 전용 도메인(tuition 기타가 이름 insert라 재실행 시 중복)이다. 수동 도메인의 synced_at은
 *    영원히 낡으므로 26시간 룰에 매일 걸린다 = **영구 오탐**(게다가 AI 팀 보고까지 매일 탈락시켰다).
 *
 * ⚠️ 상태 오류(status<>'ok')는 여전히 잡는다 — 수동이라도 "실행했는데 실패"는 진짜 신호다.
 * ⚠️ sync-all.cjs의 IMPORTERS를 늘리거나 줄이면 여기도 같이 고칠 것(진실은 그쪽 목록).
 * `staff_attendance`(직원 출퇴근)는 자동이지만 **강사평가를 쓰는 지점만** 돈다(0366a) — 기능을 끄면 그 상태 줄이 영원히 낡아 같은 영구 오탐이 된다.
 * 연동이 멈춘 것은 다른 도메인이 잡는다.
 */
const MANUAL_ONLY_DOMAINS = new Set(["catalog", "enrollments", "staff_attendance"]);

/**
 * cron(세션 없음) 주입 계약 — admin client는 RLS를 우회하므로 tenantId 명시 격리가 필수
 * (TimetableDb 선례). 미주입(대시보드 세션 경로)이면 쿠키 createClient + RLS가 격리한다.
 */
export type DashboardSignalsDb = { supabase: Supabase; tenantId: string };
/**
 * 기준 시점 주입 — 아침 cron은 '어제'를 기준일로 신호를 만든다. 시각 게이트(unwrittenReports의
 * "이미 시작한 수업")는 nowMinutes로 결정적: 지나간 날은 1440을 주입하면 전 수업이 대상이 된다.
 */
export type DashboardSignalsAsOf = { date: string; nowMinutes: number };

type TenantScope = { tenantId: string } | undefined;

/** db(admin) 주입 시에만 명시 tenant 필터 부착 — 세션 경로는 RLS가 격리(중복 필터 불필요). */
function scopeTenant<T>(query: T, db: TenantScope): T {
  if (!db) return query;
  return (query as unknown as { eq(column: string, value: unknown): unknown }).eq(
    "tenant_id",
    db.tenantId,
  ) as unknown as T;
}

export type TodayActionSignalScope = {
  attendance?: boolean;
  meetings?: boolean;
  enrollment?: boolean;
  consultations?: boolean;
  lessonReports?: boolean;
  /** 반 미배정 학생 확인 및 반 배정 조치(write) */
  students?: boolean;
  billing?: boolean;
  /** 오늘 휴가 현황(read) */
  staff?: boolean;
  /**
   * **지금 시각 기준** '오늘 출석 미기록'(끝난 교시). 생략하면 attendance와 같다(기존 호출 보존).
   * 🔴 일일 브리핑은 false로 끈다 — 어제 재생분은 `unrecordedYesterday`와 **같은 날짜·같은 쿼리**가 되고,
   *    오늘 수집분은 payload에서 어차피 비운다(같은 무거운 조회를 두 번 돌리지 않는다).
   */
  attendanceNow?: boolean;
  /** 휴가 승인 대기(manage-staff). 생략하면 staff와 같아 기존 호출을 보존한다. */
  staffApprovals?: boolean;
  owner?: boolean;
  /** 내일 발효되는 시간표 예약(read). */
  timetable?: boolean;
  /** 신규생 체크리스트 지연(read) — 0251a 미적용이면 조회가 실패해도 화면은 조용하다(fail-soft). */
  newcomers?: boolean;
};

type Collected<T> = { value: T; issue: TodaySignalSourceIssue | null };

/** 권한이 없으면 쿼리 자체를 건너뛰고, 예상 가능한 조회 실패는 0건 대신 명시적 상태로 돌려준다. */
async function collectSignal<T>(
  enabled: boolean,
  issue: TodaySignalSourceIssue,
  fallback: T,
  load: () => Promise<T>,
): Promise<Collected<T>> {
  if (!enabled) return { value: fallback, issue: null };
  try {
    return { value: await load(), issue: null };
  } catch (error) {
    console.error(`[dashboard/action-signals] ${issue.key} 조회 실패`, error);
    return { value: fallback, issue };
  }
}

function rowsOrThrow<T>(
  result: { data: T[] | null; error: { message: string } | null },
  source: string,
): T[] {
  if (result.error) throw new Error(`${source}: ${result.error.message}`);
  return result.data ?? [];
}

function countOrThrow(
  result: { count: number | null; error: { message: string } | null },
  source: string,
): number {
  if (result.error) throw new Error(`${source}: ${result.error.message}`);
  if (result.count == null) throw new Error(`${source}: exact count가 없습니다`);
  return result.count;
}

type ScheduleRow = {
  class_id: string;
  start_time: string;
  class:
    | ScheduleClass
    | ScheduleClass[]
    | null;
};
type ScheduleClass = {
  subject?: string;
  closed_at?: string | null;
  report_optout?: boolean | null;
  teacher?: { display_name?: string | null; status?: string | null } | { display_name?: string | null; status?: string | null }[] | null;
};

type ClassRef = { id?: string; class_name?: string; subject?: string | null; closed_at?: string | null };

type ClassScheduleRow = {
  class_id: string;
  class: ClassRef | ClassRef[] | null;
};

/** 어제 출결 미기록 — 모든 쿼리 오류를 위로 올려 0개 반과 구분한다. */
async function unrecordedClassesSignal(
  supabase: Supabase,
  date: string,
  db?: TenantScope,
): Promise<TodayActionsRaw["unrecordedYesterday"]> {
  const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${date}T00:00:00Z`).getUTCDay()
  ]!;
  const scheduleResult = await scopeTenant(
    supabase
      .from("class_schedules")
      // subject는 미리보기 이름 2개를 과목별로 고르게 뽑는 데 쓴다(아래 반환부 주석·gotcha #84).
      .select("class_id, class:class_id!inner ( id, class_name, subject, is_active, closed_at )")
      .eq("day_of_week", dayKey)
      .eq("class.is_active", true)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`),
    db,
  );
  const scheduleRows = rowsOrThrow(scheduleResult, `${date} schedules`) as unknown as ClassScheduleRow[];
  const classNames = new Map<string, { name: string; subject: string }>();
  for (const row of scheduleRows) {
    const klass = (Array.isArray(row.class) ? row.class[0] : row.class) ?? undefined;
    if (!klass?.id || (klass.closed_at && klass.closed_at < date)) continue;
    classNames.set(row.class_id, { name: klass.class_name ?? "?", subject: klass.subject ?? "" });
  }
  const classIds = [...classNames.keys()];
  if (classIds.length === 0) return [];

  const [enrollmentRows, attendanceRows, testStudentIds] = await Promise.all([
    fetchAllPagedInChunks<{
      id: string;
      student_id: string;
      class_id: string;
      start_date: string;
      end_date: string | null;
      on_hold: boolean;
      is_transferred: boolean;
      attendance_days: string[] | null;
    }>(classIds, (chunk, from, to) =>
      scopeTenant(
        supabase
          .from("enrollments")
          .select("id, student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days")
          .lte("start_date", date)
          .in("class_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
        db,
      ),
    ),
    fetchAllPagedInChunks<{ id: string; student_id: string; class_id: string }>(classIds, (chunk, from, to) =>
      scopeTenant(
        supabase
          .from("attendance_records")
          .select("id, student_id, class_id")
          .eq("session_date", date)
          .in("class_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
        db,
      ),
    ),
    // 🔴 테스트 학생(`students.is_test`)은 예정 명단에서 뺀다(원장 2026-09-14 — 오늘 출결·처리현황과 같은 축).
    //    목적지(`/attendance/{어제}` 처리 현황·어제 출결)에서 그 반이 빠졌으니 여기서도 세면 숫자가 갈린다.
    //    admin(cron) 경로는 tenantId가 유일한 격리선이라 반드시 넘긴다. 조회 실패 = 빈 집합(fail-open) = 지금 동작.
    getTestStudentIds(supabase, db?.tenantId),
  ]);
  // 명단·미입력 판정은 '강사별 업무 현황'의 출결 미입력 행과 같은 함수(unrecorded-attendance.ts — 같은 원본).
  // 테스트 학생은 판정(그날 유효·등원 요일) 뒤에 뺀다 — 테스트 학생뿐인 반은 명단이 비어 행째 빠진다(수강 없는 반과 같은 결과).
  const enrollmentsByClass = new Map<string, typeof enrollmentRows>();
  for (const row of enrollmentRows) enrollmentsByClass.set(row.class_id, [...(enrollmentsByClass.get(row.class_id) ?? []), row]);
  const recordedByClass = new Map<string, Set<string>>();
  for (const row of attendanceRows) {
    const students = recordedByClass.get(row.class_id) ?? new Set<string>();
    students.add(row.student_id);
    recordedByClass.set(row.class_id, students);
  }

  // ⚠️ 이름순 정렬을 유지하되 subject를 함께 실어 보낸다. 소비처(today-actions)가 미리보기 이름을
  // 2개만 노출하는데, ICU 한국어 정렬은 한글을 로마자보다 앞에 둬서 그냥 앞 2개를 뽑으면 **항상
  // 한글 이름 반(수학)**만 뜨고 영어반은 미기록이 아무리 많아도 '외 N'에 묻힌다(gotcha #84).
  // 그래서 자르는 일은 소비처가 과목별로 고르게 한다 — 여기선 정렬만 하고 카테고리 정보를 넘긴다.
  return classIds.flatMap((classId) => {
    const { unrecorded } = judgeClassAttendanceDay({
      enrollments: enrollmentsByClass.get(classId) ?? [],
      recorded: recordedByClass.get(classId) ?? new Set<string>(),
      date,
      dayKey,
      excluded: testStudentIds,
    });
    const klass = classNames.get(classId);
    return unrecorded
      ? [{ classId, className: klass?.name ?? "?", subject: klass?.subject ?? "" }]
      : [];
  }).sort((a, b) => a.className.localeCompare(b.className, "ko"));
}

/**
 * 오늘 미작성 보고서 신호.
 * 시작된 활성 수업의 기준일 유효 수강생을 학생×과목으로 만들고, 그 과목 반이 전부 결석인 학생은 제외한다.
 * lesson_reports에는 class_id가 없으므로 같은 과목 여러 반은 한 대상으로 합친다.
 * ⚠️ **aywa에 보고서를 쓰는 과목만** 센다(report-subjects.ts) — 영어는 ClassNote에 직접 쓰므로
 *    여기선 늘 0건이라, 세면 신호가 아니라 소음이 된다.
 */
/**
 * 오늘 **이미 끝난 교시인데 아직 다 못 찍은 반** — 운영실 검토 2026-09-09 합의 1순위.
 *
 * 🔑 명단·기록 판정은 **새로 짜지 않고** 출결 정본 [`getDailyProcessingStatus`](../../attendance/server/queries.ts)를
 *    그대로 쓴다 — 헤더의 `처리 중 N/M`과 **같은 소스**라야 한 화면에서 두 숫자가 어긋나지 않는다
 *    (그 함수는 요청 캐시라 한 화면에서 두 번 불러도 계산은 한 번이다).
 * 🔴 여기서 더하는 것은 **시각 축 하나**뿐이다: 아직 안 끝난 교시를 세면 130반 규모의 거짓 경보가 된다.
 * ⚠️ 정본이 세션 클라이언트 전용이라 이 신호는 **cron(admin db) 경로에서 못 쓴다** — 그래서 브리핑은
 *    `attendanceNow: false`로 끈다(그쪽은 이 신호를 payload에서 어차피 비운다).
 */
async function unrecordedTodaySignal(
  supabase: Supabase,
  date: string,
  nowMinutes: number,
  db?: TenantScope,
): Promise<TodayActionsRaw["unrecordedToday"]> {
  const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${date}T00:00:00Z`).getUTCDay()
  ]!;
  // 가벼운 시각 조회 — 반 메타·명단은 정본이 들고 온다.
  const slotResult = await scopeTenant(
    supabase
      .from("class_schedules")
      .select("class_id, start_time, end_time")
      .eq("day_of_week", dayKey)
      .lte("valid_from", date)
      .or(`valid_to.is.null,valid_to.gte.${date}`),
    db,
  );
  const slots = rowsOrThrow(slotResult, `${date} slot times`) as {
    class_id: string;
    start_time: string | null;
    end_time: string | null;
  }[];
  const finished = classesWithFinishedPeriod(
    slots.map((row) => ({ classId: row.class_id, startTime: row.start_time, endTime: row.end_time })),
    nowMinutes,
  );
  if (finished.size === 0) return []; // 아직 끝난 교시가 없다 — 무거운 조회를 아예 안 돈다.

  const processing = await getDailyProcessingStatus(date);
  return processing
    .filter((row) => row.unprocessed > 0 && finished.has(row.classId))
    .map((row) => ({ classId: row.classId, className: row.className, subject: row.subject }))
    .sort((a, b) => a.className.localeCompare(b.className, "ko"));
}

/**
 * 오늘 **첫 수업 · 마지막 수업** 학생 — 왕복 2회.
 * ① 오늘 시작/종료하는 수강에서 **학생 id만** 뽑고 ② 그 학생들의 **수강 전건**을 받아 순수 함수가 판정한다.
 * 🔴 ①만으로 판정하면 반을 하나 더 받은 학생이 '첫 수업', 반 하나만 뺀 학생이 '마지막 수업'이 된다
 *    (실측 2026-09-09 — day-arrivals.ts 주석).
 * ⚠️ 둘 다 상한 없는 조회다 — 큰 `.in()`은 청크로 나누고(414), 청크 안에서도 **페이지네이션**한다(1000행 절단).
 */
async function dayArrivalsSignal(
  supabase: Supabase,
  date: string,
  db?: TenantScope,
): Promise<TodayActionsRaw["dayArrivals"]> {
  // 🔴 운영실 KPI '오늘첫수업'·원생목록 `first=`와 **같은 함수**(getDayArrivals — getFirstClassStudents는 그 `.starting`)다.
  //    '첫 수업' = 첫 등원 + 새 과목 — 같은 이름의 두 숫자가 갈리면 안 된다(원장 규칙: 링크까지 숫자가 같아야 한다).
  //    조회 규약(상한 없음·청크 × 페이징)도 거기 있다. 과목 묶음은 학원설정(cron은 테넌트 id로 읽는다).
  const settings = db ? getTenantSettingsByTenantId(db.tenantId) : getTenantSettings();
  return getDayArrivals(
    date,
    settings.then((s) => s.operations.subjects),
    { supabase, tenantId: db?.tenantId },
  );
}

/**
 * **내일** 발효되는 시간표 예약 — 판정 축은 미래 `class_schedules` 행이 아니라 **스냅샷**이다
 * (취소가 곧 스냅샷 롤백이라 화면에 띄운 것과 되돌릴 것이 같은 물건이어야 한다 — scheduled-import-queries.ts).
 * 🔴 오늘 발효분은 cron이 이미 적용했으므로 세지 않는다. 알아야 하는 건 "내일 아침 뭐가 바뀌나"다.
 * ⚠️ 그 조회를 그대로 부르지 않는 이유: 세션 클라이언트 전용이라 admin `db`로 도는 브리핑에선 조용히 0건이 된다.
 */
/**
 * **신규생 체크리스트 지연** — 등록 후 90일 안 학생 중 기한이 지난 필수 항목이 하나라도 있는 사람.
 *
 * 원장 2026-09-09: *"당연히 운영실에서 관리되고 있는지 관리 안되고있는지 확인해야겠지?"*
 * 🔴 판정은 화면과 **같은 순수 함수**([`onboarding-items.ts`])를 쓴다 — 여기서 기한을 다시 계산하면
 *    운영실과 탭이 다른 수를 말한다. 조회만 다르고(운영실은 admin 주입 경로가 있다) 규칙은 한 벌이다.
 * 🔴 '필요시' 항목(2개월 콜)은 세지 않는다 — 선택 항목을 재촉하면 매달 전원이 빨갛게 된다.
 * ⚠️ 0251a 미적용이면 체크 표가 없다 → 조회가 throw하고 `collectSignal`이 그 신호만 조용히 비운다
 *    (다른 신호는 그대로 산다). 표가 생기는 날부터 저절로 켜진다.
 */
async function newcomerOverdueSignal(
  supabase: Supabase,
  today: string,
  db: TenantScope,
): Promise<TodayActionsRaw["newcomerOverdue"]> {
  // 🔴 창은 신규생 탭과 **같은 함수**에서 온다 — 하루가 어긋나면 경계의 학생이 한쪽에만 뜬다.
  const since = newcomerWindowStart(today);
  const students = await fetchAllPaged<{ id: string; name: string; enrolled_at: string | null }>((from, to) =>
    scopeTenant(
      supabase
        .from("students")
        .select("id, name, enrolled_at")
        .in("status", ["enrolled", "on_hold"])
        .gte("enrolled_at", since)
        .order("enrolled_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
      db,
    ),
  );
  if (students.length === 0) return { count: 0, names: [] };
  const ids = students.map((s) => s.id);

  // 🔴 수강(과목)·체크는 신규생 탭과 **같은 조회·같은 규칙**이다([`cohort.ts`](../../newcomers/server/cohort.ts),
  //    0256a 과목별) — 한쪽만 과목을 알면 탭은 "영어 사전 콜 대기"인데 운영실은 "완료"라고 말한다.
  //    admin 경로라 테넌트 필터가 **유일한 격리선**이다(scopeTenant).
  const scope: ScopeFn = (q) => scopeTenant(q, db);
  const [enrollments, checksResult] = await Promise.all([
    loadEnrollmentSubjects(supabase, ids, scope),
    loadCheckRows(supabase, ids, scope),
  ]);
  // 🔴 0251a 미적용은 **실패가 아니라 "아직 켜지지 않음"** 이다 — throw로 두면 브리핑이 매일 '신호 실패'를
  //    보고해 진짜 실패가 그 잡음에 묻힌다. 표가 없을 때만 조용히 0으로 접고, 다른 실패는 그대로 올린다.
  //    (0256a 미적용 — 과목 칸만 없는 것 — 은 조회 쪽이 알아서 옛 모양으로 다시 읽는다.)
  if (!checksResult.ok) {
    const e = checksResult.error;
    const raw = e instanceof Error ? e.message : String(e);
    if (/PGRST205|PGRST20[12]|42P01|does not exist|Could not find the table/i.test(raw)) return { count: 0, names: [] };
    throw e;
  }
  // 탭과 같은 인자 — 끝난 과목은 줄이 없어야 두 화면이 같은 학생을 같게 말한다.
  const { bySubject, earliest } = buildSubjectAnchors(enrollments, today);
  const checkIndex = indexChecks(checksResult.rows);

  const names: string[] = [];
  for (const s of students) {
    const enrolledOn = s.enrolled_at ? String(s.enrolled_at).slice(0, 10) : null;
    if (!enrolledOn) continue;
    const subjMap = bySubject.get(s.id);
    const subjects: (string | null)[] = subjMap && subjMap.size > 0 ? [...subjMap.keys()] : [null];
    // 🔴 **한 과목이라도 지연이면 그 학생은 지연**이다 — 과목을 접어 한 줄로 판정하면 늦게 시작하는
    //    과목의 콜이 기한 전인데 '지연'이 되고(첫 수업일을 앞 과목에서 빌려 쓴다), 반대로 한 과목만 한 콜이
    //    '완료'가 된다. 과목마다 **제 첫 수업일·제 체크**로 판정한다(탭의 과목 행과 같은 재료).
    const overdue = subjects.some((subject) => {
      const firstClassOn = subject ? (subjMap?.get(subject) ?? null) : (earliest.get(s.id) ?? null);
      const done = effectiveChecks(checkIndex, s.id, subject);
      return ONBOARDING_ITEMS.some(
        (item) =>
          !item.optional && statusOf(item, { enrolledOn, firstClassOn }, done[item.key], today) === "overdue",
      );
    });
    if (overdue) names.push(s.name);
  }
  return { count: names.length, names };
}

async function scheduledTomorrowSignal(
  supabase: Supabase,
  tomorrow: string,
  db?: TenantScope,
): Promise<TodayActionsRaw["scheduledTomorrow"]> {
  const snapResult = await scopeTenant(
    supabase
      // payload를 통째로 읽지 않는다 — 배치 스냅샷 payload엔 before/apply 전체가 들어 있어 무겁다.
      .from("timetable_snapshots")
      .select("id, kind:payload->>kind")
      .eq("reference_date", tomorrow),
    db,
  );
  const snaps = rowsOrThrow(snapResult, "scheduled tomorrow") as unknown as { id: string; kind: string | null }[];
  if (snaps.length === 0) return null;
  const logResult = await scopeTenant(
    supabase
      .from("timetable_import_logs")
      .select("snapshot_id")
      .in(
        "snapshot_id",
        snaps.map((snap) => snap.id),
      )
      .not("restored_at", "is", null),
    db,
  );
  const restored = new Set(
    (rowsOrThrow(logResult, "scheduled tomorrow logs") as { snapshot_id: string }[]).map((row) => row.snapshot_id),
  );
  const live = snaps.filter((snap) => !restored.has(snap.id));
  if (live.length === 0) return null;
  return {
    date: tomorrow,
    // 배치 스냅샷만 payload.kind를 갖는다(`english_structure`). 반이동은 diff라 kind가 없다.
    hasStructure: live.some((snap) => !!snap.kind),
    hasEnrollment: live.some((snap) => !snap.kind),
  };
}

async function unwrittenReportsSignal(
  supabase: Supabase,
  today: string,
  nowMinutes: number,
  db?: TenantScope,
  trackedSubjects?: readonly string[] | null,
  exemptTeachers?: readonly string[] | null,
): Promise<TodayActionsRaw["unwrittenReportsToday"]> {
  const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    new Date(`${today}T00:00:00Z`).getUTCDay()
  ]!;
  const scheduleResult = await scopeTenant(
    supabase
      .from("class_schedules")
      .select(
        `class_id, start_time,
       class:class_id!inner ( subject, is_active, closed_at, report_optout, teacher:teacher_id ( display_name, status ) )`,
      )
      .eq("day_of_week", dayKey)
      .eq("class.is_active", true)
      .lte("valid_from", today)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .order("start_time"),
    db,
  );
  const scheduleRows = rowsOrThrow(scheduleResult, "lesson report schedules") as unknown as ScheduleRow[];
  const exempt = new Set((exemptTeachers ?? []).map((name) => name.trim()).filter(Boolean));
  const subjectByClass = new Map<string, string>();
  for (const row of scheduleRows) {
    const klass = (Array.isArray(row.class) ? row.class[0] : row.class) ?? undefined;
    // 🔴 '수업보고서 미발송' 반(0174a)은 재촉하지 않는다. 이 신호는 작성률(report-admin/queries)과
    //    **완전히 별도 경로**라, 여기를 빼먹으면 표에선 사라진 반을 대시보드·일일 브리핑이 계속 재촉해
    //    두 화면이 서로 다른 말을 한다(2026-07-22 재발 패턴).
    if (!klass?.subject || (klass.closed_at && klass.closed_at < today) || klass.report_optout) continue;
    // 🔴 aywa에 보고서를 쓰지 않는 과목은 세지 않는다(원장 2026-08-29 "영어보고서는 운영실에서 제외").
    //    영어 강사는 ClassNote에 직접 쓰므로 lesson_reports가 늘 0건 — 세면 매일 140명이 '미작성'으로
    //    잡혀 진짜 미작성(수학 32명)이 그 안에 묻힌다. 축은 학원설정(report.classnoteSubjects).
    if (!isReportTrackedSubject(klass.subject, trackedSubjects)) continue;
    // 🔴 작성 예외 강사(학원설정 report.writingExemptTeachers) · 퇴사한 담임의 반은 세지 않는다 — 작성률 카드와 같은 규칙
    //    (점검 2026-09-28: 카드는 빼고 운영실은 세서 두 화면이 서로 다른 '미작성'을 말했다). 귀속은 반 담임.
    const teacher = (Array.isArray(klass.teacher) ? klass.teacher[0] : klass.teacher) ?? null;
    const teacherName = teacher?.display_name?.trim() ?? "";
    if (teacher?.status === "inactive" || (teacherName && exempt.has(teacherName))) continue;
    const [hour, minute] = row.start_time.slice(0, 5).split(":").map(Number);
    const startMinutes = (hour ?? Number.NaN) * 60 + (minute ?? Number.NaN);
    if (!Number.isFinite(startMinutes) || nowMinutes < startMinutes) continue;
    subjectByClass.set(row.class_id, klass.subject);
  }

  const classIds = [...subjectByClass.keys()];
  if (classIds.length === 0) return { count: 0, names: [], bySubject: [] };

  // B2: 이 조회는 end_date 필터 없이 과거 수강 이력까지 받아 JS로 거른다 — 청크 1개 응답이 1000행을
  // 넘으면 silent 절단돼 '오늘 미작성 보고서' 명단이 조용히 샌다. 같은 데이터를 읽는
  // unrecordedClassesSignal·getDailyProcessingStatus와 동일하게 fetchAllPagedInChunks(페이징)로.
  const [enrollmentRows, testStudentIds] = await Promise.all([
    fetchAllPagedInChunks<{
      student_id: string;
      class_id: string;
      start_date: string;
      end_date: string | null;
      on_hold: boolean;
      is_transferred: boolean;
      attendance_days: string[] | null;
    }>(classIds, (chunk, from, to) =>
      scopeTenant(
        supabase
          .from("enrollments")
          .select("student_id, class_id, start_date, end_date, on_hold, is_transferred, attendance_days")
          .lte("start_date", today)
          .in("class_id", chunk),
        db,
      )
        // OFFSET 페이지 안정화 — unique tie-break order 필수(batch.ts 계약)
        .order("id")
        .range(from, to),
    ),
    // 🔴 판정은 **공용 한 벌**([`getTestStudentIds`](../../students/server/test-students.ts)) — 알림 4경로
    //    (미발송 재촉·미수 경보·교차 출결·출석 완료)와 같은 축을 써야 "집계에선 뺐는데 알림은 센다"가
    //    안 생긴다(원장 2026-09-13). 조회 실패는 그 함수가 fail-open으로 삼킨다(아래 ⚠️).
    getTestStudentIds(supabase, db?.tenantId),
  ]);
  // 🔴 테스트 학생(`students.is_test` — 예: ClassNote 발송 시험용 '학원이')은 세지 않는다.
  //    2026-09-01 원장 지시로 "모든 선생님이 테스트할 수 있게" 학원이가 반 15개(수학 9)에 배정되면서,
  //    안 빼면 요일에 따라 **매일 2~5명이 '미작성'으로 잡혀** 진짜 미작성(수학 30여 명)이 그 안에 묻힌다.
  //    리포의 다른 집계는 이미 같은 축으로 뺀다(report-admin 작성률·todays-math·failed-notify-sweep).
  // ⚠️ **fail-open** — 조회가 실패하면 아무도 빼지 않는다(집계는 fail-open이 규약, report-subjects 주석
  //    참조). 여기서 throw하면 테스트 학생 명단 한 번 못 읽었다고 그날 '미작성' 신호가 통째로 사라진다.
  const targets = enrollmentRows
    .filter((row) => !testStudentIds.has(row.student_id))
    .filter(
      (row) =>
        isEnrollmentActiveOn(
          {
            startDate: row.start_date,
            endDate: row.end_date,
            onHold: row.on_hold,
            isTransferred: row.is_transferred,
          },
          today,
        ) && enrollmentAttendsOnDay(row.attendance_days, dayKey),
    )
    .map((row) => ({
      studentId: row.student_id,
      classId: row.class_id,
      subject: subjectByClass.get(row.class_id)!,
    }));
  const studentIds = [...new Set(targets.map((target) => target.studentId))];
  if (studentIds.length === 0) return { count: 0, names: [], bySubject: [] };

  const [attendanceRows, reportRows, optoutIds] = await Promise.all([
    fetchInChunks<{
      id: string;
      student_id: string;
      class_id: string;
      session_date: string;
      slot_start: string | null;
      status: string;
      recorded_at: string;
    }>(
      studentIds,
      (chunk) =>
        scopeTenant(
          supabase
            .from("attendance_records")
            .select("id, student_id, class_id, session_date, slot_start, status, recorded_at")
            .eq("session_date", today)
            .in("student_id", chunk)
            .order("recorded_at", { ascending: false })
            .order("id", { ascending: false }),
          db,
        ),
    ),
    // 오늘 쓴 보고서 + 다른 날 쓰고 오늘을 지정한 보고서(covers_date, 0136a) — 미리 쓴 보고서는 오늘 의무를 끝낸다.
    fetchInChunks<{
      student_id: string;
      subject: string | null;
      report_date: string;
      covers_date: string | null;
      class_id: string | null;
    }>(
      studentIds,
      (chunk) =>
        scopeTenant(
          supabase
            .from("lesson_reports")
            .select("student_id, subject, report_date, covers_date, class_id")
            .or(`report_date.eq.${today},covers_date.eq.${today}`)
            .in("student_id", chunk),
          db,
        ),
    ),
    fetchReportOptoutClassIds(supabase, db?.tenantId),
  ]);

  // 결석한 반 = 최신 정정 기준 · 그 반 교시가 전부 결석(공용 `absentClassKeysOf`). 다른 반의 결석은 이 수업 대상과 무관하다.
  const absentClassKeys = absentClassKeysOf(attendanceRows.filter((row) => subjectByClass.has(row.class_id)));
  const missingPairs = findMissingLessonReportPairs(
    targets,
    absentClassKeys,
    // 미발송 반(0174a) 보고서는 다른 반 의무를 채우거나 면제하지 않는다 — 작성률 카드와 같은 규약(class_id 없으면 둔다).
    reportRows.filter((row) => !row.class_id || !optoutIds.has(row.class_id)).map((row) => ({
      studentId: row.student_id,
      subject: row.subject,
      reportDate: String(row.report_date).slice(0, 10),
      coversDate: row.covers_date ? String(row.covers_date).slice(0, 10) : null,
    })),
    today,
  );
  // 건수·명단은 예전과 같은 **학생 단위**(dedupe), 분해만 학생×과목 쌍으로 센다.
  const missingStudentIds = [...new Set(missingPairs.map((pair) => pair.studentId))];
  const bySubjectMap = new Map<string, number>();
  for (const pair of missingPairs) bySubjectMap.set(pair.subject, (bySubjectMap.get(pair.subject) ?? 0) + 1);
  const bySubject = [...bySubjectMap].map(([subject, count]) => ({ subject, count }));
  if (missingStudentIds.length === 0) return { count: 0, names: [], bySubject: [] };

  const studentRows = await fetchInChunks<{ id: string; name: string }>(missingStudentIds.slice(0, 100), (chunk) =>
    scopeTenant(supabase.from("students").select("id, name").in("id", chunk), db),
  );
  const nameById = new Map(studentRows.map((student) => [student.id, student.name]));
  return {
    count: missingStudentIds.length,
    names: missingStudentIds.slice(0, 100).map((id) => nameById.get(id) ?? "(학생)"),
    bySubject,
  };
}

/** KST 날짜 문자열에서 n일 전(YYYY-MM-DD) — 결정적 UTC 산술(date-kst 주석 규칙). */
function daysBefore(ymd: string, n: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * "오늘 조치할 것" 원시 신호 수집. 독립 조회는 병렬로 실행하고, scope=false 도메인은 DB 호출도 하지 않는다.
 * 조회 실패는 해당 도메인의 sourceIssues로 반환해 빈 배열/0건과 구분한다.
 *
 * opts.db = cron(세션 없음) 경로: admin client + 명시 tenant 필터(scopeTenant). ⚠️ 새 쿼리를 추가하면
 * 반드시 scopeTenant를 감쌀 것 — admin은 RLS 우회라 한 곳만 빠져도 교차 테넌트 누수다.
 * opts.asOf = 기준 시점 주입: 아침 브리핑 cron이 '어제'를 기준일로 수집할 때 사용(미주입 = 지금·오늘).
 */
export async function getTodayActionSignals(
  scope: TodayActionSignalScope = {},
  opts?: { db?: DashboardSignalsDb; asOf?: DashboardSignalsAsOf },
): Promise<TodayActionsRaw> {
  const db = opts?.db;
  const supabase = db?.supabase ?? (await createClient());
  const today = opts?.asOf?.date ?? kstToday();
  const nowMinutes = opts?.asOf?.nowMinutes ?? kstMinutesOfDay();
  const yesterday = daysBefore(today, 1);
  const tomorrow = daysBefore(today, -1); // 음수 = 하루 뒤(내일 발효 예약 조회용)
  const sevenDayStart = inclusiveDateWindowStart(today, 7);
  const failedCutoff = `${sevenDayStart}T00:00:00+09:00`;
  const enabled = (key: keyof TodayActionSignalScope) => scope[key] !== false;
  // 보고서 신호가 셀 과목(학원설정 report.classnoteSubjects). 🔴 fail-soft — 설정 조회가 실패해도
  //    신호를 죽이지 않는다. null이면 isReportTrackedSubject가 전부 센다(지금까지의 동작).
  // 설정은 한 번만 읽는다(cron db 경로는 요청 캐시가 없다) — 아래 세 판정이 같은 약속을 나눠 쓴다.
  const settingsP = db ? getTenantSettingsByTenantId(db.tenantId) : getTenantSettings();
  void settingsP.catch(() => undefined); // 소비처마다 catch — 처리 안 된 거절로 새지 않게
  const reportSettings = enabled("lessonReports")
    ? await settingsP
        .then((st) => ({ tracked: st.report.classnoteSubjects ?? null, exempt: st.report.writingExemptTeachers ?? [] }))
        .catch(() => null)
    : null;
  const trackedSubjects = reportSettings?.tracked ?? null;
  const exemptTeachers = reportSettings?.exempt ?? null;
  /**
   * 🔴 **학원 휴일엔 재촉하지 않는다.** 이 두 신호("오늘 미작성 보고서"·"어제 출결 미기록")는
   *    시간표 슬롯만 보고 세므로 휴원일에도 그날 배정된 반을 전부 미작성으로 잡아 거짓 경보가 뜬다.
   *    규약은 새로 짓지 않는다 — 강사 시트·작성률이 쓰는 그대로(원장 2026-07-22): **안 쓴 휴일 =
   *    대상 0**(의무가 없다). 판정 자료는 학원설정 `operations.holidays` **하나뿐**이고
   *    `features/calendar/holidays.ts`의 내장 법정공휴일 표는 쓰지 않는다(법정공휴일 ≠ 학원 휴원일 —
   *    이 학원은 실제로 공휴일에 수업한다).
   * ⚠️ fail-soft — 설정 조회가 실패하면 `null`이라 종전처럼 전부 평일로 본다(신호를 죽이지 않는다).
   * ⚠️ `getTenantSettings`는 요청 캐시 + 테넌트 캐시라 위 `trackedSubjects`와 같은 조회를 공유한다(왕복 0).
   */
  const holidayMap = await settingsP
    .then((st) => buildHolidayMap(st.operations.holidays))
    .catch(() => null);
  // 기능(모듈)이 꺼진 학원엔 그 기능의 신호가 없다(원장 2026-09-30 "꺼지면 있었는지조차 모르게").
  // 메뉴를 가진 모듈은 권한 캡으로 이미 scope가 false다 — 여기는 **메뉴 없이 면만 가진** 모듈(ClassNote·기존 휴가·makeedu 배지).
  // fail-soft: 설정 조회가 실패하면 빈 목록(= 전부 켜짐, 침산과 같은 쪽)으로 종전처럼 센다.
  const disabledModules = await settingsP
    .then((st) => st.modules.disabled)
    .catch(() => [] as ModuleId[]);
  const moduleOn = (id: ModuleId) => isModuleEnabled(disabledModules, id);
  const staffApprovalsEnabled = (scope.staffApprovals ?? enabled("staff")) && moduleOn("staff_leaves");
  const attendanceNowEnabled = scope.attendanceNow ?? enabled("attendance");

  const failedCount = async (
    table: "meeting_minutes" | "enrollment_consultations" | "student_consultations",
  ): Promise<number> => {
    const result = await scopeTenant(
      supabase
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq("processing_status", "failed")
        .gte("updated_at", failedCutoff),
      db,
    );
    return countOrThrow(result, table);
  };


  const [
    absent,
    dailyProcessing,
    failedMeetings,
    failedEnrollment,
    failedConsultations,
    makeedu,
    textbooks,
    leavesPending,
    leavesToday,
    unwrittenReports,
    unassignedEnrolled,
    classnoteAttention,
    unrecordedTodayClasses,
    dayArrivals,
    newIntake,
    newcomerOverdue,
    scheduledTomorrow,
  ] = await Promise.all([
    collectSignal(
      enabled("attendance"),
      {
        key: "attendance-today",
        label: "오늘 출결",
        href: "/attendance?list=1",
        menuKey: "attendance",
        requiredAccess: "read",
      },
      { absent: [], partial: [] } as AbsentDay,
      // 출석부 `?status=absent`와 **같은 함수** — 결석·공결, 칸(교시)별 최신 정정, 학생 단위 접기.
      // ⚠️ 2026-09-11부터: 공결도 세고(입력은 2026-07-10 폐지 — 옛 행·정정분만), **한 교시도 안 온 학생만** 센다
      //    (일부 교시 결석은 `partial`로 빠진다 — 아래 absentToday는 `absent` 무리만 싣는다).
      () => getAbsentStudents(today, { supabase, tenantId: db?.tenantId }),
    ),
    collectSignal(
      enabled("attendance"),
      {
        key: "attendance-yesterday",
        label: "어제 출결 처리",
        href: `/attendance/${yesterday}`,
        menuKey: "attendance",
        requiredAccess: "read",
      },
      [] as TodayActionsRaw["unrecordedYesterday"],
      () =>
        isHolidayOn(holidayMap, yesterday)
          ? Promise.resolve([] as TodayActionsRaw["unrecordedYesterday"])
          : unrecordedClassesSignal(supabase, yesterday, db),
    ),
    collectSignal(
      enabled("meetings"),
      {
        key: "meeting-analysis",
        label: "회의 분석",
        href: "/meetings",
        menuKey: "meetings",
        requiredAccess: "write",
      },
      0,
      () => failedCount("meeting_minutes"),
    ),
    collectSignal(
      enabled("enrollment"),
      {
        key: "enrollment-analysis",
        label: "신규 콜&상담 분석",
        href: "/enrollment?view=kanban", // 칸반 고정 — 저장된 보기(view-pref.ts)와 무관하게 카드로
        menuKey: "enrollment",
        requiredAccess: "write",
      },
      0,
      () => failedCount("enrollment_consultations"),
    ),
    collectSignal(
      enabled("consultations"),
      {
        key: "consultation-analysis",
        label: "학생상담 분석",
        href: "/consultations?list=1",
        menuKey: "consultations",
        requiredAccess: "write",
      },
      0,
      () => failedCount("student_consultations"),
    ),
    collectSignal(
      enabled("owner") && moduleOn("makeedu"),
      {
        key: "makeedu-sync",
        label: "makeedu 동기화",
        href: "/owner?tab=sheets&sub=makeedu",
        menuKey: "owner",
        requiredAccess: "read",
      },
      { syncEnabled: false, rows: [] as { domain: string; status: string; synced_at: string }[] },
      async () => {
        const [stateResult, toggleResult] = await Promise.all([
          scopeTenant(supabase.from("makeedu_sync_state").select("domain, status, synced_at"), db),
          scopeTenant(
            supabase.from("user_integrations").select("sync_enabled").eq("provider", "makeedu"),
            db,
          ).maybeSingle(),
        ]);
        const rows = rowsOrThrow(stateResult, "makeedu state") as {
          domain: string;
          status: string;
          synced_at: string;
        }[];
        if (toggleResult.error) throw new Error(`makeedu toggle: ${toggleResult.error.message}`);
        return {
          syncEnabled: (toggleResult.data?.sync_enabled as boolean | undefined) ?? true,
          rows,
        };
      },
    ),
    // 🔴 '지출 결재 대기'는 **운영실에서 뺐다**(원장 2026-08-29). 카드를 지우면서 조회도 함께 지운다 —
    //    안 쓰는 신호를 계속 세면 왕복만 늘고, 남아 있으면 다음 사람이 "왜 안 보이지"로 헤맨다.
    //    결재 자체는 /billing 지출 탭 그대로. 되살릴 땐 여기 수집 + today-actions.ts 카드를 함께.
    collectSignal(
      enabled("billing"),
      {
        key: "requested-textbooks",
        label: "교재 신청",
        href: "/billing?tab=textbooks&status=requested",
        menuKey: "billing",
        requiredAccess: "write",
      },
      0,
      async () => {
        const result = await scopeTenant(
          supabase
            .from("textbook_orders")
            .select("*", { count: "exact", head: true })
            .eq("status", "requested"),
          db,
        );
        return countOrThrow(result, "requested textbooks");
      },
    ),
    collectSignal(
      staffApprovalsEnabled,
      {
        key: "pending-leaves",
        label: "휴가 승인",
        href: "/staff/leaves",
        menuKey: "staff",
        requiredAccess: "manage-staff",
      },
      0,
      async () => {
        const result = await scopeTenant(
          supabase
            .from("staff_leaves")
            .select("*", { count: "exact", head: true })
            .is("approved_at", null)
            .gte("ends_on", today),
          db,
        );
        return countOrThrow(result, "pending leaves");
      },
    ),
    collectSignal(
      enabled("staff") && moduleOn("staff_leaves"),
      {
        key: "today-leaves",
        label: "오늘 휴가",
        href: "/staff/leaves",
        menuKey: "staff",
        requiredAccess: "read",
      },
      [] as { user: { display_name?: string } | { display_name?: string }[] | null }[],
      async () => {
        const result = await scopeTenant(
          supabase
            .from("staff_leaves")
            .select("user:user_id ( display_name )")
            .not("approved_at", "is", null)
            .lte("starts_on", today)
            .gte("ends_on", today)
            .limit(20),
          db,
        );
        return rowsOrThrow(result, "today approved leaves");
      },
    ),
    collectSignal(
      enabled("lessonReports"),
      {
        key: "lesson-reports",
        label: "수업보고서 작성",
        href: "/lesson-reports?tab=writing",
        menuKey: "lesson_reports",
        requiredAccess: "read",
      },
      { count: 0, names: [], bySubject: [] },
      () =>
        isHolidayOn(holidayMap, today)
          ? Promise.resolve({ count: 0, names: [], bySubject: [] })
          : unwrittenReportsSignal(supabase, today, nowMinutes, db, trackedSubjects, exemptTeachers),
    ),
    collectSignal(
      enabled("students"),
      {
        key: "unassigned-enrolled",
        label: "반 미배정 재원생",
        href: "/students?list=1",
        menuKey: "students",
        requiredAccess: "write",
      },
      { students: [] as { studentId: string; name: string }[], total: 0 },
      // students 기준 anti-join RPC(0097a). 등록상담이 아니라 학생이 출처다.
      // db(cron) 경로는 p_tenant 변형 RPC — 세션용 RPC는 service_role에서 에러 없이 0행(silent 오보).
      // ⚠️ 30은 **미리보기 상한**이다 — 건수는 반드시 total(0159a)에서 온다(배열 길이 사용 금지).
      () => getUnassignedEnrolledStudents(30, db ? { supabase: db.supabase, tenantId: db.tenantId } : undefined),
    ),
    collectSignal(
      enabled("lessonReports") && moduleOn("classnote"),
      {
        key: "classnote-attention",
        label: "리포트 발송 큐",
        href: "/lesson-reports?tab=writing",
        menuKey: "lesson_reports",
        requiredAccess: "read",
      },
      { failed: 0, tooOld: 0, humanHold: 0, stuck: 0 },
      async () => {
        // 판정 기준은 classnote-queue.ts와 동일: failed/too_old는 7일 창(분석실패 신호 관례와 동형),
        // 사람 조치 보류(blocked_shared·name_conflict)는 **창 없음**(3일 창 때문에 재발송 버튼과 함께
        // 행이 사라져 해소 불가능해진 실사고 교훈), 멈춤 = processing 10분 초과. 전부 head-count(B2).
        const stuckCutoff = new Date(Date.now() - STUCK_MINUTES * 60_000).toISOString();
        const [failedRes, tooOldRes, holdRes, stuckRes] = await Promise.all([
          scopeTenant(
            supabase
              .from("lesson_reports")
              .select("*", { count: "exact", head: true })
              .eq("classnote_status", "failed")
              .gte("report_date", sevenDayStart),
            db,
          ),
          scopeTenant(
            supabase
              .from("lesson_reports")
              .select("*", { count: "exact", head: true })
              .eq("classnote_status", "too_old")
              .gte("report_date", sevenDayStart),
            db,
          ),
          scopeTenant(
            supabase
              .from("lesson_reports")
              .select("*", { count: "exact", head: true })
              .in("classnote_status", [...HUMAN_RESOLVED_STATUSES]),
            db,
          ),
          scopeTenant(
            supabase
              .from("lesson_reports")
              .select("*", { count: "exact", head: true })
              .eq("classnote_status", "processing")
              .lte("classnote_processing_at", stuckCutoff),
            db,
          ),
        ]);
        return {
          failed: countOrThrow(failedRes, "classnote failed"),
          tooOld: countOrThrow(tooOldRes, "classnote too_old"),
          humanHold: countOrThrow(holdRes, "classnote human-hold"),
          stuck: countOrThrow(stuckRes, "classnote stuck"),
        };
      },
    ),
    collectSignal(
      attendanceNowEnabled,
      {
        key: "attendance-today-unrecorded",
        label: "오늘 출결 처리",
        href: "/attendance/live",
        menuKey: "attendance",
        requiredAccess: "read",
      },
      [] as TodayActionsRaw["unrecordedToday"],
      () =>
        isHolidayOn(holidayMap, today)
          ? Promise.resolve([] as TodayActionsRaw["unrecordedToday"])
          : unrecordedTodaySignal(supabase, today, nowMinutes, db),
    ),
    collectSignal(
      enabled("students"),
      {
        key: "day-arrivals",
        label: "오늘 첫·마지막 수업",
        href: "/students?list=1",
        menuKey: "students",
        requiredAccess: "read",
      },
      { starting: [], ending: [] } as TodayActionsRaw["dayArrivals"],
      () => dayArrivalsSignal(supabase, today, db),
    ),
    collectSignal(
      enabled("enrollment"),
      {
        key: "intake-today",
        label: "오늘 접수",
        href: "/enrollment?view=kanban", // 칸반 고정 — 저장된 보기(view-pref.ts)와 무관하게 카드로
        menuKey: "enrollment",
        requiredAccess: "read",
      },
      { count: 0, names: [] } as TodayActionsRaw["newIntakeToday"],
      async () => {
        // 운영실 KPI '신규문의'·목록 `received=`와 **같은 함수·같은 KST 경계**(행이 생긴 시각 created_at 기준).
        // 하루치 전건이라 배열 길이가 곧 건수다(상한 없음 — [[#89]]).
        const rows = await getIntakeOnDay(today, { supabase, tenantId: db?.tenantId });
        return { count: rows.length, names: rows.map((row) => row.name) };
      },
    ),
    collectSignal(
      enabled("newcomers"),
      {
        key: "newcomer-overdue",
        label: "신규생 관리 기한 경과",
        href: "/newcomers?list=1",
        menuKey: "newcomers",
        requiredAccess: "read",
      },
      { count: 0, names: [] } as TodayActionsRaw["newcomerOverdue"],
      () => newcomerOverdueSignal(supabase, today, db),
    ),
    collectSignal(
      enabled("timetable"),
      {
        key: "scheduled-tomorrow",
        label: "내일 시간표 예약",
        href: "/timetable",
        menuKey: "timetable",
        requiredAccess: "read",
      },
      null as TodayActionsRaw["scheduledTomorrow"],
      () => scheduledTomorrowSignal(supabase, tomorrow, db),
    ),
  ]);

  let makeeduIssue: TodayActionsRaw["makeeduIssue"] = null;
  if (makeedu.value.syncEnabled && makeedu.value.rows.length > 0) {
    const errors = makeedu.value.rows.filter((row) => row.status !== "ok");
    if (errors.length > 0) {
      makeeduIssue = { kind: "error", detail: `${errors.map((error) => error.domain).join("·")} 실패` };
    } else {
      // ⚠️ **도메인별로** 판정한다. 예전엔 전 도메인 max(synced_at) 하나만 봐서, 임포터가 도메인별로
      // 실패 격리되는 구조상 invoices만 몇 주 멈춰도 다른 도메인이 신선하면 경고가 절대 안 떴다
      // (그 도메인 행은 recordSync에 도달 못 해 status도 옛 'ok'로 남아 위 errors 필터에도 안 걸린다).
      const stale = makeedu.value.rows
        // 수동 전용 도메인은 자동 동기화 대상이 아니라 영원히 낡는다 — 제외(MANUAL_ONLY_DOMAINS 주석).
        .filter((row) => !MANUAL_ONLY_DOMAINS.has(row.domain))
        .map((row) => ({ domain: row.domain, hours: Math.floor((Date.now() - Date.parse(row.synced_at)) / 3_600_000) }))
        .filter((row) => row.hours >= 26)
        .sort((a, b) => b.hours - a.hours);
      if (stale.length > 0) {
        makeeduIssue = {
          kind: "stale",
          detail: `${stale.map((s) => DOMAIN_LABEL[s.domain] ?? s.domain).join("·")} ${stale[0]!.hours}시간째 미동기`,
        };
      }
    }
  }

  const collected = [
    absent,
    dailyProcessing,
    failedMeetings,
    failedEnrollment,
    failedConsultations,
    makeedu,
    textbooks,
    leavesPending,
    leavesToday,
    unwrittenReports,
    unassignedEnrolled,
    classnoteAttention,
    unrecordedTodayClasses,
    dayArrivals,
    newIntake,
    newcomerOverdue,
    scheduledTomorrow,
  ];

  return {
    date: today,
    // 학생 단위 접기·사전 통보 AND 규약은 foldAbsentStudents(absent-students.ts) 한 벌에 있다 — 한 교시도 안 온 학생만.
    absentToday: absent.value.absent.map(({ studentId, name, subject, preNotified }) => ({
      studentId,
      name,
      subject,
      preNotified,
    })),
    unrecordedYesterday: dailyProcessing.value,
    yesterday,
    unrecordedToday: unrecordedTodayClasses.value,
    failedAnalysis: {
      meetings: failedMeetings.value,
      enrollment: failedEnrollment.value,
      consultations: failedConsultations.value,
    },
    makeeduIssue,
    requestedTextbooks: textbooks.value,
    leavesPending: leavesPending.value,
    leavesToday: leavesToday.value.map((row) => {
      const user = (Array.isArray(row.user) ? row.user[0] : row.user) ?? undefined;
      return { name: user?.display_name ?? "(직원)" };
    }),
    unwrittenReportsToday: unwrittenReports.value,
    unassignedEnrolled: unassignedEnrolled.value.students.map((student) => ({
      studentId: student.studentId,
      name: student.name,
    })),
    unassignedEnrolledTotal: unassignedEnrolled.value.total,
    classnoteAttention: classnoteAttention.value,
    dayArrivals: dayArrivals.value,
    newIntakeToday: newIntake.value,
    newcomerOverdue: newcomerOverdue.value,
    scheduledTomorrow: scheduledTomorrow.value,
    sourceIssues: collected.flatMap((result) => (result.issue ? [result.issue] : [])),
  };
}
