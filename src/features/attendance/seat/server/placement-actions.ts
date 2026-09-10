"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { ambiguousClassIds, hhmm, type SeatKey } from "../seat";
import {
  applySeatPlacements,
  seatResetTargets,
  validateSeatMove,
  type SeatPlacement,
} from "../placement";
import { gateSeatMoveWrite } from "./move-gate";
import { getSeatDay } from "./queries";
import { getSeatPlacements } from "./placements";
import { applySeatDayChoices, getSeatPeriodChoices } from "./period-choice";

export type SeatPlacementResult = { ok: true; changed: number } | { error: string };

/**
 * 자리 **배치**(드래그로 옮긴 자리) 쓰기 — 0254a `seat_placements`.
 *
 * 🔴🔴 **출결을 쓰지 않는다.** 이 파일은 `attendance_records`에 insert·update·delete를 한 번도 하지 않는다
 *    (자리 배치는 "카드가 어느 묶음에 놓였나"이고, 출결 귀속은 언제나 학생의 수강 반이다 —
 *    `placement.ts` 머리 주석). 원장 *"클릭으로 출결되는거랑 중복액션되지않게 잘 분리해서"*의 데이터 층
 *    구현이 이것이다: 축이 아예 다른 표라 두 동작이 서로를 덮을 수 없다.
 * 🔴 **비로그인 공개 PIN(`/seat/:key`)에서는 쓰지 않는다** — 원장이 같은 문장에서 *"이것도 감사로그에
 *    남아야함"*을 못박았는데, 그 화면엔 로그인이 없어 `logAction`이 실행자를 못 읽는다(자리 출결의
 *    무기명 갈래가 이미 감사 사각지대다 — `actions.ts` 주석, 실측 최근 90일 440건 중 149건). **남길 수
 *    없는 동작은 열지 않는다.** 공개 화면은 배치를 **보기만** 한다.
 * ⚠️ 출결 상태를 **읽기는** 한다 — 원장 2026-09-10 *"출결이 찍힌 학생은 드래그 절대 불가"*. 읽는 값은
 *    이미 `getSeatDay`가 명단에 얹어 둔 `status`라 새 왕복이 없고, 판정 문장은 순수 소스
 *    [`seatMoveBlockReason`](../placement.ts) 하나다(화면 비활성과 서버 거절이 같은 말을 한다).
 * 🔴 **게이트는 출결과 같은 문**(`gateSeatWrite`) — 옮길 수 있는 사람과 찍을 수 있는 사람이 갈리면
 *    당번이 자리를 못 고친다. 초기화도 **같은 게이트**라 옮긴 사람은 되돌릴 수 있다.
 */

/**
 * 그 교시 명단(반 묶음) — 배치 판정의 재료. 모호한 반(같은 반·같은 시작·다른 종료)은 뺀다.
 *
 * ⚠️ `status`를 함께 싣는다 — 원장 2026-09-10 *"출결이 찍힌 학생은 드래그 절대 불가"*의 서버 쪽 판정
 *    재료다. **새 조회가 아니다**(`getSeatDay`가 이미 그날 출결을 받아 명단에 얹어 둔 값이다).
 */
async function periodRosters(
  tenantId: string,
  seat: SeatKey,
  date: string,
  slot: string,
): Promise<{ classId: string; students: { id: string; status: string | null }[] }[] | null> {
  // 🔴 **교시 선택(0255a)을 얹은 명단**이어야 화면과 같다 — 다른 시간에서 옮겨 온 학생은 목표 교시에
  //    서 있어서, 거기서 옆 반 묶음으로 옮기는(배치) 것도 된다. 안 얹으면 "이 교시 명단에 없는 학생"으로
  //    거절되고, 반대로 다른 교시로 간 학생을 원래 교시에서 옮기는 것이 통과한다. 둘은 독립이라 병렬(B4).
  const [day, choiceLoad] = await Promise.all([
    getSeatDay(seat, date),
    getSeatPeriodChoices(tenantId, seat, date),
  ]);
  const period = day.periods.find((p) => p.start === slot);
  if (!period) return null;
  const blocked = new Set(ambiguousClassIds(period));
  return (applySeatDayChoices(day, choiceLoad, date)[period.start] ?? [])
    .filter((r) => !blocked.has(r.classId))
    .map((r) => ({
      classId: r.classId,
      students: r.students.map((s) => ({ id: s.id, status: s.status })),
    }));
}

function revalidateSeat(): void {
  revalidatePath("/attendance/seat");
  revalidatePath("/seat");
}

/**
 * 학생 카드 한 장을 다른 반 묶음으로 옮긴다(드래그 한 번).
 *
 * 🔴 화면은 **자리·날짜·교시·학생·놓은 반**만 보낸다 — 원래 반은 서버가 그 교시 명단에서 다시 읽는다
 *    ([[#77]]: 화면이 보낸 값을 믿으면 그새 바뀐 수강을 덮는다).
 * 🔑 제 반으로 도로 끌면 **그 학생만 초기화**(줄 삭제)다 — 같은 동작의 자연스러운 반대라 버튼을 따로
 *    만들지 않는다.
 */
export async function moveSeatStudent(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
  studentId: string;
  toClassId: string;
}): Promise<SeatPlacementResult> {
  const g = await gateSeatMoveWrite(input.seat, input.date);
  if ("error" in g) return g;

  const slot = hhmm(input.slotStart);
  const rosters = await periodRosters(g.tenantId, input.seat, input.date, slot);
  if (!rosters) return { error: "그 시각에는 이 자리 수업이 없습니다" };

  const check = validateSeatMove(rosters, { studentId: input.studentId, toClassId: input.toClassId });
  if ("error" in check) return check;

  const supabase = createAdminClient();
  const where = {
    tenant_id: g.tenantId,
    seat: input.seat,
    session_date: input.date,
    slot_start: slot,
    student_id: input.studentId,
  };

  if (check.isReset) {
    const { data: gone, error } = await supabase
      .from("seat_placements")
      .delete()
      .match(where)
      .select("from_class_id, to_class_id");
    if (error) return { error: placementError(error) };
    const removed = gone ?? [];
    if (removed.length === 0) return { ok: true, changed: 0 }; // 원래 자리에 있던 학생 = 아무 일도 아니다
    await logAction({
      action: "seat_placement_reset",
      targetType: "attendance",
      metadata: {
        scope: "student",
        seat: input.seat,
        date: input.date,
        slotStart: slot,
        count: removed.length,
        moves: removed.map((r) => ({
          studentId: input.studentId,
          fromClassId: r.from_class_id as string,
          toClassId: r.to_class_id as string,
        })),
        via: g.via,
      },
    });
    revalidateSeat();
    return { ok: true, changed: removed.length };
  }

  const { error } = await supabase.from("seat_placements").upsert(
    {
      ...where,
      from_class_id: check.fromClassId,
      to_class_id: input.toClassId,
      moved_by: g.userId,
      updated_at: new Date().toISOString(),
    },
    // 🔴 술어 없는 일반 유니크라 추론이 된다([[#113]]) — 부분 유니크였다면 여기서 전건 42P10이다.
    { onConflict: "tenant_id,seat,session_date,slot_start,student_id" },
  );
  if (error) return { error: placementError(error) };

  await logAction({
    action: "seat_placement_move",
    targetType: "attendance",
    metadata: {
      studentId: input.studentId,
      // 감사로그의 축을 초기화(`moves`)와 **같은 모양**으로 맞춘다 — 나중에 짝지어 읽으려면 필요하다.
      moves: [{ studentId: input.studentId, fromClassId: check.fromClassId, toClassId: input.toClassId }],
      fromClassId: check.fromClassId,
      toClassId: input.toClassId,
      seat: input.seat,
      date: input.date,
      slotStart: slot,
      via: g.via,
    },
  });
  revalidateSeat();
  return { ok: true, changed: 1 };
}

/**
 * 초기화 — 드래그로 옮긴 것을 **원래 반**(수강·시간표가 정한 반)으로 되돌린다.
 *
 * 🔴 **한 액션·범위(scope)만 다르다**(원장 *"반별 '초기화' 단체 '초기화'"*) — `classId`가 있으면 그
 *    묶음으로 옮겨 온 학생만, 없으면 그 교시 전체. 두 벌로 만들면 언젠가 한쪽만 고쳐진다.
 * 🔴 **대상은 서버가 다시 계산한다**([[#77]]) — 화면은 자리·날짜·교시(·반)만 보낸다.
 * 🔴 **출결은 한 줄도 안 건드린다** — 이미 찍힌 출석·결석·지각은 원래 반에 그대로 남아 있고(애초에
 *    거기 저장됐다), 되돌아간 카드가 그 기록을 그대로 들고 간다.
 * 🔴 **되돌리는 것이지 빼는 것이 아니다** — 줄을 지우면 명단이 원래 반으로 다시 그린다(원래 반은
 *    그 교시 명단이 언제나 알려 준다). "이 반에서 제거"라는 상태 자체가 없다.
 */
export async function resetSeatPlacements(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
  /** 없으면 그 교시 전체(단체 초기화). */
  classId?: string;
}): Promise<SeatPlacementResult> {
  const g = await gateSeatMoveWrite(input.seat, input.date);
  if ("error" in g) return g;

  const slot = hhmm(input.slotStart);
  const rosters = await periodRosters(g.tenantId, input.seat, input.date, slot);
  if (!rosters) return { error: "그 시각에는 이 자리 수업이 없습니다" };

  const load = await getSeatPlacements(g.tenantId, input.seat, input.date, slot);
  if (!load.ready) return { error: load.reason ?? "자리 배치를 불러오지 못했습니다" };

  // 🔑 화면이 세는 것과 **같은 함수**로 대상을 고른다 — 반영 안 된 줄(stale)은 버튼 수에도, 여기에도
  //    안 들어간다(갈리면 "3명"이라 적고 2명만 되돌린다).
  const { applied } = applySeatPlacements(rosters, load.rows);
  const targets: SeatPlacement[] = seatResetTargets(applied, input.classId);
  if (targets.length === 0) return { ok: true, changed: 0 };

  const { data: gone, error } = await createAdminClient()
    .from("seat_placements")
    .delete()
    .eq("tenant_id", g.tenantId)
    .eq("seat", input.seat)
    .eq("session_date", input.date)
    .eq("slot_start", slot)
    .in(
      "student_id",
      targets.map((t) => t.studentId),
    )
    .select("student_id");
  if (error) return { error: placementError(error) };
  const removed = (gone ?? []).length;
  if (removed === 0) return { ok: true, changed: 0 };

  await logAction({
    action: "seat_placement_reset",
    targetType: "attendance",
    metadata: {
      scope: input.classId ? "class" : "period",
      ...(input.classId ? { classId: input.classId } : {}),
      seat: input.seat,
      date: input.date,
      slotStart: slot,
      count: removed,
      // 🔴 어느 학생이 어느 반에서 어느 반으로 **되돌아갔는지** — 드래그 로그와 같은 축이라 짝지어 읽힌다.
      moves: targets.map((t) => ({
        studentId: t.studentId,
        fromClassId: t.toClassId,
        toClassId: t.fromClassId,
      })),
      via: g.via,
    },
  });
  revalidateSeat();
  return { ok: true, changed: removed };
}

/** 저장 실패 문구 — 표가 없는 것(SQL 미적용)과 그냥 실패를 가른다(원인을 단정하지 않는다). */
function placementError(err: { code?: string; message?: string }): string {
  if (err.code === "42P01" || err.code === "PGRST205" || /seat_placements/i.test(err.message ?? "")) {
    return "자리 배치 기능이 아직 켜지지 않았습니다 — 관리자에게 문의하세요(0254a 미적용).";
  }
  return "자리 이동을 저장하지 못했습니다 — 다시 시도해 주세요";
}
