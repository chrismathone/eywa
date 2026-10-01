import { describe, expect, it } from "vitest";
import type { LayoutSection, OverviewLayout, PanelId, PanelSlot } from "@/features/dashboard/overview/layout";
import { fitColumns, packLayout } from "./pack";

const sec = (id: string, panels: PanelSlot[], title = id): LayoutSection => ({ id, title, note: "", panels });
const lay = (...sections: LayoutSection[]): OverviewLayout => ({ sections });
const none = new Set<PanelId>();

describe("fitColumns", () => {
  it("카드 수만큼 열 — 1·2·3장은 줄을 채운다", () => {
    expect(fitColumns(1, 4, false)).toBe(1);
    expect(fitColumns(2, 4, false)).toBe(2);
    expect(fitColumns(3, 4, false)).toBe(3);
    expect(fitColumns(4, 4, false)).toBe(4);
  });
  it("5·6·7장은 마지막 줄이 가장 덜 비는 열 수", () => {
    expect(fitColumns(5, 4, false)).toBe(3); // 3+2 (4열이면 4+1)
    expect(fitColumns(6, 4, false)).toBe(3);
    expect(fitColumns(7, 4, false)).toBe(4); // 4+3 (3열이면 3+3+1)
  });
  it("넓은 카드가 있으면 최소 2열", () => {
    expect(fitColumns(2, 4, true)).toBe(2);
  });
});

describe("packLayout", () => {
  it("한 줄을 못 채우는 구역은 제목 없이 앞 구역에 합친다", () => {
    const out = packLayout(lay(sec("a", ["subjects", "nowClasses", "sheets", "notices"]), sec("b", ["operations"]), sec("c", ["reports"])), none);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0]?.panels).toEqual(["subjects", "nowClasses", "sheets", "notices", "operations", "reports"]);
    expect(out.sections[0]?.title).toBe("a"); // 제목은 한 줄을 채우는 구역만
  });

  it("첫 구역이 모자라면 다음 구역 앞으로 합치고 제목은 한 줄을 채우는 쪽을 따른다", () => {
    const out = packLayout(lay(sec("a", ["subjects"]), sec("b", ["nowClasses", "sheets", "notices", "operations"])), none);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0]?.id).toBe("b");
    expect(out.sections[0]?.panels).toEqual(["subjects", "nowClasses", "sheets", "notices", "operations"]);
  });

  it("카드 1·2·3장짜리 구역은 폭을 나눠 가진다", () => {
    for (const n of [1, 2, 3]) {
      const panels = (["subjects", "nowClasses", "sheets"] as PanelSlot[]).slice(0, n);
      const out = packLayout(lay(sec("x", panels, "")), none);
      expect(out.sections[0]?.columns).toBe(n);
    }
  });

  it("5장은 3열(3+2), 줄 전체 카드는 맨 끝", () => {
    const out = packLayout(lay(sec("x", ["followup", "subjects", "nowClasses", "sheets", "notices", "operations"], "")), none);
    expect(out.sections[0]?.panels.at(-1)).toBe("followup");
    expect(out.sections[0]?.columns).toBe(3);
  });

  it("빈 카드는 맨 뒤 얇은 줄로 모으고 다른 줄의 열 수에 안 센다", () => {
    const out = packLayout(lay(sec("x", ["subjects", "nowClasses", "notices", "operations"], "")), new Set<PanelId>(["notices", "operations"]));
    expect(out.sections.map((s) => s.id)).toEqual(["x", "thin"]);
    expect(out.sections[0]?.panels).toEqual(["subjects", "nowClasses"]);
    expect(out.sections[0]?.columns).toBe(2);
    expect(out.sections[1]).toMatchObject({ thin: true, panels: ["notices", "operations"], columns: 2 });
  });

  it("전부 비면 얇은 줄만 남고 카드가 하나도 없으면 구역도 없다", () => {
    expect(packLayout(lay(sec("x", ["notices"], "")), new Set<PanelId>(["notices"])).sections.map((s) => s.thin)).toEqual([true]);
    expect(packLayout(lay(sec("x", [], "")), none).sections).toEqual([]);
  });

  it("한 줄을 채우는 구역은 제목을 지킨다 — 4장 이상", () => {
    const out = packLayout(lay(sec("a", ["subjects", "nowClasses", "sheets", "notices"]), sec("b", ["operations", "reports", "grades", "schools"])), none);
    expect(out.sections.map((s) => s.title)).toEqual(["a", "b"]);
  });

  it("간격 한 값 표식(evenGap)을 켠다 — 기본 운영실 배치는 이 함수를 안 거친다", () => {
    expect(packLayout(lay(sec("x", ["subjects"], "")), none).evenGap).toBe(true);
  });

  it("제목 없는 작은 첫 구역도 다음 구역 앞으로 합친다(한 줄 통째 차지 금지)", () => {
    const out = packLayout(lay(sec("a", ["studentsComp"], ""), sec("b", ["subjects", "nowClasses", "sheets", "notices"])), none);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0]?.panels).toEqual(["studentsComp", "subjects", "nowClasses", "sheets", "notices"]);
  });
});
