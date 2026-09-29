import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 가드 — 엑셀 버튼은 **한 부품·한 이름**(원장 2026-09-29 *"탭마다 엑셀 내보내기/가져오기 버튼 이름과 위치가 다 제각각임.
 * 엑셀 내보내기/가져오기 로 통일하고 위치도 검색과 같은 라인으로"*).
 *  ① 화면 파일은 `ExcelImportButton`을 직접 쓰지 않는다(학원 설정 '데이터 가져오기' 허브만 예외 — 목록형 버튼 모음이다).
 *  ② 내보내기 파일 주소(`/api/exports/…` · 재고 · 성적)를 **맨 버튼·링크로** 직접 그리지 않는다 — `ExcelMenu`의 `exportHref`로만.
 *     (시간표는 시트 반영까지 담은 제 메뉴라 예외 — 이름은 같은 상수 `EXCEL_MENU_LABEL`을 쓴다.)
 */
const ROOT = join(__dirname, "..", "..", "..");
const APP = join(ROOT, "src", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}
const files = walk(APP).map((p) => ({ rel: relative(ROOT, p).split(sep).join("/"), src: readFileSync(p, "utf8") }));

describe("엑셀 버튼 = ExcelMenu 한 벌", () => {
  it("① 화면은 ExcelImportButton을 직접 쓰지 않는다(허브만 예외)", () => {
    const hits = files
      .filter((f) => /<ExcelImportButton\b/.test(f.src))
      .map((f) => f.rel)
      .filter((r) => r !== "src/app/(shell)/owner/_components/import-hub-face.tsx");
    expect(hits).toEqual([]);
  });

  it("② 내보내기 주소를 맨 버튼·링크로 그리지 않는다 — ExcelMenu exportHref로만", () => {
    const TIMETABLE = "src/app/(shell)/timetable/_components/toolbar-actions.tsx";
    const bad: string[] = [];
    for (const f of files) {
      if (f.rel === TIMETABLE) continue;
      // `<a href=…/api/exports/` · `render={<a href={`/api/exports/…` 모양(버튼 안 링크 포함).
      if (/<a\s[^>]*href=\{?[`"']\/api\/(exports\/|inventory\/excel|exams\/excel)/.test(f.src)) bad.push(f.rel);
    }
    expect(bad).toEqual([]);
  });

  it("시간표 메뉴도 같은 이름 상수를 쓴다", () => {
    const tt = files.find((f) => f.rel === "src/app/(shell)/timetable/_components/toolbar-actions.tsx")!;
    expect(tt.src).toContain("EXCEL_MENU_LABEL");
    // 옛 트리거 글자(엑셀·시트)가 JSX 텍스트 줄로 남지 않는다(주석 속 낱말은 무관).
    expect(tt.src).not.toMatch(/^\s*엑셀·시트\s*$/m);
  });
});
