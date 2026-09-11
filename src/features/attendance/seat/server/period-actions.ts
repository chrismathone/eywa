"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { hhmm, type SeatKey } from "../seat";
import { seatMoveBlockReason } from "../placement";
import { validateSeatPeriodMove } from "../period-choice";
import { gateSeatMoveWrite } from "./move-gate";
import { getSeatDay } from "./queries";
import { applySeatDayChoices, getSeatPeriodChoices, seatDowKey } from "./period-choice";
import { getSeatStudentClasses } from "./next-destination";

/**
 * 자리 **교시 선택** 쓰기 — 0255a `seat_period_moves`/`seat_period_pins`.
 *
 * 원장 2026-09-10: *"한번 드래그한 학생은 '다음에도 이 LAB실 수업을 이 시간대로 고정할까요?'라고
 * 물어볼것."* + 근거 *"그 학생만 … 다른 학생과 다른 시간에 랩실을 듣는 학생이 있어."*
 *
 * 🔴🔴 **출결·시간표·수강을 쓰지 않는다.** 바뀌는 것은 "그 학생이 그날 이 자리의 어느 교시 명단에
 *    보이는가"뿐이다(`period-choice.ts` 머리 주석). 시간표는 그대로다 — 옮긴 학생의 출결도 원래 반으로 저장된다.
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
 * 학생 카드 한 장을 **그날 이 자리의 다른 교시**로 옮긴다(드래그 한 번) — 원장 2026-09-10 *"다른 시간으로
 * 이동하고 싶은것"*. 그 반이 그 교시에 자리 수업이 없어도 된다(목표 교시에 **옮겨 온 묶음**으로 선다).
 *
 * 🔑 쓰는 것은 "이 학생은 그날 이 교시"라는 선택 한 줄뿐이다 — 명단(원래 교시에서 감추기 · 목표 교시에
 *    세우기)은 [`applySeatPeriodChoicesByPeriod`](../period-choice.ts)가 그 줄에서 파생한다. 세우는 학생은
 *    그날 이 자리 명단에 이미 있는 학생뿐이다(명단 밖 학생을 끌어오는 경로가 아니다).
 * 🔴 그 시각에 그 반의 **다른 수업**이 있으면 거절한다 — 자리 기록과 반 수업 기록이 같은 키가 된다.
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
  // 명단·선택·학생 축은 서로 독립이라 병렬(B4). 선택까지 얹어야 **화면이 그린 명단**과 같다 — 옮겨 온 학생은
  // 목표 교시에 서 있고 원래 교시엔 없다(그 학생을 한 번 더 옮기는 경우가 여기서 갈린다).
  const [day, choiceLoad, classesLoad] = await Promise.all([
    getSeatDay(input.seat, input.date),
    getSeatPeriodChoices(g.tenantId, input.seat, input.date),
    // 학생 축 — 화면과 같은 조회·같은 규칙([[#77]]: 화면 값은 스냅샷). 로그인 경로라 세션 클라이언트(테넌트를 안 넘긴다).
    getSeatStudentClasses([input.studentId], input.date, input.seat),
  ]);
  // 선택을 못 읽었으면 화면과 같은 명단을 만들 수 없다 — 추측으로 쓰지 않는다(화면도 이때 드래그를 잠근다).
  if (!choiceLoad.ready) return { error: choiceLoad.reason ?? "자리 교시 선택을 불러오지 못했습니다" };
  // 🔴 서버는 게이트다 — 학생의 다른 수업을 확인 못 하면 옮기지 않는다(모른 채 쓰면 그 시각 두 곳에 선 학생이 생긴다).
  if (!classesLoad.ok) return { error: classesLoad.error };
  const rosterByPeriod = applySeatDayChoices(day, choiceLoad, input.date);

  // 🔴 화면이 보낸 반을 믿지 않는다 — 그 교시 명단에서 이 학생이 실제로 그 반(원래 반)에 서 있어야 한다.
  //    옮겨 온 묶음도 반 id가 원래 반이라 같은 판정을 탄다.
  const findIn = (slot: string) =>
    (rosterByPeriod[slot] ?? [])
      .find((r) => r.classId === input.classId)
      ?.students.find((s) => s.id === input.studentId);
  const student = findIn(fromSlot);
  /**
   * 🔑 **고정 확인** — 창("다음에도 … 고정할까요?")은 그날 이동이 **이미 반영된 뒤에** 뜬다. 그래서 그 버튼이
   *    부르는 두 번째 호출에선 학생이 이미 목표 교시에 서 있고 출발 교시엔 없다(선택을 얹은 명단이라서).
   *    이것을 "명단에 없는 학생"으로 거절하면 고정이 영영 안 된다. 오늘 명단은 안 바뀌고 고정만 쓰는 경우라
   *    **출결 찍힘 판정도 걸지 않는다** — 그 사이 목표 교시에서 찍혔어도 앞으로의 요일을 정하는 일과는 무관하다.
   */
  const alreadyThere = !student && input.pin === true && findIn(toSlot) !== undefined;
  if (!student && !alreadyThere) return { error: "이 교시 명단에 없는 학생입니다" };

  const check = validateSeatPeriodMove({
    fromSlot,
    toSlot,
    classSlots: day.slotsByClass[input.classId] ?? [],
    periodStarts: day.periods.map((p) => p.start),
    busyStarts: day.busyStartsByClass[input.classId] ?? [],
    markedReason: student ? seatMoveBlockReason(student.status) : null,
    // 🔴 학생 축 — 화면과 같은 함수·같은 문장. 조회가 돈 뒤 키가 없으면 그날 유효한 수강이 없는 학생(= 다른 수업도 없다).
    studentClasses: classesLoad.byStudent[input.studentId] ?? [],
    toEnds: day.periods.find((p) => p.start === toSlot)?.ends,
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
      // 🔑 그 반이 그 교시에 자리 수업이 없는 "다른 시간" 이동인가 — 하루 두 번 도는 반의 교시 고르기와 가른다.
      crossTime: check.crossTime,
      // 이미 옮긴 뒤 창에서 고정만 누른 호출(오늘 명단은 이 호출로 안 바뀌었다).
      ...(alreadyThere ? { confirmOnly: true } : {}),
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
