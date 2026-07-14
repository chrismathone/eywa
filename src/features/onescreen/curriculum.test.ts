import { describe, it, expect } from "vitest";
import {
  splitLessons,
  joinLessons,
  firstLesson,
  lastLesson,
  displayLessons,
  nextLessons,
  semesterOfLesson,
  PROGRESS_DELIM,
} from "./curriculum";
import { positionOf } from "@/features/progress/curriculum-position";

// 다중 차시 진도 — today는 여러 차시를 개행으로 이은 합본 문자열.
describe("다중 차시 split/join", () => {
  it("빈값/단일/다중을 안전히 분해", () => {
    expect(splitLessons("")).toEqual([]);
    expect(splitLessons(null)).toEqual([]);
    expect(splitLessons("A")).toEqual(["A"]);
    expect(splitLessons(`A${PROGRESS_DELIM}B`)).toEqual(["A", "B"]);
    expect(splitLessons(`A${PROGRESS_DELIM} ${PROGRESS_DELIM}B`)).toEqual(["A", "B"]); // 빈 줄 제거
  });

  it("join은 개행 조인 + 중복 제거 + 순서 보존", () => {
    expect(joinLessons(["A", "B"])).toBe(`A${PROGRESS_DELIM}B`);
    expect(joinLessons(["A", "A", "B"])).toBe(`A${PROGRESS_DELIM}B`);
    expect(joinLessons(["", " ", "A"])).toBe("A");
  });

  it("first/last/display", () => {
    const t = `A${PROGRESS_DELIM}B${PROGRESS_DELIM}C`;
    expect(firstLesson(t)).toBe("A");
    expect(lastLesson(t)).toBe("C");
    expect(displayLessons(t)).toBe("A, B, C");
    expect(firstLesson("")).toBe("");
    expect(lastLesson(null)).toBe("");
  });

  it("round-trip: split ∘ join = identity(정규화)", () => {
    const lessons = ["2-3-3 소수 사이의 관계", "2-3-4 소수 한 자리 수의 덧셈"];
    expect(splitLessons(joinLessons(lessons))).toEqual(lessons);
  });
});

describe("추천 진도(nextLessons)", () => {
  it("이전 차시 다음 n개를 학년 내에서 반환(edutrix 추천 진도)", () => {
    // 초4 2-3 소수: …사이의 관계 / 한 자리 덧셈 / 한 자리 뺄셈 / 두 자리 덧셈 …
    expect(nextLessons("초4", "2-3-4 소수 한 자리 수의 덧셈", 3)).toEqual([
      "2-3-5 소수 한 자리 수의 뺄셈",
      "2-3-6 소수 두 자리 수의 덧셈",
      "2-3-7 소수 두 자리 수의 뺄셈",
    ]);
  });

  it("못 찾으면 학년 처음부터", () => {
    const first3 = nextLessons("초4", "존재하지 않는 차시", 3);
    expect(first3.length).toBe(3);
    expect(first3[0]).toContain("1-1-1");
  });

  it("빈 학년은 빈 배열", () => {
    expect(nextLessons("고3", "", 3)).toEqual([]);
  });
});

// 학기 도출은 '첫 차시' 기준이어야 함(호출부가 firstLesson으로 감싸는 계약).
describe("학기 도출은 단일 차시 기준", () => {
  it("2학기 차시는 2를 반환", () => {
    expect(semesterOfLesson("초4", "2-3-4 소수 한 자리 수의 덧셈")).toBe(2);
  });
  it("합본을 그대로 넘기면 매치 실패로 1 폴백 → 반드시 firstLesson으로 감싸야 함", () => {
    const joined = joinLessons(["2-3-3 소수 사이의 관계", "2-3-4 소수 한 자리 수의 덧셈"]);
    expect(semesterOfLesson("초4", joined)).toBe(1); // 합본 그대로는 오폴백(=버그) — 호출부 방어 필요 근거
    expect(semesterOfLesson("초4", firstLesson(joined))).toBe(2); // 감싸면 정확
  });
});

// positionOf 회귀 — 진도 추적(ingest)이 다중차시에도 마지막 차시를 잡고, "/" 포함 단일 차시는 그대로 매치.
describe("positionOf 다중차시 회귀", () => {
  it("개행 합본 progress는 마지막 차시(그날 최종 진도)로 매핑", () => {
    const joined = joinLessons(["2-3-3 소수 사이의 관계", "2-3-4 소수 한 자리 수의 덧셈"]);
    const progress = `수학 ${joined}`;
    const pos = positionOf(progress);
    expect(pos?.lesson).toBe("2-3-4 소수 한 자리 수의 덧셈");
  });

  it("'/' 포함 단일 차시는 여전히 정확 매치(구분자로 '/'를 쓰지 않으므로 안전)", () => {
    // 초5 1-1-1: "덧셈과 뺄셈 / 곱셈과 나눗셈이 섞여 있는 식" — '/'가 들어 있음
    const progress = "수학 1-1-1 덧셈과 뺄셈 / 곱셈과 나눗셈이 섞여 있는 식";
    const pos = positionOf(progress);
    expect(pos?.lesson).toBe("1-1-1 덧셈과 뺄셈 / 곱셈과 나눗셈이 섞여 있는 식");
  });

  it("단일 차시 progress도 그대로 매핑(회귀 없음)", () => {
    const pos = positionOf("수학 2-3-3 소수 사이의 관계");
    expect(pos?.lesson).toBe("2-3-3 소수 사이의 관계");
  });
});
