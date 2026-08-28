import { describe, expect, it } from "vitest";
import { seatNoteTitle } from "./note-title";

describe("seatNoteTitle", () => {
  it("결석 칸의 메모는 '결석 사유'로 부른다", () => {
    expect(seatNoteTitle("absent", "가족여행")).toBe("결석 사유 — 가족여행");
  });

  it("지각 칸의 메모를 결석 사유라고 부르지 않는다", () => {
    expect(seatNoteTitle("late", "버스 놓침")).toBe("지각 사유 — 버스 놓침");
  });

  it("상태가 없으면 중립 라벨 '메모'", () => {
    expect(seatNoteTitle(null, "시트 대조 정정")).toBe("메모 — 시트 대조 정정");
  });

  it("메모가 없거나 공백뿐이면 툴팁을 안 단다", () => {
    expect(seatNoteTitle("absent", null)).toBeNull();
    expect(seatNoteTitle("absent", undefined)).toBeNull();
    expect(seatNoteTitle("absent", "   ")).toBeNull();
  });

  it("앞뒤 공백은 다듬는다(툴팁이 빈 줄로 시작하지 않게)", () => {
    expect(seatNoteTitle("absent", "  병원  ")).toBe("결석 사유 — 병원");
  });
});
