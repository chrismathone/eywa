import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/timetable", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import type { ReactNode } from "react";
import { NavigationProvider } from "@/features/owner/navigation-context";
import type { MenuGroupLayout, MenuLayout } from "@/features/owner/menu-layout";
import { PageHeader, PageHeaderSkeleton } from "./page-header";

beforeEach(() => {
  nav.pathname = "/timetable";
  nav.search = "";
});

/** 한 줄 헤더(원장 2026-10-01 *"구조도 3행이 아니라 1행으로 — 수업운영 - 시간표 - 주간 시간표"*). */
describe("PageHeader 한 줄", () => {
  it("eyebrow - 제목 - 설명이 한 묶음(같은 줄 flex)에 서고 구분자는 읽지 않는다", () => {
    const { container } = render(<PageHeader eyebrow="수업 운영" title="시간표" description="수학 주간표" />);
    const heading = screen.getByRole("heading", { name: "시간표" });
    const group = heading.parentElement!.parentElement!;
    expect(group.className).toContain("flex-wrap");
    expect(group.textContent).toBe("수업-시간표-수학 주간표");
    expect(group.querySelectorAll("[aria-hidden]")).toHaveLength(2);
    // 구분자는 뒤 항목과 한 덩어리 — 줄이 꺾여도 ` - `가 앞 줄 끝에 홀로 남지 않는다.
    expect(heading.parentElement!.textContent).toBe("-시간표");
    expect(container.querySelectorAll("header")).toHaveLength(1);
  });

  it("eyebrow·설명이 없고 메뉴 밖 화면이면 제목만(구분자 없음)", () => {
    nav.pathname = "/me";
    const { container } = render(<PageHeader title="내 정보" />);
    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(0);
  });

  it("동작이 없으면 오른쪽 칸은 비어(empty:hidden) 자리를 안 먹고, 있으면 같은 줄 오른쪽에 선다", () => {
    const none = render(<PageHeader title="시간표" />);
    const slot = none.container.querySelector("header > div > div:last-child")!;
    expect(slot.children).toHaveLength(0);
    expect(slot.className).toContain("empty:hidden");
    none.unmount();
    render(<PageHeader title="시간표" actions={<button type="button">새로 만들기</button>} />);
    expect(screen.getByRole("button", { name: "새로 만들기" })).toBeTruthy();
  });

  it("스켈레톤도 같은 한 줄 헤더 껍데기(구분선 포함)", () => {
    const { container } = render(<PageHeaderSkeleton />);
    expect(container.querySelector("header")!.className).toContain("border-b");
  });
});

/**
 * 앞부분(eyebrow) = 왼쪽 사이드바에서 그 메뉴가 속한 그룹 이름(원장 2026-10-01 *"상단 헤더에 잘못된거 같은데? 상담.재원 - 콜&상담 같은데"*).
 */
describe("eyebrow = 사이드바 그룹", () => {
  const eyebrowOf = (c: HTMLElement) => c.querySelector("[data-page-header-title] > p")?.textContent ?? null;
  const withNav = (ui: ReactNode, menus: MenuLayout = [], groups: MenuGroupLayout = []) => (
    <NavigationProvider menus={menus} groups={groups}>
      {ui}
    </NavigationProvider>
  );

  it("🔴 콜&상담 = '상담·재원 - 콜&상담'(화면이 적은 '콜&상담'은 폴백일 뿐)", () => {
    nav.pathname = "/enrollment";
    const { container } = render(<PageHeader eyebrow="콜&상담" title="콜&상담" />);
    expect(eyebrowOf(container)).toBe("상담·재원");
    expect(container.querySelector("[data-page-header-title]")!.textContent).toBe("상담·재원-콜&상담");
  });

  it("메뉴에 없는 화면(상세·새로 만들기)은 부모 메뉴의 그룹", () => {
    nav.pathname = "/approvals/new";
    expect(eyebrowOf(render(<PageHeader eyebrow="전자결재" title="결재 문서 작성" />).container)).toBe("문서·결재");
  });

  it("학원 설정에서 바꾼 그룹 이름을 따른다(사이드바와 같은 소스)", () => {
    nav.pathname = "/enrollment";
    const { container } = render(withNav(<PageHeader eyebrow="콜&상담" title="콜&상담" />, [], [{ id: "counsel", label: "상담실" }]));
    expect(eyebrowOf(container)).toBe("상담실");
  });

  it("메뉴를 다른 그룹(새 그룹)으로 옮기면 그 그룹 이름", () => {
    nav.pathname = "/attendance/live";
    nav.search = "date=2026-09-01";
    const { container } = render(
      withNav(
        <PageHeader eyebrow="수업" title="오늘 출결" />,
        [{ href: "/attendance/live", groupId: "custom-office" }],
        [{ id: "custom-office", label: "교무실", icon: "folder" }],
      ),
    );
    expect(eyebrowOf(container)).toBe("교무실");
  });

  it("메뉴 밖 화면(슈퍼관리자·내 정보)은 화면이 적은 값 · 그룹을 숨겼으면 앞부분 없음(옛 손 문구로 돌아가지 않는다)", () => {
    nav.pathname = "/super-admin/usage";
    expect(eyebrowOf(render(<PageHeader eyebrow="슈퍼관리자" title="이용 분석" />).container)).toBe("슈퍼관리자");
    nav.pathname = "/withdrawals";
    const hidden = render(withNav(<PageHeader eyebrow="학생 케어" title="퇴원관리" />, [], [{ id: "counsel", hidden: true }]));
    expect(eyebrowOf(hidden.container)).toBeNull();
    expect(hidden.container.querySelector("[data-page-header-title]")!.textContent).toBe("퇴원관리");
  });

  it("그룹 이름과 제목이 같으면 앞부분과 구분자를 뺀다(회의록 - 회의록 금지)", () => {
    nav.pathname = "/meetings";
    const { container } = render(<PageHeader eyebrow="운영" title="회의록" />);
    expect(eyebrowOf(container)).toBeNull();
    expect(container.querySelector("[data-page-header-title]")!.textContent).toBe("회의록");
    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(0);
  });

  it("🔴 서버 렌더도 같은 그룹 이름 — 첫 HTML과 클라가 갈리지 않는다([[#108]])", () => {
    nav.pathname = "/enrollment/abc";
    const html = renderToString(<PageHeader eyebrow="콜&상담" title="상담 상세" />);
    expect(html).toContain("상담·재원");
    expect(html).not.toContain(">콜&amp;상담<");
  });
});
