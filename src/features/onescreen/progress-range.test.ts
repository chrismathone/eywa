import { describe, expect, it } from "vitest";
import { collapseProgressRanges } from "./progress-range";
import { MONTHLY_EXAM_LABEL } from "./progress-status";

/** 실제 저장 포맷 — 첫 줄만 과목 라벨 접두(buildReportFields). */
const 초5_9차시 = [
  "수학 1-5-1 진분수의 덧셈",
  "1-5-2 대분수의 덧셈",
  "1-5-3 진분수의 뺄셈",
  "1-5-4 대분수의 뺄셈",
  "1-6-1 정다각형과 사각형의 둘레",
  "1-6-2 1cm², 직사각형과 정사각형의 넓이",
  "1-6-3 1cm²보다 더 큰 넓이의 단위",
  "1-6-4 평행사변형과 삼각형의 넓이",
  "1-6-5 마름모와 사다리꼴의 넓이",
].join("\n");

describe("collapseProgressRanges", () => {
  it("같은 중단원 연속 차시를 물결 한 줄로 접는다(원장 제보 실사례: 9줄 → 2줄)", () => {
    expect(collapseProgressRanges(초5_9차시)).toBe(
      "수학 1-5-1~1-5-4 분수의 덧셈과 뺄셈\n1-6-1~1-6-5 다각형의 둘레와 넓이",
    );
  });

  it("중단원이 바뀌면 같은 줄로 합치지 않는다(1-5-4 → 1-6-1)", () => {
    const out = collapseProgressRanges(초5_9차시).split("\n");
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("1-5-4");
    expect(out[1]).toContain("1-6-1");
  });

  it("🔴 가운데가 비면 그 구간은 접지 않는다 — 안 나간 차시를 범위에 넣으면 거짓말", () => {
    const raw = ["수학 1-6-1 정다각형과 사각형의 둘레", "1-6-2 1cm², 직사각형과 정사각형의 넓이", "1-6-5 마름모와 사다리꼴의 넓이"].join("\n");
    expect(collapseProgressRanges(raw)).toBe(raw); // 연속 2개(<3) + 단독 1개 → 접힘 없음
  });

  it("건너뛴 뒤 남은 차시는 제 줄로 살아남는다", () => {
    const raw = [
      "수학 1-6-1 정다각형과 사각형의 둘레",
      "1-6-2 1cm², 직사각형과 정사각형의 넓이",
      "1-6-3 1cm²보다 더 큰 넓이의 단위",
      "1-6-5 마름모와 사다리꼴의 넓이",
    ].join("\n");
    expect(collapseProgressRanges(raw)).toBe("수학 1-6-1~1-6-3 다각형의 둘레와 넓이\n1-6-5 마름모와 사다리꼴의 넓이");
  });

  it("2차시(<3)는 접지 않는다 — 차시명이 더 유용하다", () => {
    const raw = "수학 1-5-1 진분수의 덧셈\n1-5-2 대분수의 덧셈";
    expect(collapseProgressRanges(raw)).toBe(raw);
  });

  it("중등(코드 없는 차시)은 차시명 양끝을 물결로 잇는다", () => {
    const raw = ["수학 소수와 거듭제곱", "소인수분해", "공약수와 최대공약수"].join("\n");
    expect(collapseProgressRanges(raw)).toBe("수학 소수와 거듭제곱 ~ 공약수와 최대공약수");
  });

  it("과목 라벨이 없어도(차시만 저장된 값) 동작한다", () => {
    const raw = ["1-5-1 진분수의 덧셈", "1-5-2 대분수의 덧셈", "1-5-3 진분수의 뺄셈"].join("\n");
    expect(collapseProgressRanges(raw)).toBe("1-5-1~1-5-3 분수의 덧셈과 뺄셈");
  });

  it("반 이름이 섞인 긴 라벨도 벗겨서 접는다", () => {
    const raw = ["수학 심화 1-5-1 진분수의 덧셈", "1-5-2 대분수의 덧셈", "1-5-3 진분수의 뺄셈"].join("\n");
    expect(collapseProgressRanges(raw)).toBe("수학 심화 1-5-1~1-5-3 분수의 덧셈과 뺄셈");
  });

  it("레거시 임포트('N.차시명' 순번 접두)도 접고, 범위 표기에선 순번을 뺀다", () => {
    // 실데이터(edutrix 이관분) 포맷 — 이 접두 때문에 못 접히던 보고서가 실측 306건이었다.
    const raw = ["1.이등변삼각형의 성질", "2.직각삼각형의 합동", "3.삼각형의 외심", "4.삼각형의 내심"].join("\n");
    expect(collapseProgressRanges(raw)).toBe("이등변삼각형의 성질 ~ 삼각형의 내심");
  });

  it("레거시 접두가 있어도 안 접히는 줄은 원문(순번 포함) 그대로 남는다", () => {
    // 중2 5.도형의 성질: 이등변삼각형의 성질(0)·직각삼각형의 합동(1)·삼각형의 외심(2) = 연속 3 → 접힘.
    // 뒤의 '평행선과 삼각형의 넓이'(8)는 떨어져 있어 제 줄로 남는다.
    const raw = ["1.이등변삼각형의 성질", "2.직각삼각형의 합동", "3.삼각형의 외심", "4.평행선과 삼각형의 넓이"].join("\n");
    expect(collapseProgressRanges(raw)).toBe("이등변삼각형의 성질 ~ 삼각형의 외심\n4.평행선과 삼각형의 넓이");
  });

  it("레거시 '(단원) 총괄' 줄이 끼면 접지 않는다 — 특정 차시가 아니다", () => {
    const raw = ["1.삼각형의 성질(단원) 총괄", "2.이등변삼각형의 성질", "3.직각삼각형의 합동"].join("\n");
    expect(collapseProgressRanges(raw)).toBe(raw);
  });

  it("커리큘럼 밖 줄이 하나라도 있으면 원문 그대로(반쯤 접지 않는다)", () => {
    const raw = ["수학 1-5-1 진분수의 덧셈", "1-5-2 대분수의 덧셈", "교재 62p 오답 정리"].join("\n");
    expect(collapseProgressRanges(raw)).toBe(raw);
  });

  it("특수상태(월말평가)·자유입력 진도는 손대지 않는다", () => {
    expect(collapseProgressRanges(`수학 ${MONTHLY_EXAM_LABEL}`)).toBe(`수학 ${MONTHLY_EXAM_LABEL}`);
    expect(collapseProgressRanges("영어 Unit 8 · p.90")).toBe("영어 Unit 8 · p.90");
  });

  it("빈 값·null은 빈 문자열", () => {
    expect(collapseProgressRanges(null)).toBe("");
    expect(collapseProgressRanges(undefined)).toBe("");
    expect(collapseProgressRanges("")).toBe("");
  });

  it("차시명이 두 과목에 겹치면(고등) 접지 않는다 — 엉뚱한 과목 기준 '연속' 판정 금지", () => {
    // "접선의 방정식"·"함수의 극대와 극소"·"속도와 가속도"는 미적분Ⅰ·Ⅱ 양쪽에 있다(모호).
    const raw = ["수학 접선의 방정식", "함수의 극대와 극소", "속도와 가속도"].join("\n");
    expect(collapseProgressRanges(raw)).toBe(raw);
  });

  it("접을 게 없으면 입력 문자열을 그대로 돌려준다(개행·공백 보존)", () => {
    const raw = "수학 1-5-1 진분수의 덧셈";
    expect(collapseProgressRanges(raw)).toBe(raw);
  });
});
