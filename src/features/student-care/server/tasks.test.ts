import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ access: vi.fn(), viewer: vi.fn(), list: vi.fn() }));
vi.mock("./access", () => ({ careAccess: h.access }));
vi.mock("@/features/staff-tasks/server/gate", () => ({ getStaffTaskViewer: h.viewer }));
vi.mock("@/features/staff-tasks/server/queries", () => ({ listTasks: h.list }));
import { getCareTasks } from "./tasks";
import { testDb } from "./test-db";

let db: ReturnType<typeof testDb>;
const user = { id: "staff-a", tenantId: "tenant-a" };
const studentId = "student-a";
beforeEach(() => {
  vi.clearAllMocks();
  db = testDb({
    student_consultations: [
      { id: "own", tenant_id: "tenant-a", student_id: studentId, counselor_id: user.id },
      { id: "other", tenant_id: "tenant-a", student_id: studentId, counselor_id: "staff-b" },
      { id: "outside", tenant_id: "tenant-b", student_id: studentId, counselor_id: user.id },
      { id: "other-student", tenant_id: "tenant-a", student_id: "student-b", counselor_id: user.id },
    ],
    progress_events: [{ id: "progress-a", tenant_id: "tenant-a", student_id: studentId, event_type: "jump_error" },
      { id: "progress-b", tenant_id: "tenant-b", student_id: studentId, event_type: "overlap_error" },
      { id: "not-an-anomaly", tenant_id: "tenant-a", student_id: studentId, event_type: "advance" }],
  });
  h.access.mockResolvedValue({ user, db, counselorId: user.id, canReadConsultations: true });
  h.viewer.mockResolvedValue({ user, canMonitor: false });
  h.list.mockResolvedValue({ items: [], total: 0, page: 0, pageSize: 30 });
});
describe("학생 업무 권한·원본 연결", () => {
  it("학생 열람을 통과해도 내가 맡은 업무만 조회한다", async () => {
    expect(await getCareTasks(studentId, "open")).toMatchObject({ canMonitor: false, total: 0 });
    expect(h.list.mock.calls.map(([arg]) => arg)).toEqual([
      expect.objectContaining({ tenantId: user.tenantId, assigneeId: user.id, kind: "attendance_absent_desk", subjectIds: [studentId] }),
      expect.objectContaining({ tenantId: user.tenantId, assigneeId: user.id, kind: "followup_due", subjectIds: ["own"] }),
      expect.objectContaining({ tenantId: user.tenantId, assigneeId: user.id, kind: "progress_anomaly", subjectIds: ["progress-a"] }),
    ]);
  });
  it("업무 현황 권한만으로 상담 담당자 제한이 풀리지 않는다", async () => {
    h.viewer.mockResolvedValue({ user, canMonitor: true });
    await getCareTasks(studentId, "closed");
    const args = h.list.mock.calls.map(([arg]) => arg);
    expect(args.every((arg) => arg.assigneeId === null && arg.filter === "closed")).toBe(true);
    expect(args.find((arg) => arg.kind === "followup_due").subjectIds).toEqual(["own"]);
  });
  it("상담 권한이 없으면 상담 원본도 상담 업무도 조회하지 않는다", async () => {
    h.access.mockResolvedValue({ user, db, counselorId: null, canReadConsultations: false });
    await getCareTasks(studentId, "open");
    expect(db.calls.some((c) => c.table === "student_consultations")).toBe(false);
    expect(h.list.mock.calls.some(([arg]) => arg.kind === "followup_due")).toBe(false);
  });
  it.each(["student", "viewer", "tenant", "identity"])("권한·지점·보기 계정 경계를 차단한다: %s", async (kind) => {
    if (kind === "student") h.access.mockResolvedValue(null);
    if (kind === "viewer") h.viewer.mockResolvedValue(null);
    if (kind === "tenant") h.viewer.mockResolvedValue({ user: { ...user, tenantId: "tenant-b" }, canMonitor: true });
    if (kind === "identity") h.viewer.mockResolvedValue({ user: { ...user, id: "other" }, canMonitor: true });
    expect(await getCareTasks(studentId, "open")).toBeNull();
    expect(h.list).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });
  it("원본 조회 실패를 정상·업무 없음으로 표시하지 않는다", async () => {
    db.failures.add("progress_events");
    await expect(getCareTasks(studentId, "open")).rejects.toThrow();
    expect(h.list).not.toHaveBeenCalled();
  });
  it("업무 조회 실패도 빈 목록으로 숨기지 않는다", async () => {
    h.list.mockRejectedValue(new Error("missing table"));
    await expect(getCareTasks(studentId, "open")).rejects.toThrow("missing table");
  });
  it("1000건이 넘는 원본은 끝까지 읽고 업무 요청은 100개씩 나눈다", async () => {
    db.tables.progress_events = Array.from({ length: 1001 }, (_, i) => ({
      id: `progress-${String(i).padStart(4, "0")}`, tenant_id: user.tenantId, student_id: studentId, event_type: "jump_error",
    }));
    await getCareTasks(studentId, "open");
    const args = h.list.mock.calls.map(([arg]) => arg).filter((arg) => arg.kind === "progress_anomaly");
    expect(args).toHaveLength(11);
    expect(args.every((arg) => arg.subjectIds.length <= 100)).toBe(true);
    expect(args.flatMap((arg) => arg.subjectIds)).toHaveLength(1001);
    expect(db.calls.filter((c) => c.table === "progress_events").map((c) => c.from)).toEqual([0, 1000]);
  });
});
