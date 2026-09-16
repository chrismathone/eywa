import { describe, expect, it } from "vitest";
import { billingSchema } from "@/features/owner/settings-types";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { resolveSettings } from "@/features/owner/resolve";
import { diffSettingsSection } from "@/features/owner/settings-diff";
import { DEFAULT_SESSION_PRICES, isEieMonthlyClass, sessionPriceOptions, withEieMonthlyTuition } from "./session-pricing";
import type { TuitionCatalogOption } from "./tuition-catalog";
import { computeSplitRows } from "./session-terms/splits";
import { aggregateTeacherAllocations } from "./session-terms/allocation";
import { computeTeacherSettlements } from "@/features/payroll/settlement";

describe("설정에서 관리하는 공통 단가", () => {
  it("옛 설정에도 첨부표의 13개 금액과 EiE 월 27만원을 제공한다", () => {
    const { billing } = resolveSettings({ billing: { dueDay: 12 } }, { name: "학원" });
    expect(sessionPriceOptions(billing.sessionPrices).map((r) => r.price)).toEqual([
      21250, 22500, 24000, 25000, 27250, 29167, 29250, 30000, 31250, 32500, 33333, 36000, 37500,
    ]);
    expect(billing.eieMonthlyPrice).toBe(270000);
  });

  it("추가·수정·삭제한 목록을 저장·재조회하면 기본값이 되살아나지 않는다", () => {
    const sessionPrices = [{ price: 41000, label: "신규" }, { price: 22000, label: "수정" }];
    const saved = billingSchema.parse({ ...DEFAULT_SETTINGS.billing, sessionPrices, eieMonthlyPrice: 280000 });
    const { billing } = resolveSettings({ billing: saved }, { name: "학원" });
    expect(sessionPriceOptions(billing.sessionPrices)).toEqual([sessionPrices[1], sessionPrices[0]]);
    expect(billing.eieMonthlyPrice).toBe(280000);
    expect(DEFAULT_SETTINGS.billing.sessionPrices).toEqual(DEFAULT_SESSION_PRICES);
    expect(sessionPriceOptions(resolveSettings({ billing: { sessionPrices: [] } }, { name: "학원" }).billing.sessionPrices)).toEqual([]);
  });

  it("중복·소수·음수·무한대 단가는 저장을 거절한다", () => {
    for (const prices of [[24000, 24000], [0], [-1], [29166.75], [Infinity]]) {
      expect(billingSchema.safeParse({
        ...DEFAULT_SETTINGS.billing, sessionPrices: prices.map((price) => ({ price, label: "" })),
      }).success).toBe(false);
    }
    expect(billingSchema.safeParse({ ...DEFAULT_SETTINGS.billing, eieMonthlyPrice: 0 }).success).toBe(false);
  });

  it("같은 금액이 남아 있는 저장값도 후보는 하나로 정렬한다", () => {
    expect(sessionPriceOptions([{ price: 25000, label: "영어" }, { price: 24000, label: "공통" }, { price: 25000, label: "수학" }]))
      .toEqual([{ price: 24000, label: "공통" }, { price: 25000, label: "영어" }]);
  });

  it("감사로그에 금액 변경 전후를 남긴다", () => {
    const diff = diffSettingsSection("billing",
      { sessionPrices: [{ price: 24000, label: "공통" }] },
      { sessionPrices: [{ price: 25000, label: "공통" }] });
    expect(diff.changes[0].from).toContain("24000원");
    expect(diff.changes[0].to).toContain("25000원");
  });
});

describe("EiE 월 수강료", () => {
  const row = (id: string, pricingMode: TuitionCatalogOption["pricingMode"], category = "EIE"): TuitionCatalogOption =>
    ({ id, pricingMode, category, name: id, price: 270000, note: null });

  it("잘못된 회당·미지정·월 항목을 설정 금액의 월 고정 한 항목으로 합친다", () => {
    const catalog = [row("a", "per_session"), row("b", null), row("c", "monthly", "EiE"), row("extra", "extra"), row("discount", "discount"), row("math", "per_session", "수학")];
    const result = withEieMonthlyTuition(catalog, 280000);
    expect(result.map((r) => r.id)).toEqual(["extra", "discount", "math", "eie-monthly"]);
    expect(result.at(-1)).toMatchObject({ price: 280000, pricingMode: "monthly" });
    expect(catalog[0].pricingMode).toBe("per_session"); // 원본·기존 견적은 수정하지 않는다.
  });

  it("이름 대신 명시된 영어 트랙으로만 월 정액을 판정한다", () => {
    expect(isEieMonthlyClass("english", "eie")).toBe(true);
    expect(isEieMonthlyClass("english", null)).toBe(false);
    expect(isEieMonthlyClass("english", "injaewon")).toBe(false);
    expect(isEieMonthlyClass("math", "eie")).toBe(false);
  });

  it.each([0, 1, 8, 12, 20])("실 출석 %s회여도 월 27만원 × 0.911 × 50%% = 122,985원", (actualConsumed) => {
    const input = {
      invoiceId: "invoice", classId: "class", className: "EiE", subject: "english", teacherId: "teacher", teacherName: "강사",
      pricingMode: "monthly" as const, confirmedSessions: 12, unitPrice: 270000, amount: 270000, actualConsumed,
    };
    const splits = computeSplitRows([input]);
    expect(splits[0]).toMatchObject({ pricingMode: "monthly", confirmedAmount: 270000, actualAmount: 270000, diffAmount: 0 });
    expect(aggregateTeacherAllocations([input])[0]).toMatchObject({ confirmedAmount: 270000, actualAmount: 270000, diffAmount: 0 });
    expect(computeTeacherSettlements(splits, new Map([["teacher", { salaryType: "commission", commissionRate: 50, monthlyBase: 0 }]]))[0])
      .toMatchObject({ payableTotal: 270000, settlement: 122985 });
  });

  it("설정이 바뀌어도 확정한 월 금액을 정산하며 미확정은 분배하지 않는다", () => {
    const input = { invoiceId: "i", classId: "c", subject: "english", teacherId: "t", teacherName: "강사", pricingMode: "monthly" as const,
      confirmedSessions: 8, unitPrice: 270000, amount: 260000, actualConsumed: 9 };
    expect(computeSplitRows([input])[0].actualAmount).toBe(260000);
    expect(computeSplitRows([{ ...input, amount: null }])[0].actualAmount).toBe(270000);
    expect(computeSplitRows([{ ...input, confirmedSessions: null }])).toEqual([]);
  });
});
