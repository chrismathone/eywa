import { describe, expect, it } from "vitest";
import { busCellFromCell, busCellsFromBulk } from "./attendance-applied-bus";

/**
 * 방송 칸의 시수(원장 2026-09-11 수학 자동 시수) — 새로 만든 칸에만, 서버가 실제로 넣은 값으로.
 * 🔴 이게 빠지면 원스크린 '타임'이 1로 남고 보강 합침이 1.5 기록을 1 + 보강으로 덮는다(적대 리뷰 2026-09-11).
 */
describe("busCellsFromBulk — 일괄 응답 → 방송 칸", () => {
  it("새로 만든 칸엔 서버가 넣은 자동 시수, 값이 없으면 null(= 1)", () => {
    expect(
      busCellsFromBulk([
        { studentId: "s1", classId: "c1", created: true, autoUnits: 1.5 },
        { studentId: "s2", classId: "c1", created: true },
      ]),
    ).toEqual([
      { studentId: "s1", classId: "c1", units: 1.5 },
      { studentId: "s2", classId: "c1", units: null },
    ]);
  });

  it("갱신된 칸(created 아님)은 시수를 싣지 않는다 — 기존 시수가 보존됐으니 모른다", () => {
    const [cell] = busCellsFromBulk([{ studentId: "s1", classId: "c1", created: false, autoUnits: 2 }]);
    expect(cell).toEqual({ studentId: "s1", classId: "c1" });
    expect(cell).not.toHaveProperty("units");
  });
});

describe("busCellFromCell — 단건 응답 → 방송 칸", () => {
  it("autoUnits 키가 있으면(새 행) 그 값 — null도 싣는다", () => {
    expect(busCellFromCell("s1", "c1", { autoUnits: 2 })).toEqual({ studentId: "s1", classId: "c1", units: 2 });
    expect(busCellFromCell("s1", "c1", { autoUnits: null })).toEqual({ studentId: "s1", classId: "c1", units: null });
  });

  it("키가 없으면(갱신·결석) 시수를 싣지 않는다", () => {
    expect(busCellFromCell("s1", "c1", {})).toEqual({ studentId: "s1", classId: "c1" });
  });
});
