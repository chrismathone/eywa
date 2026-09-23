import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MENU_ACCESS } from "@/lib/permissions";

/**
 * 🔴 **성적관리 = 강사는 담임·부담임 반만, 부원장·관리자는 모든 반** — 원장 2026-09-23
 *    (*"성적관리는 자기가 담임, 부담임반으로 되어있으면 나오고 부원장 관리자 직급은 모든반"*).
 *
 * 🔑 두 조각이 **함께** 있어야 한다: 권한만 열면 과목 전체가 보이고(그 전 상태), 필터만 넣으면 메뉴가
 *    안 열린다. 그래서 기본 권한과 반 필터를 한 파일에서 잠근다.
 */
const ROOT = process.cwd();
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

describe("성적관리 — 반 스코프", () => {
  it("기본 권한: 관리자 계열 full · 강사 scoped", () => {
    const exams = MENU_ACCESS.exams;
    // 부원장은 **직급이 아니라 역할(admin)**로 갈린다(실측 2026-09-23 허은진·정유진 둘 다 admin).
    expect(exams.master).toBe("full");
    expect(exams.admin).toBe("full");
    expect(exams.manager).toBe("full");
    expect(exams.teacher).toBe("scoped");
    // 🔴 학생에게는 절대 열리지 않는다.
    expect(exams.student).toBe("none");
  });

  it("🔴 강사는 **반 단위로** 좁힌다 — 정렬로 감추지 않는다([[#77]])", () => {
    const q = read("src", "features", "grades", "server", "queries.ts");
    // 담임 ∪ 부담임을 구하는 전용 헬퍼를 탄다(공용 스코프는 담임만 본다).
    expect(q).toContain("gradeTeacherClassIds");
    // 목록을 실제로 거른다 — 여기가 빠지면 과목 전체가 다시 보인다.
    expect(q).toContain("scope ? tracked.filter((c) => myClassIds.has(c.id)) : tracked");
  });

  it("헬퍼는 담임과 부담임을 **둘 다** 본다", () => {
    const h = read("src", "features", "grades", "server", "teacher-classes.ts");
    expect(h).toContain('from("classes")');          // 담임
    expect(h).toContain('from("class_schedules")');  // 부담임(교시 담당)
    // 🔴 공용 스코프를 넓히지 않는다 — 그걸 쓰는 다른 화면 범위가 함께 넓어진다.
    // ⚠️ **import만** 본다 — 왜 안 쓰는지 적은 주석에도 그 이름이 나온다(설명을 결과로 오인하면 안 된다).
    expect(h).not.toContain("auth/teacher-scope");
  });
});
