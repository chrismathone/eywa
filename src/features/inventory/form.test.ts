import { describe, expect, it } from "vitest";
import { dateField, idField, intField, isYmd, textField } from "./form";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("폼 파서", () => {
  it("문자열 — trim, 빈 값은 null, 길이 초과는 한글 오류", () => {
    expect(textField(fd({ a: "  LG  " }), "a", "제조사", 80)).toEqual({ value: "LG" });
    expect(textField(fd({ a: "   " }), "a", "제조사", 80)).toEqual({ value: null });
    expect(textField(fd({}), "a", "제조사", 80)).toEqual({ value: null });
    expect(textField(fd({ a: "x".repeat(81) }), "a", "제조사", 80)).toMatchObject({ error: expect.stringContaining("80자") });
  });
  it("날짜 — 형식+실존, 빈 값은 null", () => {
    expect(isYmd("2026-13-45")).toBe(false);
    expect(dateField(fd({ d: "2026-09-02" }), "d", "입고일")).toEqual({ value: "2026-09-02" });
    expect(dateField(fd({ d: "" }), "d", "입고일")).toEqual({ value: null });
    expect(dateField(fd({ d: "상시" }), "d", "입고일")).toMatchObject({ error: expect.stringContaining("입고일") });
  });
  it("정수 — 0 이상만", () => {
    expect(intField(fd({ q: "20" }), "q", "수량")).toEqual({ value: 20 });
    expect(intField(fd({ q: "-1" }), "q", "수량")).toMatchObject({ error: expect.stringContaining("수량") });
    expect(intField(fd({ q: "1.5" }), "q", "수량")).toMatchObject({ error: expect.any(String) });
  });
  it("id — uuid 모양만", () => {
    expect(idField(fd({ id: "8f0f4d2e-0e1a-4b0b-9c4e-7a2b3c4d5e6f" }))).toBe("8f0f4d2e-0e1a-4b0b-9c4e-7a2b3c4d5e6f");
    expect(idField(fd({ id: "1 or 1=1" }))).toBeNull();
  });
});
