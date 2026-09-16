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
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getTenantSettings } from "@/features/owner/server/queries";
import { settingsToPeriodsConfig, weekdayTableFor } from "@/features/timetable/lib/periods";
import { resolvePeriodLabel, tableToEntries } from "@/features/class-sheets/lib/period-label";
import { isWeekendDow } from "@/features/class-sheets/lib/grid-rows";
import { dowKeyOf } from "@/features/class-sheets/lib/week";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import { kstToday } from "@/lib/date-kst";
import { buildLessonSchedule, MAX_LOOKAHEAD_DAYS, type LessonPace, type SlotAxis } from "../lesson-schedule";
import type { ApplyPreview, ApplyPreviewRow, ApplyResult } from "../types";
import { friendlyTextbookError, isMissingTextbookTable, TEXTBOOKS_NOT_READY } from "./access";

export type PlanActionResult = { ok: true; id: string } | { ok: false; error: string };
export type PlanPreviewResult = { ok: true; preview: ApplyPreview } | { ok: false; error: string };
export type PlanApplyResult = { ok: true; result: ApplyResult } | { ok: false; error: string };

export type ClassTextbookPlanInput = {
  id?: string | null;
  classId: string;
  textbookId: string;
  slotAxis: SlotAxis;
  pace: LessonPace;
  termMode: "regular" | "exam";
  startDate: string;
  startLessonNo: number;
};

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function saveClassTextbookPlan(input: ClassTextbookPlanInput): Promise<PlanActionResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.startDate)) return { ok: false, error: "시작일을 골라 주세요" };
  const today = kstToday();

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
  };

  if (input.id) {
    const { error } = await admin
      .from("class_textbook_plans")
      .update(payload)
      .eq("tenant_id", gate.access.tenantId)
      .eq("id", input.id);
    if (error) return { ok: false, error: friendlyTextbookError(error, "배정을 수정하지 못했습니다", "이 반에 같은 교재가 이미 배정돼 있습니다") };
    await logAction({ action: "textbook_plan_update", targetType: "class", targetLabel: gate.access.className, metadata: { id: input.id, textbookId: input.textbookId } });
    revalidatePath("/textbooks");
    return { ok: true, id: input.id };
  }

  const { data, error } = await admin
    .from("class_textbook_plans")
    .insert({ ...payload, tenant_id: gate.access.tenantId, created_by: gate.access.user.id })
    .select("id")
    .single();
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
    metadata: { id: data.id, textbookId: input.textbookId, axis, pace },
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
  };
};

/** 배정 1건 + 그 반 ECS 게이트. 🔴 반 id는 **DB 행에서** 읽는다(클라가 준 값을 믿지 않는다). */
async function loadPlan(planId: string): Promise<LoadedPlan | { error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("class_textbook_plans")
    .select("id, tenant_id, class_id, textbook_id, slot_axis, pace, term_mode, start_date, start_lesson_no")
    .eq("id", planId)
    .maybeSingle();
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

  await admin
    .from("class_textbook_plans")
    .update({ last_applied_at: new Date().toISOString(), last_applied_by: gate.access.user.id })
    .eq("tenant_id", gate.access.tenantId)
    .eq("id", planId);

  await logAction({
    action: "textbook_plan_apply",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: { planId, textbook: computed.title, ...result, from: kstToday() },
  });
  revalidatePath("/textbooks");
  revalidatePath(`/ecs/${plan.classId}`);
  return { ok: true, result };
}
