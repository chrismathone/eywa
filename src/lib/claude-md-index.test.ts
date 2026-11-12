import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CLAUDE.md 색인 길이 가드 (2026-11-10, 코드 리뷰 F3).
 *
 * CLAUDE.md는 **매 세션 통째로 로드**된다 — 한 줄이 길어질수록 모든 세션의 토큰을 먹는다.
 * 그래서 CLAUDE.md 스스로 정한 규칙: '✅ 이미 내린 결정'과 '🧯 막힌 점 인덱스'는 **제목만 있는 색인**이고,
 * 본문(금지 조항·근거·실측·원장 말씀)은 `docs/decisions/<영역>.md` · `docs/gotchas.md`에 둔다.
 * 이 시험은 두 구역의 각 `- ` 줄이 400바이트(UTF-8)를 넘지 않는지 본다.
 * 넘치면 → 빠진 내용을 해당 docs 파일로 옮기고, CLAUDE.md에는 이름 + 핵심 🔴 한마디만 남길 것.
 */
const LIMIT = 400;

function sectionBullets(lines: string[], headingIncludes: string): string[] {
  const start = lines.findIndex((l) => l.startsWith("## ") && l.includes(headingIncludes));
  if (start < 0) throw new Error(`CLAUDE.md에서 '${headingIncludes}' 구역을 찾지 못했습니다`);
  const rel = lines.slice(start + 1).findIndex((l) => l.startsWith("## "));
  const end = rel < 0 ? lines.length : start + 1 + rel;
  return lines.slice(start + 1, end).filter((l) => l.startsWith("- "));
}

describe("CLAUDE.md 색인 = 한 줄 제목(≤400바이트)", () => {
  const lines = readFileSync(join(process.cwd(), "CLAUDE.md"), "utf8")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""));

  for (const [name, heading] of [
    ["이미 내린 결정", "✅ 이미 내린 결정"],
    ["막힌 점 인덱스", "🧯 막힌 점 인덱스"],
  ] as const) {
    it(`'${name}' 구역의 줄은 ${LIMIT}바이트 이하`, () => {
      const bullets = sectionBullets(lines, heading);
      expect(bullets.length).toBeGreaterThan(0);
      const offenders = bullets
        .map((l) => ({ bytes: Buffer.byteLength(l, "utf8"), head: l.slice(0, 60) }))
        .filter((x) => x.bytes > LIMIT)
        .map((x) => `${x.bytes}B  ${x.head}…`);
      expect(
        offenders,
        `본문은 docs/decisions·docs/gotchas.md로 옮기고 한 줄 제목만 남기세요:\n${offenders.join("\n")}`,
      ).toEqual([]);
    });
  }
});
