import { describe, it, expect } from "vitest";
import { isStuck, summarizeQueue, needsAttention, STUCK_MINUTES, type QueueRow } from "./classnote-queue";

const NOW = Date.parse("2026-07-09T12:00:00Z");
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("isStuck", () => {
  it("processing + STUCK_MINUTES 경과면 멈춤", () => {
    expect(isStuck("processing", minsAgo(STUCK_MINUTES + 1), NOW)).toBe(true);
    expect(isStuck("processing", minsAgo(STUCK_MINUTES - 1), NOW)).toBe(false); // 아직 진행 중
    expect(isStuck("queued", minsAgo(60), NOW)).toBe(false); // processing 아님
    expect(isStuck("processing", null, NOW)).toBe(false); // 시작 시각 없음
  });
});

describe("summarizeQueue", () => {
  it("상태별 집계 + stuck는 processing 하위 카운트", () => {
    const rows: QueueRow[] = [
      { status: "queued", processingAt: null },
      { status: "processing", processingAt: minsAgo(2) }, // 정상 진행
      { status: "processing", processingAt: minsAgo(30) }, // 멈춤
      { status: "success", processingAt: minsAgo(40) },
      { status: "failed", processingAt: null },
      { status: "too_old", processingAt: null },
      { status: "name_conflict", processingAt: null },
      { status: "revoked", processingAt: null }, // 기타(집계 제외)
    ];
    expect(summarizeQueue(rows, NOW)).toEqual({
      queued: 1,
      processing: 2,
      stuck: 1,
      success: 1,
      failed: 1,
      tooOld: 1,
      nameConflict: 1,
      total: 8,
    });
  });
});

describe("needsAttention", () => {
  it("실패·오래됨·동명이인·멈춤만 true", () => {
    expect(needsAttention("failed", null, NOW)).toBe(true);
    expect(needsAttention("too_old", null, NOW)).toBe(true);
    expect(needsAttention("name_conflict", null, NOW)).toBe(true);
    expect(needsAttention("processing", minsAgo(30), NOW)).toBe(true); // 멈춤
    expect(needsAttention("processing", minsAgo(1), NOW)).toBe(false); // 정상
    expect(needsAttention("queued", null, NOW)).toBe(false);
    expect(needsAttention("success", null, NOW)).toBe(false);
  });
});
