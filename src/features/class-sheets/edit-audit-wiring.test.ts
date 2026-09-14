import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 🔴 강사 시트 **칸 편집 감사로그** 배선 가드 — 원장 결정(2026-09-14): *칸 입력을 마칠 때 한 줄*.
 *
 * 규약(판정·검증)은 `lib/edit-audit.test.ts`가 잠그고, 여기는 **배선이 되돌아가지 않게** 소스를 본다:
 *  ① 기록 액션이 저장과 같은 문을 지나고 응답 뒤에 기록하는지
 *  ② 타이핑마다 불리는 저장 액션 안에 기록이 **들어가지 않았는지**(줄이 수백 개로 쌓인다)
 *  ③ 칸을 건드리는 화면이 모두 touch + 루트 onBlur를 갖는지
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", "features", "class-sheets", ...p), "utf8");

/** `export async function name(` 부터 다음 export 직전까지. */
function bodyOf(src: string, name: string): string {
  const i = src.indexOf(`export async function ${name}(`);
  expect(i, `${name} 선언을 찾지 못함`).toBeGreaterThan(-1);
  const j = src.indexOf("\nexport ", i + 1);
  return src.slice(i, j === -1 ? undefined : j);
}

describe("🔴 강사 시트 칸 편집 감사로그 배선", () => {
  it("기록 액션 = 열람 전용 가드 → 저장과 같은 쓰기 게이트 → 응답 뒤 기록", () => {
    const src = read("server", "edit-audit-actions.ts");
    const body = bodyOf(src, "commitSheetEdits");
    const readonly = body.indexOf("readonlyTeacherViewError()");
    const gate = body.indexOf("requireEcsClassAccess(");
    const deferred = body.indexOf("after(");
    expect(readonly).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(readonly);
    expect(body).toMatch(/requireEcsClassAccess\(.*\{ write: true \}\)/);
    expect(deferred).toBeGreaterThan(gate);
    // 새 값은 DB에서 — admin 조회라 tenant 필터 필수([[#104]]).
    expect(src).toContain('.eq("tenant_id", tenantId)');
    // 저장이 거절했을 칸은 기록도 없다 — 목표 허용 목록 · MP는 EiE만(저장 액션과 같은 판정).
    expect(src).toContain("goalAreasFor(");
    expect(src).toContain('access.englishTrack !== "eie"');
  });

  it("🔴 타이핑마다 불리는 저장 액션 안에서는 기록하지 않는다", () => {
    const actions = read("server", "actions.ts");
    for (const fn of ["upsertGoal", "upsertStudentMark", "saveMemo"]) {
      expect(bodyOf(actions, fn), fn).not.toContain("logAction(");
    }
    expect(read("server", "month-memo-actions.ts")).not.toContain("logAction(");
    // MP 저장은 **토글 의도가 맞을 때만** 기록한다(칸 글쓰기엔 의도가 없다).
    const mp = bodyOf(read("server", "month-plan-actions.ts"), "saveMonthPlanCells");
    expect(mp).toContain("mpStructuralChange(input.intent, patches)");
    expect(mp).toMatch(/if \(structural\)/);
  });

  it("누름이 곧 결심인 토글은 저장 액션이 직접 한 줄 — Shouting · MP 열/휴강", () => {
    expect(bodyOf(read("server", "actions.ts"), "setSlotShouting")).toContain("logShoutingToggle(");
    const plan = read("components", "use-month-plan.ts");
    expect(plan).toContain('{ kind: "ebookColumn", show }');
    expect(plan).toContain('{ kind: "dayOff", off }');
  });

  it.each<[string, string[]]>([
    [
      "sheet-client.tsx",
      [
        "useSheetEditAudit(",
        "onBlur={audit.onBlur}",
        "markEditTouches(",
        'kind: "goal"',
        'kind: "memo"',
        "flush: () => store.flush()",
      ],
    ],
    ["month-client.tsx", ["useSheetEditAudit(", "onBlur={audit.onBlur}", 'kind: "goal"', 'kind: "mpCell"', "audit={audit}"]],
    [
      "seat-day-client.tsx",
      ["useSheetEditAudit(", "onBlur={audit.onBlur}", "useSeatDaySaves(attendance, setAttendance, marks, setMarks, audit)"],
    ],
    ["seat-day-saves.ts", ["markEditTouches(", "audit.track("]],
    ["month-memo.tsx", ['kind: "monthMemo"', "audit?.track(job)"]],
    ["today-mark-popover.tsx", ["markEditTouches(", "commitSheetEdits("]],
  ])("%s — 칸을 건드리고 떠날 때 기록한다", (file, needles) => {
    const src = read("components", file);
    for (const n of needles) expect(src, n).toContain(n);
  });

  it("🔴 월간 큐 비우기는 **이미 떠난 저장**까지 기다린다(안 기다리면 서버가 도착 전 DB를 읽는다)", () => {
    for (const f of ["use-month-goals.ts", "use-month-plan.ts"]) {
      expect(read("components", f), f).toContain("Promise.all([...inflight.current])");
    }
  });

  it("월간 화면의 목표·계획 칸은 감싼 핸들러로만 들어간다(원래 핸들러를 직접 넘기면 기록이 빠진다)", () => {
    const src = read("components", "month-client.tsx");
    expect(src).not.toContain("onField={setField}");
    expect(src).not.toContain("onCell={plan.setCell}");
  });
});
