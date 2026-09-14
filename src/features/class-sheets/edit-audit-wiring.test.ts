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

const readSrc = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");

describe("🔴 범위 확대(원장 결정 2026-09-14) — 계획 줄 칸 · 수학 시트 월간 목표 · 자리 JJ 칸", () => {
  it("계획 칸: 저장 큐가 입력마다 편집 전 값을 알리고, 칸을 가진 세 화면이 받아 떠날 때 기록한다", () => {
    expect(read("components", "use-sheet-saves.ts")).toContain(
      "this.onEdit?.(lineId, field, k.hasDraft ? k.draft : k.canonical)",
    );
    for (const f of ["sheet-client.tsx", "today-plan-editor.tsx", "slot-plan-block.tsx"]) {
      expect(read("components", f), f).toContain('audit.touch(classId, { kind: "plan", lineId, field }, before)');
    }
    for (const f of ["today-plan-editor.tsx", "slot-plan-block.tsx"]) {
      const src = read("components", f);
      expect(src, f).toContain("useSheetEditAudit(");
      expect(src, f).toContain("onBlur={audit.onBlur}");
    }
  });

  it("🔴 계획 칸 저장(CAS 배치)은 기록하지 않고, 두 문의 칸 기록은 한 벌(`logPlanCellEdits`)", () => {
    expect(bodyOf(read("server", "plan-write.ts"), "applyPlanPatches")).not.toMatch(
      /log(Action|PlanChange|ActionAtDoor)\(/,
    );
    expect(read("server", "edit-audit-actions.ts")).toContain("logPlanCellEdits(");
    const body = bodyOf(readSrc("features", "attendance", "seat", "server", "jj-plan-actions.ts"), "commitSeatPlanEdits");
    const gate = body.indexOf("gateSeatPlanWrite(");
    expect(gate).toBeGreaterThan(-1);
    expect(body.indexOf("after(")).toBeGreaterThan(gate);
    expect(body).toContain("logPlanCellEdits({ grant, scope,");
    // 이 사람(문)이 마지막으로 쓴 줄만 — 충돌에서 '서버값 사용'을 누른 칸이 남의 변경을 내 이름으로 남기지 않게.
    expect(read("server", "plan-edit-audit.ts")).toContain("(row.updated_by ?? null) !== (grant.actorId ?? null)");
  });

  it("계획 저장 문 두 벌 모두 기록 문을 가진다(없으면 그 문의 계획 칸은 조용히 무기록)", () => {
    expect(read("components", "plan-api.ts")).toContain("commitEdits: (ref, edits) => commitSheetEdits(");
    expect(readSrc("features", "attendance", "seat", "seat-plan-api.ts")).toContain(
      "commitEdits: (ref, edits) => commitSeatPlanEdits(",
    );
  });

  it("수학 목표: 저장은 기록하지 않고, 칸을 떠날 때 저장과 같은 문으로 전후 값 한 줄", () => {
    expect(bodyOf(readSrc("features", "math-sheets", "server", "actions.ts"), "upsertStudentGoal")).not.toContain(
      "logAction(",
    );
    const body = bodyOf(readSrc("features", "math-sheets", "server", "goal-audit-actions.ts"), "commitMathGoalEdits");
    const readonly = body.indexOf("readonlyTeacherViewError()");
    const gate = body.indexOf("requireMcsClassAccess(");
    expect(readonly).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(readonly);
    expect(body).toMatch(/requireMcsClassAccess\(.*\{ write: true \}\)/);
    expect(body.indexOf("after(")).toBeGreaterThan(gate);
    expect(body).toContain('.eq("tenant_id", access.tenantId)');
    // 🔴 저장과 같은 명단 확인이 **목표 조회보다 먼저** — 남의 반 학생 id로 거짓 줄을 만들지 못하게(리뷰 2026-09-14).
    const roster = body.indexOf('.from("enrollments")');
    expect(roster).toBeGreaterThan(-1);
    expect(roster).toBeLessThan(body.indexOf('.from("math_month_goals")'));
    expect(body).toContain("if (!inClass.has(cell.studentId)) return;");
    const client = readSrc("features", "math-sheets", "components", "month-client.tsx");
    for (const n of ["useSheetEditAudit(", "onBlur={audit.onBlur}", 'kind: "mathGoal"', "onGoalChange={onGoalChange}"]) {
      expect(client, n).toContain(n);
    }
  });

  it("자리 JJ 칸: 저장은 기록하지 않고, 떠날 때 저장과 같은 문(PIN이면 문 이름)으로 한 줄", () => {
    const src = readSrc("features", "attendance", "seat", "server", "mark-actions.ts");
    expect(bodyOf(src, "setSeatJjField")).not.toMatch(/log(Action|SeatAction|ActionAtDoor)\(/);
    const body = bodyOf(src, "commitSeatJjEdits");
    const gate = body.indexOf("gateSeatWrite(");
    expect(gate).toBeGreaterThan(-1);
    expect(body.indexOf("after(")).toBeGreaterThan(gate);
    expect(body).toContain("rosterKeys(");
    expect(body).toContain("logSeatAction(");
    // 이 문이 마지막으로 쓴 행만(저장이 쓰는 작성자 값 — PIN이면 null)과 비교(계획 칸과 같은 규칙).
    expect(body).toContain("if (writer !== (g.userId ?? null)) return;");
    const saves = readSrc("app", "(shell)", "attendance", "seat", "[seat]", "_components", "seat-board-saves.ts");
    // 🔑 실행한 저장은 경로 불문 `startRun`으로 추적하고 flushFields가 그 집합까지 기다린다(언마운트 기록 유실 방지).
    for (const n of [
      "useSheetEditAudit(",
      'kind: "seatJj"',
      "commitSeatJjEdits(",
      "audit.track(startRun(run))",
      "return Promise.allSettled([...inflightRuns.current]);",
    ]) {
      expect(saves, n).toContain(n);
    }
    expect(readSrc("app", "(shell)", "attendance", "seat", "[seat]", "_components", "seat-board.tsx")).toContain(
      "onBlur={auditBlur}",
    );
  });
});
