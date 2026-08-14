"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SEAT_DB_LABEL, hhmm, isPayrollSeat, type SeatKey } from "../seat";
import { gateSeatWrite, rosterKeys } from "./gate";

export type SeatStatus = "present" | "absent" | "late";
export type SeatResult = { ok: true; changed: number } | { error: string };

/** 자리 기록 한 칸 저장. `status: null` = 미체크로 되돌리기(그 교시 기록 삭제). */
export async function setSeatCell(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
  classId: string;
  studentId: string;
  status: SeatStatus | null;
}): Promise<SeatResult> {
  const g = await gateSeatWrite(input.seat, input.date);
  if ("error" in g) return g;

  const slot = hhmm(input.slotStart);
  const roster = await rosterKeys(input.seat, input.date, slot, g.via === "pin" ? g.tenantId : null);
  if (!roster) return { error: "그 시각에는 이 자리 수업이 없습니다" };
  if (!roster.keys.has(`${input.classId}|${input.studentId}`)) {
    return { error: "이 교시 명단에 없는 학생입니다" };
  }

  const supabase = g.via === "pin" ? createAdminClient() : await createClient();
  const changed = await writeOne(supabase, {
    tenantId: g.tenantId,
    userId: g.userId,
    seat: input.seat,
    date: input.date,
    slot,
    classId: input.classId,
    studentId: input.studentId,
    status: input.status,
  });
  if (typeof changed === "string") return { error: changed };

  revalidatePath("/attendance/seat");
  revalidatePath("/attendance");
  revalidatePath("/seat");
  return { ok: true, changed };
}

/**
 * 일괄 — **미체크인 학생만** 채운다(비파괴). 이미 찍힌 값은 절대 덮지 않는다(ECS 일괄 출석과 같은 규약).
 * `classId`를 주면 그 반만("이 반 출석"), 없으면 그 교시 전체.
 */
export async function fillSeatSlot(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
  status: Extract<SeatStatus, "present" | "absent">;
  classId?: string;
}): Promise<SeatResult> {
  const g = await gateSeatWrite(input.seat, input.date);
  if ("error" in g) return g;

  const slot = hhmm(input.slotStart);
  const roster = await rosterKeys(input.seat, input.date, slot, g.via === "pin" ? g.tenantId : null);
  if (!roster) return { error: "그 시각에는 이 자리 수업이 없습니다" };

  const targets = input.classId
    ? [[input.classId, roster.classes.get(input.classId) ?? []] as const]
    : [...roster.classes.entries()];
  if (input.classId && !roster.classes.has(input.classId)) return { error: "이 교시에 없는 반입니다" };

  const rows = targets.flatMap(([classId, studentIds]) =>
    studentIds.map((studentId) => ({
      tenant_id: g.tenantId,
      class_id: classId,
      student_id: studentId,
      session_date: input.date,
      slot_start: slot,
      status: input.status,
      seat_label: isPayrollSeat(input.seat) ? SEAT_DB_LABEL[input.seat] : null,
      recorded_by: g.userId,
      recorded_via: "seat",
    })),
  );
  if (rows.length === 0) return { ok: true, changed: 0 };

  const supabase = g.via === "pin" ? createAdminClient() : await createClient();
  const first = await supabase.from("attendance_records").insert(rows);
  const error =
    first.error && /recorded_via/i.test(first.error.message)
      ? (await supabase.from("attendance_records").insert(
          rows.map((r) => {
            const rest = { ...r };
            delete rest.recorded_via;
            return rest;
          }),
        )).error
      : first.error;
  if (error) return { error: error.message };

  revalidatePath("/attendance/seat");
  revalidatePath("/attendance");
  revalidatePath("/seat");
  return { ok: true, changed: rows.length };
}

/**
 * 한 칸 쓰기 — 그 교시의 유효행이 있으면 갱신, 없으면 삽입, `status: null`이면 삭제.
 * 반환: 바뀐 행 수, 실패 시 에러 문자열.
 *
 * ⚠️ 항상 **그 교시(slot_start)만** 다룬다 — 같은 날 다른 교시 기록은 건드리지 않는다.
 * ⚠️ `seat_label`은 **쓸 때 한 번 박고** 그대로 둔다(0208a) — 담임 시수 집계가 이 값으로 행을 거른다.
 *    반 출석부에서 같은 칸을 고쳐도 그 경로는 이 칼럼을 아예 언급하지 않으므로 자리 표시는 보존된다.
 * 📌 반 출결 완료 알림(notifyIfClassAttendanceComplete)은 부르지 않는다 — 자리 교시는 그 반 수업의
 *    일부일 뿐이라 "이 반 오늘 출결 끝"이 아니다.
 */
async function writeOne(
  supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  p: {
    tenantId: string;
    userId: string | null;
    seat: SeatKey;
    date: string;
    slot: string;
    classId: string;
    studentId: string;
    status: SeatStatus | null;
  },
): Promise<number | string> {
  const base = supabase
    .from("attendance_records")
    .select("id, recorded_at")
    .eq("tenant_id", p.tenantId)
    .eq("class_id", p.classId)
    .eq("student_id", p.studentId)
    .eq("session_date", p.date)
    .eq("slot_start", p.slot);

  if (p.status === null) {
    const { error } = await supabase
      .from("attendance_records")
      .delete()
      .eq("tenant_id", p.tenantId)
      .eq("class_id", p.classId)
      .eq("student_id", p.studentId)
      .eq("session_date", p.date)
      .eq("slot_start", p.slot);
    return error ? error.message : 1;
  }

  const { data: rows } = await base.order("recorded_at", { ascending: false }).limit(1);
  const existing = rows?.[0]?.id as string | undefined;
  if (existing) {
    const patch: Record<string, unknown> = {
      status: p.status,
      ...(isPayrollSeat(p.seat) ? { seat_label: SEAT_DB_LABEL[p.seat] } : {}),
      recorded_by: p.userId,
      recorded_at: new Date().toISOString(),
      recorded_via: "seat",
    };
    const first = await supabase.from("attendance_records").update(patch).eq("id", existing);
    const error =
      first.error && /recorded_via/i.test(first.error.message)
        ? (
            await supabase
              .from("attendance_records")
              .update({
                status: patch.status,
                ...(isPayrollSeat(p.seat) ? { seat_label: SEAT_DB_LABEL[p.seat] } : {}),
                recorded_by: patch.recorded_by,
                recorded_at: patch.recorded_at,
              })
              .eq("id", existing)
          ).error
        : first.error;
    return error ? error.message : 1;
  }

  const row = {
    tenant_id: p.tenantId,
    class_id: p.classId,
    student_id: p.studentId,
    session_date: p.date,
    slot_start: p.slot,
    status: p.status,
    seat_label: isPayrollSeat(p.seat) ? SEAT_DB_LABEL[p.seat] : null,
    recorded_by: p.userId,
    recorded_via: "seat",
  };
  const first = await supabase.from("attendance_records").insert(row);
  const error =
    first.error && /recorded_via/i.test(first.error.message)
      ? (await supabase.from("attendance_records").insert({
          tenant_id: row.tenant_id,
          class_id: row.class_id,
          student_id: row.student_id,
          session_date: row.session_date,
          slot_start: row.slot_start,
          status: row.status,
          seat_label: row.seat_label,
          recorded_by: row.recorded_by,
        })).error
      : first.error;
  return error ? error.message : 1;
}
