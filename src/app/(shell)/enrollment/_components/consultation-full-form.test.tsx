import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * 콜&상담 수정 저장 뒤 — 서버 액션 직후라 풀 문서 이동(#102)이고, 이동 대기 중엔 폼 전체를 잠근다(inert).
 * 잠그지 않으면 그 사이 친 글자가 pagehide에서 방금 지운 초안을 되살리고, 미저장 가드가 이동을 붙잡는다.
 */
const m = vi.hoisted(() => ({
  inFrame: true,
  /** 이 문서에 다른 녹음이 살아 있나(recording-resume `documentHasLiveRecording`). */
  liveElsewhere: false,
  updateEnrollmentConsultation: vi.fn(),
  createEnrollmentConsultation: vi.fn(),
  clearRecovery: vi.fn(),
  ticket: vi.fn(),
  upload: vi.fn(),
  recorderScope: vi.fn(),
  saveDraftOnHide: vi.fn(),
  loadDraft: vi.fn(),
  // 🔴 인자 타입은 **제네릭**으로 적는다 — `vi.fn(async () => {})`는 타입이 0인자로 굳어 아래 `m.clearDraft(scope)`가
  //    tsc에서 걸리고(TS2554), 쓰지 않는 인자를 구현에 적으면 lint가 경고한다(저장소 관례 = enrollment-table.test).
  clearDraft: vi.fn<(scope: string) => Promise<void>>(async () => {}),
}));
vi.mock("@/features/enrollment/server/actions", () => ({
  createEnrollmentConsultation: (...a: unknown[]) => m.createEnrollmentConsultation(...a),
  updateEnrollmentConsultation: (...a: unknown[]) => m.updateEnrollmentConsultation(...a),
}));
vi.mock("@/features/media/server/upload-actions", () => ({ issueAudioUploadTicket: (...a: unknown[]) => m.ticket(...a) }));
vi.mock("@/lib/storage/upload-to-ticket", () => ({ uploadToTicket: (...a: unknown[]) => m.upload(...a) }));
vi.mock("@/lib/recording-recovery", async (original) => ({
  ...(await original<typeof import("@/lib/recording-recovery")>()),
  clearRecovery: (...a: unknown[]) => m.clearRecovery(...a),
}));
vi.mock("@/lib/form-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/form-draft")>()),
  saveDraft: async () => {},
  saveDraftOnHide: (...a: unknown[]) => m.saveDraftOnHide(...a),
  loadDraft: (...a: unknown[]) => m.loadDraft(...a),
  clearDraft: (scope: string) => m.clearDraft(scope),
}));
vi.mock("@/features/presence/edit-presence", () => ({ useEditPresence: vi.fn() }));
vi.mock("@/features/presence/editing-badge", () => ({ EditingBanner: () => null }));
vi.mock("@/lib/realtime/record-channel", () => ({
  publishRecordSaved: vi.fn(),
  subscribeRecordSaved: () => () => {},
}));
vi.mock("./audio-recorder-field", () => ({ AudioRecorderField: ({ onChange, scope, file, onRecordingChange }: {
  onChange: (file: File, id: string) => void; scope: unknown; file: File | null; onRecordingChange?: (live: boolean, paused: boolean) => void;
}) => {
  m.recorderScope(scope);
  return <>
    <button type="button" onClick={() => onChange(new File(["A"], "A.webm", { type: "audio/webm" }), "recording-a")}>테스트 녹음 선택</button>
    <button type="button" onClick={() => onRecordingChange?.(true, false)}>테스트 녹음 시작</button>
    <span>{file?.name}</span>
  </>;
} }));
vi.mock("@/lib/recording-resume", async (original) => ({
  ...(await original<typeof import("@/lib/recording-resume")>()),
  documentHasLiveRecording: () => m.liveElsewhere,
}));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => m.inFrame }));

import { ConsultationFullForm } from "./consultation-full-form";

let assign: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  m.inFrame = true;
  m.liveElsewhere = false;
  m.updateEnrollmentConsultation.mockReset();
  m.createEnrollmentConsultation.mockReset();
  m.clearRecovery.mockReset();
  m.recorderScope.mockClear();
  m.ticket.mockReset();
  m.ticket.mockResolvedValue({ ticket: { path: "t1/audio.webm" } });
  m.upload.mockReset();
  m.upload.mockResolvedValue(undefined);
  m.saveDraftOnHide.mockReset();
  m.loadDraft.mockReset();
  m.loadDraft.mockResolvedValue(null);
  m.clearDraft.mockClear();
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 수정 폼을 그대로 저장하고 서버 액션 응답까지 흘려보낸다. */
async function saveEdit() {
  const { container } = render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "홍길동" }} />);
  const form = container.querySelector("form")!;
  // 상담 끝난 건은 후속 조치가 필수(원장 2026-10-22) — 저장 경로 시험이라 '등록'을 고르고 저장한다.
  fireEvent.click(screen.getByRole("radio", { name: "등록" }));
  await act(async () => {
    fireEvent.submit(form);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  return form;
}

describe("콜&상담 수정 저장 뒤 이동(#102)", () => {
  it("embed를 유지한 풀 문서 이동으로 상세에 가고, 이동 대기 중엔 폼 전체를 잠근다", async () => {
    m.updateEnrollmentConsultation.mockResolvedValue({ ok: true });
    const form = await saveEdit();
    expect(assign).toHaveBeenCalledWith("/enrollment/c1?embed=1");
    expect(m.clearDraft).toHaveBeenCalledWith("consultation:c1");
    expect(form).toHaveAttribute("inert");
    // 잠갔으니 새 입력이 없다 → 문서가 내려가도(pagehide) 방금 지운 초안이 되살아나지 않는다.
    window.dispatchEvent(new Event("pagehide"));
    expect(m.saveDraftOnHide).not.toHaveBeenCalled();
  });

  it("창 밖(최상위 문서): embed 없이 그 주소 그대로", async () => {
    m.inFrame = false;
    m.updateEnrollmentConsultation.mockResolvedValue({ ok: true });
    await saveEdit();
    expect(assign).toHaveBeenCalledWith("/enrollment/c1");
  });

  it("🔴 이 문서에 다른 녹음이 살아 있으면 떠나지 않고 '저장했습니다 · 열기'를 보인다 — 풀 문서 이동은 그 녹음을 끊는다", async () => {
    m.liveElsewhere = true;
    m.updateEnrollmentConsultation.mockResolvedValue({ ok: true });
    const form = await saveEdit();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("다른 녹음이 이어지도록");
    expect(screen.getByRole("link", { name: "열기" })).toHaveAttribute("href", "/enrollment/c1?embed=1");
    expect(form).toHaveAttribute("inert");
  });

  it("저장이 실패하면 이동도 잠금도 없다(고쳐서 다시 저장할 수 있게)", async () => {
    m.updateEnrollmentConsultation.mockResolvedValue({ error: "콜&상담 권한이 없습니다" });
    const form = await saveEdit();
    expect(assign).not.toHaveBeenCalled();
    expect(form).not.toHaveAttribute("inert");
    expect(screen.getByText("콜&상담 권한이 없습니다")).toBeInTheDocument();
  });
});

async function saveRecording(mode: "create" | "edit") {
  const { container } = render(<ConsultationFullForm mode={mode} recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: mode === "edit" ? "c1" : undefined, prospectName: "A" }} />);
  fireEvent.click(screen.getByRole("button", { name: "테스트 녹음 선택" }));
  fireEvent.click(screen.getByRole("radio", { name: "등록" }));
  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

describe("후속 조치 필수(원장 2026-10-22)", () => {
  it("후속 조치 초안을 복원하면 상태 표시도 같은 칸으로 바뀐다", async () => {
    m.loadDraft.mockResolvedValue({ savedAt: Date.now(), values: { prospectName: "A", followUpResult: "declined" } });
    render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", outcome: "consulted" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "이어서 작성" }));
    expect(screen.getByRole("radio", { name: "미등록" })).toBeChecked();
    expect(screen.getByLabelText("상담 상태")).toHaveTextContent("미등록");
  });
  it.each([
    ["pending", "상담 전"], ["scheduled", "상담 전"], ["consulted", "상담 완료"],
    ["ai_done", "상담 완료"], ["declined", "미등록"], ["no_show", "미등록"], ["enrolled", "등록 완료"],
  ])("폼 상태 %s는 칸반의 %s로 표시한다", (outcome, label) => {
    const { container } = render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ outcome }} />);
    expect(screen.getByLabelText("상담 상태")).toHaveTextContent(label);
    for (const name of ["registrationStatus", "paymentAmount", "paymentDate", "registrar"]) {
      expect(container.querySelector(`[name="${name}"]`)).toBeNull();
    }
  });
  it("신규 폼에 과거 결제 입력칸이 없다", () => {
    const { container } = render(<ConsultationFullForm mode="create" recordingOwner={{ tenantId: "t1", userId: "u1" }} />);
    for (const name of ["registrationStatus", "paymentAmount", "paymentDate", "registrar"]) {
      expect(container.querySelector(`[name="${name}"]`)).toBeNull();
    }
    expect(screen.getByLabelText("개인정보 활용 동의")).toBeInTheDocument();
  });
  it("반 배정 상태도 칸반과 일치하고 변경 불가한 후속 조치를 비활성화한다", () => {
    render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ outcome: "consulted", assignedClassCount: 1 }} />);
    expect(screen.getByLabelText("상담 상태")).toHaveTextContent("등록 완료");
    expect(screen.getByRole("radio", { name: "등록" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "미등록" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "다음 상담" })).toBeDisabled();
  });
  it("상담 끝난 건을 고르지 않고 저장하면 서버를 부르지 않고 이유를 보인다", async () => {
    const { container } = render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "A", outcome: "consulted" }} />);
    await act(async () => { fireEvent.submit(container.querySelector("form")!); });
    expect(m.updateEnrollmentConsultation).not.toHaveBeenCalled();
    expect(screen.getByText(/후속 조치를 골라 주세요/)).toBeInTheDocument();
  });
  it("다음 상담은 날짜와 함께 보내고 현재 상태도 칸반과 함께 바뀐다", async () => {
    m.updateEnrollmentConsultation.mockResolvedValue({ ok: true });
    const { container } = render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "A", outcome: "ai_done" }} />);
    const form = container.querySelector("form")!;
    fireEvent.click(screen.getByRole("radio", { name: "미등록" }));
    expect(screen.getByLabelText("상담 상태")).toHaveTextContent("미등록");
    expect(form.querySelector('[name="registrationStatus"]')).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "다음 상담" }));
    expect(screen.getByLabelText("상담 상태")).toHaveTextContent("상담 완료");
    await act(async () => { fireEvent.submit(form); });
    expect(m.updateEnrollmentConsultation).not.toHaveBeenCalled();
    expect(screen.getByText(/다음 상담 날짜를 넣어 주세요/)).toBeInTheDocument();
    fireEvent.change(form.querySelector('[name="followUpDate"]')!, { target: { value: "2099-01-01" } });
    await act(async () => { fireEvent.submit(form); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    const sent = m.updateEnrollmentConsultation.mock.calls[0]![1] as FormData;
    expect(sent.get("followUpResult")).toBe("next");
    expect(sent.get("followUpDate")).toBe("2099-01-01");
  });
  it("이미 등록 완료된 상담은 다음 상담을 고를 수 없다", () => {
    render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "A", outcome: "enrolled" }} />);
    expect(screen.getByRole("radio", { name: "다음 상담" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "등록" })).toBeChecked();
  });
});
describe("콜앤상담 녹음 저장과 대상 구분", () => {
  it("successful edit clears exactly the submitted backup", async () => {
    m.updateEnrollmentConsultation.mockResolvedValue({ ok: true });
    await saveRecording("edit");
    expect(m.clearRecovery).toHaveBeenCalledWith("recording-a");
    expect(m.clearRecovery).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/enrollment/c1?embed=1");
  });
  it("failed attachment keeps the backup even when text fields were saved", async () => {
    m.updateEnrollmentConsultation.mockResolvedValue({ error: "음성 첨부 실패", saved: true });
    await saveRecording("edit");
    expect(m.clearRecovery).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
  it("successful creation confirms a saved record id before deleting the backup", async () => {
    m.createEnrollmentConsultation.mockResolvedValue({ id: "new-a" });
    await saveRecording("create");
    expect(m.clearRecovery).toHaveBeenCalledWith("recording-a");
    expect(assign).toHaveBeenCalledWith("/enrollment/new-a?embed=1");
  });
  it.each([undefined, { error: "저장 실패" }])("unconfirmed creation keeps the backup (%j)", async (response) => {
    m.createEnrollmentConsultation.mockResolvedValue(response);
    await saveRecording("create");
    expect(m.clearRecovery).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
  it("🔴 녹음 중엔 이름·연락처를 readOnly로 잠근다 — disabled면 임시 저장에서 빠져 돌아온 화면에 녹음이 안 붙는다", async () => {
    const { container } = render(<ConsultationFullForm mode="create" recordingOwner={{ tenantId: "t1", userId: "u1" }} />);
    fireEvent.input(container.querySelector('[name="prospectName"]')!, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "테스트 녹음 시작" }));
    for (const name of ["prospectName", "studentPhone", "parentPhone"]) {
      const input = container.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
      expect(input.readOnly).toBe(true);
      expect(input.disabled).toBe(false);
    }
  });

  it("A -> B changes the scope and detaches A's selected recording without deleting it", async () => {
    const { container } = render(<ConsultationFullForm mode="create" recordingOwner={{ tenantId: "t1", userId: "u1" }} />);
    const name = container.querySelector<HTMLInputElement>('[name="prospectName"]')!;
    fireEvent.input(name, { target: { value: "A" } });
    const aScope = m.recorderScope.mock.calls.at(-1)?.[0];
    fireEvent.click(screen.getByRole("button", { name: "테스트 녹음 선택" }));
    expect(screen.getAllByText("A.webm").length).toBeGreaterThan(0);
    fireEvent.input(name, { target: { value: "B" } });
    expect(m.recorderScope.mock.calls.at(-1)?.[0].recordKey).not.toBe(aScope.recordKey);
    expect(screen.queryAllByText("A.webm")).toHaveLength(0);
    expect(m.clearRecovery).not.toHaveBeenCalled();
  });
});
