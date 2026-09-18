import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * LAB '따로 수업(*LAB)' 배정(0271b)의 배선 가드 — 배정은 교시 선택의 **기본값**이라, 선택을 얹는 모든 자리가
 * 같은 재료(`defaultSlotsByCell`)를 넘겨야 화면과 서버 쓰기 게이트가 같은 명단을 본다.
 * 🔴 한 곳만 빠지면 화면엔 학생이 두 교시 모두에 서는데 서버가 한 교시만 받아, 누르는 순간 "명단에 없는 학생"으로
 *    거절된다(적대 리뷰 2026-09-18 — PIN 랩실 '전체' 보기가 실제로 빠져 있었다).
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

describe("LAB '따로 수업(*LAB)' 배정 배선", () => {
  it("서버 한 벌(applySeatDayChoices)이 배정을 넘긴다", () => {
    expect(read("src/features/attendance/seat/server/period-choice.ts")).toMatch(
      /defaultSlotsByCell:\s*day\.defaultSlotsByCell/,
    );
  });

  it("🔴 '전체' 보기에 하루치 재료(choiceDay)를 넘기는 모든 화면이 배정도 함께 넘긴다", () => {
    const sites = walk("src/app").filter((f) => read(f).includes("choiceDay={{"));
    expect(sites.length).toBeGreaterThan(0);
    for (const f of sites) {
      const src = read(f);
      const block = src.slice(src.indexOf("choiceDay={{"), src.indexOf("}}", src.indexOf("choiceDay={{")));
      expect(block, f).toContain("defaultSlotsByCell");
    }
  });

  it("클라 '전체' 보기가 같은 순수 함수에 배정을 넘긴다", () => {
    expect(read("src/app/(shell)/attendance/seat/[seat]/_components/seat-all-day.tsx")).toMatch(
      /defaultSlotsByCell:\s*choiceDay\.defaultSlotsByCell/,
    );
  });
});
