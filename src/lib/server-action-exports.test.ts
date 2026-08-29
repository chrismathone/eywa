/**
 * **`"use server"` 파일은 async 함수만 export할 수 있다** — 어기면 프로덕션 빌드가 깨진다.
 *
 * 2026-08-29 실측: 공용 헬퍼를 쓰려고 `server/actions.ts`(맨 위 `"use server"`)의 동기 함수
 * `toKoreanDbError`에 `export`를 붙였더니 **Vercel 배포가 실패**했다. 그런데
 * `tsc --noEmit`·`eslint`·`vitest` **전부 통과**한다 — 빌드만 잡는 조용한 함정이다([[#61]] 계열).
 *
 * 그래서 여기서 잠근다: `"use server"` 파일의 값(value) export는 전부 `async`여야 한다.
 * 공유용 동기 헬퍼는 서버 액션 파일 밖의 평범한 모듈로 뺄 것(예: `features/enrollments/db-errors.ts`).
 *
 * ⚠️ 타입 export(`export type`·`export interface`)는 컴파일에서 지워지므로 대상이 아니다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** ⚠️ dirent로 순회한다 — 엔트리마다 statSync를 부르면 src 전체 스캔이 느려 타임아웃에 걸린다. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) sourceFiles(join(dir, entry.name), out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
      out.push(join(dir, entry.name));
  }
  return out;
}

const SRC = join(process.cwd(), "src");

/** 파일 맨 앞(주석·빈 줄 제외)이 `"use server"`인가. */
function isServerActionFile(src: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*["']use server["']/.test(src);
}

describe('"use server" 파일의 export 규약', () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const src = readFileSync(file, "utf8");
    if (!isServerActionFile(src)) continue;
    const rel = file.slice(process.cwd().length + 1).replace(/\\/g, "/");

    // 값 export만 본다. `export type`/`export interface`/`export {…}`(재export)는 제외.
    for (const m of src.matchAll(/^export\s+(?!type\b|interface\b|\{)(.+)$/gm)) {
      const decl = m[1]!.trim();
      if (/^async\s+function\b/.test(decl)) continue;
      // `export const x = async (…)` 형태도 허용(액션을 화살표로 쓰는 경우).
      if (/^(const|let|var)\s+\w+\s*(:[^=]+)?=\s*async\b/.test(decl)) continue;
      offenders.push(`${rel} → export ${decl.slice(0, 72)}`);
    }
  }

  it("동기 값을 export하지 않는다(빌드가 깨진다)", () => {
    expect(
      offenders,
      "`\"use server\"` 파일은 async 함수만 export할 수 있습니다.\n" +
        "공유용 동기 헬퍼는 서버 액션 파일 밖 일반 모듈로 옮기세요(예: features/enrollments/db-errors.ts).\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});
