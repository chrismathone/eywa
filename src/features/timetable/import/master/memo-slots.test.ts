import { expect, it } from "vitest";
import { buildMasterPlan } from "./plan";
import { fixture } from "./test-fixture";

it("EiE Lab실 자리 메모를 반 연결 오류로 처리하지 않는다", () => {
  const f = fixture();
  f.grids.teacher.cells[3]![2] = "화";
  f.grids.teacher.cells[4]![2] = "EiE Lab실/605";
  const p = buildMasterPlan(f.input, f.grids, f.ctx, f.source);
  expect(p.mappings.map((m) => m.sheetName)).toEqual(["PL2"]);
  expect(p.issues.filter((i) => i.severity === "error")).toEqual([]);
  expect(p.issues.find((i) => i.key.startsWith("memo:"))).toMatchObject({
    severity: "warning",
    target: "EiE Lab실",
  });
});
