import { describe, expect, it } from "vitest";
import { staffComposition, staffSubjectGroup } from "./staff-subjects";

const settings = [
  { key: "english", label: "영어" },
  { key: "math", label: "수학" },
  { key: "subject_1", label: "수학(심화)" },
  { key: "korean", label: "국어" },
];

describe("staffSubjectGroup — 영어·수학·둘 다·그 외·없음", () => {
  it("수학(심화)만 맡아도 수학이고, 영어와 수학을 같이 맡으면 '둘 다'다(학년별 재원생 막대와 같은 판정)", () => {
    expect(staffSubjectGroup(["subject_1"], settings)).toBe("math");
    expect(staffSubjectGroup(["math", "subject_1"], settings)).toBe("math");
    expect(staffSubjectGroup(["english"], settings)).toBe("english");
    expect(staffSubjectGroup(["english", "subject_1"], settings)).toBe("both");
  });
  it("과목이 비면 '없음', 영어·수학이 아닌 과목만 맡으면 '그 외'(없음으로 뭉치지 않는다)", () => {
    expect(staffSubjectGroup(null, settings)).toBe("none");
    expect(staffSubjectGroup([], settings)).toBe("none");
    expect(staffSubjectGroup(["korean"], settings)).toBe("other");
    expect(staffSubjectGroup(["korean", "math"], settings)).toBe("math");
  });
});

describe("staffComposition — 역할 막대 하나 안의 과목 묶음", () => {
  it("역할별 인원과 묶음 인원의 합이 같고, 관리자도 강사와 같은 규칙으로 갈린다", () => {
    const rows = staffComposition(
      [
        { role: "teacher", subjects: ["math"] },
        { role: "teacher", subjects: ["english"] },
        { role: "teacher", subjects: null },
        { role: "admin", subjects: ["english", "math"] },
        { role: "admin", subjects: [] },
        { role: "master", subjects: null },
      ],
      settings,
    );
    expect(rows.map((r) => `${r.label}:${r.value}`)).toEqual(["강사:3", "관리자:2", "원장:1"]);
    for (const r of rows) expect(Object.values(r.bySubject).reduce((s, n) => s + n, 0)).toBe(r.value);
    expect(rows[0].bySubject).toEqual({ english: 1, math: 1, both: 0, other: 0, none: 1 });
    expect(rows[1].bySubject).toEqual({ english: 0, math: 0, both: 1, other: 0, none: 1 });
  });
  it("모르는 역할은 raw 코드 대신 '기타'로 세운다(raw 코드 노출 금지)", () => {
    expect(staffComposition([{ role: "helper", subjects: null }], settings)[0].label).toBe("기타");
  });
});
