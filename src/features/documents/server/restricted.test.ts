import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));

import { canSeeRestrictedDocuments, hideRestrictedDocuments, RESTRICTED_DOCUMENT_ROLES } from "./restricted";

beforeEach(() => vi.clearAllMocks());

describe("자료실 제한 문서 — 행위자(강사뷰면 대상) 역할", () => {
  it("강사뷰 대상 신원으로 판정한다(실제 로그인 계정이 아니라)", async () => {
    m.user.mockImplementation(async (opts?: { teacherView: boolean }) =>
      opts?.teacherView ? { id: "X", systemRole: "teacher" } : { id: "A", systemRole: "master" });
    expect(await hideRestrictedDocuments()).toBe(true);
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
  });

  it("사무 역할만 본다 — 강사 · 상담 · 뷰어 · 아르바이트는 못 본다, 비로그인도 못 본다", async () => {
    for (const role of ["master", "admin", "manager", "accountant"] as const) expect(canSeeRestrictedDocuments(role)).toBe(true);
    for (const role of ["teacher", "counselor", "viewer", "parttime", "student"] as const) expect(canSeeRestrictedDocuments(role)).toBe(false);
    m.user.mockResolvedValue(null);
    expect(await hideRestrictedDocuments()).toBe(true);
  });

  it("역할 목록이 DB 백스톱(academy_documents_restricted_guard 0170a, 직원 연결 없는 행)과 같다", () => {
    const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "s1_season1.sql"), "utf8");
    const at = sql.lastIndexOf("create policy academy_documents_restricted_guard");
    const policy = sql.slice(at, sql.indexOf(";", at));
    const roles = policy.match(/staff_user_id is null and \(select public\.auth_system_role\(\)\) in \(([^)]*)\)/)?.[1];
    expect(roles?.split(",").map((r) => r.trim().replace(/'/g, ""))).toEqual([...RESTRICTED_DOCUMENT_ROLES]);
  });
});
