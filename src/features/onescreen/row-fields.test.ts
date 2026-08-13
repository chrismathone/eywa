/**
 * 행 단위 평가값 해석 잠금 테스트.
 * 배경(원장 제보 2026-08-13): 보강은 정규와 **따로 발송되는 다른 보고서**인데 태도·점수가 겹쳤다.
 * 실측 근거 = 정규+보강 9쌍 중 8쌍에서 태도가 완전히 동일. `lesson_reports`는 보고서마다 따로 담고 있었으므로
 * 겹친 곳은 화면과 초안 저장뿐이었다.
 */
import { describe, expect, it } from "vitest";
import { hasRowOverrides, resolveRowFields, seedRowFields } from "./row-fields";
import type { OneScreenStudent, Subject } from "./types";

const su = (over: Partial<Subject> = {}): Subject => ({
  name: "수학",
  subjectLabel: "수학",
  prev: "",
  today: "",
  ...over,
});

const student = (over: Partial<OneScreenStudent> = {}): OneScreenStudent => ({
  id: "s1",
  name: "학생",
  grade: "중2",
  tag: "중2A",
  attendance: "출석",
  subjects: [],
  tests: {
    daily: { score: 8, max: 10, prevScore: 5 },
    check: { score: null, max: 10, prevScore: null },
  },
  attitude: "매우 좋음",
  homework: "100%",
  note: "정규 메모",
  progressConfirmed: false,
  reportDraft: "",
  reportSent: false,
  ...over,
});

describe("행 값이 없으면 학생 값 — 옛 세션 하위호환", () => {
  it("전부 미지정이면 학생 값 그대로(지금까지의 동작)", () => {
    const r = resolveRowFields(student(), su());
    expect(r.attitude).toBe("매우 좋음");
    expect(r.homework).toBe("100%");
    expect(r.note).toBe("정규 메모");
    expect(r.tests.daily.score).toBe(8);
    expect(r.tests.daily.max).toBe(10);
  });
  it("행(subject)이 아예 없어도 학생 값을 돌려준다", () => {
    expect(resolveRowFields(student(), undefined).attitude).toBe("매우 좋음");
  });
  it("prevScore는 행 override 대상이 아니다(로스터가 채우는 기록)", () => {
    const r = resolveRowFields(student(), su({ dailyScore: 3 }));
    expect(r.tests.daily.prevScore).toBe(5);
  });
});

describe("🔴 보강 행은 정규와 독립이다 — 이 프로젝트에서 고친 버그", () => {
  it("보강 행에 태도를 넣어도 정규 행은 학생 값을 유지한다", () => {
    const s = student();
    const regular = su({ name: "수학" });
    const makeup = su({ name: "수학 (보강)", makeup: true, classId: null, attitude: "보통" });
    expect(resolveRowFields(s, makeup).attitude).toBe("보통");
    expect(resolveRowFields(s, regular).attitude).toBe("매우 좋음"); // 옮겨붙지 않는다
  });
  it("점수·과제 수행률도 행마다 갈린다", () => {
    const s = student();
    const makeup = su({ dailyScore: 3, dailyMax: 5, homework: "미제출" });
    const r = resolveRowFields(s, makeup);
    expect(r.tests.daily).toMatchObject({ score: 3, max: 5 });
    expect(r.homework).toBe("미제출");
    expect(resolveRowFields(s, su()).tests.daily).toMatchObject({ score: 8, max: 10 });
  });
  it("특이사항(AI 멘트 입력)도 행마다 갈린다 — 보강은 다른 수업이라 메모가 다르다", () => {
    expect(resolveRowFields(student(), su({ note: "보강 중 개념 재확인" })).note).toBe("보강 중 개념 재확인");
  });
});

describe("빈 값은 '비운 것'이지 '미지정'이 아니다", () => {
  it("null 태도는 학생 값으로 되돌아가지 않는다(해제가 유지된다)", () => {
    expect(resolveRowFields(student(), su({ attitude: null })).attitude).toBeNull();
  });
  it("빈 문자열 과제도 그대로 — 폴백 금지", () => {
    expect(resolveRowFields(student(), su({ homework: "" })).homework).toBe("");
  });
  it("점수 null(지움)도 그대로", () => {
    expect(resolveRowFields(student(), su({ dailyScore: null })).tests.daily.score).toBeNull();
  });
});

describe("hasRowOverrides — 세션에 행 값을 실을지 판단", () => {
  it("미지정 행은 false(옛 세션 모양 유지)", () => {
    expect(hasRowOverrides(su())).toBe(false);
  });
  it("하나라도 지정되면 true — null·빈 문자열도 지정이다", () => {
    expect(hasRowOverrides(su({ attitude: null }))).toBe(true);
    expect(hasRowOverrides(su({ homework: "" }))).toBe(true);
    expect(hasRowOverrides(su({ checkMax: 20 }))).toBe(true);
  });
});

describe("seedRowFields — 편집 시작 시 그 행에 현재 보이던 값을 굳힌다", () => {
  it("미지정 행에 학생 값이 그대로 심긴다", () => {
    const seeded = seedRowFields(student(), su());
    expect(seeded).toMatchObject({ attitude: "매우 좋음", homework: "100%", dailyScore: 8, dailyMax: 10 });
    expect(hasRowOverrides(seeded)).toBe(true);
  });
  it("이미 행 값이 있으면 그 값을 보존한다(학생 값으로 덮지 않는다)", () => {
    expect(seedRowFields(student(), su({ attitude: "보통" })).attitude).toBe("보통");
  });
  it("씨앗을 심어도 해석 결과는 그대로 — 화면에 보이던 값이 안 바뀐다", () => {
    const s = student();
    const before = resolveRowFields(s, su());
    const after = resolveRowFields(s, seedRowFields(s, su()));
    expect(after).toEqual(before);
  });
});
