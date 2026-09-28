"use server";

/**
 * 반 교재 배정 + 차수 자동기입.
 *
 * 🔴 **게이트는 교재목록이 아니라 ECS다** — 기입은 그 반의 계획 줄을 쓰는 행위라
 *    `requireEcsClassAccess(classId, { write: true })`를 탄다(0266a 헤더). 교재 마스터를 못 고치는
 *    담임 강사도 자기 반에 교재를 태울 수 있어야 이 기능이 쓰인다.
 * 🔴 **배분 규칙은 [`buildLessonSchedule`](../lesson-schedule.ts) 한 곳** — 미리보기와 기입이 같은
 *    함수를 타야 화면과 결과가 갈리지 않는다.
 * 🔴 **자동 쓰기 없음** — 배정을 저장하는 것만으로는 아무 칸도 안 바뀐다. 사람이 [기입]을 눌러야 돈다.
 */
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { requireEcsClassAccess } from "@/features/class-sheets/server/access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleOnForTenant } from "@/features/owner/server/modules";
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import { resolvePeriodLabel, tableToEntries } from "@/features/class-sheets/lib/period-label";
import { isWeekendDow } from "@/features/class-sheets/lib/grid-rows";
import { canonicalSlotTeacherLabel } from "@/features/timetable/lib/teacher-label";
import { dowKeyOf } from "@/features/class-sheets/lib/week";
import { slotLiveOnDate } from "@/features/timetable/lib/week";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import { kstToday } from "@/lib/date-kst";
import {
  buildLessonSchedule,
  MAX_LOOKAHEAD_DAYS,
  parseSlotPick,
  slotPickKey,
  type LessonPace,
  type SlotAxis,
} from "../lesson-schedule";
import type { ApplyPreview, ApplyPreviewRow, ApplyResult, ClassSlotChoice, ClassTextbookPlanRow } from "../types";
import { friendlyTextbookError, isMissingTextbookTable, SLOTS_NOT_READY, TEXTBOOKS_NOT_READY } from "./access";

export type PlanActionResult = { ok: true; id: string } | { ok: false; error: string };
export type PlanPreviewResult = { ok: true; preview: ApplyPreview } | { ok: false; error: string };
export type PlanApplyResult = { ok: true; result: ApplyResult } | { ok: false; error: string };

export type ClassTextbookPlanInput = {
  id?: string | null;
  classId: string;
  textbookId: string;
  /** 옛 축(0268a 이전). `slotPicks`가 있으면 표시·호환용으로만 저장된다. */
  slotAxis: SlotAxis;
  /** 고른 교시(`"mon|17:20"`) — 요일까지 담는다(원장 2026-09-18, `lesson-schedule.ts` 주석). */
  slotPicks?: string[] | null;
  pace: LessonPace;
  termMode: "regular" | "exam";
  startDate: string;
  startLessonNo: number;
  /** 방금 기입을 마쳤나 — 기록의 '마지막 기입'을 지금으로 찍는다(시트 흐름에서만 true). */
  markApplied?: boolean;
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 한 배정이 담을 수 있는 교시 칸 수. 요일까지 세는 값이라(`"mon|17:20"`) 시각 기준이던 옛 상한(12)보다
 * 넉넉해야 한다 — 주 6일 × 하루 4교시 = 24가 현실 최대다.
 */
const MAX_SLOT_PICKS = 48;

/**
 * 고른 교시를 정규화한다 — 모양이 틀린 값은 **버린다**(형식은 앱이 지킨다, 0268a CHECK는 개수만 본다).
 * ⚠️ 정렬해 둔다: RPC가 날짜·교시 오름차순을 전제로 락을 잡고(교착 회피), 감사로그도 같은 순서로 남는다.
 */
function normalizeSlotPicks(raw: readonly string[] | null | undefined): string[] {
  const out = new Set<string>();
  for (const v of raw ?? []) {
    const parsed = parseSlotPick(String(v));
    if (!parsed) continue;
    out.add(parsed.dow ? slotPickKey(parsed.dow, parsed.start) : parsed.start);
  }
  return [...out].sort();
}

/**
 * `slot_picks`(0268a)가 아직 없는 DB인가.
 * 🔴 **코드만 본다** — 메시지에 `slot_picks`가 들어갔다고 "컬럼 없음"으로 보면, 그 칸의 CHECK 위반
 *    (`class_textbook_plans_slot_picks_len`, 23514)까지 같은 갈래로 삼켜져 사람이 고른 교시가
 *    조용히 사라진다(적대적 리뷰 P2).
 */
function isMissingSlotPicksColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204";
}

/**
 * 🔴 **교재목록 모듈을 끈 학원에선 배정 액션이 돌지 않는다**(감사 S7) — 서버 액션은 공개 엔드포인트라
 *    화면에서 [교재 배정] 입구를 감춘 것만으로는 게이트가 아니다([[#77]]). 판정 실패는 켜진 것으로 본다
 *    (`isModuleOnForTenant` fail-open — 침산은 꺼진 모듈이 없다).
 * ⚠️ [월간계획 전체 가져오기](`importPlannedRange`)·회차 미루기는 시트의 **실제** 쪽 문이라 여기 걸지 않는다.
 */
const TEXTBOOKS_MODULE_OFF = "이 학원은 교재목록 기능이 꺼져 있습니다";
async function textbooksModuleOff(tenantId: string): Promise<boolean> {
  return !(await isModuleOnForTenant(tenantId, "textbooks"));
}

export async function saveClassTextbookPlan(input: ClassTextbookPlanInput): Promise<PlanActionResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (await textbooksModuleOff(gate.access.tenantId)) return { ok: false, error: TEXTBOOKS_MODULE_OFF };
  if (!YMD_RE.test(input.startDate)) return { ok: false, error: "시작일을 골라 주세요" };
  const today = kstToday();

  // 🔴 형식은 **앱이 지킨다**(0268a CHECK는 개수만 본다) — 시간표에서 뽑은 값만 오지만 한 번 더 거른다.
  const slotPicks = normalizeSlotPicks(input.slotPicks);
  if ((input.slotPicks ?? []).length > 0 && slotPicks.length === 0) {
    return { ok: false, error: "교시를 다시 골라 주세요" };
  }
  // 요일까지 세므로 상한을 올린다 — 주 6일 × 하루 4교시가 들어와도 막히지 않게(옛 상한 12는 시각 기준이었다).
  if (slotPicks.length > MAX_SLOT_PICKS) {
    return { ok: false, error: `한 배정에 교시를 ${MAX_SLOT_PICKS}칸까지 고를 수 있습니다` };
  }
  const axis: SlotAxis = input.slotAxis === "jj" ? "jj" : "class";
  const pace: LessonPace = input.pace === "day" ? "day" : "period";
  const termMode = input.termMode === "exam" ? "exam" : "regular";
  const startLessonNo = Math.max(1, Math.min(200, Math.trunc(Number(input.startLessonNo) || 1)));

  const admin = createAdminClient();

  // 🔴 **과거로는 새로 못 건다**(시간표 가져오기 [`effective-date.ts`]와 같은 규칙). 소급하면 지난 달의
  //    빈 계획 칸이 채워져 **지난 달 작성률·'미작성 N' 배지가 뒤늦게 움직인다** — 그 숫자로 사람을 평가하는데
  //    되돌리는 길은 줄을 하나씩 지우는 것뿐이다.
  // ⚠️ 판정은 **"오늘보다 이르면"이 아니라 "이번 저장에서 바뀌었으면"**이다(이력서 이메일 변경과 같은 규약) —
  //    전자로 하면 지난달에 만든 배정은 단위 하나만 고치려 해도 저장이 통째로 거절된다.
  // ⚠️ 오늘은 **서버(KST)** 가 정한다 — 클라 `new Date()`면 타임존이 어긋나 오늘이 거절되거나 어제가 통과한다.
  if (input.startDate < today) {
    const prev = input.id
      ? ((
          await admin
            .from("class_textbook_plans")
            .select("start_date")
            .eq("tenant_id", gate.access.tenantId)
            .eq("id", input.id)
            .maybeSingle()
        ).data?.start_date ?? null)
      : null;
    if (String(prev ?? "") !== input.startDate) {
      return {
        ok: false,
        error: "시작일을 지난 날짜로 잡을 수 없습니다 — 지난 날짜에 기입하면 그 달 작성률이 뒤늦게 바뀝니다",
      };
    }
  }

  const { data: book, error: bookErr } = await admin
    .from("textbooks")
    .select("id, title, skill_area, session_count")
    .eq("tenant_id", gate.access.tenantId)
    .eq("id", input.textbookId)
    .maybeSingle();
  if (bookErr) return { ok: false, error: friendlyTextbookError(bookErr, "교재를 찾지 못했습니다") };
  if (!book) return { ok: false, error: "교재를 찾을 수 없습니다" };
  // 구분이 없으면 계획 줄을 만들 수 없다(`skill_area`가 NOT NULL) — 저장 전에 정직하게 막는다.
  if (!book.skill_area) return { ok: false, error: "이 교재에 구분이 없어 반에 배정할 수 없습니다 — 교재목록에서 구분을 먼저 정하세요" };
  if (Number(book.session_count ?? 0) < 1) return { ok: false, error: "이 교재에 차수가 없습니다 — 교재목록에서 차수를 먼저 정하세요" };

  const payload = {
    class_id: input.classId,
    textbook_id: input.textbookId,
    slot_axis: axis,
    pace,
    term_mode: termMode,
    start_date: input.startDate,
    start_lesson_no: startLessonNo,
    ...(input.markApplied
      ? { last_applied_at: new Date().toISOString(), last_applied_by: gate.access.user.id }
      : {}),
  };
  /** 0268a가 적용됐을 때만 실린다 — 아래에서 42703이면 이 칸을 빼고 다시 쓴다([[#95]]). */
  const withSlots = slotPicks.length > 0 ? { ...payload, slot_picks: slotPicks } : payload;

  /** 같은 (반, 교재) 배정이 이미 있으면 **갈아 끼운다** — 교시만 바꿔 다시 거는 게 정상 흐름이다. */
  // 🔴 **축까지 같은 행**만 갈아 끼운다 — 유니크가 `(tenant, class, textbook, slot_axis)`라 축이 다른
  //    형제 행이 있을 수 있고(0266a가 JJ를 별도 축으로 둔다), 축을 무시하고 잡으면 그 행의 축을 바꿔
  //    형제와 23505로 부딪히거나 **둘 중 아무거나** 덮어쓴다(적대적 리뷰 P2).
  // ⚠️ 정렬을 준다 — 없으면 어느 행이 잡히는지가 호출마다 달라진다.
  let existing: string | null = null;
  if (!input.id) {
    const found = await admin
      .from("class_textbook_plans")
      .select("id")
      .eq("tenant_id", gate.access.tenantId)
      .eq("class_id", input.classId)
      .eq("textbook_id", input.textbookId)
      .eq("slot_axis", axis)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    // 조회 실패를 삼키지 않는다 — 삼키면 insert로 떨어져 23505가 나거나 중복 행이 생긴다.
    if (found.error) return { ok: false, error: friendlyTextbookError(found.error, "배정을 확인하지 못했습니다") };
    existing = (found.data?.id as string | undefined) ?? null;
  }
  const targetId = input.id ?? existing;

  if (targetId) {
    let { error } = await admin
      .from("class_textbook_plans")
      .update(withSlots)
      .eq("tenant_id", gate.access.tenantId)
      .eq("id", targetId);
    if (error && isMissingSlotPicksColumn(error)) {
      // 🔴 **고른 교시가 있으면 조용히 떨어뜨리지 않는다**(적대적 리뷰 P0) — 축으로 폴백하면 사람이
      //    고르지도 않은 교시에까지 차수가 깔린다(16:20만 골랐는데 16:20·17:20·18:20 전부, 3배 속도로).
      //    되돌리려면 줄을 하나씩 지워야 하니 "잘못 눌러도 잃을 게 없다"가 깨진다. 거절이 맞다.
      if (slotPicks.length > 0) return { ok: false, error: SLOTS_NOT_READY };
      ({ error } = await admin
        .from("class_textbook_plans")
        .update(payload)
        .eq("tenant_id", gate.access.tenantId)
        .eq("id", targetId));
    }
    if (error) {
      return {
        ok: false,
        error: friendlyTextbookError(error, "배정을 수정하지 못했습니다", "이 반에 같은 교재가 이미 배정돼 있습니다"),
      };
    }
    await logAction({ action: "textbook_plan_update", targetType: "class", targetLabel: gate.access.className, metadata: { id: targetId, textbookId: input.textbookId, slots: slotPicks } });
    revalidatePath("/textbooks");
    return { ok: true, id: targetId };
  }

  const base = { tenant_id: gate.access.tenantId, created_by: gate.access.user.id };
  let { data, error } = await admin
    .from("class_textbook_plans")
    .insert({ ...withSlots, ...base })
    .select("id")
    .single();
  if (error && isMissingSlotPicksColumn(error)) {
    // 🔴 위와 같은 이유 — 고른 교시가 있으면 거절한다(P0).
    if (slotPicks.length > 0) return { ok: false, error: SLOTS_NOT_READY };
    ({ data, error } = await admin
      .from("class_textbook_plans")
      .insert({ ...payload, ...base })
      .select("id")
      .single());
  }
  if (error || !data) {
    return {
      ok: false,
      error: friendlyTextbookError(error ?? {}, "배정을 만들지 못했습니다", "이 반에 같은 교재가 이미 배정돼 있습니다"),
    };
  }
  await logAction({
    action: "textbook_plan_create",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: { id: data.id, textbookId: input.textbookId, axis, pace, slots: slotPicks },
  });
  revalidatePath("/textbooks");
  return { ok: true, id: data.id as string };
}

export async function deleteClassTextbookPlan(planId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const loaded = await loadPlan(planId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { gate } = loaded;

  const { error } = await createAdminClient()
    .from("class_textbook_plans")
    .delete()
    .eq("tenant_id", gate.access.tenantId)
    .eq("id", planId);
  if (error) return { ok: false, error: friendlyTextbookError(error, "배정을 지우지 못했습니다") };
  await logAction({ action: "textbook_plan_delete", targetType: "class", targetLabel: gate.access.className, metadata: { id: planId } });
  revalidatePath("/textbooks");
  // 월간계획은 배정에서 **계산**되므로 배정이 사라지면 그 반 시트의 '계획' 표식도 함께 사라져야 한다
  // (`"layout"` — 월간 화면은 `/ecs/<반>/month`라 기본값이면 정작 보는 화면이 안 바뀐다, [[#102]] 계열).
  revalidatePath(`/ecs/${loaded.plan.classId}`, "layout");
  return { ok: true };
}

// ── 미리보기 / 기입 ──────────────────────────────────────────────────────────

type LoadedPlan = {
  gate: Extract<Awaited<ReturnType<typeof requireEcsClassAccess>>, { ok: true }>;
  plan: {
    id: string;
    classId: string;
    textbookId: string;
    axis: SlotAxis;
    pace: LessonPace;
    termMode: "regular" | "exam";
    startDate: string;
    startLessonNo: number;
    slotPicks: string[] | null;
  };
};

/** 배정 1건 + 그 반 ECS 게이트. 🔴 반 id는 **DB 행에서** 읽는다(클라가 준 값을 믿지 않는다). */
async function loadPlan(planId: string, opts: { write: boolean } = { write: true }): Promise<LoadedPlan | { error: string }> {
  const admin = createAdminClient();
  const BASE = "id, tenant_id, class_id, textbook_id, slot_axis, pace, term_mode, start_date, start_lesson_no";
  let { data, error } = await admin
    .from("class_textbook_plans")
    .select(`${BASE}, slot_picks`)
    .eq("id", planId)
    .maybeSingle();
  // 0268a 미적용이면 그 칸 없이 한 번 더 — 그 배정은 옛 축 방식으로 읽는다([[#95]]).
  if (error && isMissingSlotPicksColumn(error)) {
    ({ data, error } = await admin.from("class_textbook_plans").select(BASE).eq("id", planId).maybeSingle());
  }
  if (error) return { error: isMissingTextbookTable(error) ? TEXTBOOKS_NOT_READY : "배정을 찾지 못했습니다" };
  if (!data) return { error: "배정을 찾을 수 없습니다" };

  // 읽기 전용 미리보기는 읽기 게이트, 삭제는 쓰기 게이트 — 둘 다 **그 반의 ECS 권한**이다.
  const gate = await requireEcsClassAccess(String(data.class_id), { write: opts.write });
  if (!gate.ok) return { error: gate.error };
  // 테넌트 이중 확인 — admin 조회라 RLS가 안 걸린다.
  if (String(data.tenant_id) !== gate.access.tenantId) return { error: "배정을 찾을 수 없습니다" };
  if (await textbooksModuleOff(gate.access.tenantId)) return { error: TEXTBOOKS_MODULE_OFF };

  return {
    gate,
    plan: {
      id: String(data.id),
      classId: String(data.class_id),
      textbookId: String(data.textbook_id),
      axis: data.slot_axis === "jj" ? "jj" : "class",
      pace: data.pace === "day" ? "day" : "period",
      termMode: data.term_mode === "exam" ? "exam" : "regular",
      startDate: String(data.start_date),
      startLessonNo: Number(data.start_lesson_no ?? 1),
      slotPicks:
        Array.isArray((data as { slot_picks?: unknown }).slot_picks) &&
        ((data as { slot_picks: unknown[] }).slot_picks.length ?? 0) > 0
          ? normalizeSlotPicks((data as { slot_picks: unknown[] }).slot_picks.map((v) => String(v)))
          : null,
    },
  };
}

type Computed = {
  title: string;
  pageTime: string | null;
  skillArea: string;
  targets: { lessonNo: number; date: string; slotStart: string; progress: string | null; homework: string | null }[];
  unplaced: number[];
  skippedHolidays: { date: string; name: string }[];
  periodLabelBySlot: Record<string, string>;
};

/**
 * 배정 → 어디에 무엇을 넣을지. 미리보기와 기입이 **같은 함수**를 탄다.
 * 🔑 대상 차수는 `startLessonNo..sessionCount`이고 **`textbook_lessons` 행 유무와 무관하다** — 진도·과제를
 *    아직 안 적은 교재도 교재명·페이지/시간은 들어간다(원장 2026-09-17 *"진도 과제가 비어있어도 들어는
 *    가져야함 교재넣고 추가하거나 새로쓸수도있자나"*). 실측으로도 이 학원 계획 줄 2,550개 중 290개(11%)가
 *    이미 교재명만 적힌 줄이다.
 */
async function computeTargets(loaded: LoadedPlan): Promise<Computed | { error: string }> {
  const { gate, plan } = loaded;
  const admin = createAdminClient();

  const [bookRes, settings, schedRes] = await Promise.all([
    admin
      .from("textbooks")
      .select("title, page_time, skill_area, session_count")
      .eq("tenant_id", gate.access.tenantId)
      .eq("id", plan.textbookId)
      .maybeSingle(),
    getTenantSettings(),
    admin
      .from("class_schedules")
      .select("day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label, slot_room_label")
      .eq("tenant_id", gate.access.tenantId)
      .eq("class_id", plan.classId)
      // 결정적 순서 — 상한에 닿아도 어느 행이 잘렸는지가 호출마다 달라지지 않게.
      .order("day_of_week", { ascending: true })
      .order("start_time", { ascending: true })
      .range(0, 499),
  ]);

  if (bookRes.error) return { error: friendlyTextbookError(bookRes.error, "교재를 찾지 못했습니다") };
  const book = bookRes.data;
  if (!book) return { error: "교재를 찾을 수 없습니다" };
  const skillArea = (book.skill_area as string | null) ?? null;
  if (!skillArea) return { error: "이 교재에 구분이 없어 기입할 수 없습니다" };
  const sessionCount = Number(book.session_count ?? 0);
  if (sessionCount < 1) return { error: "이 교재에 차수가 없습니다" };
  if (schedRes.error) return { error: "시간표를 읽지 못했습니다" };

  // 🔴 **삼키지 않는다**([[#89]]) — 빈 배열로 떨어지면 미리보기가 전건을 "그 차수에 진도·과제가 없습니다"로
  //    말하고, 사람은 이미 적어 둔 차수를 다시 적으라는 **따를 수 없는 안내**를 받는다.
  let lessons: { lesson_no: number; progress: string | null; homework: string | null }[];
  try {
    lessons = await fetchAllPaged<{ lesson_no: number; progress: string | null; homework: string | null }>(
      (from, to) =>
        admin
          .from("textbook_lessons")
          .select("lesson_no, progress, homework")
          .eq("tenant_id", gate.access.tenantId)
          .eq("textbook_id", plan.textbookId)
          .order("lesson_no", { ascending: true })
          .range(from, to),
    );
  } catch {
    return { error: "교재의 차수를 읽지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };
  }
  const byNo = new Map(lessons.map((l) => [Number(l.lesson_no), l]));

  const lessonNos: number[] = [];
  for (let n = plan.startLessonNo; n <= sessionCount; n += 1) lessonNos.push(n);
  if (lessonNos.length === 0) return { error: "시작 차수가 교재의 마지막 차수보다 뒤입니다" };

  const schedules = (schedRes.data ?? []).map(
    (r): MonthScheduleRow => ({
      dayOfWeek: String(r.day_of_week),
      startTime: String(r.start_time),
      endTime: r.end_time ? String(r.end_time) : null,
      validFrom: r.valid_from ? String(r.valid_from) : null,
      validTo: r.valid_to ? String(r.valid_to) : null,
      slotTeacherLabel: (r.slot_teacher_label as string | null) ?? null,
      slotRoomLabel: (r.slot_room_label as string | null) ?? null,
    }),
  );

  const schedule = buildLessonSchedule({
    startDate: plan.startDate,
    lessonNos,
    schedules,
    holidays: buildHolidayMap(settings.operations.holidays),
    axis: plan.axis,
    // 고른 교시가 있으면 **그것이 축을 이긴다**(0268a) — 없으면 옛 축 방식.
    slotPicks: plan.slotPicks,
    pace: plan.pace,
    lookaheadDays: MAX_LOOKAHEAD_DAYS,
  });

  /**
   * 🔴 **한 배정엔 같은 담당의 교시만 담는다**(원장 2026-09-18: *"교사가 다르면 교재배정을 새로해야지"*).
   *    섞으면 차수가 두 선생님 칸에 **번갈아** 들어간다 — 추민아 1차수 · 송지혜 2차수 · 추민아 3차수…
   *    두 사람의 진도가 한 줄로 엮여 어느 쪽도 자기 진도를 못 읽는다.
   * 🔴 화면에서만 막지 않는다([[#77]]) — 서버 액션은 공개 엔드포인트라 여기서 다시 센다.
   * 🔴 **실제로 쓸 칸만 센다** — `schedules`엔 끝난 배치 이력이 함께 들어 있어([[#88]]) 원본 행을 그대로 세면
   *    `중고E_중1 MED` 월 17:20처럼 담당이 바뀌어 온 칸(부원장 → Daniella → Jane)이 "셋이 섞였다"로 잡혀
   *    **멀쩡한 배정이 거절된다**. 그래서 배분 결과(`targets`)의 그 날짜에 **살아 있는** 행만 본다.
   * ⚠️ 비교는 **정규화한 원문**(`canonicalSlotTeacherLabel`)으로 — `부원장`과 `Yoojin`은 같은 사람이라
   *    원문 그대로 세면 한 사람인데 둘로 보여 역시 거절된다.
   * ⚠️ 옛 축 방식(`slotPicks` 없음)엔 걸지 않는다 — 축은 원래 그 반 전 교시를 뜻해 담당이 섞이는 게 정상이다.
   */
  if (plan.slotPicks && plan.slotPicks.length > 0) {
    const labels = new Set<string>();
    const seen = new Set<string>();
    for (const t of schedule.targets) {
      const key = `${dowKeyOf(t.date)}|${t.slotStart}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // `slotsByDateOf`와 같은 규칙 — 그 날짜에 살아 있는 행 중 **처음 만난 것**이 그 칸의 주인이다.
      const row = schedules.find(
        (r) =>
          r.dayOfWeek === dowKeyOf(t.date) &&
          String(r.startTime).slice(0, 5) === t.slotStart &&
          slotLiveOnDate({ dayOfWeek: r.dayOfWeek, validFrom: r.validFrom, validTo: r.validTo }, t.date),
      );
      labels.add(canonicalSlotTeacherLabel(row?.slotTeacherLabel ?? null) ?? "");
    }
    if (labels.size > 1) {
      return { error: "한 배정엔 같은 담당의 교시만 담을 수 있습니다 — 선생님이 다르면 따로 배정해 주세요" };
    }
  }

  // 교시 라벨 — 월간 뷰와 같은 규약(요일별 표 + 주말 별도). 못 찾으면 null(지어내지 않는다).
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  const periodTables = {
    weekday: tableToEntries(weekdayTableFor(gate.access.subject, periodsConfig)),
    weekend: tableToEntries(periodsConfig.weekend),
  };
  const periodLabelBySlot: Record<string, string> = {};
  const slotEndByKey = new Map<string, string | null>();
  for (const t of schedule.targets) {
    const key = `${t.date}|${t.slotStart}`;
    if (periodLabelBySlot[key] !== undefined || slotEndByKey.has(key)) continue;
    const row = schedules.find(
      (s) => s.dayOfWeek === dowKeyOf(t.date) && String(s.startTime).slice(0, 5) === t.slotStart,
    );
    const end = row?.endTime ? String(row.endTime).slice(0, 5) : null;
    slotEndByKey.set(key, end);
    const label = resolvePeriodLabel(t.slotStart, end, periodTables, isWeekendDow(dowKeyOf(t.date)));
    if (label) periodLabelBySlot[key] = label;
  }

  return {
    title: String(book.title),
    pageTime: (book.page_time as string | null) ?? null,
    skillArea,
    targets: schedule.targets.map((t) => {
      const l = byNo.get(t.lessonNo);
      return {
        ...t,
        progress: (l?.progress ?? null) || null,
        homework: (l?.homework ?? null) || null,
      };
    }),
    unplaced: schedule.unplaced,
    skippedHolidays: schedule.skippedHolidays,
    periodLabelBySlot,
  };
}

/** 저장된 배정의 월간계획 미리보기 — **읽기 전용**(교재목록 '반 배정' 탭, 원장 결정 D1). */
export async function previewTextbookApply(planId: string): Promise<PlanPreviewResult> {
  const loaded = await loadPlan(planId, { write: false });
  if ("error" in loaded) return { ok: false, error: loaded.error };
  return previewLoaded(loaded, planId);
}

/**
 * 미리보기 본체 — **저장된 배정**(`previewTextbookApply`)과 **아직 저장 안 한 입력**
 * (`previewTextbookFill`)이 같은 함수를 탄다. 두 벌이면 화면과 결과가 갈린다.
 */
async function previewLoaded(loaded: LoadedPlan, planId: string): Promise<PlanPreviewResult> {
  const computed = await computeTargets(loaded);
  if ("error" in computed) return { ok: false, error: computed.error };

  const { gate, plan } = loaded;
  const dates = [...new Set(computed.targets.map((t) => t.date))].sort();
  const admin = createAdminClient();

  // 이미 그 칸에 무엇이 있는지 — 미리보기의 `outcome`이 실제 기입과 같은 답을 내야 한다.
  let existing: {
    plan_date: string;
    slot_start: string;
    skill_area: string;
    textbook: string | null;
    page_range: string | null;
    progress: string | null;
    homework: string | null;
  }[];
  try {
    existing =
    dates.length === 0
      ? []
      : await fetchAllPaged<{
          plan_date: string;
          slot_start: string;
          skill_area: string;
          textbook: string | null;
          page_range: string | null;
          progress: string | null;
          homework: string | null;
        }>((from, to) =>
          admin
            .from("class_sheet_plan_lines")
            .select("plan_date, slot_start, skill_area, textbook, page_range, progress, homework")
            .eq("tenant_id", gate.access.tenantId)
            .eq("class_id", plan.classId)
            .eq("term_mode", plan.termMode)
            .gte("plan_date", dates[0]!)
            .lte("plan_date", dates[dates.length - 1]!)
            // ⚠️ offset 페이징은 **유일한 tie-break**가 있어야 흔들리지 않는다(batch.ts) —
            //    (날짜, 줄번호)는 교시가 여럿이면 유일하지 않다.
            .order("plan_date", { ascending: true })
            .order("slot_start", { ascending: true })
            .order("line_no", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        );
  } catch {
    // 🔴 빈 배열로 삼키면 **전건이 '새 줄'로 보이고** 버튼의 칸 수가 부풀려진다(그리고 실제로는 채워진다).
    return { ok: false, error: "지금 적혀 있는 계획을 읽지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };
  }

  const bySlot = new Map<string, typeof existing>();
  for (const row of existing) {
    const key = `${String(row.plan_date)}|${String(row.slot_start).slice(0, 5)}`;
    const list = bySlot.get(key) ?? [];
    list.push(row);
    bySlot.set(key, list);
  }
  /** 한 (날짜,교시,시기)에 설 수 있는 줄 수 — `class_sheet_plan_lines.line_no` CHECK(1..20)와 같은 값. */
  const MAX_LINES_PER_SLOT = 20;
  /** 이번 미리보기에서 그 슬롯에 새로 세우기로 한 줄 수(상한 계산용). */
  const plannedAdds = new Map<string, number>();
  const today = kstToday();
  const has = (v: string | null | undefined) => (v ?? "").trim() !== "";
  const sameTitle = (v: string | null | undefined) =>
    (v ?? "").trim().toLowerCase() === computed.title.trim().toLowerCase();

  const rows: ApplyPreviewRow[] = computed.targets.map((t) => {
    const key = `${t.date}|${t.slotStart}`;
    const lines = bySlot.get(key) ?? [];
    const base = {
      lessonNo: t.lessonNo,
      date: t.date,
      slotStart: t.slotStart,
      periodLabel: computed.periodLabelBySlot[key] ?? null,
      progress: t.progress,
      homework: t.homework,
    };
    // 🔴 **지난 날짜엔 안 쓴다** — 배정을 만든 뒤 늦게 기입하면 시작일과 오늘 사이 칸이 과거에 채워져
    //    그 달 작성률이 뒤늦게 움직인다. 차수 번호는 그대로 두고(밀지 않고) 그 칸만 건너뛴다 —
    //    이미 지난 수업은 "계획"이 아니라 **실제로 무엇을 했는지**를 사람이 적을 자리다.
    if (t.date < today) return { ...base, outcome: "skip-past" as const };

    // 🔴 RPC(`ecs_apply_textbook_lessons`)와 **같은 순서·같은 조건**이어야 미리보기가 실제 기입을 맞힌다:
    //    ① 같은 교재명 + **같은 구분** → ② 같은 구분의 완전히 빈 줄 → ③ 새 줄.
    //    구분이 다른 같은 교재명 줄은 **대상이 아니다**(그쪽에 쓰면 writing 계획이 vocab 줄에 적힌다).
    const hit =
      lines.find((l) => sameTitle(l.textbook) && l.skill_area === computed.skillArea) ??
      lines.find(
        (l) =>
          l.skill_area === computed.skillArea &&
          !has(l.textbook) && !has(l.page_range) && !has(l.progress) && !has(l.homework),
      );
    if (!hit) {
      // 🔑 줄 상한(20)을 **여기서도** 센다 — 안 세면 미리보기가 '새 줄'이라고 해 놓고 RPC가 `truncated`로
      //    돌려준다(버튼의 칸 수가 거짓이 된다). 이미 이 슬롯에 새 줄을 몇 개 예약했는지까지 함께.
      const used = (lines.length ?? 0) + (plannedAdds.get(key) ?? 0);
      if (used >= MAX_LINES_PER_SLOT) return { ...base, outcome: "skip-full" as const };
      plannedAdds.set(key, (plannedAdds.get(key) ?? 0) + 1);
      return { ...base, outcome: "add" as const };
    }

    const willFill =
      !has(hit.textbook) ||
      (!has(hit.page_range) && has(computed.pageTime)) ||
      (!has(hit.progress) && has(t.progress)) ||
      (!has(hit.homework) && has(t.homework));
    return { ...base, outcome: willFill ? ("fill" as const) : ("skip-filled" as const) };
  });

  return {
    ok: true,
    preview: {
      planId,
      className: gate.access.className,
      textbookTitle: computed.title,
      rows,
      unplaced: computed.unplaced,
      skippedHolidays: computed.skippedHolidays,
    },
  };
}

// 🔴 **저장된 배정을 실제 칸으로 기입하던 문(`applyTextbookPlan`)은 걷어냈다**(원장 결정 D1, 2026-09-23 —
//    09-22 *"배정은 실제 칸에 한 줄도 쓰지 않는다 · 실제는 [월간계획 가져오기]로만"*). 교재목록 '반 배정' 탭의
//    [기입]이 유일한 호출처였고, 남겨 두면 배정만으로 작성률이 오른다. 되살리지 말 것.

/**
 * 교재 배정 창이 쓰는 **읽기 진입점 둘** — 클라 컴포넌트가 `server/queries.ts`를 직접 import하면
 * 그 파일의 `import "server-only"`가 클라 번들로 끌려와 **빌드가 깨진다**([[#61]]). 그래서 서버 액션으로 감싼다.
 *
 * 🔴 게이트를 여기서 다시 건다 — 서버 액션은 **공개 엔드포인트**라 화면 조건은 게이트가 아니다([[#77]]).
 *    교시 목록은 그 반의 ECS 접근이면 되고(읽기), 교재 선택지는 교재목록 메뉴 접근이면 된다.
 */
export async function loadClassSlotChoices(
  classId: string,
): Promise<{ ok: true; rows: ClassSlotChoice[] } | { ok: false; error: string }> {
  const gate = await requireEcsClassAccess(classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const { getClassSlotChoices } = await import("./queries");
  const res = await getClassSlotChoices(classId);
  return { ok: true, rows: res.rows };
}

/**
 * 이 반에 걸린 배정 — 시트의 교재 배정 창이 [배정 삭제]를 세우는 데 쓴다(감사 F4).
 * 게이트는 그 반의 ECS 읽기(교시 목록과 같다). 모듈이 꺼졌으면 빈 목록.
 */
export async function loadClassTextbookPlans(
  classId: string,
): Promise<{ ok: true; rows: ClassTextbookPlanRow[] } | { ok: false; error: string }> {
  const gate = await requireEcsClassAccess(classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (await textbooksModuleOff(gate.access.tenantId)) return { ok: true, rows: [] };
  const { getClassTextbookPlans } = await import("./queries");
  const res = await getClassTextbookPlans({ classId });
  if (res.status === "missing-table") return { ok: false, error: TEXTBOOKS_NOT_READY };
  if (res.status === "failed") return { ok: false, error: "배정 목록을 불러오지 못했습니다" };
  return { ok: true, rows: res.rows };
}

export async function loadAssignableTextbooks(): Promise<
  { ok: true; rows: { id: string; title: string; skillArea: string | null; sessionCount: number }[] } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "textbooks"))) return { ok: false, error: "접근 권한이 없습니다" };
  const { getAssignableTextbooks } = await import("./queries");
  const res = await getAssignableTextbooks();
  return { ok: true, rows: res.rows };
}

// ── 시트에서 바로 배정 — **저장 없이** 미리보기, 반영할 때만 기록을 남긴다 ─────────────────

export type TextbookFillInput = {
  classId: string;
  textbookId: string;
  /** 고른 교시 시작시각(`"HH:MM"`). 비면 거절한다 — 축으로 떨어뜨리지 않는다. */
  slotPicks: string[];
  pace: LessonPace;
  termMode: "regular" | "exam";
  startDate: string;
  startLessonNo: number;
};

/**
 * 입력 → 가상의 배정 한 건. **DB에 아무것도 안 쓴다.**
 *
 * 🔴 미리보기가 배정을 저장하던 것을 걷어낸 자리다(적대적 리뷰 P1): 그땐 ① 미리보기만 눌러도 이미 있던
 *    다른 배정의 시작일·차수가 덮어써졌고, ② 교재를 바꿔 다시 미리보기하면 **같은 행의 교재가 갈아끼워져**
 *    앞 교재의 배정 기록과 '마지막 기입' 날짜가 그 교재 것인 양 남았다. 저장은 [기입]할 때 한 번만 한다.
 */
async function loadFillInput(input: TextbookFillInput): Promise<LoadedPlan | { error: string }> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { error: gate.error };
  if (await textbooksModuleOff(gate.access.tenantId)) return { error: TEXTBOOKS_MODULE_OFF };
  if (!YMD_RE.test(input.startDate)) return { error: "시작일을 골라 주세요" };

  const slotPicks = normalizeSlotPicks(input.slotPicks);
  // 🔴 **비면 거절**한다 — 빈 목록을 그대로 넘기면 `buildLessonSchedule`이 옛 축으로 떨어져 고르지도 않은
  //    교시에까지 깔린다(적대적 리뷰 P0와 같은 실패).
  if (slotPicks.length === 0) return { error: "교시를 하나 이상 골라 주세요" };
  if (slotPicks.length > MAX_SLOT_PICKS) return { error: `한 번에 교시를 ${MAX_SLOT_PICKS}칸까지 고를 수 있습니다` };

  return {
    gate,
    plan: {
      id: "",
      classId: input.classId,
      textbookId: input.textbookId,
      axis: "class",
      pace: input.pace === "day" ? "day" : "period",
      termMode: input.termMode === "exam" ? "exam" : "regular",
      startDate: input.startDate,
      startLessonNo: Math.max(1, Math.min(200, Math.trunc(Number(input.startLessonNo) || 1))),
      slotPicks,
    },
  };
}

/** 시트에서 고른 그대로 미리보기 — 저장 없음. */
export async function previewTextbookFill(input: TextbookFillInput): Promise<PlanPreviewResult> {
  const loaded = await loadFillInput(input);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  return previewLoaded(loaded, "");
}

/**
 * 시트에서 고른 그대로 기입 — 쓰고 나서 **기록을 남긴다**(교재목록의 읽기 전용 목록이 그걸 본다).
 * ⚠️ 기록 저장이 실패해도 기입 자체는 이미 끝났다 — 실패를 삼키지 않되 기입 결과는 그대로 돌려준다.
 */
export async function applyTextbookFill(
  input: TextbookFillInput,
): Promise<PlanApplyResult> {
  const loaded = await loadFillInput(input);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  // 🔴 **계산이 되는지 먼저 확인한다** — 저장만 해 놓고 계획이 한 줄도 안 나오면(구분 없음·차수 없음·
  //    고른 교시에 남은 수업일 없음) 사람은 "배정했다"고 믿는데 월간엔 아무것도 안 뜬다.
  const computed = await computeTargets(loaded);
  if ("error" in computed) return { ok: false, error: computed.error };
  const today = kstToday();
  const upcoming = computed.targets.filter((t) => t.date >= today);
  if (upcoming.length === 0) {
    return { ok: false, error: "배정할 칸이 없습니다 — 고른 교시에 남은 수업일이 없습니다" };
  }

  // 🔴 **실제 칸엔 한 줄도 쓰지 않는다**(원장 2026-09-22 *"월간계획에서 교재배정을 해놓고 그걸 각자
  //    월간계획에서 가저오기 해서"*). 배정을 저장하면 월간계획이 거기서 **계산돼** 뜨고, 실제는
  //    강사가 [가져오기]를 누를 때만 채워진다. 그전엔 여기서 `applyLoaded`(RPC)를 불러 실제를 바로
  //    채웠는데, 그러면 배정만으로 작성률이 올라 "강사가 실제 나간 진도"가 거짓이 된다.
  const saved = await saveClassTextbookPlan({
    classId: input.classId,
    textbookId: input.textbookId,
    slotAxis: "class",
    slotPicks: loaded.plan.slotPicks ?? [],
    pace: loaded.plan.pace,
    termMode: loaded.plan.termMode,
    startDate: input.startDate,
    startLessonNo: loaded.plan.startLessonNo,
  });
  // ⚠️ 여기선 삼키지 않는다 — 저장이 실패하면 **계획 자체가 안 생긴다**(예전엔 기입이 이미 끝난 뒤의
  //    부가 기록이라 삼켜도 됐다). 0268a 미적용 안내도 이 길로 사람에게 닿는다.
  if (!saved.ok) return { ok: false, error: saved.error };

  await logAction({
    action: "textbook_plan_apply",
    targetType: "class",
    targetLabel: loaded.gate.access.className,
    metadata: { planId: saved.id, textbook: computed.title, planned: upcoming.length, from: today },
  });
  // 월간계획은 파생값이라 배정이 바뀌면 그 반 화면 전체가 달라진다([[#102]] 계열 — `"layout"` 필수).
  revalidatePath(`/ecs/${input.classId}`, "layout");
  revalidatePath("/ecs");
  revalidatePath("/textbooks");

  return {
    ok: true,
    result: { applied: 0, filled: 0, added: 0, skipped: 0, truncated: 0, planned: upcoming.length },
  };
}

// ── 가져오기 — 월간계획(일정)을 한 달치 **실제**로 옮긴다 ────────────────────────

export type ImportPlannedResult = { ok: true; result: ApplyResult; cells: number } | { ok: false; error: string };

/** 한 번에 가져올 수 있는 날 수 — 세션 한 달(최대 ~40일)을 넉넉히 덮는 상한. 락·시간 예산 가드. */
const IMPORT_MAX_DAYS = 62;
/** RPC 한 번에 싣는 칸 수 — RPC 상한(300, 락 예산)보다 넉넉히 작게. */
const IMPORT_CHUNK = 100;

/**
 * **[월간계획 전체 가져오기]** — 그 기간의 월간계획(**일정**, 미루기 반영)을 실제 계획 줄로 복사한다.
 *
 * 🔴 원장 2026-09-28: *"선생님이 월간계획 전체가져오기 기능 추가, 한주씩 가져오는건 필요없음"* — 옛
 *    교시 한 칸 가져오기(`importPlannedSlot`)는 없앴다. 계획이 실제에 들어가는 길은 **이 버튼 하나**다.
 * 🔑 가져오는 건 **일정**이다(원장 2026-09-28 *"계획 놔두고 일정만 밀리게"*) — 미룬 칸은 비워 두고 뒤로
 *    밀린 차수가 들어간다. 비교의 기준인 원래 계획(`baselineByCell`)은 여기서 안 쓴다.
 * 🔑 **빈 칸만 채운다** — 밑바닥은 기입과 같은 RPC(`ecs_apply_textbook_lessons`)라, 이미 적은 칸이나
 *    가져온 뒤 고쳐 쓴 값은 다시 눌러도 덮어쓰지 않는다(여러 번 눌러도 안전하다).
 * 🔴 게이트는 그 반의 ECS 쓰기 권한 — 서버 액션은 공개 엔드포인트다([[#77]]).
 */
export async function importPlannedRange(input: {
  classId: string;
  /** `"YYYY-MM-DD"` — 화면이 그린 기간(달력월 또는 세션). */
  from: string;
  to: string;
}): Promise<ImportPlannedResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.from) || !YMD_RE.test(input.to) || input.from > input.to) {
    return { ok: false, error: "기간이 올바르지 않습니다" };
  }
  const days = (Date.parse(`${input.to}T00:00:00Z`) - Date.parse(`${input.from}T00:00:00Z`)) / 86_400_000;
  if (!(days < IMPORT_MAX_DAYS)) return { ok: false, error: "한 번에 가져올 수 있는 기간을 넘었습니다" };

  const { getClassPlannedLines } = await import("./month-plan");
  const planned = await getClassPlannedLines({
    tenantId: gate.access.tenantId,
    subject: gate.access.subject,
    classId: input.classId,
    from: input.from,
    to: input.to,
  });
  if (planned.status === "missing-table") return { ok: false, error: TEXTBOOKS_NOT_READY };
  if (planned.status !== "ok") return { ok: false, error: "월간계획을 읽지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };

  const cells = Object.keys(planned.byCell).sort();
  const lines = cells.flatMap((k) => planned.byCell[k]!);
  if (lines.length === 0) return { ok: false, error: "이 기간엔 가져올 월간계획이 없습니다" };

  // 🔴 RPC는 (시기, 구분, 교재명) 한 벌을 받는다 — 교재마다 따로 부른다. 한 번에 뭉치면 다른 교재의
  //    진도가 첫 교재 줄에 적힌다(구분은 선호가 아니라 필터다, 0266a).
  const admin = createAdminClient();
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    const key = `${l.termMode}|${l.skillArea}|${l.title.trim().toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }

  const total: ApplyResult = { applied: 0, filled: 0, added: 0, skipped: 0, truncated: 0 };
  for (const group of groups.values()) {
    const head = group[0]!;
    // 날짜·교시 오름차순(동시 호출도 같은 순서로 락을 잡는다 — 0266a 교착 회피 규약).
    const sorted = [...group].sort((a, b) =>
      a.date === b.date ? a.slotStart.localeCompare(b.slotStart) : a.date.localeCompare(b.date),
    );
    for (let i = 0; i < sorted.length; i += IMPORT_CHUNK) {
      const { data, error } = await admin.rpc("ecs_apply_textbook_lessons", {
        p_tenant: gate.access.tenantId,
        p_actor: gate.access.user.id,
        p_class: input.classId,
        p_term_mode: head.termMode,
        p_skill_area: head.skillArea,
        p_title: head.title,
        p_page_time: head.pageTime,
        p_targets: sorted.slice(i, i + IMPORT_CHUNK).map((l) => ({
          date: l.date,
          slot: l.slotStart,
          progress: l.progress,
          homework: l.homework,
        })),
      });
      if (error) return { ok: false, error: friendlyTextbookError(error, "가져오지 못했습니다") };
      const out = (data ?? {}) as Partial<ApplyResult>;
      total.applied += Number(out.applied ?? 0);
      total.filled += Number(out.filled ?? 0);
      total.added += Number(out.added ?? 0);
      total.skipped += Number(out.skipped ?? 0);
      total.truncated += Number(out.truncated ?? 0);
    }
  }

  await logAction({
    action: "textbook_plan_import",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: { from: input.from, to: input.to, cells: cells.length, ...total },
  });
  // 실제 줄이 바뀌었다 — 그 반의 시트·월간을 통째로 무효화한다([[#102]] 계열 — `"layout"` 필수).
  revalidatePath(`/ecs/${input.classId}`, "layout");
  revalidatePath("/ecs");
  return { ok: true, result: total, cells: cells.length };
}

// ── 회차 미루기·당기기 — 그 칸에서 차수를 어떻게 할지 ─────────────────────────

export type LessonShiftKind = "skip" | "advance";
export type LessonShiftResult =
  | { ok: true; kind: LessonShiftKind | null }
  | { ok: false; error: string };

/**
 * **한 주 미루기 / 당기기**(0282a) — 그 (반, 날짜, 교시)에서 차수를 건너뛸지(`skip`) 버릴지(`advance`).
 *
 * 🔴 원장 2026-09-22: *"실제 에서는 수업 회차를 한주 미루거나 당기거나 할수있게 … 미루면 차수 무시하고
 *    수업내용 기입해서 쓸수있게"*. `skip`을 걸면 그 칸 **계획이 비므로** 강사가 실제 내용을 자유로 적고,
 *    그 뒤 차수는 한 칸씩 밀린다(휴일과 같은 규칙 — `buildLessonSchedule`).
 * 🔴 **실제 계획 줄은 한 줄도 안 바꾼다** — 이미 적어 둔 진도는 그대로 남고, 바뀌는 건 "앞으로 어느 칸에
 *    몇 차수가 오는가"뿐이다. 그래서 눌러도 잃을 게 없고 다시 눌러 되돌릴 수 있다.
 * 🔑 **토글**이다 — 같은 종류를 다시 누르면 표식을 지운다(그 칸이 원래대로 돌아온다).
 */
export async function setLessonShift(input: {
  classId: string;
  date: string;
  slotStart: string;
  /** null이면 표식을 지운다(원래대로). */
  kind: LessonShiftKind | null;
}): Promise<LessonShiftResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.date)) return { ok: false, error: "날짜가 올바르지 않습니다" };
  const slot = String(input.slotStart).slice(0, 5);
  if (!/^[0-2]\d:[0-5]\d$/.test(slot)) return { ok: false, error: "교시가 올바르지 않습니다" };
  const asked = input.kind === "skip" || input.kind === "advance" ? input.kind : null;

  const admin = createAdminClient();
  const where = { tenant_id: gate.access.tenantId, class_id: input.classId, plan_date: input.date, slot_start: slot };

  /**
   * 🔑 **토글은 서버가 판정한다** — 화면이 지금 상태를 몰라도 같은 버튼으로 켜고 끌 수 있다.
   *    (상태를 클라까지 내려보내지 않는 화면이 있어서 — 주간 시트 — 거기서도 버튼이 제대로 돈다.)
   * ⚠️ 표가 없으면(0282a 미적용) 조회도 실패한다 — 그건 아래 쓰기 단계에서 한글로 안내한다.
   */
  const cur = asked
    ? await admin
        .from("class_lesson_shifts")
        .select("kind")
        .eq("tenant_id", where.tenant_id)
        .eq("class_id", where.class_id)
        .eq("plan_date", where.plan_date)
        .eq("slot_start", where.slot_start)
        .maybeSingle()
    : null;
  const kind = asked && cur?.data?.kind === asked ? null : asked;

  const { error } = kind
    ? // 🔴 일반 유니크(부분 술어 없음, [[#113]])라 이 축으로 추론된다 — 토글이 같은 칸을 갈아끼운다.
      await admin
        .from("class_lesson_shifts")
        .upsert({ ...where, kind, created_by: gate.access.user.id, updated_at: new Date().toISOString() }, {
          onConflict: "tenant_id,class_id,plan_date,slot_start",
        })
    : await admin
        .from("class_lesson_shifts")
        .delete()
        .eq("tenant_id", where.tenant_id)
        .eq("class_id", where.class_id)
        .eq("plan_date", where.plan_date)
        .eq("slot_start", where.slot_start);

  if (error) {
    // 0282a 미적용 — 원인을 단정하지 않고 무엇이 필요한지 말한다([[#95]]).
    if (isMissingTextbookTable(error)) {
      return { ok: false, error: "회차 미루기는 마이그레이션 0282a가 필요합니다 — 적용한 뒤 다시 시도해 주세요" };
    }
    return { ok: false, error: friendlyTextbookError(error, "회차를 바꾸지 못했습니다") };
  }

  await logAction({
    action: "textbook_lesson_shift",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: { date: input.date, slot, kind },
  });
  // 계획은 파생값이라 이 한 줄이 그 반의 앞으로 전부를 바꾼다([[#102]] 계열 — `"layout"` 필수).
  revalidatePath(`/ecs/${input.classId}`, "layout");
  return { ok: true, kind };
}
