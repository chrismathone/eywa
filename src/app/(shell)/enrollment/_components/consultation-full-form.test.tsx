import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * 콜&상담 수정 저장 뒤 — 서버 액션 직후라 풀 문서 이동(#102)이고, 이동 대기 중엔 폼 전체를 잠근다(inert).
 * 잠그지 않으면 그 사이 친 글자가 pagehide에서 방금 지운 초안을 되살리고, 미저장 가드가 이동을 붙잡는다.
 */
const m = vi.hoisted(() => ({
  inFrame: true,
  updateEnrollmentConsultation: vi.fn(),
  saveDraftOnHide: vi.fn(),
  // 🔴 인자 타입은 **제네릭**으로 적는다 — `vi.fn(async () => {})`는 타입이 0인자로 굳어 아래 `m.clearDraft(scope)`가
  //    tsc에서 걸리고(TS2554), 쓰지 않는 인자를 구현에 적으면 lint가 경고한다(저장소 관례 = enrollment-table.test).
  clearDraft: vi.fn<(scope: string) => Promise<void>>(async () => {}),
}));
vi.mock("@/features/enrollment/server/actions", () => ({
  createEnrollmentConsultation: vi.fn(),
  updateEnrollmentConsultation: (...a: unknown[]) => m.updateEnrollmentConsultation(...a),
}));
vi.mock("@/features/media/server/upload-actions", () => ({ issueAudioUploadTicket: vi.fn() }));
vi.mock("@/lib/storage/upload-to-ticket", () => ({ uploadToTicket: vi.fn() }));
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
vi.mock("./audio-recorder-field", () => ({ AudioRecorderField: () => null }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => m.inFrame }));

import { ConsultationFullForm } from "./consultation-full-form";

let assign: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  m.inFrame = true;
  m.updateEnrollmentConsultation.mockReset();
  m.saveDraftOnHide.mockReset();
  m.clearDraft.mockClear();
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** 수정 폼을 그대로 저장하고 서버 액션 응답까지 흘려보낸다. */
async function saveEdit() {
  const { container } = render(<ConsultationFullForm mode="edit" initial={{ id: "c1", prospectName: "홍길동" }} />);
  const form = container.querySelector("form")!;
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

  it("저장이 실패하면 이동도 잠금도 없다(고쳐서 다시 저장할 수 있게)", async () => {
    m.updateEnrollmentConsultation.mockResolvedValue({ error: "콜&상담 권한이 없습니다" });
    const form = await saveEdit();
    expect(assign).not.toHaveBeenCalled();
    expect(form).not.toHaveAttribute("inert");
    expect(screen.getByText("콜&상담 권한이 없습니다")).toBeInTheDocument();
  });
});
