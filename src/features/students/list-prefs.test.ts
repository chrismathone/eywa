import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STUDENT_LIST_PREFS,
  parseSearchField,
  parseStudentListPrefs,
  parseStudentSort,
  sameStudentListPrefs,
} from "./list-prefs";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("학생목록 보기 설정(users.ui_prefs.students)", () => {
  it("깨진 값·모르는 키는 기본값으로 접는다", () => {
    expect(parseStudentListPrefs(undefined)).toEqual(DEFAULT_STUDENT_LIST_PREFS);
    expect(parseStudentListPrefs("nope")).toEqual(DEFAULT_STUDENT_LIST_PREFS);
    expect(parseStudentListPrefs({ subject: 3, sort: "zzz", field: null, noenr: "1", grade: "  " })).toEqual(
      DEFAULT_STUDENT_LIST_PREFS,
    );
  });

  it("저장된 값은 그대로 살린다(상태·검색어는 애초에 키가 없다)", () => {
    expect(
      parseStudentListPrefs({ subject: "math", grade: "중2", teacher: "t1", field: "school", sort: "recent", noenr: true, status: "all", q: "김" }),
    ).toEqual({ subject: "math", grade: "중2", teacher: "t1", field: "school", sort: "recent", noenr: true });
  });

  it("정렬·검색 필드는 허용 목록 밖이면 기본값", () => {
    expect(parseStudentSort("name")).toBe("name");
    expect(parseStudentSort("bogus")).toBe("grade");
    expect(parseSearchField("memo")).toBe("memo");
    expect(parseSearchField(undefined)).toBe("all");
  });

  it("같음 판정은 여섯 키 전부", () => {
    const a = { ...DEFAULT_STUDENT_LIST_PREFS };
    expect(sameStudentListPrefs(a, { ...a })).toBe(true);
    expect(sameStudentListPrefs(a, { ...a, noenr: true })).toBe(false);
  });
});

/**
 * 배선 가드 — 학생목록은 열 머리 필터 + 계정 귀속 보기 설정이다(디자인 v5 2026-09-03).
 * 🔴 localStorage 필터 기억은 되돌리지 말 것([[#90]], 원장 2026-08-04 "뷰 세팅은 계정 귀속 — 항상").
 */
describe("학생목록 배선", () => {
  const page = read("src/app/(shell)/students/page.tsx");

  it("필터는 열 머리(HeaderFilter)이고 옛 필터바는 없다", () => {
    expect(page).toContain('from "@/components/header-filter"');
    expect(page).not.toContain("student-filter-bar");
    expect(page).not.toContain("StudentFilterBar");
  });

  it("보기 설정은 DB(loadStudentListPrefs + 공용 RememberPrefs) — localStorage 없음", () => {
    expect(page).toContain("loadStudentListPrefs");
    expect(page).toContain("<RememberPrefs");
    expect(page).toContain("save={saveStudentListPrefs}");
    expect(page).not.toContain("localStorage");
    expect(read("src/components/remember-prefs.tsx")).not.toContain("localStorage");
  });

  it("공용 헬퍼는 지시어 없는 모듈, 저장은 use server 모듈(#81)", () => {
    const pure = read("src/features/students/list-prefs.ts");
    expect(pure.startsWith('"use client"')).toBe(false);
    expect(pure).not.toContain('import "server-only"');
    expect(read("src/features/students/server/list-prefs.ts").startsWith('"use server"')).toBe(true);
    expect(read("src/components/header-filter.tsx").startsWith('"use client"')).toBe(false);
  });

  it("학생목록 창은 최소 크기가 등록돼 있다(5열 표가 그 폭에서 선다)", () => {
    expect(read("src/components/workspace/window-geometry.ts")).toMatch(/\n\s*students: \{ w: 960, h: 680 \}/);
  });

  it("상시 버튼은 Primary('새 학생') 하나 — 엑셀 내보내기/가져오기는 검색 줄의 한 버튼(2026-09-29)", () => {
    expect(page).toContain("<StudentsMoreMenu");
    // 검색(SearchToggle) 뒤에 선다 — 머리(PageHeader actions)가 아니다.
    expect(page.indexOf("<StudentsMoreMenu")).toBeGreaterThan(page.indexOf("<SearchToggle"));
    expect(page).not.toContain("<StudentImportDialog");
    expect(page).not.toContain("엑셀 내보내기");
  });
});
