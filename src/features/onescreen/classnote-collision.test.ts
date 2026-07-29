import { describe, expect, it } from "vitest";
import { COLLISION_STATUSES, countsForNameCollision, isNameCollision } from "./classnote-collision";

describe("countsForNameCollision", () => {
  it("재원·휴원은 센다 — 보드가 실제로 존재할 수 있다", () => {
    expect(countsForNameCollision("enrolled")).toBe(true);
    expect(countsForNameCollision("on_hold")).toBe(true);
  });

  it("등록 전 단계·탈원은 세지 않는다 — 보드가 없다(거짓 양성 원인)", () => {
    expect(countsForNameCollision("prospect")).toBe(false);
    expect(countsForNameCollision("consulted")).toBe(false);
    expect(countsForNameCollision("withdrawn")).toBe(false);
  });

  it("빈 값은 세지 않는다", () => {
    expect(countsForNameCollision(null)).toBe(false);
    expect(countsForNameCollision(undefined)).toBe(false);
    expect(countsForNameCollision("")).toBe(false);
  });

  it("목록은 재원·휴원 둘뿐 — 넓히면 거짓양성, 좁히면 오배송", () => {
    expect([...COLLISION_STATUSES]).toEqual(["enrolled", "on_hold"]);
  });
});

describe("isNameCollision", () => {
  it("본인 1명이면 충돌 아님", () => {
    expect(isNameCollision(1)).toBe(false);
    expect(isNameCollision(0)).toBe(false);
  });

  it("2명 이상이면 충돌", () => {
    expect(isNameCollision(2)).toBe(true);
    expect(isNameCollision(5)).toBe(true);
  });
});
