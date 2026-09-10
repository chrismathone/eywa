import { describe, expect, it } from "vitest";
import { keepUsedRows } from "./used-rows";

describe("keepUsedRows — 수업 없는 교시 행 빼기(통합뷰 섹션 축 · 학생 수업 탭 격자 공용)", () => {
  // order는 교시축 규약 그대로 — 시작이 같은 교시는 소수부로 갈린다(900 / 900.5).
  const rows = [
    { order: 860, time: "14:20~15:00" },
    { order: 900, time: "15:00~15:40" },
    { order: 900.5, time: "15:00~16:00" },
    { order: 940, time: "15:40~16:20" },
  ];

  it("쓴 행만 남기고 순서는 그대로", () => {
    expect(keepUsedRows(rows, new Set([940, 860])).map((r) => r.time)).toEqual(["14:20~15:00", "15:40~16:20"]);
  });

  it("🔴 시작이 같은 두 교시 — 쓴 쪽만 남는다(order가 행마다 달라야 하는 이유)", () => {
    expect(keepUsedRows(rows, new Set([900.5])).map((r) => r.time)).toEqual(["15:00~16:00"]);
  });

  it("⚠️ 아무 행도 안 쓰면 원본 전부 — 0행 격자는 '반이 깨진 것'으로 보인다", () => {
    expect(keepUsedRows(rows, new Set())).toEqual(rows);
  });
});
