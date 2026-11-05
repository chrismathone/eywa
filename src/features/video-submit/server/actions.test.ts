import { beforeEach, describe, expect, it, vi } from "vitest";
import { C, S, T } from "./test-fixture.test-util";

const m = vi.hoisted(() => ({
  access: vi.fn(), write: vi.fn(), student: vi.fn(), enrollments: vi.fn(), available: vi.fn(), revoke: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: m.access }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.write }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ modules: { disabled: [] } }) }));
vi.mock("@/features/students/server/queries", () => ({ getStudentById: m.student, getStudentEnrollments: m.enrollments }));
vi.mock("./availability", () => ({ videoSubmitAvailability: m.available }));
vi.mock("./links", () => ({ revokeSubmitLinks: m.revoke }));

import * as actions from "./actions";
import { revokeVideoSubmitLinks } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  m.access.mockResolvedValue({ id: "user-1", tenantId: T, systemRole: "admin" });
  m.write.mockResolvedValue(true);
  m.student.mockResolvedValue({ id: S, name: "류태경" });
  m.enrollments.mockResolvedValue([{ classId: C, className: "LT4", endDate: null, isTransferred: false }]);
  m.available.mockResolvedValue({ ok: true });
  m.revoke.mockResolvedValue(2);
});

describe("학생 상세 — 이미 나간 제출 링크 끊기", () => {
  it("🔴 학생마다 링크를 새로 만드는 길은 없다(원장 2026-10-03 \"개별링크는 더이상 생성하지않고\") — 이 파일엔 끊기만 남았다", () => {
    // 링크를 만드는 곳 전수는 report-link.test.ts의 `mintSubmitLink(` 호출부 가드가 본다(올리기 사이트 하나뿐).
    expect(Object.keys(actions)).toEqual(["revokeVideoSubmitLinks"]);
  });
  it("끊기 = 그 학생 × 반 전부, 감사로그에 개수", async () => {
    expect(await revokeVideoSubmitLinks(S, C)).toEqual({ ok: true, revoked: 2 });
    expect(m.revoke).toHaveBeenCalledWith(expect.anything(), { tenantId: T, studentId: S, classId: C, userId: "user-1" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "lesson_report_video_link_revoke", metadata: expect.objectContaining({ revoked: 2 }) }));
  });
  it("볼 수 없는 학생·다니지 않는 반·기능을 쓸 수 없는 학원·모양이 다른 번호면 끊지 않는다", async () => {
    m.student.mockResolvedValueOnce(null);
    expect(await revokeVideoSubmitLinks(S, C)).toMatchObject({ ok: false });
    expect(await revokeVideoSubmitLinks(S, "77777777-7777-4777-8777-777777777777")).toMatchObject({ ok: false, error: "지금 다니는 반이 아닙니다." });
    m.available.mockResolvedValueOnce({ ok: false, reason: "no_config" });
    expect(await revokeVideoSubmitLinks(S, C)).toMatchObject({ ok: false });
    expect(await revokeVideoSubmitLinks("x", C)).toMatchObject({ ok: false });
    expect(m.revoke).not.toHaveBeenCalled();
  });
  it("🔴 원생목록 읽기 권한(쓰기 아님)이면 끊지 않는다 — requireAccess는 읽기도 통과시킨다(감사 2026-11-05)", async () => {
    m.write.mockResolvedValueOnce(false);
    expect(await revokeVideoSubmitLinks(S, C)).toMatchObject({ ok: false, error: expect.stringContaining("권한") });
    expect(m.write).toHaveBeenCalledWith("admin", "students");
    expect(m.revoke).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
});
