/**
 * 자리(랩실) 출석부의 **교시 선택** — 순수 규칙(IO 없음, Vitest). 0255a `seat_period_moves`/`seat_period_pins`.
 *
 * 원장 2026-09-10(①): *"그 학생만 그 시간대에 어쩔 수 없는 사정으로 다른 학생과 다른 시간에 랩실을 듣는
 * 학생이 있어. 그래서 하루에 랩이 2회인 EiE 수업이 존재하는것."* + *"한번 드래그한 학생은 '다음에도 이
 * LAB실 수업을 이 시간대로 고정할까요?'라고 물어볼것."*
 * 원장 2026-09-10(② 화면을 보며): *"내가 원한건, 같은 시간 내에서 이동하는게 아니라 "다른 시간"으로
 * 이동하고 싶은것."* · *"다른시간으로 옮기는게 목적. 같은 시간은 의미없음."*
 *
 * 🔑 **두 모양이 한 규칙이다.**
 *    ① **하루 두 번 도는 반**(실측 8개 반×요일, JP1 목 14:20·16:20 등) — 그 반의 다른 자리 교시를 고른다.
 *       학생은 이미 두 교시 명단에 다 있으므로 나머지 교시에서 **감춘다**.
 *    ② **다른 시간** — 그 반은 그 교시에 자리 수업이 없다(실측 LE1 목 15:40만 → 17:00 PL4·RTT5 교시로).
 *       제 반 교시에서 감추고, 목표 교시에 **옮겨 온 학생 묶음**(원래 반 이름·색)으로 세운다.
 * 🔴 **세우는 학생은 그날 이 자리 명단에 이미 있는 학생뿐이다** — 재료는 그 반의 제 교시 명단(같은 날·
 *    같은 자리)이고, 학원 전체에서 학생을 끌어오는 경로가 아니다(보강 규약 2026-08-19 그대로).
 * 🔴 **출결 귀속은 안 바뀐다** — 옮겨 온 학생의 기록도 `(원래 반, 목표 교시, 자리 라벨)`로 저장된다. 그래서
 *    옮겨 온 묶음의 반 id는 **원래 반**이다(화면이 귀속을 거짓 없이 말한다 — "PL4 학생"처럼 보이면 안 된다).
 * 🔴 **시간표를 고치는 것이 아니다** — 반·수강·시간표는 한 줄도 안 바뀐다. 바뀌는 것은 명단에 보이는 자리뿐.
 * 🔴 **모르면 옛 모습 그대로다.** 선택이 없거나, 고른 교시가 그 날 이 자리에 없거나(시간표가 바뀌었다),
 *    그 시각에 그 반의 **다른 수업**이 있으면(같은 `(반·학생·날짜·교시)` 키라 기록이 서로를 덮는다)
 *    선택을 버리고 제 반 교시에 그대로 세운다. 명단에서 사람이 사라지는 것이 이 화면의 최악이다.
 * 🔴 **사실이 규칙을 이긴다** — 기록이 있는 교시가 그날의 자리다(함수별 주석).
 */
import { seatStudentClash, seatStudentClashMessage, type SeatStudentClass } from "./student-classes";

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
 * 선택이 그 날 **어디를 가리키는가** — 유효하면 그 교시, 버려야 하면 null.
 *
 * 🔑 판정 순서:
 *    ① 제 반의 자리 교시면 언제나 유효(하루 두 번 도는 반의 "어느 쪽인가").
 *    ② 그 날 이 자리 교시 목록(`periodStarts`)을 모르면 **다른 시간 선택은 판정하지 않는다**(옛 호출부).
 *    ③ 그 날 이 자리에 그 교시가 없으면 버린다(시간표가 바뀌었다).
 *    ④ 그 시각에 **제 반의 다른 수업**이 있으면 버린다 — 기록 키 `(반·학생·날짜·교시)`가 겹쳐 두 사실이
 *       서로를 덮는다(실측 LE1 목: 15:00·16:20은 원어민 수업이라 그리로는 못 간다).
 */
export function seatChoiceTarget(v: {
  chosen: string | null | undefined;
  /** 그 날 이 반이 이 자리에 걸린 교시들("HH:MM"). */
  classSlots: readonly string[];
  /** 그 날 이 자리의 교시들. 없으면 옛 규칙(제 반 자리 교시만 유효). */
  periodStarts?: readonly string[];
  /** 그 날 이 반의 **다른**(이 자리가 아닌) 수업 시작들. */
  busyStarts?: readonly string[];
}): string | null {
  const chosen = v.chosen;
  if (!chosen) return null;
  if (v.classSlots.includes(chosen)) return chosen;
  if (!v.periodStarts) return null;
  if (!v.periodStarts.includes(chosen)) return null;
  if (v.busyStarts?.includes(chosen)) return null;
  return chosen;
}

/**
 * 이 학생이 **제 반의 자리 교시** 명단에 서는가.
 *
 * 🔴 **사실이 규칙을 이긴다** — 그 교시에 이미 출결 기록이 있으면 선택이 뭐라 하든 세운다(MCS의
 *    *"사실이 달력을 이긴다"*와 같은 결). 안 그러면 지난 기록이 아무도 안 보는 칸에 숨는다.
 * 🔴 선택이 버려지면(`seatChoiceTarget`이 null) 다 세운다 — 한 사람도 명단에서 사라지지 않는 쪽으로 실패한다.
 * 🔴 **옮겨 간 교시에서 이미 찍혔으면**(`movedOutMarked`) 선택이 지워졌어도 제 교시에 되살리지 않는다 —
 *    그날 그 학생의 자리 수업은 거기서 끝났다. 되살리면 빈 칸이 다시 서고 일괄 버튼이 한 번 온 학생을 두 번
 *    찍는다(자리 시수 이중).
 * ⚠️ 제 반 자리 교시가 하나뿐이고 선택도 그 교시면 감출 것이 없다(결과는 선택이 없을 때와 같다).
 */
export function seatShowsAtPeriod(v: {
  /** 이 (반|학생)의 선택 — 없으면 지금까지 그대로(모든 교시에 선다). */
  chosen: string | null | undefined;
  slotStart: string;
  /** 그 날 이 반이 이 자리에 걸린 교시들("HH:MM"). */
  classSlots: readonly string[];
  /** 그 날 이 (반|학생)에 이미 기록이 있는 교시들. */
  markedSlots: readonly string[];
  /** 그 날 이 자리의 교시들 — 없으면 옛 규칙(다른 시간 선택은 버린다). */
  periodStarts?: readonly string[];
  /** 그 날 이 반의 다른 수업 시작들 — 그 시각으로의 선택은 버린다. */
  busyStarts?: readonly string[];
  /** 제 반 자리 교시 **밖**의 교시에서 이미 자리 기록이 찍혔는가(옮겨 가서 찍혔다). */
  movedOutMarked?: boolean;
}): boolean {
  if (v.markedSlots.includes(v.slotStart)) return true;
  const target = seatChoiceTarget(v);
  if (target) return target === v.slotStart;
  if (v.movedOutMarked) return false;
  return true;
}

/** 옮겨 온 학생 묶음의 표식 — 원래 반이 그 날 이 자리에 걸린 교시들("HH:MM"). */
export type SeatVisiting = { fromSlots: string[] };

/** 명단 한 묶음 — 이 모듈은 반 id와 학생 id만 본다. `visiting`이 있으면 다른 시간에서 옮겨 온 묶음이다. */
export type ChoiceRoster<S> = { classId: string; students: readonly S[]; visiting?: SeatVisiting | null };

/** 감추기 판정의 재료 — 화면과 서버가 같은 값을 넘긴다. */
export type SeatChoiceInputs = {
  choices: Readonly<Record<string, string>>;
  slotsByClass: Readonly<Record<string, readonly string[]>>;
  markedSlotsByCell: Readonly<Record<string, readonly string[]>>;
  /** 그 날 이 자리의 교시들. 없으면 옛 규칙(다른 시간 선택은 판정하지 않는다). */
  periodStarts?: readonly string[];
  /** 반 → 그 날 이 반의 다른 수업 시작들. */
  busyStartsByClass?: Readonly<Record<string, readonly string[]>>;
  /** `반id|학생id` → 제 반 자리 교시 밖에서 이미 자리 기록이 찍힌 교시들. */
  movedOutSlotsByCell?: Readonly<Record<string, readonly string[]>>;
};

/**
 * 한 교시 명단에서 **다른 교시로 정해진 학생을 뺀다**(감추기만) — 제 반 묶음에만 건다.
 *
 * ⚠️ 옮겨 온 묶음(`visiting`)은 이미 판정을 마친 결과라 그대로 둔다 — 두 번 걸어도 결과가 같게(멱등).
 * ⚠️ 빈 묶음(전원이 다른 교시로 갔다)도 **지우지 않는다** — 반이 통째로 사라지면 "이 반 수업이
 *    없어졌나" 싶어진다. 0명인 묶음을 보여 주는 판단은 화면 몫이다.
 */
export function applySeatPeriodChoices<R extends ChoiceRoster<{ id: string }>>(
  rosters: readonly R[],
  v: SeatChoiceInputs & { slotStart: string },
): R[] {
  return rosters.map((r) => {
    if (r.visiting) return r;
    return {
      ...r,
      students: r.students.filter((s) => {
        const key = seatChoiceKey(r.classId, s.id);
        return seatShowsAtPeriod({
          chosen: v.choices[key],
          slotStart: v.slotStart,
          classSlots: v.slotsByClass[r.classId] ?? [],
          markedSlots: v.markedSlotsByCell[key] ?? [],
          periodStarts: v.periodStarts,
          busyStarts: v.busyStartsByClass?.[r.classId],
          movedOutMarked: (v.movedOutSlotsByCell?.[key]?.length ?? 0) > 0,
        });
      }),
    };
  });
}

type StudentOf<R extends ChoiceRoster<{ id: string }>> = R["students"][number];

/**
 * 하루치 **전 교시**에 한꺼번에 얹는다 — 감추기 + **옮겨 온 학생 세우기**. 화면('전체' 보기·교시 하나 보기)과
 * 서버 쓰기 경로(출결 한 칸·일괄 출석·앞 교시 결석·교시 이동·배치)가 **같은 함수**를 쓴다.
 *
 * 🔴 **화면과 같은 집합이어야 한다.** 일괄 버튼은 "남은 N명"이라 적고 서버가 채우는데, 서버가 다른 명단을
 *    쓰면 **화면에 없는 학생이 조용히 찍히거나**, 화면에 선 학생이 "이 교시 명단에 없는 학생"으로 거절된다.
 * 🔴 **옮겨 온 학생의 재료는 그 반의 제 교시 명단뿐**이다(`homeByClass`) — 기록 있는 칸(`offSlotByCell`)도
 *    그 명단에 있는 학생만 세운다. 명단 밖 학생은 이 경로로 절대 안 들어온다.
 * 🔴 **선택으로 세우는 것은 제 교시에 기록이 없을 때만** — 제 반 자리 교시에서 이미 찍혔으면 그쪽이 그날의
 *    자리다(사실이 선택을 이긴다). 안 그러면 한 번 온 학생이 두 교시에 서서 두 번 찍힌다.
 * 🔑 옮겨 온 묶음은 **그 교시 정규 묶음 뒤에**, 반이 처음 나오는 순서로 붙는다(서버·화면이 같은 입력이면
 *    같은 순서 — 하이드레이션이 안 갈린다). 학생 순서는 제 교시 명단 순서 그대로다.
 */
export function applySeatPeriodChoicesByPeriod<R extends ChoiceRoster<{ id: string }>>(
  rosterByPeriod: Readonly<Record<string, readonly R[]>>,
  v: {
    choices: Readonly<Record<string, string>>;
    slotsByClass: Readonly<Record<string, readonly string[]>>;
    markedSlotsByCell: Readonly<Record<string, readonly string[]>>;
    /** 반 → 그 날 이 반의 다른 수업 시작들(겹치는 시각으로의 선택은 버린다). */
    busyStartsByClass?: Readonly<Record<string, readonly string[]>>;
    /** `반id|학생id` → 교시 → 제 반 자리 교시 밖에서 이미 찍힌 자리 기록을 얹은 학생. */
    offSlotByCell?: Readonly<Record<string, Readonly<Record<string, StudentOf<R>>>>>;
    /** 기록 없는 빈 칸 — 옮겨 온 학생을 그 교시에 처음 세울 때(상태·메모·기록자를 비운다). */
    blank: (s: StudentOf<R>) => StudentOf<R>;
  },
): Record<string, R[]> {
  const periodStarts = Object.keys(rosterByPeriod).sort((a, b) => a.localeCompare(b));
  const movedOutSlotsByCell: Record<string, string[]> = {};
  for (const [cell, bySlot] of Object.entries(v.offSlotByCell ?? {})) {
    const slots = Object.keys(bySlot);
    if (slots.length > 0) movedOutSlotsByCell[cell] = slots;
  }
  const ctx: SeatChoiceInputs = {
    choices: v.choices,
    slotsByClass: v.slotsByClass,
    markedSlotsByCell: v.markedSlotsByCell,
    periodStarts,
    busyStartsByClass: v.busyStartsByClass,
    movedOutSlotsByCell,
  };

  /** 반 → 그 반의 제 교시 명단(처음 나오는 교시 하나) — 옮겨 온 학생의 **유일한** 재료. */
  const homeByClass = new Map<string, R>();
  for (const start of periodStarts) {
    for (const r of rosterByPeriod[start] ?? []) {
      if (r.visiting || homeByClass.has(r.classId)) continue;
      homeByClass.set(r.classId, r);
    }
  }

  const out: Record<string, R[]> = {};
  for (const start of periodStarts) {
    const regular = applySeatPeriodChoices(rosterByPeriod[start] ?? [], { ...ctx, slotStart: start });
    const visiting: R[] = [];
    for (const [classId, home] of homeByClass) {
      const classSlots = v.slotsByClass[classId] ?? [];
      // 제 반 자리 교시면 정규 묶음이 이미 그 학생들을 들고 있다(감추기만 하면 된다).
      if (classSlots.includes(start)) continue;
      const busyStarts = v.busyStartsByClass?.[classId] ?? [];
      const students: StudentOf<R>[] = [];
      for (const s of home.students as readonly StudentOf<R>[]) {
        const key = seatChoiceKey(classId, s.id);
        const fact = v.offSlotByCell?.[key]?.[start];
        if (fact) {
          students.push(fact);
          continue;
        }
        const target = seatChoiceTarget({ chosen: v.choices[key], classSlots, periodStarts, busyStarts });
        if (target !== start) continue;
        const marked = v.markedSlotsByCell[key] ?? [];
        if (classSlots.some((slot) => marked.includes(slot))) continue;
        students.push(v.blank(s));
      }
      if (students.length === 0) continue;
      visiting.push({ ...home, students, visiting: { fromSlots: [...classSlots] } } as R);
    }
    out[start] = visiting.length > 0 ? [...regular, ...visiting] : regular;
  }
  return out;
}

/** 옮겨 온 학생의 빈 칸이 비워야 하는 필드들 — 자리 명단 학생(`SeatStudent`)이 구조적으로 만족한다. */
type SeatCellFields = {
  status: string | null;
  recordedBy: string | null;
  fromSeat: boolean;
  note: string | null;
  attitude: string | null;
  listeningLevel: string | null;
  memorizedWords: string | null;
  progressNote: string | null;
};

/**
 * 옮겨 온 학생의 **빈 칸** — 그 교시엔 아직 아무 기록이 없다. 이름·학교·학년만 제 교시 명단에서 가져오고
 * 상태·메모·기록자·JJ 칸은 전부 비운다(제 교시의 기록을 목표 교시의 사실로 옮겨 적으면 거짓이 된다).
 */
export function blankSeatCell<S extends SeatCellFields>(s: S): S {
  return {
    ...s,
    status: null,
    recordedBy: null,
    fromSeat: false,
    note: null,
    attitude: null,
    listeningLevel: null,
    memorizedWords: null,
    progressNote: null,
  } as S;
}

/** 교시 이동이 막히는 이유들 — 화면(놓을 곳 표식·끄는 카드 문장)과 서버(거절)가 같은 문장을 쓴다. */
export const SEAT_PERIOD_NO_SLOT = "그 시각에는 이 자리 수업이 없습니다";
export const SEAT_PERIOD_CLASS_BUSY =
  "그 시각에는 이 반의 다른 수업이 있습니다 — 겹치는 시간으로는 옮길 수 없습니다";
/** 같은 교시(원장 2026-09-11) — 화면에선 막힘이 아니라 **취소**(`seatDropVerdict`의 `same`). 서버에 오면 같은 말로 거절. */
export const SEAT_PERIOD_SAME = "같은 시간으로는 옮기지 않습니다 — 다른 시간 교시에 놓으세요";

/**
 * 드래그 한 번(교시 이동)의 판정 — 화면(`seatDropVerdict`)과 **서버가 같은 함수를 돌린다**([[#77]], 문장까지 같다).
 *
 * 🔑 **떨군 묶음의 반은 보지 않는다** — 원장이 원한 것은 "다른 시간"이다(같은 교시 안 반 묶음 이동은 2026-09-11 없앴다).
 *    그 교시의 어디에 떨구든 학생은 제 반 이름의 **옮겨 온 묶음**에 선다(출결이 원래 반으로 가므로 화면도 그 반 이름을 단다).
 * 🔴 출결이 찍힌 카드는 애초에 안 잡힌다(`seatMoveBlockReason`) — 여기서도 한 번 더 본다.
 * 🔴 **반 축** — 그 시각에 제 반의 다른 수업이 있으면 거절한다(`seatChoiceTarget` ④와 같은 이유 — 기록이 서로를 덮는다).
 * 🔴 **학생 축** — 그 시각에 그 학생의 다른 수업이 있으면 거절한다(`seatStudentClash`, 반 축은 과목이 다른 반을 못 본다).
 *    목표 교시의 **끝**(`toEnds`)까지 봐야 교시 안에서 시작하는 수업이 보인다. 재료가 없으면(undefined) 판정하지 않는다.
 */
export function validateSeatPeriodMove(v: {
  fromSlot: string;
  toSlot: string;
  /** 그 날 이 반이 이 자리에 걸린 교시들. */
  classSlots: readonly string[];
  /** 그 날 이 자리의 교시들. */
  periodStarts: readonly string[];
  /** 그 날 이 반의 다른 수업 시작들. */
  busyStarts: readonly string[];
  /** 옮길 카드가 이미 찍혔나 — 찍혔으면 이유를 담아 온다(없으면 null). */
  markedReason: string | null;
  /** 그 학생의 그날 **이 자리 밖** 수업(`seatStudentClassesOf`) — undefined면 모름(화면은 안 막고 서버가 채워 본다). */
  studentClasses?: readonly SeatStudentClass[];
  /** 목표 교시의 끝 시각들(`SeatPeriod.ends`) — 학생 축 겹침의 구간 끝(여럿이면 가장 늦은 끝). */
  toEnds?: readonly string[];
}): { ok: true; crossTime: boolean } | { error: string } {
  if (v.markedReason) return { error: v.markedReason };
  if (v.toSlot === v.fromSlot) return { error: SEAT_PERIOD_SAME };
  if (!v.periodStarts.includes(v.toSlot)) return { error: SEAT_PERIOD_NO_SLOT };
  const own = v.classSlots.includes(v.toSlot);
  if (!own && v.busyStarts.includes(v.toSlot)) return { error: SEAT_PERIOD_CLASS_BUSY };
  const clash = seatStudentClash(v.studentClasses, { start: v.toSlot, ends: v.toEnds ?? [] });
  if (clash) return { error: seatStudentClashMessage(clash) };
  return { ok: true, crossTime: !own };
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
