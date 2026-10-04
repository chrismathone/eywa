import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));

import { VideoDriveAccount, type VideoDriveAccountState } from "./video-drive-account";

const VERSION = "12121212-1212-4121-8121-121212121212";
const START = "/api/integrations/homework-video-drive/start";
const none: VideoDriveAccountState = { ready: true, email: null, status: null, receiving: false, version: null };
const connected: VideoDriveAccountState = { ready: true, email: "branch@example.com", status: "ready", receiving: true, version: VERSION };

/** 같은 출처의 다른 탭(결과 화면)이 보내는 신호를 흉내 낸다. */
class FakeChannel {
  static instances: FakeChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(readonly name: string) { FakeChannel.instances.push(this); }
  close() { this.closed = true; }
}
const forms = (container: HTMLElement) => [...container.querySelectorAll("form")];
const fields = (form: HTMLFormElement) => Object.fromEntries([...form.querySelectorAll("input")].map((input) => [input.name, input.value]));
/** 폼을 제출하고, 화면이 그 제출을 막았는지(확인 창에서 취소) 돌려준다. */
const submit = (form: HTMLFormElement) => !fireEvent.submit(form);

beforeEach(() => {
  m.refresh.mockReset();
  FakeChannel.instances = [];
  vi.stubGlobal("BroadcastChannel", FakeChannel);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("숙제영상 드라이브 — Google 계정", () => {
  it("연결 전: 새 탭으로 POST하는 폼 하나(의도=switch) — 받고 있는 영상이 없으면 확인 없이 시작한다", () => {
    const confirm = vi.fn();
    vi.stubGlobal("confirm", confirm);
    const { container } = render(<VideoDriveAccount state={none} readOnly={false} />);
    expect(screen.getByText(/아직 이 지점의 Google 계정을 연결하지 않았습니다/)).toBeInTheDocument();
    const [form] = forms(container);
    expect(forms(container)).toHaveLength(1);
    expect(form!.getAttribute("action")).toBe(START);
    expect(form!.getAttribute("method")).toBe("post");
    expect(form!.getAttribute("target")).toBe("_blank"); // 창 모드의 iframe 안에서는 Google 화면이 열리지 않는다
    expect(fields(form!)).toEqual({ intent: "switch", version: "" });
    expect(screen.getByRole("button", { name: "Google 계정 연결" })).toBeInTheDocument();
    expect(submit(form!)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("새 창에서 Google 로그인을 마치면");
  });
  it("기존 폴더로 받고 있는 지점이 처음 연결할 때는 '새 폴더를 정할 때까지 받지 않는다'를 먼저 묻는다 — 취소하면 시작하지 않는다", () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    const { container } = render(<VideoDriveAccount state={{ ...none, receiving: true }} readOnly={false} />);
    expect(submit(forms(container)[0]!)).toBe(true);
    expect(confirm.mock.calls[0]![0]).toContain("새로 받지 않습니다");
    expect(screen.queryByRole("status")).toBeNull();
    expect(submit(forms(container)[0]!)).toBe(false);
  });
  it("연결됨: 계정 이메일과 상태 · '다시 연결'은 확인 없이, '다른 계정으로 바꾸기'는 확인을 받은 뒤에만 — 설정 버전을 함께 보낸다", () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    const { container } = render(<VideoDriveAccount state={connected} readOnly={false} />);
    expect(screen.getByText("branch@example.com")).toBeInTheDocument();
    expect(screen.getByText("정상")).toBeInTheDocument();
    const [reconnect, change] = forms(container);
    expect(fields(reconnect!)).toEqual({ intent: "reconnect", version: VERSION });
    expect(fields(change!)).toEqual({ intent: "switch", version: VERSION });
    expect(submit(reconnect!)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(submit(change!)).toBe(true); // 취소
    expect(confirm.mock.calls[0]![0]).toContain("다른 Google 계정으로 바꿀까요?");
    expect(submit(change!)).toBe(false);
  });
  it("다시 연결이 필요하면 그 사실과 그동안 받지 않는다는 것을 알린다", () => {
    render(<VideoDriveAccount state={{ ...connected, status: "needs_reauth" }} readOnly={false} />);
    expect(screen.getByText("다시 연결 필요")).toBeInTheDocument();
    expect(screen.getByText(/같은 계정으로 다시 로그인해 주세요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 연결" })).toBeInTheDocument();
  });
  it("🔴 읽기 전용 계정·준비 전에는 연결 폼이 없다 · 일반 화면 문구에 내부 이름이 없다", () => {
    const { container, rerender } = render(<VideoDriveAccount state={connected} readOnly />);
    expect(screen.getByText("branch@example.com")).toBeInTheDocument();
    expect(forms(container)).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<VideoDriveAccount state={{ ...none, ready: false }} readOnly={false} />);
    expect(forms(container)).toHaveLength(0);
    expect(screen.getByText(/아직 준비 중입니다/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/OAuth|SQL|환경변수|env|토큰|슈퍼|총괄|super/i);
  });
});

describe("새 탭이 끝난 뒤", () => {
  const signal = (data: unknown) => act(() => { for (const channel of FakeChannel.instances) channel.onmessage?.({ data }); });
  it("결과 화면의 신호를 받으면 스스로 새로 읽는다 — 정해 둔 신호만 받는다", () => {
    const { unmount } = render(<VideoDriveAccount state={none} readOnly={false} />);
    expect(FakeChannel.instances.map((channel) => channel.name)).toEqual(["aywa-video-drive-oauth"]);
    signal({ type: "something-else", status: "connected" });
    signal(null);
    expect(m.refresh).not.toHaveBeenCalled();
    signal({ type: "video-drive-oauth", status: "connected" });
    expect(m.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Google 계정을 연결했습니다");
    signal({ type: "video-drive-oauth", status: "rejected" });
    expect(screen.getByRole("alert")).toHaveTextContent("연결을 마치지 못했습니다");
    unmount();
    expect(FakeChannel.instances[0]!.closed).toBe(true);
  });
  it("신호를 못 받아도 시작한 뒤 이 화면으로 돌아오면 새로 읽는다(시작하지 않았으면 읽지 않는다)", () => {
    const { container } = render(<VideoDriveAccount state={none} readOnly={false} />);
    fireEvent.focus(window);
    expect(m.refresh).not.toHaveBeenCalled();
    fireEvent.submit(forms(container)[0]!);
    fireEvent.focus(window);
    expect(m.refresh).toHaveBeenCalledTimes(1);
  });
});
