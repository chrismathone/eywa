/**
 * 로컬 게이트(`verify-changed.mjs`)의 역의존 찾기 — 바뀐 TS 파일을 import하는 파일.
 *
 * 바뀐 파일만 타입 검사하면 그 파일을 쓰는 쪽의 깨짐(시그니처·interface·추론된 반환 타입 변경)을 못 본다. `export`가 적힌 줄이
 * 바뀌었는지로 거르면 여러 줄 시그니처의 매개변수 줄 변경이 빠진다(재리뷰 2026-11-09 재현) — 바뀐 TS 파일은 **전부** 대상이다.
 * import 문자열로 찾는다(`@/x/y` 별칭 · `./y` · `../x/y` · `export * from`). 찾은 파일이 **재수출**(`export … from`)하면
 * 그 파일을 쓰는 쪽까지 한 단계 더 따라간다(index.ts 재수출을 거친 2차 소비자).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
// 🔴 경로는 전부 git 표기(`src/a/b.ts` — `/`)다 — `path.posix`로만 다룬다. 윈도의 `path.join`은 `\`를 돌려줘 `resolved === stem`이
//    늘 어긋나고, 상대 import 소비자가 통째로 빠졌다(역의존 0개 · 2026-11-13 Codex 재현 — 타입 검사가 소비자를 안 봤다).
import { posix as path } from "node:path";

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const grep = (pattern) => spawnSync("git", ["-c", "core.quotePath=false", "grep", "-l", "-E", pattern, "--", "*.ts", "*.tsx", "*.mts"], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout ?? "";

function directImporters(file) {
  const noExt = file.replace(/\.(m)?tsx?$/, "");
  const stem = path.basename(noExt) === "index" ? path.dirname(noExt) : noExt;
  const tail = path.basename(stem);
  // 같은 이름의 다른 파일이 많다(actions·queries) — 별칭이면 경로 끝 두 조각이 맞는 것, 상대 경로면 실제로 그 파일로 풀리는 것만.
  const aliasTail = stem.replace(/^src\//, "").split("/").slice(-2).join("/");
  // `"…/x"` · `"…/x.js"` · `"…/x/index"` — `"."`·`".."`처럼 폴더 이름이 안 적힌 import는 못 찾는다(드물다 · 알려진 한계).
  return lines(grep(`["'][^"']*/${escRe(tail)}(\\.(m|c)?(t|j)sx?)?(/index)?["']`)).filter((h) => {
    if (h === file || path.basename(h).startsWith("._") || !existsSync(h)) return false;
    const src = readFileSync(h, "utf8");
    if (src.includes(aliasTail)) return true;
    // 상대 경로: `./x` · `./x.js` · `./x/index` · `..` 모두 같은 파일로 푼다.
    for (const m of src.matchAll(/["'](\.{1,2}(?:\/[^"']*)?)["']/g)) {
      const resolved = path.join(path.dirname(h), m[1]).replace(/\.(m|c)?(t|j)sx?$/, "").replace(/\/index$/, "");
      if (resolved === stem) return true;
    }
    return false;
  });
}

const REEXPORT = /^\s*export\s+(?:\*|\{[^}]*\}|type\s+\{[^}]*\})\s+from\s+["']/m;

/** @param {string[]} files 바뀐(또는 사라진) TS 파일 @returns {Set<string>} 그 파일들을 쓰는 파일(재수출 한 단계 포함) */
export function reverseDependents(files) {
  const out = new Set();
  const queue = files.map((f) => ({ f, depth: 0 }));
  const seen = new Set(files);
  while (queue.length) {
    const { f, depth } = queue.shift();
    for (const h of directImporters(f)) {
      out.add(h);
      if (depth === 0 && !seen.has(h) && REEXPORT.test(readFileSync(h, "utf8"))) {
        seen.add(h);
        queue.push({ f: h, depth: 1 });
      }
    }
  }
  for (const f of files) out.delete(f);
  return out;
}
