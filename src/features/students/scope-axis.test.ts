import { describe, it, expect } from "vitest";
import {
  subjectAxisOf,
  axisHasSubject,
  narrowSubjects,
  narrowTeacherNames,
  narrowSubjectCounts,
  narrowSubjectFilters,
  showSubjectFilter,
  coerceSubjectFilter,
} from "./scope-axis";

const FILTERS = [
  { value: "all", label: "전체" },
  { value: "math", label: "수학" },
  { value: "english", label: "영어" },
  { value: "korean", label: "국어" },
];

describe("subjectAxisOf — 좁힐지 말지", () => {
  it("스코프 null(관리자·풀셸)이면 축 없음", () => {
    expect(subjectAxisOf(null)).toBeNull();
    expect(subjectAxisOf(undefined)).toBeNull();
  });

  it("담당 반 0개(subjects 빈 배열)면 좁히지 않는다 — fail-open", () => {
    expect(subjectAxisOf({ subjects: [] })).toBeNull();
  });

  it("담당 과목이 있으면 그 집합", () => {
    const axis = subjectAxisOf({ subjects: ["math"] });
    expect(axis).not.toBeNull();
    expect([...axis!]).toEqual(["math"]);
  });

  it("겸직(수학+영어)이면 두 과목 다 남는다", () => {
    const axis = subjectAxisOf({ subjects: ["math", "english"] });
    expect(axisHasSubject(axis, "math")).toBe(true);
    expect(axisHasSubject(axis, "english")).toBe(true);
    expect(axisHasSubject(axis, "korean")).toBe(false);
  });
});

describe("🔴 스코프 null이면 종전과 완전히 동일", () => {
  const axis = subjectAxisOf(null);
  it("과목 배지 원본 그대로", () => {
    expect(narrowSubjects(axis, ["english", "math"])).toEqual(["english", "math"]);
  });
  it("담당 강사 원본 그대로(중복만 제거·정렬)", () => {
    expect(
      narrowTeacherNames(axis, [
        { subject: "math", name: "이수진" },
        { subject: "english", name: "김주현" },
        { subject: "english", name: "김주현" },
      ]),
    ).toEqual(["김주현", "이수진"]);
  });
  it("과목 게이지 원본 그대로", () => {
    expect(narrowSubjectCounts(axis, { math: 39, english: 14 })).toEqual({ math: 39, english: 14 });
  });
  it("과목 필터 선택지 원본 그대로 + 항상 노출", () => {
    expect(narrowSubjectFilters(axis, FILTERS)).toEqual(FILTERS);
    expect(showSubjectFilter(axis)).toBe(true);
  });
  it("과목 필터 값도 안 건드린다", () => {
    expect(coerceSubjectFilter(axis, "english")).toBe("english");
  });
  it("학원 과목이 1개뿐이어도 관리자 화면은 안 바뀐다(필터 유지)", () => {
    expect(showSubjectFilter(axis)).toBe(true);
  });
});

describe("🔴 subjects가 비면(담당 반 0개) 좁히지 않는다", () => {
  const axis = subjectAxisOf({ subjects: [] });
  it("과목이 통째로 사라지지 않는다", () => {
    expect(narrowSubjects(axis, ["english", "math"])).toEqual(["english", "math"]);
    expect(narrowSubjectCounts(axis, { math: 39, english: 14 })).toEqual({ math: 39, english: 14 });
    expect(narrowSubjectFilters(axis, FILTERS)).toEqual(FILTERS);
  });
  it("담당 강사도 그대로", () => {
    expect(
      narrowTeacherNames(axis, [
        { subject: "english", name: "김주현" },
        { subject: "math", name: "이수진" },
      ]),
    ).toEqual(["김주현", "이수진"]);
  });
});

describe("수학 전담 강사의 축", () => {
  const axis = subjectAxisOf({ subjects: ["math"] });

  it("① 게이지 — 영어 14명이 사라지고 수학만 남는다", () => {
    expect(narrowSubjectCounts(axis, { math: 39, english: 14 })).toEqual({ math: 39 });
  });

  it("② 수강 과목 배지 — 동시수강 영어가 사라진다", () => {
    expect(narrowSubjects(axis, ["english", "math"])).toEqual(["math"]);
  });

  it("③ 담당 강사 — 과목이 다른 강사만 사라진다", () => {
    expect(
      narrowTeacherNames(axis, [
        { subject: "math", name: "이수진" },
        { subject: "english", name: "김주현" },
        { subject: "english", name: "이성우" },
      ]),
    ).toEqual(["이수진"]);
  });

  it("③ 🔴 같은 과목의 다른 강사는 남긴다(수학 반 둘)", () => {
    expect(
      narrowTeacherNames(axis, [
        { subject: "math", name: "이수진" },
        { subject: "math", name: "이성우" },
        { subject: "english", name: "전양원" },
      ]),
    ).toEqual(["이성우", "이수진"]);
  });

  it("④ 과목 필터 — 스코프 과목만 남고, 1개뿐이라 필터를 감춘다", () => {
    const narrowed = narrowSubjectFilters(axis, FILTERS);
    expect(narrowed.map((f) => f.value)).toEqual(["all", "math"]);
    expect(showSubjectFilter(axis)).toBe(false);
  });

  it("④ 🔴 필터를 감춘 화면이라 축 안 과목(math)도 '전체'로 되돌린다", () => {
    // 감춘 컨트롤에 값이 살아 있으면 되돌릴 길이 없는데, 과목 필터는 on_hold=false까지 봐서
    // **휴원 학생이 조용히 빠진다**.
    expect(coerceSubjectFilter(axis, "english")).toBe("all");
    expect(coerceSubjectFilter(axis, "math")).toBe("all");
    expect(coerceSubjectFilter(axis, "all")).toBe("all");
    expect(coerceSubjectFilter(axis, undefined)).toBe("all");
  });
});

describe("겸직(수학+영어) 강사", () => {
  const axis = subjectAxisOf({ subjects: ["math", "english"] });

  it("두 과목 다 남는다 — 스코프 과목이 곧 답", () => {
    expect(narrowSubjects(axis, ["english", "korean", "math"])).toEqual(["english", "math"]);
    expect(narrowSubjectCounts(axis, { math: 39, english: 14, korean: 3 })).toEqual({
      math: 39,
      english: 14,
    });
  });

  it("과목 필터는 2개 이상이라 그대로 노출", () => {
    const narrowed = narrowSubjectFilters(axis, FILTERS);
    expect(narrowed.map((f) => f.value)).toEqual(["all", "math", "english"]);
    expect(showSubjectFilter(axis)).toBe(true);
  });

  it("필터가 보이므로 축 안 과목은 값을 유지하고, 축 밖만 되돌린다", () => {
    expect(coerceSubjectFilter(axis, "math")).toBe("math");
    expect(coerceSubjectFilter(axis, "english")).toBe("english");
    expect(coerceSubjectFilter(axis, "korean")).toBe("all");
  });
});

describe("과목 미상은 통과(fail-open) — 정보를 지우지 않는다", () => {
  const axis = subjectAxisOf({ subjects: ["math"] });
  it("subject가 null인 반의 담당 강사는 남는다", () => {
    expect(axisHasSubject(axis, null)).toBe(true);
    expect(axisHasSubject(axis, "")).toBe(true);
    expect(
      narrowTeacherNames(axis, [
        { subject: null, name: "미분류담당" },
        { subject: "english", name: "김주현" },
      ]),
    ).toEqual(["미분류담당"]);
  });
  it("빈 이름은 담당 강사로 세지 않는다", () => {
    expect(narrowTeacherNames(axis, [{ subject: "math", name: "" }])).toEqual([]);
  });
});
