import { describe, expect, it } from "vitest";
import { parentUnreadBadge, progressAnomalyBadge } from "./roster-signals";
import type { ParentReadStats, ProgressSignal } from "./roster-signals";

const stats = (p: Partial<ParentReadStats>): ParentReadStats => ({
  trackableCount: 0,
  agedUnreadCount: 0,
  readCount: 0,
  lastReadAt: null,
  ...p,
});

describe("parentUnreadBadge — G3 '학부모 미확인'", () => {
  // lastReadAt(추적 실증)은 배지의 전제 — 테스트 기본값에 부여하고, 없음 케이스를 별도 검증.
  const tracked = (p: Partial<ParentReadStats>) => stats({ lastReadAt: "2026-07-10T09:00:00Z", ...p });
  it("추적 5건·읽음 0·aged 미읽음 4 → 배지 4회", () => {
    expect(parentUnreadBadge(tracked({ trackableCount: 5, agedUnreadCount: 4 }))).toEqual({ count: 4 });
  });
  it("⚠️ 읽음 실증 없음(lastReadAt null) = 침묵 — 파이프라인 공백과 구분 불가(실측: 이 조건 없이는 155명 오탐)", () => {
    expect(parentUnreadBadge(stats({ trackableCount: 5, agedUnreadCount: 5 }))).toBeNull();
  });
  it("최근 안에 하나라도 읽었으면 침묵(정상 가정)", () => {
    expect(parentUnreadBadge(tracked({ trackableCount: 5, agedUnreadCount: 4, readCount: 1 }))).toBeNull();
  });
  it("표본 부족(추적 3건 미만) = 판단 보류", () => {
    expect(parentUnreadBadge(tracked({ trackableCount: 2, agedUnreadCount: 2 }))).toBeNull();
  });
  it("aged 미읽음 3건 미만 = 아직 이르다(갓 보낸 건 세지 않음)", () => {
    expect(parentUnreadBadge(tracked({ trackableCount: 5, agedUnreadCount: 2 }))).toBeNull();
  });
  it("경계: 정확히 3건이면 배지", () => {
    expect(parentUnreadBadge(tracked({ trackableCount: 3, agedUnreadCount: 3 }))).toEqual({ count: 3 });
  });
  it("stats 없음(추적 불가 학생·RPC 누락) = 침묵 — '확인 불가' 배지는 소음이라 안 만든다", () => {
    expect(parentUnreadBadge(undefined)).toBeNull();
  });
});

describe("progressAnomalyBadge — G2 '진도 확인 필요'", () => {
  const sig = (p: Partial<ProgressSignal>): ProgressSignal => ({ errored: false, anomalyCount: 0, ...p });
  it("errored 컨테이너 → 배지", () => {
    expect(progressAnomalyBadge(sig({ errored: true }))).toBe(true);
  });
  it("최근 14일 오류 이벤트 → 배지", () => {
    expect(progressAnomalyBadge(sig({ anomalyCount: 1 }))).toBe(true);
  });
  it("둘 다 없으면 침묵 — regression은 의도적 미포함(실측 80건/14일 = 소음)", () => {
    expect(progressAnomalyBadge(sig({}))).toBe(false);
    expect(progressAnomalyBadge(undefined)).toBe(false);
  });
});
