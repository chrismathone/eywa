import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLASS_LIST_PREFS,
  parseClassDays,
  parseClassListPrefs,
  sameClassListPrefs,
} from "./list-prefs";
import { classStatusMeta, parseClassSort, parseClassStatus, parseClassView } from "./list-filters";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const PAGE = "app/(shell)/classes/page.tsx";

describe("수업목록 보기 설정(users.ui_prefs.classes)", () => {
  it("깨진 값·모르는 키는 기본값으로 접는다", () => {
    expect(parseClassListPrefs(undefined)).toEqual(DEFAULT_CLASS_LIST_PREFS);
    expect(parseClassListPrefs(null)).toEqual(DEFAULT_CLASS_LIST_PREFS);
    expect(parseClassListPrefs([1, 2])).toEqual(DEFAULT_CLASS_LIST_PREFS);
    expect(parseClassListPrefs({ subject: "", teacher: 7, days: "x", sort: "zzz", view: "grid", status: "all" })).toEqual(
      DEFAULT_CLASS_LIST_PREFS,
    );
  });

  it("저장된 값은 그대로 살린다(상태·검색어는 애초에 키가 없다)", () => {
    const p = parseClassListPrefs({ subject: "english", teacher: "t1", days: ["wed", "mon"], sort: "students", view: "cards" });
    expect(p).toEqual({ subject: "english", teacher: "t1", days: ["mon", "wed"], sort: "students", view: "cards" });
    expect("status" in p).toBe(false);
    expect("q" in p).toBe(false);
  });

  it("요일은 URL 문자열·배열 둘 다 받고, 모르는 키·'all'은 버리고, 요일순으로 정규화한다", () => {
    expect(parseClassDays("wed,mon")).toEqual(["mon", "wed"]);
    expect(parseClassDays(["fri", "mon", "xx"])).toEqual(["mon", "fri"]);
    expect(parseClassDays("all")).toEqual([]);
    expect(parseClassDays("")).toEqual([]);
    expect(parseClassDays(undefined)).toEqual([]);
  });

  it("정렬·보기·상태는 허용 목록 밖이면 기본값", () => {
    expect(parseClassSort("teacher")).toBe("teacher");
    expect(parseClassSort("nope")).toBe("name");
    expect(parseClassView("cards")).toBe("cards");
    expect(parseClassView("grid")).toBe("table");
    expect(parseClassStatus("ended")).toBe("ended");
    expect(parseClassStatus("closed")).toBe("operating");
    expect(parseClassStatus(undefined)).toBe("operating");
  });

  it("같음 판정은 다섯 키 전부(요일은 원소까지)", () => {
    const a = parseClassListPrefs({ subject: "math", days: ["mon"] });
    expect(sameClassListPrefs(a, { ...a })).toBe(true);
    expect(sameClassListPrefs(a, { ...a, days: ["tue"] })).toBe(false);
    expect(sameClassListPrefs(a, { ...a, days: ["mon", "tue"] })).toBe(false);
    expect(sameClassListPrefs(a, { ...a, view: "cards" })).toBe(false);
  });

  it("상태 배지 = 운영 초록(positive) · 종강 앰버 · 폐지 중립 — 라벨은 필터 표와 같은 말", () => {
    expect(classStatusMeta({ isActive: true, closedAt: null })).toEqual({ label: "운영", color: "green" });
    expect(classStatusMeta({ isActive: true, closedAt: "2026-08-31" })).toEqual({ label: "종강", color: "amber" });
    expect(classStatusMeta({ isActive: false, closedAt: null })).toEqual({ label: "폐지", color: "neutral" });
  });
});

describe("수업목록 배선", () => {
  const page = read(PAGE);

  it("필터는 열 머리(HeaderFilter + 요일 HeaderDayFilter)이고 옛 필터바는 없다", () => {
    expect(page).toContain("<HeaderFilter");
    expect(page).toContain("<HeaderDayFilter");
    expect(existsSync(join(ROOT, "app/(shell)/classes/_components/class-filter-bar.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "app/(shell)/classes/_components/filter-shared.ts"))).toBe(false);
  });

  it("보기 설정은 DB(loadClassListPrefs + RememberPrefs) — 수업목록 어디에도 localStorage 없음", () => {
    expect(page).toContain("loadClassListPrefs()");
    expect(page).toContain("<RememberPrefs");
    expect(page).toContain("save={saveClassListPrefs}");
    const dir = join(ROOT, "app/(shell)/classes/_components");
    for (const f of readdirSync(dir)) {
      if (!/\.tsx?$/.test(f)) continue;
      // 주석의 낱말이 아니라 **호출**(localStorage.·localStorage[)만 잡는다.
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/localStorage\s*[.[]/);
    }
    expect(page).not.toMatch(/localStorage\s*[.[]/);
  });

  it("'전체'는 URL에 명시된다(explicitAll) — 저장값을 이기려면 값이어야 한다", () => {
    expect((page.match(/explicitAll/g) ?? []).length).toBeGreaterThanOrEqual(4); // 과목·정렬·담임·보기
    expect(read("app/(shell)/classes/_components/header-day-filter.tsx")).toContain('"all"');
  });

  it("공용 헬퍼는 지시어 없는 모듈, 저장은 use server 모듈(#81)", () => {
    for (const p of ["features/classes/list-prefs.ts", "features/classes/list-filters.ts"]) {
      const src = read(p);
      // 주석에 그 낱말이 적혀 있으니 '포함'이 아니라 **지시어 위치**(파일 머리·import 줄)로 본다.
      expect(src.trimStart().startsWith('"use client"'), p).toBe(false);
      expect(src, p).not.toMatch(/^import "server-only"/m);
    }
    expect(read("features/classes/server/list-prefs.ts").trimStart().startsWith('"use server"')).toBe(true);
    expect(read("components/remember-prefs.tsx").trimStart().startsWith('"use client"')).toBe(true);
  });

  it("수업목록 창은 최소 크기가 등록돼 있다(8열 표가 그 폭에서 선다)", () => {
    expect(read("components/workspace/window-geometry.ts")).toMatch(/classes: \{ w: 1100, h: 700 \}/);
  });

  it("상시 버튼은 Primary('새 반') + 텍스트('강의실 자동배정') 둘 — 결과 0개여도 표 머리가 남는다", () => {
    expect(page).toContain("<NewClassTrigger");
    expect(page).toContain("<ClassroomAssignButton");
    // 빈 상태는 표 본문(tbody) 안 — 표를 통째로 치우는 분기가 없다.
    expect(page).toMatch(/<tbody[\s\S]*\{empty \?/);
  });

  it("'운영' 배지는 classStatusMeta 단일 소스(화면 로컬 맵·primary 알약 없음)", () => {
    expect(page).toContain("classStatusMeta(c)");
    expect(page).not.toMatch(/Pill color="primary" soft=\{false\}/);
  });
});
