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
  "src/app/(shell)/help/_help-browser.tsx",
  "src/features/onescreen/components/report-trend-graph.tsx",
] as const;

function sourceFiles(directory: string): string[] {
  const result: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...sourceFiles(entryPath));
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      result.push(entryPath);
    }
  }

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
      expect(mapped.size).toBe(143);
    },
    15_000,
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

  it("has no visible emoji or text glyph standing in for an icon", () => {
    expect(visibleLegacyIconGlyphs()).toEqual([]);
  });

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
