import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logDbError } from "@/lib/supabase/db-error";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { kstMonth, kstToday, monthLabel, monthRange } from "@/lib/date-kst";
import { classDaysOf, normalizeMonth, type MathScheduleRow } from "../lib/class-days";
import {
  countRosterPhases,
  rosterExtraTitle,
  isOnMathRosterAnyDay,
  rosterAnchorOf,
  rosterPhaseOf,
  type MathEnrollmentWindow,
  type MathRosterPhase,
} from "../lib/roster";
import { cellStateOf, foldDayAttendance, tallyCells, type MathCellState } from "../lib/cell-state";
import { mcsVisibleClassFilter } from "./access";
import { getTenantSettings } from "@/features/owner/server/queries";
// 휴일 판정 자료는 학원설정 하나뿐 — 내장 법정공휴일 표는 쓰지 않는다([[holiday.ts]]).
import { buildHolidayMap } from "@/features/attendance/calendar";
import { isHolidayOn } from "@/features/class-sheets/lib/holiday";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { groupMathCardsByTeacher } from "../landing-tracks";

/**
 * MCS 랜딩 — 그 달에 **수업이 있는 수학 반**만 세운다.
 *
 * 🔴 ECS 랜딩과 같은 규칙([[landing-week-scope]] 결정): 반을 먼저 세워 놓고 교시를 세면
 *    수업이 끝난 반이 `0/0` 카드로 남는다. 그 달에 도는 날이 0일이면 카드를 만들지 않는다.
 * ⚠️ 담임 이름은 표시용이다 — 권한 판정은 `mcsVisibleClassFilter`(게이트와 같은 두 갈래)가 한다.
 */
export type MathClassCard = {
  classId: string;
  className: string;
  teacherName: string | null;
  dayCount: number;
  /**
   * 그 달 수업일 중 **이미 지난 날**. 0이면 아직 한 번도 안 한 달이다.
   * 🔴 `shown === 0`과 뜻이 다르다 — 달은 지났는데 아무도 안 온 반도 `shown === 0`이라,
   *    둘을 안 가르면 그 반이 '아직 수업 전'으로 보인다(사실은 전원 결석이다).
   */
  elapsedDays: number;
  /**
   * **기준일 현재 재원** — 화면이 "학생 N명"이라고 적는 수.
   * 🔴 시트 줄 수와 다르다(`studentCount + extraCount` = 줄 수). 줄 수를 그대로 "학생 N명"이라
   *    적었더니 현재 재원 0명인 특강이 "학생 7명"이 됐다(적대적 리뷰 2026-09-01).
   */
  studentCount: number;
  /** 이 달 중 나갔거나 아직 안 들어온 행 — 시트엔 회색 줄로 남는다. 0이면 표시하지 않는다. */
  extraCount: number;
  /** 꼬리표 툴팁 문구(없으면 null) — 카드·시트 헤더가 같은 문장을 쓴다. */
  extraTitle: string | null;
  /**
   * 방학 단기강좌인가 — 랜딩의 **정규/특강 좌우 분단** 축(원장 2026-09-01).
   * 🔴 판정은 여기서 짓지 않고 시간표와 같은 [`isSpecialLecture`](@/features/classes/special-lecture)를
   *    통과시킨 값이다(컬럼 `is_special`이 이기고, 없으면 반 이름의 '특강' 폴백).
   */
  isSpecial: boolean;
  /** 수업 기록이 있는 학생-수업일. */
  written: number;
  /**
   * 작성률의 **분모** = 온 칸(기록 있음 + 왔는데 안 적힘).
   * 🔴 결석·무기록은 뺀다 — 시트 툴바와 **같은 산식**이라야 카드와 시트가 같은 수를 말한다.
   * 🔴 이 값이 0이면 아직 아무도 안 온 것이라 **막대를 그리지 않는다**(`—`). 0을 100%로 그리면
   *    다음 달 목록이 전부 꽉 찬 막대로 보인다(9월을 8/31에 여는 것이 정확히 그 경우다).
   */
  shown: number;
  pct: number;
  learningTrack?: "regular" | "supplement";
};

export type MathLandingEmptyReason = "no-classes" | "no-scoped-classes" | "no-month-classes";

export type MathLandingData = {
  month: string;
  monthLabel: string;
  cards: MathClassCard[];
  emptyReason: MathLandingEmptyReason | null;
  byTeacher: { teacherName: string; cards: MathClassCard[] }[];
};

type LandingReportRow = { class_id: string; student_id: string; report_date: string };
type LandingAttRow = { class_id: string; student_id: string; session_date: string; status: string | null };

type LandingSchedRow = {
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string | null;
  valid_from: string | null;
  valid_to: string | null;
};
type LandingEnrRow = {
  class_id: string;
  student_id: string;
  start_date: string | null;
  end_date: string | null;
  is_transferred: boolean | null;
};

export type MathLandingResult = { ok: true; data: MathLandingData } | { ok: false; error: string };

/**
 * 반 전환 드롭다운용 **가벼운 목록** — 월간 뷰 상단의 `목록 · 반 선택 · 반 정보 보기`(ECS와 같은 조각,
 * 원장 2026-09-02 *"영어 ECS처럼 수학 MCS에 반정보가 있어야하는데 상단 헤더에 없음"*)가 쓴다.
 * 🔴 `getMathSheetLanding`을 부르지 않는다 — 그건 전 반의 보고서·출결을 달 단위로 긁어 작성률을 세는
 *    무거운 조회라, 반 하나를 여는 데 전 반 집계를 딸려 오게 하면 첫 페인트가 늦는다(B7).
 * 스코프·반 조건은 랜딩과 **같다**(`mcsVisibleClassFilter` 두 갈래 + 그 달 시작 전에 닫힌 반 제외) —
 * 랜딩에 없는 반이 드롭다운에만 서면 안 된다. ⚠️ 그 달에 수업이 있는지는 보지 않는다(랜딩은 본다) —
 * 드롭다운은 "갈 수 있는 반"이지 "이 달 카드"가 아니다(호출부가 지금 보는 반은 어차피 맨 앞에 끼운다).
 */
export async function getMathClassOptions(monthRaw: string | null): Promise<{ id: string; name: string }[]> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return [];
  const level = await accessLevelTenant(user.systemRole, "mcs");
  if (level === "none") return [];
  const month = normalizeMonth(monthRaw, kstMonth());
  const { from: monthStart } = monthRange(month);
  const admin = createAdminClient();
  const [classRes, filter] = await Promise.all([
    admin
      .from("classes")
      .select("id, class_name")
      .eq("tenant_id", user.tenantId)
      .eq("subject", "math")
      .eq("is_active", true)
      .or(`closed_at.is.null,closed_at.gte.${monthStart}`)
      .order("class_name"),
    mcsVisibleClassFilter(),
  ]);
  if (classRes.error) {
    logDbError(classRes.error, "math-sheets.getMathClassOptions");
    throw new Error("반 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
  }
  const all = classRes.data ?? [];
  const scoped = filter ? all.filter((c) => filter(String(c.id))) : all;
  return scoped.map((c) => ({ id: String(c.id), name: String(c.class_name) }));
}

export async function getMathSheetLanding(monthRaw: string | null): Promise<MathLandingResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const level = await accessLevelTenant(user.systemRole, "mcs");
  if (level === "none") return { ok: false, error: "접근 권한이 없습니다" };

  const month = normalizeMonth(monthRaw, kstMonth());
  // 카드 인원도 시트와 **같은 규칙·같은 함수**로 센다 — 갈리면 카드엔 6명인데 열면 5명이 된다.
  const today = kstToday();
  const anchor = rosterAnchorOf(month, today);
  const { from: monthStart, to: monthEnd } = monthRange(month);
  const admin = createAdminClient();
  const tenantId = user.tenantId;

  const [classRes, filter, settings] = await Promise.all([
    admin
      .from("classes")
      .select("id, class_name, teacher_id, is_special, math_learning_track")
      .eq("tenant_id", tenantId)
      .eq("subject", "math")
      .eq("is_active", true)
      // 종강한 반은 그 달 시작 전에 닫혔으면 뺀다(ECS 랜딩과 같은 조건).
      .or(`closed_at.is.null,closed_at.gte.${monthStart}`)
      .order("class_name"),
    mcsVisibleClassFilter(),
    // 휴일 — 테넌트 단위 read-mostly라 요청 캐시를 탄다(추가 왕복 없음, B4·B6).
    getTenantSettings(),
  ]);

  if (classRes.error) {
    logDbError(classRes.error, "math-sheets.getMathSheetLanding");
    return { ok: false, error: "반 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }

  // 🔴 시트와 **같은 맵**을 읽는다 — 갈리면 카드 작성률과 시트 툴바가 다른 수를 말한다(이 파일의 상시 규약).
  const holidays = buildHolidayMap(settings.operations.holidays);

  const all = classRes.data ?? [];
  if (all.length === 0) {
    return { ok: true, data: { month, monthLabel: monthLabel(month), cards: [], emptyReason: "no-classes", byTeacher: [] } };
  }

  const scoped = filter ? all.filter((c) => filter(String(c.id))) : all;
  if (scoped.length === 0) {
    return {
      ok: true,
      data: { month, monthLabel: monthLabel(month), cards: [], emptyReason: "no-scoped-classes", byTeacher: [] },
    };
  }

  const classIds = new Set(scoped.map((c) => String(c.id)));
  const teacherIds = [...new Set(scoped.map((c) => c.teacher_id).filter(Boolean))].map(String);

  const [schedRows, enrRows, teacherRows, reportRows, attRows] = await Promise.all([
    fetchAllPaged<LandingSchedRow>((f, t) =>
      admin
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(f, t),
    ),
    fetchAllPaged<LandingEnrRow>((f, t) =>
      admin
        .from("enrollments")
        .select("class_id, student_id, start_date, end_date, is_transferred")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(f, t),
    ),
    teacherIds.length
      ? admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", teacherIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    // 🔴 작성률은 시트와 **같은 재료**로 센다 — 보고서만 보면 결석이 미작성으로 둔갑한다.
    //    반 id로 좁혀서 청크+페이지네이션(B2·B3): 62개 반을 한 `.in()`에 넣으면 URL이 길어진다.
    fetchAllPagedInChunks<LandingReportRow>([...classIds], (chunk, f, t) =>
      admin
        .from("lesson_reports")
        .select("class_id, student_id, report_date")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .gte("report_date", monthStart)
        .lte("report_date", monthEnd)
        .order("id")
        .range(f, t),
    ),
    fetchAllPagedInChunks<LandingAttRow>([...classIds], (chunk, f, t) =>
      admin
        .from("attendance_records")
        .select("class_id, student_id, session_date, status")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .gte("session_date", monthStart)
        .lte("session_date", monthEnd)
        .order("id")
        .range(f, t),
    ),
  ]);

  const teacherName = new Map(
    ((teacherRows.data ?? []) as { id: string; display_name: string | null }[]).map((t) => [
      String(t.id),
      t.display_name ?? null,
    ]),
  );

  const schedByClass = new Map<string, MathScheduleRow[]>();
  for (const r of schedRows) {
    const cid = String(r.class_id);
    if (!classIds.has(cid)) continue;
    const list = schedByClass.get(cid) ?? [];
    list.push({
      dayOfWeek: String(r.day_of_week),
      startTime: String(r.start_time),
      endTime: r.end_time ? String(r.end_time) : null,
      validFrom: r.valid_from ? String(r.valid_from).slice(0, 10) : null,
      validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
    });
    schedByClass.set(cid, list);
  }

  // 🔴 시트가 세우는 행과 같은 규칙(`isOnMathRosterAnyDay`) — 달 중간 입·퇴반도 그 달 시트엔 선다.
  const enrByClass = new Map<string, Map<string, MathEnrollmentWindow[]>>();
  for (const e of enrRows) {
    const cid = String(e.class_id);
    if (!classIds.has(cid)) continue;
    const byStudent = enrByClass.get(cid) ?? new Map<string, MathEnrollmentWindow[]>();
    const sid = String(e.student_id);
    const list = byStudent.get(sid) ?? [];
    list.push({
      startDate: e.start_date ? String(e.start_date).slice(0, 10) : null,
      endDate: e.end_date ? String(e.end_date).slice(0, 10) : null,
      isTransferred: e.is_transferred === true,
    });
    byStudent.set(sid, list);
    enrByClass.set(cid, byStudent);
  }

  // 퇴원까지 봐야 카드와 시트가 **같은 명단**을 센다(시트는 이미 본다 — 갈리면 카드 6명·시트 5명이 된다).
  const rosterStudentIds = [...new Set([...enrByClass.values()].flatMap((m) => [...m.keys()]))];
  const studentRows = rosterStudentIds.length
    ? await fetchInChunks(rosterStudentIds, (chunk) =>
        admin.from("students").select("id, withdrawn_at").eq("tenant_id", tenantId).in("id", chunk),
      )
    : [];
  const withdrawnById = new Map(
    studentRows.map((r) => [String(r.id), r.withdrawn_at ? String(r.withdrawn_at).slice(0, 10) : null]),
  );

  const reportKeys = new Set(
    reportRows.map((r) => `${String(r.class_id)}|${String(r.report_date).slice(0, 10)}|${String(r.student_id)}`),
  );
  const attByKey = new Map<string, string[]>();
  for (const a of attRows) {
    const key = `${String(a.class_id)}|${String(a.session_date).slice(0, 10)}|${String(a.student_id)}`;
    const list = attByKey.get(key) ?? [];
    list.push(String(a.status));
    attByKey.set(key, list);
  }

  const cards: MathClassCard[] = [];
  for (const c of scoped) {
    const cid = String(c.id);
    const days = classDaysOf(month, schedByClass.get(cid) ?? []);
    if (days.length === 0) continue; // 🔴 그 달에 안 도는 반은 카드를 만들지 않는다
    const byStudent = enrByClass.get(cid) ?? new Map<string, MathEnrollmentWindow[]>();

    const dayDates = days.map((d) => d.date);
    const phases: MathRosterPhase[] = [];
    const states: MathCellState[] = [];
    for (const [sid, list] of byStudent) {
      const withdrawnAt = withdrawnById.get(sid) ?? null;
      // 🔴 시트가 행을 세우는 규칙과 **같은 함수** — 갈리면 카드 인원과 시트 줄 수가 어긋난다.
      if (!isOnMathRosterAnyDay(list, withdrawnAt, dayDates)) continue;
      phases.push(rosterPhaseOf(list, withdrawnAt, anchor, dayDates));
      for (const day of days) {
        states.push(
          cellStateOf({
            enrollments: list,
            withdrawnAt,
            date: day.date,
            attendance: foldDayAttendance(attByKey.get(`${cid}|${day.date}|${sid}`) ?? []),
            hasReport: reportKeys.has(`${cid}|${day.date}|${sid}`),
            today,
            holiday: isHolidayOn(holidays, day.date),
          }),
        );
      }
    }
    // 🔴 시트 툴바와 **같은 산식**(`tallyCells`) — 카드와 시트가 다른 수를 말하면 둘 다 못 믿는다.
    const fill = tallyCells(states);
    const counts = countRosterPhases(phases);
    cards.push({
      classId: cid,
      className: String(c.class_name),
      teacherName: c.teacher_id ? (teacherName.get(String(c.teacher_id)) ?? null) : null,
      dayCount: days.length,
      elapsedDays: days.filter((d) => d.date <= today).length,
      studentCount: counts.on,
      extraCount: counts.extra,
      extraTitle: rosterExtraTitle(counts),
      isSpecial: isSpecialLecture({
        isSpecial: c.is_special === true,
        className: String(c.class_name),
      }),
      written: fill.written,
      shown: fill.written + fill.unwritten,
      pct: fill.pct,
      learningTrack: c.math_learning_track === "supplement" ? "supplement" : "regular",
    });
  }

  // 화면이 좌우로 나눌 땐 단마다 다시 묶으므로 **같은 함수**를 쓴다(두 벌이면 정렬과
  // '담임 미지정' 라벨이 갈린다).
  const byTeacher = groupMathCardsByTeacher(cards);

  return {
    ok: true,
    data: {
      month,
      monthLabel: monthLabel(month),
      cards,
      emptyReason: cards.length === 0 ? "no-month-classes" : null,
      byTeacher,
    },
  };
}
