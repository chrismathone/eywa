import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 인재원 연동 서버 코드 — **테넌트 격리 구조 검사**(todays-math tenant-guard 선례).
 *
 * admin 클라이언트는 RLS를 우회한다. students·classes·enrollments 조회·변경 하나라도 tenant_id가 빠지면 다른 학원
 * 학생의 짝을 읽거나 바꾼다 — 그래서 호출 모양을 세어 잠근다. 가드의 가드로 실제로 잡는지도 확인한다.
 */

const FILES = ["queries.ts", "link-actions.ts", "links.ts", "viewer.ts"].map((f) => ({
  name: f,
  src: readFileSync(path.join(__dirname, "server", f), "utf8"),
}));
const TABLES = ["students", "classes", "enrollments"] as const;

/** `.from("<표>")`부터 그 문장의 끝(`;`) 또는 다음 `.from(`까지 — 한 문장에 조회가 둘이어도 따로 본다. */
function statements(src: string): string[] {
  const out: string[] = [];
  for (const t of TABLES) {
    const needle = `.from("${t}")`;
    let i = 0;
    while ((i = src.indexOf(needle, i)) !== -1) {
      const ends = [src.indexOf(";", i), src.indexOf(".from(", i + 1)].filter((n) => n !== -1);
      out.push(src.slice(i, ends.length ? Math.min(...ends) : undefined));
      i += 1;
    }
  }
  return out;
}

const scoped = (stmt: string) => /\.eq\("tenant_id",\s*(tenantId|who\.tenantId)\)/.test(stmt);
const srcOf = (name: string) => FILES.find((f) => f.name === name)!.src;

describe("인재원 연동 — admin 조회·변경의 테넌트 격리", () => {
  it.each(FILES)("$name: 모든 students·classes·enrollments 호출이 tenant_id를 건다", ({ src }) => {
    const stmts = statements(src);
    expect(stmts.length).toBeGreaterThan(0);
    expect(stmts.filter((s) => !scoped(s)).map((s) => s.slice(0, 100))).toEqual([]);
  });

  it("[가드의 가드] tenant_id가 빠진 모양을 잡는다 — 같은 문장 안 두 번째 조회도 따로", () => {
    const bad = `admin.from("students").update({ ijw_student_id: null }).eq("id", studentId);`;
    expect(statements(bad).map(scoped)).toEqual([false]);
    const mixed = `Promise.all([admin.from("classes").select("id").in("id", c), admin.from("enrollments").select("id").eq("tenant_id", tenantId)]);`;
    expect(statements(mixed).map(scoped)).toEqual([false, true]);
  });

  it("link-actions는 async 함수만 export한다(#119)", () => {
    expect([...srcOf("link-actions.ts").matchAll(/^export\s+(?!async function)(\w+)/gm)].map((m) => m[1])).toEqual([]);
  });

  it("🔴 짝 잇기는 학생 기록 관리 권한(students full)으로만 — 강사(scoped)가 통과하는 canWriteTenant 금지", () => {
    const src = srcOf("link-actions.ts");
    expect(src).toContain('canManageTenant(user.systemRole, "students")');
    expect(src).not.toContain("canWriteTenant");
  });

  it("🔴 '한 번에 연결'은 학원 전체 이름 인원(유일성 재료)을 넘긴다 — 빠지면 match.ts가 한 번에 잇지 않는다", () => {
    expect(srcOf("links.ts")).toMatch(/suggestLinks\([\s\S]*?\{\s*eywaNameCounts\s*\}/);
  });

  it("🔴 JJ 강사 스코프는 학생 상세 열람과 같은 세 갈래(read-scope 엄격판)를 쓰고, 칩은 지금 도는 영어 반만", () => {
    expect(srcOf("viewer.ts")).toContain("teacherClassScopeStrict");
    expect(srcOf("viewer.ts")).toContain("hasLiveEnglishClass");
    expect(srcOf("viewer.ts")).not.toContain("effectiveTeacherScope"); // 담임 반만 보던 첫 구현으로 되돌리지 않게
  });

  it("🔴 read-scope 기본판(학생 상세)·엄격판(JJ실)은 같은 세 갈래를 본다", () => {
    const rs = readFileSync(path.join(__dirname, "..", "students", "server", "read-scope.ts"), "utf8");
    for (const name of ["teacherViewableClassIds", "teacherClassScopeStrict"]) {
      const at = rs.indexOf(`export const ${name}`);
      expect(at, name).toBeGreaterThan(-1);
      const body = rs.slice(at, rs.indexOf("});", at));
      expect(body, name).toContain('.from("classes")');
      expect(body, name).toContain('.from("class_schedules")');
      expect(body, name).toContain("getDelegatedClassIdsInRange");
    }
  });
});
