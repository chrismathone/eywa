/**
 * **다음 행선지**의 순수 규칙 — 조회([`server/next-destination-day.ts`](./server/next-destination-day.ts))가 받아 온
 * 하루치를 학생별로 접는다(IO 없음, Vitest).
 *
 * 원장 2026-09-10: *"다음 17:20 이면 무슨 말인지 도대체 알 수가 없음. **17:20 304호 가야함** 처럼 해줘"* — 이
 * 자리 수업이 끝나면 그 학생이 오늘 **어디로 가는가**(시각 + 강의실, 강의실 규칙 = [`destination-room.ts`](./destination-room.ts)).
 *
 * 🔴 **이 자리 교시는 배치표가 아니라 교시 선택(0255a)을 얹은 명단이 진실이다.** 같은 날 교시 선택과
 *    *"다른 시간으로 옮기기"*가 들어오면서 배치표(`class_schedules`)만 보던 접기가 셋을 틀렸다:
 *    ① 하루 두 번 도는 반(MEC1-5 수 16:20·17:00)을 16:20으로 고정한 학생에게 16:20 교시에서 "17:00 본원603" —
 *       **옮겨 나간** 그 랩실을 안내했다. ⚠️ 두 랩실 사이에 제 반 수업이 없는 반×요일은 이것뿐이다(실측 8개 중) —
 *       JP1 목(14:20·16:20)처럼 사이에 수업(15:00·15:40 본원601)이 끼면 그 수업이 먼저 잡혀 옛 접기도 같은 답이다.
 *    ② 다른 시간으로 옮긴 학생(원래 17:00 → 남의 반 15:40)에게 15:40 교시에서 원래 17:00 랩실을 안내했다.
 *    ③ 거꾸로 옮겨 **가는** 교시(남의 반 랩실 시각)는 그 학생의 반 배치가 아니라 후보에 아예 없었다.
 *    그래서 이 자리 라벨의 배치는 후보에서 빼고, 그 학생이 그날 명단에 **서는 교시**를 대신 넣는다.
 * 🔑 그 명단은 화면과 서버 쓰기 게이트(`rosterKeys`)가 쓰는 한 벌(`applySeatDayChoices`)이다 — 화면에 선 학생 =
 *    그 교시에 오는 학생이라 행선지도 같은 사실로 잰다(사실이 규칙을 이긴다: 찍힌 칸·옮겨 온 묶음 포함).
 * 🔴 **교시를 옮기는 자리(`MOVABLE_SEATS`, 랩실)만** 이 규칙을 탄다 — 그 밖의 자리(JJ실)는 `seatStaysFor`가
 *    undefined를 돌려 접기가 글자 그대로 옛 동작(그 반의 그 요일 배치 전부가 후보)이다.
 *
 * 같은 하루치에서 두 가지를 더 꺼낸다(새 왕복 0):
 * - **마지막 수업**(원장 2026-09-11 *"LAB이나 JJ가 마지막 수업인 학생들은 '마지막 수업'이라고 표시하자"*) —
 *   `lastByStudent`. 🔴 행선지가 없다는 **부재**로 추측하지 않는 명시 필드다(모름 ≠ 없음).
 * - **학생별 이 자리 밖 수업** — 다른 시간으로 옮길 때 그 시각에 그 학생이 다른 수업에 있는지 보는 학생 축 재료
 *   ([`student-classes.ts`](./student-classes.ts), 원장 2026-09-11 *"LAB실에서 내가 드래그하고 싶은건 '다른
 *   시간대'의 수업"*).
 */
import { resolveAttendDows } from "@/features/attendance/calendar";
import type { SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { MOVABLE_SEATS, SEAT_DB_LABEL, type SeatKey } from "./seat";

export type SeatNextDestination = {
  /** 학생 id → 다음 수업 시작시각("HH:MM"). */
  startByStudent: Record<string, string>;
  /** 학생 id → 그 수업의 강의실 이름. **모르면 키가 없다.** */
  roomByStudent: Record<string, string>;
  /**
   * 학생 id → true — 이 교시 뒤 오늘 남은 수업이 **없다고 확인된** 학생(= 이 교시가 오늘 마지막 수업).
   * 🔴 **조회가 실제로 돈 학생**(그날 유효한 수강이 있는 학생)만 담긴다 — `startByStudent`에 키가 없다는 것만으로는
   *    마지막이 아니다: 조회 안 함(JJ실 PIN)·조회 실패·대상 밖이면 **여기도 비어 있다**. 화면은 이 필드만 보고 적는다.
   * ⚠️ `startByStudent`와 **겹치지 않는다**(한 학생이 둘 다에 들어가는 일은 없다).
   */
  lastByStudent: Record<string, true>;
};

/** 다음 행선지의 **이 자리 몫** — 교시 선택을 얹은 명단에서 뽑는다(`seatStaysFor`). */
export type SeatStays = {
  seat: SeatKey;
  /** 학생 id → 그날 이 자리 명단에 서는 교시("HH:MM", 오름차순·중복 없음). */
  startsByStudent: Record<string, string[]>;
  /**
   * 그날 이 자리에 걸린 반들 — 조회가 **같은 id 목록**에 얹어 이 반들의 배치도 읽는다(새 왕복 아님). 옮겨 가는
   * 교시(③)는 남의 반 배치에만 있어서, 이게 없으면 그 교시의 **강의실**을 모른다.
   */
  classIds: string[];
};

/** 명단 모양 — 이 모듈은 반 id와 학생 id만 본다(`SeatClassRoster`가 구조적으로 들어온다). */
type RosterByPeriod = Readonly<
  Record<string, readonly { classId: string; students: readonly { id: string }[] }[]>
>;

/**
 * 학생 id → 그날 이 자리에 **서는** 교시들 — **그날 모든 교시** 기준이다(화면에 그리는 교시만이 아니다:
 * '교시 하나' 보기에서도 다음 교시는 그 밖에 있다). 옮겨 온 묶음(`visiting`)도 제 반 묶음과 똑같이 센다.
 */
export function seatStayStartsByStudent(rosterByPeriod: RosterByPeriod): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const start of Object.keys(rosterByPeriod).sort((a, b) => a.localeCompare(b))) {
    for (const r of rosterByPeriod[start] ?? []) {
      for (const s of r.students) {
        const list = (out[s.id] ??= []);
        if (!list.includes(start)) list.push(start);
      }
    }
  }
  return out;
}

/**
 * 다음 행선지 조회에 넘길 이 자리 재료 — 두 페이지(로그인·공개 PIN)가 **이 함수 하나**로 만든다.
 * 🔴 넘기는 명단은 **교시 선택을 얹은 뒤**(`applySeatDayChoices`)여야 한다 — 원본(`day.rosterByPeriod`)이면
 *    옮긴 학생이 원래 교시에 남아 ①②가 그대로 되살아난다.
 * ⚠️ 빈 묶음의 반도 담는다 — 전원이 다른 교시로 갔어도 그 반의 배치가 그 시각 이 자리의 강의실을 알려 준다.
 */
export function seatStaysFor(seat: SeatKey, rosterByPeriod: RosterByPeriod): SeatStays | undefined {
  if (!MOVABLE_SEATS.includes(seat)) return undefined;
  const classIds = new Set<string>();
  for (const rosters of Object.values(rosterByPeriod)) for (const r of rosters) classIds.add(r.classId);
  return { seat, startsByStudent: seatStayStartsByStudent(rosterByPeriod), classIds: [...classIds].sort() };
}

/** 배치 한 줄 — 조회가 정규화까지 마쳐 넘긴다(강의실 = `destinationRoomOf`, 자리 = `specialSlotLabel`). */
export type NextDestinationSlot = {
  start: string;
  /** 끝 시각("HH:MM") — 모르면 null. 학생 축 겹침 판정([`student-classes.ts`](./student-classes.ts)) 재료. */
  end: string | null;
  room: string | null;
  seatLabel: SpecialSlotLabel | null;
};

/** 하루치 재료(그날 유효한 수강 × 그 요일 배치) — 교시 판정은 이 뒤에 JS로 돈다(교시마다 왕복 0). */
export type NextDestinationDay = {
  live: readonly { studentId: string; classId: string; attendanceDays: readonly string[] | null }[];
  /** 반 → 그 요일 배치들(순서 무관 — 접을 때 가장 이른 것을 고른다). */
  slotsByClass: ReadonlyMap<string, readonly NextDestinationSlot[]>;
  /** 반 → 반 이름(`classes.class_name`, 자리 명단 `SeatClassRoster.className`과 같은 원문). 모르면 키가 없다. */
  classNames: ReadonlyMap<string, string>;
  /** 그 날짜의 요일 인덱스(0=일) — 분리등원 판정용. */
  todayIdx: number;
};

/**
 * 분리등원(`attendance_days`) — 그 수강이 오늘 오는가. 반이 오늘 도는지는 조회가 이미 걸렀다.
 * 🔑 접기와 학생 축([`student-classes.ts`](./student-classes.ts))이 **이 함수 한 벌**을 쓴다.
 */
export function attendsToday(e: NextDestinationDay["live"][number], todayIdx: number): boolean {
  const dows = resolveAttendDows(e.attendanceDays, [todayIdx]);
  return dows.length === 0 || dows.includes(todayIdx);
}

/**
 * 이 자리 교시 → 강의실 — **같은 시각의 이 자리 배치**에서만 얻는다.
 * 🔴 그 시각 배치들이 (정본으로 맞춘 뒤에도) 서로 다른 방을 말하면 비운다 — 하나를 고르면 지어낸 방이다.
 */
function seatRoomByStart(
  slotsByClass: NextDestinationDay["slotsByClass"],
  label: SpecialSlotLabel,
): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const slots of slotsByClass.values()) {
    for (const sl of slots) {
      if (sl.seatLabel !== label || !sl.room) continue;
      (seen.get(sl.start) ?? seen.set(sl.start, new Set()).get(sl.start)!).add(sl.room);
    }
  }
  const out = new Map<string, string>();
  for (const [start, rooms] of seen) if (rooms.size === 1) out.set(start, [...rooms][0]!);
  return out;
}

/**
 * 기준 교시(`after`) 뒤 **첫 수업**을 학생별로 접는다.
 *
 * `stays`를 주면(교시를 옮기는 자리) 학생 반 배치 중 **이 자리 라벨의 배치는 빼고** 그 학생이 명단에 서는
 * 교시를 넣는다. 다른 자리 배치(랩실에서 본 JJ실)는 진짜 행선지라 그대로 둔다. 안 주면 옛 동작 그대로다.
 * ⚠️ 같은 시각이면 먼저 담은 것이 남는다(수업 배치 → 이 자리 교시 순) — 한 학생이 같은 시각에 두 곳에 있는
 *    것은 시간표가 풀 문제라 여기서 고르지 않는다.
 * 🔑 **마지막 수업**(`lastByStudent`)은 같은 후보에서 나온다 — 후보가 하나도 안 남은 학생이다. 그래서 규칙이 둘로
 *    갈리지 않는다: 뒤에 이 자리 교시가 또 있으면(명단이 그렇게 말하면) 마지막이 아니고, 옮겨 나간 교시는 안 센다.
 */
export function foldNextDestination(
  day: NextDestinationDay,
  after: string,
  stays?: SeatStays,
): SeatNextDestination {
  const startByStudent: Record<string, string> = {};
  const roomByStudent: Record<string, string> = {};
  const offer = (studentId: string, next: { start: string; room: string | null }) => {
    if (next.start <= after) return;
    const cur = startByStudent[studentId];
    if (cur && cur <= next.start) return;
    startByStudent[studentId] = next.start;
    if (next.room) roomByStudent[studentId] = next.room;
    else delete roomByStudent[studentId]; // 앞서 담은(더 늦은) 수업의 방이 남으면 엉뚱한 방을 적는다
  };

  const seatLabel = stays ? SEAT_DB_LABEL[stays.seat] : null;
  /** 조회가 **실제로 돈** 학생 — 그날 유효한 수강이 있는 학생만(물었지만 수강이 없는 학생은 모름이다). */
  const students = new Set<string>();
  for (const e of day.live) {
    students.add(e.studentId);
    // 분리등원(attendance_days) — 오늘 안 오는 반의 배치는 후보가 아니다.
    if (!attendsToday(e, day.todayIdx)) continue;
    for (const sl of day.slotsByClass.get(e.classId) ?? []) {
      // 🔴 이 자리 배치는 빼고, 아래에서 **명단이 말하는 교시**로 대신 넣는다(①②).
      if (seatLabel && sl.seatLabel === seatLabel) continue;
      offer(e.studentId, sl);
    }
  }
  if (stays && seatLabel) {
    const rooms = seatRoomByStart(day.slotsByClass, seatLabel);
    // 물은 학생만 담는다 — 명단 재료에 있는 다른 학생의 교시는 붙이지 않는다(결과 모양이 옛 동작과 같다).
    for (const studentId of students) {
      for (const start of stays.startsByStudent[studentId] ?? []) {
        offer(studentId, { start, room: rooms.get(start) ?? null });
      }
    }
  }
  const lastByStudent: Record<string, true> = {};
  for (const studentId of students) if (!(studentId in startByStudent)) lastByStudent[studentId] = true;
  return { startByStudent, roomByStudent, lastByStudent };
}
