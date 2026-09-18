import { describe, expect, it } from "vitest";
import { buildLabSplitDefaults, labSplitKey, labSplitSlotShows } from "./lab-split";

// PL1b 화요일 실배치: 14:20 LAB(일반) · 15:40 *LAB. 월요일은 15:00 LAB 하나.
const TUE = [
  { classId: "pl1b", start: "14:20", separate: false },
  { classId: "pl1b", start: "15:40", separate: true },
];
const ROSTER = new Map([["pl1b", ["s1", "s2", "s3"]]]);

describe("LAB실 '따로 수업(*LAB)' 학생 배정 (원장 2026-09-17·18)", () => {
  it("켠 학생은 *LAB 교시에만, 끈 학생은 일반 LAB 교시에만", () => {
    const out = buildLabSplitDefaults({ slots: TUE, studentsByClass: ROSTER, flagged: new Set([labSplitKey("pl1b", "s1")]) });
    expect(out[labSplitKey("pl1b", "s1")]).toEqual(["15:40"]);
    expect(out[labSplitKey("pl1b", "s2")]).toEqual(["14:20"]);
    expect(out[labSplitKey("pl1b", "s3")]).toEqual(["14:20"]);
  });

  it("🔴 *LAB 교시는 켠 학생 전용 — 아무도 안 켰으면 그 교시 명단은 빈다(원장 2026-09-18)", () => {
    // 같은 날 아침의 "켠 학생이 없으면 손대지 않는다"를 원장이 뒤집었다: *"*lab은 *lab이 체크된 학생만 떠야함"*.
    const out = buildLabSplitDefaults({ slots: TUE, studentsByClass: ROSTER, flagged: new Set() });
    expect(out[labSplitKey("pl1b", "s1")]).toEqual(["14:20"]);
    expect(out[labSplitKey("pl1b", "s3")]).toEqual(["14:20"]);
  });

  it("🔴 그 날 *LAB 교시가 없는 반은 손대지 않는다 — 켠 학생을 월요일 LAB에서 빼지 않는다", () => {
    const mon = [{ classId: "pl1b", start: "15:00", separate: false }];
    expect(
      buildLabSplitDefaults({ slots: mon, studentsByClass: ROSTER, flagged: new Set([labSplitKey("pl1b", "s1")]) }),
    ).toEqual({});
  });

  it("🔴 끈 학생이 갈 일반 LAB이 그 날 없으면 손대지 않는다 — 명단에서 사람이 사라지지 않게", () => {
    const onlySep = [{ classId: "pl1b", start: "15:40", separate: true }];
    const out = buildLabSplitDefaults({
      slots: onlySep,
      studentsByClass: ROSTER,
      flagged: new Set([labSplitKey("pl1b", "s1")]),
    });
    // 켠 학생도 갈 곳이 그 한 교시뿐이라 바뀌는 것이 없다(전부 서면 기본값을 안 만든다).
    expect(out).toEqual({});
  });

  it("🔴 판정 한 벌 — 자리 출석부·시간표·원생 시간표가 같은 답을 낸다", () => {
    const base = { dayHasSeparate: true, dayHasNormal: true };
    expect(labSplitSlotShows({ ...base, slotSeparate: true, flagged: true })).toBe(true);
    expect(labSplitSlotShows({ ...base, slotSeparate: false, flagged: true })).toBe(false);
    expect(labSplitSlotShows({ ...base, slotSeparate: true, flagged: false })).toBe(false);
    expect(labSplitSlotShows({ ...base, slotSeparate: false, flagged: false })).toBe(true);
    // 그 날 *LAB이 없는 반은 아무것도 안 바꾼다(켠 학생도 월요일 LAB에 그대로 선다).
    expect(labSplitSlotShows({ slotSeparate: false, flagged: true, dayHasSeparate: false, dayHasNormal: true })).toBe(true);
    // 끈 학생이 갈 일반 LAB이 없으면 *LAB에라도 세운다(사라지는 것이 최악).
    expect(labSplitSlotShows({ slotSeparate: true, flagged: false, dayHasSeparate: true, dayHasNormal: false })).toBe(true);
  });

  it("다른 반은 영향이 없다 · 같은 시각 줄이 둘이면 *LAB 쪽으로 본다", () => {
    const slots = [
      ...TUE,
      { classId: "pl1b", start: "15:40", separate: false },
      { classId: "other", start: "14:20", separate: false },
    ];
    const out = buildLabSplitDefaults({
      slots,
      studentsByClass: new Map([...ROSTER, ["other", ["o1"]]]),
      flagged: new Set([labSplitKey("pl1b", "s1")]),
    });
    expect(out[labSplitKey("pl1b", "s2")]).toEqual(["14:20"]);
    expect(out[labSplitKey("other", "o1")]).toBeUndefined();
  });
});
