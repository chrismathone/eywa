import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/students" }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => false }));
const save = vi.hoisted(() => vi.fn<(on: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true })));
vi.mock("@/features/page-maximize/server/actions", () => ({ setMyPageMaximized: save }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
// 창 레지스트리(iframe) — 가짜 창을 넣어 부모 셸이 어느 메시지를 받아들이는지 본다.
const registry = vi.hoisted(() => new Map<string, { contentWindow: { postMessage: (m: unknown, o: string) => void } }>());
vi.mock("@/components/workspace/route-window", () => ({ iframeRegistry: registry }));

import { WorkspaceEnabledProvider } from "@/components/workspace/workspace-enabled";
import { ShellModeProvider } from "@/components/workspace/shell-mode";
import {
  PAGE_MAXIMIZE_QUERY_MESSAGE,
  PAGE_MAXIMIZE_SET_MESSAGE,
  PAGE_MAXIMIZE_STATE_MESSAGE,
} from "@/components/workspace/keepalive-frame";
import { PageMaximizeButton } from "./page-maximize-button";
import { PageMaximizeRoot } from "./page-maximize-root";
import { KeepaliveMaximizeSync } from "./keepalive-page-maximize";
import type { ShellMode } from "@/lib/license/shell-mode";

function Shell({ mode, enabled = true }: { mode: ShellMode; enabled?: boolean }) {
  return (
    <WorkspaceEnabledProvider enabled={enabled}>
      <ShellModeProvider mode={mode} epoch="test">
        <PageMaximizeRoot initial={false}>
          <PageMaximizeButton />
          {/* 실제로는 이전 화면 유지 무대(KeepaliveStage)만 그린다 — 그 방식일 때만 붙인다. */}
          {mode === "keepalive" ? <KeepaliveMaximizeSync /> : null}
        </PageMaximizeRoot>
      </ShellModeProvider>
    </WorkspaceEnabledProvider>
  );
}
const marker = (c: HTMLElement) => c.querySelector("[data-page-maximize]")?.getAttribute("data-page-maximize");

function fakeFrame() {
  const post = vi.fn();
  const win = { postMessage: post };
  registry.set("route:students", { contentWindow: win });
  return { win, post };
}
function message(data: unknown, source: unknown) {
  const e = new MessageEvent("message", { data, origin: window.location.origin });
  Object.defineProperty(e, "source", { value: source });
  act(() => {
    window.dispatchEvent(e);
  });
}

beforeEach(() => {
  registry.clear();
  save.mockClear();
});

describe("PageMaximizeRoot — 방식별 켜짐", () => {
  it("창 모드(창 엔진 켜짐 + windows)에는 없다 — 종전 그대로", () => {
    render(<Shell mode="windows" />);
    expect(screen.queryByRole("button", { name: "화면 최대화" })).toBeNull();
  });

  it("단일 화면은 종전 그대로 켜진다", () => {
    render(<Shell mode="single" enabled={false} />);
    expect(screen.getByRole("button", { name: "화면 최대화" })).toBeTruthy();
  });

  it("이전 화면 유지는 창 엔진이 켜져 있어도 켜진다", () => {
    render(<Shell mode="keepalive" />);
    expect(screen.getByRole("button", { name: "화면 최대화" })).toBeTruthy();
  });
});

describe("이전 화면 유지 — 화면(iframe)과의 메시지", () => {
  it("등록된 화면이 누른 '최대화'를 받아 저장하고, 모든 화면에 새 상태를 알린다", async () => {
    const f = fakeFrame();
    const { container } = render(<Shell mode="keepalive" />);
    f.post.mockClear();
    message({ type: PAGE_MAXIMIZE_SET_MESSAGE, on: true }, f.win);
    await waitFor(() => expect(save).toHaveBeenCalledWith(true)); // 저장은 줄을 선 뒤 부른다(누른 순서 보존)
    expect(marker(container)).toBe("on");
    expect(f.post).toHaveBeenCalledWith({ type: PAGE_MAXIMIZE_STATE_MESSAGE, on: true }, window.location.origin);
  });

  it("🔴 등록되지 않은 창(다른 창·위조)이 보낸 신호는 무시한다", () => {
    fakeFrame();
    const { container } = render(<Shell mode="keepalive" />);
    message({ type: PAGE_MAXIMIZE_SET_MESSAGE, on: true }, { postMessage: vi.fn() });
    expect(save).not.toHaveBeenCalled();
    expect(marker(container)).toBe("off");
  });

  it("다른 출처의 메시지는 무시한다", () => {
    const f = fakeFrame();
    render(<Shell mode="keepalive" />);
    const e = new MessageEvent("message", { data: { type: PAGE_MAXIMIZE_SET_MESSAGE, on: true }, origin: "https://evil.example" });
    Object.defineProperty(e, "source", { value: f.win });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("새로 열린 화면이 지금 상태를 물으면 그 화면에만 답한다", () => {
    const f = fakeFrame();
    render(<Shell mode="keepalive" />);
    f.post.mockClear();
    message({ type: PAGE_MAXIMIZE_QUERY_MESSAGE }, f.win);
    expect(f.post).toHaveBeenCalledWith({ type: PAGE_MAXIMIZE_STATE_MESSAGE, on: false }, window.location.origin);
  });

  it("창 모드·단일 화면에서는 화면 메시지를 듣지 않는다(저장이 일어나지 않는다)", () => {
    const f = fakeFrame();
    render(<Shell mode="single" enabled={false} />);
    message({ type: PAGE_MAXIMIZE_SET_MESSAGE, on: true }, f.win);
    expect(save).not.toHaveBeenCalled();
  });

  it("공급자가 없으면(창 모드 — 최대화가 없다) 동기화는 아무것도 안 한다", () => {
    const f = fakeFrame();
    render(<KeepaliveMaximizeSync />);
    message({ type: PAGE_MAXIMIZE_SET_MESSAGE, on: true }, f.win);
    expect(save).not.toHaveBeenCalled();
    expect(f.post).not.toHaveBeenCalled();
  });
});
