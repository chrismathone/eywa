import { describe, expect, it } from "vitest";
import { rollbackContainer, type RemainingEntry } from "./rollback";

/**
 * 진도 되감기 — 🔴 "빼기 산술"이 아니라 **남은 것으로 재계산**이어야 한다.
 * 엔트리는 날짜순으로 쌓이고 마지막이 최고 위치라는 보장이 없다(복습·역행 입력이 실제로 있다).
 */
const e = (entryDate: string, globalPosition: number | null): RemainingEntry => ({ entryDate, globalPosition });

describe("rollbackContainer", () => {
  it("남은 엔트리가 없으면 개시 위치로 되돌린다(막 열린 컨테이너와 같은 상태)", () => {
    expect(rollbackContainer([], 100)).toEqual({ lastPosition: 100, chapterCount: 0, maxJump: 0 });
  });

  it("마지막 위치는 **날짜순 마지막**이지 최댓값이 아니다(역행 입력 보존)", () => {
    const out = rollbackContainer([e("2026-08-01", 110), e("2026-08-03", 105)], 100);
    expect(out.lastPosition).toBe(105);
    expect(out.chapterCount).toBe(2);
  });

  it("max_jump는 개시 위치부터 다시 잰다(뒤로 간 구간은 0)", () => {
    const out = rollbackContainer([e("2026-08-01", 105), e("2026-08-02", 120), e("2026-08-03", 118)], 100);
    // 100→105(5), 105→120(15), 120→118(뒤로 = 0)
    expect(out.maxJump).toBe(15);
  });

  it("입력 순서가 뒤섞여 있어도 날짜로 정렬해 계산한다", () => {
    const out = rollbackContainer([e("2026-08-03", 130), e("2026-08-01", 110)], 100);
    expect(out.lastPosition).toBe(130);
    expect(out.maxJump).toBe(20);
  });

  it("위치가 없는 엔트리(원문만)는 위치 판정에서 빼되 개수에는 넣는다", () => {
    const out = rollbackContainer([e("2026-08-01", 110), e("2026-08-02", null)], 100);
    expect(out.lastPosition).toBe(110);
    expect(out.chapterCount).toBe(2);
  });

  it("위치가 하나도 없으면 개시 위치를 유지한다(지어내지 않는다)", () => {
    const out = rollbackContainer([e("2026-08-01", null)], 100);
    expect(out.lastPosition).toBe(100);
    expect(out.chapterCount).toBe(1);
  });

  it("개시 위치가 없는 옛 컨테이너에서도 터지지 않는다", () => {
    const out = rollbackContainer([e("2026-08-01", 110), e("2026-08-02", 120)], null);
    expect(out.lastPosition).toBe(120);
    expect(out.maxJump).toBe(10); // 첫 엔트리는 기준이 없어 건너뛰고 110→120만
  });

  it("입력 배열을 변형하지 않는다(정렬로 호출부 데이터를 흔들면 안 된다)", () => {
    const input = [e("2026-08-03", 130), e("2026-08-01", 110)];
    rollbackContainer(input, 100);
    expect(input[0]!.entryDate).toBe("2026-08-03");
  });
});
