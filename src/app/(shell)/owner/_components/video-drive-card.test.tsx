import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ save: vi.fn(), view: vi.fn() }));
vi.mock("@/features/video-submit/server/drive-settings-actions", () => ({ saveVideoDriveSetting: m.save, getVideoDriveSettingsView: m.view }));

import { VideoDriveCard } from "./video-drive-card";
import { VideoDriveForm, type VideoDriveFormState } from "./video-drive-form";

const ROOT = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const VERSION = "12121212-1212-4121-8121-121212121212";
const saved: VideoDriveFormState = { ready: true, authReady: true, enabled: true, source: "saved", folderName: "침산 숙제영상", version: VERSION };
const setting = (over: Record<string, unknown> = {}) => ({ ...saved, rootId: ROOT, ...over });

beforeEach(() => {
  m.save.mockReset();
  m.view.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("숙제영상 드라이브 카드(학원 설정 → 연동)", () => {
  it("현재 폴더는 이름과 상태만 보인다 — 🔴 Drive로 나가는 링크도, 폴더 번호도 화면에 없다", async () => {
    m.view.mockResolvedValue({ setting: setting(), readOnly: false });
    const { container } = render(await VideoDriveCard());
    expect(screen.getByText("현재 저장 폴더")).toBeInTheDocument();
    expect(screen.getByText("침산 숙제영상")).toBeInTheDocument();
    expect(container.querySelector("a")).toBeNull();
    expect(container.innerHTML).not.toContain(ROOT);
    expect(container.innerHTML).not.toContain("drive.google.com");
  });
  it("새 폴더는 비어 있어야 한다는 것과 연동 계정의 파일 추가 권한을 안내한다 · 일반 화면 문구에 내부 설정 이름이 없다", async () => {
    m.view.mockResolvedValue({ setting: setting({ enabled: false, source: "none", folderName: null, version: null, rootId: null }), readOnly: false });
    const { container } = render(await VideoDriveCard());
    expect(screen.getByText(/아직 저장 폴더가 없습니다/)).toBeInTheDocument();
    expect(screen.getByText("비어 있어야")).toBeInTheDocument();
    expect(screen.getByText("파일을 추가할 수 있어야")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/OAuth|SQL|환경변수|env|토큰|슈퍼|총괄|super/i);
  });
  it("조회가 실패하거나 볼 수 없는 계정이면 한글 한 줄만 — 폼을 그리지 않는다", async () => {
    m.view.mockRejectedValue(new Error("사용할 수 없는 기능입니다."));
    render(await VideoDriveCard());
    expect(screen.getByText(/저장 폴더 설정을 읽지 못했습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("처음부터 쓰던 폴더(이름을 모를 수 있다)·해제된 상태를 가려 말한다", () => {
    const { rerender } = render(<VideoDriveForm state={{ ...saved, source: "legacy", folderName: null, version: null }} readOnly={false} />);
    expect(screen.getByText("기존에 연결된 폴더")).toBeInTheDocument();
    expect(screen.getByText(/처음부터 쓰던 폴더입니다/)).toBeInTheDocument();
    rerender(<VideoDriveForm state={{ ...saved, enabled: false, folderName: null }} readOnly={false} />);
    expect(screen.getByText(/연결이 해제되어 있습니다/)).toBeInTheDocument();
    // 해제된 상태엔 '연결 해제' 버튼이 없다(다시 정하기만 한다)
    expect(screen.queryByRole("button", { name: "연결 해제" })).toBeNull();
  });
});

describe("저장 폴더 폼", () => {
  const type = (value: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value } });
  const sent = () => Object.fromEntries((m.save.mock.calls[0]![1] as FormData).entries());

  it("폴더 주소와 지금 버전을 함께 보낸다(intent=save) · 성공하면 입력을 비우고 알린다", async () => {
    m.save.mockResolvedValue({ ok: true, nonce: 1 });
    render(<VideoDriveForm state={saved} readOnly={false} />);
    expect(screen.getByRole("button", { name: "확인 후 저장" })).toBeDisabled();
    type("  https://drive.google.com/drive/folders/NEW_FOLDER_ID_1234  ");
    fireEvent.click(screen.getByRole("button", { name: "확인 후 저장" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("저장 폴더를 저장했습니다"));
    expect(sent()).toEqual({ folder: "https://drive.google.com/drive/folders/NEW_FOLDER_ID_1234", version: VERSION, intent: "save" });
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
  it("서버가 거절하면 그 한글 사유를 보이고 입력은 남긴다 · 예기치 못한 실패도 한글 한 줄(원문 없음)", async () => {
    m.save.mockResolvedValueOnce({ error: "다른 화면에서 설정이 변경되었습니다. 새로고침해 주세요." });
    render(<VideoDriveForm state={saved} readOnly={false} />);
    type("FOLDER_ID_1234567");
    fireEvent.click(screen.getByRole("button", { name: "확인 후 저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("다른 화면에서 설정이 변경되었습니다"));
    expect(screen.getByRole("textbox")).toHaveValue("FOLDER_ID_1234567");
    // 확인이 끝나면 버튼이 다시 선다
    await waitFor(() => expect(screen.getByRole("button", { name: "확인 후 저장" })).toBeEnabled());
    m.save.mockRejectedValueOnce(new Error("TypeError: fetch failed at https://www.googleapis.com/…"));
    fireEvent.click(screen.getByRole("button", { name: "확인 후 저장" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("저장하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    expect(document.body.textContent).not.toContain("googleapis");
  });
  it("연결 해제는 한 번 더 묻고(intent=disconnect · 폴더 값 없이) 보낸다 — 취소하면 보내지 않는다", async () => {
    m.save.mockResolvedValue({ ok: true, nonce: 2 });
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    render(<VideoDriveForm state={saved} readOnly={false} />);
    type("남겨 둔 입력");
    fireEvent.click(screen.getByRole("button", { name: "연결 해제" }));
    expect(m.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "연결 해제" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("연결을 해제했습니다"));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(sent()).toEqual({ folder: "", version: VERSION, intent: "disconnect" });
  });
  it("버전이 없는 설정(처음부터 쓰던 폴더·미설정)은 빈 버전으로 보낸다", async () => {
    m.save.mockResolvedValue({ ok: true, nonce: 3 });
    render(<VideoDriveForm state={{ ...saved, source: "legacy", version: null }} readOnly={false} />);
    type("FOLDER_ID_1234567");
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    await waitFor(() => expect(m.save).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ version: "", intent: "save" });
  });
  it("🔴 읽기 전용 계정에는 입력도 버튼도 없다 · 아직 준비 전이면 바꿀 수 없다고만 알린다", () => {
    const { rerender } = render(<VideoDriveForm state={saved} readOnly />);
    expect(screen.getByText("침산 숙제영상")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/연동 설정을 바꿀 수 있는 계정만/)).toBeInTheDocument();
    rerender(<VideoDriveForm state={{ ...saved, ready: false, source: "legacy", version: null }} readOnly={false} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/아직 준비 중입니다/)).toBeInTheDocument();
  });
  it("연동 계정이 준비되지 않았으면 새 폴더를 저장할 수 없다(해제는 된다)", () => {
    render(<VideoDriveForm state={{ ...saved, authReady: false }} readOnly={false} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "확인 후 저장" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "연결 해제" })).toBeEnabled();
    fireEvent.submit(screen.getByRole("textbox").closest("form")!);
    expect(m.save).not.toHaveBeenCalled();
  });
});
