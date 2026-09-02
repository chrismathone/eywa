import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 보이지 않는 '보강' 반(0241a)의 **성질 넷**이 조용히 깨지지 않게.
 * 규약과 배경은 [`features/classes/makeup-pool.ts`](../classes/makeup-pool.ts) 헤더에 있다.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");
const server = read("features", "attendance", "server", "makeup-pool.ts");
const page = read("app", "(shell)", "attendance", "page.tsx");

describe("보이지 않는 '보강' 반", () => {
  it("🔴 만들 때 `is_active=false` — 이게 '어디에도 안 보이게'의 주 장치다", () => {
    expect(server).toContain("is_active: false");
    expect(server).toContain("is_makeup_pool: true");
  });

  it("🔴 교시·수강을 만들지 않는다 — 있으면 '미입력 반' 신호와 명단·청구가 흔들린다", () => {
    expect(server).not.toContain('from("class_schedules")');
    expect(server).not.toContain('from("enrollments")');
  });

  it("🔴 자동 입력은 **빈 칸만** 채운다(사람이 고친 값을 안 덮는다)", () => {
    // 먼저 조회해서 있으면 그대로 둔다.
    expect(server).toMatch(/if \(\(exists \?\? \[\]\)\.length > 0\) return \{ ok: true/);
    expect(server).toContain('status: "makeup"');
  });

  it("🔴 출석부는 이 반을 **일부러** 불러온다(활성 목록엔 절대 안 들어오므로)", () => {
    expect(page).toContain("findMakeupPoolClass(user.tenantId, effectiveTeacher)");
    // 명단·칸·시수는 평소 쓰는 매트릭스가 그대로 만든다(특별 코드 금지).
    expect(page).toContain("getMonthlyAttendanceMatrix(month, makeupPoolClassId,");
    /**
     * 🔴 스코프 통과 인자를 **반드시** 함께 넘긴다 — 이 반은 활성 목록에 없어서, 안 넘기면 강사 화면에서
     *    classId가 조용히 null이 되고 묶음이 통째로 빈다(에러도 안 난다).
     */
    expect(page).toContain('"month", null, null, makeupPoolClassId)');
  });

  it("⚠️ 0241a 미적용이어도 안 죽는다 — 컬럼 없으면 null/빈 배열로 조용히 넘어간다", () => {
    expect(server).toContain("isMissingColumn");
    expect(server).toContain("return []; //");
  });

  it("🔴 사무실 수업목록에서 뺄 때 **컬럼을 쿼리에 안 넣는다**(미적용 시 400으로 화면이 죽는다)", () => {
    const q = read("features", "classes", "server", "queries.ts");
    expect(q).toContain("listMakeupPoolClassIds()");
    expect(q).not.toContain('.eq("is_makeup_pool"');
  });

  it("⚠️ 판정은 컬럼이지 이름이 아니다 — 화면·서버 어디서도 반 이름으로 거르지 않는다", () => {
    for (const src of [server, page]) {
      expect(src).not.toMatch(/class_name.*보강|보강.*class_name/);
    }
  });
});
