import { describe, expect, it } from "vitest";
import type { NextDestinationDay, NextDestinationSlot } from "./next-destination";
import {
  seatStudentClash,
  seatStudentClashMessage,
  seatStudentClassesOf,
  type SeatStudentClass,
} from "./student-classes";

/**
 * 학생 축 — 그날 **이 자리 밖** 수업(원장 2026-09-11 *"LAB실에서 내가 드래그하고 싶은건 '다른 시간대'의 수업"*).
 * 실측(읽기 전용, injaewon 2026-09-11 금): 이도윤B = PL1b 14:20~15:00(본원606) → 15:00 랩실(본원603) → 수학
 * `초등M 초4 EL2S` 16:20~17:15·17:15~18:10(배치엔 방이 없고 반 기본 강의실 본원205).
 */
const FRI = 5; // dowIndexOf("fri")

const slot = (
  start: string,
  end: string | null,
  room: string | null,
  seatLabel: NextDestinationSlot["seatLabel"] = null,
): NextDestinationSlot => ({ start, end, room, seatLabel });

type Live = readonly [studentId: string, classId: string, attendanceDays?: string[]];
function dayOf(
  live: readonly Live[],
  slots: Record<string, NextDestinationSlot[]>,
  classNames: Record<string, string> = {},
  todayIdx = FRI,
): NextDestinationDay {
  return {
    live: live.map(([studentId, classId, attendanceDays]) => ({
      studentId,
      classId,
      attendanceDays: attendanceDays ?? null,
    })),
    slotsByClass: new Map(Object.entries(slots)),
    classNames: new Map(Object.entries(classNames)),
    todayIdx,
  };
}

const DOYUN = dayOf(
  [
    ["y", "PL1b"],
    ["y", "EL2S"],
  ],
  {
    PL1b: [slot("14:20", "15:00", "본원606"), slot("15:00", "15:40", "본원603", "LAB")],
    EL2S: [slot("17:15", "18:10", "본원205"), slot("16:20", "17:15", "본원205")],
  },
  { PL1b: "PL1b", EL2S: "초등M 초4 EL2S" },
);

describe("학생별 이 자리 밖 수업", () => {
  it("🔴 이 자리(랩실) 배치는 빼고 나머지를 시작 순으로 — 이도윤B 금", () => {
    expect(seatStudentClassesOf(DOYUN, "lab")).toEqual({
      y: [
        { classId: "PL1b", className: "PL1b", start: "14:20", end: "15:00", room: "본원606", seatLabel: null },
        { classId: "EL2S", className: "초등M 초4 EL2S", start: "16:20", end: "17:15", room: "본원205", seatLabel: null },
        { classId: "EL2S", className: "초등M 초4 EL2S", start: "17:15", end: "18:10", room: "본원205", seatLabel: null },
      ],
    });
  });

  it("다른 자리 배치는 넣는다 — 랩실에서 본 JJ실, JJ실에서 본 랩실(그 시각 그 학생은 거기 있다)", () => {
    const d = dayOf([["a", "JP1"]], {
      JP1: [slot("14:20", "15:00", "본원603", "LAB"), slot("17:20", "18:00", "본원305", "JJ")],
    });
    expect(seatStudentClassesOf(d, "lab").a?.map((c) => `${c.start} ${c.seatLabel}`)).toEqual(["17:20 JJ"]);
    expect(seatStudentClassesOf(d, "jj").a?.map((c) => `${c.start} ${c.seatLabel}`)).toEqual(["14:20 LAB"]);
  });

  it("분리등원 — 그날 안 오는 반의 수업은 학생 축에 없다(다음 행선지 접기와 같은 판정)", () => {
    const d = dayOf(
      [
        ["a", "JP1"],
        ["a", "MATH", ["mon"]],
      ],
      { JP1: [slot("14:20", "15:00", "본원603", "LAB")], MATH: [slot("16:20", "17:15", "본원205")] },
    );
    expect(seatStudentClassesOf(d, "lab")).toEqual({ a: [] });
  });

  it("🔴 키 없음 = 모름 · 빈 배열 = 이 자리 밖 수업이 없다고 확인됨", () => {
    const d = dayOf([["w", "PL1b"]], { PL1b: [slot("15:00", "15:40", "본원603", "LAB")] });
    const out = seatStudentClassesOf(d, "lab");
    expect(out).toEqual({ w: [] });
    // 조회가 돌지 않은 학생(그날 유효한 수강이 없다)은 키 자체가 없다 — 빈 배열로 지어내지 않는다.
    expect("z" in out).toBe(false);
    expect(seatStudentClassesOf(dayOf([], {}), "lab")).toEqual({});
  });

  it("같은 반·같은 시각이 두 줄(중복 수강 행)이면 한 번만", () => {
    const d = dayOf(
      [
        ["a", "EL2S"],
        ["a", "EL2S"],
      ],
      { EL2S: [slot("16:20", "17:15", "본원205"), slot("16:20", "17:15", "본원205")] },
    );
    expect(seatStudentClassesOf(d, "lab").a).toHaveLength(1);
  });

  it("반 이름·끝 시각을 모르면 null — 지어내지 않는다", () => {
    const d = dayOf([["a", "X"]], { X: [slot("16:20", null, null)] });
    expect(seatStudentClassesOf(d, "lab")).toEqual({
      a: [{ classId: "X", className: null, start: "16:20", end: null, room: null, seatLabel: null }],
    });
  });
});

describe("학생 축 겹침 — 옮기려는 교시와 겹치는 이 학생의 다른 수업(원장 2026-09-11 이후)", () => {
  const c = (start: string, end: string | null, extra: Partial<SeatStudentClass> = {}): SeatStudentClass => ({
    classId: "EL2S",
    className: "초등M 초4 EL2S",
    start,
    end,
    room: "본원205",
    seatLabel: null,
    ...extra,
  });
  const lab = (start: string, end: string) => ({ start, ends: [end] });

  it("🔴 이도윤B — 16:20 랩실은 수학 16:20~17:15와 겹친다", () => {
    const [math] = seatStudentClassesOf(DOYUN, "lab").y!.filter((x) => x.start === "16:20");
    expect(seatStudentClash(seatStudentClassesOf(DOYUN, "lab").y, lab("16:20", "17:00"))).toEqual(math);
  });

  it("경계 접촉은 겹침이 아니다(앱 단일 소스 `timeRangesOverlap`) — 15:40~16:20 뒤 16:20 시작", () => {
    expect(seatStudentClash([c("16:20", "17:15")], lab("15:40", "16:20"))).toBeNull();
    expect(seatStudentClash([c("14:20", "15:00")], lab("15:00", "15:40"))).toBeNull();
  });

  it("교시 끝이 여럿이면 가장 늦은 끝까지가 그 교시다(아직 방에 있는 시간을 빼지 않는다)", () => {
    expect(seatStudentClash([c("17:10", "18:00")], { start: "16:20", ends: ["17:00", "17:20"] })).not.toBeNull();
    expect(seatStudentClash([c("17:20", "18:00")], { start: "16:20", ends: ["17:00", "17:20"] })).toBeNull();
  });

  it("🔴 끝을 모르면 아는 것만 — 시작이 같으면 겹치고, 모르는 것으로는 막지 않는다", () => {
    expect(seatStudentClash([c("16:20", null)], lab("16:20", "17:00"))).not.toBeNull();
    // 끝을 모르는 수업이 교시 안에서 시작하면 겹친다(교시 구간이 그 시작을 품는다).
    expect(seatStudentClash([c("16:40", null)], lab("16:20", "17:00"))).not.toBeNull();
    // 끝을 모르는 수업이 교시보다 먼저 시작했으면 판정할 수 없다 — 막지 않는다.
    expect(seatStudentClash([c("16:00", null)], lab("16:20", "17:00"))).toBeNull();
    // 교시 끝을 모르면 수업 구간이 교시 시작을 품을 때만.
    expect(seatStudentClash([c("16:00", "16:40")], { start: "16:20", ends: [] })).not.toBeNull();
    expect(seatStudentClash([c("16:40", "17:20")], { start: "16:20", ends: [] })).toBeNull();
  });

  it("🔴 재료가 없으면(모름) 막지 않는다 — undefined ≠ 빈 배열이지만 둘 다 겹침은 없다", () => {
    expect(seatStudentClash(undefined, lab("16:20", "17:00"))).toBeNull();
    expect(seatStudentClash([], lab("16:20", "17:00"))).toBeNull();
  });

  it("문장은 반 이름·시각을 적고, 다른 자리면 사람이 읽는 방 이름(raw `JJ` 금지)", () => {
    expect(seatStudentClashMessage(c("16:20", "17:15"))).toBe(
      "그 시각에 이 학생의 다른 수업(초등M 초4 EL2S 16:20~17:15)이 있습니다 — 겹치는 시간으로는 옮길 수 없습니다",
    );
    const jj = seatStudentClashMessage(c("17:20", "18:00", { className: "JP1", seatLabel: "JJ" }));
    expect(jj).toContain("(JP1 · JJ실 17:20~18:00)");
    expect(seatStudentClashMessage(c("16:20", null, { className: null }))).toContain("(다른 반 16:20)");
  });
});
