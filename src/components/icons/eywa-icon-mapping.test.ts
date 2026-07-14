import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { EYWA_ICON_COMPAT_MAP } from "./eywa-icon-compat";
import { EYWA_ICON_CATALOG } from "./eywa-icons";

const COMPAT_MODULE = "@/components/icons/eywa-icon-compat";

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
