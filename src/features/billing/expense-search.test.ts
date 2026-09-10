import { describe, expect, it } from "vitest";
import {
  expenseMatches,
  expenseSearchTokens,
  filterExpensesByQuery,
  type ExpenseSearchFields,
} from "./expense-search";

// 실데이터(injaewon 2026-09-10) 모양 그대로 — 라인 항목이 제목보다 구체적인 게 흔하다.
const 이벤트: ExpenseSearchFields = {
  title: "[고등관] 친구소개이벤트",
  vendor: "비즈콘",
  author: "김예원",
  department: "고등수학전문관",
  memo: "오충헌 소개로 이규하 등록",
  lineItems: [{ purpose: "친구소개이벤트", vendor: "비즈콘", description: "배민 3만원권" }],
};
const 당근: ExpenseSearchFields = {
  title: "설명회 홍보_ 당근마켓 광고비 충전",
  vendor: "당근마켓",
  author: "김예원",
  department: "운영팀",
  memo: "",
  lineItems: [{ purpose: "홍보비(설명회)", vendor: "당근마켓", description: "설명회(특별반,EIE) 홍보" }],
};
const 컵: ExpenseSearchFields = {
  title: "세모금컵",
  vendor: null,
  author: "엄소윤",
  department: null,
  memo: null,
  lineItems: [{ purpose: "소모품비", vendor: "", description: "세모금컵 4,000개입" }],
};
const 레벨: ExpenseSearchFields = {
  title: "Ai 레벨테스트 이용권 결제",
  vendor: "Ai 레벨테스트",
  author: "정유진",
  department: "영어과",
  memo: null,
  lineItems: [{ purpose: "Ai 레벨테스트 이용권 결제", vendor: null, description: "레벨테스트 10회" }],
};
const ALL = [이벤트, 당근, 컵, 레벨];

describe("expenseSearchTokens", () => {
  it("빈 검색어는 토큰 0개 = 필터 없음", () => {
    for (const q of ["", "   ", null, undefined]) expect(expenseSearchTokens(q)).toEqual([]);
  });

  it("공백으로 나누고 소문자로 맞춘다", () => {
    expect(expenseSearchTokens("  Ai  레벨 ")).toEqual(["ai", "레벨"]);
  });
});

describe("expenseMatches — 대상 칸", () => {
  it("제목·거래처·성명·부서명·메모를 본다", () => {
    expect(expenseMatches(이벤트, ["친구소개"])).toBe(true); // 제목
    expect(expenseMatches(이벤트, ["비즈콘"])).toBe(true); // 거래처
    expect(expenseMatches(이벤트, ["김예원"])).toBe(true); // 성명
    expect(expenseMatches(이벤트, ["고등수학"])).toBe(true); // 부서명
    expect(expenseMatches(이벤트, ["오충헌"])).toBe(true); // 메모
  });

  it("라인 항목의 용도·거래처·사용내역도 본다 — 제목만으론 못 찾는 게 실제로 있다", () => {
    expect(expenseMatches(컵, ["소모품비"])).toBe(true); // 용도(제목엔 없다)
    expect(expenseMatches(컵, ["4,000개입"])).toBe(true); // 사용내역
    expect(expenseMatches(이벤트, ["배민"])).toBe(true); // 사용내역
  });

  it("영문 거래처는 대소문자를 안 가린다", () => {
    expect(expenseMatches(레벨, expenseSearchTokens("ai 레벨"))).toBe(true);
    expect(expenseMatches(레벨, expenseSearchTokens("AI"))).toBe(true);
  });

  it("빈 칸(null)이 있어도 터지지 않는다", () => {
    expect(expenseMatches({ title: null, lineItems: null }, ["아무거나"])).toBe(false);
    expect(expenseMatches({}, [])).toBe(true);
  });
});

describe("expenseMatches — 토큰 AND", () => {
  it("토큰 하나면 단순 부분일치와 같다", () => {
    expect(ALL.filter((r) => expenseMatches(r, ["김예원"]))).toEqual([이벤트, 당근]);
  });

  it("토큰이 둘이면 **전부** 있어야 한다(다른 칸에 흩어져 있어도 된다)", () => {
    // 성명(행) + 거래처(행) 가로지르기 — 한 칸 안에서만 찾으면 0건이 되어 고장으로 읽힌다.
    expect(expenseMatches(당근, expenseSearchTokens("김예원 당근"))).toBe(true);
    expect(expenseMatches(이벤트, expenseSearchTokens("김예원 당근"))).toBe(false);
  });

  it("띄어 쓴 검색어가 붙여 쓴 원문을 찾는다", () => {
    expect(expenseMatches(당근, expenseSearchTokens("당근 마켓"))).toBe(true);
  });

  it("칸 경계를 넘는 우연한 낱말은 안 만든다 — 없는 걸 찾아내면 안 된다", () => {
    // 제목 끝('세모금컵') + 성명 시작('엄소윤')이 붙으면 '컵엄'이 생긴다. 공백으로 갈라 두었다.
    expect(expenseMatches(컵, ["컵엄"])).toBe(false);
  });
});

describe("filterExpensesByQuery", () => {
  it("검색어가 비면 원본 배열을 그대로 돌려준다(사본 없음)", () => {
    expect(filterExpensesByQuery(ALL, "")).toBe(ALL);
    expect(filterExpensesByQuery(ALL, "   ")).toBe(ALL);
    expect(filterExpensesByQuery(ALL, null)).toBe(ALL);
  });

  it("거르기만 한다 — 순서·행 자체는 그대로", () => {
    expect(filterExpensesByQuery(ALL, "레벨테스트")).toEqual([레벨]);
    expect(filterExpensesByQuery(ALL, "김예원")).toEqual([이벤트, 당근]);
  });

  it("안 맞으면 빈 배열(원본을 되돌려 주지 않는다)", () => {
    expect(filterExpensesByQuery(ALL, "없는거래처")).toEqual([]);
  });
});
