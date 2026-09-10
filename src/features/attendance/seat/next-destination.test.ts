import { describe, expect, it } from "vitest";
import { applySeatPeriodChoicesByPeriod, resolveSeatPeriodChoices } from "./period-choice";
import {
  foldNextDestination,
  seatStayStartsByStudent,
  seatStaysFor,
  type NextDestinationDay,
  type NextDestinationSlot,
  type SeatStays,
} from "./next-destination";

/**
 * 다음 행선지 접기 — 원장 2026-09-10 *"17:20 304호 가야함처럼"* × 같은 날 교시 선택(0255a) *"다른 시간으로 옮기기"*.
 * 실측(읽기 전용, injaewon 2026-09-10 유효 배치): 랩실 57줄이 전부 `본원603`(라벨 `603`). 랩실이 하루 두 번 도는
 * 반×요일 8개 중 두 랩실 사이에 제 반 수업이 **없는** 것은 MEC1-5 수(수업 15:00·15:40 본원606 → 랩실 16:20·17:00)
 * 하나뿐이다 — ①은 그 모양으로 잰다(JP1 목은 사이에 15:00·15:40 본원601 수업이 끼어 옛 접기도 같은 답).
 */
const WED = 3; // dowIndexOf("wed")
const THU = 4; // dowIndexOf("thu")
const LAB = "본원603";
const lab = (start: string, room: string | null = LAB): NextDestinationSlot => ({ start, room, seatLabel: "LAB" });
const cls = (start: string, room: string | null): NextDestinationSlot => ({ start, room, seatLabel: null });

type Live = readonly [studentId: string, classId: string, attendanceDays?: string[]];
function dayOf(
  live: readonly Live[],
  slots: Record<string, NextDestinationSlot[]>,
  todayIdx = THU,
): NextDestinationDay {
  return {
    live: live.map(([studentId, classId, attendanceDays]) => ({
      studentId,
      classId,
      attendanceDays: attendanceDays ?? null,
    })),
    slotsByClass: new Map(Object.entries(slots)),
    todayIdx,
  };
}
const staysOf = (startsByStudent: Record<string, string[]>, classIds: string[] = []): SeatStays => ({
  seat: "lab",
  startsByStudent,
  classIds,
});

describe("옛 동작 — 이 자리 재료가 없으면(JJ실·옛 호출부) 배치표 그대로", () => {
  const day = dayOf([["a", "JP1"]], { JP1: [lab("14:20"), lab("16:20"), cls("17:20", "본원304")] });

  it("그 반의 그 요일 배치 전부가 후보다 — 이 자리 배치까지", () => {
    expect(foldNextDestination(day, "14:20")).toEqual({
      startByStudent: { a: "16:20" },
      roomByStudent: { a: LAB },
    });
  });

  it("기준 교시와 같거나 이르게 시작하는 수업은 행선지가 아니다", () => {
    expect(foldNextDestination(day, "17:20")).toEqual({ startByStudent: {}, roomByStudent: {} });
  });

  it("분리등원 — 그날 안 오는 반의 배치는 후보가 아니다", () => {
    const d = dayOf(
      [
        ["a", "JP1"],
        ["a", "MATH", ["mon"]],
      ],
      { JP1: [lab("14:20"), lab("16:20")], MATH: [cls("15:00", "본원201")] },
    );
    expect(foldNextDestination(d, "14:20").startByStudent).toEqual({ a: "16:20" });
  });

  it("🔴 더 이른 수업에 방이 없으면 앞서 담은 늦은 수업의 방을 남기지 않는다", () => {
    const d = dayOf(
      [
        ["a", "X"],
        ["a", "Y"],
      ],
      { X: [cls("18:00", "본원304")], Y: [cls("17:00", null)] },
    );
    expect(foldNextDestination(d, "14:20")).toEqual({ startByStudent: { a: "17:00" }, roomByStudent: {} });
  });
});

describe("교시 선택을 얹은 명단이 진실 — 옮겨 나간 이 자리 교시를 안내하지 않는다", () => {
  it("① 하루 두 번 도는 반(MEC1-5 수 16:20·17:00)을 16:20으로 고정한 학생 — 16:20 교시에서 17:00 랩실을 안내하지 않는다", () => {
    // 실데이터 모양 그대로 — 두 랩실 사이에 제 반 수업이 없다(수업은 앞의 15:00·15:40뿐).
    const d = dayOf(
      [
        ["a", "MEC1-5"],
        ["b", "MEC1-5"],
      ],
      { "MEC1-5": [cls("15:00", "본원606"), cls("15:40", "본원606"), lab("16:20"), lab("17:00")] },
      WED,
    );
    // 옛 접기(배치표)는 16:20으로 고정한 학생에게도 옮겨 나간 17:00 랩실을 적었다.
    expect(foldNextDestination(d, "16:20")).toEqual({
      startByStudent: { a: "17:00", b: "17:00" },
      roomByStudent: { a: LAB, b: LAB },
    });
    // 고정 안 한 학생(두 교시 모두에 선다)은 그대로 17:00 랩실이다 — 명단이 그렇게 말한다. 고정한 학생은 그날 더
    // 갈 곳이 없어 행선지 줄이 없다(지어내지 않는다).
    const out = foldNextDestination(d, "16:20", staysOf({ a: ["16:20"], b: ["16:20", "17:00"] }, ["MEC1-5"]));
    expect(out).toEqual({ startByStudent: { b: "17:00" }, roomByStudent: { b: LAB } });
  });

  it("고정해도 두 랩실 사이의 제 반 수업이 먼저면 그게 행선지다 — JP1 목이 그 모양이라 ①이 안 보인다", () => {
    const d = dayOf([["a", "JP1"]], {
      JP1: [lab("14:20"), cls("15:00", "본원601"), cls("15:40", "본원601"), lab("16:20")],
    });
    const want = { startByStudent: { a: "15:00" }, roomByStudent: { a: "본원601" } };
    // 옛 접기와 새 접기가 같은 답 — 이 반으로 수정을 확인하면 "고쳐진 게 없다"로 잘못 읽힌다.
    expect(foldNextDestination(d, "14:20")).toEqual(want);
    expect(foldNextDestination(d, "14:20", staysOf({ a: ["14:20"] }, ["JP1"]))).toEqual(want);
  });

  it("② 다른 시간으로 옮긴 학생(원래 17:00 → 남의 반 15:40) — 원래 17:00 랩실을 안내하지 않는다", () => {
    const d = dayOf([["c", "RTT5"]], {
      RTT5: [lab("17:00"), cls("18:00", "본원304")],
      LE1: [lab("15:40")],
    });
    expect(foldNextDestination(d, "15:40").startByStudent.c).toBe("17:00");
    const out = foldNextDestination(d, "15:40", staysOf({ c: ["15:40"] }, ["LE1", "RTT5"]));
    expect(out).toEqual({ startByStudent: { c: "18:00" }, roomByStudent: { c: "본원304" } });
  });

  it("③ 옮겨 가는 교시(남의 반 랩실 시각)도 행선지다 — 강의실은 그 시각의 이 자리 배치에서", () => {
    // d는 JP1(14:20 랩실)과 LE1(15:40 랩실)을 듣고, LE1 랩실을 PL4의 17:00으로 옮겼다.
    const d = dayOf(
      [
        ["d", "JP1"],
        ["d", "LE1"],
      ],
      { JP1: [lab("14:20")], LE1: [lab("15:40")], PL4: [lab("17:00")] },
    );
    expect(foldNextDestination(d, "14:20").startByStudent.d).toBe("15:40");
    const out = foldNextDestination(d, "14:20", staysOf({ d: ["14:20", "17:00"] }, ["JP1", "LE1", "PL4"]));
    expect(out).toEqual({ startByStudent: { d: "17:00" }, roomByStudent: { d: LAB } });
  });
});

describe("이 자리 교시의 강의실 — 같은 시각의 이 자리 배치에서만", () => {
  it("🔴 그 시각 배치가 없으면 시각만 적는다 — 방을 지어내지 않는다", () => {
    const d = dayOf([["e", "JP1"]], { JP1: [lab("14:20")] });
    expect(foldNextDestination(d, "14:20", staysOf({ e: ["14:20", "19:00"] }))).toEqual({
      startByStudent: { e: "19:00" },
      roomByStudent: {},
    });
  });

  it("🔴 그 시각 배치들이 서로 다른 방을 말하면 비운다(하나를 고르면 지어낸 방이다)", () => {
    const d = dayOf([["f", "JP1"]], {
      JP1: [lab("14:20")],
      PL4: [lab("17:00", "본원603")],
      RTT5: [lab("17:00", "바른603")],
    });
    const out = foldNextDestination(d, "14:20", staysOf({ f: ["14:20", "17:00"] }));
    expect(out).toEqual({ startByStudent: { f: "17:00" }, roomByStudent: {} });
  });

  it("방을 모르는 배치가 섞여도 아는 방이 하나면 그 방", () => {
    const d = dayOf([["f", "JP1"]], { JP1: [lab("14:20")], PL4: [lab("17:00", null)], RTT5: [lab("17:00")] });
    expect(foldNextDestination(d, "14:20", staysOf({ f: ["14:20", "17:00"] })).roomByStudent).toEqual({ f: LAB });
  });

  it("🔴 같은 시각 **다른 반의 수업** 방은 섞지 않는다 — 이 자리 라벨의 배치만 이 자리 교시의 방이다", () => {
    // 실데이터 목 16:20이 이 모양이다: JP1 랩실(본원603)과 LE1 원어민 수업(본원604)이 같은 시각이고, LE1은 랩실 반이라
    // 같은 배치 조회에 들어온다. 라벨을 안 가리면 두 방이 부딪혀 16:20 랩실로 가는 학생의 방이 통째로 비워진다.
    const d = dayOf([["g", "JP1"]], {
      JP1: [lab("14:20"), lab("16:20")],
      LE1: [lab("15:40"), cls("16:20", "본원604")],
    });
    expect(foldNextDestination(d, "14:20", staysOf({ g: ["14:20", "16:20"] }, ["JP1", "LE1"]))).toEqual({
      startByStudent: { g: "16:20" },
      roomByStudent: { g: LAB },
    });
  });
});

describe("이 자리 밖은 그대로", () => {
  it("다른 자리(JJ실) 배치는 랩실에서 본 진짜 행선지다 — 빼지 않는다", () => {
    const jj: NextDestinationSlot = { start: "17:20", room: "본원305", seatLabel: "JJ" };
    const d = dayOf([["a", "JP1"]], { JP1: [lab("14:20"), lab("16:20"), jj] });
    expect(foldNextDestination(d, "14:20", staysOf({ a: ["14:20"] }))).toEqual({
      startByStudent: { a: "17:20" },
      roomByStudent: { a: "본원305" },
    });
  });

  it("물은 학생만 담는다 — 명단 재료에 있는 다른 학생의 교시는 붙이지 않는다", () => {
    const d = dayOf([["a", "JP1"]], { JP1: [lab("14:20"), lab("16:20")] });
    const out = foldNextDestination(d, "14:20", staysOf({ a: ["14:20", "16:20"], z: ["16:20"] }));
    expect(Object.keys(out.startByStudent)).toEqual(["a"]);
  });

  it("⚠️ 같은 시각이면 수업 배치가 남는다 — 겹침은 시간표가 풀 문제라 여기서 고르지 않는다", () => {
    const d = dayOf(
      [
        ["a", "JP1"],
        ["a", "MATH"],
      ],
      { JP1: [lab("14:20")], MATH: [cls("17:00", "본원201")], PL4: [lab("17:00")] },
    );
    expect(foldNextDestination(d, "14:20", staysOf({ a: ["14:20", "17:00"] })).roomByStudent).toEqual({
      a: "본원201",
    });
  });
});

describe("이 자리 재료 — 그날 모든 교시의 명단에서", () => {
  const rosterByPeriod = {
    "16:20": [{ classId: "JP1", students: [{ id: "a" }] }],
    "14:20": [{ classId: "JP1", students: [{ id: "a" }, { id: "b" }] }],
    "17:00": [
      { classId: "PL4", students: [] },
      { classId: "LE1", students: [{ id: "c" }], visiting: { fromSlots: ["15:40"] } },
    ],
  };

  it("학생마다 서는 교시 — 오름차순·중복 없음 · 옮겨 온 묶음도 센다", () => {
    expect(seatStayStartsByStudent(rosterByPeriod)).toEqual({
      a: ["14:20", "16:20"],
      b: ["14:20"],
      c: ["17:00"],
    });
  });

  it("🔴 교시를 옮기는 자리(랩실)만 — JJ실은 undefined(= 옛 동작)", () => {
    expect(seatStaysFor("jj", rosterByPeriod)).toBeUndefined();
    const stays = seatStaysFor("lab", rosterByPeriod);
    // 빈 묶음의 반도 담는다 — 그 반의 배치가 그 시각 이 자리의 강의실을 알려 준다.
    expect(stays?.classIds).toEqual(["JP1", "LE1", "PL4"]);
    expect(stays?.startsByStudent.c).toEqual(["17:00"]);
  });
});

describe("실제 교시 선택 함수와 이어서 — 화면·서버가 쓰는 그 명단으로", () => {
  it("고정·다른 시간 이동을 얹은 명단에서 뽑은 재료가 옮겨 나간 랩실 안내를 막는다", () => {
    const raw = {
      "14:20": [{ classId: "JP1", students: [{ id: "a" }, { id: "b" }] }],
      "15:40": [{ classId: "LE1", students: [{ id: "c" }] }],
      "16:20": [{ classId: "JP1", students: [{ id: "a" }, { id: "b" }] }],
      "17:00": [{ classId: "PL4", students: [{ id: "p" }] }],
    };
    const applied = applySeatPeriodChoicesByPeriod(raw, {
      choices: resolveSeatPeriodChoices({
        moves: [{ classId: "LE1", studentId: "c", slotStart: "17:00" }],
        pins: [{ classId: "JP1", studentId: "a", slotStart: "14:20", effectiveFrom: "2026-09-01" }],
        date: "2026-09-10",
      }),
      slotsByClass: { JP1: ["14:20", "16:20"], LE1: ["15:40"], PL4: ["17:00"] },
      markedSlotsByCell: {},
      busyStartsByClass: { LE1: ["15:00", "16:20"] },
      blank: (s) => s,
    });
    const stays = seatStaysFor("lab", applied)!;
    expect(stays.startsByStudent).toEqual({ a: ["14:20"], b: ["14:20", "16:20"], c: ["17:00"], p: ["17:00"] });

    const d = dayOf(
      [
        ["a", "JP1"],
        ["b", "JP1"],
        ["c", "LE1"],
        ["p", "PL4"],
      ],
      {
        JP1: [lab("14:20"), lab("16:20"), cls("17:40", "본원304")],
        LE1: [lab("15:40"), cls("15:00", "본원302"), cls("16:20", "본원302"), cls("18:20", "본원302")],
        PL4: [lab("17:00")],
      },
    );
    // 🔴 b의 16:20 랩실 방은 같은 시각 **이 자리 배치**(JP1 랩실)에서만 — 같은 시각 LE1 수업(본원302)을 섞으면 두
    //    방이 부딪혀 비워진다(위 '이 자리 교시의 강의실' 참조). 결과 전체를 본다(시각만 보면 방이 빠져도 통과한다).
    expect(foldNextDestination(d, "14:20", stays)).toEqual({
      startByStudent: { a: "17:40", b: "16:20", c: "15:00", p: "17:00" },
      roomByStudent: { a: "본원304", b: LAB, c: "본원302", p: LAB },
    });
    // 17:00으로 옮겨 온 c — 옮겨 나간 15:40 랩실은 이미 지났고, 다음은 제 반의 18:20 수업이다.
    expect(foldNextDestination(d, "17:00", stays)).toMatchObject({
      startByStudent: { c: "18:20" },
      roomByStudent: { c: "본원302" },
    });
  });
});
