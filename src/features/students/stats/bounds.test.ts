import { describe, expect, it } from "vitest";
import { courseBounds, flowBounds, trendBounds } from "./bounds";

const monthly = [
  { key: "2026-01", count: 0 },
  { key: "2026-02", count: 300 },
  { key: "2026-04", count: 320 },
  { key: "2026-05", count: 330 },
];

describe("원생 통계 경계(화면이 하던 계산 그대로)", () => {
  it("에이와 기록이 갖춰진 달이 가장 늦으면 그 달부터 · 안내 문장도 그 이유", () => {
    const b = { recordsFrom: null, breakdownFrom: "2026-01", createdMonth: "2025-12", trustFrom: "2026-04" };
    const t = trendBounds(b, monthly, null);
    expect(t.countFrom).toBe("2026-04");
    expect(t.clipNote).toContain("2026년 4월부터 그립니다");
    expect(courseBounds(b, t).courseFrom).toBe("2026-04");
  });

  it("퇴원 기록이 있으면 그 달부터(첫 학생 달보다 앞서도) · 과목 관리자는 과목을 가를 수 있는 달도 지킨다", () => {
    const b = { recordsFrom: "2025-11", breakdownFrom: "2026-02", createdMonth: "2025-10", trustFrom: null };
    expect(trendBounds(b, monthly, null)).toEqual({ countFrom: "2025-11", clipNote: "퇴원 기록이 2025년 11월부터 있어, 그 전 기간은 정확히 셀 수 없어 보이지 않습니다." });
    const scoped = trendBounds(b, monthly, "수학");
    expect(scoped.countFrom).toBe("2026-02");
    expect(scoped.clipNote).toContain("수학 흐름은 2026년 2월부터입니다");
  });

  it("월별 기록 — 첫 등록·퇴원 달과 지점 시작 달 중 늦은 쪽 · 말일 재원생은 그 경계 뒤만", () => {
    const b = { recordsFrom: null, breakdownFrom: null, createdMonth: "2026-02", trustFrom: null };
    const rows = [{ month: "2026-01", enrolled: 0, withdrawn: 0 }, { month: "2026-04", enrolled: 3, withdrawn: 1 }] as unknown as Parameters<typeof flowBounds>[1];
    const f = flowBounds(b, rows, monthly, null);
    expect(f.flowFrom).toBe("2026-04");
    expect(f.monthEnd).toEqual({ "2026-04": 320, "2026-05": 330 });
  });
});
