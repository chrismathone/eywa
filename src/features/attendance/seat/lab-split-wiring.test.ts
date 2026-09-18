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

  it("🔴 자리를 가르는 세 표면이 **같은 판정 함수**를 쓴다(원장 2026-09-18 *\"모든 곳에 배선\"*)", () => {
    // 자리 출석부 · 시간표 격자 명단 · 원생 주간 시간표. 한 곳이라도 제 규칙을 새로 적으면
    // "출석부엔 있는데 시간표엔 없다"가 된다(같은 아이가 화면마다 다른 교시에 선다).
    for (const f of [
      "src/features/attendance/seat/lab-split.ts",
      "src/features/timetable/lib/lab-separate.ts",
      "src/features/students/lib/class-slots.ts",
    ]) {
      expect(read(f), f).toContain("labSplitSlotShows");
    }
    // 원생 주간 시간표 = 격자·텍스트 요약이 **같은 행 목록**을 쓴다(한쪽만 가르면 두 표기가 갈린다).
    const q = read("src/features/students/server/queries.ts");
    expect(q).toContain("filterLabSeparateRows(");
    expect(q).toContain("getStudentLabSeparateEnrollmentIds");
    // 🔴 재료를 모르면 안 가른다 — 조회 실패가 수업을 지우는 쪽으로 틀리지 않게.
    expect(q).toMatch(/labSlotIds && labFlaggedEnrollments \? .*: null/);
  });
});
