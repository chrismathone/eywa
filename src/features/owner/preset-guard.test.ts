/**
 * 프리셋·학교 별칭 **배선 가드**(소스 스캔) — 원장 2026-09-22 방향 B.
 *
 *   ① 프리셋 값(`.preset`)을 읽는 곳은 preset.ts·lesson-profile.ts뿐 — 화면·서버 코드는 `isGenericTenant`·
 *      `lessonProfileOf`·모듈 판정만 본다. "if 침산" 분기가 화면마다 번지면 두 경로를 영영 못 합친다.
 *      (예외: 저장 경로가 preset을 **쓰는** 한 줄 — saveOwnerSection.)
 *   ② 저장 행에서 프리셋을 판정하는 `presetOfStored`는 해석(resolve)·저장(saveOwnerSection)만 부른다.
 *   ③ 학교명 저장 정규화(`canonicalSchoolName`)는 앱 코드에서 **두 번째 인자(학원 별칭)를 반드시** 넘긴다 —
 *      빼먹으면 새 학원 학교명에 침산의 `일중 → 대구일중`이 붙는다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
/** 주석을 걷어 낸 코드 — 설명 문장에 같은 낱말이 있어도 걸리지 않게. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const FILES = walk(SRC).map((abs) => ({ rel: relative(SRC, abs).split(sep).join("/"), body: code(readFileSync(abs, "utf8")) }));

describe("프리셋 읽기 = 단일 소스", () => {
  it("`.preset`을 읽는 파일은 허용 목록뿐", () => {
    const ALLOWED = new Set([
      "features/owner/preset.ts",
      "features/owner/lesson-profile.ts",
      // 저장 경로: 새 학원 행에 preset을 **쓴다**(읽지 않는다).
      "features/owner/server/actions.ts",
    ]);
    const hits = FILES.filter((f) => /\.preset\b/.test(f.body) && !ALLOWED.has(f.rel)).map((f) => f.rel);
    expect(hits, "프리셋은 isGenericTenant / lessonProfileOf / 모듈 판정으로 읽을 것").toEqual([]);
  });

  it("saveOwnerSection의 한 줄은 쓰기뿐이다", () => {
    const actions = FILES.find((f) => f.rel === "features/owner/server/actions.ts")!.body;
    const lines = actions.split("\n").filter((l) => /\.preset\b/.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/nextData\.preset = "generic"/);
  });

  it("presetOfStored는 해석·저장·판정 파일만 부른다", () => {
    const ALLOWED = new Set(["features/owner/preset.ts", "features/owner/resolve.ts", "features/owner/server/actions.ts"]);
    const hits = FILES.filter((f) => /\bpresetOfStored\(/.test(f.body) && !ALLOWED.has(f.rel)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });
});

describe("학교명 저장 정규화 = 학원 별칭을 넘긴다", () => {
  it("canonicalSchoolName 호출은 두 번째 인자를 가진다", () => {
    const missing: string[] = [];
    for (const f of FILES) {
      if (f.rel === "features/schools/school-name.ts") continue; // 정의 파일
      const re = /\bcanonicalSchoolName\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.body))) {
        // 짝 괄호까지 읽어 최상위 쉼표가 있는지 본다.
        let depth = 0;
        let hasComma = false;
        for (let i = m.index + m[0].length - 1; i < f.body.length; i++) {
          const ch = f.body[i];
          if (ch === "(" || ch === "[" || ch === "{") depth++;
          else if (ch === ")" || ch === "]" || ch === "}") {
            depth--;
            if (depth === 0) break;
          } else if (ch === "," && depth === 1) hasComma = true;
        }
        if (!hasComma) missing.push(`${f.rel}:${f.body.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(missing, "settings.operations.schoolSaveAliases를 넘길 것").toEqual([]);
  });

  it("저장 경로 여덟 곳이 전부 정규화를 지난다(하나가 빠지면 그 경로만 별칭이 안 붙는다)", () => {
    const calls = FILES.filter((f) => f.rel !== "features/schools/school-name.ts").reduce(
      (n, f) => n + (f.body.match(/\bcanonicalSchoolName\(/g)?.length ?? 0),
      0,
    );
    expect(calls).toBeGreaterThanOrEqual(8);
  });
});
