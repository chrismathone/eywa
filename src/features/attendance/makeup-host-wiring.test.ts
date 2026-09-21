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
  });

  it("보고서 저장 훅은 고른 수업을 받아, 그 반에 칸이 이미 있으면 보강 반을 만들지 않는다(시수 두 번 방지)", () => {
    expect(read("src/features/onescreen/server/actions.ts")).toMatch(/makeupClassId: input\.makeupClassId \?\? null/);
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
    expect(register).toMatch(/c\.id === entry\.makeupClassId && c\.subject === entry\.subject/);
    // 보강 반 컬럼(is_makeup_pool)을 새로 읽지 않는다([[#95]]) — getTeachingClasses가 활성 반만 준다.
    expect(fn).not.toContain("is_makeup_pool");
  });

  it("🔴 같은 학생을 다시 추가해 보강 행이 이미 있으면 멈춘다 — 고른 반에 칸이 하나 더 서지 않게", () => {
    const client = read("src/features/onescreen/components/onescreen-client.tsx");
    expect(client).toContain("if (!addSeparateMakeupRows(existing, ask.mk)) return;");
    // 고른 반과 과목이 같은 행만 앵커를 단다.
    expect(client).toMatch(/su\.subjectKey === host\.subject/);
  });
});
