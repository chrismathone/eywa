import { describe, expect, it, vi } from "vitest";
vi.mock("./classnote-admin-core.mjs", () => ({ fetchBoardChildren: vi.fn(), fetchChildDetail: vi.fn(), findChildReportId: vi.fn() }));
const { isMakeupDeliveryEligible } = await import("./classnote-class-route.mjs");

describe("보강 보고서 전달 경로의 워커 재검증", () => {
  const report = { class_id: null, makeup_class_id: "JJ", classnote_class_id: "MS", student_id: "student", subject: "math", report_date: "2026-11-12" };
  it("반 보드 배정과 보고서 날짜의 수강을 모두 확인한다", async () => {
    const sql = vi.fn().mockResolvedValue([{ ok: 1 }]);
    expect(await isMakeupDeliveryEligible(sql, "tenant", report)).toBe(true);
    expect(sql).toHaveBeenCalledTimes(2);
    const [strings, ...params] = sql.mock.calls[1];
    const query = strings.join("?");
    expect(query).toContain("e.is_transferred");
    expect(query).toContain("e.on_hold");
    expect(query).toContain("c.subject");
    expect(params).toContain("tenant");
    expect(params).toContain("student");
    expect(params).toContain("2026-11-12");
    expect(report.makeup_class_id).toBe("JJ");
  });
  it("원아 배정이나 수강 확인이 실패하면 보내지 않는다", async () => {
    expect(await isMakeupDeliveryEligible(vi.fn().mockResolvedValue([]), "tenant", report)).toBe(false);
    const sql = vi.fn().mockResolvedValueOnce([{ ok: 1 }]).mockResolvedValueOnce([]);
    expect(await isMakeupDeliveryEligible(sql, "tenant", report)).toBe(false);
  });
  it("보강 반이 없거나 정규 보고서이면 다른 반 전달을 허용하지 않는다", async () => {
    const sql = vi.fn();
    expect(await isMakeupDeliveryEligible(sql, "tenant", { ...report, makeup_class_id: null })).toBe(false);
    expect(await isMakeupDeliveryEligible(sql, "tenant", { ...report, class_id: "regular" })).toBe(false);
    expect(sql).not.toHaveBeenCalled();
  });
});
