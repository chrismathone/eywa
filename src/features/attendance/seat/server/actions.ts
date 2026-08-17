"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SEAT_DB_LABEL, hhmm, isPayrollSeat, type SeatKey } from "../seat";
import { pickSaveTargets } from "../../save-targets";
import { gateSeatWrite, rosterKeys } from "./gate";

export type SeatStatus = "present" | "absent" | "late";
export type SeatResult = { ok: true; changed: number } | { error: string };

/** 0212a(recorded_via) 컬럼이 없으면 빼고 재시도 — 자리 기록을 죽이지 않는다(#95). 성공 = null. */
async function seatUpdate(
  supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  patch: Record<string, unknown>,
  ids: string[],
): Promise<string | null> {
  const first = await supabase.from("attendance_records").update(patch).in("id", ids);
  if (!first.error) return null;
  if (!/recorded_via/i.test(first.error.message)) return first.error.message;
  const rest = { ...patch };
  delete rest.recorded_via;
  const retry = await supabase.from("attendance_records").update(rest).in("id", ids);
  return retry.error?.message ?? null;
}

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

  const built = targets.flatMap(([classId, studentIds]) =>
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
  if (built.length === 0) return { ok: true, changed: 0 };

  const supabase = g.via === "pin" ? createAdminClient() : await createClient();
  // 🔴 중복 행 방지 재확인(2026-08-17 감사 P1-4) — 명단의 '미체크'는 화면 스냅샷이라, 그 사이 생긴
  //    기록(같은 교시 행·비급여 자리의 "그날 전체" 행)이 있으면 그 칸은 건너뛴다. 특히 비급여 자리(JJ)의
  //    day-level 행은 담임 시수와 같은 축이라 blind insert가 시수·회차를 이중 계상한다(writeOne 주석 참조).
  //    자리판 3종 밖 day-level 상태(조퇴 등)도 여기서 자연히 보호된다(그 칸에 insert 안 함).
  const classIdsForDup = [...new Set(built.map((r) => r.class_id))];
  const { data: existingDup, error: dupErr } = await supabase
    .from("attendance_records")
    .select("class_id, student_id, slot_start")
    .eq("tenant_id", g.tenantId)
    .eq("session_date", input.date)
    .in("class_id", classIdsForDup)
    // 서버측 축소(B2) — 같은 교시 행 + "그날 전체"(slot null) 행만. 전 슬롯을 다 받으면 화이트리스트가
    // 1000행 silent 절단으로 뚫린다(#54). 이 필터면 상한 ≈ 명단 × 2라 절단 불가.
    .or(`slot_start.eq.${slot},slot_start.is.null`);
  // 🔴 확인 실패 = 안 쓴다(B3 — error 삼키고 blind insert하면 이 가드가 정확히 막으려던 중복이 난다).
  if (dupErr) return { error: "기존 기록 확인에 실패해 저장하지 않았습니다 — 다시 시도해 주세요" };
  const taken = new Set(
    (existingDup ?? [])
      .filter((r) => hhmm(r.slot_start) === slot || (!isPayrollSeat(input.seat) && r.slot_start == null))
      .map((r) => `${r.class_id}|${r.student_id}`),
  );
  const rows = built.filter((r) => !taken.has(`${r.class_id}|${r.student_id}`));
  if (rows.length === 0) return { ok: true, changed: 0 };
  const first = await supabase.from("attendance_records").insert(rows);
  const error =
    first.error && /recorded_via/i.test(first.error.message)
      ? (await supabase.from("attendance_records").insert(
          // recorded_via가 필수 키인 객체 리터럴이라 delete가 TS2790 — 구조분해로 그 키만 뺀다(동작 동일).
          rows.map((r) => {
            const { recorded_via, ...rest } = r;
            void recorded_via;
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
    const { data: deleted, error } = await supabase
      .from("attendance_records")
      .delete()
      .eq("tenant_id", p.tenantId)
      .eq("class_id", p.classId)
      .eq("student_id", p.studentId)
      .eq("session_date", p.date)
      .eq("slot_start", p.slot)
      .select("id");
    if (error) return error.message;
    // 🔴 0행 삭제 + 비급여 자리 = 화면이 보여준 것이 **담임의 "그날 전체" 폴백**일 수 있다(queries.ts).
    //    자리 삭제는 그 행을 안 지우므로 조용한 성공(지워도 되살아나는 유령 기록)이 된다 — 정직하게 거절.
    //    담임 기록을 자리 당번이 지우게 두지도 않는다(지우기는 출석부/원스크린에서).
    if ((deleted?.length ?? 0) === 0 && !isPayrollSeat(p.seat)) {
      const { data: dayRows, error: dayErr } = await supabase
        .from("attendance_records")
        .select("id")
        .eq("tenant_id", p.tenantId)
        .eq("class_id", p.classId)
        .eq("student_id", p.studentId)
        .eq("session_date", p.date)
        .is("slot_start", null)
        .limit(1);
      if (dayErr) return dayErr.message;
      if ((dayRows?.length ?? 0) > 0)
        return "담임이 출석부/원스크린에서 찍은 기록입니다 — 미체크로 되돌리려면 그쪽에서 지워주세요";
    }
    return 1;
  }

  if (isPayrollSeat(p.seat)) {
    // 급여 자리(랩실) — 자리 시수는 **별도 축**(seat_label 행, 0208a)이라 담임의 day-level 행을 건드리지
    // 않는다. 종전대로 그 교시의 자리 행만 갱신/삽입한다.
    const { data: rows, error: rowsErr } = await base
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (rowsErr) return rowsErr.message; // 확인 실패 = 안 쓴다(blind insert가 더 위험, B3)
    const existing = rows?.[0]?.id as string | undefined;
    if (existing) {
      const err = await seatUpdate(
        supabase,
        {
          status: p.status,
          seat_label: SEAT_DB_LABEL[p.seat],
          recorded_by: p.userId,
          recorded_at: new Date().toISOString(),
          recorded_via: "seat",
        },
        [existing],
      );
      return err ?? 1;
    }
  } else {
    // 🔴 비급여 자리(JJ실) — 자리 기록이 **담임 출석과 같은 사실**(seat_label 없이 저장 = 담임 시수)이라,
    //    그날 전 행을 보고 **pickSaveTargets 규약 그대로**(② 교시+day 함께 갱신 · ③ day뿐이면 승격) 쓴다.
    //    교시 행만 보면 day-level 행이 남아 같은 사실이 두 행 = 시수·회차 이중 계상(2026-08-17 감사 P1-4),
    //    최신 day 행만 승격하면 옛 정정 day 행이 유효행으로 되살아난다(적대 리뷰 확정).
    const { data: rows, error: rowsErr } = await supabase
      .from("attendance_records")
      .select("id, slot_start, status")
      .eq("tenant_id", p.tenantId)
      .eq("class_id", p.classId)
      .eq("student_id", p.studentId)
      .eq("session_date", p.date)
      .order("recorded_at", { ascending: false })
      .order("id", { ascending: false });
    if (rowsErr) return rowsErr.message; // 확인 실패 = 안 쓴다 — 오판이 중복 행(급여)으로 직결된다
    const { updateIds, promoteIds } = pickSaveTargets(rows ?? [], p.slot);
    const targetSet = new Set([...updateIds, ...promoteIds]);
    // 자리판 3종 밖 상태(조퇴·공결·보강)가 대상에 섞이면 거절 — 축약 되쓰기 금지(bulk-attendance 규칙).
    if ((rows ?? []).some((r) => targetSet.has(r.id as string) && !["present", "absent", "late"].includes(r.status as string))) {
      return "출석부에 조퇴·공결·보강으로 기록된 학생입니다 — 변경은 출석부에서 해주세요";
    }
    if (updateIds.length > 0 || promoteIds.length > 0) {
      const nowIso = new Date().toISOString();
      const basePatch = { status: p.status, recorded_by: p.userId, recorded_at: nowIso, recorded_via: "seat" };
      if (promoteIds.length > 0) {
        const err = await seatUpdate(supabase, { ...basePatch, slot_start: p.slot }, promoteIds);
        if (err) return err;
      }
      if (updateIds.length > 0) {
        const err = await seatUpdate(supabase, basePatch, updateIds);
        if (err) return err;
      }
      return updateIds.length + promoteIds.length;
    }
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
