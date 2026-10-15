/**
 * 회차 미룸·당김의 **실제 줄 이동** — 서버 전용 IO. 규칙은 [`planLessonShift`](../lesson-shift-chain.ts) 한 곳.
 *
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 admin 클라이언트 + `tenant_id` 명시 필터([[#104]]).
 * 🔴 **평시(`regular`) 줄만** 옮긴다 — 버튼이 평시 구획에만 서고 교재 계획도 평시 축뿐이다.
 *    같은 칸의 내신 줄은 그 날짜에 그대로 남는다.
 * ⚠️ RPC가 아니라 단계별 쓰기다(새 마이그레이션 없이 — [[#95]]). 순서를 "옮겨 갈 칸이 언제나 비어 있게"
 *    짜 두었으므로 중간에 실패해도 줄이 사라지거나 위치 유니크와 부딪치지 않는다(한 칸이 덜 옮겨질 뿐).
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { getTenantSettings } from "@/features/owner/server/queries";
import { holidayNameOn } from "@/features/class-sheets/lib/holiday";
import { slotsByDateOf, type MonthScheduleRow } from "@/features/class-sheets/lib/month-assemble";
import { dowKeyOf, normalizeSlotTime } from "@/features/class-sheets/lib/week";
import { shiftDays } from "@/features/timetable/lib/week";
import { planLessonShift } from "../lesson-shift-chain";

type Admin = ReturnType<typeof createAdminClient>;

/** 마지막 내용 뒤로 이만큼(주 단위) 더 훑어 "다음 수업일"을 찾는다 — 방학·휴일이 길어도 닿는 길이. */
const LOOKAHEAD_WEEKS = 26;

export type ShiftLinesResult =
  /** `chain` = 누른 칸부터 그 요일·교시의 수업일(오름차순) — 회차 표식을 어느 칸에 둘지 이걸로 고른다. */
  | { ok: true; moved: number; chain: string[] }
  /** `noContent` = 옮길 실제 줄이 하나도 없다(아직 가져오기 전) — 호출부는 표식만 남긴다. */
  | { ok: false; error: string; noContent: boolean; chain: string[] };

const REASON_TEXT = {
  "no-content": "이 칸부터 뒤로 옮길 진도가 없습니다",
  "no-next-day": "다음 수업일이 없어 미룰 수 없습니다 — 시간표를 확인해 주세요",
  "nothing-after": "다음 주 진도가 없어 당겨올 내용이 없습니다",
} as const;

export async function shiftActualLines(input: {
  admin: Admin;
  tenantId: string;
  classId: string;
  date: string;
  slot: string;
  kind: "skip" | "advance";
  userId: string;
}): Promise<ShiftLinesResult> {
  const { admin, tenantId, classId, date, slot, kind, userId } = input;
  const dow = dowKeyOf(date);

  const [lineRows, schedRows, settings] = await Promise.all([
    fetchAllPaged<{ plan_date: string }>((f, t) =>
      admin
        .from("class_sheet_plan_lines")
        .select("plan_date")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .eq("slot_start", slot)
        .eq("term_mode", "regular")
        .gte("plan_date", date)
        .order("plan_date", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t) as never,
    ),
    fetchAllPaged<Record<string, unknown>>((f, t) =>
      admin
        .from("class_schedules")
        .select("id, day_of_week, start_time, end_time, valid_from, valid_to, slot_teacher_label, slot_room_label")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .order("id", { ascending: true })
        .range(f, t) as never,
    ),
    getTenantSettings(),
  ]);

  // 같은 요일만 — 같은 시각이어도 요일이 다르면 다른 수업이다.
  const filledDates = [...new Set(lineRows.map((r) => String(r.plan_date).slice(0, 10)))].filter(
    (d) => dowKeyOf(d) === dow,
  );

  const schedules: MonthScheduleRow[] = schedRows.map((r) => ({
    dayOfWeek: String(r.day_of_week),
    startTime: String(r.start_time),
    endTime: r.end_time ? String(r.end_time) : null,
    validFrom: r.valid_from ? String(r.valid_from) : null,
    validTo: r.valid_to ? String(r.valid_to) : null,
    slotTeacherLabel: (r.slot_teacher_label as string | null) ?? null,
    slotRoomLabel: (r.slot_room_label as string | null) ?? null,
  }));
  const lastFilled = filledDates.length > 0 ? filledDates.sort().at(-1)! : date;
  const weeks: string[] = [];
  for (let d = date; d <= shiftDays(lastFilled, LOOKAHEAD_WEEKS * 7); d = shiftDays(d, 7)) weeks.push(d);
  const holidays = buildHolidayMap(settings.operations.holidays);
  const byDate = slotsByDateOf(weeks, schedules);
  const liveDates = weeks.filter(
    (d) => holidayNameOn(holidays, d) === null && (byDate[d] ?? []).some((s) => normalizeSlotTime(s.slotStart) === slot),
  );

  const chain = [...new Set([date, ...liveDates, ...filledDates])].filter((d) => d >= date).sort();
  const plan = planLessonShift({ kind, fromDate: date, liveDates, filledDates });
  if (!plan.ok) return { ok: false, error: REASON_TEXT[plan.reason], noContent: plan.reason === "no-content", chain };
  const fail = { ok: false as const, error: "진도를 옮기다 멈췄습니다 — 새로고침 후 확인해 주세요", noContent: false, chain };

  /** 한 칸(평시 줄) 좌표 — `.match()`로 건다. */
  const cell = (at: string) => ({
    tenant_id: tenantId,
    class_id: classId,
    plan_date: at,
    slot_start: slot,
    term_mode: "regular",
  });
  const remove = async (at: string) => !(await admin.from("class_sheet_plan_lines").delete().match(cell(at))).error;
  /** `from` 칸의 줄을 **새 행**으로 `to`에 복제한다. */
  const duplicate = async (from: string, to: string) => {
    const { data, error } = await admin
      .from("class_sheet_plan_lines")
      .select("skill_area, line_no, textbook, page_range, progress, homework")
      .match(cell(from));
    if (error) return false;
    const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
      ...r,
      tenant_id: tenantId,
      class_id: classId,
      plan_date: to,
      slot_start: slot,
      term_mode: "regular",
      updated_by: userId,
    }));
    return rows.length === 0 || !(await admin.from("class_sheet_plan_lines").insert(rows)).error;
  };

  // 🔑 옮기기 = **새 행으로 복제 → 원래 행 삭제**(id를 그대로 날짜만 바꾸지 않는다). 다른 창이 옛 주를 열어 둔
  //    채 그 줄을 고치면, id가 따라가 있으면 엉뚱한 주에 써진다 — 새 id면 "지워진 줄"로 충돌이 난다.
  //    복제 후 삭제 순서라 중간에 멈춰도 줄은 사라지지 않는다(한 벌이 남을 뿐).
  let moved = 0;
  for (const op of plan.ops) {
    const ok =
      op.op === "clear"
        ? await remove(op.at)
        : op.op === "copy"
          ? await duplicate(op.from, op.to)
          : (await duplicate(op.from, op.to)) && (await remove(op.from));
    if (!ok) return fail;
    moved += 1;
  }
  return { ok: true, moved, chain };
}
