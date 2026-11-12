import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BOARD_STAGES } from "@/features/enrollment/board-stages";
import { OperationsProvider } from "@/features/owner/operations-context";

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

import { useEditPresence } from "@/features/presence/edit-presence";
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
  fireEvent.click(screen.getByRole("radio", { name: "등록 완료" }));
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
  fireEvent.click(screen.getByRole("radio", { name: "등록 완료" }));
  await act(async () => {
    fireEvent.submit(container.querySelector("form")!);
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
}

describe("후속 조치 필수(원장 2026-10-22)", () => {
  it("후속 조치 버튼은 칸반과 이름·순서·값이 같다", () => {
    render(<ConsultationFullForm mode="create" recordingOwner={{ tenantId: "t1", userId: "u1" }} />);
    const group = screen.getByRole("radiogroup", { name: "후속 조치" });
    const buttons = within(group).getAllByRole("radio") as HTMLInputElement[];
    expect(buttons.map((button) => button.value)).toEqual(BOARD_STAGES.map((stage) => stage.key));
    BOARD_STAGES.forEach((stage, index) => expect(buttons[index]).toHaveAccessibleName(stage.label));
    expect(within(group).queryByText("다음 상담")).toBeNull();
  });
  it("상담을 마친 건은 '상담 전'을 고를 수 없다(필수 조치를 피하는 문) — 새 상담도 같다", () => {
    render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "A", outcome: "consulted" }} />);
    expect(screen.getByRole("radio", { name: "상담 전" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "상담 완료" })).toBeEnabled();
    cleanup();
    render(<ConsultationFullForm mode="create" recordingOwner={{ tenantId: "t1", userId: "u1" }} />);
    expect(screen.getByRole("radio", { name: "상담 전" })).toBeDisabled();
  });
  it("'상담 완료'는 다음 상담일 없이도 저장된다 — 다음 상담이 없을 수도 있다(원장 2026-10-26)", async () => {
    m.updateEnrollmentConsultation.mockResolvedValue({ ok: true });
    const { container } = render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "A", outcome: "consulted" }} />);
    fireEvent.click(screen.getByRole("radio", { name: "상담 완료" }));
    expect(screen.getByText("다음 상담일 (선택)")).toBeInTheDocument();
    await act(async () => { fireEvent.submit(container.querySelector("form")!); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    const fd = m.updateEnrollmentConsultation.mock.calls[0]![1] as FormData;
    expect(fd.get("followUpResult")).toBe("consulted");
    expect(fd.get("followUpDate")).toBe("");
  });
  it("과목 탭에서 저장하다 후속 조치에 막히면 '기본 정보' 탭으로 돌아가 이유를 보인다(원장 제보 2026-10-26)", async () => {
    const scrolled: Element[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this); };
    try {
      const { container } = render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "A", outcome: "consulted" }} />);
      const followUp = screen.getByRole("radiogroup", { name: "후속 조치" });
      fireEvent.click(screen.getByRole("button", { name: "영어 상담" }));
      expect(followUp.closest(".hidden")).not.toBeNull();
      await act(async () => { fireEvent.submit(container.querySelector("form")!); });
      expect(m.updateEnrollmentConsultation).not.toHaveBeenCalled();
      expect(screen.getByText(/후속 조치를 골라 주세요/)).toBeInTheDocument();
      expect(followUp.closest(".hidden")).toBeNull();
      expect(scrolled.some((el) => el.contains(followUp))).toBe(true);
      // 같은 이유로 다시 막혀도 다시 데려간다
      scrolled.length = 0;
      fireEvent.click(screen.getByRole("button", { name: "영어 상담" }));
      await act(async () => { fireEvent.submit(container.querySelector("form")!); });
      expect(followUp.closest(".hidden")).toBeNull();
      expect(scrolled.some((el) => el.contains(followUp))).toBe(true);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
  it("수정 화면은 연 때의 값(editBase)을 함께 보낸다 — 서버가 바꾼 칸만 쓴다(원장 2026-10-26)", async () => {
    m.updateEnrollmentConsultation.mockResolvedValue({ ok: true });
    const { container } = render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "A", outcome: "consulted", careerGoal: "변호사" }} />);
    fireEvent.change(container.querySelector('input[name="careerGoal"]')!, { target: { value: "의사" } });
    fireEvent.click(screen.getByRole("radio", { name: "미등록" }));
    await act(async () => { fireEvent.submit(container.querySelector("form")!); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    const fd = m.updateEnrollmentConsultation.mock.calls[0]![1] as FormData;
    expect(fd.get("careerGoal")).toBe("의사");
    const base = JSON.parse(String(fd.get("editBase"))) as Record<string, string>;
    expect(base).toMatchObject({ id: "c1", prospectName: "A", careerGoal: "변호사" });
    expect(base).not.toHaveProperty("followUpResult"); // 연 때는 고르지 않았다
  });
  it("새 상담은 editBase를 보내지 않는다", async () => {
    m.createEnrollmentConsultation.mockResolvedValue({ id: "n1" });
    const { container } = render(<ConsultationFullForm mode="create" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ prospectName: "A" }} />);
    fireEvent.click(screen.getByRole("radio", { name: "등록 완료" }));
    await act(async () => { fireEvent.submit(container.querySelector("form")!); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    const fd = m.createEnrollmentConsultation.mock.calls[0]![1] as FormData;
    expect(fd.has("editBase")).toBe(false);
  });
  it("상담 전 접수(QR 등)는 '상담 전' 그대로 날짜 없이 저장할 수 있다", async () => {
    m.updateEnrollmentConsultation.mockResolvedValue({ ok: true });
    const { container } = render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "A", outcome: "pending" }} />);
    fireEvent.click(screen.getByRole("radio", { name: "상담 전" }));
    await act(async () => { fireEvent.submit(container.querySelector("form")!); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    const fd = m.updateEnrollmentConsultation.mock.calls[0]![1] as FormData;
    expect(fd.get("followUpDate")).toBe("");
    expect(fd.get("followUpResult")).toBe("before");
  });
  it("옛 초안의 '상담 전'은 상담을 마친 건에서 비운다 — 다시 고르게(옛 값 'next'는 상담 완료로)", async () => {
    m.loadDraft.mockResolvedValue({ savedAt: Date.now(), values: { prospectName: "A", followUpResult: "before" } });
    render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", outcome: "consulted" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "이어서 작성" }));
    expect(screen.getByRole("radio", { name: "상담 전" })).not.toBeChecked();
    expect(screen.getByLabelText("상담 상태")).toHaveTextContent("상담 완료");
    cleanup();
    m.loadDraft.mockResolvedValue({ savedAt: Date.now(), values: { prospectName: "A", followUpResult: "next" } });
    render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", outcome: "consulted" }} />);
    fireEvent.click(await screen.findByRole("button", { name: "이어서 작성" }));
    expect(screen.getByRole("radio", { name: "상담 완료" })).toBeChecked();
    expect(screen.getByText("다음 상담일 (선택)")).toBeInTheDocument();
  });
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
    expect(screen.getByRole("radio", { name: "등록 완료" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "미등록" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "상담 완료" })).toBeDisabled();
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
    fireEvent.click(screen.getByRole("radio", { name: "상담 완료" }));
    expect(screen.getByLabelText("상담 상태")).toHaveTextContent("상담 완료");
    fireEvent.change(form.querySelector('[name="followUpDate"]')!, { target: { value: "2099-01-01" } });
    await act(async () => { fireEvent.submit(form); for (let i = 0; i < 10; i++) await Promise.resolve(); });
    const sent = m.updateEnrollmentConsultation.mock.calls[0]![1] as FormData;
    expect(sent.get("followUpResult")).toBe("consulted");
    expect(sent.get("followUpDate")).toBe("2099-01-01");
  });
  it("이미 등록 완료된 상담은 상담 전·상담 완료를 고를 수 없다", () => {
    render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "A", outcome: "enrolled" }} />);
    expect(screen.getByRole("radio", { name: "상담 완료" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "상담 전" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "등록 완료" })).toBeChecked();
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

/**
 * 읽기 권한(원장 2026-11-05 *"읽기 권한인데 쓸 수 있는것처럼 오해 불러오지 않도록"* · write-lock.ts) — 칸은 비활성 + 권한 안내,
 * 저장·녹음 단추는 없고, 임시 저장·'수정 중' 표시도 켜지 않는다. 판정은 페이지가 `canWriteTenant(…,"enrollment")`로 내려 준다.
 */
describe("읽기 권한 — 칸 잠금 · 쓰기 단추 없음", () => {
  it("수정 화면: 값은 보이되 칸이 잠기고, 저장·녹음 단추와 '수정 중' 표시·임시 저장이 없다", async () => {
    const { container } = render(<ConsultationFullForm mode="edit" readOnly recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "홍길동" }} />);
    expect(screen.getByRole("note")).toHaveTextContent("신규 콜&상담 작성 권한이 필요합니다");
    const name = container.querySelector<HTMLInputElement>('[name="prospectName"]')!;
    expect(name).toBeDisabled();
    expect(name).toHaveValue("홍길동");
    expect(container.querySelector('[name="parentRequest"]')).toHaveAttribute("placeholder", "신규 콜&상담 작성 권한이 필요합니다");
    expect(container.querySelector('[name="subject"]')).toBeDisabled();
    expect(screen.getByRole("radio", { name: "등록 완료" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /저장/ })).toBeNull();
    expect(screen.queryByText("테스트 녹음 선택")).toBeNull();
    expect(vi.mocked(useEditPresence).mock.lastCall).toEqual([undefined, false]);
    expect(m.loadDraft).not.toHaveBeenCalled();
    // 단추가 없어도 다른 제출 길(Enter 등)로 액션이 불리지 않는다.
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
      await Promise.resolve();
    });
    expect(m.updateEnrollmentConsultation).not.toHaveBeenCalled();
  });

  it("쓰기 권한(기본값)이면 종전 그대로 — 칸이 열려 있고 저장 단추가 있다", () => {
    const { container } = render(<ConsultationFullForm mode="create" recordingOwner={{ tenantId: "t1", userId: "u1" }} />);
    expect(screen.queryByRole("note")).toBeNull();
    expect(container.querySelector('[name="prospectName"]')).toBeEnabled();
    expect(container.querySelector('[name="parentRequest"]')).toHaveAttribute("placeholder", "학부모 요구사항 / 관찰");
    expect(screen.getByRole("button", { name: /저장하고 상세로/ })).toBeInTheDocument();
  });
});

describe("지점 라이선스가 꺼진 상담 기능의 흔적", () => {
  it("회의 녹음이 꺼지면 녹음·파일 첨부 영역을 통째로 감춘다", () => {
    render(
      <OperationsProvider subjects={[]} gradeLevels={[]} licenses={{ meeting_recording: false }}>
        <ConsultationFullForm mode="create" recordingOwner={{ tenantId: "t1", userId: "u1" }} />
      </OperationsProvider>,
    );
    expect(screen.queryByText(/상담 녹음·파일 첨부/)).toBeNull();
    expect(screen.queryByText("테스트 녹음 선택")).toBeNull();
  });

  it("AI 분석만 꺼지면 녹음·전사는 남기되 AI 이름과 제안을 감춘다", () => {
    render(
      <OperationsProvider subjects={[]} gradeLevels={[]} licenses={{ meeting_recording: true, ai_analysis: false }}>
        <ConsultationFullForm
          mode="edit"
          recordingOwner={{ tenantId: "t1", userId: "u1" }}
          initial={{ id: "c1", prospectName: "홍길동" }}
          aiSuggestedParentRequest="분석 제안"
        />
      </OperationsProvider>,
    );
    expect(screen.getByText(/상담 녹음·파일 첨부/)).toBeInTheDocument();
    expect(screen.getByText("선택 · 저장 후 전사")).toBeInTheDocument();
    expect(screen.queryByText(/AI 분석/)).toBeNull();
    expect(screen.queryByText(/AI 제안/)).toBeNull();
  });
});
