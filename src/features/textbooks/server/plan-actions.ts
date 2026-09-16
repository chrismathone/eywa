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
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import { resolvePeriodLabel, tableToEntries } from "@/features/class-sheets/lib/period-label";
import { isWeekendDow } from "@/features/class-sheets/lib/grid-rows";
import { dowKeyOf } from "@/features/class-sheets/lib/week";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import { kstToday } from "@/lib/date-kst";
import { buildLessonSchedule, MAX_LOOKAHEAD_DAYS, type LessonPace, type SlotAxis } from "../lesson-schedule";
import type { ApplyPreview, ApplyPreviewRow, ApplyResult, ClassSlotChoice } from "../types";
import { friendlyTextbookError, isMissingTextbookTable, SLOTS_NOT_READY, TEXTBOOKS_NOT_READY } from "./access";

export type PlanActionResult = { ok: true; id: string } | { ok: false; error: string };
export type PlanPreviewResult = { ok: true; preview: ApplyPreview } | { ok: false; error: string };
export type PlanApplyResult = { ok: true; result: ApplyResult } | { ok: false; error: string };

export type ClassTextbookPlanInput = {
  id?: string | null;
  classId: string;
  textbookId: string;
  /** 옛 축(0268a 이전). `slotStarts`가 있으면 표시·호환용으로만 저장된다. */
  slotAxis: SlotAxis;
  /** 고른 교시 시작시각(`"HH:MM"`) — 원장 2026-09-16 "16시 수업 클릭 17시 수업 클릭". */
  slotStarts?: string[] | null;
  pace: LessonPace;
  termMode: "regular" | "exam";
  startDate: string;
  startLessonNo: number;
  /** 방금 기입을 마쳤나 — 기록의 '마지막 기입'을 지금으로 찍는다(시트 흐름에서만 true). */
  markApplied?: boolean;
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `slot_starts`(0268a)가 아직 없는 DB인가.
 * 🔴 **코드만 본다** — 메시지에 `slot_starts`가 들어갔다고 "컬럼 없음"으로 보면, 그 칸의 CHECK 위반
 *    (`class_textbook_plans_slot_starts_len`, 23514)까지 같은 갈래로 삼켜져 사람이 고른 교시가
 *    조용히 사라진다(적대적 리뷰 P2).
 */
function isMissingSlotStartsColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204";
}

export async function saveClassTextbookPlan(input: ClassTextbookPlanInput): Promise<PlanActionResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.startDate)) return { ok: false, error: "시작일을 골라 주세요" };
  const today = kstToday();

  // 🔴 형식은 **앱이 지킨다**(0268a CHECK는 개수만 본다) — 시간표에서 뽑은 값만 오지만 한 번 더 거른다.
  const HHMM = /^[0-2][0-9]:[0-5][0-9]$/;
  const slotStarts = [...new Set((input.slotStarts ?? []).map((v) => String(v).slice(0, 5)))]
    .filter((v) => HHMM.test(v))
    .sort();
  if ((input.slotStarts ?? []).length > 0 && slotStarts.length === 0) {
    return { ok: false, error: "교시를 다시 골라 주세요" };
  }
  if (slotStarts.length > 12) return { ok: false, error: "한 배정에 교시를 12개까지 고를 수 있습니다" };
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
  const withSlots = slotStarts.length > 0 ? { ...payload, slot_starts: slotStarts } : payload;

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
    if (error && isMissingSlotStartsColumn(error)) {
      // 🔴 **고른 교시가 있으면 조용히 떨어뜨리지 않는다**(적대적 리뷰 P0) — 축으로 폴백하면 사람이
      //    고르지도 않은 교시에까지 차수가 깔린다(16:20만 골랐는데 16:20·17:20·18:20 전부, 3배 속도로).
      //    되돌리려면 줄을 하나씩 지워야 하니 "잘못 눌러도 잃을 게 없다"가 깨진다. 거절이 맞다.
      if (slotStarts.length > 0) return { ok: false, error: SLOTS_NOT_READY };
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
    await logAction({ action: "textbook_plan_update", targetType: "class", targetLabel: gate.access.className, metadata: { id: targetId, textbookId: input.textbookId, slots: slotStarts } });
    revalidatePath("/textbooks");
    return { ok: true, id: targetId };
  }

  const base = { tenant_id: gate.access.tenantId, created_by: gate.access.user.id };
  let { data, error } = await admin
    .from("class_textbook_plans")
    .insert({ ...withSlots, ...base })
    .select("id")
    .single();
  if (error && isMissingSlotStartsColumn(error)) {
    // 🔴 위와 같은 이유 — 고른 교시가 있으면 거절한다(P0).
    if (slotStarts.length > 0) return { ok: false, error: SLOTS_NOT_READY };
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
    metadata: { id: data.id, textbookId: input.textbookId, axis, pace, slots: slotStarts },
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
    slotStarts: string[] | null;
  };
};

/** 배정 1건 + 그 반 ECS 게이트. 🔴 반 id는 **DB 행에서** 읽는다(클라가 준 값을 믿지 않는다). */
async function loadPlan(planId: string): Promise<LoadedPlan | { error: string }> {
  const admin = createAdminClient();
  const BASE = "id, tenant_id, class_id, textbook_id, slot_axis, pace, term_mode, start_date, start_lesson_no";
  let { data, error } = await admin
    .from("class_textbook_plans")
    .select(`${BASE}, slot_starts`)
    .eq("id", planId)
    .maybeSingle();
  // 0268a 미적용이면 그 칸 없이 한 번 더 — 그 배정은 옛 축 방식으로 읽는다([[#95]]).
  if (error && isMissingSlotStartsColumn(error)) {
    ({ data, error } = await admin.from("class_textbook_plans").select(BASE).eq("id", planId).maybeSingle());
  }
  if (error) return { error: isMissingTextbookTable(error) ? TEXTBOOKS_NOT_READY : "배정을 찾지 못했습니다" };
  if (!data) return { error: "배정을 찾을 수 없습니다" };

  const gate = await requireEcsClassAccess(String(data.class_id), { write: true });
  if (!gate.ok) return { error: gate.error };
  // 테넌트 이중 확인 — admin 조회라 RLS가 안 걸린다.
  if (String(data.tenant_id) !== gate.access.tenantId) return { error: "배정을 찾을 수 없습니다" };

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
      slotStarts:
        Array.isArray((data as { slot_starts?: unknown }).slot_starts) &&
        ((data as { slot_starts: unknown[] }).slot_starts.length ?? 0) > 0
          ? (data as { slot_starts: unknown[] }).slot_starts.map((v) => String(v).slice(0, 5))
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
 * 🔑 진도·과제가 **둘 다 빈 차수는 대상에서 뺀다** — 교재명만 적힌 줄이 서면 ECS 작성률이 "계획 있음"으로
 *    올라가 거짓 신호가 된다(빈 칸을 채우는 게 아니라 없는 계획을 있는 것처럼 만든다).
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
    slotStarts: plan.slotStarts,
    pace: plan.pace,
    lookaheadDays: MAX_LOOKAHEAD_DAYS,
  });

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

export async function previewTextbookApply(planId: string): Promise<PlanPreviewResult> {
  const loaded = await loadPlan(planId);
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
    if (!t.progress && !t.homework) return { ...base, outcome: "skip-empty-lesson" as const };

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

export async function applyTextbookPlan(planId: string): Promise<PlanApplyResult> {
  const loaded = await loadPlan(planId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  return applyLoaded(loaded, planId);
}

/** 기입 본체 — 저장된 배정과 시트에서 고른 입력이 **같은 함수**를 탄다. */
async function applyLoaded(loaded: LoadedPlan, planId?: string): Promise<PlanApplyResult> {
  const computed = await computeTargets(loaded);
  if ("error" in computed) return { ok: false, error: computed.error };
  const { gate, plan } = loaded;

  // 진도·과제가 둘 다 빈 차수는 보내지 않는다(위 🔑). 🔴 **지난 날짜도 빼고** 보낸다 — 미리보기가
  //    `skip-past`로 보여 준 것과 같은 집합이어야 화면과 결과가 갈리지 않는다.
  const today = kstToday();
  const targets = computed.targets.filter((t) => t.date >= today && (t.progress || t.homework));
  if (targets.length === 0) {
    return {
      ok: false,
      error: "기입할 칸이 없습니다 — 차수에 진도·과제가 비어 있거나, 남은 수업일이 모두 지난 날짜입니다",
    };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("ecs_apply_textbook_lessons", {
    p_tenant: gate.access.tenantId,
    p_actor: gate.access.user.id,
    p_class: plan.classId,
    p_term_mode: plan.termMode,
    p_skill_area: computed.skillArea,
    p_title: computed.title,
    p_page_time: computed.pageTime,
    p_targets: targets.map((t) => ({
      date: t.date,
      slot: t.slotStart,
      progress: t.progress,
      homework: t.homework,
    })),
  });
  if (error) {
    // RPC가 던지는 식별자는 화면에 그대로 내보내지 않는다(raw 노출 금지).
    if (/ECS_TOO_MANY_TARGETS/.test(error.message ?? "")) {
      return {
        ok: false,
        error: "한 번에 기입할 칸이 너무 많습니다(최대 300칸) — 시작 차수를 올리거나 교재를 나눠 배정하세요",
      };
    }
    return { ok: false, error: friendlyTextbookError(error, "기입하지 못했습니다") };
  }

  const out = (data ?? {}) as Partial<ApplyResult>;
  const result: ApplyResult = {
    applied: Number(out.applied ?? 0),
    filled: Number(out.filled ?? 0),
    added: Number(out.added ?? 0),
    skipped: Number(out.skipped ?? 0),
    truncated: Number(out.truncated ?? 0),
  };

  if (planId) {
    await admin
      .from("class_textbook_plans")
      .update({ last_applied_at: new Date().toISOString(), last_applied_by: gate.access.user.id })
      .eq("tenant_id", gate.access.tenantId)
      .eq("id", planId);
  }

  await logAction({
    action: "textbook_plan_apply",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: { planId: planId ?? null, textbook: computed.title, ...result, from: kstToday() },
  });
  revalidatePath("/textbooks");
  revalidatePath(`/ecs/${plan.classId}`);
  return { ok: true, result };
}

/**
 * 교재 깔기 창이 쓰는 **읽기 진입점 둘** — 클라 컴포넌트가 `server/queries.ts`를 직접 import하면
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

// ── 시트에서 바로 깔기 — **저장 없이** 미리보기, 반영할 때만 기록을 남긴다 ─────────────────

export type TextbookFillInput = {
  classId: string;
  textbookId: string;
  /** 고른 교시 시작시각(`"HH:MM"`). 비면 거절한다 — 축으로 떨어뜨리지 않는다. */
  slotStarts: string[];
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
  if (!YMD_RE.test(input.startDate)) return { error: "시작일을 골라 주세요" };

  const HHMM = /^[0-2][0-9]:[0-5][0-9]$/;
  const slotStarts = [...new Set(input.slotStarts.map((v) => String(v).slice(0, 5)))].filter((v) => HHMM.test(v)).sort();
  // 🔴 **비면 거절**한다 — 빈 목록을 그대로 넘기면 `buildLessonSchedule`이 옛 축으로 떨어져 고르지도 않은
  //    교시에까지 깔린다(적대적 리뷰 P0와 같은 실패).
  if (slotStarts.length === 0) return { error: "교시를 하나 이상 골라 주세요" };
  if (slotStarts.length > 12) return { error: "한 번에 교시를 12개까지 고를 수 있습니다" };

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
      slotStarts,
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
  const done = await applyLoaded(loaded);
  if (!done.ok) return done;

  // 기록 — 실패해도 기입은 이미 됐으므로 막지 않는다(목록에만 안 뜬다).
  await saveClassTextbookPlan({
    classId: input.classId,
    textbookId: input.textbookId,
    slotAxis: "class",
    slotStarts: loaded.plan.slotStarts ?? [],
    pace: loaded.plan.pace,
    termMode: loaded.plan.termMode,
    startDate: input.startDate,
    startLessonNo: loaded.plan.startLessonNo,
    markApplied: true,
  }).catch(() => undefined);

  return done;
}
