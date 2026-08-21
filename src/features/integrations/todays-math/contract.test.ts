import { describe, expect, it } from "vitest";

import {
  decodeCursor,
  encodeCursor,
  isAuthorized,
  nextCursorFor,
  PROGRESS_PAGE_SIZE,
} from "./contract";

describe("todays-math 연계 — 커서", () => {
  it("왕복이 성립한다", () => {
    for (const offset of [0, 1, 500, 16_390, 999_999])
      expect(decodeCursor(encodeCursor(offset))).toBe(offset);
  });

  it("커서 없음(첫 페이지)은 0", () => {
    expect(decodeCursor(null)).toBe(0);
    expect(decodeCursor("")).toBe(0);
  });

  /**
   * 🔴 못 읽는 커서는 null(→ 400) — **조용히 0으로 내려가면 안 된다.**
   *    0으로 내려가면 소비자는 «중복 전량»을 받고도 성공으로 읽고,
   *    (보고서,단원) 멱등 키가 없는 소비자라면 진도가 두 배로 쌓인다.
   */
  it("깨진 커서는 null — 처음부터 다시 주지 않는다", () => {
    for (const bad of ["???", "dG90YWxseS1ub3QtYS1jdXJzb3I", encodeCursor(3).slice(0, 4), "dm0xOi0x"])
      expect(decodeCursor(bad)).toBeNull();
    // 음수·소수·숫자 아님도 전부 거부
    const forged = (s: string) => Buffer.from(`tmv1:${s}`, "utf8").toString("base64url");
    for (const bad of ["-1", "1.5", "abc", ""]) expect(decodeCursor(forged(bad))).toBeNull();
  });

  it("다음 커서는 페이지가 꽉 찼을 때만 잇는다", () => {
    expect(nextCursorFor(0, PROGRESS_PAGE_SIZE)).toBe(encodeCursor(PROGRESS_PAGE_SIZE));
    expect(nextCursorFor(1000, PROGRESS_PAGE_SIZE)).toBe(encodeCursor(1000 + PROGRESS_PAGE_SIZE));
    expect(nextCursorFor(1000, PROGRESS_PAGE_SIZE - 1)).toBeNull();
    expect(nextCursorFor(0, 0)).toBeNull();
  });
});

describe("todays-math 연계 — 인증", () => {
  it("정확한 Bearer 만 통과한다", () => {
    expect(isAuthorized("Bearer tm_abc", "tm_abc")).toBe(true);
    expect(isAuthorized("Bearer tm_abc ", "tm_abc")).toBe(false);
    expect(isAuthorized("bearer tm_abc", "tm_abc")).toBe(false);
    expect(isAuthorized("tm_abc", "tm_abc")).toBe(false);
    expect(isAuthorized(null, "tm_abc")).toBe(false);
  });

  /**
   * 🔴 키가 env 에 **없으면 무조건 거부** — fail-open 금지.
   *    빈 문자열 키로 `Bearer ` 를 맞춰 들어오는 것도 막는다.
   */
  it("키 미설정이면 무엇이 와도 거부한다", () => {
    expect(isAuthorized("Bearer ", undefined)).toBe(false);
    expect(isAuthorized("Bearer ", "")).toBe(false);
    expect(isAuthorized(null, undefined)).toBe(false);
  });
});
