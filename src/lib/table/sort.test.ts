import { describe, expect, it } from "vitest";
import { ariaSort, compareKo, compareValues, sortIndicator, sortRows, toggleSort } from "./sort";

describe("compareKo", () => {
  it("가나다순", () => {
    expect(["최영서", "김민승", "박라임"].sort(compareKo)).toEqual(["김민승", "박라임", "최영서"]);
  });

  it("숫자가 섞인 반 이름은 자연 정렬(중2 < 중3 < 중10)", () => {
    expect(["중10 A", "중3 A", "중2 A"].sort(compareKo)).toEqual(["중2 A", "중3 A", "중10 A"]);
  });

  it("한글·영문 혼재에서도 한 규약으로 결정된다(순서 자체가 뒤집히지 않음)", () => {
    const once = ["Anna", "김태건", "Dom", "이주희"].sort(compareKo);
    const twice = [...once].sort(compareKo);
    expect(twice).toEqual(once);
  });
});

describe("compareValues", () => {
  it("숫자는 숫자로(문자열 비교면 10 < 9가 된다)", () => {
    expect(compareValues(9, 10)).toBeLessThan(0);
  });

  it("빈 값은 항상 뒤", () => {
    expect(compareValues(null, "가")).toBeGreaterThan(0);
    expect(compareValues("", "가")).toBeGreaterThan(0);
    expect(compareValues(undefined, 1)).toBeGreaterThan(0);
    expect(compareValues(null, undefined)).toBe(0);
  });
});

describe("toggleSort", () => {
  it("오름 → 내림 → 해제 3단 순환(원래 순서로 돌아갈 길)", () => {
    let s = toggleSort(null, "name");
    expect(s).toEqual({ key: "name", dir: "asc" });
    s = toggleSort(s, "name");
    expect(s).toEqual({ key: "name", dir: "desc" });
    s = toggleSort(s, "name");
    expect(s).toBeNull();
  });

  it("다른 열을 누르면 그 열 오름차순부터", () => {
    expect(toggleSort({ key: "name", dir: "desc" }, "views")).toEqual({ key: "views", dir: "asc" });
  });
});

describe("sortRows", () => {
  type Row = { name: string; views: number | null; cls: string };
  const rows: Row[] = [
    { name: "박라임", views: 3, cls: "중3" },
    { name: "김민승", views: null, cls: "중2" },
    { name: "최영서", views: 10, cls: "중3" },
    { name: "이도경", views: 3, cls: "중2" },
  ];
  const valueOf = (r: Row, k: "name" | "views") => (k === "name" ? r.name : r.views);

  it("정렬 안 함이면 원본 배열 그대로(참조까지 동일)", () => {
    expect(sortRows(rows, null, valueOf)).toBe(rows);
  });

  it("이름 오름/내림", () => {
    expect(sortRows(rows, { key: "name", dir: "asc" }, valueOf).map((r) => r.name)).toEqual([
      "김민승",
      "박라임",
      "이도경",
      "최영서",
    ]);
    expect(sortRows(rows, { key: "name", dir: "desc" }, valueOf).map((r) => r.name)).toEqual([
      "최영서",
      "이도경",
      "박라임",
      "김민승",
    ]);
  });

  it("빈 값은 내림차순에서도 뒤에 남는다(값 없음이 맨 위로 올라오면 안 됨)", () => {
    expect(sortRows(rows, { key: "views", dir: "desc" }, valueOf).map((r) => r.views)).toEqual([10, 3, 3, null]);
  });

  it("같은 값끼리는 원래 순서 유지(안정 정렬)", () => {
    // views=3 동률인 박라임·이도경이 원래 순서(박라임 먼저)를 지켜야 한다.
    expect(
      sortRows(rows, { key: "views", dir: "asc" }, valueOf)
        .filter((r) => r.views === 3)
        .map((r) => r.name),
    ).toEqual(["박라임", "이도경"]);
  });

  it("원본을 변형하지 않는다", () => {
    const before = rows.map((r) => r.name);
    sortRows(rows, { key: "name", dir: "asc" }, valueOf);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});

describe("표시 보조", () => {
  it("정렬 중인 열만 방향·aria-sort (문자 화살표 글리프를 돌려주지 않는다 — 아이콘 규칙)", () => {
    const s = { key: "name", dir: "asc" as const };
    expect(sortIndicator(s, "name")).toBe("asc");
    expect(sortIndicator({ key: "name", dir: "desc" }, "name")).toBe("desc");
    expect(sortIndicator(s, "views")).toBeNull();
    expect(ariaSort(s, "name")).toBe("ascending");
    expect(ariaSort(s, "views")).toBe("none");
    expect(ariaSort(null, "name")).toBe("none");
  });
});
