import { describe, expect, it } from "vitest";
import {
  dateAppearsIn,
  groundContractExtract,
  isEmptyExtract,
  composeContractTerms,
  maskResidentRegNo,
  normalizeContractDate,
} from "./contract-extract";

// 실제 근로계약서에서 흔한 문장 형태.
const PDF = `
근로계약서
사용자 (주)곰돌이 / 근로자 김동후
1. 계약기간: 2026년 6월 29일 부터 2026년 9월 30일 까지 (수습 3개월)
2. 근무형태: 정규직
3. 임금: 월 3,584,000원 (매월 10일 지급)
`;

describe("normalizeContractDate", () => {
  it("한글·점·하이픈 표기를 모두 YYYY-MM-DD로", () => {
    expect(normalizeContractDate("2026년 6월 29일")).toBe("2026-06-29");
    expect(normalizeContractDate("2026.06.29")).toBe("2026-06-29");
    expect(normalizeContractDate("2026-6-29")).toBe("2026-06-29");
  });

  it("실재하지 않는 날짜는 버린다 — 보정하면 원문에 없는 날을 만들어내는 셈", () => {
    expect(normalizeContractDate("2026-02-30")).toBe("");
    expect(normalizeContractDate("2026-13-01")).toBe("");
  });

  it("읽을 수 없으면 빈 값", () => {
    expect(normalizeContractDate("추후 협의")).toBe("");
    expect(normalizeContractDate(null)).toBe("");
  });
});

describe("dateAppearsIn", () => {
  it("구분자가 달라도 원문에 있으면 인정", () => {
    expect(dateAppearsIn("계약기간 2026년 6월 29일 부터", "2026-06-29")).toBe(true);
    expect(dateAppearsIn("2026.06.29 ~", "2026-06-29")).toBe(true);
    expect(dateAppearsIn("2026/6/29", "2026-06-29")).toBe(true);
  });

  it("원문에 없으면 거부(환각 차단)", () => {
    expect(dateAppearsIn("계약기간 2026년 6월 29일", "2027-06-29")).toBe(false);
  });
});

describe("groundContractExtract", () => {
  it("원문에 있는 값은 통과", () => {
    const out = groundContractExtract(
      {
        startDate: "2026년 6월 29일",
        endDate: "2026-09-30",
        employmentType: "정규직",
        terms: "월 3,584,000원",
      },
      PDF,
    );
    expect(out).toEqual({
      startDate: "2026-06-29",
      endDate: "2026-09-30",
      employmentType: "정규직",
      terms: "월 3,584,000원",
    });
  });

  it("🔴 원문에 없는 금액은 버린다 — 지어낸 급여가 계약에 박히면 안 된다", () => {
    const out = groundContractExtract({ terms: "월 5,000,000원" }, PDF);
    expect(out.terms).toBe("");
  });

  it("🔴 원문에 없는 날짜는 기간 통째로 버린다", () => {
    const out = groundContractExtract({ startDate: "2026-06-29", endDate: "2027-06-28" }, PDF);
    expect(out.startDate).toBe("");
    expect(out.endDate).toBe("");
  });

  it("종료일이 시작일보다 앞이면 기간을 버린다", () => {
    const out = groundContractExtract({ startDate: "2026-09-30", endDate: "2026-06-29" }, PDF);
    expect(out.startDate).toBe("");
  });

  it("근무형태는 선택지 안 + 원문에 있어야 통과", () => {
    expect(groundContractExtract({ employmentType: "프리랜서" }, PDF).employmentType).toBe("");
    expect(groundContractExtract({ employmentType: "계약직" }, PDF).employmentType).toBe("");
    expect(groundContractExtract({ employmentType: "정규직" }, PDF).employmentType).toBe("정규직");
  });

  it("숫자가 없는 조건 문구는 그대로 통과(요약 허용)", () => {
    expect(groundContractExtract({ terms: "수습 기간 적용" }, PDF).terms).toBe("수습 기간 적용");
  });

  it("아무것도 못 뽑으면 빈 결과로 알린다", () => {
    expect(isEmptyExtract(groundContractExtract({}, PDF))).toBe(true);
    expect(isEmptyExtract(groundContractExtract({ employmentType: "정규직" }, PDF))).toBe(false);
  });
});

describe("maskResidentRegNo", () => {
  it("주민번호 뒤 7자리를 가린다(하이픈·공백·붙인 13자리)", () => {
    expect(maskResidentRegNo("주민등록번호 900101-1234567 임")).toBe("주민등록번호 900101-******* 임");
    expect(maskResidentRegNo("900101 - 1234567")).toBe("900101-*******");
    expect(maskResidentRegNo("9001011234567 / 900101 1234567")).toBe("900101-******* / 900101-*******");
  });
  it("문서에서 쓰는 여러 대시·물결·점을 모두 가린다", () => {
    for (const separator of ["—", "‐", "‑", "−", "~", ".", "–"]) {
      expect(maskResidentRegNo(`900101 ${separator} 1234567`), separator).toBe("900101-*******");
    }
  });
  it("앞뒤 숫자에 붙은 13자리 일부를 잘못 가리지 않는다", () => {
    expect(maskResidentRegNo("19001011234567")).toBe("19001011234567");
    expect(maskResidentRegNo("90010112345678")).toBe("90010112345678");
  });
  it("전화번호·날짜는 건드리지 않는다", () => {
    expect(maskResidentRegNo("010-0000-9101 / 2026-08-03")).toBe("010-0000-9101 / 2026-08-03");
  });
  it("13자리 계좌·전화가 섞여도 덜 가리는 것보다 안전하게 가린다", () => {
    expect(maskResidentRegNo("계좌 1234561234567")).toBe("계좌 123456-*******");
  });
});

describe("composeContractTerms — 계약 종류별 조건 조립", () => {
  it("비율제: 라벨(퍼센트) 나열 — 시트 관례 형태", () => {
    const body = "강의 용역 계약서 … 강의료는 초등 43%, 중등 44%, 고등 45% 로 배분한다";
    const out = composeContractTerms(
      { contractKind: "강의용역", payType: "비율", rates: [
        { label: "초등", percent: 43 }, { label: "중등", percent: 44 }, { label: "고등", percent: 45 },
      ] },
      body,
    );
    expect(out).toBe("강의용역 : 초등(43%), 중등(44%), 고등(45%)");
  });
  it("시급제 + 시용기간", () => {
    const body = "(시용)근로계약서 … 시용기간은 3개월 … 시급 15,000원을 지급한다";
    const out = composeContractTerms(
      { contractKind: "(시용)근로", payType: "시급", hourlyPay: "15,000", probationMonths: 3 },
      body,
    );
    expect(out).toBe("(시용)근로 : 시용 3개월 / 시급 15,000원");
  });
  it("월급제 + 포괄임금(원문 단어로 판정)", () => {
    const body = "근로계약서 … 월 급여액은 일금 2,200,000원으로 … 포괄임금제로 한다";
    const out = composeContractTerms(
      { contractKind: "근로", payType: "월급", monthlyPay: "2,200,000" },
      body,
    );
    expect(out).toBe("근로 : 월급 2,200,000원 (포괄임금)");
  });
  it("원문에 없는 금액·퍼센트·종류는 버린다(지어낸 값 차단)", () => {
    const body = "근로계약서 … 월 급여액은 일금 2,200,000원";
    expect(composeContractTerms({ payType: "월급", monthlyPay: "9,999,999" }, body)).toBe("");
    expect(composeContractTerms({ payType: "비율", rates: [{ label: "초등", percent: 43 }] }, body)).toBe("");
    // 종류가 본문에 없으면 접두 없이 금액만
    expect(composeContractTerms({ contractKind: "강의용역", payType: "월급", monthlyPay: "2,200,000" }, body)).toBe(
      "월급 2,200,000원",
    );
  });
  it("구조 필드가 비면 빈 문자열 — 호출부가 통짜 인용 폴백", () => {
    expect(composeContractTerms({}, "아무 본문")).toBe("");
  });
  it("회사명 접두 — 시트 관례 '회사_종류 : 조건', 주식회사는 (주)로 축약", () => {
    const body =
      "주식회사 곰돌이(강의하는아이들 인재원학원)와 근로자는 … (시용)근로계약 … 시용기간 3개월 … 시급 15,000원";
    const out = composeContractTerms(
      { company: "주식회사 곰돌이", contractKind: "(시용)근로", payType: "시급", hourlyPay: "15,000", probationMonths: 3 },
      body,
    );
    expect(out).toBe("(주)곰돌이_(시용)근로 : 시용 3개월 / 시급 15,000원");
  });
  it("본문에 없는 회사명은 접두에서 버린다", () => {
    const body = "근로계약서 … 월 급여액은 일금 2,200,000원 … 포괄임금제";
    const out = composeContractTerms(
      { company: "주식회사 없는회사", contractKind: "근로", payType: "월급", monthlyPay: "2,200,000" },
      body,
    );
    expect(out).toBe("근로 : 월급 2,200,000원 (포괄임금)");
  });
});
