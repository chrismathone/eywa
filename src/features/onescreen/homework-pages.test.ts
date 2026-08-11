import { describe, it, expect } from "vitest";
import { normalizeHomeworkPages } from "./homework-pages";

describe("normalizeHomeworkPages — 쪽수 단위 후보정", () => {
  it("열린 범위에 쪽을 붙인다(원장 예시 ~131)", () => {
    expect(normalizeHomeworkPages("~131")).toBe("~131p");
    expect(normalizeHomeworkPages("~89")).toBe("~89p");
    expect(normalizeHomeworkPages("~131 풀어오기")).toBe("~131p 풀어오기");
  });

  it("닫힌 범위에 쪽을 붙인다(실데이터 꼴)", () => {
    expect(normalizeHomeworkPages("42-60")).toBe("42-60p");
    expect(normalizeHomeworkPages("117-131")).toBe("117-131p");
    expect(normalizeHomeworkPages("최상위: 94- 98")).toBe("최상위: 94- 98p");
    expect(normalizeHomeworkPages("50~52")).toBe("50~52p");
  });

  it("한 값에 범위가 여러 개면 전부(줄바꿈 포함)", () => {
    expect(normalizeHomeworkPages("100-114 & 120-129")).toBe("100-114p & 120-129p");
    expect(normalizeHomeworkPages("6/11(목) : 50~52\n6/12(금) : 62~65")).toBe(
      "6/11(목) : 50~52p\n6/12(금) : 62~65p",
    );
    expect(normalizeHomeworkPages("kma : 88-97\n개념의 숲:80-90")).toBe("kma : 88-97p\n개념의 숲:80-90p");
  });

  it("멱등 — 이미 붙은 값은 그대로(여러 번 돌려도 pp가 안 된다)", () => {
    const once = normalizeHomeworkPages("~131");
    expect(normalizeHomeworkPages(once)).toBe("~131p");
    expect(normalizeHomeworkPages("42-60p")).toBe("42-60p");
    expect(normalizeHomeworkPages("~138쪽")).toBe("~138쪽");
  });

  it("이미 쪽 표시가 있으면 손대지 않는다", () => {
    expect(normalizeHomeworkPages("유형의 나무 : p.19~22")).toBe("유형의 나무 : p.19~22");
    expect(normalizeHomeworkPages("p50~p53")).toBe("p50~p53");
    expect(normalizeHomeworkPages("6/22(월) : p.148~161")).toBe("6/22(월) : p.148~161");
    expect(normalizeHomeworkPages("P 12-20")).toBe("P 12-20");
  });

  it("🔴 교재명은 범위가 아니다 — 끝 ≤ 시작이면 통과(고쟁이 2-1)", () => {
    expect(normalizeHomeworkPages("고쟁이 2-1")).toBe("고쟁이 2-1");
    expect(normalizeHomeworkPages("고쟁이 2-1\r\nStep 1,2")).toBe("고쟁이 2-1\r\nStep 1,2");
    expect(normalizeHomeworkPages("유형의 나무 2-2 마무리")).toBe("유형의 나무 2-2 마무리");
  });

  it("🔴 물결에 공백이 끼면 단원 구간이지 쪽이 아니다", () => {
    expect(normalizeHomeworkPages("06 이차방정식 ~ 10 일차함수와 일차방정식")).toBe(
      "06 이차방정식 ~ 10 일차함수와 일차방정식",
    );
  });

  it("다른 단위가 붙은 숫자는 쪽이 아니다", () => {
    expect(normalizeHomeworkPages("프린트 10-15문제")).toBe("프린트 10-15문제");
    expect(normalizeHomeworkPages("3-4단원")).toBe("3-4단원");
    expect(normalizeHomeworkPages("백발백중:10장")).toBe("백발백중:10장");
    expect(normalizeHomeworkPages("31번~54번")).toBe("31번~54번");
  });

  it("숫자 코드(차시·날짜·오타)는 건드리지 않는다", () => {
    expect(normalizeHomeworkPages("1-5-4 10개씩 묶어 세기")).toBe("1-5-4 10개씩 묶어 세기");
    expect(normalizeHomeworkPages("6/11(목) 과제")).toBe("6/11(목) 과제");
    expect(normalizeHomeworkPages("179=195")).toBe("179=195");
    expect(normalizeHomeworkPages("2026-08-11 까지")).toBe("2026-08-11 까지");
  });

  // ── 아래는 실데이터 드라이런(lesson_reports 180일 8,329개 고유값)에서 **실제로 잘못 붙었던** 것들 ──
  it("🔴 한 자리 끝번호는 차시·단원 코드다(4-5 / 1-3)", () => {
    expect(normalizeHomeworkPages("4-5 이차함수 y=ax²+bx+c의 그래프(2)")).toBe(
      "4-5 이차함수 y=ax²+bx+c의 그래프(2)",
    );
    expect(normalizeHomeworkPages("가우스 1-3까지 풀어오기")).toBe("가우스 1-3까지 풀어오기");
  });

  it("🔴 문항 번호·회차는 뒤에 글자가 이어져도 단위다(~319번까지 / 1회~4회)", () => {
    expect(normalizeHomeworkPages("올킬 : ~319번까지")).toBe("올킬 : ~319번까지");
    expect(normalizeHomeworkPages("모의고사 1회~4회까지 마무리하기")).toBe("모의고사 1회~4회까지 마무리하기");
    expect(normalizeHomeworkPages("25-51 & 올킬 85-164번")).toBe("25-51p & 올킬 85-164번");
  });

  it("🔴 그 줄이 이미 p 표기를 쓰면 뒤엣것에 또 붙이지 않는다", () => {
    expect(normalizeHomeworkPages("가우스 p24~27, 34~36")).toBe("가우스 p24~27, 34~36");
    expect(normalizeHomeworkPages("p. 31-35. 36-40")).toBe("p. 31-35. 36-40");
    // 줄이 다르면 각 줄로 따로 판단한다
    expect(normalizeHomeworkPages("본책 : p.55~69\n워크북 : ~49")).toBe("본책 : p.55~69\n워크북 : ~49p");
  });

  it("🔴 괄호 안·앞자리 0·영문 꼬리는 쪽이 아니다", () => {
    expect(normalizeHomeworkPages("유형의 나무 : p.42~44(109~136)")).toBe("유형의 나무 : p.42~44(109~136)");
    expect(normalizeHomeworkPages("창의융합 ( 01~03 )")).toBe("창의융합 ( 01~03 )");
    expect(normalizeHomeworkPages("고쟁이 2-04 여러가지 부등식")).toBe("고쟁이 2-04 여러가지 부등식");
    expect(normalizeHomeworkPages("169-191 (180-184x)")).toBe("169-191p (180-184x)");
    expect(normalizeHomeworkPages("기탄 ~67b까지")).toBe("기탄 ~67b까지");
  });

  it("🔴 앞 낱말이 쪽이 아님을 말하면 붙이지 않는다(유형 1~17)", () => {
    expect(normalizeHomeworkPages("유형 12~17까지")).toBe("유형 12~17까지");
    expect(normalizeHomeworkPages("문제 12-20")).toBe("문제 12-20");
  });

  it("맨숫자 하나는 손대지 않는다(쪽인지 알 수 없다)", () => {
    expect(normalizeHomeworkPages("프린트")).toBe("프린트");
    expect(normalizeHomeworkPages("07 연립방정식의 활용")).toBe("07 연립방정식의 활용");
    expect(normalizeHomeworkPages("시그마 P101")).toBe("시그마 P101");
    expect(normalizeHomeworkPages("개념 확인 후에 문제 풀어오기.")).toBe("개념 확인 후에 문제 풀어오기.");
  });

  it("빈 값은 그대로", () => {
    expect(normalizeHomeworkPages("")).toBe("");
  });
});
