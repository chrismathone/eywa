"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { explainDbError } from "@/lib/supabase/db-error";
import { createClient } from "@/lib/supabase/server";
import type { AttendanceMark } from "../cell-display";
import { scopeTeaches } from "../scope-ownership";
import { seatTransferTargets, seatTransferUnits, type SeatTransferRow, type SeatTransferUnits } from "../seat-transfer";
import { requireAttendanceSalaryAdmin } from "./salary-rates";
import { loadScopeFacts } from "./scope-ownership";
import { taughtByColumnReady } from "./taught-by-db";

/**
 * **JJ실 시수 넘기기 · 되돌리기**(원장 2026-10-07 — *"JJ 시수를 선생님에게 / 특정 JJ 시수를 넘길 수 있으면 됨. JJ가 -1되면, 다른 선생님이
 * +1 되도록. / 월별 출석부 우클릭으로 (권한 보유자 전용)"*). 한 칸(반 × 학생 × 날짜)의 JJ실 기록을 그 선생님 몫으로 돌린다 —
 * 귀속 표식 `attendance_records.taught_by`(0316a)만 고치고 출결 상태·시수·메모는 건드리지 않는다. 규칙 = `seat-transfer.ts`.
 *
 * 🔴 게이트는 화면이 아니라 여기서 다시 본다(#77): 급여 비율을 고칠 수 있는 사람만('다른 강사 뷰'는 열람 전용이라 거절) ·
 *    그 선생님이 그 달 그 반을 맡고 있을 때만(`scopeTeaches` — 화면이 그 반을 그 선생님 표로 그리는 조건과 같다) ·
 *    JJ실 기록만(랩실 제외) · 다른 선생님이 이미 넘겨받은 기록은 뺏지 않는다.
 * ⚠️ 급여 숫자가 달라지는 일이라 감사로그를 남긴다(누가 · 어느 칸 · 몇 시수 — 급여 갈래라 슬랙으로는 안 나간다).
 */
export type SeatTransferInput = { classId: string; studentId: string; date: string; teacherId: string; take: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

type RecordRow = {
  id: string; slot_start: string | null; seat_label: string | null; recorded_via: string | null; taught_by: string | null;
  status: AttendanceMark; session_units: number | string | null; recorded_at: string | null;
};
type Shaped = SeatTransferRow & { id: string };

export async function transferSeatUnits(input: SeatTransferInput): Promise<{ ok: boolean; error?: string; units?: SeatTransferUnits; moved?: number }> {
  const user = await requireAttendanceSalaryAdmin();
  if (!user) return { ok: false, error: "급여 비율을 설정할 수 있는 사람만 관리자용 출석부에서 넘길 수 있습니다" };
  if (!input || !UUID.test(String(input.classId)) || !UUID.test(String(input.studentId)) || !UUID.test(String(input.teacherId)) || !YMD.test(String(input.date)) || typeof input.take !== "boolean") {
    return { ok: false, error: "칸을 다시 선택한 뒤 눌러 주세요" };
  }
  const admin = createAdminClient();
  if (!(await taughtByColumnReady(admin, { fresh: true }))) return { ok: false, error: "시수를 넘기는 기능이 아직 준비되지 않았습니다. 잠시 후 다시 눌러 주세요" };

  let rows: RecordRow[];
  let slots;
  try {
    // 반 판정 재료(담임 · 그 달 교시)는 세션 클라이언트로 — 남의 학원 반은 안 보인다(= 지점 확인).
    const [facts, read] = await Promise.all([
      loadScopeFacts(await createClient(), [{ classId: input.classId, date: input.date }]),
      admin.from("attendance_records")
        .select("id, slot_start, seat_label, recorded_via, taught_by, status, session_units, recorded_at")
        .eq("tenant_id", user.tenantId).eq("class_id", input.classId).eq("student_id", input.studentId).eq("session_date", input.date)
        .order("recorded_at", { ascending: false }).order("id", { ascending: false }),
    ]);
    const own = facts.get(input.classId);
    if (!scopeTeaches(own, input.teacherId, input.date)) return { ok: false, error: "이 선생님이 그 달에 맡은 반이 아닙니다" };
    if (read.error) throw read.error;
    rows = (read.data ?? []) as RecordRow[];
    slots = own!.slots;
  } catch (error) {
    return { ok: false, error: explainDbError(error, { scope: "attendance.seatTransfer.read", fallback: "출결 기록을 불러오지 못했습니다. 잠시 후 다시 눌러 주세요" }).message };
  }

  const shape = (r: RecordRow): Shaped => ({
    id: r.id, slotStart: r.slot_start, seatLabel: r.seat_label, recordedVia: r.recorded_via, taughtBy: r.taught_by,
    status: r.status, units: r.session_units === null || r.session_units === undefined ? null : Number(r.session_units),
  });
  // 교시마다 가장 최근 행이 그 칸의 값이다(조회가 최신순) — 판정·시수는 그 행으로, 귀속은 같은 교시의 옛 행까지 함께 고친다(다음 정정 때 갈리지 않게).
  const latest = new Map<string, Shaped>();
  for (const r of rows) if (!latest.has(r.slot_start ?? "")) latest.set(r.slot_start ?? "", shape(r));
  const current = [...latest.values()];
  const targets = seatTransferTargets(current, slots, input.date, input.teacherId, input.take);
  if (targets.length === 0) {
    const now = seatTransferUnits(current, slots, input.date, input.teacherId);
    if (input.take && now.others > 0) return { ok: false, error: "이 칸의 JJ실 시수는 이미 다른 선생님 몫으로 넘겨져 있습니다" };
    return { ok: false, error: input.take ? "이 칸에 넘길 수 있는 JJ실 기록이 없습니다" : "이 칸에 되돌릴 JJ실 시수가 없습니다", units: now };
  }
  const targetSlots = new Set(targets.map((t) => t.slotStart ?? ""));
  const ids = rows.filter((r) => targetSlots.has(r.slot_start ?? "")).map((r) => r.id);
  const { error } = await admin.from("attendance_records")
    .update({ taught_by: input.take ? input.teacherId : null })
    .eq("tenant_id", user.tenantId).in("id", ids);
  if (error) return { ok: false, error: explainDbError(error, { scope: "attendance.seatTransfer.save", fallback: "시수를 넘기지 못했습니다. 잠시 후 다시 눌러 주세요", context: { classId: input.classId } }).message };

  const moved = seatTransferUnits(targets.map((t) => ({ ...t, taughtBy: null })), slots, input.date, input.teacherId).avail;
  const after = seatTransferUnits(current.map((r) => (targetSlots.has(r.slotStart ?? "") ? { ...r, taughtBy: input.take ? input.teacherId : null } : r)), slots, input.date, input.teacherId);
  await logAction({
    action: input.take ? "payroll_jj_units_take" : "payroll_jj_units_return",
    targetType: "attendance",
    targetLabel: `${input.date} JJ실 시수 ${input.take ? "넘기기" : "되돌리기"}`,
    metadata: { classId: input.classId, studentId: input.studentId, userId: input.teacherId, date: input.date, units: moved, slots: [...targetSlots].filter(Boolean) },
  });
  revalidatePath("/attendance");
  return { ok: true, units: after, moved };
}
