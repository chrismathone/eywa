// public/icons의 파일 목록을 MENU_GLYPH_NAMES에 그대로 박는다(가드가 둘을 대조한다).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const repo = process.argv[2];
const names = readdirSync(join(repo, "public", "icons"))
  .filter((f) => f.endsWith(".png"))
  .map((f) => f.replace(/\.png$/, ""))
  .sort();
const p = join(repo, "src", "components", "icons", "menu-glyph.tsx");
const src = readFileSync(p, "utf8");
const lines = [];
for (let i = 0; i < names.length; i += 6) lines.push("  " + names.slice(i, i + 6).map((n) => `"${n}"`).join(", ") + ",");
const next = src.replace(
  /export const MENU_GLYPH_NAMES = new Set<string>\(\[[\s\S]*?\]\);/,
  `export const MENU_GLYPH_NAMES = new Set<string>([\n${lines.join("\n")}\n]);`,
);
if (next === src) throw new Error("MENU_GLYPH_NAMES 블록을 못 찾았다");
writeFileSync(p, next);
console.log(`${names.length}장 배선`);
