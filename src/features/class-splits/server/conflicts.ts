import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchInChunks } from "@/lib/supabase/batch";
import { slotLiveOnDate } from "@/features/timetable/lib/week";
import { SPLIT_DAY_KO, toHm, toMin, type ClassSplit, type SplitDay } from "../rules";
import type { ScheduleRow, SplitContext } from "./context";

/**
 * 나누기 **경고**(원장 2026-10-06: *"겹침의 경우 어떤 게 겹쳤는지 안내하고 그래도 이동하겠냐고 물어보고 확인하면
 * 넘어가게 · 시간이 겹쳐도 안내 나가고 이동 가능하게"*) — 막지 않는다. 사람이 읽고 확인하면 저장한다.
 * 학생 한 명이든 반 전체든 같은 함수다(`students`가 한 명이냐 여럿이냐만 다르다).
 * 🔴 조회가 실패하면 그 항목은 **경고를 안 낸다**(모르는 것을 겹침이라고 지어내지 않는다) — 대신 서버 로그.
 */
export type SplitPlan = { days: SplitDay[]; start: number; end: number; validFrom: string; validTo: string | null };
export type SplitStudent = { id: string; name: string };

type EnrRow = { class_id: string; start_date: string; end_date: string | null; attendance_days: unknown; student_id: string };

const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;
const span = (s: number, e: number) => `${toHm(s)}~${toHm(e)}`;
/** 경고가 너무 길면 사람이 안 읽는다 — 학생별 줄은 앞의 몇 개만 적고 나머지는 숫자로. */
const MAX_PER_KIND = 6;

export async function collectSplitWarnings(
  sb: SupabaseClient,
  tenantId: string,
  ctx: SplitContext,
  students: readonly SplitStudent[],
  plan: SplitPlan,
  refDate: string,
  /** 받는 반으로 이미 들어오는 나눔(정원 셈에 더한다). */
  incoming: readonly ClassSplit[],
): Promise<string[]> {
  const on = plan.validFrom;
  const openOn = (e: { start_date: string; end_date: string | null }) =>
    e.start_date <= on && (e.end_date === null || e.end_date > on);
  const ids = students.map((s) => s.id);
  const nameOfStudent = new Map(students.map((s) => [s.id, s.name]));
  let mine: EnrRow[];
  let targetRoster: EnrRow[];
  try {
    // 학생들의 수강(다른 수업 겹침·이미 수강생) · 받는 반 명단(정원) — 서로 독립(B4), 학생 수가 많을 수 있어 청크(B3).
    [mine, targetRoster] = await Promise.all([
      fetchInChunks<EnrRow>(ids, (c) =>
        sb.from("enrollments").select("class_id, start_date, end_date, attendance_days, student_id").eq("tenant_id", tenantId).in("student_id", c),
      ),
      sb
        .from("enrollments")
        .select("class_id, start_date, end_date, attendance_days, student_id")
        .eq("tenant_id", tenantId)
        .eq("class_id", ctx.target.id)
        .then((r) => {
          if (r.error) throw new Error(r.error.message);
          return (r.data ?? []) as EnrRow[];
        }),
    ]);
  } catch (e) {
    console.error("[class-splits] 겹침 확인 조회 실패", e);
    return [];
  }
  mine = mine.filter(openOn);
  targetRoster = targetRoster.filter(openOn);
  const warnings: string[] = [];
  const capped = (lines: string[], what: string) => {
    warnings.push(...lines.slice(0, MAX_PER_KIND));
    if (lines.length > MAX_PER_KIND) warnings.push(`… 그 밖에 ${lines.length - MAX_PER_KIND}명 더 ${what}`);
  };

  // ① 이미 그 반 수강생
  const already = new Set(targetRoster.map((e) => e.student_id).filter((id) => nameOfStudent.has(id)));
  capped(
    [...already].map((id) => `${nameOfStudent.get(id)} 학생은 이미 ${ctx.target.name} 수강생입니다.`),
    "이미 수강생입니다.",
  );

  // ② 학생의 다른 수업과 시간 겹침(원래 반·받는 반 말고)
  const others = mine.filter((e) => e.class_id !== ctx.source.id && e.class_id !== ctx.target.id);
  const otherIds = [...new Set(others.map((e) => e.class_id))];
  if (otherIds.length > 0) {
    try {
      const [sch, cls] = await Promise.all([
        fetchInChunks<ScheduleRow>(otherIds, (c) =>
          sb
            .from("class_schedules")
            .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to, classroom_id")
            .eq("tenant_id", tenantId)
            .in("class_id", c),
        ),
        fetchInChunks<{ id: string; class_name: string }>(otherIds, (c) =>
          sb.from("classes").select("id, class_name").eq("tenant_id", tenantId).in("id", c),
        ),
      ]);
      const nameOf = new Map(cls.map((c) => [c.id, c.class_name]));
      const hits = sch.filter(
        (r) =>
          plan.days.includes(r.day_of_week as SplitDay) &&
          slotLiveOnDate({ dayOfWeek: r.day_of_week, validFrom: r.valid_from, validTo: r.valid_to }, refDate) &&
          overlaps(plan.start, plan.end, toMin(r.start_time), toMin(r.end_time)),
      );
      const lines: string[] = [];
      for (const e of others) {
        for (const r of hits.filter((h) => h.class_id === e.class_id)) {
          lines.push(
            `${nameOfStudent.get(e.student_id)} — ${SPLIT_DAY_KO[r.day_of_week as SplitDay]} ${span(toMin(r.start_time), toMin(r.end_time))} '${nameOf.get(r.class_id) ?? "다른 반"}' 수업과 겹칩니다.`,
          );
        }
      }
      capped([...new Set(lines)], "다른 수업과 겹칩니다.");
    } catch (e) {
      console.error("[class-splits] 다른 수업 조회 실패", e);
    }
  }

  // ③ 원래 반 수업 시간 밖 — 막지 않는다(맡아 주는 시간이 앞뒤로 붙을 수 있다). 무엇이 일어나는지만 알린다.
  for (const day of plan.days) {
    const rows = ctx.sourceRows.filter((r) => r.day_of_week === day);
    if (rows.length === 0) continue;
    if (rows.some((r) => overlaps(plan.start, plan.end, toMin(r.start_time), toMin(r.end_time)))) continue;
    const s = Math.min(...rows.map((r) => toMin(r.start_time)));
    const e = Math.max(...rows.map((r) => toMin(r.end_time)));
    warnings.push(`${SPLIT_DAY_KO[day]} ${span(plan.start, plan.end)}은 ${ctx.source.name} 수업 시간(${span(s, e)}) 밖입니다 — 원래 반 수업은 그대로이고 이 시간이 더해집니다.`);
  }

  // ④ 받는 반 강의실 정원 — 새로 들어오는 인원 = 이미 수강생이 아닌 학생 수.
  warnings.push(...(await capacityWarnings(sb, tenantId, ctx, plan, targetRoster, incoming, ids.length - already.size)));
  return [...new Set(warnings)];
}

async function capacityWarnings(
  sb: SupabaseClient,
  tenantId: string,
  ctx: SplitContext,
  plan: SplitPlan,
  targetRoster: readonly EnrRow[],
  incoming: readonly ClassSplit[],
  adding: number,
): Promise<string[]> {
  if (adding <= 0) return [];
  const roomIds = [
    ...new Set(ctx.targetRows.map((r) => r.classroom_id ?? ctx.target.classroomId).filter((x): x is string => !!x)),
  ];
  if (roomIds.length === 0) return [];
  const { data: rooms, error } = await sb.from("classrooms").select("id, name, capacity").eq("tenant_id", tenantId).in("id", roomIds);
  if (error) {
    console.error("[class-splits] 강의실 조회 실패", error.message);
    return [];
  }
  const roomOf = new Map((rooms ?? []).map((r) => [r.id as string, r as { name: string; capacity: number | null }]));
  const out: string[] = [];
  for (const day of plan.days) {
    const row = ctx.targetRows.find(
      (r) => r.day_of_week === day && overlaps(plan.start, plan.end, toMin(r.start_time), toMin(r.end_time)),
    );
    const room = roomOf.get(row?.classroom_id ?? ctx.target.classroomId ?? "");
    if (!room?.capacity) continue;
    const regulars = targetRoster.filter((e) => {
      const days = (e.attendance_days as string[] | null) ?? [];
      return days.length === 0 || days.includes(day);
    }).length;
    const visitors = incoming.filter(
      (s) => s.targetClassId === ctx.target.id && s.dayOfWeek === day && overlaps(plan.start, plan.end, toMin(s.startTime), toMin(s.endTime)),
    ).length;
    const after = regulars + visitors + adding;
    if (after > room.capacity) out.push(`${SPLIT_DAY_KO[day]} ${room.name} 정원 ${room.capacity}명 → ${after}명이 됩니다.`);
  }
  return out;
}
