import { describe, expect, it } from "vitest";
import {
  dateAppearsIn,
  groundContractExtract,
  isEmptyExtract,
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
