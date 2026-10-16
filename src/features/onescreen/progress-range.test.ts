import { describe, expect, it } from "vitest";
import { collapseProgressRanges, progressForMent, progressInline } from "./progress-range";
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

// 멘트(AI 사실 블록 + 폴백 템플릿)용 — 원장 2026-08-05 "진도를 전부 적으면 그것이야말로 스팸".
describe("progressInline", () => {
  it("축약 후 남은 줄을 ', '로 이어 한 문장 재료로 만든다", () => {
    // 라벨 없는 값(su.today) — 멘트 입력은 과목 라벨을 따로 붙인다.
    const today = 초5_9차시.replace(/^수학 /, "");
    expect(progressInline(today)).toBe("1-5-1~1-5-4 분수의 덧셈과 뺄셈, 1-6-1~1-6-5 다각형의 둘레와 넓이");
  });

  it("개행을 절대 남기지 않는다 — 한 문장이 여러 줄로 쪼개지던 회귀(2026-07-22)", () => {
    expect(progressInline(초5_9차시)).not.toContain("\n");
    expect(progressInline("평행이동\n원의 방정식")).toBe("평행이동, 원의 방정식");
  });

  it("축약 대상이 아니면 기존처럼 전부 나열한다(사실 보존)", () => {
    expect(progressInline("1-6-1 정다각형과 사각형의 둘레\n1-6-5 마름모와 사다리꼴의 넓이")).toBe(
      "1-6-1 정다각형과 사각형의 둘레, 1-6-5 마름모와 사다리꼴의 넓이",
    );
  });

  it("빈 값은 빈 문자열", () => {
    expect(progressInline(null)).toBe("");
    expect(progressInline("")).toBe("");
  });
});

// 2026-10-16 Haiku 5.5 전환 — 5.5는 단원 번호를 학부모 글에 그대로 옮긴다. AI 재료에서만 뗀다(4.5 때의 발송 모양 유지).
describe("progressForMent — AI 멘트 재료에서 단원 번호만 뗀다", () => {
  it("앞에 붙은 번호·범위 번호", () => {
    expect(progressForMent("2-4-3~2-4-5 비례식과 비례배분")).toBe("비례식과 비례배분");
    expect(progressForMent("2-4-6 마름모\n2-4-7 여러 가지 사각형")).toBe("마름모, 여러 가지 사각형");
  });
  it("괄호 속 번호", () => {
    expect(progressForMent("소수의 나눗셈(2-2-1~2-2-5)")).toBe("소수의 나눗셈");
  });
  it("학년·학기 표기(중2-1)·번호 없는 진도는 그대로", () => {
    expect(progressForMent("중2-1 일차함수의 그래프")).toBe("중2-1 일차함수의 그래프");
    expect(progressForMent("평행이동\n원의 방정식")).toBe("평행이동, 원의 방정식");
  });
  it("번호만 있으면 원문 그대로(진도를 통째로 잃지 않게) · 빈 값은 빈 문자열", () => {
    expect(progressForMent("2-4-3")).toBe("2-4-3");
    expect(progressForMent(null)).toBe("");
  });
});
