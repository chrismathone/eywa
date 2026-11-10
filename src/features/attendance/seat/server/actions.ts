"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logSeatAction } from "./audit";
import {
  PIN_NOTE_SEATS,
  SEAT_DB_LABEL,
  SEAT_NOTE_MAXLEN,
  ambiguousClassIds,
  hhmm,
  isPayrollSeat,
  type SeatKey,
} from "../seat";
import { prevAbsentFillTargets, seatDayCells } from "../prev-period";
import { applySeatPlacements } from "../placement";
import { pickSaveTargets } from "../../save-targets";
import { gateSeatWrite, rosterKeys } from "./gate";
import { applySeatDayChoices, getSeatPeriodChoices } from "./period-choice";
import { getPublicSeatDay, getSeatDay } from "./queries";
import { getSeatPlacements } from "./placements";
import { completeMakeupReservations } from "../../server/makeup-reservation-complete";
import { logDbError, explainDbError } from "@/lib/supabase/db-error";

export type SeatStatus = "present" | "absent" | "late";
/** 런타임 검증용 — 자리판이 쓰는 상태 3종(`SeatStatus`와 같은 집합). 타입은 클라가 보낸 값을 막지 못한다. */
const SEAT_WRITE_STATUSES: readonly string[] = ["present", "absent", "late"];
export type SeatResult = { ok: true; changed: number } | { error: string };

/** 0212a(recorded_via) 컬럼이 없으면 빼고 재시도 — 자리 기록을 죽이지 않는다(#95). 성공 = null. */
async function seatUpdate(
  supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  patch: Record<string, unknown>,
  ids: string[],
): Promise<string | null> {
  const first = await supabase.from("attendance_records").update(patch).in("id", ids);
  if (!first.error) return null;
  // 화면엔 한글(원문은 로그) — 호출부가 이 문자열을 그대로 사용자에게 돌려준다(P1-E).
  const why = (e: unknown) => explainDbError(e, { scope: "attendance.seat.actions.seatUpdate", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message;
  if (!/recorded_via/i.test(first.error.message)) return why(first.error);
  const rest = { ...patch };
  delete rest.recorded_via;
  const retry = await supabase.from("attendance_records").update(rest).in("id", ids);
  return retry.error ? why(retry.error) : null;
}

/** 자리 기록 한 칸 저장. `status: null` = 미체크로 되돌리기(그 교시 기록 삭제). */
export async function setSeatCell(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
  classId: string;
  studentId: string;
  status: SeatStatus | null;
  /**
   * 결석·지각 **사유 메모**(원장 2026-09-08 *"jj실 출석부도 결석 누르면 사유 입력할 수 있게 …
   * 다른 출결과 동일하게"*). 서버 계약은 출결 모드와 같다:
   * · `undefined` = 기존 메모 **유지** · `null` = 비움 · 문자열 = 그 값으로.
   * ⚠️ 상태만 바꿀 때 무엇을 비울지는 호출부가 `noteOnStatusChange`로 정한다(사유는 그 상태의 설명이라
   *    결석→출석이면 `여행`이 남으면 안 된다). 여기서 임의로 지우지 않는다.
   */
  note?: string | null;
  /**
   * **사유만 저장**(이미 찍힌 칸에 사유를 덧붙이는 경로) — 참이면 `status`를 **쓰지 않는다**.
   * 🔴 사유를 적는 동안 다른 창이 상태를 고칠 수 있다. 상태를 함께 실으면 그 수정을 되돌린다
   *    (출결 모드가 `noteOnly`를 따로 둔 이유와 같다).
   * ⚠️ 붙일 행이 없으면 **아무것도 만들지 않는다** — 사유만 있는 칸(상태 없는 출결 행)은 만들지 않는다.
   */
  noteOnly?: boolean;
}): Promise<SeatResult> {
  const g = await gateSeatWrite(input.seat, input.date);
  if ("error" in g) return g;

  const slot = hhmm(input.slotStart);
  // 🔴 서버 액션 인자는 클라가 마음대로 보낸다 — 메모는 **문자열·null·undefined만** 받는다. 숫자·배열을 그대로
  //    두면 아래 거절을 비껴가 text 칸에 `"12345"`·`'["병원"]'`로 저장된다(적대적 리뷰 2026-09-10).
  //    앞뒤 공백은 떼고 빈 값은 "비움" — 반 출석부(`noteVal`)와 같은 규약. 비로그인 문도 쓰니 길이 상한을 둔다.
  // 🔴 상태도 **런타임에** 좁힌다 — 자리판 3종 밖(공결·보강)이 비로그인 문으로 자리 시수 행에 들어가면 안 된다
  //    (DB enum엔 `excused`·`makeup`이 있어 그대로 저장된다 — 적대적 리뷰 2026-09-10).
  //    ⚠️ 사유만 저장(`noteOnly`)은 상태를 쓰지 않으므로 검사하지 않는다 — 화면은 그 칸의 현재 상태를 그대로
  //    실어 보내고, 반 출석부가 공결·보강으로 찍은 랩실 칸에도 사유는 적혀야 한다(JJ실은 `writeOne`이 그 칸을
  //    통째로 출석부로 돌려보낸다 — 종전 그대로).
  if (input.noteOnly !== true && input.status !== null && !SEAT_WRITE_STATUSES.includes(input.status)) {
    return { error: "잘못된 상태입니다" };
  }
  if (input.note !== undefined && input.note !== null && typeof input.note !== "string") {
    return { error: "잘못된 특이사항입니다" };
  }
  const note = typeof input.note === "string" ? input.note.trim() : input.note;
  if (typeof note === "string" && note.length > SEAT_NOTE_MAXLEN) {
    return { error: `특이사항은 ${SEAT_NOTE_MAXLEN}자 이내로 적어 주세요` };
  }
  // 🔴 비로그인 PIN 문에서 사유 메모를 쓰는 건 **`PIN_NOTE_SEATS`(랩실)만**이다 — 화면에서만 감추면 우회 폭([[#77]]).
  //    그 밖의 자리(JJ실) PIN은 메모를 조회조차 안 하므로 거기로 적은 메모는 화면엔 영영 안 보이는 유령이 된다.
  //    ⚠️ 상태를 바꾸며 메모를 비우는 것(null·빈 값)은 막지 않는다 — 출결 찍기가 멈춘다.
  if (
    g.via === "pin" &&
    !PIN_NOTE_SEATS.includes(input.seat) &&
    (input.noteOnly === true || (typeof note === "string" && note !== ""))
  ) {
    return { error: "이 자리의 비로그인 화면에서는 특이사항을 적을 수 없습니다 — 로그인 화면에서 적어 주세요" };
  }
  const roster = await rosterKeys(input.seat, input.date, slot, g.via === "pin" ? g.tenantId : null, g.tenantId);
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
    note,
    noteOnly: input.noteOnly === true,
  });
  if (typeof changed === "string") return { error: changed };

  /**
   * 감사로그 — 자리 기록도 출결(=시수·급여 재료)이라 반 출석부와 같은 급으로 남긴다. `via`(menu·duty)까지
   * 담는 이유는 **자리 담당 토글로 들어온 쓰기**가 메뉴 권한 없이 열리는 문이라서다.
   *
   * 🔴 **공개 PIN(`via==="pin"`) 쓰기도 남긴다**(원장 2026-09-10 — 기능 변동은 모두 감사로그) — 행위자는 사람이
   *    없어 `랩실 PIN(비로그인)`으로 적힌다([`logSeatAction`](./audit.ts) → `logActionAs`). 종전엔 `logAction`이
   *    로그인 사용자가 없으면 건너뛰어 PIN 쓰기가 통째로 사각지대였다(실측 최근 90일 440건 중 149건).
   * ⚠️ `changed === 0`(사유만 적으려는데 붙일 행이 그새 사라짐) = 아무것도 안 썼다 → 남기지 않는다.
   */
  const noteOnly = input.noteOnly === true;
  // ⚠️ 사유만 저장인데 `note`가 안 왔으면 `notePatch`가 키를 빼서 **아무것도 안 바뀐다** — 안 남긴다
  //    (남기면 "사유를 비웠다"는 없는 변경을 기록하게 된다).
  if (changed > 0 && !(noteOnly && note === undefined)) {
    await logSeatAction(g, input.seat, {
      action: noteOnly
        ? "seat_attendance_note"
        : input.status === null
          ? "seat_attendance_clear"
          : "seat_attendance_set",
      targetType: "attendance",
      metadata: {
        studentId: input.studentId,
        classId: input.classId,
        date: input.date,
        slotStart: slot,
        seat: input.seat,
        via: g.via,
        // 🔴 사유 **본문은 싣지 않는다**(병원·가정사) — 비웠는지 채웠는지만.
        ...(noteOnly
          ? { cleared: note === null || note === "" }
          : input.status !== null
            ? { status: input.status, rows: changed }
            : { rows: changed }),
      },
    });
  }

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
  // 🔴 런타임에 좁힌다(`setSeatCell`과 같은 이유) — 일괄은 출석·결석 둘뿐이다.
  if (input.status !== "present" && input.status !== "absent") return { error: "잘못된 상태입니다" };
  const g = await gateSeatWrite(input.seat, input.date);
  if ("error" in g) return g;

  const slot = hhmm(input.slotStart);
  const roster = await rosterKeys(input.seat, input.date, slot, g.via === "pin" ? g.tenantId : null, g.tenantId);
  if (!roster) return { error: "그 시각에는 이 자리 수업이 없습니다" };

  if (input.classId && !roster.classes.has(input.classId)) return { error: "이 교시에 없는 반입니다" };

  /**
   * "이 반 출석"은 **화면이 보여 준 그 묶음**을 채운다 — 자리 배치(드래그)로 옮겨 온 학생은 그 묶음에
   * 서 있고, 옮겨 나간 학생은 거기 없다(원장 2026-09-10 배치 도입).
   *
   * 🔴 배치를 안 보면 버튼이 **화면과 다른 집합**을 채운다: 손님은 안 찍히는데 `남은 N명`은 그대로라
   *    "눌렀는데 안 된다"가 된다. 반대로 옮겨 나간 학생은 화면에 없는데 조용히 찍힌다.
   * 🔴 **저장은 여전히 학생마다 원래 반(수강 반)으로** 나간다 — `byClass`의 키는 화면 묶음이 아니라
   *    `roster.classes`의 반 id 그대로다(배치는 출결 귀속을 바꾸지 않는다).
   * ⚠️ 교시 전체 일괄(`classId` 없음)은 배치와 무관하다 — 어차피 그 교시 전원이라 집합이 같다.
   */
  const sectionOf = input.classId
    ? new Map(
        applySeatPlacements(
          roster.rosters,
          (await getSeatPlacements(g.tenantId, input.seat, input.date, slot)).rows,
        ).applied.map((p) => [p.studentId, p.toClassId]),
      )
    : null;
  const targets: (readonly [string, string[]])[] = input.classId
    ? (() => {
        const byHome = new Map<string, string[]>();
        for (const [homeClassId, studentIds] of roster.classes) {
          for (const id of studentIds) {
            if ((sectionOf?.get(id) ?? homeClassId) !== input.classId) continue;
            byHome.set(homeClassId, [...(byHome.get(homeClassId) ?? []), id]);
          }
        }
        return [...byHome.entries()];
      })()
    : [...roster.classes.entries()];

  const supabase = g.via === "pin" ? createAdminClient() : await createClient();
  const filled = await insertSeatFill(supabase, {
    tenantId: g.tenantId,
    userId: g.userId,
    seat: input.seat,
    date: input.date,
    slot,
    status: input.status,
    byClass: new Map(targets),
  });
  if ("error" in filled) return filled;
  const { rows, skipped } = filled;
  if (rows.length === 0) return { ok: true, changed: 0 };

  /**
   * 감사로그 — 일괄은 **한 줄로 요약**(반 출석부 일괄과 같은 규약). 되짚을 식별자로 실제로 쓴 칸의
   * `studentIds`·`classIds`를 담는다. 🔴 공개 PIN 갈래도 같은 헬퍼(`logSeatAction`)로 남는다.
   * ⚠️ 이미 찍힌 칸을 걸러 0건이 된 요청은 위에서 조기 반환이라 여기 오지 않는다(빈 로그 없음).
   */
  const wroteClassIds = [...new Set(rows.map((r) => r.class_id))];
  await logSeatAction(g, input.seat, {
    action: "seat_attendance_fill",
    targetType: "attendance",
    metadata: {
      ...(wroteClassIds.length === 1 ? { classId: wroteClassIds[0] } : {}),
      classIds: wroteClassIds,
      date: input.date,
      slotStart: slot,
      seat: input.seat,
      status: input.status,
      count: rows.length,
      skipped,
      studentIds: [...new Set(rows.map((r) => r.student_id))],
      via: g.via,
    },
  });

  revalidatePath("/attendance/seat");
  revalidatePath("/attendance");
  revalidatePath("/seat");
  return { ok: true, changed: rows.length };
}

/**
 * 일괄 — **앞 교시에 결석이던 학생**의 아직 빈 칸만 결석으로 채운다.
 *
 * 원장 2026-09-10: *"이 학생이 이전수업에 결석이였으면 자동 결석체크할 수 있도록"*.
 * 🔴🔴 **자동이 아니라 버튼 한 번**이다 — 화면을 열기만 해서는 한 칸도 안 쓴다(셔틀 "신호만, 자동
 *    쓰기 없음"·재고 "제안만"과 같은 결). 출결은 시수→급여와 학부모 결석 알림에 닿아, 조용히 찍히면
 *    되돌릴 방법이 없다.
 * 🔴 **대상은 서버가 다시 계산한다** — 화면이 보낸 목록을 믿으면 그새 출석으로 고친 칸을 덮는다([[#77]]).
 *    빈 칸만 채우는 비파괴 규약은 `fillSeatSlot`과 **같은 함수**(`insertSeatFill`)가 지킨다.
 */
export async function fillSeatPrevAbsent(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
}): Promise<SeatResult> {
  const g = await gateSeatWrite(input.seat, input.date);
  if ("error" in g) return g;

  const slot = hhmm(input.slotStart);
  // 하루치를 한 번만 읽는다 — 앞 교시 판정에 그 날 전 교시 명단·상태가 필요하다(rosterKeys는 한 교시뿐).
  const [day, choiceLoad] = await Promise.all([
    g.via === "pin"
      ? getPublicSeatDay(g.tenantId, input.seat, input.date)
      : getSeatDay(input.seat, input.date),
    getSeatPeriodChoices(g.tenantId, input.seat, input.date),
  ]);
  const period = day.periods.find((p) => p.start === slot);
  if (!period) return { error: "그 시각에는 이 자리 수업이 없습니다" };

  // 같은 반·같은 시작·다른 종료(저장키로 구분 불가)는 `rosterKeys`와 **같은 규약**으로 제외한다.
  // 🔑 화면(표식·버튼 수)도 **같은 인자**로 같은 함수를 돌린다 — 갈리면 "3명"이라 적고 2명만 쓴다.
  // 🔴 교시 선택(0255a)을 얹은 명단으로 센다 — 안 얹으면 다른 교시에 서 있는 학생까지 결석으로
  //    채운다(화면의 "앞 교시 결석자 N명"과 갈린다).
  //    다른 시간에서 옮겨 온 학생은 목표 교시에 서므로 "그 학생의 앞 교시"도 옮긴 뒤의 명단으로 잰다.
  const rosterByPeriod = applySeatDayChoices(day, choiceLoad, input.date);
  const targets = prevAbsentFillTargets(
    seatDayCells(day.periods, rosterByPeriod),
    slot,
    ambiguousClassIds(period),
  );
  if (targets.length === 0) return { ok: true, changed: 0 };

  const byClass = new Map<string, string[]>();
  for (const t of targets) byClass.set(t.classId, [...(byClass.get(t.classId) ?? []), t.studentId]);
  /** 칸 → 근거(앞 교시). 감사로그가 **실제로 쓴 행**의 근거만 적는다(건너뛴 칸은 안 적는다). */
  const prevByCell = new Map(targets.map((t) => [`${t.classId}|${t.studentId}`, t.prevStart]));

  const supabase = g.via === "pin" ? createAdminClient() : await createClient();
  const filled = await insertSeatFill(supabase, {
    tenantId: g.tenantId,
    userId: g.userId,
    seat: input.seat,
    date: input.date,
    slot,
    status: "absent",
    byClass,
  });
  if ("error" in filled) return filled;
  const { rows, skipped } = filled;
  if (rows.length === 0) return { ok: true, changed: 0 };

  /**
   * 감사로그 — 일괄과 같은 모양에 **근거(앞 교시)**를 더한다. 공개 PIN 갈래도 같은 헬퍼로 남는다.
   * 🔴 `prevStarts`가 이 로그의 핵심이다 — 이 액션은 "앞 교시가 결석이었으니 이 교시도"라는 **추론**이라,
   *    근거 교시를 안 적으면 나중에 그 앞 교시 기록이 고쳐졌을 때 왜 찍혔는지 되짚을 길이 사라진다.
   */
  const prevClassIds = [...new Set(rows.map((r) => r.class_id))];
  const prevStarts = [
    ...new Set(rows.map((r) => prevByCell.get(`${r.class_id}|${r.student_id}`)).filter(Boolean)),
  ].sort();
  await logSeatAction(g, input.seat, {
    action: "seat_attendance_fill_prev",
    targetType: "attendance",
    metadata: {
      ...(prevClassIds.length === 1 ? { classId: prevClassIds[0] } : {}),
      classIds: prevClassIds,
      date: input.date,
      slotStart: slot,
      seat: input.seat,
      status: "absent",
      // 근거 = 이 칸들을 결석으로 제안한 **앞 교시**(대개 하나, 학생마다 다를 수 있어 배열).
      prevStarts,
      count: rows.length,
      skipped,
      studentIds: [...new Set(rows.map((r) => r.student_id))],
      via: g.via,
    },
  });

  revalidatePath("/attendance/seat");
  revalidatePath("/attendance");
  revalidatePath("/seat");
  return { ok: true, changed: rows.length };
}

/** 일괄이 만드는 행의 재료(반·학생만 다르다). */
type SeatFillBase = {
  tenantId: string;
  userId: string | null;
  seat: SeatKey;
  date: string;
  slot: string;
  status: Extract<SeatStatus, "present" | "absent">;
};

/**
 * 일괄이 만드는 행 한 줄 — **타입도 이 함수에서 뽑는다**(`ReturnType`).
 * 🔴 `seat_label: string | null`을 타입으로 따로 적으면 자리 축 가드(`seat-axes.test.ts`)가 그 줄을
 *    "출처 모를 값"으로 잡는다 — 실제로 잡혔다. 라벨이 나오는 자리는 코드 한 줄이어야 한다.
 */
function seatFillRow(p: SeatFillBase, classId: string, studentId: string) {
  return {
    tenant_id: p.tenantId,
    class_id: classId,
    student_id: studentId,
    session_date: p.date,
    slot_start: p.slot,
    status: p.status,
    seat_label: isPayrollSeat(p.seat) ? SEAT_DB_LABEL[p.seat] : null,
    recorded_by: p.userId,
    recorded_via: "seat",
  };
}
type SeatFillRow = ReturnType<typeof seatFillRow>;

/**
 * 두 일괄(교시 전체 · 앞 교시 결석자)이 공유하는 **비파괴 쓰기** — 빈 칸에만 행을 만든다.
 *
 * 🔴 한 벌로 두는 이유: 이 함수 안의 중복 방지(아래)가 자리 출결의 이중 계상을 막는 유일한 곳이다.
 *    일괄을 하나 더 만들면서 이 규약을 복붙하면 한쪽만 고쳐진다.
 * 반환 = 실제로 쓴 행 + 건너뛴 칸 수(감사로그가 그대로 담는다).
 */
async function insertSeatFill(
  supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  p: SeatFillBase & {
    /** 반 → 학생 id. 호출부가 '미체크로 보이는 칸'만 담아 넘기고, 여기서 한 번 더 확인한다. */
    byClass: ReadonlyMap<string, readonly string[]>;
  },
): Promise<{ error: string } | { rows: SeatFillRow[]; skipped: number }> {
  const built: SeatFillRow[] = [...p.byClass.entries()].flatMap(([classId, studentIds]) =>
    studentIds.map((studentId) => seatFillRow(p, classId, studentId)),
  );
  if (built.length === 0) return { rows: [], skipped: 0 };

  // 🔴 중복 행 방지 재확인(2026-08-17 감사 P1-4) — 명단의 '미체크'는 화면 스냅샷이라, 그 사이 생긴
  //    기록(같은 교시 행·비급여 자리의 "그날 전체" 행)이 있으면 그 칸은 건너뛴다. 특히 비급여 자리(JJ)의
  //    day-level 행은 담임 시수와 같은 축이라 blind insert가 시수·회차를 이중 계상한다(writeOne 주석 참조).
  //    자리판 3종 밖 day-level 상태(조퇴 등)도 여기서 자연히 보호된다(그 칸에 insert 안 함).
  const classIdsForDup = [...new Set(built.map((r) => r.class_id))];
  const { data: existingDup, error: dupErr } = await supabase
    .from("attendance_records")
    .select("class_id, student_id, slot_start")
    .eq("tenant_id", p.tenantId)
    .eq("session_date", p.date)
    .in("class_id", classIdsForDup)
    // 서버측 축소(B2) — 같은 교시 행 + "그날 전체"(slot null) 행만. 전 슬롯을 다 받으면 화이트리스트가
    // 1000행 silent 절단으로 뚫린다(#54). 이 필터면 상한 ≈ 명단 × 2라 절단 불가.
    .or(`slot_start.eq.${p.slot},slot_start.is.null`);
  // 🔴 확인 실패 = 안 쓴다(B3 — error 삼키고 blind insert하면 이 가드가 정확히 막으려던 중복이 난다).
  if (dupErr) {
    logDbError(dupErr, "attendance.seat.insertSeatFill");
    return { error: "기존 기록 확인에 실패해 저장하지 않았습니다 — 다시 시도해 주세요" };
  }
  const taken = new Set(
    (existingDup ?? [])
      .filter((r) => hhmm(r.slot_start) === p.slot || (!isPayrollSeat(p.seat) && r.slot_start == null))
      .map((r) => `${r.class_id}|${r.student_id}`),
  );
  const rows = built.filter((r) => !taken.has(`${r.class_id}|${r.student_id}`));
  if (rows.length === 0) return { rows: [], skipped: built.length };

  const first = await supabase.from("attendance_records").insert(rows);
  const error =
    first.error && /recorded_via/i.test(first.error.message)
      ? (
          await supabase.from("attendance_records").insert(
            // recorded_via가 필수 키인 객체 리터럴이라 delete가 TS2790 — 구조분해로 그 키만 뺀다(동작 동일).
            rows.map((r) => {
              const { recorded_via, ...rest } = r;
              void recorded_via;
              return rest;
            }),
          )
        ).error
      : first.error;
  if (error) return { error: explainDbError(error, { scope: "attendance.seat.actions.insertSeatFill", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  // 보강 예약 이행(0264a) — 자리에서 찍은 칸도 그 (학생·반·날짜)의 예약을 다시 판정한다(fail-soft).
  await completeMakeupReservations(
    { tenantId: p.tenantId, observeOnly: true },
    rows.map((r) => ({ studentId: r.student_id, classId: r.class_id, date: p.date, status: (r as { status?: string | null }).status ?? null, created: true })),
  );
  return { rows, skipped: built.length - rows.length };
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
/**
 * 메모 패치 조각 — `undefined`면 **키 자체를 안 넣는다**(기존 메모 유지).
 * 🔴 `{ note: undefined }`를 그대로 넘기면 PostgREST가 그 컬럼을 지우거나(insert) 실어 보내니,
 *    스프레드로 **키를 없애야** "건드리지 않는다"가 성립한다.
 */
function notePatch(note: string | null | undefined): { note?: string | null } {
  return note === undefined ? {} : { note: note === "" ? null : note };
}

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
    /** `undefined`면 기존 메모를 건드리지 않는다(출결 모드 서버 계약과 같다). */
    note?: string | null;
    /** 참이면 `status`를 무시하고 메모만 갱신한다(붙일 행이 없으면 아무것도 안 한다). */
    noteOnly?: boolean;
  },
): Promise<number | string> {
  // 사유만 저장인데 메모가 안 왔다 = 고칠 것이 없다(빈 update를 보내지 않는다).
  if (p.noteOnly && p.note === undefined) return 0;
  const base = supabase
    .from("attendance_records")
    .select("id, recorded_at")
    .eq("tenant_id", p.tenantId)
    .eq("class_id", p.classId)
    .eq("student_id", p.studentId)
    .eq("session_date", p.date)
    .eq("slot_start", p.slot);

  if (p.status === null && !p.noteOnly) {
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
    // 🔴 **실제로 지운 행 수**를 돌려준다(종전엔 0행이어도 1) — 감사로그가 "지웠다"고 말하려면 정말
    //    지웠어야 한다(그새 다른 창이 먼저 지운 칸이면 0 = 로그 없음). 소비처가 없어 계약 변화는 없다.
    return deleted?.length ?? 0;
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
        // 🔴 사유만이면 **메모만** 고친다 — 반 출석부 `noteOnly`와 같은 규약(적대적 리뷰 2026-09-10).
        //    `recorded_by`·`recorded_at`은 "누가 출결을 찍었나"라 메모로 덮으면 사실이 바뀌고(PIN이면 null로
        //    지워진다), `seat_label`을 얹으면 반 출석부 기록이 메모 한 줄에 자리 기록으로 둔갑한다.
        p.noteOnly
          ? notePatch(p.note)
          : {
              status: p.status,
              seat_label: SEAT_DB_LABEL[p.seat],
              recorded_by: p.userId,
              recorded_at: new Date().toISOString(),
              recorded_via: "seat",
              ...notePatch(p.note),
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
      // 🔴 사유만이면 메모만(위 급여 갈래와 같은 규약 — "누가 찍었나"를 메모로 덮지 않는다).
      const basePatch = p.noteOnly
        ? notePatch(p.note)
        : {
            status: p.status,
            recorded_by: p.userId,
            recorded_at: nowIso,
            recorded_via: "seat",
            ...notePatch(p.note),
          };
      // 🔴 사유만이면 **이 교시 행에만** 단다 — 날 단위 행(담임이 그날 전체로 찍은 것)만 있으면 거절한다.
      //    교시가 둘 이상인 반은 그 행을 자리 화면에 안 그려(카드는 미체크) 보지도 못한 담임 메모를 덮어쓰게 되고,
      //    조용히 건너뛰면 "저장됨"·감사로그만 남는다(적대적 리뷰 2026-09-10). 지우기 갈래의 날 단위 거절과 같은 규약이다.
      if (p.noteOnly) {
        if (updateIds.length === 0) {
          return "담임이 출석부/원스크린에서 그날 전체로 찍은 기록입니다 — 사유는 그쪽에서 고쳐 주세요";
        }
        const err = await seatUpdate(supabase, basePatch, updateIds);
        return err ?? updateIds.length;
      }
      // 🔴 승격(day-level 행을 이 교시로 옮기기)은 **상태 쓰기의 부수효과**다(사유만이면 위에서 끝났다) — 사유만
      //    적는데 교시를 옮기면 다른 교시 칸이 미체크로 뒤집힌다.
      if (promoteIds.length > 0) {
        const err = await seatUpdate(supabase, { ...basePatch, slot_start: p.slot }, promoteIds);
        if (err) return err;
      }
      if (updateIds.length > 0) {
        const err = await seatUpdate(supabase, basePatch, updateIds);
        if (err) return err;
      }
      // 보강 예약 이행·되돌림(0264a) — 자리 칸의 상태 변경도 그 (학생·반·날짜)의 예약을 다시 판정한다(fail-soft).
      await completeMakeupReservations({ tenantId: p.tenantId, observeOnly: true }, [{ studentId: p.studentId, classId: p.classId, date: p.date, status: p.status }]);
      return updateIds.length + promoteIds.length;
    }
  }

  // 사유만 적는 요청인데 붙일 행이 없다 = 그새 누가 지웠다. 상태 없는 행을 만들지 않고 조용히 끝낸다.
  if (p.noteOnly) return 0;

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
    ...notePatch(p.note),
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
          // `note`는 옛 컬럼이라 이 폴백(= recorded_via가 없는 스키마)에서도 그대로 실어 보낸다 —
          // 빼면 사유가 조용히 사라진다.
          ...notePatch(p.note),
        })).error
      : first.error;
  if (error) return error.message;
  // 보강 예약 이행(0264a) — 자리에서 새로 찍은 칸(fail-soft).
  await completeMakeupReservations({ tenantId: p.tenantId, observeOnly: true }, [{ studentId: p.studentId, classId: p.classId, date: p.date, status: p.status, created: true }]);
  return 1;
}
