import "server-only";

/**
 * **월간계획** — 그 반의 교재 배정에서 *계산해* 낸다. 🔴 **저장하지 않는다.**
 *
 * 원장 2026-09-22: *"영어강사시트 실제(강사가 실제나간 진도)와 월간계획 이렇게 나눠서 쓰고싶음 …
 * 기본적으로 월간계획에서 교재배정을 해놓고 그걸 각자 월간계획에서 가저오기 해서 실제수업에서
 * 변동사항이 있으면 변경 후 사용가능하도록"*.
 *
 * 🔑 **계획은 파생값이다**(원장 선택 2026-09-22, "표 신설 없음") — 배정 한 건(`class_textbook_plans`)이
 *    곧 그 반의 월간계획이고, 여기서 (날짜, 교시) → 차수로 펼친다.
 * 🔑 **두 벌이다**(원장 2026-09-28 *"계획 놔두고 일정만 밀리게"*) — `baselineByCell`(원래 계획, 미루기
 *    미반영)은 달력·비교·현황의 **기준**이고, `byCell`(일정, 미루기 반영)은 [가져오기]가 옮기는 값이다.
 *    미루기가 원래 계획을 고쳐 쓰면 "얼마나 밀렸나"를 잴 기준이 사라진다.
 * 🔴 **실제와 섞지 않는다** — 실제는 `class_sheet_plan_lines` 하나뿐이고, 계획이 거기 들어가는 길은
 *    사람이 누르는 [월간계획 전체 가져오기]뿐이다(`importPlannedRange`).
 * ⚠️ 0266a/0268a 미적용이어도 **절대 throw하지 않는다**([[#95]]) — 영어 강사 전원이 매일 여는 화면이
 *    이걸 읽는다. 못 읽으면 계획이 빈 채로 시트가 그대로 돈다.
 */
import { cellShiftSummary, markerKeyOfRow } from "../shift-key";
import { withMarkerCols } from "./shift-markers";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getTenantSettings } from "@/features/owner/server/queries";
import type { HolidayMap } from "@/features/class-sheets/lib/holiday";
import type { MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import { isMissingTextbookTable } from "./access";
import type { TextbookTableStatus } from "../types";
import {
  expandPlans,
  lessonIndexOf,
  type BookInfo,
  type LessonText,
  type PlannedLine,
  type PlanRow,
} from "../plan-expand";
import type { LessonIndex } from "../plan-compare";

export type { PlannedLine } from "../plan-expand";

export type MonthPlanResult = {
  status: TextbookTableStatus;
  /** **일정**(미루기 반영) — `"YYYY-MM-DD|HH:MM"` → 그 칸에 가져올 계획 줄. [가져오기]만 쓴다. */
  byCell: Record<string, PlannedLine[]>;
  /** **원래 계획**(미루기 미반영) — 달력 표식·비교 모달·현황 페이지의 기준. */
  baselineByCell: Record<string, PlannedLine[]>;
  /** 배정된 교재들의 차수표 — 실제 진도 → 차수(늦음·빠름 판정, plan-compare). */
  lessonIndex: LessonIndex;
  /**
   * 사람이 미루거나 당긴 칸(0282a) — `"YYYY-MM-DD|HH:MM"` → `skip` | `advance`.
   * 🔑 화면이 **토글 상태**로 쓴다(다시 누르면 지운다). 표가 없으면 빈 객체라 버튼이 '안 걸림'으로 뜬다.
   */
  shiftByCell: Record<string, "skip" | "advance">;
};

const emptyResult = (
  status: TextbookTableStatus,
  shiftByCell: Record<string, "skip" | "advance"> = {},
): MonthPlanResult => ({ status, byCell: {}, baselineByCell: {}, lessonIndex: {}, shiftByCell });

const BASE_COLS = "class_id, textbook_id, slot_axis, pace, term_mode, start_date, start_lesson_no";

/** 반 하나가 계산에 쓰는 재료 — 여러 반 현황(plan-gap)도 같은 모양을 받는다. */
export type ClassPlanMaterials = {
  plans: PlanRow[];
  /** 시간표 원본 행(담당 FK 포함) — 한 반 조회는 라벨만, 현황은 담당 이름까지 쓴다. */
  scheduleRows: Record<string, unknown>[];
  schedules: MonthScheduleRow[];
  shifts: Record<string, "skip" | "advance">;
};

export type PlanMaterials = {
  status: TextbookTableStatus;
  byClass: Map<string, ClassPlanMaterials>;
  books: Map<string, BookInfo>;
  lessonsByBook: Map<string, Map<number, LessonText>>;
  holidays: HolidayMap;
};

/**
 * 여러 반의 계획 재료를 **한 번에** 읽는다(B3 청크 · B4 병렬). `classIds`가 null이면 **배정이 있는 반 전부**.
 * 🔴 게이트는 호출부 몫 — admin 클라이언트(RLS 우회)라 `tenant_id` 필터가 곧 격리다.
 */
export async function loadPlanMaterials(input: {
  tenantId: string;
  classIds: readonly string[] | null;
  /** 미루기 표식을 어디까지 읽을지(구간 끝). 하한은 안 건다 — 앞선 미루기도 뒤 차수를 민다. */
  to: string;
}): Promise<PlanMaterials> {
  const { tenantId, to } = input;
  const admin = createAdminClient();
  const empty = (status: TextbookTableStatus): PlanMaterials => ({
    status,
    byClass: new Map(),
    books: new Map(),
    lessonsByBook: new Map(),
    holidays: {},
  });

  // 배정 목록 — 0268a 적용 전이면 `slot_picks` 없이 한 번 더(그 배정은 옛 축 방식으로 읽힌다, [[#95]]).
  const readPlans = async (cols: string): Promise<{ data: PlanRow[]; error: { code?: string; message?: string } | null }> => {
    if (input.classIds) {
      if (input.classIds.length === 0) return { data: [], error: null };
      try {
        const data = await fetchInChunks<PlanRow & { class_id: string }>([...input.classIds], (chunk) =>
          admin
            .from("class_textbook_plans")
            .select(cols)
            .eq("tenant_id", tenantId)
            .eq("is_active", true)
            .in("class_id", chunk)
            .order("created_at", { ascending: true }) as never,
        );
        return { data, error: null };
      } catch (e) {
        return { data: [], error: e as { code?: string; message?: string } };
      }
    }
    // 반 목록을 여기서 **도출**하므로(distinct) 무페이징 select 금지 — 1000행 절단(B2).
    try {
      const data = await fetchAllPaged<PlanRow>((f, t) =>
        admin
          .from("class_textbook_plans")
          .select(cols)
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("id", { ascending: true })
          .range(f, t) as never,
      );
      return { data, error: null };
    } catch (e) {
      return { data: [], error: e as { code?: string; message?: string } };
    }
  };
  let planRes = await readPlans(`${BASE_COLS}, slot_picks`);
  if (planRes.error && (planRes.error.code === "42703" || planRes.error.code === "PGRST204" || /slot_picks/.test(planRes.error.message ?? ""))) {
    planRes = await readPlans(BASE_COLS);
  }
  if (planRes.error) return empty(isMissingTextbookTable(planRes.error) ? "missing-table" : "failed");
  const plans = planRes.data as (PlanRow & { class_id: string })[];

  const classIds = input.classIds ? [...input.classIds] : [...new Set(plans.map((p) => String(p.class_id)))];
  const byClass = new Map<string, ClassPlanMaterials>(
    classIds.map((id) => [id, { plans: [], scheduleRows: [], schedules: [], shifts: {} }]),
  );
  for (const p of plans) byClass.get(String(p.class_id))?.plans.push(p);
  if (classIds.length === 0) return { ...empty("ok"), holidays: {} };

  const bookIds = [...new Set(plans.map((p) => String(p.textbook_id)))];
  const [shiftRows, bookRows, lessonRows, settings, schedRows] = await Promise.all([
    // 🔴 표가 없어도 죽지 않는다(0282a 미적용 = 표식 0개 = 종전 계산) — 그래서 catch로 빈 배열.
    // 0382a 전이면 `lane`·`pos` 없이 다시 읽는다(전부 칸 표식) — `withMarkerCols`.
    withMarkerCols((cols) =>
      fetchAllPagedInChunks<{ class_id: string; plan_date: string; slot_start: string; kind: string; lane?: string; pos?: number }>(
        classIds,
        (chunk, f, t) =>
          admin
            .from("class_lesson_shifts")
            .select(cols)
            .eq("tenant_id", tenantId)
            .in("class_id", chunk)
            .lte("plan_date", to)
            .order("id", { ascending: true })
            .range(f, t) as never,
      ),
    ).catch(() => []),
    bookIds.length === 0
      ? Promise.resolve([] as Record<string, unknown>[])
      : fetchInChunks<Record<string, unknown>>(bookIds, (chunk) =>
          admin.from("textbooks").select("id, title, page_time, skill_area, session_count").eq("tenant_id", tenantId).in("id", chunk),
        ).catch(() => null),
    // 차수는 교재마다 최대 200줄이라 청크 페이지 순회로 전건을 받는다(B2·B3).
    bookIds.length === 0
      ? Promise.resolve([] as { textbook_id: string; lesson_no: number; progress: string | null; homework: string | null }[])
      : fetchAllPagedInChunks<{ textbook_id: string; lesson_no: number; progress: string | null; homework: string | null }>(
          bookIds,
          (chunk, f, t) =>
            admin
              .from("textbook_lessons")
              .select("textbook_id, lesson_no, progress, homework")
              .eq("tenant_id", tenantId)
              .in("textbook_id", chunk)
              .order("textbook_id", { ascending: true })
              .order("lesson_no", { ascending: true })
              .range(f, t),
        ).catch(() => null),
    getTenantSettings(),
    fetchAllPagedInChunks<Record<string, unknown>>(classIds, (chunk, f, t) =>
      admin
        .from("class_schedules")
        .select("id, class_id, day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label, slot_room_label, teacher_id")
        .eq("tenant_id", tenantId)
        .in("class_id", chunk)
        .order("id", { ascending: true })
        .range(f, t),
    ).catch(() => null),
  ]);
  // 🔴 교재·차수·시간표가 하나라도 실패하면 **계획을 그리지 않는다** — 진도가 빠진 계획을 보여 주면
  //    강사가 그걸 가져와 빈 칸을 채운 줄 알고 넘어간다(빈 계획이 거짓 계획보다 낫다).
  if (bookRows === null || lessonRows === null || schedRows === null) return empty("failed");

  for (const r of shiftRows) {
    const m = byClass.get(String(r.class_id));
    if (!m) continue;
    // 키 = 칸 표식 `날짜|교시` 또는 줄 표식 `날짜|교시|교재|자리`(shift-key) — 계산은 키 그대로 쓴다.
    m.shifts[markerKeyOfRow(r)] = String(r.kind) === "advance" ? "advance" : "skip";
  }
  // 시간표는 요일·시작시각 순이어야 `slotsByDateOf`가 같은 답을 낸다(페이지 순회는 id 순이라 다시 정렬).
  const sorted = [...schedRows].sort((a, b) =>
    String(a.day_of_week) === String(b.day_of_week)
      ? String(a.start_time).localeCompare(String(b.start_time))
      : String(a.day_of_week).localeCompare(String(b.day_of_week)),
  );
  for (const r of sorted) {
    const m = byClass.get(String(r.class_id));
    if (!m) continue;
    m.scheduleRows.push(r);
    m.schedules.push({
      dayOfWeek: String(r.day_of_week),
      startTime: String(r.start_time),
      endTime: r.end_time ? String(r.end_time) : null,
      validFrom: r.valid_from ? String(r.valid_from) : null,
      validTo: r.valid_to ? String(r.valid_to) : null,
      slotTeacherLabel: (r.slot_teacher_label as string | null) ?? null,
      slotRoomLabel: (r.slot_room_label as string | null) ?? null,
    });
  }

  const books = new Map<string, BookInfo>(
    bookRows.map((b) => [
      String(b.id),
      {
        title: String(b.title),
        pageTime: (b.page_time as string | null) ?? null,
        skillArea: (b.skill_area as string | null) ?? null,
        sessionCount: Number(b.session_count ?? 0),
      },
    ]),
  );
  const lessonsByBook = new Map<string, Map<number, LessonText>>();
  for (const l of lessonRows) {
    const key = String(l.textbook_id);
    const m = lessonsByBook.get(key) ?? new Map<number, LessonText>();
    m.set(Number(l.lesson_no), { progress: l.progress ?? null, homework: l.homework ?? null });
    lessonsByBook.set(key, m);
  }

  return { status: "ok", byClass, books, lessonsByBook, holidays: buildHolidayMap(settings.operations.holidays) };
}

/** 재료 한 반 → 원래 계획·일정·차수표. */
export function planCellsOf(
  materials: PlanMaterials,
  classId: string,
  from: string,
  to: string,
): Omit<MonthPlanResult, "status"> {
  const m = materials.byClass.get(classId);
  if (!m) return { byCell: {}, baselineByCell: {}, lessonIndex: {}, shiftByCell: {} };
  const common = {
    plans: m.plans,
    books: materials.books,
    lessonsByBook: materials.lessonsByBook,
    schedules: m.schedules,
    holidays: materials.holidays,
    from,
    to,
  };
  return {
    byCell: m.plans.length === 0 ? {} : expandPlans({ ...common, shifts: m.shifts }),
    baselineByCell: m.plans.length === 0 ? {} : expandPlans({ ...common, shifts: null }),
    lessonIndex: lessonIndexOf(m.plans, materials.books, materials.lessonsByBook),
    // 화면 표시는 칸 단위 — 줄 표식도 그 칸의 표식으로 접는다(계산엔 안 쓴다).
    shiftByCell: cellShiftSummary(m.shifts),
  };
}

/**
 * 그 반의 `[from, to]` 구간 월간계획.
 *
 * 🔴 **게이트는 호출부가 이미 걸었다** — 이 함수는 시트·월간 뷰가 반을 연 뒤에 부르는 읽기라
 *    `tenantId`를 인자로 받는다(admin 클라이언트는 RLS 우회라 필터가 곧 격리다).
 */
export async function getClassPlannedLines(input: {
  tenantId: string;
  /** 교시 라벨 표가 과목별이라 필요하다(`weekdayTableFor`) — 지금은 영어만 쓴다. */
  subject: string;
  classId: string;
  from: string;
  to: string;
}): Promise<MonthPlanResult> {
  const { tenantId, classId, from, to } = input;
  if (!from || !to || from > to) return emptyResult("ok");
  const materials = await loadPlanMaterials({ tenantId, classIds: [classId], to });
  if (materials.status !== "ok") return emptyResult(materials.status);
  return { status: "ok", ...planCellsOf(materials, classId, from, to) };
}
