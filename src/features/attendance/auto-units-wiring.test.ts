/**
 * 수학 자동 시수(원장 2026-09-11) — **배선 가드**(소스 스캔).
 *
 * 규칙 자체는 순수 함수(`auto-units.ts`)·서버 조회(`server/auto-units.ts`) 테스트가, **실제로 무엇이 저장되나**는
 * 행동 테스트(`server/actions-auto-units.test.ts`)가 잠근다. 여기는 그 규칙을 **어디서 부르는가**를 잠근다 —
 * 돈 값이라 경로 하나가 빠지거나(키오스크만 1로 남음) 넘치면(고친 칸을 덮음) 조용히 틀린다.
 *   ① 새 행을 만드는 출결 경로 전부가 `resolveAutoUnits`를 지나고, 판정·저장 **두 곳 모두 원문**을 본다
 *   ② 자동값은 **INSERT 쪽에만** — 있는 행을 고치는 분기엔 없다(강사가 고친 값·명시한 1 보존)
 *   ③ 확인창이 숫자를 **보여 준** 보강 추가는 그 숫자를 명시로 보낸다(안 보내면 자동값이 끼어든다)
 *   ④ 손대지 않기로 한 경로(보강 연결·보강 반·자리)는 그대로다
 *   ⑤ 화면이 보여 주는 기본값·낙관값 = 저장값(파생 칸 · 늦은 응답 · 일괄 안내)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
/** 주석을 걷어 낸 코드 — 설명 문장에 같은 낱말이 있어도 걸리지 않게. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACTIONS = code(read("features/attendance/server/actions.ts"));

/** `export async function NAME(`부터 다음 `export `까지 — 한 서버 액션의 본문. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name}을 찾지 못함 — 스캔 방식을 갱신할 것`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}
/** a 다음에 처음 나오는 b까지(둘 다 있어야 한다). */
function between(src: string, a: string, b: string): string {
  const i = src.indexOf(a);
  expect(i, `'${a}'를 찾지 못함`).toBeGreaterThan(-1);
  const j = src.indexOf(b, i + a.length);
  expect(j, `'${b}'를 찾지 못함`).toBeGreaterThan(-1);
  return src.slice(i, j);
}
const count = (s: string, needle: string) => s.split(needle).length - 1;

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsFiles(p, out);
    else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("① 출결 INSERT 경로는 전부 자동 시수 헬퍼를 지난다", () => {
  for (const name of ["saveAttendance", "setAttendanceCell", "setAttendanceBulk", "setAttendanceRange"]) {
    it(`${name}`, () => {
      const body = fnBody(ACTIONS, name);
      expect(body).toContain("autoUnitsApply(");
      expect(body).toContain("resolveAutoUnits(supabase");
      expect(body).toContain("newRowUnits(");
    });
  }

  /**
   * 🔴 판정(`autoUnitsApply`)과 저장(`newRowUnits`) **두 곳 모두** 요청의 원문을 본다 — 적대 리뷰 2026-09-11:
   *    원문을 보는 곳이 판정 인자 하나뿐일 때 그 한 토큰을 바꾸는 변이("1"·"2"가 1.5로 저장)가 전 테스트를 통과했다.
   */
  it("🔴 판정·저장 두 곳 모두 요청 **원문**을 본다 — 단건·일괄·범위·일별 폼", () => {
    const cell = fnBody(ACTIONS, "setAttendanceCell");
    expect(cell).toContain("autoUnitsApply({ rawUnits: input.units, slotStart: slot, status })");
    expect(cell).toContain("newRowUnits(input.units, unitsVal, lookedUp)");
    expect(cell).toContain("session_units: ins.units,");
    const bulk = fnBody(ACTIONS, "setAttendanceBulk");
    expect(bulk).toContain("autoUnitsApply({ rawUnits: input.units, slotStart: slot, status })");
    expect(bulk).toMatch(/newRowUnits\(\s*input\.units,\s*bulkUnitsVal,/);
    const range = fnBody(ACTIONS, "setAttendanceRange");
    expect(range).toContain("autoUnitsApply({ rawUnits: input.units, slotStart: null, status })");
    expect(range).toMatch(/newRowUnits\(\s*input\.units,\s*unitsVal,/);
    const form = fnBody(ACTIONS, "saveAttendance");
    expect(form).toContain("autoUnitsApply({ rawUnits: r.rawUnits, slotStart: null, status: r.status })");
    expect(form).toContain("newRowUnits(r.rawUnits, r.sessionUnits,");
  });

  it("키오스크 등원 반영도 — admin 클라이언트라 tenantId로 좁힌다", () => {
    const kiosk = code(read("features/attendance/kiosk/server/checkin.ts"));
    expect(kiosk).toContain("resolveAutoUnits(admin, [{ classId, date }], { tenantId })");
    expect(kiosk).toContain("session_units: autoUnits");
  });

  it("🔴 attendance_records에 INSERT하는 파일은 전부 분류돼 있다 — 새 경로가 생기면 여기서 멈춘다", () => {
    const USES_HELPER = new Set([
      "features/attendance/server/actions.ts",
      "features/attendance/kiosk/server/checkin.ts",
    ]);
    const EXEMPT = new Map([
      // 자리(랩실·JJ) 출결 — 교시별 행(slot_start 있음)이라 "그날 전체" 자동값의 대상이 아니다.
      ["features/attendance/seat/server/actions.ts", "자리 교시별 행"],
      // 보이지 않는 '보강' 반(0241a) — 배치가 없고 보고서 훅의 합산 규칙이 따로 있다(설계상 손대지 않음).
      ["features/attendance/server/makeup-pool.ts", "보강 반 훅"],
    ]);
    const found: string[] = [];
    for (const file of tsFiles(SRC)) {
      const src = readFileSync(file, "utf8");
      if (!/from\("attendance_records"\)\s*\.insert\(/.test(src)) continue;
      found.push(relative(SRC, file).split(sep).join("/"));
    }
    const unclassified = found.filter((f) => !USES_HELPER.has(f) && !EXEMPT.has(f));
    expect(
      unclassified,
      "출결 INSERT 경로가 새로 생겼다 — 수학 자동 시수(resolveAutoUnits)를 태울지 정하고 이 목록에 넣을 것",
    ).toEqual([]);
    for (const f of USES_HELPER) expect(found, f).toContain(f);
  });
});

describe("② 자동값은 새 행에만 — 있는 행을 고치는 분기엔 없다", () => {
  /**
   * ⚠️ 갱신 분기 안에 분기가 더 있다(그날 칸 시수 배분 `if (slot === null) … } else if` — 2026-09-11 강사 보기 몫 분배로
   *    옛 `if (dayCellSplit) … } else {`를 대체) — 처음 만나는 `} else {`로 자르면 갱신 문장이 검사 밖으로 빠질 수 있다
   *    (적대 리뷰 2026-09-11). 그래서 새 행 INSERT 바로 앞의 `} else {`(바깥 else)를 경계로 삼고, 갱신 문장
   *    (`planDayCellUnits`가 정한 묶음마다 쓰는 줄)이 그 구간 안에 있는지로 경계를 확인한다.
   */
  it("단건: 갱신 분기에는 없고 두 새 행 분기(교시별·일별)에만 조회한다", () => {
    const body = fnBody(ACTIONS, "setAttendanceCell");
    const insertAt = body.indexOf("insertWithVia(supabase, row)");
    expect(insertAt).toBeGreaterThan(-1);
    // 갱신 분기 머리 — 2026-09-17부터 `overwrote`(제 행을 새로 만드는 강사 보기 칸 `createOwn`은 갱신이 아니다).
    const updateStart = body.indexOf("if (overwrote) {");
    expect(updateStart).toBeGreaterThan(-1);
    const outerElse = body.indexOf("} else if (ownInsertSlots) {", updateStart);
    expect(outerElse).toBeGreaterThan(updateStart);
    const updateBranch = body.slice(updateStart, outerElse);
    // 경계가 맞는지부터 — 흔한 갱신 한 줄이 이 구간에 있어야 한다(구조가 바뀌면 여기서 멈춘다).
    expect(updateBranch).toContain("g.units === undefined ? patch : { ...patch, session_units: g.units }");
    for (const bad of ["resolveAutoUnits", "autoUnitsApply", "newRowUnits", "lookedUp", "insertedAuto ="]) {
      expect(updateBranch, bad).not.toContain(bad);
    }
    expect(count(body, "resolveAutoUnits(")).toBe(2);
    expect(body.indexOf("resolveAutoUnits(")).toBeGreaterThan(outerElse);
    const insertBranch = body.slice(outerElse, insertAt);
    expect(insertBranch).toContain("insertedAuto =");
    expect(insertBranch).toContain("session_units: ins.units,");
  });

  it("일괄: 갱신 루프엔 없고 새 행(inserts)에만 — 조회한 값을 새 행에 **실제로** 싣는다", () => {
    const body = fnBody(ACTIONS, "setAttendanceBulk");
    const updates = between(body, "for (const [via, bucket] of byVia) {", "const bulkWantsAuto =");
    expect(updates).not.toContain("session_units");
    expect(body).toContain("inserts.map((c) => ({ classId: c.classId, date: sessionDate, slotStart: slot }))");
    expect(body).toContain("session_units: bulkUnitsOf(c).units,");
    // 조회한 맵이 새 행 시수의 재료로 쓰인다(조회만 하고 버리는 변이 방지).
    expect(body).toMatch(/bulkWantsAuto \? \(bulkAuto\.get\(autoUnitsKey\(c\.classId, sessionDate, slot\)\) \?\? null\) : undefined/);
  });

  it("범위: 갱신 블록엔 없고 새 칸(inserts)에만", () => {
    const body = fnBody(ACTIONS, "setAttendanceRange");
    const updates = between(body, "if (updateIds.length > 0) {", "const rangeWantsAuto =");
    expect(updates).not.toContain("rangeAuto");
    expect(updates).not.toContain("rangeUnitsOf");
    // 새 칸의 그날 전체 행. 나눠 맡는 날은 각 교시의 자동값을 별도로 합산한다.
    expect(body).toContain("insertRows.push(withVia({ ...base, session_units: rangeUnitsOf(c).units }, via));");
  });

  it("일별 폼: 갱신(updates) 루프엔 없고 새 행(inserts)에만", () => {
    const body = fnBody(ACTIONS, "saveAttendance");
    const updates = between(body, "for (const r of updates) {", "const wantsAuto =");
    expect(updates).not.toContain("formUnitsOf(");
    expect(updates).not.toContain("formAuto");
    expect(body).toContain("session_units: formUnitsOf(r).units,");
  });
});

describe("③ 숫자를 보여 준 보강 추가는 그 숫자를 명시로 보낸다", () => {
  // ⚠️ 부분 문자열로 보면 조건부 형태(`...(x !== 1 ? { units: … } : {})`)도 통과한다 — **무조건 속성 한 줄**을 요구한다.
  it("출석부·ECS 공용 보강 흐름 — 1도 보낸다(조건 없이)", () => {
    const flow = code(read("features/attendance/components/makeup-add-flow.tsx"));
    expect(flow).toMatch(/^\s*units: String\(choice\.addUnits\),\s*$/m);
    expect(flow).not.toContain("choice.addUnits !== 1 ?");
  });
  it("원스크린 앵커 보강 칸 — 안 넘기면 1(조건 없이)", () => {
    const os = code(read("features/onescreen/components/onescreen-client.tsx"));
    expect(os).toMatch(/^\s*units: String\(units \?\? 1\),\s*$/m);
    expect(os).not.toContain("units && units !== 1 ?");
  });
  it("일별 폼 보강 행 — 확인창 숫자를 초안에 그대로", () => {
    expect(code(read("app/(shell)/attendance/[date]/[classId]/input-form.tsx"))).toContain(
      'const unitsDraft = choice ? formatSessionUnits(choice.addUnits) : "";',
    );
  });
  it("🔴 격자 타이핑의 1은 명시(\"1\") · 되돌리기도 명시로 되살린다", () => {
    expect(code(read("features/attendance/grid/typing.ts"))).toContain('parsed.value === null ? "1" : String(parsed.value)');
    expect(code(read("app/(shell)/attendance/_components/grid-context.tsx"))).toContain('prev.u === null ? "1" : String(prev.u)');
  });
});

describe("④ 손대지 않기로 한 경로", () => {
  it("보강–결석분 연결(linkMakeupToAbsence)은 자동값을 안 탄다(시수를 명시 합산한다)", () => {
    expect(fnBody(ACTIONS, "linkMakeupToAbsence")).not.toContain("resolveAutoUnits");
  });
  it("보강 반 훅·자리 출결은 헬퍼를 안 부른다", () => {
    expect(read("features/attendance/server/makeup-pool.ts")).not.toContain("resolveAutoUnits");
    expect(read("features/attendance/seat/server/actions.ts")).not.toContain("resolveAutoUnits");
  });
});

describe("⑤ 화면이 보여 주는 값 = 저장될 값", () => {
  const CELL_DIR = "app/(shell)/attendance/_components";

  it("🔴 팝오버 응답 보정·실패 되돌리기는 칠한 표식과 함께 — 그 사이 바뀐 칸은 받는 쪽이 거절한다(칸의 주인)", () => {
    const pop = code(read(`${CELL_DIR}/cell-popover.tsx`));
    // 시수 원문(`raw` = unitsRaw)을 함께 넘긴다 — 칠할 값은 칸이 격자 타이핑과 같은 함수로 만든다(리뷰 2026-09-11).
    expect(pop).toContain("const token = onSaved({ status: next, units: parsedUnits, ...raw, note: nextNote });");
    // 🔴 칠할 원문은 격자 타이핑과 같은 정규화(쉼표 소수점 → 점) — 원문 그대로면 NaN이 칠해져 화면이 무한 렌더로 떨어졌다.
    expect(pop).toContain("{ unitsRaw: canonicalUnitsRaw(unitsDraft)");
    // 성공 보정 — 서버가 새 행에 넣은 시수(serverUnits)와 칠한 표식(ifStill)을 함께 돌려준다.
    expect(pop).toMatch(
      /onSaved\(\s*\{\s*status: next,\s*units: res\?\.autoUnits !== undefined \? res\.autoUnits : parsedUnits,\s*\.\.\.raw,\s*\.\.\.\(res\?\.autoUnits !== undefined \? \{ serverUnits: res\.autoUnits \} : \{\}\),\s*note: nextNote,\s*\},\s*\{ ifStill: token \},?\s*\)/,
    );
    expect(pop).toContain("onSaved({ status, units, note }, { ifStill: token, revert: true })");
    const cell = code(read(`${CELL_DIR}/attendance-cell.tsx`));
    // 칠하는 **순간** 자리를 잡는다(팝오버를 열 때가 아니라) · 보정·되돌리기는 칸의 주인으로 — 값 동일성은 빈 칸을 못 가린다.
    expect(cell).toContain("value: next.noteOnly ? null : ctx?.store.paintLocal(key, v) ?? null");
    expect(cell).toContain("ctx?.store.correctLocal(key, token.value, settled)");
    // 🔴 칠할 값은 격자 타이핑과 **같은 함수**(ctx.toValue) — 교시가 둘 이상인 칸의 합이 서버와 같다(popover-slot-units.test.tsx).
    expect(cell).toContain("ctx.toValue(key, { status: next.status, units: next.unitsRaw }, ctx.store.valueOf(key))");
    // 보정 값 = 서버가 새 행에 넣은 시수가 오면 그 값, 아니면 칠한 그 값(격자 pushCell의 setLocalIf와 같은 규약).
    expect(cell).toContain("{ s: next.status, u: next.serverUnits }");
    expect(cell).toContain("token?.shown");
    // 🔴 낙관값은 원문을 서버와 같은 함수로 읽는다 — 어떤 호출부도 저장소에 NaN을 못 넣는다(재리뷰 2026-09-11).
    const rule = code(read("features/attendance/grid/optimistic-value.ts"));
    expect(rule).toContain("parseSessionUnits(v.units)");
    expect(rule).not.toContain("Number(v.units)");
    expect(cell).toContain("ctx?.store.revertLocal(key, token.value)");
    // 메모는 값과 **따로** 되돌린다 — 격자 타이핑·서버 따라잡기가 값만 가져가도 메모는 제 쓰기의 결과를 따른다.
    expect(cell).toContain("revertNote(token.note)");
    const grid = code(read(`${CELL_DIR}/grid-context.tsx`));
    expect(grid).toContain("store.setLocalIf(key, shown, { s: val.status, u: res.autoUnits })");
  });

  it("🔴 '행 없음'은 상태가 아니라 기록으로 — 파생 칸도 새 행(격자·팝오버가 같은 함수)", () => {
    expect(code(read(`${CELL_DIR}/grid-context.tsx`))).toContain("optimisticGridValue(v, current,");
    const cell = code(read(`${CELL_DIR}/attendance-cell.tsx`));
    expect(cell).toMatch(/recorded=\{ctx \? !isRecordless\(state\.value\) : initialStatus !== null && !derived\}/);
    const pop = code(read(`${CELL_DIR}/cell-popover.tsx`));
    expect(pop).toContain("const autoUnits = recorded ? null : autoHere;");
    expect(pop).not.toContain("status === null ? autoHere : null");
  });

  it("🔴 원스크린 일괄 안내 — 빈칸이 1이 아니면 수업 길이 값을 말한다", () => {
    const bulk = code(read("features/onescreen/components/bulk-apply.tsx"));
    expect(bulk).toContain('"os.bulk.unitsHintAuto"');
    expect(bulk).toContain('"os.bulk.unitsTitleAuto"');
    expect(bulk).toContain("attPlan?.newCellUnits");
    expect(code(read("features/onescreen/components/onescreen-grid.tsx"))).toContain(
      "autoUnits: r.subject.attendanceAutoUnits",
    );
  });
});
