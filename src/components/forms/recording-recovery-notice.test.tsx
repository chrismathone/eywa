import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingMeta, RecordingScope } from "@/lib/recording-recovery";
const mocks = vi.hoisted(() => ({ list: vi.fn(), recover: vi.fn(), clear: vi.fn() }));
vi.mock("@/lib/recording-recovery", async (original) => ({
  ...(await original<typeof import("@/lib/recording-recovery")>()),
  listRecovery: (...a: unknown[]) => mocks.list(...a),
  recoverRecording: (...a: unknown[]) => mocks.recover(...a),
  clearRecovery: (...a: unknown[]) => mocks.clear(...a),
}));
import { RecordingRecoveryNotice } from "./recording-recovery-notice";
const a: RecordingScope = { tenantId: "t1", userId: "u1", recordKey: "enrollment:a", label: "A" };
const b = { ...a, recordKey: "enrollment:b", label: "B" };
const meta: RecordingMeta = { id: "a-recording", kind: "consultation", startedAt: 1000, mimeType: "audio/webm", chunkCount: 1 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([meta]);
  mocks.clear.mockResolvedValue(undefined);
  mocks.recover.mockResolvedValue(new File(["A"], "A.webm"));
});
describe("record-specific recovery notice", () => {
  it("queries the current record and never deletes a backup just for restoring it", async () => {
    const restore = vi.fn();
    render(<RecordingRecoveryNotice kind="consultation" scope={a} onRestore={restore} />);
    fireEvent.click(await screen.findByRole("button", { name: "복구하기" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(expect.any(File), meta));
    expect(mocks.list).toHaveBeenCalledWith("consultation", expect.objectContaining({ recordKey: a.recordKey, userId: a.userId, tenantId: a.tenantId }));
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it("hides A immediately when B's lookup is still pending", async () => {
    const view = render(<RecordingRecoveryNotice kind="consultation" scope={a} onRestore={vi.fn()} />);
    await screen.findByText(/A ·/);
    mocks.list.mockReturnValue(new Promise(() => {}));
    view.rerender(<RecordingRecoveryNotice kind="consultation" scope={b} onRestore={vi.fn()} />);
    expect(screen.queryByText(/A ·/)).toBeNull();
    expect(screen.queryByRole("button", { name: "복구하기" })).toBeNull();
  });
  it("rejects an A restore that finishes after switching to B", async () => {
    let finish!: (file: File) => void;
    mocks.recover.mockReturnValue(new Promise<File>((resolve) => { finish = resolve; }));
    const restore = vi.fn();
    const view = render(<RecordingRecoveryNotice kind="consultation" scope={a} onRestore={restore} />);
    fireEvent.click(await screen.findByRole("button", { name: "복구하기" }));
    mocks.list.mockResolvedValue([]);
    view.rerender(<RecordingRecoveryNotice kind="consultation" scope={b} onRestore={restore} />);
    await act(async () => { finish(new File(["A"], "A.webm")); });
    expect(restore).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it("handles multiple recordings and deletes only the selected backup", async () => {
    mocks.list.mockResolvedValue([meta, { ...meta, id: "a-second" }]);
    render(<RecordingRecoveryNotice kind="consultation" scope={a} onRestore={vi.fn()} />);
    const buttons = await screen.findAllByRole("button", { name: "녹음 지우기" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledWith("a-second"));
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });
  it("does not query unidentified forms or expose their recovery options", () => {
    render(<RecordingRecoveryNotice kind="consultation" scope={null} onRestore={vi.fn()} />);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "복구하기" })).toBeNull();
  });
  it("keeps failed recoveries and gives a disk-backup fallback", async () => {
    mocks.recover.mockResolvedValue(null);
    render(<RecordingRecoveryNotice kind="consultation" scope={a} onRestore={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "복구하기" }));
    expect(await screen.findByText(/PC에 저장된 백업 파일/)).toBeVisible();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});
