import { describe, it, expect } from "vitest";
import {
  formatHomeworkRate,
  homeworkFactValue,
  homeworkRateClause,
  parseHomeworkRate,
  toHomeworkRateChoice,
} from "./homework-rate";

describe("formatHomeworkRate", () => {
  it("숫자 → 저장·표시 문자열(범위 밖은 클램프)", () => {
    expect(formatHomeworkRate(90)).toBe("90%");
    expect(formatHomeworkRate(0)).toBe("0%");
    expect(formatHomeworkRate(130)).toBe("100%");
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
  it("옛 정성값 → 현재 표기", () => {
    expect(toHomeworkRateChoice("완료")).toBe("100%");
    expect(toHomeworkRateChoice("없음")).toBe("없음");
  });

  // 미제출을 0%로 바꾸면 "안 내왔다"와 "못 했다"가 뭉개진다(문장이 달라야 한다 — 원장 2026-08-03).
  it("미제출은 미제출 그대로", () => {
    expect(toHomeworkRateChoice("미제출")).toBe("미제출");
    expect(parseHomeworkRate("미제출")).toBe(0); // 그래프에선 0
  });

  it("퍼센트는 그대로 옮긴다(눈금 없음 — 강사가 친 숫자가 값이다)", () => {
    expect(toHomeworkRateChoice("85%")).toBe("85%");
    expect(toHomeworkRateChoice("34%")).toBe("34%");
    expect(toHomeworkRateChoice("90")).toBe("90%");
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
    expect(homeworkRateClause("45%")).toBe("45% 해왔습니다");
  });

  it("양 끝은 한국어답게 — 100%='다 해왔습니다' · 0%='하지 못했습니다'", () => {
    expect(homeworkRateClause("100%")).toBe("다 해왔습니다");
    expect(homeworkRateClause("0%")).toBe("하지 못했습니다");
  });

  it("미제출은 0%와 다른 문장", () => {
    expect(homeworkRateClause("미제출")).toBe("제출하지 않았습니다");
    expect(homeworkRateClause("0%")).toBe("하지 못했습니다");
  });

  it("옛 정성값은 기존대로", () => {
    expect(homeworkRateClause("완료")).toBe("완료입니다");
  });
});

// 🔴 2026-08-28: 프롬프트에 "0%와 미제출을 바꿔 쓰지 마세요"가 있는데도 모델이 `0%`를
//    "제출하지 않았습니다"로 바꿔 썼다(Haiku 실측). 규칙은 편집 가능한 프롬프트 본문에 있고
//    데이터는 코드에 있다 — 데이터 쪽에서 가른다.
describe("homeworkFactValue — AI 입력에서 0%와 미제출을 말로 가른다", () => {
  it("🔴 0%는 '하나도 해오지 못함' (미제출로 오독되지 않게)", () => {
    expect(homeworkFactValue("0%")).toBe("하나도 해오지 못함");
    expect(homeworkFactValue("0")).toBe("하나도 해오지 못함");
    expect(homeworkFactValue(" 0 % ")).toBe("하나도 해오지 못함");
  });

  it("🔴 미제출은 '제출하지 않음' — 0%와 다른 사실이다", () => {
    expect(homeworkFactValue("미제출")).toBe("제출하지 않음");
  });

  it("0이 아닌 퍼센트는 숫자 그대로 (프롬프트가 '적힌 그대로 쓰라'고 못박은 값)", () => {
    expect(homeworkFactValue("90%")).toBe("90%");
    expect(homeworkFactValue("70%")).toBe("70%");
  });

  it("🔴 100%('완료' 포함)는 말로 — 원장 2026-10-16 \"100% -> 빠짐없이 잘\" · Haiku 5.5가 \"100%를 해 왔습니다\"로 옮겼다", () => {
    expect(homeworkFactValue("100%")).toBe("빠짐없이 잘 해 옴");
    expect(homeworkFactValue("완료")).toBe("빠짐없이 잘 해 옴");
  });

  it("'없음'(과제가 없던 날)은 건드리지 않는다 — 프롬프트가 따로 다룬다", () => {
    expect(homeworkFactValue("없음")).toBe("없음");
    expect(homeworkFactValue("-")).toBe("-");
  });

  it("옛 정성값은 그대로 통과(일부 미흡) — '완료'는 100%라 말로 바뀐다(2026-10-16)", () => {
    expect(homeworkFactValue("완료")).toBe("빠짐없이 잘 해 옴");
    expect(homeworkFactValue("일부 미흡")).toBe("일부 미흡");
  });

  it("괄호 설명을 달지 않는다 — 모델이 괄호째 베껴 학부모 문장에 넣는다", () => {
    for (const v of ["0%", "미제출", "90%", "없음"]) expect(homeworkFactValue(v)).not.toMatch(/[()]/);
  });

  it("폴백 템플릿(homeworkRateClause)과 **같은 뜻**을 말한다 — 두 경로가 갈리면 안 된다", () => {
    expect(homeworkRateClause("0%")).toBe("하지 못했습니다"); // 못 했다
    expect(homeworkFactValue("0%")).toBe("하나도 해오지 못함");
    expect(homeworkRateClause("미제출")).toBe("제출하지 않았습니다"); // 안 냈다
    expect(homeworkFactValue("미제출")).toBe("제출하지 않음");
  });
});
