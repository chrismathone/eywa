/**
 * 자리(랩실·JJ실) 출석부의 **교시 사이 신호** — 순수 규칙(IO 없음, Vitest).
 *
 * 원장 2026-09-10(화면을 보며): *"이 학생이 이전수업에 결석이였으면 자동 결석체크할 수 있도록"* ·
 * *"이후에 수업이 남아있으면 다음 수업이 있다고 표시해줘"*.
 *
 * 이 방은 하루에 교시가 다섯 번 돌고 **같은 학생이 여러 교시에 다시 들어온다**(실측 2026-09-10,
 * 최근 60일 JJ: (학생,날짜) 2,306쌍 중 **2,226쌍이 2교시 이상**, 3교시 750·4교시 23). 그래서 한 번
 * 안 온 아이를 교시마다 스무 번씩 다시 찍는다. 앞 교시 결석은 실제로 다음 교시도 결석이다 —
 * 실측 JJ 308/317(97.2%) · 랩실 102/109(93.6%).
 *
 * 🔴🔴 **그래도 자동으로 찍지 않는다.** 이 파일은 *제안*만 만들고, 쓰기는 사람이 버튼을 누를 때
 *    한 번 일어난다(셔틀 "신호만, 자동 쓰기 없음" · 재고 "제안만(사람이 누른다)"과 같은 결).
 *    출결은 시수→급여와 학부모 결석 알림에 닿아, 화면을 열기만 했는데 찍히면 되돌릴 방법이 없다.
 * 🔴 **판정은 그 학생의 앞 교시 하나**다 — "그 학생의 마지막 기록"을 최신순으로 집으면 다른 교시의
 *    출석을 집는다([[#112]]: 이 방은 하루 여러 교시가 정상이라 최신순 대표행이 늘 거짓말한다).
 * 🔴 **이 자리의 교시만 본다** — 같은 날 다른 방·다른 과목 수업은 이 화면에 없다. 그래서 문구에
 *    임계값 이름이 아니라 **실제 교시 시각**을 적어(`앞 교시(16:20) 결석`) 당번이 그 칩을 눌러
 *    눈으로 대조할 수 있게 한다([[#121]]).
 */

/** 자리판이 표현하는 상태 3종 + 미체크. 미체크(null)는 **결석이 아니다**(아직 안 온 것). */
export type SeatCellStatus = "present" | "absent" | "late" | null;

/** 한 교시 한 칸 — 판정에 필요한 최소한. */
export type SeatDayCell = { classId: string; studentId: string; status: SeatCellStatus };

/** 하루치 자리 명단을 교시별로 접은 것. `starts`는 "HH:MM" 오름차순·중복 없음. */
export type SeatDayCells = {
  starts: readonly string[];
  byStart: Readonly<Record<string, readonly SeatDayCell[]>>;
};

/** 한 교시 안에서 칸을 가리키는 키. ⚠️ 낙관 오버레이 키(`seatOverlayKey`)와 달리 **교시가 없다**. */
export function seatCellKey(classId: string, studentId: string): string {
  return `${classId}|${studentId}`;
}

/**
 * `SeatDay`(교시 + 교시별 반 명단)를 판정 재료로 접는다 — **서버와 화면이 같은 함수를 쓴다**.
 * (`SeatDay` 타입을 여기서 import하지 않는 이유: 그 모듈은 `server-only`라 클라가 못 읽는다 [[#61]].
 *  구조가 맞으면 그대로 들어온다.)
 */
export function seatDayCells(
  periods: readonly { start: string }[],
  rosterByPeriod: Readonly<
    Record<string, readonly { classId: string; students: readonly { id: string; status: SeatCellStatus }[] }[]>
  >,
): SeatDayCells {
  const starts = [...new Set(periods.map((p) => p.start))].sort((a, b) => a.localeCompare(b));
  const byStart: Record<string, SeatDayCell[]> = {};
  for (const start of starts) {
    byStart[start] = (rosterByPeriod[start] ?? []).flatMap((r) =>
      r.students.map((s) => ({ classId: r.classId, studentId: s.id, status: s.status })),
    );
  }
  return { starts, byStart };
}

/**
 * 그 학생의 **바로 앞 교시** — 활성 교시보다 앞서면서 그 학생이 실제로 명단에 선 교시 중 **가장 늦은** 것.
 *
 * ⚠️ "그 날의 직전 교시"가 아니라 **"그 학생의 직전 교시"**다. 16:20에 결석하고 17:20엔 아예 안 오는
 *    학생이 18:20에 서면, 그 학생의 앞 교시는 16:20이다(빈 17:20을 앞 교시로 보면 신호가 사라진다).
 * 앞 교시에 한 번도 안 섰으면 null = **판정하지 않는다**(모르는 것을 결석으로 읽지 않는다).
 */
export function prevSeatPeriodFor(day: SeatDayCells, activeStart: string, studentId: string): string | null {
  for (let i = day.starts.length - 1; i >= 0; i--) {
    const start = day.starts[i]!;
    if (start >= activeStart) continue;
    if ((day.byStart[start] ?? []).some((c) => c.studentId === studentId)) return start;
  }
  return null;
}

/**
 * 활성 교시의 칸 중 **앞 교시가 결석**인 칸 → 그 앞 교시 시각("HH:MM").
 *
 * 🔴 **지금 상태로 거르지 않는다**(이미 찍힌 칸도 담는다) — 화면이 낙관 오버레이를 얹은 뒤 다시 거른다.
 *    여기서 걸러 버리면, 잘못 찍은 칸을 미체크로 되돌렸을 때 표식이 안 돌아온다.
 * ⚠️ 앞 교시에 그 학생 칸이 **여럿**이면(한 교시 두 반 — 실측 최근 60일 0건) 전부 결석일 때만 결석으로
 *    본다. 하나라도 출석이면 사실이 갈린 것이라 판정하지 않는다.
 * ⚠️ `excludeClassIds`(모호한 반)는 **후보에서만** 뺀다 — 앞 교시를 되짚을 때는 그 칸도 본다(그 학생이
 *    그때 결석이었다는 건 여전히 사실이다).
 */
export function prevPeriodAbsences(
  day: SeatDayCells,
  activeStart: string,
  /**
   * 저장키로 구분 못 하는 반(`ambiguousClassIds` — 같은 반·같은 시작·다른 종료). 그 칸은 **아무도 못
   * 쓴다**(`rosterKeys`가 명단에서 뺀다) → 후보로 세우면 화면이 "N명"이라 적고 서버는 그보다 적게 쓴다.
   */
  excludeClassIds: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  const blocked = new Set(excludeClassIds);
  for (const cell of day.byStart[activeStart] ?? []) {
    if (blocked.has(cell.classId)) continue;
    const prevStart = prevSeatPeriodFor(day, activeStart, cell.studentId);
    if (!prevStart) continue;
    const mine = (day.byStart[prevStart] ?? []).filter((c) => c.studentId === cell.studentId);
    if (mine.length > 0 && mine.every((c) => c.status === "absent")) {
      out[seatCellKey(cell.classId, cell.studentId)] = prevStart;
    }
  }
  return out;
}

/**
 * 일괄 '앞 교시 결석자 결석'이 **실제로 채울 칸** — 위 후보 중 **아직 안 찍힌 칸만**.
 *
 * 🔴 이미 찍힌 칸은 절대 대상이 아니다(사람이 출석으로 고쳐 놓은 것을 되돌리면 안 된다).
 * 🔴 서버가 이 함수를 **다시 돌린다** — 화면이 보낸 목록을 그대로 쓰면 그새 바뀐 칸을 덮는다([[#77]]).
 * 🔴 **칸 하나는 한 번만** 돌려준다 — 같은 반이 한 교시에 두 줄로 서면(동시에 유효한 중복 슬롯. 실측
 *    2026-09-10 0건이지만 스키마가 막지 않는다) 명단에 그 학생이 두 번 들어오고, 호출부가 그대로
 *    행을 만들면 **같은 칸에 출결 행이 둘** = 시수 이중 계상이다(`fillSeatSlot`은 Map 키라 저절로 하나다).
 */
export function prevAbsentFillTargets(
  day: SeatDayCells,
  activeStart: string,
  /** 모호한 반 — 화면 표식과 **같은 집합**을 넘겨야 버튼의 "N명"과 실제로 쓰는 수가 안 갈린다. */
  excludeClassIds: readonly string[] = [],
): SeatPrevAbsentTarget[] {
  const candidates = prevPeriodAbsences(day, activeStart, excludeClassIds);
  const seen = new Set<string>();
  const out: SeatPrevAbsentTarget[] = [];
  for (const c of day.byStart[activeStart] ?? []) {
    const key = seatCellKey(c.classId, c.studentId);
    const prevStart = candidates[key];
    if (c.status !== null || !prevStart || seen.has(key)) continue;
    seen.add(key);
    out.push({ classId: c.classId, studentId: c.studentId, prevStart });
  }
  return out;
}

/**
 * 채울 칸 하나 — **근거(`prevStart`)를 함께** 들고 다닌다.
 * 🔴 근거를 버리면 감사로그가 "왜 이 학생이 결석으로 찍혔나"를 못 적는다(이 일괄의 존재 이유가 추론이라
 *    `seat_attendance_fill`과 구분되는 유일한 사실이 그 교시 시각이고, 그 사이 누가 앞 교시를 고치면
 *    영영 복원할 수 없다).
 */
export type SeatPrevAbsentTarget = { classId: string; studentId: string; prevStart: string };

/**
 * 오늘 이 자리에서 **다음에 또 오는 교시** — 학생 id → "HH:MM"(활성 교시 뒤 가장 이른 것).
 * 없으면 키 자체가 없다(= 화면에 아무것도 안 적는다).
 *
 * 🔴 **표시 전용**이다 — 이걸로 무엇을 자동으로 바꾸지 않는다(결석을 찍을지는 사람이 정한다).
 * ⚠️ 이 자리 교시만 센다 — 학생의 다른 과목 수업은 이 화면의 재료가 아니다. 그래서 빈 칸은
 *    "오늘 수업이 더 없다"가 아니라 **"이 방에는 더 안 온다"**이고, 툴팁이 그 사실을 밝힌다.
 */
export function nextSeatPeriodByStudent(day: SeatDayCells, activeStart: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const start of day.starts) {
    if (start <= activeStart) continue;
    for (const cell of day.byStart[start] ?? []) {
      if (!(cell.studentId in out)) out[cell.studentId] = start;
    }
  }
  return out;
}
