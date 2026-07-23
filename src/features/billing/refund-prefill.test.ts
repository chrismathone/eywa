import { describe, expect, it } from "vitest";
import {
  buildRefundPrefill,
  formatPaymentLines,
  splitPrefill,
  type RefundPrefillInvoice,
  type RefundPrefillSource,
} from "./refund-prefill";

const base: RefundPrefillSource = {
  name: "이정민",
  school: "성광중",
  grade: "중3",
  address: "대구 북구 …",
  enrollments: [],
  invoices: [],
};

const inv = (
  period: string,
  lineItems: RefundPrefillInvoice["lineItems"],
  over: Partial<RefundPrefillInvoice> = {},
): RefundPrefillInvoice => ({
  period,
  status: "paid",
  amountTotal: lineItems.reduce((s, l) => s + l.amount, 0),
  amountPaid: lineItems.reduce((s, l) => s + (l.paid ?? 0), 0),
  amountDiscount: 0,
  paymentMethod: null,
  paidAt: null,
  lineItems,
  ...over,
});

describe("buildRefundPrefill", () => {
  it("학교·학년은 압축 표기(공백 join 금지)", () => {
    expect(buildRefundPrefill(base).s_schoolGrade).toBe("성광중3");
  });

  it("값이 없는 칸은 키 자체를 안 넣는다 — 빈 문자열로 덮어쓰지 않게", () => {
    const out = buildRefundPrefill({ ...base, school: null, grade: null, address: null });
    expect("s_schoolGrade" in out).toBe(false);
    expect("s_address" in out).toBe(false);
    expect(out.s_name).toBe("이정민");
  });

  it("진행 중 수강이 있으면 그 전부를 수강반으로 — 종료된 건 섞지 않는다", () => {
    const out = buildRefundPrefill({
      ...base,
      enrollments: [
        { className: "중등M 개별 BS4A 월목", teacherName: "이성우", startDate: "2026-05-01", endDate: null },
        { className: "영어 RTT2", teacherName: "김영어", startDate: "2026-03-02", endDate: null },
        { className: "옛날반", teacherName: "박옛날", startDate: "2025-01-02", endDate: "2025-06-30" },
      ],
    });
    expect(out.s_className).toBe("중등M 개별 BS4A 월목\n영어 RTT2");
    expect(out.s_staffTeacher).toBe("이성우 · 김영어");
    expect(out.s_classDate).toBe("2026-03-02 ~ 수강중");
  });

  it("담임선생님은 담당이 정확히 1명일 때만 — 여럿이면 비운다(담임 개념 폐기)", () => {
    const one = buildRefundPrefill({
      ...base,
      enrollments: [{ className: "A", teacherName: "이성우", startDate: "2026-05-01", endDate: null }],
    });
    expect(one.s_homeroomTeacher).toBe("이성우");

    const many = buildRefundPrefill({
      ...base,
      enrollments: [
        { className: "A", teacherName: "이성우", startDate: "2026-05-01", endDate: null },
        { className: "B", teacherName: "김영어", startDate: "2026-05-01", endDate: null },
      ],
    });
    expect("s_homeroomTeacher" in many).toBe(false);
    expect(many.s_staffTeacher).toBe("이성우 · 김영어");
  });

  it("진행 중이 없으면 가장 최근 1건 — 종료일이 수강기간 끝", () => {
    const out = buildRefundPrefill({
      ...base,
      enrollments: [
        { className: "최근반", teacherName: "이성우", startDate: "2026-03-02", endDate: "2026-07-22" },
        { className: "옛날반", teacherName: "박옛날", startDate: "2025-01-02", endDate: "2025-06-30" },
      ],
    });
    expect(out.s_className).toBe("최근반");
    expect(out.s_classDate).toBe("2026-03-02 ~ 2026-07-22");
  });

  it("환불금액·차감·사유·총수업횟수는 절대 만들지 않는다(사람 판단 영역)", () => {
    const out = buildRefundPrefill({
      ...base,
      enrollments: [{ className: "A", teacherName: "이성우", startDate: "2026-05-01", endDate: null }],
      invoices: [inv("2026-07", [{ kind: "수업", description: "정규반", amount: 168000, paid: 168000, unpaid: 0 }])],
    });
    for (const k of ["r_totalAmount", "r_deductionDetails", "s_reason", "s_totalSessions", "m_account"]) {
      expect(k in out).toBe(false);
    }
  });
});

describe("formatPaymentLines — 월별로 하나하나, 항목까지 분리", () => {
  it("한 달에 항목이 여럿이면 줄도 여럿 — 뭉뚱그리지 않는다", () => {
    const lines = formatPaymentLines([
      inv(
        "2026-03",
        [
          { kind: "수업", description: "[EiE] Let's Talk 5 a", amount: 180000, paid: 180000, unpaid: 0, method: "card", paidDate: "2026-02-25" },
          { kind: "수업", description: "[EiE] ROOKIES&LEADERS", amount: 44000, paid: 44000, unpaid: 0, method: "card", paidDate: "2026-02-25" },
        ],
      ),
    ]);
    expect(lines).toEqual([
      "2026-03 수업 [EiE] Let's Talk 5 a 180,000원 납부 (카드 · 2026-02-25)",
      "2026-03 수업 [EiE] ROOKIES&LEADERS 44,000원 납부 (카드 · 2026-02-25)",
    ]);
  });

  it("할인·미납은 금액 그대로 — 청구액과 실납액을 뭉개지 않는다", () => {
    const lines = formatPaymentLines([
      inv("2026-01", [
        { kind: "수업", description: "정규반", amount: 192000, discount: 10000, paid: 182000, unpaid: 0, method: "transfer", paidDate: "2025-12-29" },
      ]),
      inv("2026-08", [{ kind: "수업", description: "개별진도", amount: 288000, discount: 10000, paid: 0, unpaid: 278000 }], {
        status: "unpaid",
      }),
    ]);
    expect(lines).toEqual([
      "2026-01 수업 정규반 182,000원 납부 (계좌이체 · 2025-12-29 · 할인 10,000원)",
      "2026-08 수업 개별진도 278,000원 미납 (청구 288,000원 · 할인 10,000원)",
    ]);
  });

  it("항목별 상세가 없는 구데이터는 항목=청구, 납부/미납은 '합계' 한 줄로 — 첫 항목에 떠넘기지 않는다", () => {
    // 실데이터 함정: 첫 항목(270,000원)에 청구서 미납(314,000원)을 합성하면 없는 사실이 서류에 찍힌다.
    const lines = formatPaymentLines([
      inv(
        "2026-07",
        [
          { kind: "수업", description: "Let's Speak 2a", amount: 270000 },
          { kind: "수업", description: "교재 ROOKIES", amount: 44000 },
        ],
        { amountTotal: 314000, amountPaid: 0, status: "unpaid" },
      ),
    ]);
    expect(lines).toEqual([
      "2026-07 수업 Let's Speak 2a 270,000원 청구",
      "2026-07 수업 교재 ROOKIES 44,000원 청구",
      "2026-07 합계 314,000원 미납",
    ]);
  });

  it("상세 없는 완납 청구서도 합계 줄에 결제수단·수납일이 붙는다", () => {
    const lines = formatPaymentLines([
      inv(
        "2025-11",
        [
          { kind: "수업", description: "A반", amount: 100000 },
          { kind: "교재", description: "교재비", amount: 20000 },
        ],
        { amountTotal: 120000, amountPaid: 120000, paymentMethod: "cash", paidAt: "2025-11-03T00:00:00.000Z" },
      ),
    ]);
    expect(lines).toEqual([
      "2025-11 수업 A반 100,000원 청구",
      "2025-11 교재 교재비 20,000원 청구",
      "2025-11 합계 120,000원 납부 (현금 · 2025-11-03)",
    ]);
  });

  it("무효(void) 청구는 통째로 제외 — 없던 결제를 서류에 남기지 않는다", () => {
    const lines = formatPaymentLines([
      inv("2026-02", [{ kind: "수업", description: "취소건", amount: 100000, paid: 100000 }], { status: "void" }),
    ]);
    expect(lines).toEqual([]);
  });

  it("모르는 결제수단 코드는 적지 않는다(raw 코드 노출 금지)", () => {
    const lines = formatPaymentLines([
      inv("2026-05", [{ kind: "수업", description: "정규반", amount: 50000, paid: 50000, method: "vbank" }]),
    ]);
    expect(lines).toEqual(["2026-05 수업 정규반 50,000원 납부"]);
  });
});

describe("splitPrefill", () => {
  it("빈 칸만 채우고, 이미 다른 값이 있는 칸은 skipped", () => {
    const { fill, skipped } = splitPrefill(
      { s_name: "이정민", s_address: "대구", s_schoolGrade: "성광중3" },
      { s_name: "", s_address: "직접 쓴 주소", s_schoolGrade: "성광중3" },
    );
    expect(fill).toEqual({ s_name: "이정민" });
    expect(skipped).toEqual(["s_address"]); // 같은 값(schoolGrade)은 알릴 것도 없다
  });
});
