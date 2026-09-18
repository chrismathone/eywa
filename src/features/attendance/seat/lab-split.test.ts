import { describe, expect, it } from "vitest";
import { buildLabSplitDefaults, labSplitKey } from "./lab-split";

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

  it("🔴 그 반에 켠 학생이 없으면 손대지 않는다 — 배정 전엔 지금까지 화면 그대로", () => {
    expect(buildLabSplitDefaults({ slots: TUE, studentsByClass: ROSTER, flagged: new Set() })).toEqual({});
  });

  it("🔴 그 날 *LAB 교시가 없는 반은 손대지 않는다 — 켠 학생을 월요일 LAB에서 빼지 않는다", () => {
    const mon = [{ classId: "pl1b", start: "15:00", separate: false }];
    expect(
      buildLabSplitDefaults({ slots: mon, studentsByClass: ROSTER, flagged: new Set([labSplitKey("pl1b", "s1")]) }),
    ).toEqual({});
  });

  it("🔴 갈 교시가 없으면 그 학생은 손대지 않는다 — *LAB만 도는 날의 끈 학생이 명단에서 사라지지 않게", () => {
    const onlySep = [{ classId: "pl1b", start: "15:40", separate: true }];
    const out = buildLabSplitDefaults({
      slots: onlySep,
      studentsByClass: ROSTER,
      flagged: new Set([labSplitKey("pl1b", "s1")]),
    });
    expect(out).toEqual({ [labSplitKey("pl1b", "s1")]: ["15:40"] });
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
