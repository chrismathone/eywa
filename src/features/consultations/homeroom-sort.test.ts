import { describe, expect, it } from "vitest";
import type { HomeroomMonth, HomeroomTeacher } from "./homeroom-model";
import type { HomeroomFilter } from "./homeroom-sort";
import { filterHomeroomTeachers, nextSort, parseHomeroomFilter, parseHomeroomSortKey, sortHomeroomTeachers } from "./homeroom-sort";

const m = (self: number, target: number): HomeroomMonth => ({ self, target, other: 0, none: target - self });
const t = (name: string, subjects: string[], months: HomeroomMonth[], students = 1): HomeroomTeacher => ({
  id: name,
  name,
  subjects,
  classNames: [],
  students: Array.from({ length: students }, (_, i) => ({ id: `${name}${i}`, name: "", grade: null, cells: [], selfCounts: [], otherNames: [], lastSelf: null })),
  months,
});
const label = (k: string) => ({ math: "수학", english: "영어" })[k] ?? k;
const list = [t("나", ["math"], [m(1, 2), m(0, 0)], 3), t("가", ["english"], [m(2, 2), m(1, 4)], 5), t("다", ["math"], [m(0, 2), m(2, 4)], 1)];
const names = (key: Parameters<typeof nextSort>[1], dir: "asc" | "desc") => sortHomeroomTeachers(list, { key, dir }, label).map((x) => x.name);

describe("sortHomeroomTeachers", () => {
  it("이름·과목(라벨 가나다)·학생 수", () => {
    expect(names("name", "asc")).toEqual(["가", "나", "다"]);
    expect(names("subject", "asc")).toEqual(["나", "다", "가"]); // 라벨 가나다(수학 < 영어), 같으면 이름
    expect(names("students", "desc")).toEqual(["가", "나", "다"]);
  });
  it("이번 달(m0) 상담률 — 대상 0명인 담임은 방향과 무관하게 맨 아래", () => {
    expect(names("m0", "asc")).toEqual(["가", "다", "나"]);
    expect(names("m0", "desc")).toEqual(["다", "가", "나"]);
  });
  it("평균·미상담", () => {
    expect(names("avg", "asc")).toEqual(["다", "가", "나"]); // 2/6 < 3/6 = 1/2(같으면 이름)
    expect(names("unmet", "desc")).toEqual(["가", "다", "나"]);
  });
});

describe("nextSort · parseHomeroomSortKey", () => {
  it("같은 열은 방향만 뒤집고, 새 열은 기본 방향", () => {
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "asc" }, "unmet")).toEqual({ key: "unmet", dir: "desc" });
    expect(nextSort({ key: "name", dir: "asc" }, "m0")).toEqual({ key: "m0", dir: "asc" });
  });
  it("모르는 값은 버린다", () => {
    expect(parseHomeroomSortKey("m3")).toBe("m3");
    expect(parseHomeroomSortKey("m99")).toBeNull();
    expect(parseHomeroomSortKey("drop")).toBeNull();
  });
});

describe("filterHomeroomTeachers · parseHomeroomFilter", () => {
  it("과목·고른 담임·이번 달 미상담 있는 담임만", () => {
    const base: HomeroomFilter = { subject: null, teachers: [], unmetOnly: false, unmetStudentsOnly: false };
    const pick = (f: Partial<HomeroomFilter>) => filterHomeroomTeachers(list, { ...base, ...f }).map((x) => x.name);
    expect(pick({ subject: "math" })).toEqual(["나", "다"]);
    expect(pick({ teachers: ["가", "다"] })).toEqual(["가", "다"]);
    expect(pick({ unmetOnly: true })).toEqual(["가", "다"]); // 나는 이번 달 대상 0명
    expect(pick({})).toHaveLength(3);
  });
  it("저장값은 다시 거른다 — uuid 아닌 담임 id·이상한 과목은 버린다", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(parseHomeroomFilter({ subject: "math", teachers: [id, "x"], unmetOnly: true })).toEqual({
      subject: "math",
      teachers: [id],
      unmetOnly: true,
      unmetStudentsOnly: false,
    });
    expect(parseHomeroomFilter("junk")).toEqual({ subject: null, teachers: [], unmetOnly: false, unmetStudentsOnly: false });
  });
});
