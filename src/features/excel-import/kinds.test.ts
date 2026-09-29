import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IMPORT_KINDS, IMPORT_META } from "./kinds";

/**
 * 가드 — 가져오기 한 벌을 더하면 **세 곳**이 함께 움직여야 한다(kinds.ts 머리주석):
 * ① 이름표(IMPORT_META) ② 레지스트리 + importers/<kind>.ts ③ 그 탭 화면의 버튼.
 * 하나만 빠지면 "학원 설정 허브엔 있는데 탭엔 없음"·"버튼은 있는데 404"가 된다.
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("엑셀 가져오기 배선", () => {
  it("모든 종류에 이름표·레지스트리·가져오기 파일이 있다", () => {
    const registry = read("src/features/excel-import/server/registry.ts");
    for (const k of IMPORT_KINDS) {
      expect(IMPORT_META[k], k).toBeTruthy();
      expect(registry, k).toContain(`import("../importers/${k}")`);
      expect(existsSync(join(ROOT, "src/features/excel-import/importers", `${k}.ts`)), k).toBe(true);
    }
  });

  it("모든 종류가 제 탭 화면에 버튼으로 선다(학원 설정 허브 말고도)", () => {
    const files = walk(join(ROOT, "src", "app")).filter((f) => !f.includes("import-hub-face"));
    const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const k of IMPORT_KINDS) {
      const wired = src.includes(`kind="${k}"`) || src.includes(`kind: "${k}"`) || src.includes(`importKind="${k}"`) || new RegExp(`importKind=\{[^}]*"${k}"`).test(src);
      expect(wired, `${k} 버튼이 어느 탭에도 없다`).toBe(true);
    }
  });

  it("올리기 주소는 전체 권한(canManageTenant) 한 곳을 지난다", () => {
    const run = read("src/features/excel-import/server/run.ts");
    expect(run).toContain("canManageTenant(user.systemRole, def.menu)");
    const route = read("src/app/api/excel-import/[kind]/route.ts");
    expect(route).toContain("gateImport(def)");
    expect(route).toContain("runImport(def, fd)");
  });
});
