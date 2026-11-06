import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { kstToday } from "@/lib/date-kst";
import { mondayOf, shiftDays, weekLabel } from "@/features/timetable/lib/week";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { keepEnglishTrack } from "@/features/classes/english-track";
import { hasLiveSlotInWeek } from "../lib/grid";
import { dowKeyOf, normalizeSlotTime, YMD_RE, type DowKey } from "../lib/week";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import {
  goalCellStateOf,
  goalKey,
  indexDayLines,
  indexGoals,
  type DayLine,
  type GoalCellState,
  type GoalRow,
  type PlanLineRow,
  type RoleGoal,
  type GoalsBoardRole,
  type GoalsBoardView,
} from "../lib/goals-board";
import { readEcsGoalsRole, readEcsGoalsView } from "../view-prefs";
import { freshRawUiPrefs } from "@/lib/filter-reset/server";
import { ecsVisibleClassFilter } from "./access";
import { loadViewerUiPrefs } from "./viewer-prefs";
import type { MonthSlot } from "../lib/month-assemble";

/**
 * **반 계획 보기**(/ecs/goals) — 인재원 영어 반 × 영역, 그 달 월간 목표 ↔ 그 주 주간 목표(원장 2026-09-23 C안).
 *
 * 🔴 표에서 고쳐도 목표는 반 시트와 같은 `upsertGoal`, 일간 계획은 같은 `SlotPlanBlock`을 쓴다.
 * 🔴 **반 목록 = ECS 랜딩과 같은 거르기**: 영어·운영·그 주 폐강 전 · 스코프(`ecsVisibleClassFilter(주)` —
 *    게이트와 같은 세 갈래) · **그 주에 배정 교시가 있는 반**(`hasLiveSlotInWeek`) · 프로그램은 **인재원 영어**
 *    (`keepEnglishTrack("injaewon")` = EiE가 아닌 전부, 비대칭 규약). 랜딩 '인재원 영어 N'과 같은 반 수가 나와야 한다.
 * 🔴 월간 = 그 주 월요일이 속한 달(반 시트의 `monthStart`와 같은 규칙) — 달이 걸친 주에 두 화면이 다른 달을 보지 않게.
 * ⚠️ `class_sheet_goals`는 RLS 정책이 없는 표라 admin + `tenant_id` 필터로 읽는다([[#104]]).
 * ⚠️ 한 반이 최대 24행(2기간 × 2역할 × 6영역)이라 청크 100반이면 1,000행을 넘는다 → 청크 × 페이징([[#54]]).
 */

export type GoalsBoardCell = {
  area: string;
  state: GoalCellState;
  /** 적힌 목표만(담임 → 부담임 순). 담임·부담임 보기면 0~1개, 전체면 0~2개. */
  month: RoleGoal[];
  week: RoleGoal[];
  /** 그 날 시트에 적힌 계획 줄(자리 교시 제외) — 빈 배열 = 수업은 있는데 안 적음. */
  day: DayLine[];
};

export type GoalsBoardRow = {
  classId: string;
  className: string;
  teacherName: string | null;
  /** 그 날 이 반에 (자리 아닌) 수업 교시가 있나 — 없으면 일간 줄은 '수업 없음'. */
  hasLessonOnDate: boolean;
  /** 일간 줄 더블클릭 때 기존 수업계획 편집기에 넘길 실제 수업 교시. */
  daySlots: MonthSlot[];
  cells: GoalsBoardCell[];
};

export type GoalsBoardResult =
  | {
      ok: true;
      date: string;
      weekMonday: string;
      weekLabel: string;
      monthStart: string;
      today: string;
      role: GoalsBoardRole;
      canEdit: boolean;
      view: GoalsBoardView;
      areas: SkillAreaSetting[];
      rows: GoalsBoardRow[];
    }
  | { ok: false; error: string };

export async function getGoalsBoard(dateParam?: string | null): Promise<GoalsBoardResult> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const level = await accessLevelTenant(user.systemRole, "ecs");
  if (level === "none") return { ok: false, error: "접근 권한이 없습니다" };

  const today = kstToday();
  // 일간의 기준 날짜 — 기본 오늘(원장 *"오늘날짜 기준으로"*). 주·월은 이 날짜에서 따라온다.
  const date = dateParam && YMD_RE.test(dateParam) ? dateParam : today;
  const weekMonday = mondayOf(date);
  const weekSunday = shiftDays(weekMonday, 6);
  const monthStart = `${weekMonday.slice(0, 7)}-01`;

  const supabase = await createClient();
  const admin = createAdminClient();
  const [settings, classesRes, prefsRes, scope] = await Promise.all([
    getTenantSettings(),
    supabase
      .from("classes")
      .select("id, class_name, teacher_id, english_track")
      .eq("subject", "english")
      .eq("is_active", true)
      .or(`closed_at.is.null,closed_at.gte.${weekMonday}`)
      .order("class_name"),
    // 역할·보기 토글은 보는 사람(실제 계정) 것 — 쓰기(goals-board-actions → patchMyUiPrefs)와 같은 행(viewer-prefs.ts).
    loadViewerUiPrefs(),
    ecsVisibleClassFilter(weekMonday),
  ]);
  if (classesRes.error) return { ok: false, error: `반 목록을 불러오지 못했습니다: ${classesRes.error.message}` };
  const english = settings.operations.subjects.find((s) => s.key === "english");
  const areas = resolveSkillAreas(english);
  // 담임/부담임 필터는 10분 넘게 안 본 영어 시트면 기본값(원장 2026-10-15 — src/lib/filter-reset/rules.ts). 보기 방식은 그대로.
  const role = readEcsGoalsRole(await freshRawUiPrefs("ecs", prefsRes.data?.ui_prefs));
  const view = readEcsGoalsView(prefsRes.data?.ui_prefs);

  const scopeSet = scope.classIds ? new Set(scope.classIds) : null;
  const candidates = keepEnglishTrack(
    (classesRes.data ?? []).filter((c) => !scopeSet || scopeSet.has(c.id as string)),
    "injaewon",
  );
  const candidateIds = candidates.map((c) => c.id as string);

  const [schedules, teachers] = await Promise.all([
    fetchInChunks<{
      class_id: string;
      day_of_week: DowKey;
      start_time: string;
      slot_teacher_label: string | null;
      end_time: string | null;
      slot_room_label: string | null;
      valid_from: string;
      valid_to: string | null;
    }>(
      candidateIds,
      (chunk) =>
        supabase
          .from("class_schedules")
          .select("class_id, day_of_week, start_time, end_time, slot_teacher_label, slot_room_label, valid_from, valid_to")
          .in("class_id", chunk)
          .lte("valid_from", weekSunday)
          .or(`valid_to.is.null,valid_to.gte.${weekMonday}`),
    ),
    fetchInChunks<{ id: string; display_name: string | null }>(
      [...new Set(candidates.map((c) => c.teacher_id as string | null).filter((v): v is string => !!v))],
      (chunk) => supabase.from("users").select("id, display_name").in("id", chunk),
    ),
  ]);
  const slotsByClass = new Map<string, { dayOfWeek: DowKey; validFrom: string; validTo: string | null }[]>();
  for (const s of schedules) {
    const arr = slotsByClass.get(s.class_id) ?? [];
    arr.push({ dayOfWeek: s.day_of_week, validFrom: s.valid_from, validTo: s.valid_to });
    slotsByClass.set(s.class_id, arr);
  }
  const running = candidates.filter((c) => hasLiveSlotInWeek(weekMonday, slotsByClass.get(c.id as string) ?? []));
  const runningIds = running.map((c) => c.id as string);

  // 그 날 도는 교시 — 자리(JJ·LAB) 시작시각은 일간 줄에서 빼고, 자리 아닌 교시가 있어야 '수업 있음'.
  const dow = dowKeyOf(date);
  const seatStarts = new Map<string, Set<string>>();
  const lessonOnDate = new Set<string>();
  const daySlotsByClass = new Map<string, MonthSlot[]>();
  for (const s of schedules) {
    if (s.day_of_week !== dow || s.valid_from > date || (s.valid_to !== null && s.valid_to < date)) continue;
    if (specialSlotLabel(s.slot_teacher_label)) {
      const set = seatStarts.get(s.class_id) ?? new Set<string>();
      set.add(normalizeSlotTime(s.start_time));
      seatStarts.set(s.class_id, set);
    } else {
      lessonOnDate.add(s.class_id);
      const slots = daySlotsByClass.get(s.class_id) ?? [];
      const slotStart = normalizeSlotTime(s.start_time);
      if (!slots.some((slot) => slot.slotStart === slotStart)) {
        slots.push({
          slotStart,
          slotEnd: s.end_time ? normalizeSlotTime(s.end_time) : null,
          teacherLabel: s.slot_teacher_label,
          roomLabel: s.slot_room_label,
          seat: null,
        });
      }
      daySlotsByClass.set(s.class_id, slots);
    }
  }
  for (const slots of daySlotsByClass.values()) slots.sort((a, b) => a.slotStart.localeCompare(b.slotStart));

  // 목표와 그 날 계획 줄은 서로 독립 → 병렬(B4). 둘 다 행이 많을 수 있어 청크 × 페이징([[#54]]).
  const [goalRows, lineRows] =
    areas.length === 0
      ? [[], []]
      : await Promise.all([
          fetchAllPagedInChunks<GoalRow>(runningIds, (chunk, from, to) =>
            admin
              .from("class_sheet_goals")
              .select("id, class_id, scope, role, skill_area, textbook, target_progress")
              .eq("tenant_id", user.tenantId)
              .in("role", role === "all" ? ["homeroom", "assistant"] : [role])
              .in("class_id", chunk)
              .or(`and(scope.eq.month,period_start.eq.${monthStart}),and(scope.eq.week,period_start.eq.${weekMonday})`)
              .order("id")
              .range(from, to),
          ),
          fetchAllPagedInChunks<PlanLineRow>(runningIds, (chunk, from, to) =>
            admin
              .from("class_sheet_plan_lines")
              .select("id, class_id, slot_start, skill_area, line_no, textbook, page_range, progress, homework")
              .eq("tenant_id", user.tenantId)
              .in("class_id", chunk)
              .eq("plan_date", date)
              .order("id")
              .range(from, to),
          ),
        ]);
  const idx = indexGoals(goalRows, role);
  const dayIdx = indexDayLines(lineRows, seatStarts);
  // 배정이 바뀌어 현재 교시가 없어도 표에 남아 보이는 과거 계획 줄은 더블클릭해 고칠 수 있어야 한다.
  for (const line of lineRows) {
    const start = normalizeSlotTime(line.slot_start);
    if (seatStarts.get(line.class_id)?.has(start)) continue;
    if (![line.textbook, line.page_range, line.progress, line.homework].some((v) => v?.trim())) continue;
    const slots = daySlotsByClass.get(line.class_id) ?? [];
    if (slots.some((slot) => slot.slotStart === start)) continue;
    slots.push({ slotStart: start, slotEnd: null, teacherLabel: null, roomLabel: null, seat: null });
    slots.sort((a, b) => a.slotStart.localeCompare(b.slotStart));
    daySlotsByClass.set(line.class_id, slots);
  }
  const teacherName = new Map(teachers.map((t) => [t.id, t.display_name]));

  const rows: GoalsBoardRow[] = running
    .map((c) => {
      const id = c.id as string;
      return {
        classId: id,
        className: (c.class_name as string) ?? "",
        teacherName: teacherName.get(c.teacher_id as string) ?? null,
        hasLessonOnDate: lessonOnDate.has(id),
        daySlots: daySlotsByClass.get(id) ?? [],
        cells: areas.map((a) => {
          const month = idx.month.get(goalKey(id, a.key)) ?? [];
          const week = idx.week.get(goalKey(id, a.key)) ?? [];
          const day = dayIdx.get(goalKey(id, a.key)) ?? [];
          return { area: a.key, state: goalCellStateOf(month, week), month, week, day };
        }),
      };
    })
    // 담임끼리 모아 읽힌다(랜딩의 담임 묶음과 같은 결) — 담임 없는 반은 맨 뒤.
    .sort(
      (a, b) =>
        Number(a.teacherName === null) - Number(b.teacherName === null) ||
        (a.teacherName ?? "").localeCompare(b.teacherName ?? "", "ko") ||
        a.className.localeCompare(b.className, "ko"),
    );

  return { ok: true, date, weekMonday, weekLabel: weekLabel(weekMonday), monthStart, today, role, canEdit: level === "full" || level === "scoped", view, areas, rows };
}
