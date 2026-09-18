import { describe, expect, it } from "vitest";
import {
  applySeatPeriodChoices,
  applySeatPeriodChoicesByPeriod,
  blankSeatCell,
  resolveSeatPeriodChoices,
  seatChoiceKey,
  seatChoiceTarget,
  seatShowsAtPeriod,
  shouldAskSeatPin,
  validateSeatPeriodMove,
  SEAT_PERIOD_CLASS_BUSY,
  SEAT_PERIOD_NO_SLOT,
  SEAT_PERIOD_SAME,
  type SeatVisiting,
} from "./period-choice";

const JP1 = ["14:20", "16:20"];

describe("그 날짜에 유효한 선택", () => {
  it("고정은 시작일 이후에만 적용된다 — 과거 화면은 기록 그대로", () => {
    const pins = [{ classId: "JP1", studentId: "a", slotStart: "16:20", effectiveFrom: "2026-09-10" }];
    expect(resolveSeatPeriodChoices({ moves: [], pins, date: "2026-09-03" })).toEqual({});
    expect(resolveSeatPeriodChoices({ moves: [], pins, date: "2026-09-10" })).toEqual({
      "JP1|a": "16:20",
    });
    expect(resolveSeatPeriodChoices({ moves: [], pins, date: "2026-09-17" })).toEqual({
      "JP1|a": "16:20",
    });
  });

  it("하루짜리가 고정을 이긴다 — 오늘만 옮긴 것이 되튀지 않게", () => {
    const out = resolveSeatPeriodChoices({
      moves: [{ classId: "JP1", studentId: "a", slotStart: "14:20" }],
      pins: [{ classId: "JP1", studentId: "a", slotStart: "16:20", effectiveFrom: "2026-01-01" }],
      date: "2026-09-10",
    });
    expect(out[seatChoiceKey("JP1", "a")]).toBe("14:20");
  });
});

/** 실측 2026-09-10(목) 랩실 교시 — LE1은 15:40만, 15:00·16:20엔 원어민 수업이 있다. */
const THU = ["14:20", "15:00", "15:40", "16:20", "17:00", "17:40", "18:20"];
const LE1_BUSY = ["15:00", "16:20"];

describe("선택이 가리키는 교시", () => {
  it("제 반 자리 교시는 언제나 유효하다(하루 두 번 도는 반)", () => {
    expect(seatChoiceTarget({ chosen: "16:20", classSlots: JP1 })).toBe("16:20");
    expect(seatChoiceTarget({ chosen: "16:20", classSlots: JP1, periodStarts: THU })).toBe("16:20");
  });

  it("🔑 다른 시간 — 그날 이 자리 교시이고 제 반 다른 수업과 안 겹치면 유효", () => {
    expect(
      seatChoiceTarget({ chosen: "17:00", classSlots: ["15:40"], periodStarts: THU, busyStarts: LE1_BUSY }),
    ).toBe("17:00");
  });

  it("🔴 교시 목록을 모르면(옛 호출부) 다른 시간 선택은 판정하지 않는다", () => {
    expect(seatChoiceTarget({ chosen: "17:00", classSlots: ["15:40"] })).toBeNull();
  });

  it("🔴 그날 이 자리에 없는 교시면 버린다 — 시간표가 바뀌어도 사람이 안 사라진다", () => {
    expect(seatChoiceTarget({ chosen: "19:00", classSlots: ["15:40"], periodStarts: THU })).toBeNull();
  });

  it("🔴 그 시각에 제 반의 다른 수업이 있으면 버린다 — 기록 키가 겹쳐 서로를 덮는다", () => {
    expect(
      seatChoiceTarget({ chosen: "16:20", classSlots: ["15:40"], periodStarts: THU, busyStarts: LE1_BUSY }),
    ).toBeNull();
  });
});

describe("제 반 자리 교시에 서는가", () => {
  const base = { classSlots: JP1, markedSlots: [] as string[] };

  it("선택이 없으면 지금까지 그대로 — 모든 교시에 선다", () => {
    expect(seatShowsAtPeriod({ ...base, chosen: null, slotStart: "14:20" })).toBe(true);
    expect(seatShowsAtPeriod({ ...base, chosen: undefined, slotStart: "16:20" })).toBe(true);
  });

  it("고른 교시에만 선다", () => {
    expect(seatShowsAtPeriod({ ...base, chosen: "16:20", slotStart: "16:20" })).toBe(true);
    expect(seatShowsAtPeriod({ ...base, chosen: "16:20", slotStart: "14:20" })).toBe(false);
  });

  it("🔴 사실이 규칙을 이긴다 — 이미 기록이 있는 교시에서는 안 감춘다", () => {
    expect(
      seatShowsAtPeriod({ ...base, chosen: "16:20", slotStart: "14:20", markedSlots: ["14:20"] }),
    ).toBe(true);
    expect(
      seatShowsAtPeriod({
        chosen: "17:00",
        slotStart: "15:40",
        classSlots: ["15:40"],
        markedSlots: ["15:40"],
        periodStarts: THU,
      }),
    ).toBe(true);
  });

  it("🔴 고른 교시가 그 날 없으면 선택을 버린다 — 시간표가 바뀌어도 사람이 안 사라진다", () => {
    expect(seatShowsAtPeriod({ ...base, chosen: "18:20", slotStart: "14:20" })).toBe(true);
    expect(seatShowsAtPeriod({ ...base, chosen: "18:20", slotStart: "16:20" })).toBe(true);
  });

  it("자리 교시가 하나뿐이고 선택도 그 교시면 감출 것이 없다", () => {
    expect(seatShowsAtPeriod({ chosen: "14:20", slotStart: "14:20", classSlots: ["14:20"], markedSlots: [] })).toBe(
      true,
    );
  });

  it("🔑 다른 시간으로 옮긴 학생은 제 교시에서 빠진다(그 반의 자리 교시가 하나뿐이어도)", () => {
    const le1 = { classSlots: ["15:40"], markedSlots: [] as string[], periodStarts: THU, busyStarts: LE1_BUSY };
    expect(seatShowsAtPeriod({ ...le1, chosen: "17:00", slotStart: "15:40" })).toBe(false);
    // 겹치는 시각으로의 선택은 버려진다 — 제 교시에 그대로 선다.
    expect(seatShowsAtPeriod({ ...le1, chosen: "16:20", slotStart: "15:40" })).toBe(true);
  });

  it("🔴 옮겨 간 교시에서 이미 찍혔으면 선택이 지워져도 제 교시에 되살리지 않는다", () => {
    expect(
      seatShowsAtPeriod({ chosen: null, slotStart: "15:40", classSlots: ["15:40"], markedSlots: [], movedOutMarked: true }),
    ).toBe(false);
  });
});

describe("한 교시 명단에서 빼기", () => {
  const rosters = [
    { classId: "JP1", students: [{ id: "a" }, { id: "b" }] },
    { classId: "LT6", students: [{ id: "c" }] },
  ];
  const opts = {
    choices: { "JP1|a": "16:20" },
    slotsByClass: { JP1, LT6: ["16:20", "18:20"] },
    markedSlotsByCell: {},
  };

  it("14:20에서는 a가 빠지고 16:20에서는 남는다", () => {
    expect(applySeatPeriodChoices(rosters, { ...opts, slotStart: "14:20" })[0]!.students).toEqual([
      { id: "b" },
    ]);
    expect(applySeatPeriodChoices(rosters, { ...opts, slotStart: "16:20" })[0]!.students).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  it("전원이 빠져도 반 묶음은 남는다 — 반이 사라지면 '수업이 없어졌나'가 된다", () => {
    const out = applySeatPeriodChoices(rosters, {
      ...opts,
      slotStart: "14:20",
      choices: { "JP1|a": "16:20", "JP1|b": "16:20" },
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.students).toEqual([]);
  });

  it("다른 반은 그대로다", () => {
    expect(applySeatPeriodChoices(rosters, { ...opts, slotStart: "14:20" })[1]!.students).toEqual([
      { id: "c" },
    ]);
  });

  it("옮겨 온 묶음(`visiting`)은 이미 판정을 마친 결과라 건드리지 않는다 — 두 번 걸어도 같다", () => {
    const visiting = { classId: "LE1", students: [{ id: "x" }], visiting: { fromSlots: ["15:40"] } };
    const out = applySeatPeriodChoices([visiting], {
      ...opts,
      slotStart: "17:00",
      choices: { "LE1|x": "17:00" },
      slotsByClass: { LE1: ["15:40"] },
    });
    expect(out[0]).toBe(visiting);
  });
});

type Stu = { id: string; name: string; status: string | null };
const stu = (id: string, status: string | null = null): Stu => ({ id, name: id.toUpperCase(), status });
const blank = (s: Stu): Stu => ({ ...s, status: null });
type Grp = { classId: string; students: Stu[]; visiting?: SeatVisiting | null };

/** 목요일 랩실 하루 — LE1(15:40) · PL4/RTT5(17:00) · JP1(14:20·16:20). */
function thursday(): Record<string, Grp[]> {
  return {
    "14:20": [{ classId: "JP1", students: [stu("j1"), stu("j2")] }],
    "15:40": [{ classId: "LE1", students: [stu("a"), stu("b")] }],
    "16:20": [{ classId: "JP1", students: [stu("j1"), stu("j2")] }],
    "17:00": [
      { classId: "PL4", students: [stu("p")] },
      { classId: "RTT5", students: [stu("r")] },
    ],
  };
}
const slotsByClass = { JP1: ["14:20", "16:20"], LE1: ["15:40"], PL4: ["17:00"], RTT5: ["17:00"] };
const busyStartsByClass = { LE1: ["15:00", "16:20"] };

describe("하루치에 얹기 — 감추기 + 다른 시간에서 옮겨 온 학생 세우기", () => {
  it("🔑 LE1 박한솔을 17:00으로 — 15:40에서 빠지고 17:00에 '옮겨 온 LE1' 묶음으로 선다", () => {
    const out = applySeatPeriodChoicesByPeriod(thursday(), {
      choices: { "LE1|a": "17:00" },
      slotsByClass,
      markedSlotsByCell: {},
      busyStartsByClass,
      blank,
    });
    expect(out["15:40"]![0]!.students.map((s) => s.id)).toEqual(["b"]);
    const at17 = out["17:00"]!;
    // 정규 묶음 뒤에 붙는다 — 반 id는 **원래 반**(출결이 그 반으로 저장된다).
    expect(at17.map((r) => r.classId)).toEqual(["PL4", "RTT5", "LE1"]);
    expect(at17[2]!.visiting).toEqual({ fromSlots: ["15:40"] });
    expect(at17[2]!.students).toEqual([{ id: "a", name: "A", status: null }]);
    // 다른 교시는 그대로.
    expect(out["14:20"]).toEqual(thursday()["14:20"]);
  });

  it("옮겨 온 학생은 빈 칸으로 선다 — 제 교시의 상태를 목표 교시로 옮겨 적지 않는다", () => {
    const day = thursday();
    day["15:40"]![0]!.students[0] = stu("a", "absent");
    const out = applySeatPeriodChoicesByPeriod(day, {
      choices: { "LE1|a": "17:00" },
      slotsByClass,
      markedSlotsByCell: {},
      blank,
    });
    // (상태가 있는데 기록 칸이 없는 인위적 입력 — blank가 목표 교시의 칸을 비우는지만 본다)
    expect(out["17:00"]!.find((r) => r.visiting)!.students[0]!.status).toBeNull();
  });

  it("🔴 겹치는 시각(제 반 다른 수업)으로의 선택은 버린다 — 감추지도 세우지도 않는다", () => {
    const day = thursday();
    const out = applySeatPeriodChoicesByPeriod(
      { ...day, "16:20": [...day["16:20"]!, { classId: "KW3", students: [stu("k")] }] },
      { choices: { "LE1|a": "16:20" }, slotsByClass, markedSlotsByCell: {}, busyStartsByClass, blank },
    );
    expect(out["15:40"]![0]!.students.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out["16:20"]!.some((r) => r.visiting)).toBe(false);
  });

  it("🔴 그날 이 자리에 없는 교시로의 선택도 버린다", () => {
    const out = applySeatPeriodChoicesByPeriod(thursday(), {
      choices: { "LE1|a": "19:00" },
      slotsByClass,
      markedSlotsByCell: {},
      blank,
    });
    expect(out["15:40"]![0]!.students.map((s) => s.id)).toEqual(["a", "b"]);
    expect(Object.values(out).flat().some((r) => r.visiting)).toBe(false);
  });

  it("🔴 제 교시에 이미 찍혔으면 선택이 있어도 옮겨 가지 않는다 — 한 번 온 학생을 두 교시에 세우지 않는다", () => {
    const out = applySeatPeriodChoicesByPeriod(thursday(), {
      choices: { "LE1|a": "17:00" },
      slotsByClass,
      markedSlotsByCell: { "LE1|a": ["15:40"] },
      blank,
    });
    expect(out["15:40"]![0]!.students.map((s) => s.id)).toEqual(["a", "b"]);
    expect(out["17:00"]!.some((r) => r.visiting)).toBe(false);
  });

  it("🔴 옮겨 간 교시에서 찍힌 기록은 선택이 지워져도 그 교시에 서고, 제 교시엔 되살아나지 않는다", () => {
    const fact = stu("a", "present");
    const out = applySeatPeriodChoicesByPeriod(thursday(), {
      choices: {},
      slotsByClass,
      markedSlotsByCell: { "LE1|a": ["17:00"] },
      offSlotByCell: { "LE1|a": { "17:00": fact } },
      blank,
    });
    expect(out["15:40"]![0]!.students.map((s) => s.id)).toEqual(["b"]);
    expect(out["17:00"]!.find((r) => r.visiting)!.students).toEqual([fact]);
  });

  it("🔴 명단 밖 학생은 선택·기록이 있어도 서지 않는다 — 재료는 그 반의 제 교시 명단뿐", () => {
    const out = applySeatPeriodChoicesByPeriod(thursday(), {
      choices: { "LE1|outsider": "17:00" },
      slotsByClass,
      markedSlotsByCell: {},
      offSlotByCell: { "LE1|ghost": { "17:00": stu("ghost", "present") } },
      blank,
    });
    expect(out["17:00"]!.some((r) => r.visiting)).toBe(false);
  });

  it("하루 두 번 도는 반(①)은 종전 그대로 — 감추기만 하고 옮겨 온 묶음을 만들지 않는다", () => {
    const out = applySeatPeriodChoicesByPeriod(thursday(), {
      choices: { "JP1|j1": "16:20" },
      slotsByClass,
      markedSlotsByCell: {},
      blank,
    });
    expect(out["14:20"]![0]!.students.map((s) => s.id)).toEqual(["j2"]);
    expect(out["16:20"]!.map((r) => r.classId)).toEqual(["JP1"]);
    expect(out["16:20"]![0]!.students.map((s) => s.id)).toEqual(["j1", "j2"]);
  });

  it("선택이 없으면 입력과 같은 명단이다(묶음 순서·학생 순서 그대로)", () => {
    const day = thursday();
    const out = applySeatPeriodChoicesByPeriod(day, { choices: {}, slotsByClass, markedSlotsByCell: {}, blank });
    expect(out).toEqual(day);
  });
});

describe("빈 칸", () => {
  it("상태·메모·기록자·JJ 칸을 비우고 이름·학교·학년은 둔다", () => {
    const s = {
      id: "a",
      name: "박한솔",
      school: "칠성초",
      grade: "5",
      status: "present" as "present" | "absent" | "late" | null,
      recordedBy: "데스크",
      fromSeat: true,
      note: "병원",
      attitude: "3",
      listeningLevel: "L2",
      memorizedWords: "40",
      progressNote: "p",
    };
    expect(blankSeatCell(s)).toEqual({
      id: "a",
      name: "박한솔",
      school: "칠성초",
      grade: "5",
      status: null,
      recordedBy: null,
      fromSeat: false,
      note: null,
      attitude: null,
      listeningLevel: null,
      memorizedWords: null,
      progressNote: null,
    });
  });
});

describe("교시 이동 판정", () => {
  const le1 = {
    fromSlot: "15:40",
    toSlot: "17:00",
    classSlots: ["15:40"],
    periodStarts: THU,
    busyStarts: LE1_BUSY,
    markedReason: null as string | null,
  };

  it("🔑 다른 시간으로 옮긴다 — 그 반이 그 교시에 자리 수업이 없어도", () => {
    expect(validateSeatPeriodMove(le1)).toEqual({ ok: true, crossTime: true });
  });

  it("제 반의 다른 자리 교시로도 옮긴다(하루 두 번 도는 반)", () => {
    expect(
      validateSeatPeriodMove({ ...le1, fromSlot: "14:20", toSlot: "16:20", classSlots: JP1, busyStarts: [] }),
    ).toEqual({ ok: true, crossTime: false });
  });

  it("🔴 그 시각에 그 반의 다른 수업이 있으면 못 옮긴다", () => {
    expect(validateSeatPeriodMove({ ...le1, toSlot: "16:20" })).toEqual({ error: SEAT_PERIOD_CLASS_BUSY });
  });

  it("그날 이 자리에 없는 교시로는 못 옮긴다", () => {
    expect(validateSeatPeriodMove({ ...le1, toSlot: "19:00" })).toEqual({ error: SEAT_PERIOD_NO_SLOT });
  });

  it("🔴 출결이 찍힌 카드는 여기서도 막힌다", () => {
    expect(validateSeatPeriodMove({ ...le1, markedReason: "출결이 찍힘" })).toEqual({ error: "출결이 찍힘" });
  });

  it("이미 그 교시면 아무 일도 아니다 — 문장은 '다른 시간에 놓으라'(원장 2026-09-11)", () => {
    expect(validateSeatPeriodMove({ ...le1, toSlot: "15:40" })).toEqual({ error: SEAT_PERIOD_SAME });
    expect(SEAT_PERIOD_SAME).toContain("다른 시간 교시에 놓으세요");
  });

  describe("🔴 학생 축 — 그 시각에 그 학생의 다른 수업이 있으면 못 옮긴다(2026-09-11)", () => {
    const math = {
      classId: "EL2S",
      className: "초등M 초4 EL2S",
      start: "17:00",
      end: "17:55",
      room: "본원205",
      seatLabel: null,
    };

    it("겹치면 그 수업(반 이름·시각)을 적어 거절한다", () => {
      expect(validateSeatPeriodMove({ ...le1, studentClasses: [math], toEnds: ["17:40"] })).toEqual({
        error: "그 시각에 이 학생의 다른 수업(초등M 초4 EL2S 17:00~17:55)이 있습니다 — 겹치는 시간으로는 옮길 수 없습니다",
      });
    });

    it("반 축이 먼저다 — 같은 시각이면 반 축 문장(원장 2026-09-11 A 확정 — 그 축은 그대로 막는다)", () => {
      expect(
        validateSeatPeriodMove({
          ...le1,
          toSlot: "16:20",
          studentClasses: [{ ...math, start: "16:20", end: "17:00" }],
          toEnds: ["17:00"],
        }),
      ).toEqual({ error: SEAT_PERIOD_CLASS_BUSY });
    });

    it("🔴 목표 교시 안에서 시작하는 수업(17:20)도 겹침이다 — 교시 끝(`toEnds`)을 알아야 보인다", () => {
      const late = { ...math, start: "17:20", end: "18:10" };
      expect(validateSeatPeriodMove({ ...le1, studentClasses: [late], toEnds: ["17:40"] })).toEqual({
        error: "그 시각에 이 학생의 다른 수업(초등M 초4 EL2S 17:20~18:10)이 있습니다 — 겹치는 시간으로는 옮길 수 없습니다",
      });
      // 끝을 모르면 판정하지 않는다(모르는 것으로 막지 않는다) — 이 차이가 곧 `toEnds`를 빠뜨리면 생기는 구멍이다.
      expect(validateSeatPeriodMove({ ...le1, studentClasses: [late] })).toEqual({ ok: true, crossTime: true });
    });

    it("재료가 없으면(모름) 이 축은 판정하지 않는다 — 화면은 막지 않고 서버가 채워 다시 본다", () => {
      expect(validateSeatPeriodMove({ ...le1, toEnds: ["17:40"] })).toEqual({ ok: true, crossTime: true });
    });

    it("경계 접촉은 겹침이 아니다(17:40 끝 → 17:40 시작)", () => {
      expect(
        validateSeatPeriodMove({
          ...le1,
          studentClasses: [{ ...math, start: "17:40", end: "18:30" }],
          toEnds: ["17:40"],
        }),
      ).toEqual({ ok: true, crossTime: true });
    });
  });
});

describe("고정을 물을 것인가", () => {
  it("이미 같은 교시로 고정돼 있으면 안 묻는다", () => {
    expect(shouldAskSeatPin({ pinnedSlot: "16:20", toSlot: "16:20" })).toBe(false);
    expect(shouldAskSeatPin({ pinnedSlot: "14:20", toSlot: "16:20" })).toBe(true);
    expect(shouldAskSeatPin({ pinnedSlot: null, toSlot: "16:20" })).toBe(true);
  });
});

describe("LAB '따로 수업(*LAB)' 배정 = 선택이 없을 때의 기본값 (0271b, 원장 2026-09-17·18)", () => {
  // PL1b 화: 14:20 LAB · 15:40 *LAB. s1 = 켠 학생(*LAB) · s2 = 끈 학생(일반).
  const rosters = { "14:20": [{ classId: "pl1b", students: [{ id: "s1" }, { id: "s2" }] }], "15:40": [{ classId: "pl1b", students: [{ id: "s1" }, { id: "s2" }] }] };
  const base = {
    slotsByClass: { pl1b: ["14:20", "15:40"] },
    markedSlotsByCell: {} as Record<string, string[]>,
    defaultSlotsByCell: { "pl1b|s1": ["15:40"], "pl1b|s2": ["14:20"] },
    blank: <S,>(s: S) => s,
  };
  const ids = (out: Record<string, { students: readonly { id: string }[] }[]>, start: string) =>
    (out[start] ?? []).flatMap((r) => r.students.map((s) => s.id));

  it("선택이 없으면 배정대로 — 켠 학생은 *LAB 교시에만, 끈 학생은 일반 교시에만", () => {
    const out = applySeatPeriodChoicesByPeriod(rosters, { ...base, choices: {} });
    expect(ids(out, "14:20")).toEqual(["s2"]);
    expect(ids(out, "15:40")).toEqual(["s1"]);
  });

  it("🔴 사람이 옮긴 교시(선택)가 배정을 이긴다 — 켠 학생을 오늘만 14:20으로", () => {
    const out = applySeatPeriodChoicesByPeriod(rosters, { ...base, choices: { "pl1b|s1": "14:20" } });
    expect(ids(out, "14:20")).toEqual(["s1", "s2"]);
    expect(ids(out, "15:40")).toEqual([]);
  });

  it("🔴 이미 찍힌 기록이 배정을 이긴다 — 끈 학생이 *LAB 교시에서 찍혔으면 그 교시에도 선다", () => {
    const out = applySeatPeriodChoicesByPeriod(rosters, {
      ...base,
      choices: {},
      markedSlotsByCell: { "pl1b|s2": ["15:40"] },
    });
    expect(ids(out, "15:40")).toEqual(["s1", "s2"]);
  });

  it("배정 재료가 없으면 종전 그대로 — 두 교시 모두에 선다", () => {
    expect(seatShowsAtPeriod({ chosen: null, slotStart: "15:40", classSlots: ["14:20", "15:40"], markedSlots: [] })).toBe(true);
    expect(
      seatShowsAtPeriod({ chosen: null, slotStart: "15:40", classSlots: ["14:20", "15:40"], markedSlots: [], defaultSlots: [] }),
    ).toBe(true);
  });
});
