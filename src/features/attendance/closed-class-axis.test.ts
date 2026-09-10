import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * **종강한 반은 그 뒤 기간의 출석부에 서지 않는다.**
 *
 * 원장 제보 2026-09-10: *"0명인 학생 반은 왜 뜨는거야? 수업도 종강처리 된거같은데"* —
 * `[특강] 고등개별`·`[특강]중2-2 문제 풀이반`이 **8/27 종강**인데 9월 출석부에 `0명 시수 0`으로 서 있었다.
 *
 * 🔴 원인: `closed_at`을 찍어도 `is_active`는 true로 남는다. 일별 출결(`getAttendanceForDate`)은
 *    `closed_at >= date`로 걸렀는데 **반 축(`loadClassAxisRows`)만 그 판정이 빠져** 있었다.
 * ⚠️ 그 반이 실제로 돌던 달에는 그대로 보여야 한다(지난 달 출석부는 기록이다) — 그래서 조건은
 *    "종강일이 조회 구간 시작보다 앞설 때"만 빼는 것이다.
 */
describe("출석부 반 축 — 종강 반 제외", () => {
  const src = readFileSync(
    join(process.cwd(), "src/features/attendance/server/teacher-axis-queries.ts"),
    "utf8",
  );

  it("closed_at을 실제로 조회한다 — 안 받아오면 거를 수가 없다", () => {
    expect(src).toContain("closed_at,");
    expect(src).toContain("closed_at: string | null;");
  });

  it("🔴 구간 시작 기준으로 거른다 — 지난 달 기록까지 감추면 안 된다", () => {
    expect(src).toContain("!c.closed_at || c.closed_at >= from");
  });

  it("거른 목록을 실제로 쓴다 — 만들어 놓고 원본을 매핑하면 아무 일도 안 일어난다", () => {
    expect(src).toContain("liveRows.map((c) =>");
    expect(src).not.toContain("return classRows.map((c) =>");
  });

  it("일별 출결과 같은 규약을 쓴다(두 곳이 갈리면 화면마다 다른 반이 뜬다)", () => {
    const daily = readFileSync(join(process.cwd(), "src/features/attendance/server/queries.ts"), "utf8");
    expect(daily).toContain("closed_at || klass.closed_at >= date");
  });
});
