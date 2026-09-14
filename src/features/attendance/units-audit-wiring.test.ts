/**
 * 출결 감사로그 **"시수 3 → 1.5"**(원장 2026-09-14) — *배선* 가드.
 *
 * 값 규칙은 [`units-audit.test.ts`](./units-audit.test.ts)가 본다. 여기는 **"호출부가 잴 행을 제대로 고르는가"** 다 —
 * 두 번 연속 틀린 자리가 정확히 그 집합 선택이었기 때문이다(적대 리뷰·재리뷰 2026-09-14):
 *   · 1차 = 그날 칸의 합을 **행 값 그대로** 더해 결석을 1로 셌다.
 *   · 2차 = 교시 지정 저장에서 **대표 1행만** 세어 월간 격자의 절반을 적었다.
 * 순수 함수만 잠그면 같은 결함이 세 번째로 재발해도 게이트는 초록이다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");

/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** `export async function NAME(`부터 다음 export 선언 전까지. */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name}가 없다`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("출결 감사로그 시수 — 배선", () => {
  const actions = stripComments(read("features", "attendance", "server", "actions.ts"));

  it.each(["setAttendanceCell", "setAttendanceRange"])(
    "🔴 %s — 전·후 시수는 순수 함수 한 곳(unitsAuditFields)에서 나오고 둘 다 로그에 실린다",
    (name) => {
      const body = bodyOf(actions, name);
      expect(body).toContain("unitsAuditFields(");
      expect(body).toContain("prevUnits:");
      expect(body).toContain("nextUnits:");
    },
  );

  it("🔴 그날 칸은 **배분 계획의 수신 행**에서 잰다 — 상태만 받는 행(남의 교시)이 섞이면 안 된다", () => {
    const body = bodyOf(actions, "setAttendanceCell");
    expect(body).toContain("dayPlan.units.keys()");
    // 담는 방식이 갈래마다 다르다 — 그날 칸은 나눠 담고(split) 교시 지정은 행마다 같은 값(each).
    expect(body).toContain('spread: slot === null ? "split" : "each"');
  });

  it("🔴 교시 지정 저장은 **쓰는 행 전부**를 센다 — 대표 1행이면 격자의 절반이 된다", () => {
    const body = bodyOf(actions, "setAttendanceCell");
    expect(body).toContain("[...writeIds, ...promoteIds]");
  });

  it("🔴 범위는 칸마다 계획 수신 행으로 재고, 바뀐 칸 수를 함께 적는다(새 칸은 이전 값이 없어 뺀다)", () => {
    const body = bodyOf(actions, "setAttendanceRange");
    expect(body).toContain("plan.units.keys()");
    expect(body).toContain('spread: "split"');
    expect(body).toContain("unitsChangedCells");
    // 이전 값은 조회가 실어 온 것으로만 잰다 — 추가 왕복도, 지어낸 값도 없다.
    expect(body).toContain("rowFactsById");
    expect(body).toContain("status, session_units");
  });

  it("🔴 렌더러는 nextUnits(칸에 보이는 값)를 units(사람이 친 값)보다 먼저 읽는다", () => {
    const d = stripComments(read("features", "audit", "describe.ts"));
    expect(d).toContain('has("nextUnits")');
    expect(d).toContain("unitsChangedCells");
  });
});
