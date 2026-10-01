import { beforeEach, describe, expect, it, vi } from "vitest";
import { C, S, T } from "./test-fixture.test-util";

const m = vi.hoisted(() => ({
  access: vi.fn(), student: vi.fn(), enrollments: vi.fn(), available: vi.fn(), mint: vi.fn(), revoke: vi.fn(), audit: vi.fn(),
}));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: m.access }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/config/app-url", () => ({ getAppUrl: () => "https://www.aywa.co.kr" }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ modules: { disabled: [] } }) }));
vi.mock("@/features/students/server/queries", () => ({ getStudentById: m.student, getStudentEnrollments: m.enrollments }));
vi.mock("./availability", () => ({ videoSubmitAvailability: m.available }));
vi.mock("./links", () => ({ mintSubmitLink: m.mint, revokeSubmitLinks: m.revoke }));

import { issueVideoSubmitLink, revokeVideoSubmitLinks } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  m.access.mockResolvedValue({ id: "user-1", tenantId: T });
  m.student.mockResolvedValue({ id: S, name: "류태경" });
  m.enrollments.mockResolvedValue([{ classId: C, className: "LT4", endDate: null, isTransferred: false }]);
  m.available.mockResolvedValue({ ok: true });
  m.mint.mockResolvedValue({ token: "T".repeat(43), id: "L1", expiresAt: "x" });
  m.revoke.mockResolvedValue(2);
});

describe("학생 상세 — 제출 링크 복사·끊기", () => {
  it("볼 수 있는 학생 × 지금 다니는 반이면 새 7일 링크(만든 날 기준)를 주고 감사로그를 남긴다", async () => {
    const r = await issueVideoSubmitLink(S, C);
    expect(r).toMatchObject({ ok: true, url: `https://www.aywa.co.kr/v/${"T".repeat(43)}` });
    expect(m.mint).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenantId: T, studentId: S, classId: C, origin: "manual", createdBy: "user-1" }));
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "lesson_report_video_link_issue" }));
  });
  it("볼 수 없는 학생(담당 아님·다른 지점)이면 만들지 않는다", async () => {
    m.student.mockResolvedValue(null);
    expect(await issueVideoSubmitLink(S, C)).toMatchObject({ ok: false });
    expect(m.mint).not.toHaveBeenCalled();
  });
  it("그 학생이 다니지 않는 반·끝난 수강의 반이면 만들지 않는다", async () => {
    expect(await issueVideoSubmitLink(S, "77777777-7777-4777-8777-777777777777")).toMatchObject({ ok: false, error: "지금 다니는 반이 아닙니다." });
    m.enrollments.mockResolvedValue([{ classId: C, className: "LT4", endDate: "2020-01-01", isTransferred: false }]);
    expect(await issueVideoSubmitLink(S, C)).toMatchObject({ ok: false });
    expect(m.mint).not.toHaveBeenCalled();
  });
  it("기능을 쓸 수 없는 학원이면 만들지 않는다", async () => {
    m.available.mockResolvedValue({ ok: false, reason: "no_config" });
    expect(await issueVideoSubmitLink(S, C)).toMatchObject({ ok: false });
    expect(m.mint).not.toHaveBeenCalled();
  });
  it("모양이 다른 번호는 DB를 묻지 않는다", async () => {
    expect(await issueVideoSubmitLink("x", C)).toMatchObject({ ok: false });
    expect(m.student).not.toHaveBeenCalled();
  });
  it("끊기 = 그 학생 × 반 전부, 감사로그에 개수", async () => {
    expect(await revokeVideoSubmitLinks(S, C)).toEqual({ ok: true, revoked: 2 });
    expect(m.revoke).toHaveBeenCalledWith(expect.anything(), { tenantId: T, studentId: S, classId: C, userId: "user-1" });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "lesson_report_video_link_revoke", metadata: expect.objectContaining({ revoked: 2 }) }));
  });
});
