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
import { recordImportBatch, snapshotPlanLines } from "./import-batch";
import { reportError } from "@/lib/observability/report-error";
import type { PlanLineDTO } from "@/features/class-sheets/server/actions";
import { shiftActualLines } from "./shift-lines";
import { shiftAlongPlans, type ShiftTarget } from "./shift-relay";
import { withMarkerCols, writeMarker } from "./shift-markers";
import { cellMarkerKey, markerKeyOfRow, parseMarkerKey } from "../shift-key";
import { readWeekCells, snapshotShiftState, type ShiftSnapshot } from "./shift-snapshot";
import { diffShift, isEmptyUndo, type ShiftUndoToken } from "../shift-undo";
import { clearPlanLines } from "./plan-delete-lines";
import {
  buildLessonSchedule,
  MAX_LOOKAHEAD_DAYS,
  normalizeSlotPicks,
  normalizeLessonPace,
  type LessonPace,
  type SlotAxis,
} from "../lesson-schedule";
import { groupCellLessons, type PlannedLine } from "../plan-expand";
import { applyCellLessons, ApplyCellLessonsError } from "./apply-cell-lessons";
import type { ApplyPreview, ApplyPreviewRow, ApplyResult, ClassSlotChoice, ClassTextbookPlanRow, PlanRestoreRow } from "../types";
import { placeSameBookPlan } from "../plan-siblings";
import { friendlyTextbookError, isMissingTextbookTable, SLOTS_NOT_READY, TEXTBOOKS_NOT_READY } from "./access";

export type PlanActionResult = { ok: true; id: string } | { ok: false; error: string };
export type PlanPreviewResult = { ok: true; preview: ApplyPreview } | { ok: false; error: string };
export type PlanApplyResult =
  | {
      ok: true;
      result: ApplyResult;
      /** 배정은 됐는데 실제에 못 넣었을 때의 사유(원장 2026-10-22 배정=가져오기). null = 문제 없음. */
      importError: string | null;
      /** 실제에 넣은 것의 되돌리기 기록 — 알림의 [실행 취소]가 쓴다. */
      undoBatchId: string | null;
    }
  | { ok: false; error: string };

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

/** 옛 유니크(0266a `class_textbook_plans_pos_uniq`)가 남은 DB — 같은 교재 두 번째 배정이 막힌다([[#95]]). */
const SAME_BOOK_NOT_READY =
  "같은 교재를 한 반에 여러 개 거는 기능은 DB 업데이트(20261021120000) 뒤에 열립니다 — 지금은 한 반에 한 개만 걸 수 있습니다";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 한 배정이 담을 수 있는 교시 칸 수. 요일까지 세는 값이라(`"mon|17:20"`) 시각 기준이던 옛 상한(12)보다
 * 넉넉해야 한다 — 주 6일 × 하루 4교시 = 24가 현실 최대다.
 */
const MAX_SLOT_PICKS = 48;

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
 * 단위 CHECK(`class_textbook_plans_pace_chk`)가 `min25`를 거절했나 — 0361a가 아직 손으로 적용되지 않은 DB다.
 * 🔑 그때는 `period`로 다시 쓴다: 칸 선택(`slot_picks`)이 있으면 두 단위의 배치가 **글자 그대로 같다**
 *    (교시마다 고른 자리 수만큼 — `buildLessonSchedule`). 거절해 버리면 SQL 하나 때문에 배정 자체가 막힌다([[#95]]).
 */
function isPaceRejected(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && error.code === "23514" && /pace_chk/.test(error.message ?? "");
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
  const pace: LessonPace = normalizeLessonPace(input.pace);
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

  /**
   * 같은 (반, 교재) 배정이 있을 때 — **여럿을 허용한다**(원장 2026-10-21 *"동일한 교재로 최대3개까지 … 각 차시가 각각
   * 돌도록"*). 고른 교시가 기존 배정 하나와 겹치면 그걸 갈아 끼우고(종전 흐름 "교시만 바꿔 다시 건다"), 안 겹치면
   * 새로 건다(3개까지). 규칙은 [`placeSameBookPlan`](../plan-siblings.ts) 한 곳이다.
   * ⚠️ 정렬을 준다 — 없으면 어느 행이 잡히는지가 호출마다 달라진다.
   */
  const siblingsQuery = (cols: string) =>
    admin
      .from("class_textbook_plans")
      .select(cols)
      .eq("tenant_id", gate.access.tenantId)
      .eq("class_id", input.classId)
      .eq("textbook_id", input.textbookId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });
  let found = await siblingsQuery("id, slot_picks");
  if (found.error && isMissingSlotPicksColumn(found.error)) found = await siblingsQuery("id");
  // 조회 실패를 삼키지 않는다 — 삼키면 insert로 떨어져 같은 교시에 같은 교재가 두 번 걸린다.
  if (found.error) return { ok: false, error: friendlyTextbookError(found.error, "배정을 확인하지 못했습니다") };
  const siblings = ((found.data ?? []) as unknown as { id: string; slot_picks?: unknown }[]).map((r) => ({
    id: String(r.id),
    slotPicks: Array.isArray(r.slot_picks) && r.slot_picks.length > 0 ? (r.slot_picks as unknown[]).map(String) : null,
  }));
  const placement = placeSameBookPlan({
    picks: slotPicks.length > 0 ? slotPicks : null,
    siblings,
    selfId: input.id ?? null,
  });
  if (placement.kind === "error") return { ok: false, error: placement.error };
  const existing = placement.kind === "update" ? placement.id : null;
  const targetId = existing;

  if (targetId) {
    const updateWith = (row: Record<string, unknown>) =>
      admin.from("class_textbook_plans").update(row).eq("tenant_id", gate.access.tenantId).eq("id", targetId);
    let { error } = await updateWith(withSlots);
    if (isPaceRejected(error) && pace === "min25") ({ error } = await updateWith({ ...withSlots, pace: "period" }));
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
  const insertWith = (row: Record<string, unknown>) =>
    admin.from("class_textbook_plans").insert(row).select("id").single();
  let { data, error } = await insertWith({ ...withSlots, ...base });
  if (isPaceRejected(error) && pace === "min25") {
    ({ data, error } = await insertWith({ ...withSlots, ...base, pace: "period" }));
  }
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
      // 23505 = 옛 유니크(반·교재·축)가 아직 있다 — 같은 교재 두 번째 배정은 SQL(20261021120000) 뒤에 열린다.
      error: friendlyTextbookError(error ?? {}, "배정을 만들지 못했습니다", SAME_BOOK_NOT_READY),
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

export type PlanDeleteResult =
  | {
      ok: true;
      /** 함께 지운 진도 줄·표식 수(`withLines`일 때만). */
      cleared?: { lines: number; markers: number };
      /** 되돌리기 재료 — 배정 한 줄 + (함께 지웠으면) 줄·표식 차이. 못 만들었으면 없다(되돌리기 버튼이 안 선다). */
      undo?: { plan: PlanRestoreRow; lines?: ShiftUndoToken };
      /** 배정은 지웠는데 진도 줄 지우기가 멈췄다 — 화면이 안내한다. */
      warning?: string;
    }
  | { ok: false; error: string };

/**
 * 배정 삭제. `withLines`면 **그 교재로 들어간 진도 줄과 그 칸의 미룸·당김 표식도** 함께 지운다(원장 2026-10-19 —
 * 잘못 배정한 교재 줄을 칸마다 하나씩 지우고 있었다). 범위·규칙은 [`clearPlanLines`](./plan-delete-lines.ts).
 * 🔑 배정을 **먼저** 지운다 — 줄 지우기가 멈춰도 배정은 사라졌으니 계획이 실제를 다시 채우지 않는다(그때는 경고 +
 *    그때까지의 되돌리기 기록).
 */
export async function deleteClassTextbookPlan(
  planId: string,
  opts: { withLines?: boolean } = {},
): Promise<PlanDeleteResult> {
  const loaded = await loadPlan(planId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { gate, plan } = loaded;
  const admin = createAdminClient();
  const tenantId = gate.access.tenantId;

  // 되돌리기 재료 — 지우기 **전** 배정 한 줄. 못 읽어도 삭제는 한다(되돌리기만 없다).
  const { data: raw } = await admin
    .from("class_textbook_plans")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", planId)
    .maybeSingle();
  const restore: PlanRestoreRow | null = raw
    ? {
        id: String(raw.id),
        class_id: String(raw.class_id),
        textbook_id: String(raw.textbook_id),
        slot_axis: raw.slot_axis === "jj" ? "jj" : "class",
        pace: String(raw.pace),
        term_mode: raw.term_mode === "exam" ? "exam" : "regular",
        start_date: String(raw.start_date).slice(0, 10),
        start_lesson_no: Number(raw.start_lesson_no ?? 1),
        slot_picks: Array.isArray(raw.slot_picks) ? (raw.slot_picks as unknown[]).map(String) : null,
        is_active: raw.is_active !== false,
        last_applied_at: raw.last_applied_at ? String(raw.last_applied_at) : null,
        last_applied_by: raw.last_applied_by ? String(raw.last_applied_by) : null,
        created_by: raw.created_by ? String(raw.created_by) : null,
      }
    : null;

  // 남는 배정들 — 표식을 같이 쓰는 칸을 가르고, 같은 교재가 다른 축에 남아 있으면 줄을 안 지운다.
  // ⚠️ 0268a 미적용 DB면 `slot_picks` 없이 다시 읽는다([[#95]]) — 그때 남는 배정은 모든 칸을 쓰는 것으로 본다.
  const from = plan.startDate.slice(0, 10) > kstToday() ? plan.startDate.slice(0, 10) : kstToday();
  let others: { textbook_id: unknown; slot_picks?: unknown }[] = [];
  // 평시 배정이면 줄을 안 지워도 그 교재의 줄 표식(0382a)은 지운다(`clearPlanLines` `withLines`) — 남는 배정을 알아야 한다.
  const clearsMarkers = opts.withLines || plan.termMode === "regular";
  if (clearsMarkers) {
    const q = (cols: string) =>
      admin
        .from("class_textbook_plans")
        .select(cols)
        .eq("tenant_id", tenantId)
        .eq("class_id", plan.classId)
        .eq("is_active", true)
        .neq("id", planId);
    let res = await q("id, textbook_id, slot_picks");
    if (res.error && isMissingSlotPicksColumn(res.error)) res = await q("id, textbook_id");
    if (res.error) return { ok: false, error: friendlyTextbookError(res.error, "배정을 지우지 못했습니다") };
    others = (res.data ?? []) as unknown as typeof others;
  }

  const { error } = await admin.from("class_textbook_plans").delete().eq("tenant_id", tenantId).eq("id", planId);
  if (error) return { ok: false, error: friendlyTextbookError(error, "배정을 지우지 못했습니다") };

  let cleared: { lines: number; markers: number } | undefined;
  let warning: string | undefined;
  let linesUndo: ShiftUndoToken | undefined;
  if (clearsMarkers) {
    // 같은 교재 배정이 남아 있으면(2026-10-21 여럿 허용) — 교시가 안 겹치니 **이 배정 교시의 줄만** 지운다.
    // 어느 쪽이든 고른 교시가 없는 옛 축 배정이면 칸으로 주인을 못 가르니 줄을 남긴다(종전 규칙).
    const sameBook = others.filter((o) => String(o.textbook_id) === plan.textbookId);
    const picksOrNull = (v: unknown) => (Array.isArray(v) && v.length > 0 ? (v as unknown[]).map(String) : null);
    const splitByPicks =
      sameBook.length > 0 && (plan.slotPicks?.length ?? 0) > 0 && sameBook.every((o) => picksOrNull(o.slot_picks) !== null);
    const keepLines = sameBook.length > 0 && !splitByPicks;
    try {
      const out = await clearPlanLines({
        admin,
        tenantId,
        classId: plan.classId,
        planId,
        onlyPicks: splitByPicks ? plan.slotPicks : null,
        textbookId: plan.textbookId,
        termMode: plan.termMode,
        picks: plan.slotPicks,
        otherPicks: others.map((o) =>
          Array.isArray(o.slot_picks) && o.slot_picks.length > 0 ? (o.slot_picks as unknown[]).map(String) : null,
        ),
        keepLines,
        withLines: !!opts.withLines,
        from,
      });
      if (opts.withLines) cleared = { lines: out.removed.length, markers: out.markers.length };
      // 되돌리기 기록 = 실제로 지운 것만(그 사이 남이 쓴 줄은 담지 않는다).
      const token: ShiftUndoToken = {
        classId: plan.classId,
        date: from,
        slot: "00:00",
        removed: out.removed,
        added: [],
        changed: [],
        markers: out.markers.map((m) => ({ key: m.key, before: m.kind, after: null })),
      };
      if (!isEmptyUndo(token)) linesUndo = token;
      if (out.stopped) warning = "배정은 지웠지만 진도 줄을 지우다 멈췄습니다 — 새로고침해 남은 줄을 확인해 주세요";
      else if (keepLines && opts.withLines) warning = "배정은 지웠습니다 — 같은 교재가 이 반의 다른 칸(JJ/수업)에도 배정돼 있어 진도 줄은 남겼습니다";
    } catch (e) {
      // 읽기에서 멈췄다(아직 아무것도 안 지웠다).
      reportError(e, { scope: "textbooks.plan-delete.lines", classId: plan.classId });
      if (opts.withLines) warning = "배정은 지웠지만 진도 줄은 지우지 못했습니다 — 새로고침해 확인해 주세요";
    }
  }

  await logAction({
    action: "textbook_plan_delete",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: { id: planId, ...(cleared ? { linesCleared: cleared.lines, markersCleared: cleared.markers } : {}) },
  });
  revalidatePath("/textbooks");
  // 월간계획은 배정에서 **계산**되므로 배정이 사라지면 그 반 시트의 '계획' 표식도 함께 사라져야 한다
  // (`"layout"` — 월간 화면은 `/ecs/<반>/month`라 기본값이면 정작 보는 화면이 안 바뀐다, [[#102]] 계열).
  revalidatePath(`/ecs/${plan.classId}`, "layout");
  return {
    ok: true,
    cleared,
    warning,
    undo: restore ? { plan: restore, lines: linesUndo } : undefined,
  };
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
      pace: normalizeLessonPace(data.pace),
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
      pace: normalizeLessonPace(input.pace),
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

  // 🔑 **배정 = 계획 + 가져오기 한 번에**(원장 2026-10-22 *"교재배정과 월간계획 전체 가져오기가 굳이 두가지를
  //    나눠서 사용할 이유가 없는거같음 … 한큐에"*) — 09-22의 "배정은 실제에 안 쓴다"를 원장이 뒤집었다.
  //    배정을 저장해 월간계획을 세운 뒤, **그 배정의** 일정을 [가져오기]와 같은 함수(`writePlannedCells`)로
  //    실제 빈 칸에 넣는다. 🔴 지난 날짜엔 안 넣는다(미리보기의 '지난 날짜' 표시와 같은 약속) · 이미 적은 칸은
  //    안 덮는다. 쓰기는 직접 RPC가 아니라 공용 함수 경유(`applyCellLessons`).
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

  // 실제로 넣기 — 오늘(또는 시작일) 이후 그 배정의 차수 전부. 배정은 이미 저장됐으니 여기서 실패해도
  // 계획은 남는다 → 그 사실을 그대로 알리고, 남은 칸은 월간 화면의 [월간계획 전체 가져오기]로 넣을 수 있다.
  const importFrom = input.startDate > today ? input.startDate : today;
  const { getClassImportLines } = await import("./month-plan");
  const planned = await getClassImportLines({
    tenantId: loaded.gate.access.tenantId,
    classId: input.classId,
    from: importFrom,
    to: importFrom,
    planId: saved.id,
  });
  const written =
    planned.status === "ok" && Object.keys(planned.byCell).length > 0
      ? await writePlannedCells({
          access: loaded.gate.access,
          classId: input.classId,
          from: importFrom,
          to: planned.lastDate,
          byCell: planned.byCell,
        })
      : null;

  await logAction({
    action: "textbook_plan_apply",
    targetType: "class",
    targetLabel: loaded.gate.access.className,
    metadata: {
      planId: saved.id,
      textbook: computed.title,
      planned: upcoming.length,
      from: today,
      ...(written?.ok ? { imported: written.result.added + written.result.filled, through: planned.lastDate } : {}),
    },
  });
  // 월간계획은 파생값이라 배정이 바뀌면 그 반 화면 전체가 달라진다([[#102]] 계열 — `"layout"` 필수).
  revalidatePath(`/ecs/${input.classId}`, "layout");
  revalidatePath("/ecs");
  revalidatePath("/textbooks");

  if (!written || !written.ok) {
    // 계획은 섰다 — 실제만 못 넣었다. 성공으로 위장하지 않는다.
    const importError = written && !written.ok ? written.error : planned.status === "ok" ? null : "월간계획을 읽지 못했습니다";
    return {
      ok: true,
      result: { applied: 0, filled: 0, added: 0, skipped: 0, truncated: 0, planned: upcoming.length },
      importError,
      undoBatchId: null,
    };
  }
  return {
    ok: true,
    result: { ...written.result, planned: upcoming.length },
    importError: null,
    undoBatchId: written.undoBatchId,
  };
}

// ── 가져오기 — 월간계획(일정)을 한 달치 **실제**로 옮긴다 ────────────────────────

export type ImportPlannedResult =
  | {
      ok: true;
      result: ApplyResult;
      cells: number;
      /** 되돌리기 기록 id — 바뀐 칸이 없거나 기록을 못 남겼으면(표 미적용 등) null. 알림의 [실행 취소]가 쓴다. */
      undoBatchId: string | null;
    }
  | { ok: false; error: string };

/** 한 번에 가져올 수 있는 날 수 — 세션 한 달(최대 ~40일)을 넉넉히 덮는 상한. 락·시간 예산 가드. */
const IMPORT_MAX_DAYS = 62;

/**
 * **[월간계획 전체 가져오기]** — 그 기간의 월간계획(**일정**, 미루기 반영)을 실제 계획 줄로 복사한다.
 *
 * 🔑 **이 기간에 걸린 배정은 끝 차수까지**(원장 2026-10-22 *"그달이 넘어가서 배정되어있어도 그달까지만
 *    들어가던데 오류"*) — `from~to`는 "어느 배정을 가져올지"를 고르는 창이고, 고른 배정은 다음 달 칸까지 채운다.
 *    `to` 뒤에 시작하는 배정은 안 가져온다(그 달 화면에서). 규칙 = [`expandPlansThrough`](../plan-expand.ts).
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

  const { getClassImportLines } = await import("./month-plan");
  const planned = await getClassImportLines({
    tenantId: gate.access.tenantId,
    classId: input.classId,
    from: input.from,
    to: input.to,
  });
  if (planned.status === "missing-table") return { ok: false, error: TEXTBOOKS_NOT_READY };
  if (planned.status !== "ok") return { ok: false, error: "월간계획을 읽지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };
  // 🔑 이 기간에 걸린 배정은 **끝 차수까지** 가져온다(원장 2026-10-22) — 그래서 쓰는 범위의 끝은 화면의 `to`가
  //    아니라 실제로 닿은 마지막 날이다. 되돌리기 기록도 이 범위를 덮어야 다음 달 칸까지 되돌린다.
  const rangeTo = planned.lastDate;

  if (Object.keys(planned.byCell).length === 0) return { ok: false, error: "이 기간엔 가져올 월간계획이 없습니다" };

  const written = await writePlannedCells({
    access: gate.access,
    classId: input.classId,
    from: input.from,
    to: rangeTo,
    byCell: planned.byCell,
  });
  if (!written.ok) return written;

  await logAction({
    action: "textbook_plan_import",
    targetType: "class",
    targetLabel: gate.access.className,
    metadata: { from: input.from, to: input.to, through: rangeTo, cells: written.cells, ...written.result },
  });
  // 실제 줄이 바뀌었다 — 그 반의 시트·월간을 통째로 무효화한다([[#102]] 계열 — `"layout"` 필수).
  revalidatePath(`/ecs/${input.classId}`, "layout");
  revalidatePath("/ecs");
  return { ok: true, result: written.result, cells: written.cells, undoBatchId: written.undoBatchId };
}

/**
 * 계획 줄(일정) → **실제** 빈 칸에 쓴다 + 되돌리기 기록. [월간계획 전체 가져오기]와 교재 배정(원장 2026-10-22
 * *"교재배정하면 계획과 가져오기가 한큐에"*)이 **같은 함수**를 탄다 — 두 벌이면 같은 칸이 길마다 다르게 들어간다.
 * 🔴 게이트는 호출부가 이미 걸었다(그 반 ECS 쓰기). 감사로그·revalidate도 호출부 몫.
 */
async function writePlannedCells(input: {
  access: { tenantId: string; user: { id: string } };
  classId: string;
  from: string;
  to: string;
  byCell: Record<string, PlannedLine[]>;
}): Promise<{ ok: true; result: ApplyResult; cells: number; undoBatchId: string | null } | { ok: false; error: string }> {
  const { access, classId } = input;
  const cells = Object.keys(input.byCell).sort();
  const lines = cells.flatMap((k) => input.byCell[k]!);

  // 🔴 RPC는 (시기, 구분, 교재명) 한 벌을 받는다 — 교재마다 따로 부른다. 한 번에 뭉치면 다른 교재의
  //    진도가 첫 교재 줄에 적힌다(구분은 선호가 아니라 필터다, 0266a).
  const admin = createAdminClient();
  const groups = new Map<string, typeof lines>();
  for (const l of lines) {
    const key = `${l.termMode}|${l.skillArea}|${l.title.trim().toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }

  // 되돌리기 기록용 — 가져오기 **전** 모습. 못 읽으면 가져오기는 그대로 하고 되돌리기만 없다.
  const before = await snapshotPlanLines(admin, access.tenantId, classId, input.from, input.to).catch((e: unknown) => {
    reportError(e, { scope: "textbooks.import-batch.snapshot", classId });
    return null;
  });

  const total: ApplyResult = { applied: 0, filled: 0, added: 0, skipped: 0, truncated: 0 };
  for (const group of groups.values()) {
    const head = group[0]!;
    // 🔑 차수 하나 = 줄 하나(원장 2026-10-19) — 한 교시에 같은 교재 1·2차수면 두 줄로 쓴다(`applyCellLessons`).
    try {
      const out = await applyCellLessons({
        admin,
        tenantId: access.tenantId,
        actorId: access.user.id,
        classId,
        termMode: head.termMode,
        book: { skillArea: head.skillArea, title: head.title, pageTime: head.pageTime },
        cells: groupCellLessons(group),
      });
      total.applied += out.applied;
      total.filled += out.filled;
      total.added += out.added;
      total.skipped += out.skipped;
      total.truncated += out.truncated;
    } catch (e) {
      if (e instanceof ApplyCellLessonsError) return { ok: false, error: friendlyTextbookError(e.dbError, "가져오지 못했습니다") };
      throw e;
    }
  }

  const undoBatchId =
    before && total.added + total.filled > 0
      ? await recordImportBatch({
          admin,
          tenantId: access.tenantId,
          classId,
          from: input.from,
          to: input.to,
          actorId: access.user.id,
          before,
        })
      : null;
  return { ok: true, result: total, cells: cells.length, undoBatchId };
}

// ── 회차 미루기·당기기 — 그 칸에서 차수를 어떻게 할지 ─────────────────────────

export type LessonShiftKind = "skip" | "advance";
export type LessonShiftResult =
  | {
      ok: true;
      kind: LessonShiftKind | null;
      /** 옮긴 칸 수(0 = 아직 실제 줄이 없어 표식만 남겼다). */
      moved: number;
      /** 누른 칸의 줄 전부(평시·내신) — 화면이 그 칸만 즉시 갈아 끼운다. 표식만 지운 경우엔 없다. */
      lines?: PlanLineDTO[];
      /**
       * 누른 칸이 있는 **그 주(월~일)** 에서 줄이 바뀐 칸 전부(누른 칸 포함) — 여러 칸을 그리는 화면(주간 시트)이
       * 함께 갈아 끼운다. 배정 교재는 요일을 건너 다시 깔리므로(화를 누르면 그 주 금요일도 바뀐다) 누른 칸만
       * 바꾸면 같은 화면의 금요일이 옛 진도로 남는다(2026-10-16 재점검).
       */
      cells?: { date: string; slotStart: string; lines: PlanLineDTO[] }[];
      /**
       * 되돌리기 기록(원장 2026-10-19 "덮어쓰기(되돌리기)") — 토스트의 [되돌리기]가 그대로 돌려보낸다
       * (`undoLessonShift`). 앞 모습을 못 읽었거나 바뀐 게 없으면 없다(되돌리기 버튼이 안 선다).
       */
      undo?: ShiftUndoToken;
    }
  /** `undo` = 옮기다 멈췄을 때 그때까지 바뀐 것을 되돌릴 기록(미룸은 누른 칸을 지우므로 멈춘 채 두면 잃는다). */
  | { ok: false; error: string; undo?: ShiftUndoToken };

/**
 * **한 주 미루기 / 당기기** — 그 (반, 날짜, 교시)부터 **실제 진도를 한 주씩 민다/당긴다**.
 *
 * 🔴 원장 2026-10-15: *"미룰때 미루는 거기 복사하고 한주씩 쭉 밀기로 했자나"* — 1차 구현(2026-09-22)은
 *    표식(0282a)만 남기고 실제 줄은 안 건드려서, [월간계획 전체 가져오기]로 이미 채운 칸에선 얼럿만 뜨고
 *    **아무것도 안 움직였다**(가져오기는 빈 칸만 채운다). 규칙은 [`planLessonShift`](../lesson-shift-chain.ts):
 *    · 미룸 = 누른 칸은 그대로(복사) + 그 요일·교시의 뒤 칸이 전부 한 주씩 뒤로
 *    · 당김 = 누른 칸에 다음 주 내용 + 뒤가 전부 한 주씩 앞으로(미룸의 반대 — 미룸 뒤 당김 = 원래대로)
 * 🔑 **표식도 함께 남긴다** — 아직 가져오지 않은 먼 칸은 표식으로 계산되는 일정에서 온다. 표식은 그 줄의
 *    **순(net) 횟수**만 맞으면 되므로, 반대 표식이 누른 칸에 있으면 지우고 아니면 비어 있는 첫 칸에 더한다.
 *    원래 월간계획(표식 없이 펼친 쪽)은 표식을 안 보므로 [계획 비교]는 밀린 만큼 'N차수 늦음'으로 잡는다.
 * 🔴 **배정 교재가 지나가는 칸이면 요일이 아니라 교재 순서로**(원장 2026-10-16, [`shiftAlongPlans`](./shift-relay.ts)):
 *    화 1·2차수 + 금 1차수처럼 요일을 번갈아 나가는 교재를 같은 요일끼리 옮기면 화요일 칸만 움직여 순서가
 *    꼬이고 월간계획과 실제가 갈렸다(중등E_중1 SKY). 그 칸은 표식을 교재 칸 순서로 두고, 표식을 반영한 일정대로
 *    그 교재 줄을 다시 깐다. 배정 줄이 아닌 줄만 종전대로 같은 요일·교시끼리 옮긴다.
 * 🔑 **토글이 아니다** — 두 번 누르면 두 칸 밀린다. 되돌리기는 반대 버튼이다.
 * `kind: null`은 표식만 지운다(옛 호출 호환 — 줄은 안 건드린다).
 * 🔑 **줄마다**(원장 2026-10-20 *"수업이 2개면 각각 미룸, 당김"*) — `lineId`를 주면 그 줄의 교재 한 차수만
 *    움직인다(줄 표식 0382a). 같은 칸의 다른 줄은 제자리다. 없으면 옛 화면의 교시 통째.
 * 🔑 **계획만 있는 칸의 당김**(원장 2026-10-20) — `fill: true`. 그 칸의 미룸을 걷어 뒤 수업이 올라와 채운다
 *    (아무 차수도 버리지 않는다 — 줄 당김은 누른 줄을 지운다).
 */
export async function setLessonShift(input: {
  classId: string;
  date: string;
  slotStart: string;
  kind: LessonShiftKind | null;
  lineId?: string;
  fill?: boolean;
}): Promise<LessonShiftResult> {
  const gate = await requireEcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!YMD_RE.test(input.date)) return { ok: false, error: "날짜가 올바르지 않습니다" };
  const slot = String(input.slotStart).slice(0, 5);
  if (!/^[0-2]\d:[0-5]\d$/.test(slot)) return { ok: false, error: "교시가 올바르지 않습니다" };
  const kind = input.kind === "skip" || input.kind === "advance" ? input.kind : null;
  const lineId = typeof input.lineId === "string" && UUID_RE.test(input.lineId) ? input.lineId : null;
  if (input.lineId !== undefined && !lineId) return { ok: false, error: "줄이 올바르지 않습니다" };
  const fill = input.fill === true && !lineId;
  if (fill && kind !== "advance") return { ok: false, error: "계획만 있는 칸은 당김만 됩니다" };
  const target: ShiftTarget = lineId ? { by: "line", lineId } : fill ? { by: "fill" } : { by: "cell" };

  const admin = createAdminClient();
  const tenantId = gate.access.tenantId;
  const markerTable = () => admin.from("class_lesson_shifts");
  const missing = (error: { code?: string; message?: string } | null) =>
    error && isMissingTextbookTable(error)
      ? "회차 미루기는 마이그레이션 0282a가 필요합니다 — 적용한 뒤 다시 시도해 주세요"
      : null;

  if (!kind) {
    const { error } = await writeMarker({
      admin,
      tenantId,
      classId: input.classId,
      key: cellMarkerKey(input.date, slot),
      kind: null,
      actor: gate.access.user.id,
    });
    if (error) return { ok: false, error: missing(error) ?? friendlyTextbookError(error, "회차를 바꾸지 못했습니다") };
    revalidatePath(`/ecs/${input.classId}`, "layout");
    return { ok: true, kind: null, moved: 0 };
  }

  // 되돌리기 재료 — 옮기기 **전** 모습. 못 읽으면 옮기기는 그대로 하고 되돌리기만 없다.
  const before: ShiftSnapshot | null = await snapshotShiftState(admin, tenantId, input.classId, input.date).catch(
    (e: unknown) => {
      reportError(e, { scope: "textbooks.lesson-shift.snapshot", classId: input.classId });
      return null;
    },
  );

  // ③ 마무리 — 누른 칸(+그 주 바뀐 칸)의 줄을 다시 읽어 화면에 준다 + 되돌리기 기록 + 감사로그 + 무효화.
  /** 지금 모습과 `before`의 차이 = 되돌리기 기록(바뀐 게 없거나 못 읽으면 없다). */
  const undoSince = async (): Promise<ShiftUndoToken | undefined> => {
    if (!before) return undefined;
    const after = await snapshotShiftState(admin, tenantId, input.classId, input.date).catch((e: unknown) => {
      reportError(e, { scope: "textbooks.lesson-shift.snapshot-after", classId: input.classId });
      return null;
    });
    if (!after) return undefined;
    const token = diffShift({
      classId: input.classId,
      date: input.date,
      slot,
      before: before.lines,
      after: after.lines,
      markersBefore: before.markers,
      markersAfter: after.markers,
    });
    return isEmptyUndo(token) ? undefined : token;
  };

  const finishShift = async (movedCount: number, touched: readonly string[] = []): Promise<LessonShiftResult> => {
    const undo = await undoSince();
    const week = await readWeekCells({ admin, tenantId, classId: input.classId, date: input.date, slot, keys: touched });

    await logAction({
      action: "textbook_lesson_shift",
      targetType: "class",
      targetLabel: gate.access.className,
      metadata: { date: input.date, slot, kind, moved: movedCount },
    });
    // 그 반의 앞으로 전부가 바뀐다([[#102]] 계열 — `"layout"` 필수).
    revalidatePath(`/ecs/${input.classId}`, "layout");
    return { ok: true, kind, moved: movedCount, lines: week?.lines, cells: week?.cells, undo };
  };

  // ⓪ 배정 교재가 지나가는 칸이면 교재 순서로(표식·줄을 그 경로가 함께 맞춘다).
  const relay = await shiftAlongPlans({
    admin,
    tenantId,
    classId: input.classId,
    date: input.date,
    slot,
    kind,
    userId: gate.access.user.id,
    target,
  }).catch((e: unknown): { handled: true; ok: false; error: string } => {
    reportError(e, { scope: "textbooks.lesson-shift-relay", classId: input.classId, date: input.date });
    return { handled: true, ok: false, error: "진도를 불러오지 못해 옮기지 않았습니다 — 잠시 뒤 다시 시도해 주세요" };
  });
  if (relay.handled) {
    if (!relay.ok) {
      // 중간에 멈췄을 수 있다 — 화면은 다시 받게 하고, 그때까지 바뀐 게 있으면 되돌릴 수 있게 기록을 준다.
      revalidatePath(`/ecs/${input.classId}`, "layout");
      return { ok: false, error: relay.error, undo: await undoSince() };
    }
    return finishShift(relay.moved, relay.touched);
  }

  // 배정 교재가 지나가지 않는 줄 하나 — **그 줄과 같은 구분·교재명 줄만** 같은 요일·교시끼리 한 주씩(표식 없음:
  // 표식은 배정 일정에만 쓰인다). 같은 칸의 다른 줄은 제자리다(원장 2026-10-20 "수업이 2개면 각각").
  if (lineId) {
    const { data: row, error: rowErr } = await admin
      .from("class_sheet_plan_lines")
      .select("plan_date, slot_start, term_mode, skill_area, textbook")
      .eq("tenant_id", tenantId)
      .eq("class_id", input.classId)
      .eq("id", lineId)
      .maybeSingle();
    if (rowErr) return { ok: false, error: friendlyTextbookError(rowErr, "회차를 바꾸지 못했습니다") };
    if (
      !row ||
      String(row.plan_date).slice(0, 10) !== input.date ||
      String(row.slot_start).slice(0, 5) !== slot ||
      row.term_mode !== "regular"
    ) {
      return { ok: false, error: "그 사이 이 줄이 바뀌었습니다 — 새로고침 후 다시 눌러 주세요" };
    }
    const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const one = await shiftActualLines({
      admin,
      tenantId,
      classId: input.classId,
      date: input.date,
      slot,
      kind,
      userId: gate.access.user.id,
      only: (r) => String(r.skill_area ?? "") === String(row.skill_area ?? "") && norm(r.textbook) === norm(row.textbook),
    }).catch((e: unknown) => {
      reportError(e, { scope: "textbooks.lesson-shift.line", classId: input.classId, date: input.date });
      return { ok: false as const, error: "진도를 불러오지 못해 옮기지 않았습니다 — 잠시 뒤 다시 시도해 주세요", noContent: false, chain: [] };
    });
    if (!one.ok) return { ok: false, error: one.error, undo: "stopped" in one && one.stopped ? await undoSince() : undefined };
    return finishShift(one.moved);
  }

  // ① 실제 줄을 옮긴다. 옮길 줄이 아예 없으면(아직 가져오기 전) 표식만 남긴다.
  // ⚠️ 조회 실패는 throw로 온다(fetchAllPaged) — 잡지 않으면 화면엔 아무 안내 없이 끝난다.
  const moved = await shiftActualLines({
    admin,
    tenantId,
    classId: input.classId,
    date: input.date,
    slot,
    kind,
    userId: gate.access.user.id,
  }).catch((e: unknown) => {
    reportError(e, { scope: "textbooks.lesson-shift", classId: input.classId, date: input.date });
    return { ok: false as const, error: "진도를 불러오지 못해 옮기지 않았습니다 — 잠시 뒤 다시 시도해 주세요", noContent: false, chain: [] };
  });
  if (!moved.ok && !moved.noContent) {
    // 쓰다가 멈췄으면(`stopped`) 그때까지 바뀐 것을 되돌릴 수 있게 — 처음부터 거절된 거면 바뀐 게 없다.
    return { ok: false, error: moved.error, undo: "stopped" in moved && moved.stopped ? await undoSince() : undefined };
  }

  // ② 표식 — 순 횟수를 맞춘다(위 🔑).
  // 칸 표식만 센다(줄 표식은 배정 일정의 것이라 이 길 — 배정이 안 지나가는 칸 — 과 무관하다).
  let markerError: { code?: string; message?: string } | null = null;
  let at = new Map<string, string>();
  try {
    const marks = await withMarkerCols(async (cols) => {
      const { data, error } = await markerTable()
        .select(cols)
        .eq("tenant_id", tenantId)
        .eq("class_id", input.classId)
        .eq("slot_start", slot)
        .in("plan_date", moved.chain);
      if (error) throw error;
      return (data ?? []) as unknown as Record<string, unknown>[];
    });
    at = new Map(
      marks
        .filter((m) => parseMarkerKey(markerKeyOfRow(m))?.lane === "")
        .map((m) => [String(m.plan_date).slice(0, 10), String(m.kind)]),
    );
  } catch (e) {
    markerError = e as { code?: string; message?: string };
  }
  if (!markerError) {
    const opposite = kind === "skip" ? "advance" : "skip";
    const write = (d: string, k: LessonShiftKind | null) =>
      writeMarker({ admin, tenantId, classId: input.classId, key: cellMarkerKey(d, slot), kind: k, actor: gate.access.user.id });
    if (at.get(input.date) === opposite) {
      ({ error: markerError } = await write(input.date, null));
    } else {
      const free = moved.chain.find((d) => !at.has(d));
      if (free) ({ error: markerError } = await write(free, kind));
    }
  }
  // 줄은 이미 옮겼으니 표식 실패는 화면을 막지 않는다 — 단 줄이 없어 표식이 전부였다면 실패를 알린다.
  if (markerError && !moved.ok) {
    return { ok: false, error: missing(markerError) ?? friendlyTextbookError(markerError, "회차를 바꾸지 못했습니다") };
  }

  return finishShift(moved.ok ? moved.moved : 0);
}
