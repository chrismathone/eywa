import { isMissingRelation } from "@/lib/supabase/db-error";
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOW_KEYS } from "@/features/attendance/calendar";
import { hhmm, MOVABLE_SEATS, type SeatKey } from "../seat";
import {
  applySeatPeriodChoicesByPeriod,
  blankSeatCell,
  resolveSeatPeriodChoices,
  type SeatPeriodMove,
  type SeatPeriodPin,
} from "../period-choice";
import type { SeatClassRoster, SeatDay } from "./queries";

/**
 * 자리 **교시 선택** 조회 — 0255a `seat_period_moves`/`seat_period_pins`.
 *
 * 🔴 **admin 클라이언트 + 명시 `tenant_id` 필터**로만 읽는다 — 두 표는 RLS 정책이 0개라 세션
 *    클라이언트로 읽으면 **에러 없이 0행**이 온다([[#104]]).
 * 🔴 **fail-soft**([[#95]]) — 0255a가 아직 안 돌았어도 이 화면은 매일 도는 자리 출석부다. 표가 없으면
 *    선택 0줄(= 지금까지의 화면 그대로, 전원이 두 교시 모두에 선다)로 떨어지고 교시 이동·고정만 잠긴다.
 * 🔑 **왕복은 하루에 두 번**(하루짜리 1 + 고정 1)이고 교시 수와 무관하다 — '전체' 보기가 교시마다
 *    조회를 늘리지 않게(B6: 창마다 그 비용이 곱해진다).
 */
export type SeatPeriodChoiceLoad = {
  moves: SeatPeriodMove[];
  pins: SeatPeriodPin[];
  /** 교시 이동·고정을 쓸 수 있나 — false면 잠그고 배너가 사실을 말한다. */
  ready: boolean;
  /** 왜 못 쓰는가(한글). 표가 없는 것과 그냥 실패한 것은 다른 문구다. */
  reason: string | null;
};

/** "YYYY-MM-DD" → 시간표와 같은 요일 키. 날짜 문자열만 다룬다(로컬 파싱은 하루를 민다). */
export function seatDowKey(date: string): string {
  return DOW_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
}

/** 표가 아직 없다(SQL 미적용)와 그냥 실패를 가른다 — 원인을 단정하지 않기 위해서다. */
function missingTable(err: { code?: string; message?: string }): boolean {
  return isMissingRelation(err, ["seat_period_moves", "seat_period_pins"]); // 이름 + 없음 코드(공용 판정, P1-E)
}

const NOT_READY = "자리 교시 선택 기능이 아직 켜지지 않았습니다 — 관리자에게 문의하세요(0255a 미적용).";
const FAILED = "자리 교시 선택을 불러오지 못했습니다 — 교시 이동·고정만 잠시 잠깁니다.";

export async function getSeatPeriodChoices(
  tenantId: string,
  seat: SeatKey,
  date: string,
): Promise<SeatPeriodChoiceLoad> {
  // 🔑 교시 선택을 쓰는 자리(랩실)가 아니면 **왕복 자체를 하지 않는다** — 이 조회는 자리 출결을
  //    한 번 찍을 때마다도 돌고(`rosterKeys`), 창마다 그 비용이 곱해진다(B6). 결과는 빈 선택 =
  //    지금까지와 글자 그대로 같은 화면이라 `ready`는 참이다(잠글 것이 없으니 배너도 없다).
  if (!MOVABLE_SEATS.includes(seat)) return { moves: [], pins: [], ready: true, reason: null };
  const supabase = createAdminClient();
  const dow = seatDowKey(date);
  // 서로 독립이라 병렬(B4). 둘 다 하루/한 요일치라 수십 줄이고 절단 걱정이 없다.
  const [moveRes, pinRes] = await Promise.all([
    supabase
      .from("seat_period_moves")
      .select("class_id, student_id, slot_start")
      .eq("tenant_id", tenantId)
      .eq("seat", seat)
      .eq("session_date", date),
    supabase
      .from("seat_period_pins")
      .select("class_id, student_id, slot_start, effective_from")
      .eq("tenant_id", tenantId)
      .eq("seat", seat)
      .eq("day_of_week", dow),
  ]);

  const err = moveRes.error ?? pinRes.error;
  if (err) {
    return { moves: [], pins: [], ready: false, reason: missingTable(err) ? NOT_READY : FAILED };
  }
  return {
    moves: (moveRes.data ?? []).map((r) => ({
      classId: r.class_id as string,
      studentId: r.student_id as string,
      slotStart: hhmm(r.slot_start as string),
    })),
    pins: (pinRes.data ?? []).map((r) => ({
      classId: r.class_id as string,
      studentId: r.student_id as string,
      slotStart: hhmm(r.slot_start as string),
      effectiveFrom: r.effective_from as string,
    })),
    ready: true,
    reason: null,
  };
}

/**
 * 그 날 명단에 **교시 선택을 얹은 결과**(감추기 + 다른 시간에서 옮겨 온 학생 세우기) — 서버 쪽 **한 벌**.
 *
 * 소비처: 출결 게이트(`rosterKeys`) · 앞 교시 결석 일괄 · 교시 이동 · 배치 · 교시 하나 보기 화면.
 * '전체' 보기만 낙관 반영 때문에 클라가 같은 순수 함수([`applySeatPeriodChoicesByPeriod`])를 직접 부른다.
 * 🔴 **재료를 여기서만 모은다** — 호출부마다 인자를 손으로 적으면 한 곳만 `offSlotByCell`을 빠뜨려 그 경로만
 *    "옮겨 가서 찍힌 학생"을 원래 교시에 되살린다(화면과 서버 명단이 갈린다).
 */
export function applySeatDayChoices(
  day: Pick<
    SeatDay,
    "rosterByPeriod" | "slotsByClass" | "markedSlotsByCell" | "busyStartsByClass" | "offSlotByCell" | "defaultSlotsByCell"
  >,
  load: Pick<SeatPeriodChoiceLoad, "moves" | "pins">,
  date: string,
): Record<string, SeatClassRoster[]> {
  return applySeatPeriodChoicesByPeriod(day.rosterByPeriod, {
    choices: resolveSeatPeriodChoices({ moves: load.moves, pins: load.pins, date }),
    slotsByClass: day.slotsByClass,
    markedSlotsByCell: day.markedSlotsByCell,
    busyStartsByClass: day.busyStartsByClass,
    offSlotByCell: day.offSlotByCell,
    // LAB '따로 수업(*LAB)' 배정(0271b) — 선택이 없을 때만 본다(seatShowsAtPeriod).
    defaultSlotsByCell: day.defaultSlotsByCell,
    blank: blankSeatCell,
  });
}
