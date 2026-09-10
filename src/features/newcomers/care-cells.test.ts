import { describe, expect, it } from "vitest";
import {
  CARE_CELLS,
  CARE_ITEM_KEYS,
  NO_FIRST_CLASS_CELL,
  buildCareCells,
  careCellByKey,
  careCellMatches,
  parseCareCellParam,
  type CareRow,
} from "./care-cells";
import { NEWCOMER_BASELINE_DATE, ONBOARDING_ITEMS } from "./onboarding-items";

const TODAY = "2026-10-01";
const row = (over: Partial<CareRow> = {}): CareRow => ({
  enrolledOn: "2026-09-20",
  firstClassOn: "2026-09-22",
  checks: {},
  ...over,
});

describe("신규생 케어 칸", () => {
  it("칸은 절차 다섯 + '첫수업일 미정' — 3개월 콜·2개월 콜·입학테스트는 없다", () => {
    expect(CARE_CELLS.map((c) => c.key)).toEqual([...CARE_ITEM_KEYS, NO_FIRST_CLASS_CELL]);
    // 🔴 90일 케어라는 업무 기록이 아직 없다 — 세워 두면 아무도 손댈 수 없는 숫자가 된다.
    expect(CARE_CELLS.some((c) => c.key === "month3_call")).toBe(false);
    expect(CARE_CELLS.some((c) => c.key === "month2_call")).toBe(false);
  });

  it("라벨은 ONBOARDING_ITEMS 단일 소스 — PRD 영어 이름을 쓰지 않는다", () => {
    for (const key of CARE_ITEM_KEYS) {
      const item = ONBOARDING_ITEMS.find((i) => i.key === key)!;
      expect(careCellByKey(key)!.label).toBe(item.shortLabel);
    }
    const joined = CARE_CELLS.map((c) => c.label).join(" ");
    for (const en of ["Happy", "Pre Call", "Day Care", "OJT Task", "Test"]) {
      expect(joined).not.toContain(en);
    }
  });

  it("숫자는 미완료 학생 수(지연 + 오늘·사흘 안)이고 코호트 총원이 아니다", () => {
    // 첫 수업 09-22 → 사전 콜 09-21(지남) · 첫 수업 안내 09-22(지남) · 첫 수업 후 콜 09-29(지남)
    // 등록 09-20 → OJT 09-27(지남) · 1개월 콜 10-20(아직 멀다)
    const cells = buildCareCells([row(), row(), row()], TODAY);
    const by = Object.fromEntries(cells.map((c) => [c.key, c]));
    expect(by.pre_call!.count).toBe(3);
    expect(by.pre_call!.overdue).toBe(3);
    // 아직 기한이 안 온 항목은 **0**이다 — 대상 3명을 그대로 적으면 거짓이다.
    expect(by.month1_call!.count).toBe(0);
  });

  it("색은 지연이 있을 때만 — 임박만이면 주의, 0이면 조용히", () => {
    const cells = buildCareCells([row()], "2026-10-18"); // 1개월 콜 기한 10-20 = D-2
    const m1 = cells.find((c) => c.key === "month1_call")!;
    expect(m1.overdue).toBe(0);
    expect(m1.count).toBe(1);
    expect(m1.tone).toBe("caution");
    expect(buildCareCells([], TODAY).every((c) => c.tone === "inert")).toBe(true);
    expect(buildCareCells([row()], TODAY).find((c) => c.key === "pre_call")!.tone).toBe("critical");
  });

  it("완료 체크는 미완료에서 빠진다", () => {
    const cells = buildCareCells([row({ checks: { pre_call: "2026-09-21" } })], TODAY);
    expect(cells.find((c) => c.key === "pre_call")!.count).toBe(0);
  });

  it("waived(2026-09-09 이전 기한)는 미완료가 아니다", () => {
    // 90일 창 안이지만 절차 기한 대부분이 기능 시작일보다 앞선 학생.
    const old = row({ enrolledOn: "2026-07-03", firstClassOn: "2026-07-05" });
    const cells = buildCareCells([old], TODAY);
    for (const c of cells) {
      if (c.kind === "noFirstClass") continue;
      expect(c.overdue, c.key).toBe(0);
      expect(c.count, c.key).toBe(0);
    }
    // 규칙이 실제로 적용된 증거 — cutoff를 앞당기면 같은 학생이 지연으로 잡힌다.
    expect(buildCareCells([old], TODAY, "2026-01-01").some((c) => c.overdue > 0)).toBe(true);
    expect(NEWCOMER_BASELINE_DATE).toBe("2026-09-09");
  });

  it("첫수업일이 없으면 그 항목은 기한이 없고, 대신 '첫수업일 미정' 칸이 그 사람을 잡는다", () => {
    // 🔴 안 잡으면 그 학생이 날짜 계산에서 조용히 빠져 화면에서 사라진다.
    const cells = buildCareCells([row({ firstClassOn: null })], TODAY);
    const by = Object.fromEntries(cells.map((c) => [c.key, c]));
    expect(by.pre_call!.count).toBe(0);
    expect(by.after_first_call!.count).toBe(0);
    expect(by.ojt!.overdue).toBe(1); // 등록일에 매달린 항목은 그대로 센다.
    expect(by[NO_FIRST_CLASS_CELL]!.count).toBe(1);
    // 첫수업일 미정은 '지연'이 아니라 '확인 필요'다.
    expect(by[NO_FIRST_CLASS_CELL]!.overdue).toBe(0);
    expect(by[NO_FIRST_CLASS_CELL]!.tone).toBe("caution");
  });

  it("숫자를 센 조건 = 목록 필터 — 두 곳이 같은 함수를 부른다", () => {
    const rows = [row(), row({ checks: { pre_call: "2026-09-21" } }), row({ firstClassOn: null })];
    for (const cell of CARE_CELLS) {
      const counted = buildCareCells(rows, TODAY).find((c) => c.key === cell.key)!.count;
      const filtered = rows.filter((r) => careCellMatches(cell, r, TODAY)).length;
      expect(filtered, cell.key).toBe(counted);
    }
  });

  it("모르는 `?item=` 값이면 필터를 안 건다(빈 목록보다 전체가 낫다)", () => {
    expect(parseCareCellParam("__nope__")).toBeNull();
    expect(parseCareCellParam(undefined)).toBeNull();
    expect(parseCareCellParam("ojt")?.key).toBe("ojt");
  });
});
