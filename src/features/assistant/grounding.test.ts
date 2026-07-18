import { describe, expect, it } from "vitest";
import {
  buildGrounding,
  extractMoneyValues,
  extractPercentValues,
  findComparisonIssues,
  findGroundingIssues,
  parseMoneyValue,
  stripUngroundedSentences,
} from "./grounding";

describe("parseMoneyValue — 한국어 금액 정규화", () => {
  it("콤마 정수", () => expect(parseMoneyValue("817,500원")).toBe(817500));
  it("만+원 복합", () => expect(parseMoneyValue("81만 7,500원")).toBe(817500));
  it("만 접미", () => expect(parseMoneyValue("1,286만원")).toBe(12860000));
  it("천만", () => expect(parseMoneyValue("1천만원")).toBe(10000000));
  it("억+만", () => expect(parseMoneyValue("1억 2천만원")).toBe(120000000));
  it("raw 정수 원", () => expect(parseMoneyValue("12,860,000원")).toBe(12860000));
});

describe("extractMoneyValues", () => {
  it("여러 금액", () => {
    expect(extractMoneyValues("윤나연 817,500원, 김민서 800,500원").sort()).toEqual([800500, 817500]);
  });
  it("만원 압축 표기", () => {
    expect(extractMoneyValues("미납 잔액은 약 1,286만 원입니다")).toEqual([12860000]);
  });
  it("금액 없는 문장", () => expect(extractMoneyValues("오늘 9명 출석")).toEqual([]));
});

describe("extractPercentValues", () => {
  it("수납률", () => expect(extractPercentValues("수납률은 91.76%입니다")).toEqual([91.76]));
  it("정수 %", () => expect(extractPercentValues("28% 달성")).toEqual([28]));
});

describe("findComparisonIssues — 없는 비교 날조", () => {
  it("전월 대비 = 날조", () => expect(findComparisonIssues("전월 대비 늘었습니다").length).toBeGreaterThan(0));
  it("지난주 평균 = 날조", () =>
    expect(findComparisonIssues("지난주 평균은 8.2명이었습니다").length).toBeGreaterThan(0));
  it("평소보다 = 날조", () => expect(findComparisonIssues("평소보다 높습니다").length).toBeGreaterThan(0));
  it("정상 서술은 통과", () =>
    expect(findComparisonIssues("각 반 수강생은 4~8명으로 고르게 분포합니다")).toEqual([]));
  it("'평균적으로 고르게'는 오탐 아님", () =>
    expect(findComparisonIssues("수강생이 평균적으로 고르게 분포되어 있습니다")).toEqual([]));
});

describe("findGroundingIssues — 실측 날조 시나리오", () => {
  // 퇴원 툴 결과엔 금액이 없다 → 답변의 어떤 금액도 날조.
  const withdrawalGrounding = buildGrounding([
    JSON.stringify({ month: "2026-07", count: 8, list: [{ name: "박정빈", grade: "고1", withdrawnAt: "2026-07-13", reason: "기타" }] }),
    "이번 달 퇴원 어때?",
    "2026-07-18",
  ]);
  it("퇴원 답변의 '미납액 1천만원'을 날조로 잡는다", () => {
    const issues = findGroundingIssues("8명 퇴원했습니다. 미납액이 1천만원 남아 있어 안내 문자를 권합니다.", withdrawalGrounding);
    expect(issues.some((i) => i.kind === "money")).toBe(true);
  });
  it("퇴원 급증 정상 답변은 통과", () => {
    const issues = findGroundingIssues("이번 달 퇴원은 8명이며 모두 7월 13일에 몰렸습니다. 원인 확인이 필요합니다.", withdrawalGrounding);
    expect(issues).toEqual([]);
  });

  const billingGrounding = buildGrounding([
    JSON.stringify({ paymentRate: 91.76, outstanding: 12860000, students: [{ name: "윤나연", outstanding: 817500 }, { name: "김민서G", outstanding: 800500 }, { name: "이유하", outstanding: 620000 }] }),
    "미수 큰 학생?",
  ]);
  it("조회된 금액(817,500원)·수납률(91.76%)은 통과", () => {
    const issues = findGroundingIssues("윤나연 817,500원이 가장 크고 수납률은 91.76%입니다.", billingGrounding);
    expect(issues).toEqual([]);
  });
  it("만원 압축(81만 7,500원)도 통과", () => {
    const issues = findGroundingIssues("윤나연 학생은 81만 7,500원으로 가장 큽니다.", billingGrounding);
    expect(issues).toEqual([]);
  });
  it("미수 합(윤나연+김민서=161만 8천)도 근거 인정", () => {
    const issues = findGroundingIssues("상위 두 학생 합계가 1,618,000원입니다.", billingGrounding);
    expect(issues.filter((i) => i.kind === "money")).toEqual([]);
  });
  it("지어낸 미수 금액(500,000원)은 날조로 잡는다", () => {
    const issues = findGroundingIssues("이유하 학생은 500,000원 미납입니다.", billingGrounding);
    expect(issues.some((i) => i.kind === "money")).toBe(true);
  });
  it("계산해낸 전환율(28.5%)은 날조로 잡는다(조회된 비율 아님)", () => {
    const enrollG = buildGrounding([JSON.stringify({ total: 21, byOutcome: { 등록: 6, 대기: 8 } }), "등록상담"]);
    const issues = findGroundingIssues("전환율은 28.5%로 대기 8건이 남았습니다.", enrollG);
    expect(issues.some((i) => i.kind === "percent")).toBe(true);
  });
  it("조회된 비율 필드(weekRatePercent·paymentRate)를 %로 표기해도 통과", () => {
    const writingG = buildGrounding([JSON.stringify({ teachers: [{ teacher: "김윤하", weekWritten: 28, weekTarget: 101, weekRatePercent: 28 }] }), "작성 현황"]);
    expect(findGroundingIssues("김윤하 선생님 작성률은 28%입니다.", writingG).filter((i) => i.kind === "percent")).toEqual([]);
    const billG = buildGrounding([JSON.stringify({ paymentRate: 91.76 }), "수납률"]);
    expect(findGroundingIssues("수납률은 91.76%입니다.", billG).filter((i) => i.kind === "percent")).toEqual([]);
  });
});

describe("stripUngroundedSentences", () => {
  const g = buildGrounding([JSON.stringify({ count: 8, list: [{ withdrawnAt: "2026-07-13" }] }), "2026-07-18"]);
  it("날조 문장만 제거하고 팩트 문장은 보존", () => {
    const out = stripUngroundedSentences(
      "이번 달 퇴원은 8명이며 모두 7월 13일에 몰렸습니다. 미납액 1천만원을 안내하세요.",
      g,
    );
    expect(out).toContain("8명");
    expect(out).not.toContain("1천만원");
  });
  it("한 문장뿐이면 원문 유지(재생성이 담당)", () => {
    const out = stripUngroundedSentences("전월 대비 늘었습니다.", g);
    expect(out).toBe("전월 대비 늘었습니다.");
  });
});
