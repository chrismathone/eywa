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
import { YMD_RE, type DowKey } from "../lib/week";
import {
  goalCellState,
  goalKey,
  indexGoals,
  type GoalCellState,
  type GoalRow,
  type GoalText,
  type GoalsBoardRole,
} from "../lib/goals-board";
import { readEcsGoalsRole } from "../view-prefs";
import { ecsVisibleClassFilter } from "./access";

/**
 * **반 계획 보기**(/ecs/goals) — 인재원 영어 반 × 영역, 그 달 월간 목표 ↔ 그 주 주간 목표(원장 2026-09-23 C안).
 *
 * 🔴 **읽기 전용 화면이다** — 쓰기는 반 시트(왼쪽 계획 표 `upsertGoal`) 한 곳뿐이고 여기서 누르면 그 시트로 간다.
 *    같은 값을 두 화면에서 고치게 하면 저장 경로가 둘이 된다.
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
  month: GoalText | null;
  week: GoalText | null;
};

export type GoalsBoardRow = {
  classId: string;
  className: string;
  teacherName: string | null;
  cells: GoalsBoardCell[];
};

export type GoalsBoardResult =
  | {
      ok: true;
      weekMonday: string;
      weekLabel: string;
      monthStart: string;
      today: string;
      role: GoalsBoardRole;
      areas: SkillAreaSetting[];
      rows: GoalsBoardRow[];
    }
  | { ok: false; error: string };

export async function getGoalsBoard(weekParam?: string | null): Promise<GoalsBoardResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const level = await accessLevelTenant(user.systemRole, "ecs");
  if (level === "none") return { ok: false, error: "접근 권한이 없습니다" };

  const today = kstToday();
  const weekMonday = mondayOf(weekParam && YMD_RE.test(weekParam) ? weekParam : today);
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
    admin.from("users").select("ui_prefs").eq("id", user.id).eq("tenant_id", user.tenantId).maybeSingle(),
    ecsVisibleClassFilter(weekMonday),
  ]);
  if (classesRes.error) return { ok: false, error: `반 목록을 불러오지 못했습니다: ${classesRes.error.message}` };
  const english = settings.operations.subjects.find((s) => s.key === "english");
  const areas = resolveSkillAreas(english);
  const role = readEcsGoalsRole(prefsRes.data?.ui_prefs);

  const scopeSet = scope.classIds ? new Set(scope.classIds) : null;
  const candidates = keepEnglishTrack(
    (classesRes.data ?? []).filter((c) => !scopeSet || scopeSet.has(c.id as string)),
    "injaewon",
  );
  const candidateIds = candidates.map((c) => c.id as string);

  const [schedules, teachers] = await Promise.all([
    fetchInChunks<{ class_id: string; day_of_week: DowKey; valid_from: string; valid_to: string | null }>(
      candidateIds,
      (chunk) =>
        supabase
          .from("class_schedules")
          .select("class_id, day_of_week, valid_from, valid_to")
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

  const goalRows =
    areas.length === 0
      ? []
      : await fetchAllPagedInChunks<GoalRow>(runningIds, (chunk, from, to) =>
          admin
            .from("class_sheet_goals")
            .select("id, class_id, scope, role, skill_area, textbook, target_progress")
            .eq("tenant_id", user.tenantId)
            .eq("role", role)
            .in("class_id", chunk)
            .or(`and(scope.eq.month,period_start.eq.${monthStart}),and(scope.eq.week,period_start.eq.${weekMonday})`)
            .order("id")
            .range(from, to),
        );
  const idx = indexGoals(goalRows, role);
  const teacherName = new Map(teachers.map((t) => [t.id, t.display_name]));

  const rows: GoalsBoardRow[] = running
    .map((c) => {
      const id = c.id as string;
      return {
        classId: id,
        className: (c.class_name as string) ?? "",
        teacherName: teacherName.get(c.teacher_id as string) ?? null,
        cells: areas.map((a) => {
          const month = idx.month.get(goalKey(id, a.key)) ?? null;
          const week = idx.week.get(goalKey(id, a.key)) ?? null;
          return { area: a.key, state: goalCellState(month, week), month, week };
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

  return { ok: true, weekMonday, weekLabel: weekLabel(weekMonday), monthStart, today, role, areas, rows };
}
