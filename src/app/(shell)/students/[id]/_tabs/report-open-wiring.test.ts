import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 원생 상세 '진도' 표의 **수업보고서 바로가기** 배선(원장 2026-09-18).
 * 두 가지가 조용히 틀어지면 화면은 멀쩡해 보여서 잡히지 않는다 — 소스로 잠근다.
 */
/** 주석은 규칙을 **설명**하는 자리라 뺀다(경고 주석 자체가 위반으로 걸리지 않게 — embed 가드와 같은 규약). */
const read = (...p: string[]) =>
  readFileSync(join(process.cwd(), ...p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

describe("진도 표 → 수업보고서 바로가기", () => {
  const link = read("src", "app", "(shell)", "students", "[id]", "_tabs", "report-open-link.tsx");
  const print = read("src", "app", "(print)", "lesson_reports", "[id]", "print", "page.tsx");

  it("🔴 학부모 링크(`/r/…`)가 아니라 내부 문서로 연다 — `/r`은 모든 방문을 학부모 열람으로 적는다", () => {
    expect(link).toContain("`/lesson_reports/${reportId}/print`");
    expect(link).not.toMatch(/["'`]\/r\//);
  });

  it("인쇄 창 id 규약(`print/lesson_reports/<id>`)으로 연다 — 그래야 A4 크기로 선다", () => {
    expect(link).toContain("usePrintWindow");
    expect(link).toContain("`print/lesson_reports/${reportId}`");
  });

  it("🔴 창(iframe) 안에선 부모 작업면에 **새 창**을 열어 달라고 한다 — 드릴인이면 보던 진도 표가 사라진다", () => {
    expect(link).toContain("useInFrame");
    expect(link).toContain('type: "eywa-open-window"');
  });

  it("🔴 문서의 강사 게이트는 원생 상세와 **같은 함수**다 — 갈리면 진도 표에선 보이는 보고서가 404가 된다", () => {
    expect(print).toContain("canViewStudentDetail(report.student_id)");
    expect(print).not.toContain("getTeacherScope(");
  });
});
