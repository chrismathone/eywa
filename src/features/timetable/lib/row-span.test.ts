import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  movedByTarget,
  movedCellBox,
  movedCellStartsOnRowLine,
  planRowSpans,
  visibleSpanRows,
} from "./row-span";

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

describe("movedCellStartsOnRowLine — 위 경계를 누가 긋나", () => {
  it("행 머리에서 시작하면 격자가 이미 그었다 — 칸은 안 긋는다", () => {
    // 15:00~16:00 = 15:00 행 **처음부터** → 바로 위 행의 border-b가 그 선이다.
    const { moved } = planRowSpans(MIXED);
    expect(movedCellStartsOnRowLine(moved["900.5"]!)).toBe(true);
  });

  it("🔴 행 한가운데서 시작하면 그 자리엔 아무 선도 없다 — 칸이 제 위 테두리를 긋는다", () => {
    // 16:00~17:00 = 15:40 행 **절반부터** → 위 칸(JJ)과 맞닿는데 경계가 안 보였다
    // (원장 2026-09-10 "전양원 위로는 안보이지").
    const { moved } = planRowSpans(MIXED);
    expect(movedCellStartsOnRowLine(moved["960"]!)).toBe(false);
  });

  it("소수 누적오차가 있어도 행 머리로 본다", () => {
    expect(movedCellStartsOnRowLine({ offset: 1e-12 })).toBe(true);
    expect(movedCellStartsOnRowLine({ offset: 0.25 })).toBe(false);
  });
});

/**
 * 🔴 기하만 맞아선 안 된다 — **그리는 쪽이 불투명 바탕을 깔아야** "span 안쪽 선을 덮는다"가 성립한다.
 * 2026-09-10 이전엔 자리 칸(JJ·LAB)만 `bg-*-soft`(알파 0.12)라 덮은 선이 그대로 비쳐, 같은 규약이
 * **칸 색에 따라 갈렸다**(원장: *"JJ에서는 가로선이 보이는데, 왜 전양원 위로는 안보이지?"*).
 * ⚠️ `timetable-dev`는 개발 사본이라 검사 대상이 아니다(CLAUDE.md).
 */
describe("접힌 칸을 그리는 쪽 — 불투명 바탕 + 조건부 위 테두리", () => {
  const consumer = readFileSync(
    join(process.cwd(), "src/app/(shell)/timetable/_components/rich-card-group.tsx"),
    "utf8",
  );

  /**
   * 🔴 **파일 전체가 아니라 그 요소만** 본다 — 아무 데나 같은 글자가 있으면 통과하는 가드는
   * 오버레이에서 바탕을 떼어내도 초록이다(적대적 리뷰 2026-09-10에서 실제로 뮤테이션으로 재현).
   * `style={movedCellBox(`가 접힌 칸 오버레이의 지문이라 그 **바로 앞** className만 잘라 본다.
   */
  const overlayClass = (() => {
    const at = consumer.indexOf("style={movedCellBox(");
    expect(at, "접힌 칸 오버레이(style={movedCellBox(…)})를 못 찾았다").toBeGreaterThan(0);
    const head = consumer.slice(0, at);
    const from = head.lastIndexOf("className={");
    expect(from, "오버레이 앞에 className이 없다").toBeGreaterThan(0);
    return head.slice(from);
  })();

  // ⚠️ 유틸 **순서**로 잠그지 말 것 — 손으로 한 번 정리하면 동작이 같은데 게이트만 깨진다.
  it("오버레이가 불투명 바탕(`bg-card`)을 깐다", () => {
    expect(overlayClass).toContain("bg-card");
  });

  it("위 테두리는 `movedCellStartsOnRowLine`이 아닐 때만 그린다", () => {
    expect(overlayClass).toContain("movedCellStartsOnRowLine(m)");
    // 🔴 조건의 **모양**만 보면 else 가지를 비워도 통과한다 — 그 자리에 실제로 테두리가 있어야 한다.
    expect(overlayClass).toMatch(/!\s*movedCellStartsOnRowLine\(m\)[\s\S]{0,60}border-t/);
  });

  it("칠할 게 없는 칸엔 바탕도 테두리도 안 준다(흰 구멍 방지)", () => {
    expect(overlayClass).toMatch(/paints\s*\?\s*"bg-card"/);
    expect(overlayClass).toMatch(/paints\s*&&\s*!\s*movedCellStartsOnRowLine\(m\)/);
    expect(consumer).toMatch(/const paints = cellPaintsBackground\(/);
  });
});
