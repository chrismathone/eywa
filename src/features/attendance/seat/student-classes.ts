/**
 * 학생별 그날 **이 자리 밖** 수업 — 자리(랩실) 학생을 **다른 시간**으로 옮길 때, 그 시각에 그 학생이 다른
 * 수업에 있는지 보는 **학생 축** 재료(순수, Vitest).
 *
 * 원장 2026-09-11: *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의 수업임"* — 실측(injaewon 2026-09-11 금):
 * 이도윤B는 PL1b 14:20(본원606) → 15:00 랩실(본원603) → 수학 `초등M 초4 EL2S` 16:20~17:15·17:15~18:10(본원205).
 * 이 학생을 16:20 랩실로 옮기면 그 시각 두 곳에 있게 되는데, 반 축 판정(`busyStartsByClass` — 그 **반**의 다른
 * 수업 시각)은 과목이 다른 수학 반을 못 본다. 그래서 학생 축이 따로 든다.
 *
 * 🔑 **새 왕복 0** — 다음 행선지 조회([`server/next-destination.ts`](./server/next-destination.ts))가 이미 그 학생들의
 *    그날 수강 × 배치를 읽는다(`NextDestinationDay`). 이 함수는 그 하루치를 학생별로 접을 뿐이다.
 * 🔑 **한 벌** — 화면(`getSeatNextDestinationsBySlot`의 `classesByStudent`)과 서버 쓰기 경로(`getSeatStudentClasses`,
 *    한 학생을 같은 조회로 다시 읽는다)가 이 함수를 같이 쓰고, 겹침 판정([`seatStudentClash`])도 두 쪽이
 *    [`validateSeatPeriodMove`](./period-choice.ts) 안에서 같은 함수를 지난다([[#77]]: 화면 값은 페이지를 연 시점의 스냅샷이다).
 */
import { timeRangesOverlap } from "@/features/classes/overlap";
import type { SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { SEAT_DB_LABEL, SEAT_NAME, seatKeyOf, type SeatKey } from "./seat";
import { attendsToday, type NextDestinationDay } from "./next-destination";

/** 그날 이 자리 **밖** 수업 한 줄. */
export type SeatStudentClass = {
  classId: string;
  /** 반 이름 — 자리 명단(`SeatClassRoster.className`)과 같은 원문(`classes.class_name`). 모르면 null. */
  className: string | null;
  /** 시작("HH:MM"). */
  start: string;
  /** 끝("HH:MM") — 모르면 null(겹침을 판정할 수 없는 줄이다 — 지어내지 말 것). */
  end: string | null;
  /** 강의실(`destinationRoomOf` — 배치 방 → 반 기본 강의실). 모르면 null. */
  room: string | null;
  /** 다른 자리(랩실에서 본 JJ실) 배치면 그 라벨 — 사람이 가르치는 수업이면 null. */
  seatLabel: SpecialSlotLabel | null;
};

/**
 * 학생 id → 그날 **이 자리 밖** 수업들(시작 오름차순, 같은 시작이면 반 id 순).
 *
 * - **이 자리 라벨의 배치는 뺀다** — 그것이 옮기는 대상이다(그 학생이 이 자리에 서는 교시는 교시 선택을 얹은
 *   명단이 진실이고, 화면·서버가 이미 그 명단을 들고 있다).
 * - 다른 자리 배치(랩실에서 본 JJ실)는 넣는다 — 그 시각 그 학생은 거기 있다.
 * - 제 반의 정규 수업도 넣는다 — 반 축(`busyStartsByClass`)과 겹치지만, 학생 축은 과목·반을 안 가린다.
 * - 분리등원 — 그날 안 오는 반의 배치는 뺀다(다음 행선지 접기와 같은 `attendsToday`).
 * 🔴 **조회가 실제로 돈 학생만 키가 있다** — 키 없음 = 모름(조회 안 함·실패·대상 밖), 빈 배열 = 이 자리 밖 수업이
 *    없다고 확인됨. 재료가 없을 때 아무것도 막지 않으려면(fail-open) 호출부가 이 둘을 가를 수 있어야 한다.
 * ⚠️ 같은 반·같은 시각·같은 끝이 두 줄(중복 수강 행·중복 배치)이면 한 번만 담는다.
 */
export function seatStudentClassesOf(day: NextDestinationDay, seat: SeatKey): Record<string, SeatStudentClass[]> {
  const label = SEAT_DB_LABEL[seat];
  const out: Record<string, SeatStudentClass[]> = {};
  const seen = new Set<string>();
  for (const e of day.live) {
    const list = (out[e.studentId] ??= []);
    if (!attendsToday(e, day.todayIdx)) continue;
    for (const sl of day.slotsByClass.get(e.classId) ?? []) {
      if (sl.seatLabel === label) continue;
      const key = `${e.studentId}|${e.classId}|${sl.start}|${sl.end ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        classId: e.classId,
        className: day.classNames.get(e.classId) ?? null,
        start: sl.start,
        end: sl.end,
        room: sl.room,
        seatLabel: sl.seatLabel,
      });
    }
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => a.start.localeCompare(b.start) || a.classId.localeCompare(b.classId));
  }
  return out;
}

/**
 * 옮기려는 교시와 **겹치는 이 학생의 다른 수업**(없으면 null) — 원장 2026-09-11 이후의 학생 축 차단.
 *
 * 🔑 겹침 = 앱 단일 소스 [`timeRangesOverlap`](@/features/classes/overlap)(반열린 구간 — 15:40에 끝나는 수업 뒤
 *    15:40 시작은 안 겹친다). 교시 끝이 여럿이면 **가장 늦은 끝**까지를 그 교시로 본다(`pickPeriodIndex`와 같은
 *    규약 — 이르게 끝나는 반을 기준으로 잡으면 아직 방에 있는 시간이 빠진다).
 * 🔴 **끝을 모르는 줄은 아는 것만 판정한다** — 시작이 같으면 겹치고(길이가 있는 두 수업이 같은 순간에 시작한다),
 *    그 밖엔 끝을 아는 쪽 구간이 다른 쪽 시작을 품을 때만 겹친다. 모르는 것으로 막지 않는다.
 * 🔴 `classes`가 undefined면(모름 — 조회 안 함·실패·대상 밖) null이다: 화면은 막지 않고(표식은 도움이지 게이트가
 *    아니다) 서버가 자기 조회로 다시 본다.
 */
export function seatStudentClash(
  classes: readonly SeatStudentClass[] | undefined,
  target: { start: string; ends: readonly string[] },
): SeatStudentClass | null {
  if (!classes || classes.length === 0) return null;
  const end = latestEnd(target.ends);
  for (const c of classes) {
    if (c.start === target.start) return c;
    if (c.end && end) {
      if (timeRangesOverlap(target.start, end, c.start, c.end)) return c;
    } else if (c.end) {
      if (c.start < target.start && target.start < c.end) return c;
    } else if (end) {
      if (target.start < c.start && c.start < end) return c;
    }
  }
  return null;
}

function latestEnd(ends: readonly string[]): string | null {
  let out: string | null = null;
  for (const e of ends) if (e && (out === null || e > out)) out = e;
  return out;
}

/**
 * 학생 축 거절 문장 — 화면(놓을 곳 표식·끄는 카드 문장·드롭 거절)과 서버가 **같은 말**을 한다.
 * 반 이름 + (다른 자리면 그 이름) + 시각. 자리 라벨 원문(`JJ`)은 화면에 내보내지 않는다(`SEAT_NAME`).
 */
export function seatStudentClashMessage(c: SeatStudentClass): string {
  const seat = c.seatLabel ? seatKeyOf(c.seatLabel) : null;
  const what = [c.className ?? "다른 반", seat ? SEAT_NAME[seat] : null].filter(Boolean).join(" · ");
  const when = c.end ? `${c.start}~${c.end}` : c.start;
  return `그 시각에 이 학생의 다른 수업(${what} ${when})이 있습니다 — 겹치는 시간으로는 옮길 수 없습니다`;
}
