/**
 * 강사 전체 보기 시수 배분(원장 제보 2026-09-11 *"새로고침하면 강제로 어떤 숫자로 롤백"*) — **배선** 가드.
 *
 * 행동은 `scoped-split.test.ts`·`scope-ownership.test.ts`·`server/actions-scoped-split.test.ts`가 본다.
 * 여기는 "같은 규칙을 모든 문이 지나는가"다 — 한 문만 고치면 같은 칸이 입력 경로마다 다른 숫자를 남긴다
 * (타이핑은 고쳤는데 붙여넣기·팝오버는 옛 분배 = 새로고침 뒤 또 롤백).
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

describe("강사 보기 시수 배분 — 배선", () => {
  const actions = stripComments(read("features", "attendance", "server", "actions.ts"));

  it.each(["setAttendanceCell", "setAttendanceRange"])(
    "🔴 %s — 배분은 planDayCellUnits, 몫은 서버가 DB로 다시 판정한다(#77)",
    (name) => {
      const body = bodyOf(actions, name);
      expect(body).toContain("planDayCellUnits(");
      expect(body).toContain("loadScopeFacts(");
      expect(body).toContain("buildScopeShare(");
      expect(body).toContain("scopeTeaches(");
    },
  );

  /**
   * 🔴 원장 2026-09-12 *"jj는 개인강사 출석부에 넣음 안되지."* — 자리 행을 빼는 문이 **전부** 같은 함수를 지나는가.
   * 한 문만 고치면 같은 칸이 경로마다 다르게 남는다(쓰기는 고쳤는데 지우기·메모만은 자리 행을 덮는다).
   */
  it.each(["setAttendanceCell", "setAttendanceRange"])(
    "🔴 %s — 자리(JJ·랩실) 빼기는 splitOutSeatRows 한 함수",
    (name) => {
      expect(bodyOf(actions, name)).toContain("splitOutSeatRows(");
    },
  );

  it("🔴 자리 판정은 축 단일 소스(attendanceSlotShare) — 저장(scope-ownership)과 화면(queries)이 같은 함수", () => {
    expect(stripComments(read("features", "attendance", "scope-ownership.ts"))).toContain("attendanceSlotShare(");
    expect(stripComments(read("features", "attendance", "server", "queries.ts"))).toContain("attendanceSlotShare(");
    // 축은 몫 판정을 새로 짓지 않는다 — `mine`은 `ownsAttendanceSlot`의 답 그대로다.
    expect(stripComments(read("features", "attendance", "teacher-axis.ts"))).toMatch(
      /attendanceSlotShare[\s\S]{0,400}ownsAttendanceSlot\(input\)/,
    );
  });

  it("🔴 메모만 저장도 강사 보기를 보낸다 — 자리 행에 사유가 달리지 않게(팝오버가 그 유일한 문)", () => {
    const popover = read("app", "(shell)", "attendance", "_components", "cell-popover.tsx");
    const noteOnly = popover.slice(popover.indexOf("const applyNoteOnly"), popover.indexOf("const apply ="));
    expect(noteOnly).toContain("scopeFieldsFor(scope, classId)");
  });

  it("🔴 '함께 바뀜' 셈은 자리를 뺀 한 함수(sharedOtherSlots) — 격자·칸이 같은 수를 말한다", () => {
    for (const rel of [
      ["app", "(shell)", "attendance", "_components", "matrix-table.tsx"],
      ["app", "(shell)", "attendance", "_components", "attendance-cell.tsx"],
    ]) {
      expect(stripComments(read(...rel)), rel.join("/")).toContain("sharedOtherSlots(");
    }
  });

  it("🔴 저장마다 감사로그(담임 시작일)를 읽지 않는다 — 반응속도 1순위(2026-09-11), 그 칸은 격자가 막는다", () => {
    const server = stripComments(read("features", "attendance", "server", "scope-ownership.ts"));
    const pure = stripComments(read("features", "attendance", "scope-ownership.ts"));
    for (const src of [server, pure]) {
      expect(src).not.toContain("getHomeroomSinceIndex");
      expect(src).not.toContain("teacher-as-of");
    }
    expect(actions).not.toContain("getHomeroomSinceIndex");
    expect(pure).toContain("homeroomSince: null");
  });

  it("🔴 액션이 splitUnitsAcrossSlots를 직접 부르지 않는다 — 나누는 곳은 scoped-split.ts 한 곳", () => {
    expect(actions).not.toContain("splitUnitsAcrossSlots(");
    expect(read("features", "attendance", "scoped-split.ts")).toContain("splitUnitsAcrossSlots(");
  });

  it("🔴 저장 쪽 몫 판정은 화면과 같은 함수(ownsAttendanceSlot)를 부른다", () => {
    expect(stripComments(read("features", "attendance", "scope-ownership.ts"))).toContain("ownsAttendanceSlot(");
    expect(stripComments(read("features", "attendance", "server", "queries.ts"))).toContain("ownsAttendanceSlot(");
  });

  it("🔴 몫 판정 재료에 자리 표식(seat_label)을 함께 읽는다 — 셀·범위 조회 둘 다", () => {
    expect(bodyOf(actions, "setAttendanceCell")).toMatch(/\.select\("id, slot_start, seat_label,/);
    expect(bodyOf(actions, "setAttendanceRange")).toMatch(/\.select\("id, class_id, student_id, session_date, slot_start, seat_label,/);
  });

  it("🔴 클라는 보기(강사 id)만 보낸다 — 격자 단건·범위·팝오버 모두", () => {
    const grid = read("app", "(shell)", "attendance", "_components", "grid-context.tsx");
    expect(grid).toContain("...scopeFieldsFor(scope, p.classId)");
    expect(grid).toContain("...rangeScopeFields(scope, targets.map((t) => t.classId))");
    const popover = read("app", "(shell)", "attendance", "_components", "cell-popover.tsx");
    expect(popover).toContain("...scopeFieldsFor(scope, classId)");
  });

  it("🔴 page는 스코프로 그린 반(teacherClasses)만 싣는다 — 보강 묶음은 빼고", () => {
    const page = read("app", "(shell)", "attendance", "page.tsx");
    expect(page).toContain("<AttendanceScopeProvider scope={attendanceScope}>");
    expect(page).toMatch(/const attendanceScope =[\s\S]{0,200}teacherClasses\.map\(\(c\) => c\.id\)/);
    expect(page).not.toMatch(/const attendanceScope =[^;]*makeupPool/);
  });
});
