import "server-only";

/**
 * 미룸·당김 **앞뒤 모습 읽기** + 그 주 칸 다시 읽기 — 서버 전용 IO. 차이·되돌리기 규칙은
 * [`shift-undo.ts`](../shift-undo.ts)(순수) 한 곳이다.
 *
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 admin 클라이언트 + `tenant_id` 명시 필터([[#104]]).
 * 🔑 읽는 범위 = 그 반의 **평시 줄 · 누른 날 이후** + 그 반의 **표식 · 누른 날 이후**. 미룸·당김이 쓰는 곳이
 *    정확히 거기다(내신 줄·누른 날 앞은 안 건드린다 — `shift-lines.ts`·`shift-relay.ts` 헤더 🔴).
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { planLineFromRow } from "@/features/class-sheets/lib/plan-line";
import type { PlanLineDTO } from "@/features/class-sheets/server/actions";
import { mondayOf, shiftDays } from "@/features/timetable/lib/week";
import { toUndoLine, type ShiftKind, type UndoLine } from "../shift-undo";

type Admin = ReturnType<typeof createAdminClient>;

export type ShiftSnapshot = { lines: UndoLine[]; markers: Record<string, ShiftKind> };

export async function snapshotShiftState(admin: Admin, tenantId: string, classId: string, date: string): Promise<ShiftSnapshot> {
  const [lineRows, markRows] = await Promise.all([
    fetchAllPaged<Record<string, unknown>>((f, t) =>
      admin
        .from("class_sheet_plan_lines")
        .select("id, plan_date, slot_start, term_mode, skill_area, line_no, textbook, page_range, progress, homework")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("term_mode", "regular")
        .gte("plan_date", date)
        .order("id", { ascending: true })
        .range(f, t) as never,
    ),
    fetchAllPaged<Record<string, unknown>>((f, t) =>
      admin
        .from("class_lesson_shifts")
        .select("id, plan_date, slot_start, kind")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .gte("plan_date", date)
        .order("id", { ascending: true })
        .range(f, t) as never,
    ),
  ]);
  const markers: Record<string, ShiftKind> = {};
  for (const m of markRows) {
    const kind = String(m.kind);
    if (kind !== "skip" && kind !== "advance") continue;
    markers[`${String(m.plan_date).slice(0, 10)}|${String(m.slot_start).slice(0, 5)}`] = kind;
  }
  return { lines: lineRows.map(toUndoLine), markers };
}

/**
 * 누른 칸이 있는 **그 주(월~일)** 의 칸들을 다시 읽는다 — `keys` 중 그 주에 든 칸 + 누른 칸.
 * 여러 칸을 그리는 화면(주간 시트)이 함께 갈아 끼운다. 조회 실패면 null(화면은 새로고침으로 받는다).
 */
export async function readWeekCells(input: {
  admin: Admin;
  tenantId: string;
  classId: string;
  date: string;
  slot: string;
  keys: readonly string[];
}): Promise<{ lines: PlanLineDTO[]; cells: { date: string; slotStart: string; lines: PlanLineDTO[] }[] } | null> {
  const { admin, tenantId, classId, date, slot } = input;
  const monday = mondayOf(date);
  const sunday = shiftDays(monday, 6);
  const pressedKey = `${date}|${slot}`;
  const keys = new Set([pressedKey, ...input.keys.filter((k) => k >= monday && k.slice(0, 10) <= sunday)]);
  const { data: weekRows, error } = await admin
    .from("class_sheet_plan_lines")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("class_id", classId)
    .gte("plan_date", monday)
    .lte("plan_date", sunday)
    .order("term_mode")
    .order("line_no")
    .order("id");
  if (error || !weekRows) return null;
  const byCell = new Map<string, PlanLineDTO[]>([...keys].map((k) => [k, []]));
  for (const r of weekRows as Record<string, unknown>[]) {
    const k = `${String(r.plan_date).slice(0, 10)}|${String(r.slot_start).slice(0, 5)}`;
    byCell.get(k)?.push(planLineFromRow(r));
  }
  return {
    lines: byCell.get(pressedKey)!,
    cells: [...byCell.entries()].map(([k, lines]) => ({ date: k.slice(0, 10), slotStart: k.slice(11), lines })),
  };
}
