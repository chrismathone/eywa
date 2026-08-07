import { describe, expect, it } from "vitest";
import { formatPeriodLines, parsePeriodLines } from "./parse";

describe("parsePeriodLines — 사진 보고 치는 입력이라 관대하게", () => {
  it("기본형", () => {
    const { rows, errors } = parsePeriodLines(2026, "3/6~4/2");
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ labelMonth: 3, startDate: "2026-03-06", endDate: "2026-04-02" });
  });

  it("여러 표기를 모두 받는다", () => {
    const text = ["1/5~1/30", "02.02 ~ 03.05", "3월 3/6~4/2", "2026-04-06 - 2026-05-01"].join("\n");
    const { rows, errors } = parsePeriodLines(2026, text);
    expect(errors).toEqual([]);
    expect(rows.map((r) => [r.labelMonth, r.startDate, r.endDate])).toEqual([
      [1, "2026-01-05", "2026-01-30"],
      [2, "2026-02-02", "2026-03-05"],
      [3, "2026-03-06", "2026-04-02"],
      [4, "2026-04-06", "2026-05-01"],
    ]);
  });

  it("전각 물결·전각 공백도 받는다", () => {
    const { rows, errors } = parsePeriodLines(2026, "3/6　～　4/2");
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ startDate: "2026-03-06", endDate: "2026-04-02" });
  });

  it("라벨월은 시작일의 월 — 끝이 다음 달로 넘어가도 그대로", () => {
    // 원장: "2월 세션은 3월 5일까지 간다"
    const { rows } = parsePeriodLines(2026, "2/2~3/5");
    expect(rows[0].labelMonth).toBe(2);
  });

  it("명시한 월 라벨이 시작일보다 우선한다", () => {
    const { rows } = parsePeriodLines(2026, "1월 12/28~1/24");
    expect(rows[0]).toMatchObject({ labelMonth: 1, startDate: "2026-12-28", endDate: "2027-01-24" });
  });

  it("연도를 넘기면 끝 연도가 +1", () => {
    const { rows } = parsePeriodLines(2026, "12/28~1/24");
    expect(rows[0]).toMatchObject({ labelMonth: 12, startDate: "2026-12-28", endDate: "2027-01-24" });
  });

  it("빈 줄은 건너뛴다(방학 달을 비우는 건 정상)", () => {
    const { rows, errors } = parsePeriodLines(2026, "1/5~1/30\n\n\n3/6~4/2\n");
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it("윤년 2/29를 받는다", () => {
    const { errors } = parsePeriodLines(2028, "2/1~2/29");
    expect(errors).toEqual([]);
  });
});

describe("parsePeriodLines — 오류는 줄 번호와 한글로", () => {
  it("구간 구분자가 없으면", () => {
    const { errors } = parsePeriodLines(2026, "3/6 4/2");
    expect(errors[0]).toMatchObject({ lineNo: 1, error: expect.stringContaining("'~'로 이어주세요") });
  });

  it("없는 날짜", () => {
    expect(parsePeriodLines(2026, "2/30~3/5").errors[0].error).toContain("없는 날입니다");
    expect(parsePeriodLines(2026, "2/1~2/29").errors[0].error).toContain("없는 날입니다"); // 2026은 평년
  });

  it("끝이 시작보다 빠르면", () => {
    expect(parsePeriodLines(2026, "2026-04-02~2026-03-06").errors[0].error).toContain("빠릅니다");
  });

  it("같은 달이 두 번 나오면(한 달에 세션은 하나)", () => {
    const { errors, rows } = parsePeriodLines(2026, "3/6~3/20\n3/21~4/2");
    expect(rows).toHaveLength(1);
    expect(errors[0]).toMatchObject({ lineNo: 2, error: expect.stringContaining("두 번 나옵니다") });
  });

  it("13월 라벨은 거부", () => {
    expect(parsePeriodLines(2026, "13월 3/6~4/2").errors[0].error).toContain("1~12월이 아닙니다");
  });

  it("오류 메시지에 raw 코드·영문이 새지 않는다", () => {
    for (const bad of ["3/6 4/2", "2/30~3/5", "2026-04-02~2026-03-06"]) {
      expect(parsePeriodLines(2026, bad).errors[0].error).not.toMatch(/[a-zA-Z]{3,}/);
    }
  });

  it("잘못된 줄이 있어도 나머지 줄은 살린다", () => {
    const { rows, errors } = parsePeriodLines(2026, "1/5~1/30\n엉망\n3/6~4/2");
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].lineNo).toBe(2);
  });
});

describe("formatPeriodLines — 왕복(붙여넣기 ↔ 저장본)", () => {
  it("저장본을 다시 텍스트로", () => {
    const text = formatPeriodLines([
      { labelMonth: 3, startDate: "2026-03-06", endDate: "2026-04-02" },
      { labelMonth: 1, startDate: "2026-01-05", endDate: "2026-01-30" },
    ]);
    expect(text).toBe("1월 1/5~1/30\n3월 3/6~4/2");
  });

  it("format → parse 왕복에서 값이 보존된다", () => {
    const original = [
      { labelMonth: 2, startDate: "2026-02-02", endDate: "2026-03-05" },
      { labelMonth: 12, startDate: "2026-12-28", endDate: "2027-01-24" },
    ];
    const { rows, errors } = parsePeriodLines(2026, formatPeriodLines(original));
    expect(errors).toEqual([]);
    expect(rows.map((r) => ({ labelMonth: r.labelMonth, startDate: r.startDate, endDate: r.endDate }))).toEqual(
      original,
    );
  });
});
