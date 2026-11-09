import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ action: vi.fn(), ticket: vi.fn(), upload: vi.fn(), clear: vi.fn(), list: vi.fn(), recover: vi.fn() }));
vi.mock("@/features/consultations/server/audio-actions", () => ({ startStudentConsultationFromAudio: (...a: unknown[]) => mocks.action(...a) }));
vi.mock("@/features/media/server/upload-actions", () => ({ issueAudioUploadTicket: (...a: unknown[]) => mocks.ticket(...a) }));
vi.mock("@/lib/storage/upload-to-ticket", () => ({ uploadToTicket: (...a: unknown[]) => mocks.upload(...a) }));
vi.mock("@/lib/recording-recovery", async (original) => ({
  ...(await original<typeof import("@/lib/recording-recovery")>()),
  listRecovery: (...a: unknown[]) => mocks.list(...a),
  recoverRecording: (...a: unknown[]) => mocks.recover(...a),
  clearRecovery: (...a: unknown[]) => mocks.clear(...a),
}));
vi.mock("@/components/ui/searchable-select", () => ({ SearchableSelect: ({ value, onValueChange, options }: {
  value: string; onValueChange: (id: string) => void; options: { value: string; label: string }[];
}) => <select aria-label="학생" value={value} onChange={(e) => onValueChange(e.target.value)}><option value="" />{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
vi.mock("@/components/workspace/use-recording-lock", () => ({ useRecordingLock: () => {} }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => true }));
import { AudioConsultationForm } from "./audio-consultation-form";
const recording = { id: "recording-a", startedAt: 1000, chunkCount: 1, mimeType: "audio/webm" };
let assign: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockImplementation(async (_kind, scope) => scope.recordKey === "student:a" ? [recording] : []);
  mocks.recover.mockResolvedValue(new File(["audio"], "A.webm", { type: "audio/webm" }));
  mocks.ticket.mockResolvedValue({ ticket: { path: "t1/audio.webm" } });
  mocks.upload.mockResolvedValue(undefined);
  mocks.clear.mockResolvedValue(undefined);
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
function open() {
  const view = render(<AudioConsultationForm recordingOwner={{ tenantId: "t1", userId: "u1" }} students={[{ id: "a", name: "A", grade: null }, { id: "b", name: "B", grade: null }]} />);
  view.container.querySelector("details")!.setAttribute("open", "");
  return view;
}
async function restoreA() {
  open();
  fireEvent.change(screen.getByRole("combobox", { name: "학생" }), { target: { value: "a" } });
  fireEvent.click(await screen.findByRole("button", { name: "복구하기" }));
  await screen.findByText("A.webm");
}
async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}
describe("원생상담 녹음의 학생 구분과 저장 확인", () => {
  it("A -> B detaches the A file without deleting its backup", async () => {
    await restoreA();
    fireEvent.change(screen.getByRole("combobox", { name: "학생" }), { target: { value: "b" } });
    expect(screen.queryByText("A.webm")).toBeNull();
    expect(screen.queryByRole("button", { name: "복구하기" })).toBeNull();
    expect(mocks.clear).not.toHaveBeenCalled();
    await submit();
    expect(mocks.action).not.toHaveBeenCalled();
    expect(screen.getByText(/음성 파일을 선택하거나 녹음/)).toBeInTheDocument();
  });
  it("clears only the restored backup after confirming the saved consultation id", async () => {
    mocks.action.mockResolvedValue({ id: "consultation-a" });
    await restoreA();
    await submit();
    expect(mocks.clear).toHaveBeenCalledWith("recording-a");
    expect(assign).toHaveBeenCalledWith("/consultations/consultation-a/edit?embed=1");
    expect(screen.getByRole("button", { name: "분석 시작", hidden: true })).toBeDisabled();
  });
  it("이동이 끝나지 않으면 잠시 뒤 상담 링크와 새로 작성을 보이고 버튼은 잠근 채 둔다", async () => {
    mocks.action.mockResolvedValue({ id: "consultation-a" });
    await restoreA();
    vi.useFakeTimers();
    try {
      await submit();
      expect(assign).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("link", { name: "상담 열기" })).toBeNull();
      await act(async () => { vi.advanceTimersByTime(5000); });
      expect(screen.getByRole("link", { name: "상담 열기" })).toHaveAttribute("href", "/consultations/consultation-a/edit?embed=1");
      expect(screen.getByRole("button", { name: "새로 작성" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "저장됨", hidden: true })).toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([undefined, { error: "상담 저장 실패" }])("keeps the backup when the save is not confirmed (%j)", async (response) => {
    mocks.action.mockResolvedValue(response);
    await restoreA();
    await submit();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
  it("keeps the backup and selection when upload fails", async () => {
    mocks.upload.mockRejectedValue(new Error("업로드 실패"));
    await restoreA();
    await submit();
    await waitFor(() => expect(screen.getByText("업로드 실패")).toBeInTheDocument());
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.action).not.toHaveBeenCalled();
  });
});
