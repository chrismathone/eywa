import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PayslipDocument } from "./payslip-document";
import { computePayslipAmounts } from "@/features/payroll/payslip";
import type { PayslipData } from "@/features/payroll/payslip-view";

function makeData(over: Partial<PayslipData> = {}): PayslipData {
  return {
    period: "2026-07",
    company: { name: "(주) 곰돌이", representativeName: "김대표", bizRegNo: null, sealUrl: null, signerLabels: "박소선" },
    teacher: {
      id: "t1",
      name: "김은정",
      residentRegNo: "760819-2000000",
      bankName: "국민은행",
      accountNumber: "000-00-0000",
      employmentType: "강사",
      department: "수학과",
      hireDate: "2016-09-01",
      contractPeriod: { start: "2023-09-01", end: "2025-08-31", stored: true },
      classes: [{ id: "c1", className: "초등M BS1J", subject: "math" }],
    },
    amounts: computePayslipAmounts({ tuition: 3_181_049 }),
    settlement: {
      total: 3_181_049,
      lines: [],
      grossTuition: 7_307_250,
      unitsTotal: 132,
      rowCount: 51,
      excludedUnits: 0,
      missingTierStudents: [],
      missingPriceTiers: [],
    },
    rates: { base: { 초등: 47.5 }, baseDefault: null, applied: { 초등: 47.5 }, appliedDefault: null, penaltyPoints: 0 },
    metrics: {
      studentsThisMonth: 51,
      withdrawal: { count: 3, names: ["김채은"], rate: 3 / 51, unknownDateCount: 0 },
      cumulativeStudents: 92,
      averageStudents: 52.25,
      yearlyWithdrawals: 23,
    },
    adjustments: {
      incentive: 0,
      otherDeduction: 0,
      blogWrittenOn: "7/1",
      ratePenaltyPoints: 0,
      ratePenaltyReason: null,
      memo: null,
      status: "draft",
      issuedAt: null,
    },
    warnings: [],
    ...over,
  };
}

describe("급여명세서 문서", () => {
  it("정상 산정 시 시트와 같은 금액을 찍는다", () => {
    render(<PayslipDocument data={makeData()} />);
    // 수업료 총액 · 지급총액 두 칸에 같은 값이 찍힌다(인센티브 0)
    expect(screen.getAllByText("₩3,181,049")).toHaveLength(2);
    expect(screen.getByText("₩3,076,074")).toBeTruthy(); // 실수령액
    // 소득세 3.3% · 공제총액 두 칸(기타공제 0이라 같은 값)
    expect(screen.getAllByText("₩104,975")).toHaveLength(2);
    expect(screen.getByText("132T")).toBeTruthy();
  });

  /**
   * 🔴 회귀 가드 — 적대 리뷰가 잡은 치명 버그. settlement가 null(산정 불가)인데
   *    수업료만 가리고 지급총액·실수령액에 ₩0을 찍으면 **겉보기 정상인 거짓 명세서**가 인쇄된다.
   *    금액 칸이 **전부** '산정 불가'여야 하고, ₩0은 어디에도 없어야 한다.
   */
  it("산정 불가면 금액 칸이 전부 '산정 불가'이고 ₩0을 찍지 않는다", () => {
    render(
      <PayslipDocument
        data={makeData({
          settlement: null,
          amounts: computePayslipAmounts({ tuition: 0 }),
          warnings: ["단가 미지정 3명 — 40시수가 산정에서 빠졌습니다."],
        })}
      />,
    );
    // 수업료·소득세·지급총액·공제총액·실수령액·총 시수 = 6칸
    expect(screen.getAllByText("산정 불가")).toHaveLength(6);
    expect(screen.queryByText("₩0")).toBeNull();
    expect(screen.queryByText("0T")).toBeNull();
  });

  it("경고는 화면에만 뜨고 종이에는 안 나간다(print:hidden)", () => {
    const { container } = render(render1());
    const box = container.querySelector(".print\\:hidden");
    expect(box?.textContent).toContain("단가 미지정");
  });

  it("차감이 있으면 기본 비율과 적용 비율을 함께 보인다", () => {
    render(
      <PayslipDocument
        data={makeData({
          rates: { base: { 초등: 47.5 }, baseDefault: null, applied: { 초등: 45.5 }, appliedDefault: null, penaltyPoints: 2 },
          adjustments: { ...makeData().adjustments, ratePenaltyPoints: 2, ratePenaltyReason: "블로그 미작성" },
        })}
      />,
    );
    expect(screen.getByText("47.5%")).toBeTruthy(); // 기본(취소선)
    expect(screen.getByText("45.5%")).toBeTruthy(); // 적용
    expect(screen.getByText(/전 과정/)).toBeTruthy();
  });

  it("차감이 없으면 '기본' 줄을 그리지 않는다", () => {
    render(<PayslipDocument data={makeData()} />);
    expect(screen.queryByText("기본")).toBeNull();
  });

  it("값이 없는 신상 칸은 '미입력'으로 명시한다(빈칸으로 두지 않는다)", () => {
    render(
      <PayslipDocument
        data={makeData({
          teacher: { ...makeData().teacher, residentRegNo: null, bankName: null, accountNumber: null },
        })}
      />,
    );
    expect(screen.getAllByText("미입력").length).toBeGreaterThanOrEqual(3);
  });

  it("발행 스냅샷이면 '지금 계산한 값이 아니다'를 밝힌다", () => {
    render(
      <PayslipDocument
        data={makeData({
          frozen: true,
          adjustments: { ...makeData().adjustments, status: "issued", issuedAt: "2026-08-10T00:00:00Z" },
        })}
      />,
    );
    expect(screen.getByText(/동결된 스냅샷/)).toBeTruthy();
  });
});

function render1() {
  return <PayslipDocument data={makeData({ warnings: ["단가 미지정 3명 — 40시수가 산정에서 빠졌습니다."] })} />;
}

describe("서명란", () => {
  it("가운데 칸은 '대표'다 (원장 지시 2026-08-13 — 시스템 역할 라벨과는 별개)", () => {
    render(<PayslipDocument data={makeData()} />);
    expect(screen.getByText("대표")).toBeTruthy();
    // 서명란 헤더에 '원장'이 남아 있으면 안 된다(역할 라벨은 이 문서 밖의 이야기)
    expect(screen.queryByText("원장")).toBeNull();
  });

  it("수령인 칸에 그 강사 이름이 자동으로 들어간다", () => {
    render(<PayslipDocument data={makeData()} />);
    // 표 머리(이름 칸)와 서명란 두 곳에 나온다
    expect(screen.getAllByText("김은정").length).toBe(2);
  });

  it("대표자명이 비어 있어도 칸을 만들되 지어내지 않는다", () => {
    const d = makeData();
    render(<PayslipDocument data={{ ...d, company: { ...d.company, representativeName: null } }} />);
    expect(screen.getByText("대표")).toBeTruthy();
    expect(screen.getAllByText("김은정").length).toBe(2); // 수령인은 그대로
  });
});
