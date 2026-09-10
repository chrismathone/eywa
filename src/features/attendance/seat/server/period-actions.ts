"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { hhmm, type SeatKey } from "../seat";
import { seatMoveBlockReason } from "../placement";
import { validateSeatPeriodMove } from "../period-choice";
import { gateSeatMoveWrite } from "./move-gate";
import { getSeatDay } from "./queries";
import { seatDowKey } from "./period-choice";

/**
 * 자리 **교시 선택** 쓰기 — 0255a `seat_period_moves`/`seat_period_pins`.
 *
 * 원장 2026-09-10: *"한번 드래그한 학생은 '다음에도 이 LAB실 수업을 이 시간대로 고정할까요?'라고
 * 물어볼것."* + 근거 *"그 학생만 … 다른 학생과 다른 시간에 랩실을 듣는 학생이 있어."*
 *
 * 🔴🔴 **출결·시간표·수강을 쓰지 않는다.** 바뀌는 것은 "그 학생이 그 반의 어느 자리 교시 명단에
 *    보이는가"뿐이다(`period-choice.ts` 머리 주석). 시간표는 이미 맞다 — 그 반은 정말 하루 두 번 들어간다.
 * 🔴 **게이트·감사로그는 배치와 같은 규약**([`move-gate.ts`](./move-gate.ts)) — 공개 PIN 화면에서는
 *    쓰지 않는다(실행자를 못 남기는 동작은 열지 않는다).
 * 🔴 **판정은 서버가 다시 한다**([[#77]]) — 화면이 보낸 반·교시를 믿지 않고 그 날 명단에서 되읽는다.
 */

export type SeatPeriodResult = { ok: true; pinned: boolean } | { error: string };
export type SeatPeriodClearResult = { ok: true; changed: number } | { error: string };

function revalidateSeat(): void {
  revalidatePath("/attendance/seat");
  revalidatePath("/seat");
}

/** 표가 아직 없다(0255a 미적용)와 그냥 실패를 가른다 — 원인을 단정하지 않는다. */
function periodError(err: { code?: string; message?: string }): string {
  if (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    /seat_period_(moves|pins)/i.test(err.message ?? "")
  ) {
    return "자리 교시 선택 기능이 아직 켜지지 않았습니다 — 관리자에게 문의하세요(0255a 미적용).";
  }
  return "교시를 옮기지 못했습니다 — 다시 시도해 주세요";
}

/**
 * 학생 카드 한 장을 **같은 반의 다른 자리 교시**로 옮긴다(드래그 한 번).
 *
 * 🔑 이 동작은 **감추기**다 — 학생은 이미 제 반의 모든 자리 교시 명단에 있으므로, 옮긴다 = 나머지
 *    교시에서 감춘다. 없던 학생을 세우지 않는다.
 * 🔑 `pin`이 참이면 **상시 고정**도 함께 쓴다(원장의 *"다음에도 … 고정할까요?"*) — 시작일은 **이 화면의
 *    날짜**다. 그 전 날짜의 명단은 기록이라 건드리지 않는다.
 * ⚠️ 고정을 걸어도 **그날 줄은 남긴다** — 나중에 고정을 풀어도 "오늘 사람이 실제로 옮긴 사실"이 그대로
 *    남아야 한다(둘은 다른 사실이다).
 */
export async function moveSeatStudentPeriod(input: {
  seat: SeatKey;
  date: string;
  studentId: string;
  classId: string;
  fromSlot: string;
  toSlot: string;
  /** 참이면 상시 고정도 함께 — 원장 *"고정하면 그 학생은 계속 그 시간대에서 랩실 수업 듣게"*. */
  pin?: boolean;
}): Promise<SeatPeriodResult> {
  const g = await gateSeatMoveWrite(input.seat, input.date);
  if ("error" in g) return g;

  const fromSlot = hhmm(input.fromSlot);
  const toSlot = hhmm(input.toSlot);
  const day = await getSeatDay(input.seat, input.date);

  // 🔴 화면이 보낸 반을 믿지 않는다 — 그 교시 명단에서 이 학생이 실제로 그 반에 서 있어야 한다.
  const here = (day.rosterByPeriod[fromSlot] ?? []).find((r) => r.classId === input.classId);
  const student = here?.students.find((s) => s.id === input.studentId);
  if (!student) return { error: "이 교시 명단에 없는 학생입니다" };

  const check = validateSeatPeriodMove({
    classId: input.classId,
    toClassId: input.classId,
    fromSlot,
    toSlot,
    classSlots: day.slotsByClass[input.classId] ?? [],
    markedReason: seatMoveBlockReason(student.status),
  });
  if ("error" in check) return check;

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("seat_period_moves").upsert(
    {
      tenant_id: g.tenantId,
      seat: input.seat,
      session_date: input.date,
      class_id: input.classId,
      student_id: input.studentId,
      slot_start: toSlot,
      moved_by: g.userId,
      updated_at: now,
    },
    // 🔴 술어 없는 일반 유니크라 추론이 된다([[#113]]).
    { onConflict: "tenant_id,seat,session_date,class_id,student_id" },
  );
  if (error) return { error: periodError(error) };

  let pinned = false;
  if (input.pin) {
    const { error: pinErr } = await supabase.from("seat_period_pins").upsert(
      {
        tenant_id: g.tenantId,
        seat: input.seat,
        day_of_week: seatDowKey(input.date),
        class_id: input.classId,
        student_id: input.studentId,
        slot_start: toSlot,
        effective_from: input.date,
        pinned_by: g.userId,
        updated_at: now,
      },
      { onConflict: "tenant_id,seat,day_of_week,class_id,student_id" },
    );
    // ⚠️ 고정만 실패해도 **그날 이동은 이미 됐다** — 되돌리지 않고 사실대로 알린다(사람이 다시 누르면 된다).
    if (pinErr) return { error: "교시는 옮겼지만 고정에 실패했습니다 — 다시 시도해 주세요" };
    pinned = true;
  }

  await logAction({
    action: pinned ? "seat_period_pin" : "seat_period_move",
    targetType: "attendance",
    metadata: {
      studentId: input.studentId,
      classId: input.classId,
      seat: input.seat,
      date: input.date,
      fromSlot,
      toSlot,
      ...(pinned ? { dayOfWeek: seatDowKey(input.date), effectiveFrom: input.date } : {}),
      via: g.via,
    },
  });
  revalidateSeat();
  return { ok: true, pinned };
}

/**
 * 교시 지정 해제 — 그 반의 **그날 이동 + 그 요일 고정**을 함께 지운다.
 *
 * 🔴 **둘을 함께 지운다** — 하루짜리만 지우면 고정이 남아 다음 날 도로 옮겨지고, 고정만 지우면 오늘
 *    화면이 안 돌아온다. 사람이 [해제]를 누르는 뜻은 "이 반은 그냥 원래대로"다.
 * 🔴 **되돌리는 것이지 빼는 것이 아니다** — 줄이 없으면 그 반 전원이 제 반의 모든 자리 교시에 다시
 *    선다(0255a 이전과 글자 그대로 같은 화면).
 * ⚠️ **과거 날짜의 그날 줄은 안 건드린다** — 지우는 하루짜리는 이 화면의 날짜 하나뿐이다(기록 보존).
 */
export async function clearSeatPeriodChoices(input: {
  seat: SeatKey;
  date: string;
  classId: string;
}): Promise<SeatPeriodClearResult> {
  const g = await gateSeatMoveWrite(input.seat, input.date);
  if ("error" in g) return g;

  const supabase = createAdminClient();
  const [moveRes, pinRes] = await Promise.all([
    supabase
      .from("seat_period_moves")
      .delete()
      .eq("tenant_id", g.tenantId)
      .eq("seat", input.seat)
      .eq("session_date", input.date)
      .eq("class_id", input.classId)
      .select("student_id, slot_start"),
    supabase
      .from("seat_period_pins")
      .delete()
      .eq("tenant_id", g.tenantId)
      .eq("seat", input.seat)
      .eq("day_of_week", seatDowKey(input.date))
      .eq("class_id", input.classId)
      .select("student_id, slot_start"),
  ]);
  const err = moveRes.error ?? pinRes.error;
  if (err) return { error: periodError(err) };

  const moves = moveRes.data ?? [];
  const pins = pinRes.data ?? [];
  const changed = moves.length + pins.length;
  if (changed === 0) return { ok: true, changed: 0 };

  await logAction({
    action: "seat_period_clear",
    targetType: "attendance",
    metadata: {
      classId: input.classId,
      seat: input.seat,
      date: input.date,
      dayOfWeek: seatDowKey(input.date),
      count: changed,
      // 🔴 무엇을 지웠는지 — 지정 로그(`seat_period_move`/`_pin`)와 같은 축이라 짝지어 읽힌다.
      removedMoves: moves.map((r) => ({ studentId: r.student_id as string, slotStart: hhmm(r.slot_start as string) })),
      removedPins: pins.map((r) => ({ studentId: r.student_id as string, slotStart: hhmm(r.slot_start as string) })),
      via: g.via,
    },
  });
  revalidateSeat();
  return { ok: true, changed };
}
