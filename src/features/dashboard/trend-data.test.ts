import { describe, expect, it } from "vitest";
import {
  buildDashboardTrendPoints,
  invoicePeriodsForRange,
  kstDateForTimestamp,
  type TrendInvoiceRow,
} from "./trend-data";

const invoice = (overrides: Partial<TrendInvoiceRow>): TrendInvoiceRow => ({
  id: "invoice-1",
  period: "2026-07",
  amount_total: 100,
  amount_paid: 0,
  amount_discount: 0,
  paid_at: null,
  line_items: [],
  ...overrides,
});

describe("dashboard trend data", () => {
  it("7일 창이 월 경계를 넘으면 두 청구월을 조회한다", () => {
    expect(invoicePeriodsForRange("2026-07-27", "2026-08-02")).toEqual(["2026-07", "2026-08"]);
    expect(invoicePeriodsForRange("2026-07-09", "2026-07-15")).toEqual(["2026-07"]);
  });

  it("UTC timestamptz를 KST 달력 날짜로 분류한다", () => {
    expect(kstDateForTimestamp("2026-07-15T14:59:59.999Z")).toBe("2026-07-15");
    expect(kstDateForTimestamp("2026-07-15T15:00:00.000Z")).toBe("2026-07-16");
  });

  it("KST 자정 뒤 납부를 전날 수납률에 조기 반영하지 않는다", () => {
    const points = buildDashboardTrendPoints({
      startIso: "2026-07-15",
      endIso: "2026-07-16",
      attendanceRows: [],
      invoiceRows: [
        invoice({ amount_paid: 50, paid_at: "2026-07-15T15:30:00.000Z" }), // 7/16 00:30 KST
      ],
      includeAttendance: false,
      includeBilling: true,
    });

    expect(points.map((point) => point.payment)).toEqual([0, 50]);
  });

  it("분할 납부는 각 line item의 실제 수납일부터 누적한다", () => {
    const points = buildDashboardTrendPoints({
      startIso: "2026-07-14",
      endIso: "2026-07-16",
      attendanceRows: [],
      invoiceRows: [
        invoice({
          amount_paid: 100,
          paid_at: "2026-07-14T03:00:00.000Z",
          line_items: [
            { paid: 40, paidDate: "2026-07-14" },
            { paid: 60, paidDate: "2026-07-16" },
          ],
        }),
      ],
      includeAttendance: false,
      includeBilling: true,
    });

    expect(points.map((point) => point.payment)).toEqual([40, 40, 100]);
  });

  it("월 경계에서는 각 청구월의 수납률을 따로 계산한다", () => {
    const points = buildDashboardTrendPoints({
      startIso: "2026-07-31",
      endIso: "2026-08-01",
      attendanceRows: [],
      invoiceRows: [
        invoice({ period: "2026-07", amount_paid: 100, paid_at: "2026-07-31T03:00:00.000Z" }),
        invoice({ period: "2026-08", amount_total: 200 }),
      ],
      includeAttendance: false,
      includeBilling: true,
    });

    expect(points.map((point) => point.payment)).toEqual([100, 0]);
  });

  it("실제 0%와 원천 행 없음은 null로 구분한다", () => {
    const points = buildDashboardTrendPoints({
      startIso: "2026-07-15",
      endIso: "2026-07-16",
      attendanceRows: [{ session_date: "2026-07-16", status: "absent" }],
      invoiceRows: [],
      includeAttendance: true,
      includeBilling: true,
    });

    expect(points[0]).toMatchObject({ attendance: null, payment: null });
    expect(points[1]).toMatchObject({ attendance: 0, payment: null });
  });

  it("비허용 지표는 원천 행이 전달돼도 null로 유지한다", () => {
    const [point] = buildDashboardTrendPoints({
      startIso: "2026-07-16",
      endIso: "2026-07-16",
      attendanceRows: [{ session_date: "2026-07-16", status: "present" }],
      invoiceRows: [invoice({ amount_paid: 100, paid_at: "2026-07-16T03:00:00.000Z" })],
      includeAttendance: false,
      includeBilling: false,
    });

    expect(point).toMatchObject({ attendance: null, payment: null });
  });
});
