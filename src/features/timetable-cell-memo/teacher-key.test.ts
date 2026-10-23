import { describe, expect, it } from "vitest";
import { buildTeacherLabelMap } from "@/features/timetable/lib/teacher-label";
import { teacherKeyResolver } from "./teacher-key";

const people = [
  { id: "u-kim", displayName: "김태건", englishName: "Tom", active: true },
  { id: "u-lee", displayName: "이현이", englishName: "Hannah", active: true },
  { id: "u-park-old", displayName: "박나연", englishName: "Zoe", active: false },
  { id: "u-park", displayName: "박나연", englishName: null, active: true },
  { id: "u-a", displayName: "동명", englishName: null, active: true },
  { id: "u-b", displayName: "동명", englishName: null, active: true },
];
const resolver = (list = people) => teacherKeyResolver(list, buildTeacherLabelMap(list));

describe("강사 열쇠 — 이름 글자가 아니라 오래 가는 값", () => {
  it("직원 한 사람으로 풀리면 users.id", () => {
    expect(resolver().keyOf("김태건")).toBe("u:u-kim");
  });
  it("같은 이름이 재직자·퇴사자로 겹치면 재직자", () => {
    expect(resolver().keyOf("박나연")).toBe("u:u-park");
  });
  it("재직자끼리 같은 이름(동명이인)이면 고르지 않고 글자 그대로", () => {
    expect(resolver().keyOf("동명")).toBe("l:동명");
  });
  it("자리(LAB·JJ)는 사람으로 풀지 않는다", () => {
    expect(resolver().keyOf("LAB")).toBe("s:LAB");
    expect(resolver().keyOf("JJ")).toBe("s:JJ");
  });
  it("모르는 라벨(퇴사자 닉네임 등)은 글자 그대로", () => {
    expect(resolver().keyOf("Kevin")).toBe("l:Kevin");
  });
});

describe("🔴 이름을 바꿔도 메모는 그 사람 열을 따라간다", () => {
  it("저장한 뒤 표시 이름이 바뀌면 새 이름 열로 푼다", () => {
    const key = resolver().keyOf("김태건");
    const renamed = people.map((p) => (p.id === "u-kim" ? { ...p, displayName: "김태건B" } : p));
    expect(resolver(renamed).labelOf(key, "김태건")).toBe("김태건B");
  });
  it("직원 행이 사라졌으면 저장해 둔 라벨로", () => {
    expect(resolver([]).labelOf("u:u-kim", "김태건")).toBe("김태건");
  });
  it("자리·글자 열쇠는 그대로 푼다 · 모르는 모양은 null", () => {
    const r = resolver();
    expect(r.labelOf("s:LAB")).toBe("LAB");
    expect(r.labelOf("l:Kevin")).toBe("Kevin");
    expect(r.labelOf("x:?")).toBeNull();
  });
});
