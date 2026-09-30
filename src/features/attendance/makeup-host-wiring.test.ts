import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 보강 기록 수업 선택(원장 2026-09-21 *"보강 추가시에 '수업'을 선택할 수 있어야겠어"*) 배선 가드.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("보강 기록 수업 선택 배선", () => {
  it("원스크린이 수업 후보·기본값을 창에 넘기고, 고른 수업을 보강 행 앵커(makeupClassId)로 싣는다", () => {
    const client = read("src/features/onescreen/components/onescreen-client.tsx");
    expect(client).toContain("hostClasses={hostChoicesOf(makeupAsk)}");
    expect(client).toMatch(/defaultHostClassId=\{defaultHostClassId\(/);
    expect(client).toContain("fetchMakeupHostClasses(studentId, activeDate, subjects)");
    expect(client).toMatch(/makeupClassId: choice\.hostClassId \?\? null/);
    // '반 없이'를 막는 정규 칸 판정은 보고서 저장 훅과 같은 **담임** 축 — 위임 반의 칸은 뺀다(훅이 못 봐 보강 반이 선다, 재리뷰 2026-09-21).
    expect(client).toContain("const ownRegular = rows.some((su) => !todayClasses.find((c) => c.id === su.classId)?.delegated);");
    expect(client).toContain("regularToday: ownRegular");
  });

  it("🔴 합칠 정규 수업이 있는 보강도 수업 후보를 불러 창에 넘긴다 — 다니는 다른 반에 기록할 수 있게(원장 2026-09-21 '항상 다른 수업을 고를 수 있게')", () => {
    const client = read("src/features/onescreen/components/onescreen-client.tsx");
    const at = client.indexOf('if (plan.kind === "ask") {');
    const block = client.slice(at, client.indexOf("return;", at));
    expect(block).toContain("hostClasses: { options: [], loading: true }");
    // 후보 반은 합칠 정규 수업의 과목으로 좁힌다(두 과목 강사가 '전체'에서 추가하면 결석 목록 과목과 반 후보 과목이 갈린다).
    expect(block).toContain("void loadHostClasses(studentId, candSubjects.length ? candSubjects : mk.subjects);");
    // 이미 보강 행이 있으면 합침도 멈춘다(다른 반으로 만든 보강 행 + 다시 추가해 합침 = 두 번) — 멈춤 판정에 합침/분리 조건이 없어야 한다.
    expect(client).toContain("const stopSubject = choice.candidate ? choice.candidate.subjectKey : undefined;");
    expect(client).toContain("pendingMakeupRows(cardNow, ask.mk, stopSubject).length === 0");
  });

  it("보고서 저장 훅은 고른 수업을 받아, 그 반에 칸이 이미 있으면 보강 반을 만들지 않는다(시수 두 번 방지)", () => {
    // 서버가 확인한 앵커(findMakeupAnchor — 등록 문과 같은 판정)만 훅에 넘긴다(원장 2026-09-30 적대 리뷰: 클라 값을 그대로 믿지 않는다).
    expect(read("src/features/onescreen/server/actions.ts")).toMatch(/makeupClassId: makeupAnchor,/);
    const pool = read("src/features/attendance/server/makeup-pool.ts");
    const fn = pool.slice(pool.indexOf("export async function ensureMakeupAttendanceForReport"));
    const hostAt = fn.indexOf('.eq("class_id", input.makeupClassId)');
    expect(hostAt).toBeGreaterThan(-1);
    expect(hostAt).toBeLessThan(fn.indexOf("ensureMakeupPoolClass("));
    expect(fn.slice(hostAt, fn.indexOf("ensureMakeupPoolClass("))).toMatch(/return \{ ok: true, classId: input\.makeupClassId \}/);
  });

  it("🔴 후보는 보강 등록 문(registerMakeupEntries)과 같은 판정 — 그날 담당 반(담임 ∪ 위임) · 과목이 같은 반", () => {
    const actions = read("src/features/attendance/server/makeup-actions.ts");
    const fn = actions.slice(actions.indexOf("export async function fetchMakeupHostClasses"));
    expect(fn).toContain("getTeachingClasses(supabase, user.id, makeupDate)");
    expect(fn).toContain("wanted.has(c.subject)");
    const register = read("src/features/onescreen/server/makeup-register-actions.ts");
    expect(register).toContain("getTeachingClasses(supabase, user.id, input.date)");
    expect(register).toContain("findMakeupAnchor(classes, entry.makeupClassId, entry.subject, input.date)");
    expect(read("src/features/attendance/makeup-host.ts")).toMatch(/c\.id === classId && c\.subject === subject && isClassOpenOn\(c\.closedAt, date\)/);
    // 보강 반 컬럼(is_makeup_pool)을 새로 읽지 않는다([[#95]]) — getTeachingClasses가 활성 반만 준다.
    expect(fn).not.toContain("is_makeup_pool");
  });

  it("🔴 합칠 후보가 있는 보강은 보던 반에 보강 칸을 따로 적지 않는다 — 한 번의 보강이 두 반에 잡혔다(2026-08-29·09-17 실측)", () => {
    const client = read("src/features/onescreen/components/onescreen-client.tsx");
    const fn = client.slice(client.indexOf("async function resolveMakeupAsk("), client.indexOf("async function linkMakeupToAbsenceCell("));
    const code = fn.replace(/\/\/.*$/gm, "");
    // 부르는 곳은 두 갈래뿐 — 목록에 없던 학생(isNew)·합칠 후보 없는 보강. 후보가 있는 갈래(분리·합침)엔 없어야 한다.
    const noCandidate = code.indexOf("if (!choice.candidate) {");
    const separateRows = code.indexOf("addSeparateMakeupRows(existing, ask.mk, true, choice.candidate!.subjectKey)");
    expect(noCandidate).toBeGreaterThan(-1);
    expect(separateRows).toBeGreaterThan(noCandidate);
    expect(code.split("persistAnchorMakeup(").length - 1).toBe(2);
    expect(code.lastIndexOf("persistAnchorMakeup(")).toBeGreaterThan(noCandidate);
    expect(code.lastIndexOf("persistAnchorMakeup(")).toBeLessThan(separateRows);
    // 후보 갈래는 보던 반에 직접 쓰지 않는다(시수는 합침·분리 헬퍼가 후보 반에만 얹는다).
    const candidateBranch = code.slice(code.indexOf("return;", code.lastIndexOf("persistAnchorMakeup(")));
    expect(candidateBranch).not.toContain("setAttendanceCell(");
    // 분리 보강 줄의 앵커 = 고른 후보 반(시수가 선 반) — 보고서 저장 훅이 보강 반을 또 만들지 않게. 등록·카드 행이 **같은** 목록(ask.mk)을 쓴다.
    expect(code).toMatch(/su\.subjectKey === target\.subjectKey\s*\?\s*\{\s*\.\.\.su,\s*makeupClassId:\s*target\.classId\s*\}/);
    // 앵커를 바꾼 목록(ask)을 만든 뒤엔 바꾸기 전 목록(hosted)을 쓰지 않는다 — 등록·카드 행이 갈리면 세션은 X, 카드·보고서는 Y가 된다.
    const askDef = code.indexOf(": hosted;");
    expect(askDef).toBeGreaterThan(-1);
    expect(code.slice(askDef + ": hosted;".length)).not.toMatch(/\bhosted\b/);
  });

  it("🔴 확인하는 순간 합칠 후보를 다시 본다 — 창이 열린 사이 결석이 되면 옛 상태로 되써 출석으로 뒤집혔다", () => {
    const client = read("src/features/onescreen/components/onescreen-client.tsx");
    const fn = client.slice(client.indexOf("async function resolveMakeupAsk("), client.indexOf("async function linkMakeupToAbsenceCell("));
    const code = fn.replace(/\/\/.*$/gm, "");
    expect(code).toMatch(/planMakeupMerge\(card\.subjects, new Set\(\[was\.subjectKey\]\)\)/);
    const swap = "choice = { ...picked, candidate: fresh };";
    const guard = code.indexOf("if (!fresh) {");
    expect(guard).toBeGreaterThan(-1);
    expect(code.indexOf(swap)).toBeGreaterThan(guard);
    expect(code.slice(guard, code.indexOf(swap))).toContain("return;"); // 합칠 수 없으면 멈춘다
    expect(code.slice(code.indexOf(swap) + swap.length)).not.toContain("picked"); // 뒤에선 옛 스냅샷을 안 쓴다
  });

  it("🔴 보강 빼기는 앵커가 학생의 정규 반이면 출결을 지우지 않는다(정규 칸 보호)", () => {
    const client = read("src/features/onescreen/components/onescreen-client.tsx");
    expect(client).toContain("const anchorIsRegular = !!su.makeupClassId && student.subjects.some((x) => !x.makeup && x.classId === su.makeupClassId);");
    expect(client).toContain("classId: anchorIsRegular ? null : su.makeupClassId ?? null,");
  });

  it("🔴 같은 학생을 다시 추가해 보강 행이 이미 있으면 멈춘다 — 고른 반에 칸이 하나 더 서지 않게", () => {
    const client = read("src/features/onescreen/components/onescreen-client.tsx");
    expect(client).toContain("if (!addSeparateMakeupRows(existing, ask.mk)) return;");
    // 고른 반과 과목이 같은 행만 앵커를 단다.
    expect(client).toMatch(/su\.subjectKey === host\.subject/);
  });
});
