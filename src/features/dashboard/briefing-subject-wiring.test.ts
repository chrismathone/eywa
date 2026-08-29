/**
 * **과목 라벨은 부가 정보다 — 본체(브리핑)를 죽이면 안 된다.**
 *
 * 2026-08-29 리뷰에서 잡힌 것: 과목 분해가 쓰는 `getAbsenceRiskAnchor`가 `throw`하는데 브리핑의
 * `Promise.all` 안에 그대로 들어가 있었다. `Promise.all`은 하나만 깨져도 reject하므로, 그 조회 한 번이
 * 실패하면 **그날 브리핑이 통째로 안 만들어진다** — 라벨 하나 때문에.
 * 같은 배치의 `getAbsenceRiskStudents`는 명단 그 자체라 throw가 맞지만, 앵커는 그 급이 아니다.
 *
 * 그리고 화면에 붙는 숫자는 **RPC 총계와 합이 같을 때만** 내보낸다(groundedSubjects) — 나란히 놓인
 * "8회"와 "수학 6 · 영어 1" 중 뭐가 거짓인지 화면만 봐선 알 수 없기 때문이다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const briefing = strip(read("src", "features", "dashboard", "server", "briefing.ts"));
const digest = strip(read("src", "features", "dashboard", "briefing-digest.ts"));

describe("부가 조회가 브리핑을 죽이지 않는다", () => {
  it("앵커 조회는 fail-soft다(Promise.all 안에서 throw 금지)", () => {
    expect(briefing).toMatch(/getAbsenceRiskAnchor\(db\)\.catch\(/);
  });

  it("분해 조회도 fail-soft다", () => {
    expect(briefing).toMatch(/getAbsenceSubjectBreakdown\([\s\S]{0,200}\)\.catch\(/);
  });

  it("실패를 조용히 삼키지 않고 알린다", () => {
    expect(briefing).toContain("briefing.absenceAnchor");
    expect(briefing).toContain("briefing.absenceSubjects");
  });
});

describe("과목 수치는 총계와 합이 같을 때만 내보낸다", () => {
  it("groundedSubjects가 합을 검산한다", () => {
    expect(digest).toMatch(/sum === risk\.absences \? buckets : \[\]/);
  });

  it("라벨 리졸버가 없으면 분해를 생략한다(raw 과목 키 노출 금지)", () => {
    // labelSubjectCounts가 리졸버 없으면 []를 돌려준다 — 화면에 `english`가 그대로 나가지 않게.
    const todayActions = strip(read("src", "features", "dashboard", "today-actions.ts"));
    expect(todayActions).toMatch(/if \(!subjectLabel \|\| rows\.length === 0\) return \[\]/);
  });
});

describe("옛 payload 하위 호환", () => {
  it("bySubject가 없던 저장분을 읽어도 깨지지 않는다", () => {
    // 스포트라이트 payload는 스냅샷이라 2026-08-29 이전 행엔 이 키가 아예 없다.
    for (const src of [
      strip(read("src", "features", "dashboard", "briefing-team-report.ts")),
      strip(read("src", "app", "(shell)", "dashboard", "_components", "daily-briefing-card.tsx")),
    ]) {
      expect(src).toMatch(/bySubject \?\? \[\]/);
    }
    expect(digest).toMatch(/spotlight\.bySubject \?\? \[\]/);
  });
});
