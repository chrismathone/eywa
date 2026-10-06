import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slotLiveOnDate } from "@/features/timetable/lib/week";
import { SPLIT_DAY_KO, toHm, toMin, type ClassSplit, type SplitDay } from "../rules";
import type { ScheduleRow, SplitContext } from "./context";

/**
 * 나누기 **경고**(원장 2026-10-06: *"겹침의 경우 어떤 게 겹쳤는지 안내하고 그래도 이동하겠냐고 물어보고 확인하면
 * 넘어가게 · 시간이 겹쳐도 안내 나가고 이동 가능하게"*) — 막지 않는다. 사람이 읽고 확인하면 저장한다.
 * 🔴 조회가 실패하면 그 항목은 **경고를 안 낸다**(모르는 것을 겹침이라고 지어내지 않는다) — 대신 서버 로그.
 */
export type SplitPlan = { days: SplitDay[]; start: number; end: number; validFrom: string; validTo: string | null };

const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;
const span = (s: number, e: number) => `${toHm(s)}~${toHm(e)}`;

export async function collectSplitWarnings(
  sb: SupabaseClient,
  tenantId: string,
  ctx: SplitContext,
  plan: SplitPlan,
  refDate: string,
  /** 받는 반으로 이미 들어오는 나눔(정원 셈에 더한다). */
  incoming: readonly ClassSplit[],
): Promise<string[]> {
  const warnings: string[] = [];
  const on = plan.validFrom;
  const { data: enr, error } = await sb
    .from("enrollments")
    .select("class_id, start_date, end_date, attendance_days, student_id")
    .eq("tenant_id", tenantId)
    .or(`student_id.eq.${ctx.student.id},class_id.eq.${ctx.target.id}`);
  if (error) {
    console.error("[class-splits] 겹침 확인 조회 실패", error.message);
    return warnings;
  }
  const openOn = (e: { start_date: string; end_date: string | null }) =>
    e.start_date <= on && (e.end_date === null || e.end_date > on);
  const rows = (enr ?? []).filter(openOn);

  // ① 이미 그 반 수강생
  if (rows.some((e) => e.student_id === ctx.student.id && e.class_id === ctx.target.id)) {
    warnings.push(`${ctx.student.name} 학생은 이미 ${ctx.target.name} 수강생입니다.`);
  }

  // ② 학생의 다른 수업과 시간 겹침(원래 반·받는 반 말고)
  const otherIds = [
    ...new Set(
      rows
        .filter((e) => e.student_id === ctx.student.id && e.class_id !== ctx.source.id && e.class_id !== ctx.target.id)
        .map((e) => e.class_id as string),
    ),
  ];
  if (otherIds.length > 0) {
    const [sch, cls] = await Promise.all([
      sb
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to, classroom_id")
        .eq("tenant_id", tenantId)
        .in("class_id", otherIds),
      sb.from("classes").select("id, class_name").eq("tenant_id", tenantId).in("id", otherIds),
    ]);
    if (sch.error || cls.error) {
      console.error("[class-splits] 다른 수업 조회 실패", sch.error?.message ?? cls.error?.message);
    } else {
      const nameOf = new Map((cls.data ?? []).map((c) => [c.id as string, c.class_name as string]));
      for (const r of (sch.data ?? []) as ScheduleRow[]) {
        if (!plan.days.includes(r.day_of_week as SplitDay)) continue;
        if (!slotLiveOnDate({ dayOfWeek: r.day_of_week, validFrom: r.valid_from, validTo: r.valid_to }, refDate)) continue;
        const s = toMin(r.start_time);
        const e = toMin(r.end_time);
        if (!overlaps(plan.start, plan.end, s, e)) continue;
        warnings.push(
          `${ctx.student.name} — ${SPLIT_DAY_KO[r.day_of_week as SplitDay]} ${span(s, e)} '${nameOf.get(r.class_id) ?? "다른 반"}' 수업과 겹칩니다.`,
        );
      }
    }
  }

  // ③ 받는 반 강의실 정원
  const capWarn = await capacityWarnings(sb, tenantId, ctx, plan, rows, incoming);
  warnings.push(...capWarn);
  return [...new Set(warnings)];
}

async function capacityWarnings(
  sb: SupabaseClient,
  tenantId: string,
  ctx: SplitContext,
  plan: SplitPlan,
  openRows: readonly { class_id: string; attendance_days: unknown; student_id: string }[],
  incoming: readonly ClassSplit[],
): Promise<string[]> {
  const roomIds = [
    ...new Set(ctx.targetRows.map((r) => r.classroom_id ?? ctx.target.classroomId).filter((x): x is string => !!x)),
  ];
  if (roomIds.length === 0) return [];
  const { data: rooms, error } = await sb
    .from("classrooms")
    .select("id, name, capacity")
    .eq("tenant_id", tenantId)
    .in("id", roomIds);
  if (error) {
    console.error("[class-splits] 강의실 조회 실패", error.message);
    return [];
  }
  const roomOf = new Map((rooms ?? []).map((r) => [r.id as string, r as { name: string; capacity: number | null }]));
  const out: string[] = [];
  for (const day of plan.days) {
    const row = ctx.targetRows.find(
      (r: ScheduleRow) => r.day_of_week === day && overlaps(plan.start, plan.end, toMin(r.start_time), toMin(r.end_time)),
    );
    const room = roomOf.get(row?.classroom_id ?? ctx.target.classroomId ?? "");
    if (!room?.capacity) continue;
    const regulars = openRows.filter((e) => {
      if (e.class_id !== ctx.target.id) return false;
      const days = (e.attendance_days as string[] | null) ?? [];
      return days.length === 0 || days.includes(day);
    }).length;
    const visitors = incoming.filter(
      (s) => s.targetClassId === ctx.target.id && s.dayOfWeek === day && overlaps(plan.start, plan.end, toMin(s.startTime), toMin(s.endTime)),
    ).length;
    // 이미 그 반 수강생이면 정규 인원에 들어 있다 — 한 번 더 세지 않는다(①이 따로 알린다).
    const already = openRows.some((e) => e.class_id === ctx.target.id && e.student_id === ctx.student.id);
    const after = regulars + visitors + (already ? 0 : 1);
    if (after > room.capacity) {
      out.push(`${SPLIT_DAY_KO[day]} ${room.name} 정원 ${room.capacity}명 → ${after}명이 됩니다.`);
    }
  }
  return out;
}
