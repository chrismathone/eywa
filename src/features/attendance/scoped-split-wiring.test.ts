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

  /**
   * 🔴 원장 2026-09-14 빗금 칸 입력(*"그 날의 해당 담당 출석으로 전부 이전"* + *"대신 다른 사람이 출결하면 메모에 남겨"*) —
   *    셀·범위 저장이 **같은 판정**(planScopedDay)·**같은 메모 규칙**(proxyNote)·**같은 거절 문장**을 지나는가.
   *    한 문만 고치면 타이핑은 옮기는데 붙여넣기는 거절(또는 시수까지 덮음)이 된다.
   */
  it.each(["setAttendanceCell", "setAttendanceRange"])(
    "🔴 %s — 빗금 칸 판정은 planScopedDay(화면 표식 포함), 쓰기는 writeProxyRows, 거절 문장은 SCOPED_REJECT_MESSAGE",
    (name) => {
      const body = bodyOf(actions, name);
      expect(body).toContain("planScopedDay(");
      expect(body).toContain("ghostIntent:");
      expect(body).toContain("writeProxyRows(");
      expect(body).toContain("SCOPED_REJECT_MESSAGE[");
    },
  );

  it("🔴 메모 붙이기는 proxyNote 한 함수 + 메모 비교 조건(읽은 값일 때만 쓴다)", () => {
    const helper = actions.slice(actions.indexOf("async function writeProxyRows("), actions.indexOf("export type SaveAttendanceState"));
    expect(helper).toContain("proxyNote(old, actorName)");
    expect(helper).toContain('q.is("note", null)');
    expect(helper).toContain('q.eq("note", old)');
    expect(helper).not.toContain("session_units");
  });

  it("🔴 메모를 고르는 곳(월간 조회·반별 입력 폼·메모만 저장)은 사유 있는 메모를 대신 입력 줄보다 먼저 본다", () => {
    const queries = stripComments(read("features", "attendance", "server", "queries.ts"));
    expect(queries).toContain("stripProxyMemo(cell.note)");
    // 남의 교시 메모는 **제 교시 값이 있는 칸에서만** 대체로 보인다(원장 2026-09-17 · 적대 리뷰) — 값 없는 칸엔 안 싣는다.
    expect(queries).toContain("stripProxyMemo(cell.otherNote)");
    expect(queries).toContain("cell.note ?? (cell.slots.length > 0 ? cell.otherNote : null)");
    expect(queries).toContain("stripProxyMemo(cur.note)");
    expect(bodyOf(actions, "setAttendanceCell").match(/noteTargetRow\(/g)?.length).toBe(2);
  });

  it("🔴 사유를 읽는 곳은 대신 입력 줄을 걸러낸다 — 운영실 사유 요약·결석 사유 분류·복기 AI", () => {
    for (const rel of [
      ["features", "dashboard", "absence-reasons.ts"],
      ["features", "attendance", "absence-reason.ts"],
      ["features", "attendance", "recap", "prompt.ts"],
    ]) {
      expect(stripComments(read(...rel)), rel.join("/")).toContain("stripProxyMemo(");
    }
  });

  it("🔴 빗금 칸 입력 갈래엔 시수 쓰기가 없다 — 셀 저장(원장 결정 ① '상태만')", () => {
    const body = bodyOf(actions, "setAttendanceCell");
    const start = body.indexOf("if (writeIds.length > 0 && transfer) {");
    const end = body.indexOf("} else if (writeIds.length > 0) {");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(body.slice(start, end)).toContain("writeProxyRows(");
    expect(body.slice(start, end)).not.toContain("session_units");
    // 교시 지정 저장의 시수 쓰기에 빗금 칸 입력이 떨어지지 않는다(그날 칸이면 그 갈래를 못 탄다).
    expect(body).toContain("} else if (slot !== null && unitsProvided) {");
  });

  it("🔴 화면 쪽 판정도 한 함수(ghostCellKind) — 칸·조회가 같은 답, 격자·행은 그 함수를 감싼 notMineCell", () => {
    expect(stripComments(read("features", "attendance", "cell-display.ts"))).toMatch(
      /export function notMineCell[\s\S]{0,120}ghostCellKind\(input\)/,
    );
    expect(stripComments(read("app", "(shell)", "attendance", "_components", "attendance-cell.tsx"))).toContain(
      "ghostCellKind(",
    );
    // 강사 보기는 빗금 칸을 더는 안 만든다(원장 2026-09-17 *"담당하는 날만 표시"*) — 조회가 빗금 표시 값을 다시 짓지 않게.
    expect(stripComments(read("features", "attendance", "server", "queries.ts"))).not.toContain("ghostCellKind(");
  });

  it("🔴 빗금 표시 값(g)은 합계·복사 밖 — countCells·copyValueOf가 건너뛴다", () => {
    expect(stripComments(read("features", "attendance", "grid", "totals.ts"))).toContain("if (!v || v.g) continue;");
    expect(stripComments(read("features", "attendance", "grid", "typing.ts"))).toContain("if (!v || v.g) return null;");
  });

  it("🔴 자리 판정은 축 단일 소스(attendanceSlotShare) — 저장(scope-ownership)과 화면(queries)이 같은 함수", () => {
    expect(stripComments(read("features", "attendance", "scope-ownership.ts"))).toContain("attendanceSlotShare(");
    // 축은 몫 판정을 새로 짓지 않는다 — `mine`은 `ownsAttendanceSlot`의 답 그대로다.
    expect(stripComments(read("features", "attendance", "teacher-axis.ts"))).toMatch(
      /attendanceSlotShare[\s\S]{0,400}ownsAttendanceSlot\(input\)/,
    );
  });

  /**
   * 🔴 원장 2026-09-17 저녁 *"화요일은 원래 수업이라 이후에 관리자가 수정가능하고, 다른 요일도 보강 등으로 수업할 수 있으니까
   *    숫자 입력가능하게"* — 같은 날 낮의 '수업하지 않는 날 잠금'을 걷었다. **날짜로 막는 판정을 되살리지 말 것**(보강이 막힌다).
   *    수업요일은 색으로만 갈린다(`ownDates` → matrix-row).
   */
  it("🔴 날짜로 입력을 막지 않는다 — 저장 어느 갈래에도 '수업하는 날' 게이트가 없다(원장 2026-09-17 저녁)", () => {
    const queries = stripComments(read("features", "attendance", "server", "queries.ts"));
    // 수업요일 색의 근거(ownDates)는 그대로 — 판정은 축 단일 소스.
    expect(queries).toContain("teachesClassOn(");
    for (const fn of ["setAttendanceCell", "setAttendanceRange"]) {
      expect(bodyOf(actions, fn), fn).not.toContain("scopeTeachesOn(");
    }
    expect(stripComments(read("features", "attendance", "scope-ownership.ts"))).not.toContain("scopeTeachesOn");
    expect(stripComments(read("features", "attendance", "scoped-split.ts"))).not.toContain("NOT_OWN_DAY_MESSAGE");
  });

  it("🔴 메모만 저장도 강사 보기를 보낸다 — 자리 행에 사유가 달리지 않게(팝오버가 그 유일한 문)", () => {
    const popover = read("app", "(shell)", "attendance", "_components", "cell-popover.tsx");
    const noteOnly = popover.slice(popover.indexOf("const applyNoteOnly"), popover.indexOf("const apply ="));
    expect(noteOnly).toContain("scopeFieldsFor(scope, classId)");
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
