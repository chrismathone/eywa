/**
 * 출결의 **읽기 축 ⊆ 쓰기 게이트** — 구조 가드.
 *
 * 🔴 2026-08-18 적대적 리뷰에서 잡은 것: 출석부의 읽기 축을 담임 → (담임 ∪ 교시 담당)으로 넓히면서
 *    쓰기 게이트는 담임 ∪ 위임(`getTeachingClassIds`) 그대로였다. 그러면 슬롯 담당 강사에게 반이
 *    **보이는데 저장은 막힌다**(실측: Florence Park = teacher·슬롯 9개·담임 0개).
 *    화면과 서버가 다른 말을 하는 건 #77이 금지하는 바로 그 모양이다.
 *
 * 그래서 출결 쓰기 액션의 담당 반 판정은 **교시 담당까지 포함하는 `userTaughtClassSet` 하나**만 쓴다.
 * ⚠️ 이 파일이 깨지면 테스트를 고치기 전에 "왜 축이 갈라졌는지"를 먼저 설명할 것.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const actions = readFileSync(
  join(process.cwd(), "src", "features", "attendance", "server", "actions.ts"),
  "utf8",
);

describe("출결 쓰기 게이트의 담당 반 축", () => {
  it("담임 ∪ 위임만 보는 getTeachingClassIds를 쓰지 않는다", () => {
    expect(actions).not.toContain("getTeachingClassIds");
  });

  it("모든 scoped 게이트가 userTaughtClassSet(담임 ∪ 위임 ∪ 교시 담당)을 쓴다", () => {
    const gateCount = (actions.match(/userTaughtClassSet\(/g) ?? []).length;
    // 저장폼·셀·보강연결·일괄·범위·보강학생검색 = 6곳
    expect(gateCount).toBeGreaterThanOrEqual(6);
  });

  it("'담당 반이 아닙니다' 거절은 그 집합으로만 판정한다", () => {
    // ⚠️ 주석에도 같은 문구가 있다 — **실제 거절문**(return)만 본다.
    const rejects = [...actions.matchAll(/return { error: "담당 반이 아닙니다" }/g)];
    expect(rejects.length).toBeGreaterThanOrEqual(3);
    for (const m of rejects) {
      const before = actions.slice(Math.max(0, m.index! - 400), m.index!);
      expect(before).toMatch(/userTaughtClassSet|myClassIds|teaching/);
    }
  });
});

describe("읽기 축(teacher-axis)도 교시 담당을 포함한다", () => {
  const axis = readFileSync(join(process.cwd(), "src", "features", "attendance", "teacher-axis.ts"), "utf8");
  it("슬롯 담당을 먼저 보고 담임으로 떨어진다", () => {
    expect(axis).toContain("slot");
    expect(axis).toContain("homeroom");
  });
});

/**
 * 🔴 **화면의 미리-잠금도 같은 축이어야 한다** (2026-08-19).
 *
 * ECS(영어 강사 시트)는 출결 컨트롤을 서버 액션에 물어보기 전에 미리 잠근다 — "눌리는데 매번 거절"을
 * 막으려는 거울이다. 그런데 2026-08-18에 액션 쪽만 교시 담당까지 넓히고 이 거울은 옛 축
 * (`getTeachingClassIds` = 담임 ∪ 위임)에 남아, **서버는 허락하는데 화면이 막는 거짓 잠금**이 됐다
 * (실측: 활성 영어 반 기준 교시 담당만 맡은 반 — 이현이 9 · KRISTINE DRIVER 8 · Florence Park 5/5).
 * 원장 확인 2026-08-19: *"'오늘'에 나온 본인 수업은 전부 출결 가능해야 한다"*.
 *
 * ⚠️ 이 파일이 깨지면 테스트를 고치기 전에 "왜 거울이 액션과 달라졌는지"를 먼저 설명할 것.
 */
describe("ECS 화면의 출결 미리-잠금은 액션과 같은 축", () => {
  const mirrors = [
    ["오늘 면", join(process.cwd(), "src", "features", "class-sheets", "server", "today.ts")],
    ["주간 시트", join(process.cwd(), "src", "features", "class-sheets", "server", "queries.ts")],
  ] as const;

  for (const [label, file] of mirrors) {
    it(`${label}은 userTaughtClassSet(담임 ∪ 위임 ∪ 교시 담당)으로 잠근다`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("userTaughtClassSet");
      // 주석에도 옛 이름이 나오므로 **import 줄**만 본다(설명 문장이 위반으로 걸리지 않게).
      const importsOldAxis = src
        .split(/\r?\n/)
        .some((line) => line.startsWith("import") && line.includes("getTeachingClassIds"));
      expect(importsOldAxis, `${label}이 좁은 축으로 되돌아갔다`).toBe(false);
    });
  }
});
