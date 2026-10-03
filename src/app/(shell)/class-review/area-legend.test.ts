import { expect, it } from "vitest";
import { areaLegendLabel, stripLeadingCircledNumber } from "./area-legend";

it("drops one leading circled number and does not prefix it again", () => {
  expect(stripLeadingCircledNumber("① 수업 태도")).toBe("수업 태도");
  expect(areaLegendLabel("①", "① 수업 태도", 12)).toBe("① 수업 태도(12점)");
  expect(areaLegendLabel("①", "① ① 수업")).toBe("① 수업");
  expect(areaLegendLabel("②", "수업")).toBe("② 수업");
  expect(areaLegendLabel("①", "①")).toBe("①");
  expect(areaLegendLabel("①", "", 4)).toBe("①(4점)");
  expect(areaLegendLabel("㉑", "㉑ 발표")).toBe("㉑ 발표");
});
