import { describe, it, expect } from "vitest";
import { canResolveProgressAnomaly } from "./anomaly-gate";

describe("canResolveProgressAnomaly", () => {
  it("full(원장·사무실·상담) = 전 학생 확인 가능", () => {
    expect(canResolveProgressAnomaly("full", true)).toBe(true);
    expect(canResolveProgressAnomaly("full", false)).toBe(true);
  });
  it("scoped(강사) = 본인 담당 학생만 — 소유 확인이 AND로 붙어야 남의 반 신호를 못 끈다", () => {
    expect(canResolveProgressAnomaly("scoped", true)).toBe(true);
    expect(canResolveProgressAnomaly("scoped", false)).toBe(false);
  });
  it("readonly·none(회계·뷰어)은 불가 — 담당 학생이어도 불가", () => {
    expect(canResolveProgressAnomaly("readonly", true)).toBe(false);
    expect(canResolveProgressAnomaly("none", true)).toBe(false);
  });
});
