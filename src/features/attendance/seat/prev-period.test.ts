import { describe, expect, it } from "vitest";
import {
  nextSeatPeriodByStudent,
  prevAbsentFillTargets,
  prevPeriodAbsences,
  prevSeatPeriodFor,
  seatCellKey,
  seatDayCells,
  type SeatCellStatus,
  type SeatDayCells,
} from "./prev-period";

/** 교시 → [반, 학생, 상태] 목록으로 하루를 짧게 적는다. */
function day(spec: Record<string, [string, string, SeatCellStatus][]>): SeatDayCells {
  return seatDayCells(
    Object.keys(spec).map((start) => ({ start })),
    Object.fromEntries(
      Object.entries(spec).map(([start, cells]) => [
        start,
        [...new Set(cells.map(([classId]) => classId))].map((classId) => ({
          classId,
          students: cells
            .filter(([c]) => c === classId)
            .map(([, id, status]) => ({ id, status })),
        })),
      ]),
    ),
  );
}

describe("바로 앞 교시 — 그 학생이 실제로 선 교시 중 가장 늦은 것", () => {
  const d = day({
    "16:20": [["c1", "s1", "absent"]],
    "17:20": [["c2", "s2", "present"]],
    "18:20": [["c1", "s1", null], ["c2", "s2", null]],
  });

  it("빈 교시를 건너뛰고 그 학생이 선 교시를 집는다", () => {
    // s1은 17:20에 아예 안 온다 — 그 학생의 앞 교시는 16:20이다.
    expect(prevSeatPeriodFor(d, "18:20", "s1")).toBe("16:20");
    expect(prevSeatPeriodFor(d, "18:20", "s2")).toBe("17:20");
  });

  it("앞 교시에 한 번도 안 섰으면 판정하지 않는다(null)", () => {
    expect(prevSeatPeriodFor(d, "16:20", "s1")).toBeNull();
    expect(prevSeatPeriodFor(d, "17:20", "s1")).toBe("16:20");
  });

  it("🔴 '그 학생의 마지막 기록'을 최신순으로 집지 않는다 — 뒤 교시는 앞 교시가 아니다([[#112]])", () => {
    const back = day({
      "16:20": [["c1", "s1", "absent"]],
      "17:20": [["c1", "s1", "present"]],
    });
    // 16:20 칸에서 본 앞 교시는 없다(17:20은 뒤다).
    expect(prevSeatPeriodFor(back, "16:20", "s1")).toBeNull();
    expect(prevPeriodAbsences(back, "16:20")).toEqual({});
  });
});

describe("앞 교시 결석 후보", () => {
  it("앞 교시 결석이면 담고, 그 교시 시각을 함께 준다", () => {
    const d = day({
      "16:20": [["c1", "s1", "absent"], ["c1", "s2", "present"], ["c1", "s3", "late"]],
      "17:20": [["c1", "s1", null], ["c1", "s2", null], ["c1", "s3", null]],
    });
    expect(prevPeriodAbsences(d, "17:20")).toEqual({ [seatCellKey("c1", "s1")]: "16:20" });
  });

  it("🔴 이미 찍힌 칸도 후보에는 담는다 — 거르는 건 채우기 대상뿐(되돌리면 표식이 돌아와야 한다)", () => {
    const d = day({
      "16:20": [["c1", "s1", "absent"]],
      "17:20": [["c1", "s1", "present"]],
    });
    expect(prevPeriodAbsences(d, "17:20")).toEqual({ [seatCellKey("c1", "s1")]: "16:20" });
    expect(prevAbsentFillTargets(d, "17:20")).toEqual([]);
  });

  it("🔴 채우기 대상은 미체크 칸뿐이다 — 사람이 고쳐 둔 값을 절대 덮지 않는다", () => {
    const d = day({
      "16:20": [["c1", "s1", "absent"], ["c1", "s2", "absent"], ["c1", "s3", "absent"]],
      "17:20": [["c1", "s1", null], ["c1", "s2", "present"], ["c1", "s3", "late"]],
    });
    expect(prevAbsentFillTargets(d, "17:20")).toEqual([{ classId: "c1", studentId: "s1", prevStart: "16:20" }]);
  });

  it("자리판 밖 상태(보강 등)는 결석이 아니다", () => {
    const d = day({
      "16:20": [["c1", "s1", "makeup" as unknown as SeatCellStatus]],
      "17:20": [["c1", "s1", null]],
    });
    expect(prevPeriodAbsences(d, "17:20")).toEqual({});
  });

  it("앞 교시 칸이 둘인데 사실이 갈리면 판정하지 않는다(전부 결석일 때만)", () => {
    const split = day({
      "16:20": [["c1", "s1", "absent"], ["c2", "s1", "present"]],
      "17:20": [["c1", "s1", null]],
    });
    expect(prevPeriodAbsences(split, "17:20")).toEqual({});

    const both = day({
      "16:20": [["c1", "s1", "absent"], ["c2", "s1", "absent"]],
      "17:20": [["c1", "s1", null]],
    });
    expect(prevPeriodAbsences(both, "17:20")).toEqual({ [seatCellKey("c1", "s1")]: "16:20" });
  });

  it("🔴 같은 칸이 두 번 서도 대상은 하나다 — 중복 슬롯이 출결 행을 둘 만들면 시수가 두 배가 된다", () => {
    // 같은 반이 한 교시에 두 줄(동시에 유효한 중복 슬롯) → 명단에 그 학생이 두 번 들어온다.
    const dup: SeatDayCells = {
      starts: ["16:20", "17:20"],
      byStart: {
        "16:20": [{ classId: "c1", studentId: "s1", status: "absent" }],
        "17:20": [
          { classId: "c1", studentId: "s1", status: null },
          { classId: "c1", studentId: "s1", status: null },
        ],
      },
    };
    expect(prevAbsentFillTargets(dup, "17:20")).toEqual([{ classId: "c1", studentId: "s1", prevStart: "16:20" }]);
  });

  it("한 학생이 같은 교시에 두 반이면 칸이 둘이라 대상도 둘이다(각 반에 제 행이 필요하다)", () => {
    const two = day({
      "16:20": [["c1", "s1", "absent"]],
      "17:20": [["c1", "s1", null], ["c2", "s1", null]],
    });
    expect(prevAbsentFillTargets(two, "17:20")).toEqual([
      { classId: "c1", studentId: "s1", prevStart: "16:20" },
      { classId: "c2", studentId: "s1", prevStart: "16:20" },
    ]);
  });

  it("모호한 반은 후보에서 빠진다 — 아무도 못 쓰는 칸을 '3명'이라 세면 서버는 그보다 적게 쓴다", () => {
    const d = day({
      "16:20": [["c1", "s1", "absent"], ["c2", "s2", "absent"]],
      "17:20": [["c1", "s1", null], ["c2", "s2", null]],
    });
    expect(prevAbsentFillTargets(d, "17:20", ["c2"])).toEqual([{ classId: "c1", studentId: "s1", prevStart: "16:20" }]);
    // 되짚기까지 막지는 않는다 — 앞 교시 c2 칸은 그대로 보고, 후보에서만 뺀다.
    expect(prevPeriodAbsences(d, "17:20", ["c2"])).toEqual({ [seatCellKey("c1", "s1")]: "16:20" });
  });

  it("반이 달라도 같은 학생이면 이어 본다 — 자리는 방이지 반이 아니다", () => {
    const d = day({
      "16:20": [["c1", "s1", "absent"]],
      "17:20": [["c9", "s1", null]],
    });
    expect(prevAbsentFillTargets(d, "17:20")).toEqual([{ classId: "c9", studentId: "s1", prevStart: "16:20" }]);
  });

  it("첫 교시엔 후보가 없다(앞이 없다)", () => {
    const d = day({ "16:20": [["c1", "s1", null]], "17:20": [["c1", "s1", null]] });
    expect(prevPeriodAbsences(d, "16:20")).toEqual({});
    expect(prevAbsentFillTargets(d, "16:20")).toEqual([]);
  });

  it("없는 교시를 물어도 빈 값(터지지 않는다)", () => {
    const d = day({ "16:20": [["c1", "s1", "absent"]] });
    expect(prevPeriodAbsences(d, "99:99")).toEqual({});
    expect(prevAbsentFillTargets(d, "99:99")).toEqual([]);
    expect(nextSeatPeriodByStudent(d, "99:99")).toEqual({});
  });
});

describe("다음 수업 — 오늘 이 자리에서 다시 오는 가장 이른 교시", () => {
  const d = day({
    "16:20": [["c1", "s1", null], ["c1", "s2", null]],
    "17:20": [["c1", "s1", null]],
    "18:20": [["c1", "s1", null], ["c2", "s2", null]],
  });

  it("가장 이른 뒤 교시를 준다", () => {
    expect(nextSeatPeriodByStudent(d, "16:20")).toEqual({ s1: "17:20", s2: "18:20" });
  });

  it("뒤 교시가 없으면 키 자체가 없다(빈 칸)", () => {
    expect(nextSeatPeriodByStudent(d, "18:20")).toEqual({});
    expect(nextSeatPeriodByStudent(d, "17:20")).toEqual({ s1: "18:20", s2: "18:20" });
  });

  it("상태와 무관하다 — 이미 결석으로 찍혀 있어도 '이따 또 온다'는 사실은 그대로다", () => {
    const marked = day({
      "16:20": [["c1", "s1", "absent"]],
      "17:20": [["c1", "s1", "absent"]],
    });
    expect(nextSeatPeriodByStudent(marked, "16:20")).toEqual({ s1: "17:20" });
  });
});

describe("재료 접기", () => {
  it("교시를 시각 오름차순으로 세우고 반 명단을 한 줄로 편다", () => {
    const d = day({
      "18:20": [["c2", "s2", "present"]],
      "16:20": [["c1", "s1", null]],
    });
    expect(d.starts).toEqual(["16:20", "18:20"]);
    expect(d.byStart["18:20"]).toEqual([{ classId: "c2", studentId: "s2", status: "present" }]);
  });

  it("명단이 없는 교시도 빈 배열로 선다", () => {
    const d = seatDayCells([{ start: "16:20" }, { start: "17:20" }], { "16:20": [] });
    expect(d.byStart["17:20"]).toEqual([]);
  });
});
