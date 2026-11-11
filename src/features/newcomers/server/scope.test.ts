import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 신규생 관리 권한이 여는 범위(2026-11-11 적대 리뷰) — 강사에게 '담당'을 연 학원에서 이 권한을 "있다/없다"로만 읽는 화면은
 * 강사에게 남의 기록까지 연다(약속·인계가 그랬다). 판정 한 곳(`scope.ts`)과, 이 권한을 읽는 자리를 잠근다.
 */
const m = vi.hoisted(() => ({ level: "none" as string, erased: false, user: null as null | { systemRole: string } }));
vi.mock("@/lib/auth/perm-matrix", () => ({ accessLevelTenant: async () => m.level, readonlyViewErasedScope: async () => m.erased }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn(async () => m.user) }));

import { getCurrentUser } from "@/lib/auth/current-user";
import { newcomerScopeOf, readsAllNewcomers } from "./scope";

beforeEach(() => { m.level = "none"; m.erased = false; m.user = null; vi.mocked(getCurrentUser).mockClear(); });

describe("newcomerScopeOf — 없음 · 담당 범위 · 지점 전체", () => {
  it.each([
    ["admin", "none", false, "none"],
    ["admin", "full", false, "all"],
    ["viewer", "readonly", false, "all"],
    ["manager", "scoped", false, "scoped"],
    // 강사는 값이 무엇이든 담당 범위다(신규생 관리 화면 followupAccess와 같은 규칙).
    ["teacher", "scoped", false, "scoped"],
    ["teacher", "full", false, "scoped"],
    ["teacher", "none", false, "none"],
    // 읽기 강사뷰는 대상 강사의 담당을 읽기로 누른다 — 지워진 범위를 되살린다(#154 ③).
    ["master", "readonly", true, "scoped"],
  ] as const)("%s · %s · 지워진 담당 %s → %s", async (role, level, erased, want) => {
    m.level = level; m.erased = erased;
    expect(await newcomerScopeOf(role)).toBe(want);
  });

  it("readsAllNewcomers — 보는 사람(강사뷰면 그 강사)으로 판정하고, 지점 전체로 읽을 때만 참", async () => {
    expect(await readsAllNewcomers()).toBe(false); // 로그인 없음
    m.user = { systemRole: "counselor" }; m.level = "full";
    expect(await readsAllNewcomers()).toBe(true);
    expect(getCurrentUser).toHaveBeenLastCalledWith({ teacherView: true });
    m.user = { systemRole: "teacher" }; m.level = "scoped";
    expect(await readsAllNewcomers()).toBe(false);
    m.user = { systemRole: "viewer" }; m.level = "readonly";
    expect(await readsAllNewcomers()).toBe(true);
  });
});

describe("배선 가드 — 신규생 관리 권한을 읽는 자리", () => {
  const SRC = join(process.cwd(), "src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f.startsWith("._")) return [];
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const READS = /\b(canAccessTenant|canWriteTenant|canManageTenant|accessLevelTenant)\(\s*[^()]*?,\s*["']newcomers["']\s*\)/g;

  /**
   * 이 권한을 직접 읽어도 되는 자리 — 까닭과 함께. 새 자리가 생기면 이 시험이 실패한다:
   * "권한이 있다"만으로 남의 기록을 열지 않는지 확인하고(전체 열람은 `newcomerScopeOf(…) === "all"` · `readsAllNewcomers()`), 여기에 까닭을 적는다.
   */
  const ALLOWED: Record<string, string[]> = {
    // 판정 한 곳.
    "features/newcomers/server/scope.ts": ["accessLevelTenant"],
    // 화면 문(없으면 거절) + 보고 쓰기 — 담당 범위는 바로 아래에서 scope.ts로 가른다.
    "features/newcomers/server/followup-query.ts": ["canAccessTenant", "canWriteTenant"],
    // 체크 쓰기 — 강사·'담당'은 그 자리에서 막는다(쓰기라 읽기 강사뷰의 지워진 범위는 볼 일이 없다).
    "features/newcomers/server/actions.ts": ["accessLevelTenant", "canWriteTenant"],
    // 약속·인계 — 전체 열람(readAll)은 scope.ts로, 여기는 관리('전체')·기여(쓰기) 여부만.
    "features/student-care/server/access.ts": ["canManageTenant", "canWriteTenant"],
    // 원생 통합 보기 — 권한이 없으면 칸을 닫고, 있으면 studentOnboardingSection(followupAccess)이 담당 범위를 다시 가른다.
    "features/student-hub/server/query.ts": ["canAccessTenant"],
  };

  it("🔴 허용 목록 밖에서 이 권한을 직접 읽지 않는다", () => {
    const found: Record<string, string[]> = {};
    for (const p of files(SRC)) {
      const hits = [...strip(readFileSync(p, "utf8")).matchAll(READS)].map((x) => x[1]!);
      if (hits.length) found[p.slice(SRC.length + 1).split("\\").join("/")] = [...new Set(hits)].sort();
    }
    expect(found).toEqual(ALLOWED);
  });

  /**
   * 두 번째 겹 — 위 정규식은 `f(역할, "newcomers")` 꼴만 잡는다. 권한 키를 **배열·변수로 넘기는 꼴**
   * (`KEYS.map((k) => canAccessTenant(role, k))` · `"newcomers" as MenuKey` · 매트릭스를 직접 쓰는 `canAccess`)은 놓친다.
   * 그래서 '따옴표로 적은 newcomers'와 권한 함수가 **같은 파일에 함께** 있는 파일을 전부 세고, 까닭과 함께 잠근다.
   */
  const PERMISSION_FN = /\b(canAccessTenant|canWriteTenant|canManageTenant|accessLevelTenant|canAccess|canWrite|accessLevel|menuGate|requireAccess)\b/;
  const KEY = /["'`]newcomers["'`]/;
  const KEY_WITH_PERMISSION_FN: Record<string, string> = {
    "app/(shell)/newcomers/page.tsx": "화면 문(requireAccess) — 범위는 followupAccess가 가른다",
    "app/(shell)/newcomers/stats/page.tsx": "화면 문(requireAccess) — 담당 범위 계정은 /newcomers로 돌려보낸다",
    "features/newcomers/server/scope.ts": "판정 한 곳",
    "features/newcomers/server/followup-query.ts": "화면 문 + 보고 쓰기 — 범위는 scope.ts",
    "features/newcomers/server/actions.ts": "체크 쓰기 — 강사·'담당'은 막는다",
    "features/student-care/server/access.ts": "약속·인계 — 전체 열람은 scope.ts, 여기는 관리·기여 여부만",
    "features/student-hub/server/query.ts": "원생 통합 보기 — studentOnboardingSection(followupAccess)이 범위를 다시 가른다",
    // 키를 배열로 넘기는 자리(정규식 첫 겹이 못 잡는다).
    "features/teacher-hub/server.ts": "강사 통합 보기 — 원장 계정만 여는 화면(teacherHubAccess) · '담당 약속'은 그 강사가 맡은 약속만(owner_id) 읽는다",
    "features/work-records/server.ts": "업무 작성센터 바로가기 줄 — 링크를 세울지만 정한다(SHORTCUT_KEYS · 자료를 읽지 않는다)",
    "features/work-records/workspace.tsx": "그 바로가기 카드의 정의(링크) — 서버가 내려준 열람 여부로 세운다",
    // 운영실 — 강사에게 닫힌 화면(대시보드 × 강사 칸 잠금). 값은 학원 전체 집계다.
    "features/dashboard/overview/server.ts": "운영실 신규생 칸 — 강사는 운영실을 열 수 없다",
    "features/dashboard/server/briefing.ts": "일일 브리핑(원장 기준) — 신규생 관리 기능이 켜져 있는지만 본다(보는 사람의 권한이 아니다)",
    // 메뉴·권한 정의(자료를 읽지 않는다).
    "lib/menu-hub.ts": "메뉴 판 정의",
    "lib/permissions.ts": "권한 표 정의",
  };

  it("🔴 권한 키를 배열·변수로 넘기는 꼴까지 — 'newcomers' 키와 권한 함수가 함께 있는 파일은 까닭과 함께 잠근다", () => {
    const found = files(SRC)
      .filter((p) => { const code = strip(readFileSync(p, "utf8")); return KEY.test(code) && PERMISSION_FN.test(code); })
      .map((p) => p.slice(SRC.length + 1).split("\\").join("/"))
      .sort();
    expect(found).toEqual(Object.keys(KEY_WITH_PERMISSION_FN).sort());
    // 첫 겹의 허용 목록은 이 목록 안에 있다(직접 읽는 자리는 모두 까닭이 적혀 있다).
    for (const file of Object.keys(ALLOWED)) expect(KEY_WITH_PERMISSION_FN[file], file).toBeTruthy();
  });

  it("🔴 약속·인계 · 원생 상세 · 상담 상세 · 연결 탐색의 90일 점검은 '지점 전체로 읽는가'로 판정한다", () => {
    const read = (...p: string[]) => strip(readFileSync(join(SRC, ...p), "utf8"));
    const care = read("features", "student-care", "server", "access.ts");
    expect(care).toMatch(/newcomerScopeOf\(user\.systemRole\)/);
    expect(care).toMatch(/const readAll = scope === "all";/);
    expect(care).not.toMatch(/canAccessTenant\([^)]*"newcomers"\)/);
    for (const page of [["app", "(shell)", "students", "[id]", "page.tsx"], ["app", "(shell)", "enrollment", "[id]", "page.tsx"]]) {
      expect(read(...page), page.join("/")).toMatch(/readsAllNewcomers\(\)/);
    }
    const explore = read("features", "explore", "server", "student-care-sector.ts");
    expect(explore).toMatch(/if \(!\(await readsAllNewcomers\(\)\)\) return \{ state: "denied"/);
    // 신규생 관리 화면의 담당 범위도 같은 함수에서 나온다.
    expect(read("features", "newcomers", "server", "followup-query.ts")).toMatch(/const scoped = \(await newcomerScopeOf\(user\.systemRole\)\) === "scoped";/);
  });
});
