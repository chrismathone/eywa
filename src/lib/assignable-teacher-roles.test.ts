/**
 * "담임이 될 수 있는 역할" 목록이 **여러 벌로 복제되는 것**을 막는 회귀 테스트.
 *
 * 배경(2026-08-03): 같은 배열 `["teacher","manager","master"]`이 선택지 쿼리·서버 검증·시간표 임포트
 * 세 곳에 복제돼 있었고 `admin`이 전부 빠져 있었다. 07-22에 필터 한 곳만 고쳐 원인이 남았고,
 * 08-03엔 선택지만 고쳐 **"드롭다운엔 뜨는데 저장하면 거절"** 상태가 잠깐 생겼다.
 * → 값 잠금 + 복제 금지를 테스트로 못박는다. 새 소비처는 `ASSIGNABLE_TEACHER_ROLES`를 import할 것.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSIGNABLE_TEACHER_ROLES, isAssignableTeacherRole, SYSTEM_ROLES } from "./permissions";

describe("ASSIGNABLE_TEACHER_ROLES", () => {
  it("실제로 반을 맡는 역할을 모두 포함한다 (admin 누락이 두 번 터진 자리)", () => {
    expect([...ASSIGNABLE_TEACHER_ROLES].sort()).toEqual(["admin", "manager", "master", "teacher"]);
  });

  it("SYSTEM_ROLES에 없는 값이 섞이지 않는다", () => {
    for (const role of ASSIGNABLE_TEACHER_ROLES) expect(SYSTEM_ROLES).toContain(role);
  });

  it("학생·뷰어 등 수업을 맡지 않는 역할은 거부한다", () => {
    for (const role of ["student", "viewer", "counselor", "accountant"]) {
      expect(isAssignableTeacherRole(role)).toBe(false);
    }
    // DB에서 온 빈 값·null도 안전하게 거부(맨몸 문자열 비교라 throw 없음).
    for (const bad of [null, undefined, "", "TEACHER"]) expect(isAssignableTeacherRole(bad)).toBe(false);
  });
});

/**
 * src/ 전체에서 "역할 배열을 손으로 적은 곳"을 찾는다 — 이 파일과 permissions.ts만 허용.
 *
 * ⚠️ `withFileTypes`로 순회한다 — 엔트리마다 `statSync`를 부르면 src 전체 스캔이 vitest 기본
 *    타임아웃(5s)에 걸린다(postgrest-embed-hints.test.ts가 같은 이유로 먼저 고친 자리). 디렉터리
 *    판정은 dirent가 이미 갖고 있어 syscall이 절반으로 준다. 파일이 늘수록 차이가 커진다.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) sourceFiles(join(dir, entry.name), out);
    else if (/\.tsx?$/.test(entry.name)) out.push(join(dir, entry.name));
  }
  return out;
}

/**
 * 잡아야 하는 것 = **"가르치는 사람"을 뜻하는 역할 배열인데 `admin`이 빠진 것.**
 * `teacher`와 `master`를 함께 적었다면 "수업을 맡는 사람"을 세는 중이고, injaewon에선 관리자가 그 안에 있다.
 * ⚠️ 반대로 `admin`이 들어 있는 배열은 통과 — 상담 담당자 선택지처럼 **다른 질문**의 목록
 * (`counselor` 포함)까지 막으면 거짓 경보가 된다.
 */
describe("역할 배열 복제 금지", () => {
  it("src/ 어디에도 admin이 빠진 담임 역할 목록을 적지 않는다", () => {
    const root = join(process.cwd(), "src");
    const allowed = new Set([join(root, "lib", "assignable-teacher-roles.test.ts")]);
    const offenders: string[] = [];
    for (const file of sourceFiles(root)) {
      if (allowed.has(file)) continue;
      for (const [literal] of readFileSync(file, "utf8").matchAll(/\[[^\]\n]*\]/g)) {
        if (!literal.includes('"teacher"') || !literal.includes('"master"')) continue;
        if (literal.includes('"admin"')) continue; // 관리자를 포함 = 정상
        offenders.push(`${file.slice(root.length + 1).replace(/\\/g, "/")} → ${literal}`);
      }
    }
    expect(offenders, `ASSIGNABLE_TEACHER_ROLES를 import할 것:\n${offenders.join("\n")}`).toEqual([]);
  }, 60_000); // 전수 스캔 — 혼자 1초대지만 전체 스위트 병렬에선 기본 5초를 넘겨 헛실패한다(2026-09-16 두 번 실측).
});
