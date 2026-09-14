import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { EYWA_ICON_COMPAT_MAP } from "./eywa-icon-compat";
import { EYWA_ICON_CATALOG, MENU_ICON } from "./eywa-icons";

const COMPAT_MODULE = "@/components/icons/eywa-icon-compat";
const FORBIDDEN_NATURE_ICONS = new Set([
  "tree",
  "leaf",
  "pulse",
  "branch",
  "seed",
  "sprout",
  "wave",
  "falling",
  "roots",
  "pollen",
  "rings",
  "spore",
]);
const LEGACY_VISIBLE_GLYPHS = [
  "⚠️",
  "⚠",
  "☑",
  "☐",
  "✅",
  "❌",
  "✓",
  "✔",
  "✕",
  "✖",
  "▲",
  "▼",
  "📈",
  "📋",
  "💬",
  "📌",
  "🎤",
  "💡",
  "🌱",
  "🌿",
  "🍃",
  "🌳",
] as const;
const APPROVED_INLINE_SVG = [
  // signature.tsx는 2026-07-19 랜딩 리디자인(운영 콘솔)에서 인라인 SVG 분기선이 제거되어 목록에서 빠짐.
  "src/app/(marketing)/_ui/mock-workspace.tsx",
  "src/app/(shell)/dashboard/_components/sparkline.tsx",
  "src/features/onescreen/components/report-trend-graph.tsx",
  // 2026-09-11 인재원 학습분석지(wide)의 시험 점수 추이 선 — 차트(report-trend-graph와 같은 성격).
  "src/features/ijw/components/jj-study-parts.tsx",
  // 2026-09-11 운영실 강의실 보기의 2D 평면도(층·복도·강의실 사각형, aria-hidden) — 도면이지 아이콘이 아니다.
  "src/app/(shell)/dashboard/_classrooms/classroom-map.tsx",
  // 2026-09-10~11 운영실 현황 차트(도넛·막대·등원율 선, role="img"+aria-label) — 차트(sparkline과 같은 성격).
  "src/app/(shell)/dashboard/_overview/charts.tsx",
  // 2026-09-14 수학 학습 진도맵의 동심원 지도(분기·연·월·주·일 링 + 가운데, role="group"+aria-label) — 차트이지 아이콘이 아니다.
  "src/features/math-progress-map/components/progress-map.tsx",
] as const;

// 이 파일의 검사 3개가 각각 src/ 전체를 훑는다 — 디렉터리 워크는 파일 목록이 같으므로 한 번만 한다
// (전 스위트 병렬 실행에서 이 파일이 타임아웃으로 빨개졌다. 진짜 비용은 아래 ts.createSourceFile이지만
//  워크를 3번 반복할 이유는 없다.)
const sourceFilesCache = new Map<string, string[]>();

function sourceFiles(directory: string): string[] {
  const cached = sourceFilesCache.get(directory);
  if (cached) return cached;

  const result: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...sourceFiles(entryPath));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      result.push(entryPath);
    }
  }

  sourceFilesCache.set(directory, result);
  return result;
}

function importedCompatIcons(): Set<string> {
  const imported = new Set<string>();

  for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        statement.moduleSpecifier.text !== COMPAT_MODULE
      ) {
        continue;
      }

      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;

      for (const element of bindings.elements) {
        const importedName = (element.propertyName ?? element.name).text;
        if (importedName !== "LucideIcon") imported.add(importedName);
      }
    }
  }

  return imported;
}

function filesImporting(moduleName: string): string[] {
  const importers: string[] = [];

  for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const importsModule = source.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text === moduleName,
    );

    if (importsModule) importers.push(path.relative(process.cwd(), file));
  }

  return importers;
}

function visibleLegacyIconGlyphs(): string[] {
  const hits: string[] = [];

  for (const file of sourceFiles(path.join(process.cwd(), "src")).filter((name) => name.endsWith(".tsx"))) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const value = ts.isJsxText(node) ? node.getText(source) : node.text;
        const glyph = LEGACY_VISIBLE_GLYPHS.find((candidate) => value.includes(candidate));
        if (glyph) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          hits.push(`${path.relative(process.cwd(), file)}:${line + 1} ${glyph}`);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return hits;
}

function inlineSvgFiles(): string[] {
  return sourceFiles(path.join(process.cwd(), "src"))
    .filter((file) => file.endsWith(".tsx"))
    .filter((file) => path.basename(file) !== "eywa-icons.tsx")
    .filter((file) => fs.readFileSync(file, "utf8").includes("<svg"))
    .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"))
    .sort();
}

describe("Eywa icon compatibility mapping", () => {
  it(
    "maps every compatibility import exactly once without unused aliases",
    () => {
      const imported = importedCompatIcons();
      const mapped = new Set(Object.keys(EYWA_ICON_COMPAT_MAP));

      expect(mapped).toEqual(imported);
      // 절대 개수 트립와이어(위 toEqual과 별개로 대량 유실을 잡는다). 별칭을 의도적으로 늘리거나
      // 줄였을 때만 갱신할 것 — 143→142는 2026-07-29 `Lock` 제거분(소비처가 1beee908 '재인증 제거'에서 사라짐).
      // 142→141은 2026-09-03 `BarChart3` 제거분(등록상담 보기 토글이 아이콘 칩 3개 → 드롭다운 하나가 되며 소비처 0, 디자인 v5 §10).
      // 141→139는 2026-09-03 `BookPlus`·`MessageSquarePlus` 제거분(운영실 '빠른 작업'이 §10 "같은 동작 두 곳 금지"로 사라지며 소비처 0).
      expect(mapped.size).toBe(139);
    },
    // src/ 전건을 ts.createSourceFile로 파싱한다 — 단독 실행 14초라 15초는 여유가 없었고
    // 전 스위트 병렬(파일 증가 + CPU 경합)에서 실제로 터졌다. 파일 수는 계속 는다.
    60_000,
  );

  it("maps every compatibility name to a registered Eywa glyph", () => {
    const registered = new Set(EYWA_ICON_CATALOG.map((icon) => icon.name));

    for (const target of Object.values(EYWA_ICON_COMPAT_MAP)) {
      expect(registered.has(target)).toBe(true);
    }
  });

  it("does not register or map botanical metaphors", () => {
    const registered = EYWA_ICON_CATALOG.map((icon) => icon.name);
    const compatTargets = Object.values(EYWA_ICON_COMPAT_MAP);
    const menuTargets = Object.values(MENU_ICON);

    expect(registered.filter((name) => FORBIDDEN_NATURE_ICONS.has(name))).toEqual([]);
    expect(compatTargets.filter((name) => FORBIDDEN_NATURE_ICONS.has(name))).toEqual([]);
    expect(menuTargets.filter((name) => FORBIDDEN_NATURE_ICONS.has(name))).toEqual([]);
  });

  it(
    "has no visible emoji or text glyph standing in for an icon",
    () => {
      expect(visibleLegacyIconGlyphs()).toEqual([]);
    },
    60_000, // 위와 같은 전건 파싱 — 기본 5초로는 전 스위트 병렬에서 터진다
  );

  it("keeps inline SVG limited to reviewed charts and decoration", () => {
    expect(inlineSvgFiles()).toEqual([...APPROVED_INLINE_SVG].sort());
  });

  it(
    "has no direct external icon imports or package dependency",
    () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };

      expect(filesImporting("lucide-react")).toEqual([]);
      expect(packageJson.dependencies?.["lucide-react"]).toBeUndefined();
    },
    15_000,
  );
});
