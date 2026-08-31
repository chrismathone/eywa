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
  readEcsMonthDisplay,
  readEcsMonthView,
  type EcsMonthDisplay,
  type EcsMonthView,
} from "../view-prefs";
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
};

export type MonthResult = { ok: true; data: ClassSheetMonthData } | { ok: false; error: string };

export async function getClassSheetMonth(classId: string, monthRaw: string | null): Promise<MonthResult> {
  const gate = await requireEcsClassAccess(classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const access = gate.access;

  const today = kstToday();
  const month = normalizeMonth(monthRaw, kstMonth());
  const { from, to } = monthRange(month);
  const admin = createAdminClient();

  // 독립 조회는 병렬(B4). 계획 줄만 페이지네이션 — 20줄 × 40교시면 이론상 1,000행에 닿는다(B2).
  const [scheduleRes, lineRows, goalRes, settings, prefsRes] = await Promise.all([
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
  ]);

  if (scheduleRes.error) return { ok: false, error: "시간표를 불러오지 못했습니다" };
  if (goalRes.error) return { ok: false, error: "월간 목표를 불러오지 못했습니다" };

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
      view: readEcsMonthView(prefsRes.data?.ui_prefs),
      display: {
        cal: readEcsMonthDisplay(prefsRes.data?.ui_prefs, "cal"),
        rail: readEcsMonthDisplay(prefsRes.data?.ui_prefs, "rail"),
      },
    },
  };
}
