import { describe, expect, it } from "vitest";
import { buildMakeupSlotOptions } from "./makeup-slot";

describe("buildMakeupSlotOptions — 보강 확인창의 교시 선택지", () => {
  it("이름이 확정된 교시는 이름 + 시각으로 보여 준다", () => {
    expect(
      buildMakeupSlotOptions([{ slotStart: "16:20:00", slotEnd: "17:20:00", periodLabel: "1교시" }]),
    ).toEqual([{ start: "16:20", label: "1교시 16:20" }]);
  });

  it("이름이 없으면 시각 범위로 — 교시 이름을 지어내지 않는다(#106)", () => {
    expect(buildMakeupSlotOptions([{ slotStart: "16:20", slotEnd: "17:20" }])).toEqual([
      { start: "16:20", label: "16:20~17:20" },
    ]);
    expect(buildMakeupSlotOptions([{ slotStart: "16:20", slotEnd: null }])).toEqual([
      { start: "16:20", label: "16:20" },
    ]);
  });

  it("같은 시작시각은 접고 이른 순으로 정렬한다", () => {
    const out = buildMakeupSlotOptions([
      { slotStart: "18:20", slotEnd: "19:20" },
      { slotStart: "16:20", slotEnd: "17:20" },
      { slotStart: "16:20:00", slotEnd: "17:00:00" },
    ]);
    expect(out.map((o) => o.start)).toEqual(["16:20", "18:20"]);
  });

  it("같은 시각에 이름 있는 줄이 섞이면 이름 쪽을 살린다", () => {
    const out = buildMakeupSlotOptions([
      { slotStart: "16:20", slotEnd: "17:20" },
      { slotStart: "16:20", slotEnd: "17:20", periodLabel: "1교시" },
    ]);
    expect(out).toEqual([{ start: "16:20", label: "1교시 16:20" }]);
  });

  it("시각 형식이 아니면 버린다 — 고를 수 없는 선택지를 만들지 않는다", () => {
    expect(buildMakeupSlotOptions([{ slotStart: "" }, { slotStart: "오후" }])).toEqual([]);
  });

  it("교시가 없으면 빈 목록 — 확인창은 그때 교시를 묻지 않는다", () => {
    expect(buildMakeupSlotOptions([])).toEqual([]);
  });

  it("🔴 자리(LAB·JJ) 교시는 선택지에서 뺀다 — 거기 넣은 보강은 자리 화면에 영영 안 보인다", () => {
    const out = buildMakeupSlotOptions([
      { slotStart: "16:20", slotEnd: "17:20", teacherLabel: "JJ" },
      { slotStart: "17:20", slotEnd: "18:10", teacherLabel: "추민아" },
      { slotStart: "18:20", slotEnd: "19:20", teacherLabel: "LAB" },
    ]);
    expect(out.map((o) => o.start)).toEqual(["17:20"]);
  });

  it("자리 별칭(이주희=LAB)도 같은 판정을 받는다 — 문자열을 여기서 다시 비교하지 않는다", () => {
    expect(buildMakeupSlotOptions([{ slotStart: "16:20", teacherLabel: "이주희" }])).toEqual([]);
  });
});
