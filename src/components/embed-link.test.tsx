import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

/**
 * `EmbedLink` — 서버 컴포넌트가 그리는 창 안 링크가 embed=1을 잃지 않게(FaceTabs·TabLink와 같은 규칙).
 * 소비처: ECS 면 칩·모드 칩·출결 모드 링크(`today-nav.tsx` — 서버 컴포넌트라 훅을 못 쓴다).
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));
const frame = vi.hoisted(() => ({ inFrame: false }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => frame.inFrame }));

import { EmbedProvider } from "@/components/workspace/embed-context";
import { EmbedAnchor, EmbedHiddenInput, EmbedLink } from "./embed-link";
import {
  EcsFaceTabs,
  EcsQuickAttendanceLink,
  EcsTodayModeTabs,
} from "@/app/(shell)/ecs/_components/today-nav";

afterEach(() => {
  cleanup();
  frame.inFrame = false;
});

const inWindow = (ui: ReactNode) => render(<EmbedProvider embed>{ui}</EmbedProvider>);

describe("EmbedLink", () => {
  it("창 안이면 href에 embed=1을 싣는다", () => {
    inWindow(<EmbedLink href="/ecs?view=week">주간</EmbedLink>);
    expect(screen.getByText("주간").getAttribute("href")).toBe("/ecs?view=week&embed=1");
  });

  it("창 밖(최상위·폰)이면 그대로", () => {
    render(<EmbedLink href="/ecs?view=week">주간</EmbedLink>);
    expect(screen.getByText("주간").getAttribute("href")).toBe("/ecs?view=week");
  });

  it("나머지 속성은 그대로 넘긴다", () => {
    inWindow(
      <EmbedLink href="/ecs" className="chip" aria-current="page" title="오늘">
        오늘
      </EmbedLink>,
    );
    const a = screen.getByText("오늘");
    expect(a.className).toBe("chip");
    expect(a.getAttribute("aria-current")).toBe("page");
    expect(a.getAttribute("title")).toBe("오늘");
  });
});

describe("EmbedAnchor·EmbedHiddenInput — 하드 이동은 클라가 물리 프레임으로 판정", () => {
  it("🔴 창 안이면 <a> href에 embed=1(서버가 embed 없이 그린 첫 렌더여도 — EmbedProvider 없음)", () => {
    frame.inFrame = true;
    render(<EmbedAnchor href="/exams?subject=math">수학</EmbedAnchor>);
    const a = screen.getByText("수학");
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe("/exams?subject=math&embed=1");
  });

  it("창 밖이면 그대로", () => {
    render(<EmbedAnchor href="/exams?subject=math">수학</EmbedAnchor>);
    expect(screen.getByText("수학").getAttribute("href")).toBe("/exams?subject=math");
  });

  it("GET 폼 hidden embed — 창 안에서만", () => {
    frame.inFrame = true;
    const inside = render(
      <form>
        <EmbedHiddenInput />
      </form>,
    );
    expect(inside.container.querySelector('input[name="embed"]')?.getAttribute("value")).toBe("1");
    inside.unmount();
    frame.inFrame = false;
    const outside = render(
      <form>
        <EmbedHiddenInput />
      </form>,
    );
    expect(outside.container.querySelector('input[name="embed"]')).toBeNull();
  });
});

describe("🔴 ECS 면·모드 칩과 출결 모드 링크는 창 안에서 embed를 유지한다($[6].findings[2])", () => {
  it("면 칩(오늘·주간·자리)", () => {
    inWindow(<EcsFaceTabs face="week" />);
    for (const a of screen.getAllByRole("link")) {
      expect(new URL(a.getAttribute("href")!, "http://x").searchParams.get("embed"), a.textContent ?? "").toBe("1");
    }
  });

  it("모드 칩(시트·카드)", () => {
    inWindow(<EcsTodayModeTabs mode="sheet" date="2026-09-11" />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/ecs?view=today&date=2026-09-11&embed=1",
      "/ecs?view=today&date=2026-09-11&mode=cards&embed=1",
    ]);
  });

  it("출결 모드 링크", () => {
    // base-ui Button이 render 요소에 role="button"을 달아 역할로는 못 찾는다 — 앵커를 직접 본다.
    const { container } = inWindow(<EcsQuickAttendanceLink />);
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/attendance/quick?embed=1");
  });
});
