import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MANUALS } from "./manuals";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, "src", p), "utf8");

describe("F1 겹침 배선", () => {
  it("셸 세 경로(창·미니셸·풀셸)에 ScreenHelpOverlay 가 있다", () => {
    const layout = read("app/(shell)/layout.tsx");
    const n = layout.split("<ScreenHelpOverlay").length - 1;
    expect(n).toBe(3);
    expect(layout).toContain("<ScreenHelpOverlay beneathWindows");
  });

  it("창 크롬에서 F1 이면 그 창 iframe 으로 넘긴다", () => {
    const overlay = read("components/help/screen-help-overlay.tsx");
    expect(overlay).toContain("eywa-help-toggle");
    expect(overlay).toContain("iframeRegistry");
    expect(read("components/workspace/floating-window.tsx")).toContain("data-window-id");
  });

  it("브라우저 기본 F1 을 preventDefault 한다", () => {
    expect(read("features/help/overlay-hotkey.ts")).toContain('e.key === "F1"');
    expect(read("components/help/screen-help-overlay.tsx")).toContain("preventDefault");
  });

  it("시간표 data-help 키는 manuals/timetable callouts 에 있다", () => {
    const keys = new Set(
      MANUALS.find((m) => m.slug === "timetable")?.callouts.map((c) => c.key).filter(Boolean),
    );
    const src = [
      read("app/(shell)/timetable/page.tsx"),
      read("app/(shell)/timetable/_components/week-nav.tsx"),
      read("app/(shell)/timetable/_components/class-cell.tsx"),
      read("app/(shell)/timetable/_components/reserved-section.tsx"),
      read("app/(shell)/timetable/_components/teacher-head-cell.tsx"),
      read("app/(shell)/timetable/_components/weekday-group-tables.tsx"),
    ].join("\n");
    const used = [...src.matchAll(/data-help="([^"]+)"/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(8);
    for (const k of used) {
      expect(keys.has(k), `시간표에 없는 키 ${k}`).toBe(true);
    }
  });

  it("화면에 붙인 data-help 는 그 화면 manuals 키다", () => {
    const files: { file: string; slug: string }[] = [
      { file: "app/(shell)/attendance/page.tsx", slug: "attendance" },
      { file: "app/(shell)/attendance/_components/matrix-table.tsx", slug: "attendance" },
      { file: "app/(shell)/students/page.tsx", slug: "students" },
      { file: "features/onescreen/components/top-bar.tsx", slug: "onescreen" },
      { file: "app/(shell)/help/page.tsx", slug: "help" },
      { file: "app/(shell)/help/_help-browser.tsx", slug: "help" },
    ];
    for (const { file, slug } of files) {
      const keys = new Set(
        MANUALS.find((m) => m.slug === slug)?.callouts.map((c) => c.key).filter(Boolean),
      );
      const used = [
        ...read(file).matchAll(/data-help="([^"]+)"/g),
        ...read(file).matchAll(/helpKey="([^"]+)"/g),
        ...read(file).matchAll(/helpAttr\("([^"]+)"\)/g),
      ].map((m) => m[1]!);
      expect(used.length, file).toBeGreaterThan(0);
      for (const k of used) {
        expect(keys.has(k), `${file} 키 ${k} 는 ${slug} manuals 에 없음`).toBe(true);
      }
    }
  });

  it("강사뷰 영어 화면은 이번엔 한국어 그대로라는 한계를 적는다", () => {
    expect(read("components/help/screen-help-overlay.tsx")).toContain("teacher_view_lang");
  });

  // 운영실 KPI 띠(옛 kpi-strip)의 F1 키 가드는 옛 운영실 화면과 함께 걷었다(2026-11-10 P3-D) — 새 대시보드엔 F1 표식이 아직 없다(11-09부터).

  it("모델 A: 캡션 껍데기·모달·알약은 measure 를 다시 안 부른다", () => {
    const overlay = read("components/help/screen-help-overlay.tsx");
    const caption = read("components/help/help-caption.tsx");
    const pills = read("components/help/help-pills.tsx");
    expect(overlay).toContain("aria-modal");
    expect(caption).toContain("HOVER_CARD_SHELL");
    expect(caption).toContain("pointer-events-auto");
    expect(caption).toContain("overflow-y-auto");
    expect(caption).not.toMatch(/line-clamp/);
    expect(caption).not.toMatch(/overflow-hidden/);
    expect(pills).toContain("onMouseEnter");
    expect(pills).not.toContain("measure");
    expect(read("components/help/help-overlay.module.css")).toContain("prefers-reduced-motion");
    expect(existsSync(join(root, "src/features/help/overlay-balloon.ts"))).toBe(false);
  });

  it("구 balloon export·p.balloon 접근이 help 소스에 없다", () => {
    expect(forbiddenBalloonHits()).toEqual([]);
  });
});

const FORBIDDEN_FN = new Set(["placeOverlay", "balloonHeight", "noBalloonOverlap"]);

function forbiddenBalloonHits(): string[] {
  const hits: string[] = [];
  for (const file of helpSrcFiles()) {
    const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name && hasExportMod(node) && FORBIDDEN_FN.has(node.name.text)) {
        hits.push(`${rel(file)} export function ${node.name.text}`);
      }
      if (ts.isTypeAliasDeclaration(node) && hasExportMod(node) && node.name.text === "PlacedCallout") {
        hits.push(`${rel(file)} export type PlacedCallout`);
      }
      if (ts.isVariableStatement(node) && hasExportMod(node)) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === "BALLOON_W") {
            hits.push(`${rel(file)} export const BALLOON_W`);
          }
        }
      }
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          if ((el.propertyName ?? el.name).text === "placeOverlay") {
            hits.push(`${rel(file)} export { placeOverlay`);
          }
        }
      }
      if (ts.isPropertyAccessExpression(node) && node.name.text === "balloon") {
        const expr = node.expression.getText(source);
        if (expr === "p" || expr === "PlacedCallout") hits.push(`${rel(file)} ${expr}.balloon`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return hits;
}

function hasExportMod(node: ts.Node): boolean {
  return ((node as ts.FunctionDeclaration).modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function helpSrcFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "manuals" || e.name === "board") continue;
        walk(p);
      } else if (/\.[cm]?[jt]sx?$/.test(e.name) && !/\.test\./.test(e.name)) {
        out.push(p);
      }
    }
  };
  walk(join(root, "src/features/help"));
  walk(join(root, "src/components/help"));
  return out;
}

function rel(file: string): string {
  return file.slice(root.length + 1).replaceAll("\\", "/");
}
