import { describe, expect, it } from "vitest";
import { cellMarkerKey, cellShiftSummary, isMarkerAtCell, laneMarkerKey, markerKeyOfRow, parseMarkerKey } from "./shift-key";
import { placeShiftMarker } from "./lesson-relay";

const BOOK = "0b6f3c1e-1111-4222-8333-944455556666";

describe("미룸·당김 표식 키(0382a)", () => {
  it("칸 표식과 줄 표식을 오간다", () => {
    expect(parseMarkerKey(cellMarkerKey("2026-12-09", "20:20"))).toEqual({ date: "2026-12-09", slot: "20:20", lane: "", pos: 0 });
    expect(parseMarkerKey(laneMarkerKey("2026-12-09", "20:20", BOOK, 2))).toEqual({ date: "2026-12-09", slot: "20:20", lane: BOOK, pos: 2 });
  });

  it("모양이 틀린 키는 null — 클라가 들고 온 되돌리기 기록을 거른다", () => {
    for (const k of ["2026-12-09", "2026-12-09|2020", `2026-12-09|20:20|x|1`, `2026-12-09|20:20|${BOOK}|21`, `2026-12-09|20:20|${BOOK}|01`, `2026-12-09|20:20|${BOOK}`]) {
      expect(parseMarkerKey(k)).toBeNull();
    }
  });

  it("DB 행 — 0382a 전 행(lane·pos 없음)·칸 표식 행은 칸 키, 줄 표식 행은 줄 키", () => {
    expect(markerKeyOfRow({ plan_date: "2026-12-09", slot_start: "20:20:00" })).toBe("2026-12-09|20:20");
    expect(markerKeyOfRow({ plan_date: "2026-12-09", slot_start: "20:20:00", lane: "", pos: 0 })).toBe("2026-12-09|20:20");
    expect(markerKeyOfRow({ plan_date: "2026-12-09", slot_start: "20:20:00", lane: BOOK, pos: 1 })).toBe(`2026-12-09|20:20|${BOOK}|1`);
  });

  it("그 칸의 표식인가 · 화면용 칸 요약", () => {
    const lane = laneMarkerKey("2026-12-09", "20:20", BOOK, 1);
    expect(isMarkerAtCell(lane, "2026-12-09", "20:20")).toBe(true);
    expect(isMarkerAtCell(lane, "2026-12-09", "21:10")).toBe(false);
    expect(cellShiftSummary({ [lane]: "skip" })).toEqual({ "2026-12-09|20:20": "skip" });
    // 미룸이 하나라도 있으면 미룸 — "미뤄 비운 칸의 [당김]"을 세우는 문이라서.
    expect(cellShiftSummary({ [lane]: "skip", "2026-12-09|20:20": "advance" })).toEqual({ "2026-12-09|20:20": "skip" });
    expect(cellShiftSummary({ "2026-12-09|20:20": "advance" })).toEqual({ "2026-12-09|20:20": "advance" });
  });

  it("같은 줄에서 당김을 두 번 — 두 번째는 **다음 자리**에 쌓인다(같은 자리를 두 번 쓰지 않는다)", () => {
    const k = (d: string, p: number) => laneMarkerKey(d, "20:20", BOOK, p);
    const sequence = [k("2026-12-09", 1), k("2026-12-09", 2), k("2026-12-11", 1)];
    expect(placeShiftMarker({ kind: "advance", pressedKey: k("2026-12-09", 1), sequence, shifts: { [k("2026-12-09", 1)]: "advance" } })).toEqual({
      op: "set",
      key: k("2026-12-09", 2),
    });
    // 반대 표식이 그 자리에 있으면 지운다(미룸 뒤 당김 = 원래대로).
    expect(placeShiftMarker({ kind: "advance", pressedKey: k("2026-12-09", 1), sequence, shifts: { [k("2026-12-09", 1)]: "skip" } })).toEqual({
      op: "delete",
      key: k("2026-12-09", 1),
    });
  });
});

describe("같은 자리 거듭 당김 — 쌓기", () => {
  it("쌓인 당김을 찾고, 다음 빈 쌓기 키를 준다", async () => {
    const { advanceStackAt, nextAdvanceStackKey, physicalPos } = await import("./shift-key");
    const k = (p: number) => laneMarkerKey("2026-12-09", "20:20", BOOK, p);
    const shifts = { [k(1)]: "advance" as const, [k(5)]: "advance" as const, [k(2)]: "skip" as const };
    expect(advanceStackAt(shifts, "2026-12-09", "20:20", BOOK, 1)).toEqual([k(1), k(5)]);
    expect(nextAdvanceStackKey(shifts, "2026-12-09", "20:20", BOOK, 1)).toBe(k(9));
    expect(advanceStackAt(shifts, "2026-12-09", "20:20", BOOK, 2)).toEqual([]);
    expect(physicalPos(9)).toBe(1);
    expect(parseMarkerKey(k(20))?.pos).toBe(20);
    expect(parseMarkerKey(k(21))).toBeNull();
  });
});
