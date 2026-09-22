import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferCandidate } from "@/features/enrollments/bulk-transfer";

const mocks = vi.hoisted(() => ({ list: vi.fn(), move: vi.fn(), refresh: vi.fn(), signal: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/enrollments/server/movable-actions", () => ({ listClassTransferCandidates: mocks.list }));
vi.mock("@/features/enrollments/server/actions", () => ({ moveEnrollmentsBatch: mocks.move }));
vi.mock("@/features/billing/session-terms/plan-change-signal", () => ({ notifyTermPlansChanged: mocks.signal }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-09-22" }));
import { useBulkTransfer } from "./use-bulk-transfer";

const candidates: TransferCandidate[] = ["김하나", "이다음"].map((name, i) => ({
  id: `e${i + 1}`, name, grade: "중3", school: "서변중",
  snapshot: { studentId: `s${i + 1}`, startDate: "2026-09-01", endDate: null, onHold: i === 1, isTransferred: false, attendanceDays: [] },
}));
const loaded = { ok: true, classId: "old", className: "출발 반", items: candidates };
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue(loaded); });

async function setup() {
  const done = vi.fn();
  const view = renderHook(({ source }) => useBulkTransfer(source, "2026-09-23", done), { initialProps: { source: "e1" } });
  act(() => view.result.current.toggle());
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  act(() => view.result.current.pick(["e1", "e2"]));
  return { ...view, done };
}

describe("같은 반 단체 이동", () => {
  it("선택한 수강만 같은 출발 반·날짜·요일·조회 상태로 보낸다", async () => {
    const { result, done } = await setup();
    mocks.move.mockResolvedValue({ results: [{ enrollmentId: "e2", ok: true }, { enrollmentId: "e1", ok: true }] });
    await act(async () => result.current.run("new", ["mon"]));
    expect(mocks.move).toHaveBeenCalledWith(candidates.map((c) => ({ enrollmentId: c.id, newClassId: "new", attendanceDays: ["mon"], expected: c.snapshot })), "2026-09-23", "old");
    expect(done).toHaveBeenCalledOnce();
    expect(mocks.signal).toHaveBeenCalledOnce();
  });

  it("일부 성공 후에는 실패한 학생만 재시도하고 이미 이동한 학생은 선택에서 뺀다", async () => {
    const { result, done } = await setup();
    mocks.move.mockResolvedValueOnce({ results: [{ enrollmentId: "e1", ok: true }, { enrollmentId: "e2", ok: false, error: "exclusion constraint" }] });
    await act(async () => result.current.run("new", []));
    expect(done).not.toHaveBeenCalled();
    expect(result.current.ids).toEqual(["e2"]);
    expect(result.current.failures[0]).toMatchObject({ name: "이다음", error: expect.stringContaining("기간이 겹칩니다") });
    expect(result.current.blocked.e1).toBe("이동 완료");
    act(() => result.current.toggle());
    expect(result.current.on).toBe(true);
    mocks.move.mockResolvedValueOnce({ results: [{ enrollmentId: "e2", ok: true }] });
    await act(async () => result.current.run("new2", []));
    expect(mocks.move.mock.calls[1][0]).toHaveLength(1);
    expect(mocks.move.mock.calls[1][0][0].enrollmentId).toBe("e2");
    expect(done).toHaveBeenCalledOnce();
  });

  it.each([{}, { results: [] }, { results: [{ enrollmentId: "other", ok: true }] }, { results: [{ enrollmentId: "e1", ok: true }, { enrollmentId: "e1", ok: true }] }])("누락·중복·다른 학생 결과를 성공으로 처리하지 않는다: %j", async (response) => {
    const { result, done } = await setup();
    mocks.move.mockResolvedValue(response);
    await act(async () => result.current.run("new", []));
    expect(done).not.toHaveBeenCalled();
    expect(result.current.uncertain).toBe(true);
    await act(async () => result.current.run("new", []));
    expect(mocks.move).toHaveBeenCalledOnce();
  });

  it("응답이 끊기면 새 목록을 확인하기 전 재전송을 막는다", async () => {
    const { result, done } = await setup();
    mocks.move.mockRejectedValue(new Error("network"));
    await act(async () => result.current.run("new", []));
    expect(result.current.uncertain).toBe(true);
    expect(done).not.toHaveBeenCalled();
    mocks.list.mockResolvedValue({ ...loaded, items: candidates.map((c) => ({ ...c, snapshot: { ...c.snapshot, isTransferred: true } })) });
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.uncertain).toBe(false));
    expect(result.current.ids).toEqual([]);
    expect(result.current.blocked.e1).toContain("이미 반 이동");
  });

  it("출발 수강 변경 중 늦게 도착한 이전 반의 목록을 버린다", async () => {
    let resolve!: (value: typeof loaded) => void;
    mocks.list.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result, rerender } = renderHook(({ source }) => useBulkTransfer(source, "2026-09-23", vi.fn()), { initialProps: { source: "e1" } });
    act(() => result.current.toggle());
    rerender({ source: "another" });
    await act(async () => resolve(loaded));
    expect(result.current.on).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it("같은 순간 두 번 눌러도 저장은 한 번만 요청한다", async () => {
    const { result } = await setup();
    mocks.move.mockResolvedValue({ results: candidates.map((c) => ({ enrollmentId: c.id, ok: true })) });
    await act(async () => { await Promise.all([result.current.run("new", []), result.current.run("new", [])]); });
    expect(mocks.move).toHaveBeenCalledOnce();
  });
});
