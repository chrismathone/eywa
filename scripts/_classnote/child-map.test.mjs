import { describe, expect, it } from "vitest";
import { phoneKey, planChildMap, resolveChildStudent } from "./child-map.mjs";

const YEAR = 2026; // 2026학년도 — 초6 = 2014년생

const students = [
  { id: "s-min", name: "김민준", grade: "초6", phones: ["010-1111-2222"] },
  { id: "s-seo", name: "김서연", grade: "중2", phones: ["010-1111-2222"] }, // 위와 같은 집(형제)
  { id: "s-solo", name: "박지호", grade: "고1", phones: ["010-3333-4444"] },
  { id: "s-nophone", name: "최특이", grade: "중1", phones: [] },
  { id: "s-dupA", name: "이서준", grade: "초3", phones: [] },
  { id: "s-dupB", name: "이서준C", grade: "중3", phones: [] },
];

describe("phoneKey", () => {
  it("표기가 달라도 같은 번호로 접는다", () => {
    expect(phoneKey("010-1111-2222")).toBe(phoneKey("01011112222"));
    expect(phoneKey("+82-10-1111-2222")).toBe("01011112222");
  });
  it("비교 불가한 값은 빈 문자열(대조에서 빠진다)", () => {
    for (const v of ["", null, undefined, "1234", "번호없음"]) expect(phoneKey(v)).toBe("");
  });
});

describe("resolveChildStudent — 3겹 확정", () => {
  it("전화가 한 명만 가리키면 그대로 확정", () => {
    const r = resolveChildStudent({ childId: 1, name: "박지호", phones: ["01033334444"] }, students, { schoolYear: YEAR });
    expect(r).toEqual({ studentId: "s-solo", by: "phone" });
  });

  it("형제가 번호를 공유하면 이름으로 가른다", () => {
    const r = resolveChildStudent({ childId: 2, name: "김서연", phones: ["01011112222"] }, students, { schoolYear: YEAR });
    expect(r).toEqual({ studentId: "s-seo", by: "phone+name" });
  });

  it("전화가 맞아도 이름이 아무와도 안 맞으면 확정하지 않는다", () => {
    const r = resolveChildStudent({ childId: 3, name: "전혀다른아이", phones: ["01011112222"] }, students, { schoolYear: YEAR });
    expect(r.studentId).toBeNull();
    expect(r.why).toContain("사람이 확인");
  });

  it("전화가 없어도 이름이 유일하면 확정", () => {
    const r = resolveChildStudent({ childId: 4, name: "최특이", phones: [] }, students, { schoolYear: YEAR });
    expect(r).toEqual({ studentId: "s-nophone", by: "name" });
  });

  // 🔴 접미사(A~G)는 같은 이름의 다른 사람이다 — 이름만으로 붙이면 남의 집 연락이 간다.
  it("접미사 형제(이서준·이서준C)는 이름만으로 확정하지 않고 생년으로 가른다", () => {
    const noBirth = resolveChildStudent({ childId: 5, name: "이서준", phones: [] }, students, { schoolYear: YEAR });
    expect(noBirth.studentId).toBeNull();
    // 2026학년도 기준 초3 = 2017년생(중3은 2011년생) → 생년이 초3 쪽만 가리킨다.
    const withBirth = resolveChildStudent({ childId: 5, name: "이서준", birth: "2017-05-02", phones: [] }, students, {
      schoolYear: YEAR,
    });
    expect(withBirth).toEqual({ studentId: "s-dupA", by: "name+birth" });
  });

  it("생년이 어느 학년과도 안 맞으면 확정하지 않는다", () => {
    const r = resolveChildStudent({ childId: 6, name: "이서준", birth: "1999-01-01", phones: [] }, students, { schoolYear: YEAR });
    expect(r.studentId).toBeNull();
  });
});

describe("planChildMap — 멱등·충돌 보류", () => {
  it("이미 붙은 원아는 계획에 넣지 않는다", () => {
    const withMapped = students.map((s) => (s.id === "s-solo" ? { ...s, classnote_child_id: 1 } : s));
    const { plan } = planChildMap([{ childId: 1, name: "박지호", phones: ["01033334444"] }], withMapped, { schoolYear: YEAR });
    expect(plan).toEqual([]);
  });

  it("한 학생에 두 원아가 몰리면 둘 다 보류한다", () => {
    const { plan, skipped } = planChildMap(
      [
        { childId: 10, name: "박지호", phones: ["01033334444"] },
        { childId: 11, name: "박지호", phones: ["01033334444"] },
      ],
      students,
      { schoolYear: YEAR },
    );
    expect(plan).toEqual([]);
    expect(skipped.map((s) => s.childId).sort()).toEqual([10, 11]);
  });

  it("그 학생에 이미 다른 원아가 붙어 있으면 새 원아는 보류(이유를 남긴다)", () => {
    const withMapped = students.map((s) => (s.id === "s-solo" ? { ...s, classnote_child_id: 99 } : s));
    const { plan, skipped } = planChildMap([{ childId: 12, name: "박지호", phones: ["01033334444"] }], withMapped, {
      schoolYear: YEAR,
    });
    expect(plan).toEqual([]);
    expect(skipped[0].why).toContain("이미 다른 원아");
  });

  it("확정된 것만 계획에 담는다", () => {
    const { plan, skipped } = planChildMap(
      [
        { childId: 20, name: "김민준", phones: ["01011112222"] },
        { childId: 21, name: "알수없는아이", phones: [] },
      ],
      students,
      { schoolYear: YEAR },
    );
    expect(plan).toEqual([{ childId: 20, studentId: "s-min", by: "phone+name" }]);
    expect(skipped).toHaveLength(1);
  });
});
