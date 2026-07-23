import { describe, expect, it } from "vitest";

import {
  applyGradeFilter,
  bucketsOf,
  gradeBucket,
  gradeFilterLabel,
  gradesInBucket,
  isGradeFilterActive,
  normalizeGradeSelection,
  parseViewPrefs,
  serializeViewPrefs,
} from "./view-prefs";

// 학원설정(operations.gradeLevels) 실값.
const ALL = ["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"];
const ELEM = ["초1", "초2", "초3", "초4", "초5", "초6"];
const MID = ["중1", "중2", "중3"];

describe("gradeBucket / bucketsOf", () => {
  it("첫 글자로 학제를 가른다", () => {
    expect(gradeBucket("초6")).toBe("초");
    expect(gradeBucket("중2")).toBe("중");
    expect(gradeBucket("고3")).toBe("고");
  });

  it("빈 값은 null", () => {
    expect(gradeBucket(null)).toBeNull();
    expect(gradeBucket("")).toBeNull();
    expect(gradeBucket("   ")).toBeNull();
  });

  it("설정에 없던 학제가 생겨도 첫 글자를 버킷으로 쓴다(하드코딩 목록으로 막지 않음)", () => {
    expect(gradeBucket("유7")).toBe("유");
    expect(bucketsOf(["유1", "초1", "초2"])).toEqual(["유", "초"]);
  });

  it("등장 순서를 보존해 유일화", () => {
    expect(bucketsOf(ALL)).toEqual(["초", "중", "고"]);
  });

  it("gradesInBucket", () => {
    expect(gradesInBucket(ALL, "중")).toEqual(MID);
  });
});

describe("isGradeFilterActive / gradeFilterLabel", () => {
  it("미설정·빈 배열·전체선택은 필터가 아니다", () => {
    for (const sel of [null, [], ALL]) {
      expect(isGradeFilterActive(sel, ALL)).toBe(false);
      expect(gradeFilterLabel(sel, ALL)).toBeNull();
    }
  });

  it("버킷이 통째로 선택되면 학제로 줄여 말한다", () => {
    expect(gradeFilterLabel(ELEM, ALL)).toBe("초만");
    expect(gradeFilterLabel([...ELEM, ...MID], ALL)).toBe("초·중만");
  });

  it("버킷이 덜 찼으면 학년을 나열(3개 이하)", () => {
    expect(gradeFilterLabel(["고3"], ALL)).toBe("고3만");
    expect(gradeFilterLabel(["중1", "고1"], ALL)).toBe("중1·고1만");
  });

  it("4개 이상이고 버킷도 안 맞으면 개수로", () => {
    expect(gradeFilterLabel(["초1", "초2", "중1", "고1"], ALL)).toBe("4개 학년만");
  });

  it("설정에서 사라진 학년이 저장돼 있어도 교집합으로 판단한다", () => {
    // '초0'은 더 이상 설정에 없다 → 무시되고 초1만 남는다.
    expect(gradeFilterLabel(["초0", "초1"], ALL)).toBe("초1만");
    // 저장값이 전부 설정 밖이면 필터 없음으로 본다(사용자를 빈 화면에 가두지 않는다).
    expect(isGradeFilterActive(["초0"], ALL)).toBe(false);
  });
});

describe("applyGradeFilter — 혼합 반 보존이 핵심", () => {
  const mixed = {
    classId: "c1",
    className: "고등M 개별 TP4E", // 실데이터: 중·고 혼재
    students: [
      { studentId: "s1", grade: "중3" },
      { studentId: "s2", grade: "고1" },
      { studentId: "s3", grade: "고2" },
    ],
  };
  const pureElem = {
    classId: "c2",
    className: "초등M CR1A",
    students: [{ studentId: "s4", grade: "초4" }],
  };
  const empty = { classId: "c3", className: "명단없는 반", students: [] as { grade?: string }[] };

  it("필터가 없으면 원본 배열을 그대로 돌려준다(참조 동일)", () => {
    const slots = [mixed, pureElem];
    expect(applyGradeFilter(slots, null)).toBe(slots);
    expect(applyGradeFilter(slots, [])).toBe(slots);
  });

  it("① 학생 단위로 거른다 — 혼합 반은 남고 명단만 좁아진다", () => {
    const out = applyGradeFilter([mixed], ["고1", "고2", "고3"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.className).toBe("고등M 개별 TP4E");
    expect(out[0]!.students.map((s) => s.studentId)).toEqual(["s2", "s3"]);
  });

  it("② 보이는 학생이 0명이면 그 반은 빠진다", () => {
    const out = applyGradeFilter([mixed, pureElem], ELEM);
    expect(out.map((s) => s.classId)).toEqual(["c2"]);
  });

  it("③ 원래 명단이 0명인 반은 필터와 무관하게 유지된다", () => {
    const out = applyGradeFilter([empty, pureElem], ["고1"]);
    expect(out.map((s) => s.classId)).toEqual(["c3"]);
  });

  it("학년 미상 학생은 fail-open — 필터가 걸려도 사라지지 않는다", () => {
    const unknown = {
      classId: "c4",
      className: "학년 미입력",
      students: [{ studentId: "s9", grade: null }, { studentId: "s10", grade: "초1" }],
    };
    const out = applyGradeFilter([unknown], ["고3"]);
    expect(out).toHaveLength(1);
    expect(out[0]!.students.map((s) => s.studentId)).toEqual(["s9"]);
  });

  it("원본을 변형하지 않는다(불변)", () => {
    const before = mixed.students.length;
    applyGradeFilter([mixed], ["고1"]);
    expect(mixed.students).toHaveLength(before);
  });

  it("전원이 통과하면 슬롯 객체를 새로 만들지 않는다", () => {
    const out = applyGradeFilter([pureElem], ELEM);
    expect(out[0]).toBe(pureElem);
  });
});

describe("parseViewPrefs — 깨진 jsonb에도 throw하지 않는다", () => {
  it("빈 값", () => {
    for (const raw of [null, undefined, 0, "x", [], {}, { timetable: 3 }]) {
      expect(parseViewPrefs(raw)).toEqual({
        grades: null,
        hideEmptyDays: null,
        collapseEmptyPeriods: null,
      });
    }
  });

  it("정상값", () => {
    expect(
      parseViewPrefs({ timetable: { grades: ["초1"], hideEmptyDays: true, collapseEmptyPeriods: false } }),
    ).toEqual({ grades: ["초1"], hideEmptyDays: true, collapseEmptyPeriods: false });
  });

  it("배열에 잡값이 섞여도 문자열만 취한다", () => {
    expect(parseViewPrefs({ timetable: { grades: ["초1", 3, null, "", "중2"] } }).grades).toEqual([
      "초1",
      "중2",
    ]);
  });

  it("다른 화면 키가 있어도 무시하고 timetable만 읽는다", () => {
    const p = parseViewPrefs({ students: { sort: "name" }, timetable: { hideEmptyDays: true } });
    expect(p.hideEmptyDays).toBe(true);
    expect(p.grades).toBeNull();
  });
});

describe("serializeViewPrefs / normalizeGradeSelection", () => {
  it("미설정 키는 아예 안 쓴다", () => {
    expect(serializeViewPrefs({ grades: null, hideEmptyDays: null, collapseEmptyPeriods: null })).toEqual(
      {},
    );
  });

  it("설정된 것만 직렬화", () => {
    expect(
      serializeViewPrefs({ grades: ["고3"], hideEmptyDays: false, collapseEmptyPeriods: null }),
    ).toEqual({ grades: ["고3"], hideEmptyDays: false });
  });

  it("전체 선택은 필터 없음(null)으로 정규화", () => {
    expect(normalizeGradeSelection(ALL, ALL)).toBeNull();
    expect(normalizeGradeSelection([], ALL)).toBeNull();
    expect(normalizeGradeSelection(null, ALL)).toBeNull();
  });

  it("부분 선택은 설정 순서로 정규화", () => {
    expect(normalizeGradeSelection(["중1", "초1"], ALL)).toEqual(["초1", "중1"]);
  });

  it("직렬화 → 파싱 왕복", () => {
    const prefs = { grades: ["초1", "중2"], hideEmptyDays: true, collapseEmptyPeriods: false };
    expect(parseViewPrefs({ timetable: serializeViewPrefs(prefs) })).toEqual(prefs);
  });
});
