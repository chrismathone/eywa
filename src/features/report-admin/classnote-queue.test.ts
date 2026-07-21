import { describe, it, expect } from "vitest";
import {
  isStuck,
  summarizeQueue,
  needsAttention,
  shouldAutoRefreshQueue,
  queuePollIntervalMs,
  QUEUE_POLL_MS,
  QUEUE_WATCH_MS,
  STUCK_MINUTES,
  type QueueRow,
} from "./classnote-queue";

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
      { status: "blocked_shared", processingAt: null }, // 프리플라이트 게이트 보류(공유 보드 등)
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
      blockedShared: 1,
      total: 9,
    });
  });
});

describe("needsAttention", () => {
  it("실패·오래됨·동명이인·공유보드차단·멈춤만 true", () => {
    expect(needsAttention("failed", null, NOW)).toBe(true);
    expect(needsAttention("too_old", null, NOW)).toBe(true);
    expect(needsAttention("name_conflict", null, NOW)).toBe(true);
    expect(needsAttention("blocked_shared", null, NOW)).toBe(true);
    expect(needsAttention("processing", minsAgo(30), NOW)).toBe(true); // 멈춤
    expect(needsAttention("processing", minsAgo(1), NOW)).toBe(false); // 정상
    expect(needsAttention("queued", null, NOW)).toBe(false);
    expect(needsAttention("success", null, NOW)).toBe(false);
  });
});

describe("shouldAutoRefreshQueue", () => {
  it("진행 중(대기·처리중)이 남아 있으면 자동 갱신", () => {
    expect(shouldAutoRefreshQueue({ pendingCount: 1, stalled: false })).toBe(true);
  });
  it("진행 중이 없으면 안 돈다(발송이 다 끝난 화면에서 계속 조회 금지)", () => {
    expect(shouldAutoRefreshQueue({ pendingCount: 0, stalled: false })).toBe(false);
  });
  it("상한 도달 후엔 안 돈다 — 창을 열어둔 채 무한 폴링 방지", () => {
    expect(shouldAutoRefreshQueue({ pendingCount: 3, stalled: true })).toBe(false);
  });
});

describe("queuePollIntervalMs", () => {
  it("워커 온라인이면 빠른 주기(발송 추적)", () => {
    expect(queuePollIntervalMs(true)).toBe(QUEUE_POLL_MS);
  });
  it("워커 오프라인이면 느린 주기 — 멈추지 않고 'PC가 켜졌나'만 지켜본다(막다른 길 방지)", () => {
    expect(queuePollIntervalMs(false)).toBe(QUEUE_WATCH_MS);
    expect(QUEUE_WATCH_MS).toBeGreaterThan(QUEUE_POLL_MS);
  });
});
