import { describe, it, expect } from "vitest";
import {
  HOMEWORK_RATES,
  homeworkRateClause,
  isHomeworkRate,
  parseHomeworkRate,
  toHomeworkRateChoice,
} from "./homework-rate";
import { HOMEWORK } from "./data";

describe("HOMEWORK_RATES(선택지)", () => {
  it("10% 눈금 11개 · 높은 값 먼저", () => {
    expect(HOMEWORK_RATES).toEqual(["100%", "90%", "80%", "70%", "60%", "50%", "40%", "30%", "20%", "10%", "0%"]);
  });

  it("원스크린 과제 선택지 = 수행률 + '없음' — 옛 3단계는 선택지에서 사라졌다", () => {
    expect([...HOMEWORK]).toEqual([...HOMEWORK_RATES, "없음"]);
    expect(HOMEWORK).not.toContain("완료");
    expect(HOMEWORK).not.toContain("일부 미흡");
    expect(HOMEWORK).not.toContain("미제출");
  });

  it("isHomeworkRate", () => {
    expect(isHomeworkRate("90%")).toBe(true);
    expect(isHomeworkRate("95%")).toBe(false);
    expect(isHomeworkRate("완료")).toBe(false);
    expect(isHomeworkRate(null)).toBe(false);
  });
});

describe("parseHomeworkRate", () => {
  it("퍼센트 문자열 → 숫자(% 있어도 없어도)", () => {
    expect(parseHomeworkRate("100%")).toBe(100);
    expect(parseHomeworkRate("90%")).toBe(90);
    expect(parseHomeworkRate("0%")).toBe(0);
    expect(parseHomeworkRate(" 70 % ")).toBe(70);
    expect(parseHomeworkRate("80")).toBe(80);
    expect(parseHomeworkRate("100%%")).toBe(100); // 임포트 오타(실데이터 6건)
  });

  it("범위 밖은 클램프", () => {
    expect(parseHomeworkRate("120%")).toBe(100);
    expect(parseHomeworkRate("999")).toBe(100);
  });

  it("뜻이 분명한 옛 표기만 숫자로 — 완료=100 · 미제출=0", () => {
    expect(parseHomeworkRate("완료")).toBe(100);
    expect(parseHomeworkRate("미제출")).toBe(0);
  });

  // 🔴 이 파일이 존재하는 이유(2026-08-03): '일부 미흡'을 50으로 세던 매핑이 90% 해온 학생을
  //    학부모 그래프에 50으로 찍었다. **정도를 모르는 값은 숫자가 되지 않는다.** 되돌리지 말 것.
  it("정도 미상('일부 미흡'·'상/중/하'·'미확인')은 null", () => {
    expect(parseHomeworkRate("일부 미흡")).toBeNull();
    expect(parseHomeworkRate("미흡")).toBeNull();
    expect(parseHomeworkRate("상")).toBeNull();
    expect(parseHomeworkRate("미확인")).toBeNull();
  });

  it("'없음'·미기재는 null — 0%(미제출)와 구분한다", () => {
    expect(parseHomeworkRate("없음")).toBeNull();
    expect(parseHomeworkRate("-")).toBeNull();
    expect(parseHomeworkRate("—")).toBeNull();
    expect(parseHomeworkRate("")).toBeNull();
    expect(parseHomeworkRate(null)).toBeNull();
    expect(parseHomeworkRate("0%")).toBe(0); // 대비
  });

  it("숫자가 섞인 잡음(임포트가 선택지 목록을 통째로 저장한 행)은 null", () => {
    expect(parseHomeworkRate("100%\n90%\n50%\n0%")).toBeNull();
    expect(parseHomeworkRate("20문제 중 18개")).toBeNull();
  });
});

describe("toHomeworkRateChoice(이전 회차 가져오기)", () => {
  it("옛 정성값 → 현재 선택지", () => {
    expect(toHomeworkRateChoice("완료")).toBe("100%");
    expect(toHomeworkRateChoice("미제출")).toBe("0%");
    expect(toHomeworkRateChoice("없음")).toBe("없음");
  });

  it("눈금 밖 퍼센트는 10% 눈금으로 반올림", () => {
    expect(toHomeworkRateChoice("85%")).toBe("90%");
    expect(toHomeworkRateChoice("34%")).toBe("30%");
    expect(toHomeworkRateChoice("90%")).toBe("90%");
  });

  it("정도 미상은 null — 임의로 50%를 찍지 않는다", () => {
    expect(toHomeworkRateChoice("일부 미흡")).toBeNull();
    expect(toHomeworkRateChoice("확인 필요")).toBeNull();
    expect(toHomeworkRateChoice(null)).toBeNull();
  });
});

describe("homeworkRateClause(폴백 템플릿 문장)", () => {
  it("퍼센트는 '해왔습니다'로 이어 무엇의 %인지 분명히", () => {
    expect(homeworkRateClause("90%")).toBe("90% 해왔습니다");
    expect(homeworkRateClause("100%")).toBe("100% 해왔습니다");
  });

  it("0%는 '하지 못했습니다'", () => {
    expect(homeworkRateClause("0%")).toBe("하지 못했습니다");
  });

  it("옛 정성값은 기존대로", () => {
    expect(homeworkRateClause("완료")).toBe("완료입니다");
  });
});
