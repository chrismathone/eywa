import { describe, expect, it } from "vitest";
import {
  moveColumn,
  normalizeOrder,
  STAFF_COLUMNS,
  visibleColumns,
  type StaffColumnKey,
} from "./columns";

const ALL = STAFF_COLUMNS.map((c) => c.key);

describe("normalizeOrder", () => {
  it("저장값이 없으면 기본(시트) 순서", () => {
    expect(normalizeOrder(undefined)).toEqual(ALL);
    expect(normalizeOrder([])).toEqual(ALL);
  });

  it("저장한 순서를 지키고 나머지는 뒤에 붙인다", () => {
    const out = normalizeOrder(["status", "name"]);
    expect(out.slice(0, 2)).toEqual(["status", "name"]);
    expect(out).toHaveLength(ALL.length);
    expect(new Set(out)).toEqual(new Set(ALL));
  });

  it("🔴 새로 생긴 열은 조용히 사라지지 않는다 — 뒤에 붙어 보인다", () => {
    // 옛 저장본(열 3개만 알던 시절)
    const out = normalizeOrder(["name", "department", "status"]);
    expect(out).toContain("workHours");
    expect(out).toHaveLength(ALL.length);
  });

  it("모르는 키·중복은 버린다", () => {
    const out = normalizeOrder(["name", "name", "존재하지않는열"]);
    expect(out.filter((k) => k === "name")).toHaveLength(1);
    expect(out).toHaveLength(ALL.length);
  });
});

describe("visibleColumns", () => {
  it("숨긴 열만 빠지고 순서는 유지", () => {
    const order = normalizeOrder(["name", "department", "status"]);
    expect(visibleColumns(order, ["department"])).not.toContain("department");
    expect(visibleColumns(order, ["department"])[0]).toBe("name");
  });

  it("전부 숨기면 빈 표가 되므로 기본 전체로 되돌린다", () => {
    expect(visibleColumns(ALL, ALL)).toEqual(ALL);
  });
});

describe("moveColumn", () => {
  const order: StaffColumnKey[] = ["department", "name", "jobTitle"];

  it("위/아래로 한 칸", () => {
    expect(moveColumn(order, "name", -1)).toEqual(["name", "department", "jobTitle"]);
    expect(moveColumn(order, "name", 1)).toEqual(["department", "jobTitle", "name"]);
  });

  it("끝에서는 더 안 움직인다", () => {
    expect(moveColumn(order, "department", -1)).toEqual(order);
    expect(moveColumn(order, "jobTitle", 1)).toEqual(order);
  });
});

describe("바뀐 열 키", () => {
  it("계약조건 → 근무시간: 저장된 순서는 같은 자리를 이어받고, 옛 숨김은 새 열을 가리지 않는다", async () => {
    const { parseStaffListPrefs } = await import("./list-prefs");
    const p = parseStaffListPrefs({ columnOrder: ["name", "contractTerms", "status"], columnHidden: ["contractTerms"] });
    expect(p.columnOrder).toEqual(["name", "workHours", "status"]);
    expect(p.columnHidden).toEqual([]);
    expect(normalizeOrder(p.columnOrder).slice(0, 3)).toEqual(["name", "workHours", "status"]);
  });
});
