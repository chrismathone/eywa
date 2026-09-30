import { describe, expect, it } from "vitest";
import { passesActorFilter } from "./actor-filter";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("사람 필터 — 빼기 · 누가(0311a)", () => {
  it("'누가'가 비면 누구든(발동자 없는 것 포함)", () => {
    const r = { actorIds: [], excludeActorIds: [] };
    expect(passesActorFilter(r, A)).toBe(true);
    expect(passesActorFilter(r, null)).toBe(true);
  });
  it("'누가'를 채우면 그 사람이 한 일만 — 발동자 없는 것(시스템·PIN)은 빠진다", () => {
    const r = { actorIds: [A], excludeActorIds: [] };
    expect(passesActorFilter(r, A)).toBe(true);
    expect(passesActorFilter(r, B)).toBe(false);
    expect(passesActorFilter(r, null)).toBe(false);
  });
  it("빼기는 그대로 — 둘 다에 있으면 빼기가 이긴다", () => {
    expect(passesActorFilter({ actorIds: [], excludeActorIds: [A] }, A)).toBe(false);
    expect(passesActorFilter({ actorIds: [], excludeActorIds: [A] }, null)).toBe(true);
    expect(passesActorFilter({ actorIds: [A], excludeActorIds: [A] }, A)).toBe(false);
  });
});
