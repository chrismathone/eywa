import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstMonth, kstToday, monthLabel, monthRange } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { resolvePeriodLabel, tableToEntries } from "../lib/period-label";
import { isWeekendDow } from "../lib/grid-rows";
import { dowKeyOf } from "../lib/week";
import { monthDates, monthWeeks, normalizeMonth, activeDowsOf, type MonthWeek } from "../lib/month";
import {
  monthFillStats,
  slotKey,
  slotsByDateOf,
  type MonthScheduleRow,
  type MonthSlot,
} from "../lib/month-assemble";
import type { MonthGoalMap } from "../lib/goal-match";
import {
  clampEcsMonthView,
  readEcsMonthDisplay,
  readEcsMonthView,
  type EcsMonthDisplay,
  type EcsMonthView,
} from "../view-prefs";
import { buildHolidayMap } from "@/features/attendance/calendar";
import type { MpCell, MpColKind } from "../lib/month-plan";
import { isMeaningfulPlanLine } from "../lib/plan-codec";
import { planLineFromRow } from "../lib/plan-line";
import type { PlanLineDTO } from "./actions";
import { requireEcsClassAccess } from "./access";
import type { DowKey } from "../lib/week";

/**
 * ECS **월간 뷰** 조회 — 반 1개 × 달 1개. 주간 시트(`getClassSheetWeek`)와 같은 게이트
 * (`requireEcsClassAccess`)를 통과하고, 같은 표(`class_sheet_plan_lines`·`class_sheet_goals`)를 읽는다.
 * **새 표도 새 쓰기 경로도 없다**(목표 저장은 기존 `upsertGoal` 그대로).
 *
 * 주간과 다른 점 — 월간은 **훑는 화면**이라 로스터·출결·마크를 아예 안 읽는다. 한 반 한 달이
 * 계획 줄 ~50행 · 배정 교시 ~40개라(실측 중등E_초6 SKY 2026-08) 날짜 범위로 좁힌 조회 3개면 끝난다.
 */
export type MonthPlanLine = PlanLineDTO & { seat: boolean };

export type ClassSheetMonthData = {
  classId: string;
  className: string;
  /** 반 담임(`classes.teacher_id`) — 계획서 인쇄물 머리말의 강사 닉네임을 찾는 키. */
  teacherId: string | null;
  month: string;
  monthLabel: string;
  today: string;
  /** 이 달에 배정이 있는 요일만(열의 정체) — 없으면 빈 배열. */
  dows: DowKey[];
  weeks: MonthWeek[];
  slotsByDate: Record<string, MonthSlot[]>;
  /** `YYYY-MM-DD|HH:MM` → 그 교시의 계획 줄(line_no 순). */
  linesBySlot: Record<string, MonthPlanLine[]>;
  /** 계획 줄 전체(평면) — 경고 판정·목표 대조가 날짜를 넘나들며 쓴다. */
  lines: MonthPlanLine[];
  /** `YYYY-MM-DD|HH:MM` → 교시 라벨(표시 전용, 학원설정이 단일 소스). */
  periodLabelBySlot: Record<string, string>;
  goals: { homeroom: MonthGoalMap; assistant: MonthGoalMap };
  skillAreas: SkillAreaSetting[];
  canEdit: boolean;
  /** 배정된 전 교시 기준(표시 토글과 무관 — month-assemble 🔴 참조). */
  fill: { filled: number; total: number; pct: number };
  /** 마지막에 본 보기 + 보기별 표시 토글(계정 귀속 — `users.ui_prefs.ecs`). */
  view: EcsMonthView;
  display: Record<EcsMonthView, EcsMonthDisplay>;
  /**
   * EiE 반인가 — **계획(MP) 보기가 서는 유일한 조건**(원장 2026-09-01). 판정은 `classes.english_track`
   * 컬럼 하나고 반 이름으로 추측하지 않는다. 화면은 이 값으로 탭을 세우고, 저장·인쇄는 서버에서 다시 본다(#77).
   */
  isEie: boolean;
  /**
   * 월간 계획서(MP)의 칸들 — **EiE 반일 때만** 담는다(그 외는 빈 배열 + `status: "off"`).
   * 🔴 0239a 미적용이어도 화면은 산다(`missing-table` → 한글 배너, 달력·진도표는 이 값을 아예 안 읽는다).
   */
  mp: { cells: MpCell[]; status: MpDataStatus };
  /**
   * 학원설정 공휴일(그 달 범위) — **MP의 휴강 기본 판정에만** 쓴다.
   * ⚠️ 주간 시트·달력·진도표는 지금도 휴일을 안 본다 — 거기까지 같이 고치면 작성률 분모가 조용히 바뀐다.
   */
  holidays: Record<string, string>;
};

/**
 * MP 칸 조회의 결말 — 표가 아직 없는 것과 그냥 실패한 것은 **다른 사실**이라 한 문구로 뭉치지 않는다
 * (MCS `GoalsStatus`와 같은 규약: 권한·네트워크 실패를 "SQL 미적용"이라 부르면 화면이 거짓말을 한다).
 * `off` = 이 반은 MP 대상이 아니다(EiE 아님) — 조회를 아예 안 했다는 뜻.
 */
export type MpDataStatus = "ok" | "off" | "missing-table" | "failed";

export type MonthResult = { ok: true; data: ClassSheetMonthData } | { ok: false; error: string };

export async function getClassSheetMonth(classId: string, monthRaw: string | null): Promise<MonthResult> {
  const gate = await requireEcsClassAccess(classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const access = gate.access;

  const today = kstToday();
  const month = normalizeMonth(monthRaw, kstMonth());
  const { from, to } = monthRange(month);
  const admin = createAdminClient();
  // 🔴 계획(MP)은 **EiE 반에만** 있다(원장 2026-09-01) — 판정은 `english_track` 컬럼 하나고 게이트가
  //    이미 읽어 왔다. EiE가 아니면 조회 자체를 안 한다(쓸데없는 왕복 0 + 화면에 탭도 안 선다).
  const isEie = access.englishTrack === "eie";

  // 독립 조회는 병렬(B4). 계획 줄만 페이지네이션 — 20줄 × 40교시면 이론상 1,000행에 닿는다(B2).
  const [scheduleRes, lineRows, goalRes, settings, prefsRes, mpRes] = await Promise.all([
    admin
      .from("class_schedules")
      .select("day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label, slot_room_label")
      .eq("tenant_id", access.tenantId)
      .eq("class_id", classId)
      .lte("valid_from", to)
      .or(`valid_to.is.null,valid_to.gte.${from}`),
    fetchAllPaged<Record<string, unknown>>((rangeFrom, rangeTo) =>
      admin
        .from("class_sheet_plan_lines")
        .select("*")
        .eq("tenant_id", access.tenantId)
        .eq("class_id", classId)
        .gte("plan_date", from)
        .lte("plan_date", to)
        .order("plan_date")
        .order("slot_start")
        .order("line_no")
        .order("id") // OFFSET 페이지가 흔들리지 않게 unique tie-break
        .range(rangeFrom, rangeTo),
    ),
    admin
      .from("class_sheet_goals")
      .select("role, skill_area, textbook, target_progress")
      .eq("tenant_id", access.tenantId)
      .eq("class_id", classId)
      .eq("scope", "month")
      .eq("period_start", from),
    getTenantSettings(),
    admin.from("users").select("ui_prefs").eq("id", access.user.id).eq("tenant_id", access.tenantId).maybeSingle(),
    // 0239a. 한 반 한 달이 수업일 ~13일 × 칸 5종이라 페이지네이션 불요(B2 상한 근처에도 못 간다).
    // ⚠️ admin은 RLS 우회라 `tenant_id` 필터가 필수다([[#104]]).
    isEie
      ? admin
          .from("class_month_plan_cells")
          .select("plan_date, col_kind, body")
          .eq("tenant_id", access.tenantId)
          .eq("class_id", classId)
          .gte("plan_date", from)
          .lte("plan_date", to)
      : Promise.resolve(null),
  ]);

  if (scheduleRes.error) return { ok: false, error: "시간표를 불러오지 못했습니다" };
  if (goalRes.error) return { ok: false, error: "월간 목표를 불러오지 못했습니다" };

  /**
   * MP 칸 — 🔴 **여기서 throw하지 않는다.** 0239a는 원장이 손으로 적용하므로 앱 배포와 적용 사이에
   * 항상 간격이 있고([[#95]]), 그 사이에 이 조회가 화면을 죽이면 **달력·진도표까지 함께** 못 쓰게 된다.
   * ⚠️ 원인을 단정하지 않는다 — 표가 없는 것(42P01·PGRST205)과 조회 실패는 다른 사실이다.
   */
  const mpErr = mpRes?.error ?? null;
  const mpCode = mpErr ? String(mpErr.code ?? "") : "";
  const mpStatus: MpDataStatus = !isEie
    ? "off"
    : !mpErr
      ? "ok"
      : mpCode === "42P01" ||
          mpCode === "PGRST205" ||
          /does not exist|could not find the table/i.test(mpErr.message ?? "")
        ? "missing-table"
        : "failed";
  const mpCells: MpCell[] = (mpRes?.data ?? []).map((r) => ({
    planDate: String(r.plan_date).slice(0, 10),
    colKind: String(r.col_kind) as MpColKind,
    body: typeof r.body === "string" ? r.body : "",
  }));

  const scheduleRows: MonthScheduleRow[] = (scheduleRes.data ?? []).map((r) => ({
    dayOfWeek: String(r.day_of_week),
    startTime: String(r.start_time),
    endTime: r.end_time ? String(r.end_time) : null,
    validFrom: r.valid_from ? String(r.valid_from) : null,
    validTo: r.valid_to ? String(r.valid_to) : null,
    slotTeacherLabel: (r.slot_teacher_label as string | null) ?? null,
    slotRoomLabel: (r.slot_room_label as string | null) ?? null,
  }));

  const dates = monthDates(month);
  const slotsByDate = slotsByDateOf(dates, scheduleRows);
  const seatByKey = new Map<string, boolean>();
  for (const [date, slots] of Object.entries(slotsByDate)) {
    for (const slot of slots) seatByKey.set(slotKey(date, slot.slotStart), slot.seat !== null);
  }

  // 자리 여부는 **그 날 그 교시의 배정**에서 온다 — 계획 줄에는 그 사실이 없다.
  //
  // 🔴 **배정에 없는 '고아 줄'은 담지 않는다** — 시간표가 바뀌어 그 교시가 사라지면 줄만 남는데,
  //    월간 화면엔 그 줄을 놓을 칸이 없다(칸은 배정에서 나온다). 담아 두면 **툴바 요약과 카드 배지가
  //    서로 다른 수를 말한다**(요약은 줄 전체를, 카드는 배정 슬롯만 센다). 실측 2026-08 계획 930줄 중
  //    고아는 1줄이지만, 어긋난 숫자는 개수와 무관하게 화면을 못 믿게 만든다.
  //    ⚠️ 데이터가 사라지는 건 아니다 — **주간 시트가 고아 슬롯을 경고와 함께 그대로 보여준다**(정본).
  //
  // 🔴 **빈 줄(영역만 고른 placeholder)은 담지 않는다** — 월간은 읽는 화면이라 편집할 일이 없는데,
  //    그리면 알약 하나만 덩그러니 남고(실화면 8/19) 작성률도 "썼다"로 잡혀 화면과 숫자가 어긋난다.
  //    판정은 주간 시트·랜딩과 **같은 함수**(`isMeaningfulPlanLine` = SQL `ecs_is_meaningful_line` 미러).
  const lines: MonthPlanLine[] = lineRows
    .map((row) => {
      const dto = planLineFromRow(row);
      return { ...dto, seat: seatByKey.get(slotKey(dto.planDate, dto.slotStart)) ?? false };
    })
    .filter((l) => seatByKey.has(slotKey(l.planDate, l.slotStart)))
    .filter((l) =>
      isMeaningfulPlanLine({
        textbook: l.textbook,
        pageRange: l.pageRange,
        progress: l.progress,
        homework: l.homework,
      }),
    );

  const linesBySlot: Record<string, MonthPlanLine[]> = {};
  for (const line of lines) {
    const key = slotKey(line.planDate, line.slotStart);
    (linesBySlot[key] ??= []).push(line);
  }

  const goals: { homeroom: MonthGoalMap; assistant: MonthGoalMap } = { homeroom: {}, assistant: {} };
  for (const row of goalRes.data ?? []) {
    const role = row.role === "assistant" ? "assistant" : "homeroom";
    goals[role][String(row.skill_area)] = {
      textbook: (row.textbook as string | null) ?? null,
      targetProgress: (row.target_progress as string | null) ?? null,
    };
  }

  // 교시 라벨 — 요일별 표로 슬롯마다 확정(주간 시트와 같은 규약: 주말은 별도 교시표).
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const periodTables = {
    weekday: tableToEntries(weekdayTableFor(access.subject, periodsConfig)),
    weekend: tableToEntries(periodsConfig.weekend),
  };
  const periodLabelBySlot: Record<string, string> = {};
  for (const [date, slots] of Object.entries(slotsByDate)) {
    const weekend = isWeekendDow(dowKeyOf(date));
    for (const slot of slots) {
      const label = resolvePeriodLabel(slot.slotStart, slot.slotEnd, periodTables, weekend);
      if (label) periodLabelBySlot[slotKey(date, slot.slotStart)] = label;
    }
  }

  const hasLines = (date: string, slotStart: string) => (linesBySlot[slotKey(date, slotStart)]?.length ?? 0) > 0;

  return {
    ok: true,
    data: {
      classId,
      // ⚠️ 예약된 개명 예고는 아직 안 붙인다 — 그 규약은 **주 단위 축**(`classNameForWeek`)이라
      //    달 중간에 이름이 바뀌는 경우 헤더를 어느 이름으로 쓸지가 새 결정이다. 필요해지면 그때.
      className: access.className,
      teacherId: access.teacherId,
      month,
      monthLabel: monthLabel(month),
      today,
      dows: activeDowsOf(Object.keys(slotsByDate)),
      weeks: monthWeeks(month),
      slotsByDate,
      linesBySlot,
      lines,
      periodLabelBySlot,
      goals,
      skillAreas: access.skillAreas,
      canEdit: access.canWrite,
      fill: monthFillStats(slotsByDate, hasLines),
      // 🔴 계정에 저장된 보기가 `mp`인데 인재원 영어 반을 열면 **달력으로 떨어뜨린다** — 저장값을
      //    그대로 믿으면 없는 보기가 빈 화면으로 선다(주소 `?view=mp`도 page.tsx에서 같은 함수를 탄다).
      view: clampEcsMonthView(readEcsMonthView(prefsRes.data?.ui_prefs), isEie),
      display: {
        cal: readEcsMonthDisplay(prefsRes.data?.ui_prefs, "cal"),
        rail: readEcsMonthDisplay(prefsRes.data?.ui_prefs, "rail"),
        mp: readEcsMonthDisplay(prefsRes.data?.ui_prefs, "mp"),
      },
      isEie,
      mp: { cells: mpCells, status: mpStatus },
      // 그 달 범위로 좁힌 휴일 맵 — 학원설정이 단일 소스다(`features/calendar/holidays.ts`의 내장
      // 법정공휴일 표는 캘린더 탭 전용이라 여기서 쓰지 않는다).
      holidays: Object.fromEntries(
        Object.entries(buildHolidayMap(settings.operations.holidays)).filter(
          ([d]) => d >= from && d <= to,
        ),
      ),
    },
  };
}
