import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ reconcile: vi.fn(), notify: vi.fn(), audit: vi.fn(), error: vi.fn() }));
vi.mock("@/features/video-homework/server/reconcile-outcomes", () => ({ reconcileVideoHomework: m.reconcile }));
vi.mock("@/features/notifications/server/notify", () => ({ notifyUsers: m.notify }));
vi.mock("@/features/audit/server/log", () => ({ logActionAs: m.audit }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: m.error }));
import { afterLinkUpload } from "./upload-notify";
beforeEach(() => { vi.clearAllMocks(); m.reconcile.mockResolvedValue({}); });
const input = { tenantId: "tenant", studentId: "s", videoId: "v", bytes: 123,
  route: { tenantId: "tenant", studentId: "s", subject: "math", school: null, grade: null, reason: "제출 링크", rootId: "root",
    classId: "c", teacherId: "teacher", className: "반", studentName: "학생", folderName: "folder", homeworkDate: "2026-10-01" } };
it("업로드 완료 후 해당 학생의 수동 상태를 실제 영상으로 재판정한다", async () => {
  await afterLinkUpload(input);
  expect(m.reconcile).toHaveBeenCalledWith("tenant", { studentId: "s" });
  expect(m.audit).toHaveBeenCalled();
});
it("후속 판정 실패가 성공한 업로드를 실패로 뒤집지 않는다 — 정기 작업에서 재시도", async () => {
  m.reconcile.mockRejectedValue(new Error("retry"));
  await expect(afterLinkUpload(input)).resolves.toBeUndefined();
  expect(m.error).toHaveBeenCalled();
  expect(m.notify).toHaveBeenCalled();
});
