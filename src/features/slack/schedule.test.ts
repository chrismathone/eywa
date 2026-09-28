import { describe, expect, it } from "vitest";
import { isQuietAt, kstClock, kstStamp, nextAwakeAt, nextDigestAt, planDelivery, type QuietConfig } from "./schedule";

// KST = UTC+9. 2026-09-28은 월요일.
const at = (kstIso: string) => new Date(`${kstIso}+09:00`);
const CFG: QuietConfig = { dndEnabled: true, dndStart: "22:00", dndEnd: "08:00", weekendQuiet: false };

describe("방해금지", () => {
  it("자정을 넘는 구간", () => {
    expect(isQuietAt(at("2026-09-28T21:59:00"), CFG)).toBe(false);
    expect(isQuietAt(at("2026-09-28T22:00:00"), CFG)).toBe(true);
    expect(isQuietAt(at("2026-09-29T07:59:00"), CFG)).toBe(true);
    expect(isQuietAt(at("2026-09-29T08:00:00"), CFG)).toBe(false);
  });

  it("안 넘는 구간 · 꺼짐 · 시작=끝", () => {
    const lunch = { ...CFG, dndStart: "13:00", dndEnd: "14:00" };
    expect(isQuietAt(at("2026-09-28T13:30:00"), lunch)).toBe(true);
    expect(isQuietAt(at("2026-09-28T14:00:00"), lunch)).toBe(false);
    expect(isQuietAt(at("2026-09-28T23:00:00"), { ...CFG, dndEnabled: false })).toBe(false);
    expect(isQuietAt(at("2026-09-28T23:00:00"), { ...CFG, dndEnd: "22:00" })).toBe(false);
  });

  it("다음 깨는 시각 — 밤이면 아침 8시", () => {
    expect(nextAwakeAt(at("2026-09-28T23:10:00"), CFG).toISOString()).toBe(at("2026-09-29T08:00:00").toISOString());
    expect(nextAwakeAt(at("2026-09-29T03:00:00"), CFG).toISOString()).toBe(at("2026-09-29T08:00:00").toISOString());
    const noon = at("2026-09-28T12:00:00");
    expect(nextAwakeAt(noon, CFG)).toBe(noon);
  });

  it("주말 조용히 — 금요일 밤이면 월요일 아침 8시", () => {
    const wk = { ...CFG, weekendQuiet: true };
    expect(isQuietAt(at("2026-10-03T12:00:00"), wk)).toBe(true); // 토
    expect(nextAwakeAt(at("2026-10-02T23:00:00"), wk).toISOString()).toBe(at("2026-10-05T08:00:00").toISOString());
    // 방해금지를 끄고 주말만 조용히면 월요일 0시
    expect(nextAwakeAt(at("2026-10-03T12:00:00"), { ...wk, dndEnabled: false }).toISOString()).toBe(
      at("2026-10-05T00:00:00").toISOString(),
    );
  });
});

describe("요약 시각", () => {
  it("오늘 아직이면 오늘, 지났으면 내일", () => {
    expect(nextDigestAt(at("2026-09-28T07:00:00"), "08:00").toISOString()).toBe(at("2026-09-28T08:00:00").toISOString());
    expect(nextDigestAt(at("2026-09-28T08:00:00"), "08:00").toISOString()).toBe(at("2026-09-29T08:00:00").toISOString());
    expect(nextDigestAt(at("2026-09-28T23:30:00"), "18:30").toISOString()).toBe(at("2026-09-29T18:30:00").toISOString());
  });
});

describe("발송 계획", () => {
  const cfg = { ...CFG, digestAt: "08:00" };
  it("낮 즉시 = 지금 낱개", () => {
    const now = at("2026-09-28T15:00:00");
    expect(planDelivery(now, { timing: "immediate", digestAt: null, honorDnd: true }, cfg)).toEqual({ kind: "message", dueAt: now });
  });
  it("밤 즉시 = 아침 묶음 · 방해금지 무시 규칙은 지금", () => {
    const now = at("2026-09-28T23:00:00");
    expect(planDelivery(now, { timing: "immediate", digestAt: null, honorDnd: true }, cfg)).toEqual({
      kind: "digest_item",
      dueAt: at("2026-09-29T08:00:00"),
    });
    expect(planDelivery(now, { timing: "immediate", digestAt: null, honorDnd: false }, cfg).kind).toBe("message");
  });
  it("요약만 = 규칙 시각(없으면 기본)", () => {
    const now = at("2026-09-28T10:00:00");
    expect(planDelivery(now, { timing: "digest", digestAt: "18:00", honorDnd: true }, cfg).dueAt).toEqual(at("2026-09-28T18:00:00"));
    expect(planDelivery(now, { timing: "digest", digestAt: null, honorDnd: true }, cfg).dueAt).toEqual(at("2026-09-29T08:00:00"));
  });
});

describe("표시", () => {
  it("KST 시각", () => {
    expect(kstClock(at("2026-09-28T09:05:00"))).toBe("09:05");
    expect(kstStamp(at("2026-09-28T23:59:00"))).toBe("9/28 23:59");
  });
});
