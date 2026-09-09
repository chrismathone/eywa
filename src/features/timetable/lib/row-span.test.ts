import { describe, expect, it } from "vitest";

import { movedByTarget, movedCellBox, planRowSpans, visibleSpanRows } from "./row-span";

const row = (order: number, time: string) => ({ order, time });

// 실측 축(영어 통합뷰 한 줄) — EiE 40분 눈금 + 인재원 60분 두 행이 섞여 6행이 섰다.
const MIXED = [
  row(860, "14:20~15:00"),
  row(900, "15:00~15:40"),
  row(900.5, "15:00~16:00"),
  row(940, "15:40~16:20"),
  row(960, "16:00~17:00"),
  row(980, "16:20~17:00"),
];

describe("planRowSpans — 긴 교시를 짧은 교시 눈금에 얹는다", () => {
  it("60분 두 행이 접히고 40분 눈금만 남는다", () => {
    const plan = planRowSpans(MIXED);
    expect(plan.hidden.sort((a, b) => a - b)).toEqual([900.5, 960]);
    expect(visibleSpanRows(MIXED, plan).map((r) => r.time)).toEqual([
      "14:20~15:00",
      "15:00~15:40",
      "15:40~16:20",
      "16:20~17:00",
    ]);
  });

  it("15:00~16:00 = 15:00 행 처음부터 1.5칸", () => {
    const { moved } = planRowSpans(MIXED);
    expect(moved["900.5"]).toEqual({ order: 900, offset: 0, span: 1.5 });
  });

  it("16:00~17:00 = 15:40 행 절반부터 1.5칸(가운데가 비지 않는다)", () => {
    const { moved } = planRowSpans(MIXED);
    expect(moved["960"]).toEqual({ order: 940, offset: 0.5, span: 1.5 });
  });

  it("🔴 짧은 행은 절대 접지 않는다 — 긴 것부터 봐야 촘촘한 눈금이 남는다", () => {
    const plan = planRowSpans(MIXED);
    for (const t of [900, 940, 980, 860]) expect(plan.hidden).not.toContain(t);
  });

  it("덮이지 않는 행은 그대로 — 혼자 도는 60분 반은 접을 근거가 없다", () => {
    const rows = [row(860, "14:20~15:00"), row(900, "15:00~16:00")];
    expect(planRowSpans(rows)).toEqual({ hidden: [], moved: {} });
  });

  it("한쪽이 삐져나오면 접지 않는다(부분만 덮임)", () => {
    // 15:00~16:00은 15:00~15:40 + 15:40~16:20으로 덮이지만, 16:20~17:20은 아무도 안 덮는다.
    const rows = [row(900, "15:00~15:40"), row(940, "15:40~16:20"), row(980, "16:20~17:20")];
    expect(planRowSpans(rows).hidden).toEqual([]);
  });

  it("시각이 없는 행(주말 축)은 판정에서 빠진다", () => {
    const rows = [row(900, ""), row(940, ""), row(960, "")];
    expect(planRowSpans(rows)).toEqual({ hidden: [], moved: {} });
  });

  it("행이 하나뿐이면 아무 일도 없다", () => {
    expect(planRowSpans([row(900, "15:00~16:00")])).toEqual({ hidden: [], moved: {} });
  });

  it("movedByTarget — 놓일 행별로 모은다(그리는 쪽이 한 번만 만든다)", () => {
    const plan = planRowSpans(MIXED);
    const byTarget = movedByTarget(plan);
    expect(byTarget.get(900)?.map((m) => m.from)).toEqual([900.5]);
    expect(byTarget.get(940)?.map((m) => m.from)).toEqual([960]);
    expect(byTarget.get(860)).toBeUndefined();
  });

  it("계획이 없으면 축은 그대로(호출부가 분기를 안 적게)", () => {
    expect(visibleSpanRows(MIXED, null)).toHaveLength(6);
    expect(movedByTarget(null).size).toBe(0);
  });
});

describe("movedCellBox — 접힌 칸이 행 구분선을 먹지 않는다", () => {
  const H = 32; // PERIOD_H(구분선 1px 포함한 행 피치)

  it("🔴 행 경계에서 끝나는 칸은 1px 짧다 — 그 자리가 구분선이다", () => {
    // 16:00~17:00 = 15:40 행 절반부터 1.5칸 → 0.5+1.5=2.0(경계에서 끝). 48px을 그대로 그리면
    // 아래 행의 border-b를 덮어 그 줄만 가로선이 사라진다(원장 2026-09-09 "JJ / 전양원 사이").
    const { moved } = planRowSpans(MIXED);
    expect(movedCellBox(moved["960"]!, H)).toEqual({ top: 16, height: 47 });
  });

  it("행 중간에서 끝나는 칸은 그대로 — 돌려줄 선이 없다", () => {
    // 15:00~16:00 = 15:00 행 처음부터 1.5칸 → 0+1.5=1.5(행 한가운데서 끝).
    const { moved } = planRowSpans(MIXED);
    expect(movedCellBox(moved["900.5"]!, H)).toEqual({ top: 0, height: 48 });
  });

  it("span 안쪽 경계는 덮은 채로 둔다 — 한 수업 가운데를 선이 가로지르면 안 된다", () => {
    // 2칸을 통째로 차지하는 칸: 사이 경계(1개)는 덮고, 끝나는 경계 1px만 돌려준다.
    expect(movedCellBox({ offset: 0, span: 2 }, H)).toEqual({ top: 0, height: 63 });
  });

  it("소수 누적오차가 있어도 경계로 본다", () => {
    const box = movedCellBox({ offset: 0.5, span: 1.4999999999 }, H);
    expect(box.height).toBeCloseTo(1.5 * H - 1, 6); // -1이 적용됐다 = 경계로 봤다
  });
});
