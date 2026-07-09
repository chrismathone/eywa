import { describe, it, expect } from "vitest";
import {
  detectContainerEvent,
  detectJumpError,
  detectRegression,
  detectContainerFull,
  detectOverlapError,
} from "./progress-detector";
import type { DetectInput } from "./progress-detector";

function base(over: Partial<DetectInput>): DetectInput {
  return { lastPosition: 5, newPosition: 6, chapterCount: 3, aheadStartPosition: null, track: "current", ...over };
}

describe("개별 판정자", () => {
  it("jumpError: 차 ≥20(경계 포함), 직전 null이면 false", () => {
    expect(detectJumpError(5, 25)).toBe(true); // 20
    expect(detectJumpError(5, 24)).toBe(false); // 19
    expect(detectJumpError(null, 100)).toBe(false);
  });
  it("regression: strict <, 동일위치는 false", () => {
    expect(detectRegression(10, 8)).toBe(true);
    expect(detectRegression(10, 10)).toBe(false);
    expect(detectRegression(null, 1)).toBe(false);
  });
  it("full: count ≥20 경계", () => {
    expect(detectContainerFull(20)).toBe(true);
    expect(detectContainerFull(19)).toBe(false);
  });
  it("overlap: current만, aheadStart 도달(≥)", () => {
    expect(detectOverlapError("current", 15, 15)).toBe(true);
    expect(detectOverlapError("current", 14, 15)).toBe(false);
    expect(detectOverlapError("ahead", 100, 15)).toBe(false);
    expect(detectOverlapError("current", 15, null)).toBe(false);
  });
});

describe("detectContainerEvent — 판정 + 닫기/열기", () => {
  it("forward(정상 전진) — 닫기 없음", () => {
    const r = detectContainerEvent(base({ lastPosition: 5, newPosition: 6 }));
    expect(r.kind).toBe("forward");
    expect(r.jumpSize).toBe(1);
    expect(r.shouldClose).toBe(false);
  });
  it("신규 컨테이너(last=null) → forward, jumpSize 0", () => {
    const r = detectContainerEvent(base({ lastPosition: null, newPosition: 10 }));
    expect(r.kind).toBe("forward");
    expect(r.jumpSize).toBe(0);
  });
  it("동일 위치 → forward(regression 아님, jumpSize 0)", () => {
    const r = detectContainerEvent(base({ lastPosition: 10, newPosition: 10 }));
    expect(r.kind).toBe("forward");
    expect(r.jumpSize).toBe(0);
  });
  it("jump_error → errored 닫기+열기", () => {
    const r = detectContainerEvent(base({ lastPosition: 5, newPosition: 25 }));
    expect(r.kind).toBe("jump_error");
    expect(r.jumpSize).toBe(20);
    expect(r.shouldClose).toBe(true);
    expect(r.shouldOpen).toBe(true);
    expect(r.closeReason).toBe("jump_error");
  });
  it("regression → 닫기 없음, jumpSize 음수", () => {
    const r = detectContainerEvent(base({ lastPosition: 10, newPosition: 8 }));
    expect(r.kind).toBe("regression");
    expect(r.jumpSize).toBe(-2);
    expect(r.shouldClose).toBe(false);
  });
  it("container_full → archived 닫기+열기", () => {
    const r = detectContainerEvent(base({ lastPosition: 5, newPosition: 6, chapterCount: 20 }));
    expect(r.kind).toBe("container_full");
    expect(r.closeReason).toBe("full");
    expect(r.shouldClose).toBe(true);
  });
  it("overlap → errored 닫기+열기(current)", () => {
    const r = detectContainerEvent(base({ lastPosition: 5, newPosition: 15, aheadStartPosition: 15, track: "current" }));
    expect(r.kind).toBe("overlap_error");
    expect(r.closeReason).toBe("overlap");
  });
});

describe("우선순위 jump > overlap > full > regression > forward", () => {
  it("jump + full 동시 → jump 우선", () => {
    expect(detectContainerEvent(base({ lastPosition: 5, newPosition: 25, chapterCount: 20 })).kind).toBe("jump_error");
  });
  it("jump + overlap 동시 → jump 우선", () => {
    expect(
      detectContainerEvent(base({ lastPosition: 5, newPosition: 25, aheadStartPosition: 20, track: "current" })).kind,
    ).toBe("jump_error");
  });
  it("overlap + full 동시 → overlap 우선", () => {
    expect(
      detectContainerEvent(
        base({ lastPosition: 5, newPosition: 15, chapterCount: 20, aheadStartPosition: 15, track: "current" }),
      ).kind,
    ).toBe("overlap_error");
  });
});
