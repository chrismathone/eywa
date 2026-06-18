import { describe, expect, it } from "vitest";
import { parseForwardedFor, summarizeUserAgent } from "./device-info";

describe("parseForwardedFor", () => {
  it("x-forwarded-for 첫 항목(클라이언트 IP)", () => {
    expect(parseForwardedFor("203.0.113.7, 70.41.3.18, 150.172.238.178")).toBe("203.0.113.7");
    expect(parseForwardedFor("203.0.113.7")).toBe("203.0.113.7");
  });
  it("xff 없으면 x-real-ip 폴백", () => {
    expect(parseForwardedFor(null, "198.51.100.5")).toBe("198.51.100.5");
    expect(parseForwardedFor("", "198.51.100.5")).toBe("198.51.100.5");
  });
  it("둘 다 없으면 null", () => {
    expect(parseForwardedFor(null)).toBeNull();
    expect(parseForwardedFor(undefined, undefined)).toBeNull();
    expect(parseForwardedFor("  ")).toBeNull();
  });
});

describe("summarizeUserAgent", () => {
  it("주요 기기 종류 분류", () => {
    expect(summarizeUserAgent("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) ...")).toBe("아이패드");
    expect(summarizeUserAgent("Mozilla/5.0 (Linux; Android 14; SM-X710) ...")).toBe("안드로이드");
    expect(summarizeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 ...) ...")).toBe("아이폰");
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...")).toBe("Windows");
    expect(summarizeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ...")).toBe("Mac");
  });
  it("빈값/미상", () => {
    expect(summarizeUserAgent(null)).toBe("알 수 없음");
    expect(summarizeUserAgent("")).toBe("알 수 없음");
    expect(summarizeUserAgent("SomeUnknownBot/1.0")).toBe("기타");
  });
});
