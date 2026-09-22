import { describe, expect, it } from "vitest";
import { checkAywaGridShape } from "./aywa-grid-shape";
import type { SheetGrid } from "./types";

const grid = (cells: string[][]): SheetGrid => ({ cells, merges: [] });

/** aywa export 모양 — 1행 강사 · 2행 요일 · 3행+ 데이터(A열 24시간 HH:MM). */
const aywa = () =>
  grid([
    ["시각", "부원장", "", "김태건", ""],
    ["", "월 8/24", "화 8/25", "월 8/24", "화 8/25"],
    ["10:00", "", "", "고등E_고3 정규", ""],
    ["10:10", "", "", "", ""],
  ]);

/** 마스터 모양 — 1행 블록번호 · 2행 강사 · 3행 근무메모 · 4행 요일 · 5행+ 데이터(A열 12시간 범위). */
const master = () =>
  grid([
    ["--", "1", "", "2", ""],
    ["", "Jane 추민아 301", "", "Hannah 이현이", ""],
    ["", "월~금 01:00-09:00", "", "", ""],
    ["", "월", "화", "월", "화"],
    ["2:20~2:30", "PJ2/", "", "", ""],
  ]);

describe("checkAywaGridShape", () => {
  it("aywa export는 통과", () => {
    expect(checkAywaGridShape(aywa())).toBeNull();
  });

  it("마스터를 그대로 붙이면 거절 — 2행이 요일이 아니다", () => {
    const msg = checkAywaGridShape(master());
    expect(msg).toContain("2행이 요일");
    expect(msg).toContain("마스터");
  });

  it("🔴 행을 맞춰 붙여도 거절 — A열이 12시간제면 모든 수업이 12시간 앞으로 들어간다", () => {
    // 마스터에서 1행(블록번호)·3행(근무메모)을 지운 모양: 구조는 맞고 시각만 12시간제다.
    const shifted = grid([
      ["", "Jane 추민아 301", "", "Hannah 이현이", ""],
      ["", "월", "화", "월", "화"],
      ["2:20~2:30", "PJ2/", "", "", ""],
      ["2:30~2:40", "", "", "", ""],
    ]);
    const msg = checkAywaGridShape(shifted);
    expect(msg).toContain("24시간");
    expect(msg).toContain("12시간 앞으로");
  });

  it("A열 첫 값이 아래쪽에 있어도 그 값을 앵커로 본다(빈 행 건너뜀)", () => {
    const g = aywa();
    g.cells[2]![0] = "";
    expect(checkAywaGridShape(g)).toBeNull(); // 3행이 비고 4행 "10:10"이 앵커
  });

  it("시각이 아예 없으면 거절", () => {
    const g = aywa();
    g.cells[2]![0] = "";
    g.cells[3]![0] = "";
    expect(checkAywaGridShape(g)).toContain("A열에 시각이 없습니다");
  });

  it("빈 탭은 '형식이 다르다'가 아니라 '비었다'로 말한다", () => {
    expect(checkAywaGridShape(grid([["", ""], ["", ""]]))).toContain("데이터가 없습니다");
    expect(checkAywaGridShape(grid([]))).toContain("데이터가 없습니다");
  });

  it("1행에 강사가 없으면 거절", () => {
    const g = aywa();
    g.cells[0] = ["시각", "", "", "", ""];
    expect(checkAywaGridShape(g)).toContain("1행에 강사가 없습니다");
  });

  it("0채움 안 된 시각(`9:00`)도 aywa 표기가 아니다 — 내보내기는 항상 두 자리를 쓴다", () => {
    const g = aywa();
    g.cells[2]![0] = "9:00";
    expect(checkAywaGridShape(g)).toContain("24시간");
  });
});
