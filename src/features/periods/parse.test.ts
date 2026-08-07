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
    const { rows } = parsePeriodLines(2026, "7월 8/3~8/28");
    expect(rows[0]).toMatchObject({ labelMonth: 7, startDate: "2026-08-03", endDate: "2026-08-28" });
  });

  // 🔴 세션은 28~30일 단위로 흘러가므로 1월 세션이 **전해 12월에 시작**하는 건 정상이다.
  //    이걸 라벨 연도로 못박으면 그 행이 한 해 뒤(2026-12-28)로 밀려 조용히 잘못 저장된다.
  it("라벨월과 시작월이 반년 넘게 벌어지면 해를 되감는다", () => {
    const { rows } = parsePeriodLines(2026, "1월 12/28~1/24");
    expect(rows[0]).toMatchObject({ labelMonth: 1, startDate: "2025-12-28", endDate: "2026-01-24" });
  });

  it("반대 방향(라벨 12월인데 1월 시작)은 다음 해로", () => {
    const { rows } = parsePeriodLines(2026, "12월 1/5~1/30");
    expect(rows[0]).toMatchObject({ labelMonth: 12, startDate: "2027-01-05", endDate: "2027-01-30" });
  });

  // ⚠️ 회귀 방지: "라벨월 < 시작월"만으로 되감으면 방학으로 한 달 밀린 정상 입력까지 1년 어긋난다.
  it("인접한 달 이동은 되감지 않는다", () => {
    expect(parsePeriodLines(2026, "3월 4/6~5/1").rows[0]).toMatchObject({ startDate: "2026-04-06" });
    expect(parsePeriodLines(2026, "2월 3/2~3/27").rows[0]).toMatchObject({ startDate: "2026-03-02" });
    expect(parsePeriodLines(2026, "8월 3/2~3/27").rows[0]).toMatchObject({ startDate: "2026-03-02" });
  });

  it("연도를 명시하면 되감기 추론을 하지 않는다", () => {
    const { rows } = parsePeriodLines(2026, "1월 2026-12-28~2027-01-24");
    expect(rows[0]).toMatchObject({ startDate: "2026-12-28", endDate: "2027-01-24" });
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
    const { rows, errors } = parsePeriodLines(2026, formatPeriodLines(original, 2026));
    expect(errors).toEqual([]);
    expect(rows.map((r) => ({ labelMonth: r.labelMonth, startDate: r.startDate, endDate: r.endDate }))).toEqual(
      original,
    );
  });

  // 🔴 왕복 손실이 이 기능의 가장 조용한 사고다 — 다른 달 한 줄만 고쳐 저장해도
  //    1월 행이 한 해 밀려 재작성된다. labelYear를 주면 그 해가 아닌 날짜는 연도까지 찍어 막는다.
  it("전해에 시작하는 1월 세션도 왕복에서 보존된다", () => {
    const original = [{ labelMonth: 1, startDate: "2025-12-29", endDate: "2026-01-23" }];
    const text = formatPeriodLines(original, 2026);
    expect(text).toBe("1월 2025-12-29~1/23"); // 연도가 다른 쪽만 ISO
    const { rows, errors } = parsePeriodLines(2026, text);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject(original[0]);
  });

  it("labelYear를 안 주면 예전처럼 축약만 한다(호출부 호환)", () => {
    expect(formatPeriodLines([{ labelMonth: 1, startDate: "2025-12-29", endDate: "2026-01-23" }])).toBe(
      "1월 12/29~1/23",
    );
  });
});
