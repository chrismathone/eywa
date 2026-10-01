import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const desk = vi.hoisted(() => ({ on: true }));
vi.mock("./use-is-desktop", () => ({ useIsDesktop: () => desk.on }));
// 바탕이 실제로 그리는 세그먼트(라우터 트리) — 딥링크·새로고침이면 그 화면, 아니면 첫 화면.
const rendered = vi.hoisted(() => ({ segments: ["dashboard"] as string[] }));
vi.mock("next/navigation", () => ({ useSelectedLayoutSegments: () => rendered.segments }));

import { KeepaliveMainGate } from "./keepalive-main-gate";
import { ShellModeProvider, useShellMode, useShellModeEpoch } from "./shell-mode";
import { useWorkspaceEnabled, WorkspaceEnabledProvider } from "./workspace-enabled";
import { useWindowStore, windowId, type Win } from "./window-store";
import { SHELL_MODE_COOKIE, type ShellMode } from "@/lib/license/shell-mode";

const ID = windowId("route", "students");
const win = (minimized: boolean): Win => ({
  id: ID,
  kind: "route",
  params: { id: "students", title: "원생", href: "/students" },
  rect: { x: 0, y: 0, w: 1, h: 1 },
  minimized,
  maximized: false,
});

function Probe() {
  return (
    <span data-testid="probe">
      {useShellMode()}|{useShellModeEpoch()}
    </span>
  );
}

describe("ShellModeProvider — 문서 하나 동안 방식은 고정(적대 리뷰)", () => {
  it("🔴 바탕이 다시 그려져 새 방식·판이 내려와도 처음 값을 끝까지 쓴다(창 트리가 갈아 끼워져 입력이 끊기지 않게)", () => {
    const ui = (mode: ShellMode, epoch: string) => (
      <ShellModeProvider mode={mode} epoch={epoch}>
        <Probe />
      </ShellModeProvider>
    );
    const { rerender } = render(ui("keepalive", "e1"));
    expect(screen.getByTestId("probe").textContent).toBe("keepalive|e1");
    rerender(ui("windows", "e2"));
    expect(screen.getByTestId("probe").textContent).toBe("keepalive|e1");
  });

  it("처음 그릴 때 화면(iframe) 문서가 읽을 쿠키를 적는다 — 화면 모양을 부모와 같게", () => {
    document.cookie = `${SHELL_MODE_COOKIE}=windows; path=/`;
    render(
      <ShellModeProvider mode="keepalive" epoch="e1">
        <Probe />
      </ShellModeProvider>,
    );
    expect(document.cookie).toContain(`${SHELL_MODE_COOKIE}=keepalive`);
  });

  it("🔴 판을 모르는 문서(라이선스 조회 실패 — fail-open 창 모드)는 쿠키를 적지 않는다 — 다른 탭의 새 화면 모양을 흔들지 않게", () => {
    document.cookie = `${SHELL_MODE_COOKIE}=keepalive; path=/`;
    render(
      <ShellModeProvider mode="windows" epoch={null}>
        <Probe />
      </ShellModeProvider>,
    );
    expect(document.cookie).toContain(`${SHELL_MODE_COOKIE}=keepalive`);
  });
});

describe("KeepaliveMainGate — 바탕이 첫 화면이 아닌 사본을 그리고 있으면 잠재운다", () => {
  const effects = { mounted: 0, cleaned: 0 };
  function Page() {
    useEffect(() => {
      effects.mounted += 1;
      return () => {
        effects.cleaned += 1;
      };
    }, []);
    return <div data-testid="page">본문</div>;
  }
  const shell = (mode: ShellMode) => (
    <WorkspaceEnabledProvider enabled>
      <ShellModeProvider mode={mode} epoch="t">
        <KeepaliveMainGate>
          <Page />
        </KeepaliveMainGate>
      </ShellModeProvider>
    </WorkspaceEnabledProvider>
  );

  beforeEach(() => {
    desk.on = true;
    rendered.segments = ["dashboard"];
    effects.mounted = 0;
    effects.cleaned = 0;
    useWindowStore.setState({ windows: {}, order: [], focusedId: null });
  });

  it("🔴 딥링크·새로고침으로 바탕이 그 화면의 사본이면 숨기고 효과(폴링·구독)를 멈춘다", () => {
    rendered.segments = ["attendance", "live"];
    render(shell("keepalive"));
    expect(screen.getByTestId("page").style.display).toBe("none");
    expect(effects.cleaned).toBe(effects.mounted); // 돌던 효과가 없다
  });

  it("🔴 첫 화면(운영실)은 화면이 덮고 있어도 잠재우지 않는다 — 스크롤·상태가 그대로(돌아오면 그 자리)", () => {
    useWindowStore.setState({ windows: { [ID]: win(false) }, order: [ID], focusedId: ID });
    render(shell("keepalive"));
    expect(screen.getByTestId("page").style.display).not.toBe("none");
    expect(effects.mounted).toBe(1);
    expect(effects.cleaned).toBe(0);
  });

  it("라우터가 첫 화면으로 갈아 끼우면 보인다", () => {
    rendered.segments = ["students"];
    const { rerender } = render(shell("keepalive"));
    expect(screen.getByTestId("page").style.display).toBe("none");
    rendered.segments = ["dashboard"];
    act(() => rerender(shell("keepalive")));
    expect(screen.getByTestId("page").style.display).not.toBe("none");
  });

  it("좁은 폭(모바일 셸 — 본문이 유일한 화면)에선 숨기지 않는다", () => {
    desk.on = false;
    rendered.segments = ["students"];
    render(shell("keepalive"));
    expect(screen.getByTestId("page").style.display).not.toBe("none");
  });

  it("창 모드(이 방식이 아님)에선 숨기지 않는다", () => {
    rendered.segments = ["students"];
    render(shell("windows"));
    expect(screen.getByTestId("page").style.display).not.toBe("none");
  });
});

describe("WorkspaceEnabledProvider — 문서 하나 동안 고정(재리뷰)", () => {
  function EnabledProbe() {
    return <span data-testid="en">{String(useWorkspaceEnabled())}</span>;
  }
  it("🔴 바탕이 다시 그려져 창 엔진 여부가 바뀌어 내려와도 처음 값을 쓴다 — 캔버스가 도중에 사라져 열린 창이 파괴되지 않게", () => {
    const { rerender } = render(
      <WorkspaceEnabledProvider enabled>
        <EnabledProbe />
      </WorkspaceEnabledProvider>,
    );
    rerender(
      <WorkspaceEnabledProvider enabled={false}>
        <EnabledProbe />
      </WorkspaceEnabledProvider>,
    );
    expect(screen.getByTestId("en").textContent).toBe("true");
  });
});
