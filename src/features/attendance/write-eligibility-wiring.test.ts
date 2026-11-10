import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 출결 쓰기 학생 자격 = 단건·일괄·범위가 **같은 판정 한 벌**(write-eligibility.ts)을 부른다(수정 계획 P1-A 4-2, 결정 #5).
 * 예전엔 세 경로가 손으로 따로 써서 이미 어긋나 있었다 — 한 경로만 고치면 다시 갈라지지 않게 배선을 잠근다.
 */
const ACTIONS = readFileSync(path.join(process.cwd(), "src/features/attendance/server/actions.ts"), "utf8");

function fnBody(name: string): string {
  const start = ACTIONS.indexOf(`export async function ${name}(`);
  expect(start, `${name}가 없다`).toBeGreaterThanOrEqual(0);
  const next = ACTIONS.indexOf("\nexport ", start + 1);
  return ACTIONS.slice(start, next === -1 ? undefined : next);
}

describe("출결 쓰기 학생 자격 — 세 경로가 판정 한 벌을 부른다", () => {
  it.each(["setAttendanceCell", "setAttendanceBulk", "setAttendanceRange"])("%s → writeEligibility + blockedByCorrectOnly", (name) => {
    const body = fnBody(name);
    expect(body).toContain("writeEligibility(");
    expect(body).toContain("blockedByCorrectOnly(");
  });

  it.each(["setAttendanceBulk", "setAttendanceRange"])("%s — native는 칸마다가 아니라 한 번에(nativeWriteKeys)", (name) => {
    const body = fnBody(name);
    expect(body).toContain("nativeWriteKeys(");
    expect(body).not.toContain("nativeWriteAllowance(");
  });

  it("일별 폼(saveAttendance)도 같은 판정 — 고칠 행은 서버가 다시 고르고 폼의 existing: 값은 오래된 화면 판별에만(결정 #5 ③)", () => {
    const body = fnBody("saveAttendance");
    expect(body).toContain("writeEligibility(");
    expect(body).toContain("blockedByCorrectOnly(");
    expect(body).toContain("dayRecordIdsByStudent(");
    // 폼 값은 formSeen(비교용)으로만 — 쓰기 대상 existingIds는 빈 배열에서 시작해 서버 값으로만 채운다
    expect(body).toContain("const existingIds: string[] = [];");
    expect(body).toContain("const formSeen = String(formData.get(`existing:${studentId}`)");
    expect(body.match(/formData\.get\(`existing:/g)?.length).toBe(1);
    expect(body).toContain("r.existingIds = shared.recordIds.get(r.studentId) ?? [];");
  });

  it("범위는 수업 나누기도 본다(예전엔 범위만 빠져 있었다)", () => {
    expect(fnBody("setAttendanceRange")).toContain("splitIntoKeys(");
  });

  it("native 조회 실패는 새 행이 필요한 칸이 빠질 때만 요청 전체를 막는다 — 정정만인 칸은 영향 없음", () => {
    expect(fnBody("setAttendanceBulk")).toContain("if (dropped.length > 0 && bulkNativeUnknown) return { error: bulkNativeUnknown };");
    expect(fnBody("setAttendanceRange")).toContain("if (correctOnlyDropped > 0 && rangeNativeUnknown) return { error: rangeNativeUnknown };");
    // 단건: 기록이 있으면 조회 실패에도 정정은 진행한다
    expect(fnBody("setAttendanceCell")).toContain("if (n.error && !hasRecord) return { error: n.error };");
  });

  it("즉석 보강(allowMakeup)은 makeup 저장에서만 듣고, 학생·반의 지점 실재를 서버가 확인한다(결정 #5 ②)", () => {
    const body = fnBody("setAttendanceCell");
    expect(body).toContain('const instantMakeup = input.allowMakeup === true && status === "makeup" && !noteOnly;');
    expect(body).toContain("instantMakeupTargetsOk(supabase, user.tenantId, studentId, classId)");
    // 판정에서 플래그를 직접 읽는 곳은 instantMakeup 한 줄뿐이다
    expect(body.split("input.allowMakeup").length - 1).toBe(1);
  });
});

/** 화면에서 `allowMakeup: true`를 싣는 곳 = '+ 보강 학생 추가' 한 곳뿐(일반 저장 우회 금지, 결정 #5 ②). */
describe("allowMakeup을 보내는 화면", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
  }
  it("보강 추가 흐름(makeup-add-flow.tsx)만", () => {
    const root = path.join(process.cwd(), "src");
    const hits = walk(root)
      .filter((f) => /allowMakeup:\s*true/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f));
    expect(hits).toEqual(["features/attendance/components/makeup-add-flow.tsx"]);
  });
});
