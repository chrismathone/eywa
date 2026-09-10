/**
 * 자리(랩실) 출석부의 **교시 선택** — 순수 규칙(IO 없음, Vitest). 0255a `seat_period_moves`/`seat_period_pins`.
 *
 * 원장 2026-09-10: *"그 학생만 그 시간대에 어쩔 수 없는 사정으로 다른 학생과 다른 시간에 랩실을 듣는
 * 학생이 있어. 그래서 하루에 랩이 2회인 EiE 수업이 존재하는것."* + *"한번 드래그한 학생은 '다음에도 이
 * LAB실 수업을 이 시간대로 고정할까요?'라고 물어볼것."*
 *
 * 🔑 **문제의 모양**: 실측 8개 (반×요일)이 같은 요일에 자리 수업을 두 번 돈다(JP1 목 14:20·16:20 등).
 *    명단은 반 단위라 **그 반 전원이 두 교시 모두에** 선다 — 누가 어느 쪽인지는 어디에도 없었다.
 * 🔑 **그래서 이 규칙은 '감추기'다.** 학생은 이미 제 반의 모든 자리 교시에 들어 있으므로, "16:20으로
 *    정한다"는 곧 **그 반의 다른 자리 교시에서 감춘다**이다. 없던 학생을 세우는 경로가 아니다.
 * 🔴 **시간표를 고치는 것이 아니다** — 시간표는 이미 맞다(그 반은 정말 두 번 들어간다). 반·수강·출결도
 *    한 줄도 안 바뀐다. 바뀌는 것은 **명단에 보이느냐**뿐이다.
 * 🔴 **모르면 감추지 않는다.** 선택이 없거나, 고른 교시가 그 날 그 반에 없거나(시간표가 바뀌었다),
 *    그 교시에 이미 기록이 있으면 **그대로 세운다**. 명단에서 사람이 사라지는 것이 이 화면의 최악이다.
 */

/** 하루짜리 선택(오늘만) — `slotStart`는 "HH:MM". */
export type SeatPeriodMove = { classId: string; studentId: string; slotStart: string };

/** 상시 고정 — `effectiveFrom`("YYYY-MM-DD") **이후** 날짜에만 적용된다(과거는 기록이다). */
export type SeatPeriodPin = SeatPeriodMove & { effectiveFrom: string };

/** (반|학생) 한 칸의 키 — 선택·기록 지도가 같은 키를 쓴다. */
export function seatChoiceKey(classId: string, studentId: string): string {
  return `${classId}|${studentId}`;
}

/**
 * 그 날짜에 유효한 선택 — **하루짜리가 상시 고정을 이긴다**.
 *
 * 🔴 순서가 뒤집히면 "오늘만 옮김"이 고정에 덮여 아무 일도 안 일어난다(사람이 화면에서 끌었는데
 *    카드가 제자리로 튀어 오른다 = 고장으로 읽힌다).
 * 🔴 `effectiveFrom`이 **미래**인 고정은 아직 적용하지 않는다 — 고정을 미리 걸어 둘 수 있게 열어 두되,
 *    그 전 날짜의 명단은 건드리지 않는다.
 */
export function resolveSeatPeriodChoices(v: {
  moves: readonly SeatPeriodMove[];
  pins: readonly SeatPeriodPin[];
  date: string;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of v.pins) {
    if (p.effectiveFrom > v.date) continue;
    out[seatChoiceKey(p.classId, p.studentId)] = p.slotStart;
  }
  for (const m of v.moves) out[seatChoiceKey(m.classId, m.studentId)] = m.slotStart;
  return out;
}

/**
 * 이 학생이 이 교시 명단에 서는가.
 *
 * 🔴 **사실이 규칙을 이긴다** — 그 교시에 이미 출결 기록이 있으면 선택이 뭐라 하든 세운다(MCS의
 *    *"사실이 달력을 이긴다"*와 같은 결). 안 그러면 지난 기록이 아무도 안 보는 칸에 숨는다.
 * 🔴 고른 교시가 그 날 그 반의 자리 교시가 아니면(시간표가 바뀌었다) **선택을 버리고 다 세운다** —
 *    한 사람도 명단에서 사라지지 않는 쪽으로 실패한다.
 * ⚠️ 그 반의 자리 교시가 하나뿐이면 감출 것이 없다(선택이 있어도 결과는 같다).
 */
export function seatShowsAtPeriod(v: {
  /** 이 (반|학생)의 선택 — 없으면 지금까지 그대로(모든 교시에 선다). */
  chosen: string | null | undefined;
  slotStart: string;
  /** 그 날 이 반이 이 자리에 걸린 교시들("HH:MM"). */
  classSlots: readonly string[];
  /** 그 날 이 (반|학생)에 이미 기록이 있는 교시들. */
  markedSlots: readonly string[];
}): boolean {
  if (!v.chosen) return true;
  if (v.chosen === v.slotStart) return true;
  if (!v.classSlots.includes(v.chosen)) return true;
  if (v.markedSlots.includes(v.slotStart)) return true;
  return false;
}

/** 명단 한 묶음 — 이 모듈은 반 id와 학생 id·상태만 본다. */
export type ChoiceRoster<S> = { classId: string; students: readonly S[] };

/**
 * 한 교시 명단에서 **다른 교시로 정해진 학생을 뺀다** — 화면과 서버가 같은 함수를 쓴다.
 * ⚠️ 빈 묶음(전원이 다른 교시로 갔다)도 **지우지 않는다** — 반이 통째로 사라지면 "이 반 수업이
 *    없어졌나" 싶어진다. 0명인 묶음을 보여 주는 판단은 화면 몫이다.
 */
export function applySeatPeriodChoices<R extends ChoiceRoster<{ id: string }>>(
  rosters: readonly R[],
  v: {
    slotStart: string;
    choices: Readonly<Record<string, string>>;
    slotsByClass: Readonly<Record<string, readonly string[]>>;
    markedSlotsByCell: Readonly<Record<string, readonly string[]>>;
  },
): R[] {
  return rosters.map((r) => ({
    ...r,
    students: r.students.filter((s) => {
      const key = seatChoiceKey(r.classId, s.id);
      return seatShowsAtPeriod({
        chosen: v.choices[key],
        slotStart: v.slotStart,
        classSlots: v.slotsByClass[r.classId] ?? [],
        markedSlots: v.markedSlotsByCell[key] ?? [],
      });
    }),
  }));
}

/**
 * 하루치 **전 교시**에 한꺼번에 얹는다 — 서버 쓰기 경로(일괄 출석·앞 교시 결석 채우기)가 쓴다.
 *
 * 🔴 **화면과 같은 집합이어야 한다.** 일괄 버튼은 "남은 N명"이라 적고 서버가 채우는데, 서버가 안 거른
 *    명단을 쓰면 **화면에 없는 학생이 조용히 찍힌다**(그 학생은 다른 교시에 서 있다). 그 칸은 아무도
 *    안 보는 자리에 남아 자리 시수를 부풀린다.
 * ⚠️ 화면은 이 함수를 안 쓴다 — 거기선 낙관 오버레이 때문에 **감추기와 되살리기가 함께** 필요해서
 *    교시마다 `applySeatPeriodChoices`를 부른다(감춘 명단만 들고 있으면 되살릴 재료가 없다).
 */
export function applySeatPeriodChoicesByPeriod<R extends ChoiceRoster<{ id: string }>>(
  rosterByPeriod: Readonly<Record<string, R[]>>,
  v: {
    choices: Readonly<Record<string, string>>;
    slotsByClass: Readonly<Record<string, readonly string[]>>;
    markedSlotsByCell: Readonly<Record<string, readonly string[]>>;
  },
): Record<string, R[]> {
  const out: Record<string, R[]> = {};
  for (const [slotStart, rosters] of Object.entries(rosterByPeriod)) {
    out[slotStart] = applySeatPeriodChoices(rosters, { ...v, slotStart });
  }
  return out;
}

/** 교시 이동이 막히는 이유들 — 화면(툴팁)과 서버(거절)가 같은 문장을 쓴다. */
export const SEAT_PERIOD_SAME_CLASS_ONLY =
  "교시를 옮길 때는 같은 반 자리로만 놓을 수 있습니다";
export const SEAT_PERIOD_NO_SLOT = "그 시각에는 이 반의 자리 수업이 없습니다";
export const SEAT_PERIOD_ONE_SLOT = "이 반은 그 날 자리 수업이 한 번뿐입니다";

/**
 * 드래그 한 번(교시 이동)의 판정 — **서버가 다시 돌린다**([[#77]]).
 *
 * 🔴 **반은 안 바뀐다** — 다른 교시의 *다른 반*으로 끄는 것은 한 동작에 두 축(반·교시)을 바꾸는 것이라
 *    거절한다. 반을 바꾸고 싶으면 그 교시 안에서 옮긴다(그쪽이 `placement.ts`).
 * 🔴 출결이 찍힌 카드는 애초에 안 잡힌다(`seatMoveBlockReason`) — 여기서도 한 번 더 본다.
 */
export function validateSeatPeriodMove(v: {
  classId: string;
  toClassId: string;
  fromSlot: string;
  toSlot: string;
  /** 그 날 이 반이 이 자리에 걸린 교시들. */
  classSlots: readonly string[];
  /** 옮길 카드가 이미 찍혔나 — 찍혔으면 이유를 담아 온다(없으면 null). */
  markedReason: string | null;
}): { ok: true } | { error: string } {
  if (v.markedReason) return { error: v.markedReason };
  if (v.classId !== v.toClassId) return { error: SEAT_PERIOD_SAME_CLASS_ONLY };
  if (v.classSlots.length < 2) return { error: SEAT_PERIOD_ONE_SLOT };
  if (!v.classSlots.includes(v.toSlot)) return { error: SEAT_PERIOD_NO_SLOT };
  if (v.toSlot === v.fromSlot) return { error: "이미 그 교시에 있습니다" };
  return { ok: true };
}

/**
 * 고정을 물어볼 것인가 — 원장 *"한번 드래그한 학생은 … 고정할까요?"*.
 * 🔴 **이미 같은 교시로 고정돼 있으면 안 묻는다** — 같은 답을 두 번 묻는 창은 곧 아무도 안 읽는다.
 */
export function shouldAskSeatPin(v: {
  pinnedSlot: string | null | undefined;
  toSlot: string;
}): boolean {
  return v.pinnedSlot !== v.toSlot;
}
