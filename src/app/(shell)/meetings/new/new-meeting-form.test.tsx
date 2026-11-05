import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * 새 회의록 저장 뒤 이동 — 서버 액션 직후라 `router.push`가 아니라 풀 문서 이동이어야 한다(#102:
 * push가 삼켜지면 창이 /meetings/new를 못 벗어나 자동으로 안 닫히고 '처리 중'에 멈춘다).
 * 회의록 행이 생긴 뒤엔 저장 버튼을 다시 열지 않는다(다시 누르면 업로드·행·전사가 한 벌 더).
 */
const m = vi.hoisted(() => ({
  inFrame: true,
  createTextMeeting: vi.fn(),
  startMeetingFromAudio: vi.fn(),
  issueAudioUploadTicket: vi.fn(),
  uploadToTicket: vi.fn(),
  listRecovery: vi.fn(),
  // 🔴 인자 타입은 **제네릭**으로 적는다 — `vi.fn(async () => {})`는 타입이 0인자로 굳어 아래 `m.clearRecovery(kind)`·
  //    `m.clearDraft(scope)`가 tsc에서 걸리고(TS2554), 쓰지 않는 인자를 구현에 적으면 lint가 경고한다.
  clearRecovery: vi.fn<(kind: string) => Promise<void>>(async () => {}),
  clearDraft: vi.fn<(scope: string) => Promise<void>>(async () => {}),
  push: vi.fn(),
}));
vi.mock("@/features/meetings/server/actions", () => ({
  createTextMeeting: (...a: unknown[]) => m.createTextMeeting(...a),
  startMeetingFromAudio: (...a: unknown[]) => m.startMeetingFromAudio(...a),
}));
vi.mock("@/features/media/server/upload-actions", () => ({
  issueAudioUploadTicket: (...a: unknown[]) => m.issueAudioUploadTicket(...a),
}));
vi.mock("@/lib/storage/upload-to-ticket", () => ({ uploadToTicket: (...a: unknown[]) => m.uploadToTicket(...a) }));
vi.mock("@/lib/recording-recovery", () => ({
  listRecovery: (...a: unknown[]) => m.listRecovery(...a),
  recordingScopeKey: (s: { tenantId: string; userId: string; recordKey: string }) => JSON.stringify([s.tenantId, s.userId, s.recordKey]),
  clearRecovery: (kind: string) => m.clearRecovery(kind),
  recoverRecording: async () => null,
  saveChunk: async () => {},
  patchRecoveryMeta: async () => {},
  listOwnerDiagnostics: async () => [],
  dropClearedMeta: async () => {},
  readRecoveryMeta: async () => null,
  startRecoverySession: async () => ({ id: "meeting-session", fileName: "회의녹음_주간 회의.webm" }),
}));
vi.mock("@/lib/form-draft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/form-draft")>()),
  saveDraft: async () => {},
  saveDraftOnHide: () => {},
  loadDraft: async () => null,
  clearDraft: (scope: string) => m.clearDraft(scope),
}));
vi.mock("@/lib/audio-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/audio-upload")>()),
  downloadFile: vi.fn(), // 녹음 정지 시 디스크 백업 — 테스트에선 내려받지 않는다
}));
vi.mock("@/components/workspace/use-recording-lock", () => ({ useRecordingLock: () => {} }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => m.inFrame }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: m.push, refresh: vi.fn() }) }));

import { NewMeetingForm } from "./new-meeting-form";

const FAILED = "회의록을 만들지 못했습니다 — 연결을 확인하고 다시 눌러 주세요";
const MAYBE_CREATED = "회의록이 만들어졌을 수 있습니다 — 목록에서 확인한 뒤 다시 시도해 주세요";

let assign: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  m.inFrame = true;
  for (const f of [m.createTextMeeting, m.startMeetingFromAudio, m.issueAudioUploadTicket, m.uploadToTicket, m.push]) {
    f.mockReset();
  }
  m.listRecovery.mockReset();
  m.listRecovery.mockResolvedValue([]);
  m.clearRecovery.mockClear();
  m.clearDraft.mockClear();
  m.issueAudioUploadTicket.mockResolvedValue({ ticket: { path: "t1/회의.mp3" } });
  m.uploadToTicket.mockResolvedValue(undefined);
  assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  // 가짜 타이머 — 떠나기 폴백(5초)을 기다리지 않고 넘긴다. RTL waitFor는 vitest 가짜 타이머와 안 맞아 안 쓴다.
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** 서버 액션 응답까지 흘려보낸다(await 여럿 — 업로드 경로는 티켓·업로드·액션·정리). */
async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

/** 폼을 그리고 마운트 조회(녹음 복구 확인)까지 흘려보낸 뒤 제목을 채운다. */
async function renderForm() {
  let utils!: ReturnType<typeof render>;
  await act(async () => {
    utils = render(<NewMeetingForm recordingOwner={{ tenantId: "t1", userId: "u1" }} canWrite />);
    await flush();
  });
  fireEvent.change(screen.getByLabelText(/회의 제목/), { target: { value: "주간 회의" } });
  return utils;
}

async function click(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
    await flush();
  });
}

/** 제목·메모만 채워 '메모로 회의록 만들기'를 누른다(녹음 없는 경로). */
async function submitTextMeeting() {
  await renderForm();
  fireEvent.change(screen.getByLabelText("메모장"), { target: { value: "안건 정리" } });
  await click(/메모로 회의록 만들기/);
}

/** 녹음 파일을 **업로드**로 골라 '업로드 및 분석 시작'을 누른다. */
async function submitUploadedAudio() {
  const { container } = await renderForm();
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(["x"], "회의.mp3", { type: "audio/mpeg" })] } });
  await click(/업로드 및 분석 시작/);
}

/** 이 화면에서 **바로 녹음**하고 정지한 뒤 '업로드 및 분석 시작'을 누른다. */
async function submitInlineRecording() {
  class FakeRecorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [] }), enumerateDevices: async () => [{ kind: "audioinput" }] },
  });
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}),
  } });
  await renderForm();
  await click(/바로 녹음/);
  await click(/녹음 끝내기/);
  await click(/업로드 및 분석 시작/);
}

describe("새 회의록 저장 뒤 이동(#102)", () => {
  it("창 안: 만든 회의록으로 embed를 유지한 풀 문서 이동(router.push 아님)", async () => {
    m.createTextMeeting.mockResolvedValue({ id: "m1" });
    await submitTextMeeting();
    expect(assign).toHaveBeenCalledWith("/meetings/m1?embed=1");
    expect(m.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /이동 중/ })).toBeDisabled();
  });

  it("창 밖(최상위 문서): embed 없이 그 주소 그대로", async () => {
    m.inFrame = false;
    m.createTextMeeting.mockResolvedValue({ id: "m1" });
    await submitTextMeeting();
    expect(assign).toHaveBeenCalledWith("/meetings/m1");
  });

  it("업로드한 녹음: 원문 오류 없이 그 회의록으로 가고, 남의 크래시 녹음(복구 조각)은 지우지 않는다", async () => {
    m.startMeetingFromAudio.mockResolvedValue({ id: "m2" });
    await submitUploadedAudio();
    expect(m.startMeetingFromAudio).toHaveBeenCalledTimes(1);
    expect(m.clearRecovery).not.toHaveBeenCalled(); // 업로드 파일 — IDB 조각은 다른 녹음(유일한 사본)
    expect(m.clearDraft).toHaveBeenCalledWith("meeting:new");
    expect(assign).toHaveBeenCalledWith("/meetings/m2?embed=1");
    expect(screen.queryByText(/NEXT_REDIRECT/)).toBeNull();
    expect(screen.queryByText(FAILED)).toBeNull();
    expect(screen.getByRole("button", { name: /이동 중/ })).toBeDisabled();
  });

  it("이 화면에서 녹음한 것이면 성공 뒤 그 녹음의 복구 조각을 비운다", async () => {
    m.startMeetingFromAudio.mockResolvedValue({ id: "m4" });
    await submitInlineRecording();
    expect(m.clearRecovery).toHaveBeenCalledWith("meeting-session");
    expect(assign).toHaveBeenCalledWith("/meetings/m4?embed=1");
  });

  it("행을 만든 뒤 전사 제출만 실패({ error, id }) — 버튼을 다시 열지 않고 그 회의록으로 간다", async () => {
    m.startMeetingFromAudio.mockResolvedValue({ error: "전사 서버에 연결하지 못했습니다", id: "m3" });
    await submitUploadedAudio();
    expect(assign).toHaveBeenCalledWith("/meetings/m3?embed=1");
    expect(m.clearDraft).toHaveBeenCalledWith("meeting:new");
    expect(screen.getByRole("button", { name: /이동 중/ })).toBeDisabled();
  });

  it("녹음 경로 응답 유실(reject) — 재시도를 권하지 않고 '만들어졌을 수 있음'을 알린다(원문은 툴팁)", async () => {
    m.startMeetingFromAudio.mockRejectedValue(new Error("Failed to fetch"));
    await submitUploadedAudio();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText(MAYBE_CREATED)).toHaveAttribute("title", "Failed to fetch");
  });

  it("이동이 늦으면 5초 뒤 진행형 안내와 링크를 보이고, 저장 버튼은 계속 잠근다(중복 생성 방지)", async () => {
    m.createTextMeeting.mockResolvedValue({ id: "m1" });
    await submitTextMeeting();
    expect(screen.queryByRole("link", { name: "여기를 누르세요" })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText(/화면을 여는 중입니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "여기를 누르세요" })).toHaveAttribute("href", "/meetings/m1?embed=1");
    expect(screen.getByRole("button", { name: /이동 중/ })).toBeDisabled();
    expect(m.createTextMeeting).toHaveBeenCalledTimes(1);
  });

  it("pagehide면 폴백을 풀고, 뒤로가기로 되살아나면(pageshow persisted) '이미 만든 회의록' + [열기]·[새로 작성]", async () => {
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    m.createTextMeeting.mockResolvedValue({ id: "m1" });
    await submitTextMeeting();
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole("link", { name: "여기를 누르세요" })).toBeNull();
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    });
    expect(screen.getByText(/이미 만든 회의록입니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "열기" })).toHaveAttribute("href", "/meetings/m1?embed=1");
    expect(screen.queryByText(/이동 중/)).toBeNull(); // 끝난 이동을 '이동 중'이라 하지 않는다
    expect(screen.getByRole("button", { name: /이미 만들었습니다/ })).toBeDisabled(); // 중복 방지는 유지
    fireEvent.click(screen.getByRole("button", { name: "새로 작성" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("떠나는 동안엔 녹음 복구 배너의 [복구하기]·[녹음 지우기]를 잠근다", async () => {
    m.listRecovery.mockResolvedValue([{ id: "meeting-old", startedAt: Date.parse("2026-09-12T01:00:00Z"), chunkCount: 3 }]);
    m.createTextMeeting.mockResolvedValue({ id: "m1" });
    await submitTextMeeting();
    expect(screen.getByRole("button", { name: "복구하기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "녹음 지우기" })).toBeDisabled();
  });

  it("저장이 실패하면 이동하지 않고 오류를 보인 채 다시 누를 수 있다", async () => {
    m.createTextMeeting.mockResolvedValue({ error: "회의록 권한이 없습니다" });
    await submitTextMeeting();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText("회의록 권한이 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /메모로 회의록 만들기/ })).toBeEnabled();
  });

  it("메모 경로: 액션 호출 자체가 실패(reject)해도 '저장 중…'에 멈추지 않는다 — 한글 오류(원문은 툴팁)", async () => {
    m.createTextMeeting.mockRejectedValue(new Error("Failed to fetch"));
    await submitTextMeeting();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText(FAILED)).toHaveAttribute("title", "Failed to fetch");
    expect(screen.queryByText("Failed to fetch")).toBeNull();
    expect(screen.getByRole("button", { name: /메모로 회의록 만들기/ })).toBeEnabled();
  });
});

/**
 * 읽기 권한으로 주소(/meetings/new)에 바로 들어온 경우 — 원장 2026-11-05 제보("다 쓰고 저장하니 그제서야 권한 없음").
 * 칸은 보이되 전부 잠그고 안내를 달며, 업로드·녹음·저장 단추는 아예 그리지 않는다(src/lib/write-lock.ts).
 */
describe("읽기 권한(canWrite=false)", () => {
  it("단추 없음 · 칸 비활성 · placeholder와 한 줄 안내", async () => {
    await act(async () => {
      render(<NewMeetingForm recordingOwner={{ tenantId: "t1", userId: "u1" }} canWrite={false} />);
      await flush();
    });
    for (const name of [/파일 업로드/, /바로 녹음/, /메모로 회의록 만들기/, /업로드 및 분석 시작/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    for (const label of [/회의 제목/, "참석자", "메모장"]) {
      const field = screen.getByLabelText(label);
      expect(field).toBeDisabled();
      expect(field).toHaveAttribute("placeholder", "회의록 작성 권한이 필요합니다");
    }
    expect(screen.getByLabelText("회의 일시")).toBeDisabled(); // 값이 차 있는 칸 — 안내는 위 한 줄이 맡는다
    expect(screen.getByText("읽기 권한입니다. 고치려면 회의록 작성 권한이 필요합니다.")).toBeInTheDocument();
    expect(m.listRecovery).not.toHaveBeenCalled(); // 녹음 복구 배너도 없다(되살릴 곳이 잠겨 있다)
  });
});
