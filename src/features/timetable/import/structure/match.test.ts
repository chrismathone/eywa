import { describe, expect, it } from "vitest";
import { matchStructure } from "./match";
import { parseTeacherGrid } from "./parse-grid";
import fixtureJson from "./fixtures/teacher-grid.sample.json";
import type { ExistingContext, SheetGrid } from "./types";

const parsed = parseTeacherGrid(fixtureJson as unknown as SheetGrid);

// 구버전 eywa를 흉내낸 "일부만 존재" 컨텍스트 — 시트가 진실원본, 나머지는 신규 대상이 되어야 한다.
const ctx: ExistingContext = {
  classes: [
    { id: "c1", className: "중등E_중2 심화", subject: "english", teacherId: null, classroomId: null },
    { id: "c2", className: "LT2", subject: "english", teacherId: null, classroomId: null },
  ],
  teachers: [
    { id: "t1", englishName: "Jane", displayName: "추민아" },
    { id: "t2", englishName: "Anna", displayName: "육소희" },
  ],
  classrooms: [
    { id: "r1", name: "301호" }, // "301" 토큰으로 느슨히 매칭돼야 함
    { id: "r2", name: "302" },
  ],
};

describe("matchStructure — 이름 기준 매칭(구버전 레코드 방어)", () => {
  const res = matchStructure(parsed, ctx);

  it("존재하는 수업은 classId 해석", () => {
    const s = res.resolved.find((x) => x.className === "중등E_중2 심화");
    expect(s?.classId).toBe("c1");
  });

  it("존재하는 강사(englishName)는 teacherId 해석", () => {
    const s = res.resolved.find((x) => x.teacherName === "Jane");
    expect(s?.teacherId).toBe("t1");
  });

  it("방 '301'은 기존 '301호'와 느슨 매칭", () => {
    const s = res.resolved.find((x) => x.room === "301");
    expect(s?.classroomId).toBe("r1");
  });

  it("시트에만 있는 수업은 newClassNames로", () => {
    expect(res.newClassNames.length).toBeGreaterThan(0);
    expect(res.newClassNames).toContain("KW6"); // ctx에 없음
  });

  it("시트에만 있는 강사는 newTeacherNames로, 예비 강사는 제외", () => {
    expect(res.newTeacherNames).toContain("Hannah"); // ctx에 없음
    expect(res.newTeacherNames.every((n) => !n.startsWith("예비"))).toBe(true);
  });

  it("매칭 카운트 합계가 슬롯 수를 넘지 않음", () => {
    expect(res.matchedClasses).toBeGreaterThan(0);
    expect(res.matchedClasses).toBeLessThanOrEqual(res.resolved.length);
    expect(res.matchedTeachers).toBeGreaterThan(0);
  });
});

describe("🔴 특수 자리(랩실·집중자율수업실)는 사람으로 해석하지 않는다", () => {
  // 원장 2026-07-29 "직원 배정 안 함". 안 막으면 시트를 재동기할 때마다 '이주희' 라벨이 **실제 이주희
  // 직원 계정**에 다시 붙어 출석부·직원명부·급여표에 가짜 강사가 되살아난다(재발 방지 잠금).
  const ctxWithLeeJuhee: ExistingContext = {
    ...ctx,
    teachers: [...ctx.teachers, { id: "t9", englishName: null, displayName: "이주희" }],
  };
  const withSpecial = {
    ...parsed,
    slots: parsed.slots.slice(0, 3).map((s, i) => ({
      ...s,
      teacherName: ["이주희", "JJ", "LAB"][i]!,
      teacherHeader: ["이주희", "JJ", "LAB"][i]!,
    })),
  };
  const out = matchStructure(withSpecial, ctxWithLeeJuhee);

  it("teacherId는 전부 null(라벨-only 보존)", () => {
    expect(out.resolved.map((s) => s.teacherId)).toEqual([null, null, null]);
  });

  it("'신규 강사'로도 올라가지 않는다(계정 생성 유도 금지)", () => {
    for (const n of ["이주희", "JJ", "LAB"]) expect(out.newTeacherNames).not.toContain(n);
  });
});
