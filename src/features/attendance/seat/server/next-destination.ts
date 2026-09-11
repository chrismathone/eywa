import "server-only";
import { hhmm, type SeatKey } from "../seat";
import {
  foldNextDestination,
  type NextDestinationDay,
  type SeatNextDestination,
  type SeatStays,
} from "../next-destination";
import { seatStudentClassesOf, type SeatStudentClass } from "../student-classes";
import { loadDaySlots } from "./next-destination-day";

export type { SeatNextDestination, SeatStudentClass };

/**
 * **다음 행선지** — 이 자리 수업이 끝난 뒤 그 학생이 오늘 갈 곳(시각 + 강의실). 하루치 조회는
 * [`next-destination-day.ts`](./next-destination-day.ts), 학생별로 접는 규칙은 순수 모듈
 * [`next-destination.ts`](../next-destination.ts)가 한다(Vitest). 여기는 그 둘을 잇는 **문 두 개**다.
 *
 * 원장 2026-09-10: *"다음 17:20 이면 무슨 말인지 도대체 알 수가 없음. **17:20 304호 가야함** 처럼
 * 해줘"* + *"강의실은 다 있을테니"*.
 *
 * 🔴 **이 자리만 보던 것을 오늘 전 과목으로 넓힌 것**이다 — 종전 `nextSeatPeriodByStudent`는 같은 방의
 *    다음 교시만 봐서 "다음 17:20"이 곧 "여기 또 와"였고, 정작 아이가 어디로 가야 하는지는 안 적혔다.
 * 🔴 **강의실 = 배치 FK 이름 → 배치 라벨(정본) → 반 기본 강의실**([`destinationRoomOf`](../destination-room.ts),
 *    원장 2026-09-11 *"이도윤B는 왜 … 1620 다음수업이라고만 되어있지? 강의실이 없고?"*). **방을 모르면 시각만**
 *    돌려준다(키 없음) — 지어낸 방 이름은 아이를 엉뚱한 데로 보낸다.
 * 🔴 **교시를 옮기는 자리(랩실)는 이 자리 배치를 교시 선택을 얹은 명단으로 잰다**(원장 2026-09-10 *"다른 시간으로
 *    옮기기"* 이후) — 호출부가 `stays`([`seatStaysFor`](../next-destination.ts))를 넘기면 그날 이 자리 반들의
 *    배치를 **같은 조회**에 얹어 읽고(옮겨 가는 교시의 강의실), 접기가 이 자리 라벨 배치를 빼고 명단의 교시를
 *    넣는다. 안 넘기면 옛 동작 그대로(JJ실).
 * 🔑 **비로그인 PIN 화면도 같은 함수를 쓴다**(원장 2026-09-10 *"seat/lab에서도 자리 출석부와 동일해야해"*) —
 *    `tenantId`를 넘기면 admin + 명시 `tenant_id` 필터(격리선)로 읽는다(조회 모듈 머리 주석).
 */

/** 교시별 다음 행선지 + 같은 하루치에서 뽑은 학생 축 재료 — 조회 한 벌의 결과. */
export type SeatDayDestinations = {
  /** 기준 교시("HH:MM") → 그 교시 뒤 다음 행선지·마지막 수업. */
  bySlot: Record<string, SeatNextDestination>;
  /**
   * 학생 id → 그날 이 자리 밖 수업들([`seatStudentClassesOf`](../student-classes.ts)) — **교시를 옮기는 자리**
   * (`stays`를 넘긴 랩실)에서만 채운다. 키 없음 = 모름(조회 안 함·실패·대상 밖·JJ실), 빈 배열 = 없다고 확인됨.
   */
  classesByStudent: Record<string, SeatStudentClass[]>;
};

const EMPTY: SeatNextDestination = { startByStudent: {}, roomByStudent: {}, lastByStudent: {} };

/** 모름 — 교시마다 빈 결과. 🔴 '마지막 수업'도 적지 않는다(모름 ≠ 없음). */
function unknownDay(afterStarts: readonly string[]): SeatDayDestinations {
  return { bySlot: Object.fromEntries(afterStarts.map((k) => [hhmm(k), EMPTY])), classesByStudent: {} };
}

/**
 * 교시 **여러 개**를 한 번에 — '전체' 보기(원장 2026-09-10 ⑨)가 교시 수만큼 왕복을 늘리지 않게,
 * 조회는 하루 한 벌이고 "이보다 늦게 시작하는" 판정만 교시마다 JS에서 돌린다(B6).
 * 🔴 **조회가 실패해도 화면을 죽이지 않는다** — 이 값은 표시용 신호라, 실패하면 모름(`unknownDay`)으로 돌려주고
 *    로그를 남긴다. 결과 모양이 모름과 없음을 가르므로 빈 결과가 '마지막 수업'으로 읽히지 않는다.
 */
export async function getSeatNextDestinationsBySlot(
  studentIds: readonly string[],
  date: string,
  /** 기준 교시들("HH:MM") — 각각에 대해 그 뒤 첫 수업을 찾는다. */
  afterStarts: readonly string[],
  opts: {
    /** 비로그인 PIN 경로 — 주면 admin + 이 테넌트 필터로 읽는다(세션이 없다). */
    tenantId?: string;
    /**
     * 교시를 옮기는 자리(랩실)의 명단 재료 — `seatStaysFor`로 **교시 선택을 얹은 명단**에서 만든다.
     * 없으면 옛 동작(배치표 그대로 — JJ실·옛 호출부).
     */
    stays?: SeatStays;
  } = {},
): Promise<SeatDayDestinations> {
  if (studentIds.length === 0 || afterStarts.length === 0) return unknownDay(afterStarts);
  let loaded: NextDestinationDay;
  try {
    loaded = await loadDaySlots(studentIds, date, opts.tenantId, opts.stays?.classIds ?? []);
  } catch (err) {
    console.error("[seat] 다음 행선지 조회 실패 — 다음 행선지·마지막 수업을 비워 둔다", err);
    return unknownDay(afterStarts);
  }
  return {
    bySlot: Object.fromEntries(
      afterStarts.map((raw) => {
        const after = hhmm(raw);
        return [after, foldNextDestination(loaded, after, opts.stays)];
      }),
    ),
    classesByStudent: opts.stays ? seatStudentClassesOf(loaded, opts.stays.seat) : {},
  };
}

/** 학생 축 조회 실패 — 원인을 단정하지 않는다. 서버 쓰기 경로가 이 문장으로 거절한다. */
export const SEAT_STUDENT_CLASSES_FAILED = "이 학생의 다른 수업을 확인하지 못했습니다 — 다시 시도해 주세요";

/** 학생 축 재료 — 읽었으면 학생 → 이 자리 밖 수업(키 없음 = 그날 유효한 수강이 없다), 못 읽었으면 거절 문장. */
export type SeatStudentClassesLoad =
  | { ok: true; byStudent: Record<string, SeatStudentClass[]> }
  | { ok: false; error: string };

/**
 * 학생들의 그날 **이 자리 밖** 수업 — 서버 쓰기 경로(다른 시간으로 옮기기)가 화면과 **같은 조회·같은 규칙**
 * (`loadDaySlots` → `seatStudentClassesOf`)으로 다시 잰다([[#77]]: 화면 값은 페이지를 연 시점의 스냅샷이다).
 * 🔴 조회 실패는 `ok: false`로 돌려준다(로그를 남긴다) — 서버는 게이트라 호출부가 **쓰지 않는다**. 화면 쪽
 *    `getSeatNextDestinationsBySlot`은 같은 실패를 모름으로 삼키고 산다(거기 값은 표시라서).
 */
export async function getSeatStudentClasses(
  studentIds: readonly string[],
  date: string,
  seat: SeatKey,
  opts: { tenantId?: string } = {},
): Promise<SeatStudentClassesLoad> {
  if (studentIds.length === 0) return { ok: true, byStudent: {} };
  try {
    return { ok: true, byStudent: seatStudentClassesOf(await loadDaySlots(studentIds, date, opts.tenantId, []), seat) };
  } catch (err) {
    console.error("[seat] 학생의 다른 수업 조회 실패 — 교시 이동을 막는다", err);
    return { ok: false, error: SEAT_STUDENT_CLASSES_FAILED };
  }
}
