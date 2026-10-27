/**
 * 수학 교재명 제안 배선 가드(원장 2026-10-27) — 교재명 칸이 셋(표 행 · 카드 · 일괄 입력)이고 공급자는 페이지 하나다.
 * 한 곳만 빠지면 그 화면에서만 제안이 **조용히** 사라진다(에러가 안 난다).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isMathBookRow } from "./math-book-list";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const C = ["src", "features", "onescreen", "components"];

describe("수학 교재명 제안", () => {
  it("원스크린 페이지가 수학 교재목록으로 공급자를 감싼다", () => {
    const page = read("src", "app", "(shell)", "onescreen", "page.tsx");
    expect(page).toContain('loadEcsTextbookOptions("math")');
    expect(page).toContain("<TextbookOptionsProvider");
  });

  it("표 행·카드는 수학 행에만 단다", () => {
    for (const f of ["grid-row.tsx", "report-card.tsx"]) {
      expect(read(...C, f)).toContain("list={isMathBookRow(subject.subjectKey) ? mathBookList : undefined}");
    }
  });

  it("일괄 입력 교재명 칸도 같은 목록을 쓴다", () => {
    expect(read(...C, "bulk-apply.tsx")).toContain("list={mathBookList}");
  });

  it("과목 키 미지정은 수학 · 영어는 아니다", () => {
    expect(isMathBookRow(undefined)).toBe(true);
    expect(isMathBookRow("")).toBe(true);
    expect(isMathBookRow("math")).toBe(true);
    expect(isMathBookRow("english")).toBe(false);
  });
});
