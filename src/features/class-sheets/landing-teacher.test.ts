import { describe, expect, it } from "vitest";
import {
  buildTeacherOptions,
  ECS_TEACHER_ALL,
  ECS_TEACHER_NONE,
  keepTeacher,
  normalizeEcsTeacher,
  resolveTeacherFilter,
} from "./landing-teacher";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333";

const rows = [
  { teacherId: A },
  { teacherId: A },
  { teacherId: B },
  { teacherId: null },
  { teacherId: GONE }, // 이름을 못 찾는 담임
];
const names = new Map<string, string | null>([
  [A, "육소희"],
  [B, "김태건"],
  [GONE, null],
]);

describe("normalizeEcsTeacher", () => {
  it("모르는 모양은 전부 '전체' — 깨진 값에 목록이 통째로 비지 않게", () => {
    expect(normalizeEcsTeacher(undefined)).toBe(ECS_TEACHER_ALL);
    expect(normalizeEcsTeacher(null)).toBe(ECS_TEACHER_ALL);
    expect(normalizeEcsTeacher(42)).toBe(ECS_TEACHER_ALL);
    expect(normalizeEcsTeacher(["a"])).toBe(ECS_TEACHER_ALL);
    expect(normalizeEcsTeacher("")).toBe(ECS_TEACHER_ALL);
    expect(normalizeEcsTeacher("육소희")).toBe(ECS_TEACHER_ALL); // 이름은 키가 아니다
    expect(normalizeEcsTeacher("' or 1=1--")).toBe(ECS_TEACHER_ALL);
  });

  it("sentinel과 uuid만 통과(공백은 다듬는다)", () => {
    expect(normalizeEcsTeacher(ECS_TEACHER_ALL)).toBe("all");
    expect(normalizeEcsTeacher(ECS_TEACHER_NONE)).toBe("none");
    expect(normalizeEcsTeacher(` ${A} `)).toBe(A);
    expect(normalizeEcsTeacher(A.toUpperCase())).toBe(A.toUpperCase());
  });
});

describe("buildTeacherOptions", () => {
  it("이름순(ko) + 개수, '담임 미지정'은 항상 맨 뒤", () => {
    const opts = buildTeacherOptions(rows, names);
    expect(opts.map((o) => o.label)).toEqual(["김태건", "육소희", "담임 미지정"]);
    expect(opts.map((o) => o.count)).toEqual([1, 2, 1]);
    expect(opts.at(-1)!.value).toBe(ECS_TEACHER_NONE);
  });

  it("이름을 못 찾은 담임은 옵션에서 뺀다 — 화면에 id를 보일 수 없다", () => {
    expect(buildTeacherOptions(rows, names).some((o) => o.value === GONE)).toBe(false);
  });

  it("담임 미지정이 없으면 그 칸도 없다", () => {
    const opts = buildTeacherOptions([{ teacherId: A }], names);
    expect(opts).toEqual([{ value: A, label: "육소희", count: 1 }]);
  });

  it("모든 옵션은 반드시 1개 이상 — 눌러서 빈 목록이 되는 칸을 안 만든다", () => {
    for (const o of buildTeacherOptions(rows, names)) expect(o.count).toBeGreaterThan(0);
  });
});

describe("resolveTeacherFilter", () => {
  const opts = buildTeacherOptions(rows, names);

  it("옵션에 있으면 그대로", () => {
    expect(resolveTeacherFilter(A, opts)).toBe(A);
    expect(resolveTeacherFilter(ECS_TEACHER_NONE, opts)).toBe(ECS_TEACHER_NONE);
  });

  it("옵션에 없으면 '전체'로 떨어진다(퇴사·반 인계·프로그램 필터 변경)", () => {
    expect(resolveTeacherFilter(GONE, opts)).toBe(ECS_TEACHER_ALL);
    expect(resolveTeacherFilter(ECS_TEACHER_NONE, [])).toBe(ECS_TEACHER_ALL);
  });

  it("'전체'는 옵션이 비어도 '전체'", () => {
    expect(resolveTeacherFilter(ECS_TEACHER_ALL, [])).toBe(ECS_TEACHER_ALL);
  });
});

describe("keepTeacher", () => {
  it("전체는 그대로(복사본)", () => {
    const out = keepTeacher(rows, ECS_TEACHER_ALL);
    expect(out).toHaveLength(5);
    expect(out).not.toBe(rows);
  });

  it("담임 id로 거른다", () => {
    expect(keepTeacher(rows, A)).toHaveLength(2);
    expect(keepTeacher(rows, B)).toHaveLength(1);
  });

  it("'담임 미지정'은 담임 없는 반만 — 이름 못 찾는 담임(GONE)은 여기 섞이지 않는다", () => {
    const out = keepTeacher(rows, ECS_TEACHER_NONE);
    expect(out).toEqual([{ teacherId: null }]);
  });
});
