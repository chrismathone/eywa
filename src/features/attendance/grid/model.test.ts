import { describe, expect, it } from "vitest";
import { cellKey, clampIndex, moveCell, parseCellKey, rectKeys, rowKey } from "./model";

const C1 = "11111111-1111-1111-1111-111111111111";
const C2 = "22222222-2222-2222-2222-222222222222";
const S1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("키", () => {
  it("🔴 행 키에 반이 들어간다 — 같은 학생이 두 반에 있어도 다른 행", () => {
    expect(rowKey(C1, S1)).not.toBe(rowKey(C2, S1));
  });

  it("셀 키를 되돌려 읽는다", () => {
    const k = cellKey(rowKey(C1, S1), "2026-07-31");
    expect(parseCellKey(k)).toEqual({ classId: C1, studentId: S1, date: "2026-07-31", row: rowKey(C1, S1) });
  });

  it("형태가 어긋나면 null — 지어내지 않는다", () => {
    expect(parseCellKey("")).toBeNull();
    expect(parseCellKey("only-one-part")).toBeNull();
    expect(parseCellKey(`${C1}|${S1}`)).toBeNull(); // 날짜 없음
    expect(parseCellKey(`${C1}|${S1}|`)).toBeNull();
  });
});

describe("clampIndex", () => {
  it("끝에서 더 눌러도 넘어가지 않는다(순환 금지)", () => {
    expect(clampIndex(5, 4, 1)).toBe(4);
    expect(clampIndex(5, 0, -1)).toBe(0);
    expect(clampIndex(5, 2, 2)).toBe(4);
  });
  it("빈 격자는 -1", () => {
    expect(clampIndex(0, 0, 1)).toBe(-1);
  });
});

describe("moveCell", () => {
  const rows = [rowKey(C1, S1), rowKey(C1, S2), rowKey(C2, S1)];
  const cols = ["2026-07-01", "2026-07-02", "2026-07-03"];

  it("아래·오른쪽으로 이동", () => {
    expect(moveCell(rows, cols, { row: rows[0]!, col: cols[0]! }, 1, 1)).toEqual({
      row: rows[1],
      col: cols[1],
    });
  });

  it("🔴 반 경계를 넘어 다음 반 행으로 이어진다 — 표는 한 장이다", () => {
    expect(moveCell(rows, cols, { row: rows[1]!, col: cols[0]! }, 0, 1)?.row).toBe(rows[2]);
  });

  it("목록에 없는 칸이면 null(월 변경으로 좌표가 사라진 경우)", () => {
    expect(moveCell(rows, cols, { row: "gone", col: cols[0]! }, 1, 0)).toBeNull();
    expect(moveCell(rows, cols, { row: rows[0]!, col: "2026-08-01" }, 1, 0)).toBeNull();
  });
});

describe("rectKeys", () => {
  const rows = [rowKey(C1, S1), rowKey(C1, S2), rowKey(C2, S1)];
  const cols = ["2026-07-01", "2026-07-02", "2026-07-03"];

  it("focus 없으면 한 칸", () => {
    expect([...rectKeys(rows, cols, { row: rows[0]!, col: cols[0]! }, null)]).toEqual([
      cellKey(rows[0]!, cols[0]!),
    ]);
  });

  it("사각형 전체 — 방향이 거꾸로여도 같다", () => {
    const a = rectKeys(rows, cols, { row: rows[0]!, col: cols[0]! }, { row: rows[1]!, col: cols[1]! });
    const b = rectKeys(rows, cols, { row: rows[1]!, col: cols[1]! }, { row: rows[0]!, col: cols[0]! });
    expect(a.size).toBe(4);
    expect([...a].sort()).toEqual([...b].sort());
  });

  it("🔴 좌표를 못 찾으면 빈 집합이 아니라 anchor 한 칸 — 빈 집합이면 범위 채우기가 조용히 무동작", () => {
    const r = rectKeys(rows, cols, { row: rows[0]!, col: cols[0]! }, { row: "gone", col: cols[2]! });
    expect([...r]).toEqual([cellKey(rows[0]!, cols[0]!)]);
  });
});
