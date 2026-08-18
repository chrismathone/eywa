import { describe, expect, it } from "vitest";
import { anchorSlotIndex, type AnchorSlotLike } from "./seating-anchor";
import type { NowBand } from "./now-band";
import type { SlotPhase } from "./signals";

const s = (slotStart: string, band: NowBand, phase: SlotPhase): AnchorSlotLike => ({
  slotStart,
  band,
  phase,
});

describe("anchorSlotIndex", () => {
  it("빈 배열이면 -1", () => {
    expect(anchorSlotIndex([])).toBe(-1);
  });

  it("규칙1: 열려 있고 안 끝난 교시 중 가장 이른 것 — 방 옮긴 반이 지금 방으로 잡힌다 (실측 LS3a 15:45)", () => {
    // 14:20 랩실(끝남) → 15:00 605(꼬리) → 15:40 605(진행) → 16:20 랩실(리드 밖 예정)
    const idx = anchorSlotIndex([
      s("14:20", "past", "ended"),
      s("15:00", "now", "ended"), // 종료 뒤 10분 꼬리 — 아직 band는 '지금'
      s("15:40", "now", "due"),
      s("16:20", "upcoming", "before"),
    ]);
    expect(idx).toBe(2); // 진행 중인 15:40 교시가 대표 — 카드가 605로 간다
  });

  it("규칙1: band='now' 꼬리만 보고 앞 교시에 못박지 않는다 — 실측 MEC1-4 15:45 = 606", () => {
    // 15:00~15:40 랩실은 15:50까지 '지금'(꼬리)이지만 반은 이미 15:40에 606으로 옮겼다.
    const idx = anchorSlotIndex([
      s("15:00", "now", "ended"),
      s("15:40", "now", "due"),
      s("16:20", "upcoming", "before"),
    ]);
    expect(idx).toBe(1);
  });

  it("규칙1: 연강 리드 겹침(앞=진행·뒤=시작 전)이면 앞 교시가 대표", () => {
    // 15:35 시점: 15:00~15:40 진행 중, 15:40 교시는 리드(10분 전)로 이미 '지금'.
    const idx = anchorSlotIndex([s("15:00", "now", "due"), s("15:40", "now", "before")]);
    expect(idx).toBe(0);
  });

  it("규칙2: 전부 종료 직후 꼬리뿐이면 마지막 교시 — 마지막으로 있었던 방", () => {
    // 15:45의 DP6: 14:20~15:00 602(지남) → 15:00~15:40 랩실(꼬리). 방금까지 있던 랩실에 남는다.
    const idx = anchorSlotIndex([s("14:20", "past", "ended"), s("15:00", "now", "ended")]);
    expect(idx).toBe(1);
  });

  it("규칙3: 열린 교시가 없으면 다음 시작할 교시 — 다음에 그 방에 모인다 (실측 KW2 15:45 = 랩실)", () => {
    const idx = anchorSlotIndex([
      s("16:20", "upcoming", "before"),
      s("17:00", "upcoming", "before"),
      s("17:40", "later", "before"),
    ]);
    expect(idx).toBe(0);
  });

  it("규칙3: 오전에 끝난 교시 + 저녁 교시면 저녁이 대표 — 오전 방에 남지 않는다", () => {
    const idx = anchorSlotIndex([s("11:00", "past", "ended"), s("19:00", "later", "before")]);
    expect(idx).toBe(1);
  });

  it("규칙4: 전부 끝났으면 마지막 교시 — 마지막으로 있었던 방", () => {
    const idx = anchorSlotIndex([
      s("14:20", "past", "ended"),
      s("15:00", "past", "ended"),
      s("15:40", "past", "ended"),
    ]);
    expect(idx).toBe(2);
  });

  it("지난 날짜 조회(전부 past)는 규칙4 — 마지막 방 하나로 정해진다", () => {
    const idx = anchorSlotIndex([s("15:00", "past", "ended"), s("14:20", "past", "ended")]);
    expect(idx).toBe(0); // 정렬 안 된 입력이라도 slotStart로 고른다
  });

  it("입력 순서에 기대지 않는다 — 정렬 안 된 배열에서도 같은 답", () => {
    const idx = anchorSlotIndex([
      s("15:40", "now", "due"),
      s("14:20", "past", "ended"),
      s("15:00", "now", "ended"),
    ]);
    expect(idx).toBe(0);
  });
});
