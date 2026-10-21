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
  loadDraft: async () => null,
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
  m.clearDraft.mockClear();
  vi.spyOn(window.location, "assign").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});


describe("접힌 입력 보존", () => {
 it("기본 접힘과 다른 탭에서도 모든 확장 칸과 자유 형제 문구를 FormData로 보낸다", async () => {
  const values = { safetyNotes: "알레르기", careerGoal: "의사", studentType: "예비", siblings: "첫째 있음, 상담 학생은 둘째", siblingsDetails: "재원", prevAcademy: "이전 학원", lastScore: "90", followUpDate: "2026-11-01", followUpContent: "전화", nonRegistrationReason: "시간" };
  const { container } = render(<ConsultationFullForm mode="edit" recordingOwner={{ tenantId: "t1", userId: "u1" }} initial={{ id: "c1", prospectName: "학생", ...values }} />);
  const form = container.querySelector("form")!;
  for (const [key, value] of Object.entries(values)) expect(new FormData(form).get(key), key).toBe(value);
  const career = form.querySelector('[name="careerGoal"]')!;
  expect(career.closest('[hidden]')).not.toBeNull();
  expect(getComputedStyle(career.closest('[hidden]')!).display).toBe("none");
  fireEvent.click(screen.getByRole("button", { name: "수학 상담" }));
  for (const [key, value] of Object.entries(values)) expect(new FormData(form).get(key), key).toBe(value);
  m.updateEnrollmentConsultation.mockResolvedValue({ error: "시험 종료" });
  await act(async () => { fireEvent.submit(form); });
  expect(m.updateEnrollmentConsultation).toHaveBeenCalledOnce();
  const sent = m.updateEnrollmentConsultation.mock.calls[0]![1] as FormData;
  for (const [key, value] of Object.entries(values)) expect(sent.get(key), key).toBe(value);
 });
});
