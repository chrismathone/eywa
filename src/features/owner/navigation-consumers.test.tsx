import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { NavigationSection } from "@/app/(shell)/owner/_components/navigation-section";
import { NavigationProvider, useWindowPresentation } from "./navigation-context";
import { MobileTopNav } from "@/components/mobile-top-nav";
import { FaceTabs } from "@/components/face-tabs";
import { MenuPageTitle } from "./menu-page-title";
import { useWindowStore } from "@/components/workspace/window-store";
import { resolveMatrix } from "@/lib/permissions";
import type { NavigationSettings } from "./settings-types";

const mock = vi.hoisted(() => ({ refresh: vi.fn(), saved: null as null | ((m: { scope: string }) => void), pathname: "/attendance/live", search: "date=2026-09-01" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh, push: vi.fn() }), usePathname: () => mock.pathname, useSearchParams: () => new URLSearchParams(mock.search) }));
vi.mock("@/app/(shell)/owner/_components/section-form", () => ({ SectionForm: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/realtime/record-channel", () => ({ subscribeRecordSaved: (cb: typeof mock.saved) => { mock.saved = cb; return () => { mock.saved = null; }; } }));
vi.mock("@/components/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/features/notifications/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => false }));
afterEach(() => { cleanup(); mock.refresh.mockClear(); });

const empty: NavigationSettings = { menus: [], groups: [], teacherMenus: [] };
const configured: NavigationSettings = {
  // 출석부의 면 하나(오늘 출결)를 새 탭으로 — 수납의 면은 2026-10-14부터 메뉴가 아니다(화면 안 탭).
  menus: [{ href: "/attendance/live", label: "운영비", icon: "star", groupId: "custom-office" }],
  groups: [{ id: "custom-office", label: "교무실", icon: "folder" }], teacherMenus: [],
};

it("관리자 모바일 메뉴는 원생·상담 통계를 직접 열고 다른 상담 입구도 표시한다", () => {
  render(<MobileTopNav systemRole="admin" email="test@example.com" />);
  fireEvent.click(screen.getByLabelText("메뉴 열기"));
  expect(within(screen.getByRole("region", { name: "원생" })).getByRole("link", { name: "원생 통계" }))
    .toHaveAttribute("href", "/students/stats");
  const counsel = within(screen.getByRole("region", { name: "상담·재원" }));
  expect(counsel.getByRole("link", { name: "상담 통계" })).toHaveAttribute("href", "/consultations/stats");
  expect(counsel.getByRole("link", { name: "신규 콜&상담" })).toHaveAttribute("href", "/enrollment");
});

describe("실제 설정 편집기", () => {
  it("탭 추가 → 이름·아이콘 변경 → 기존 메뉴 이동 → 적용 payload", () => {
    const save = vi.fn();
    render(<NavigationSection initial={empty} teacherOpen={[]} onPreview={save} />);
    fireEvent.click(screen.getByRole("button", { name: "+ 탭 추가" }));
    fireEvent.change(screen.getByLabelText("큰 탭 이름"), { target: { value: "교무실" } });
    fireEvent.click(screen.getByRole("button", { name: /^시간표.*이동/ }));
    fireEvent.change(screen.getByLabelText("시간표 메뉴 이름"), { target: { value: "우리 일정" } });
    fireEvent.click(screen.getByLabelText("시간표 아이콘 선택"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "시간표 아이콘" })).getByRole("button", { name: "별" }));
    fireEvent.click(screen.getByRole("button", { name: "미리보기에 적용" }));
    const value = save.mock.calls[0][0] as NavigationSettings;
    const group = value.groups!.find((g) => g.label === "교무실")!;
    expect(value.menus.find((d) => d.href === "/timetable")).toMatchObject({ label: "우리 일정", icon: "star", groupId: group.id, hidden: false });
  });
  it("관리자 초기화 후 강사 구성은 보존된다", () => {
    const save = vi.fn();
    const teacherMenus = [{ href: "/students", hidden: true }];
    render(<NavigationSection initial={{ ...configured, teacherMenus }} teacherOpen={[]} onPreview={save} />);
    fireEvent.click(screen.getByRole("button", { name: "관리자뷰 기본 구성 복원" }));
    fireEvent.click(screen.getByRole("button", { name: "기본 구성으로 되돌리기" }));
    fireEvent.click(screen.getByRole("button", { name: "미리보기에 적용" }));
    expect(save.mock.calls[0][0]).toEqual({ menus: [], groups: [], teacherMenus, teacherGroups: [] });
  });
  it("강사 폴더 편집 → 메뉴 이동·이름 변경 → 강사만 초기화한다", () => {
    const save = vi.fn();
    render(<NavigationSection initial={configured} teacherOpen={["timetable"]} onPreview={save} />);
    fireEvent.click(screen.getByRole("button", { name: "강사뷰" }));
    fireEvent.click(screen.getByRole("button", { name: "+ 탭 추가" }));
    fireEvent.change(screen.getByLabelText("큰 탭 이름"), { target: { value: "수업 준비" } });
    fireEvent.click(screen.getByRole("button", { name: /^시간표.*이동/ }));
    fireEvent.change(screen.getByLabelText("시간표 메뉴 이름"), { target: { value: "우리 수업 일정" } });
    fireEvent.click(screen.getByRole("button", { name: "미리보기에 적용" }));
    const saved = save.mock.calls[0][0] as NavigationSettings;
    expect(saved.menus).toEqual(configured.menus);
    expect(saved.teacherGroups?.some((g) => g.label === "수업 준비")).toBe(true);
    expect(saved.teacherMenus.find((d) => d.href === "/timetable")?.label).toBe("우리 수업 일정");
    fireEvent.click(screen.getByRole("button", { name: "강사뷰 기본 구성 복원" }));
    fireEvent.click(screen.getByRole("button", { name: "기본 구성으로 되돌리기" }));
    fireEvent.click(screen.getByRole("button", { name: "미리보기에 적용" }));
    expect(save.mock.calls[1][0]).toEqual({ ...configured, teacherMenus: [], teacherGroups: [] });
  });
});

describe("실제 소비처", () => {
  it("모바일은 새 그룹과 옮긴 면을 표시하고 해당 메뉴만 활성화한다", () => {
    render(<NavigationProvider menus={configured.menus} groups={configured.groups}><MobileTopNav systemRole="master" email="test@example.com" menuLayout={configured.menus} isSuperAdmin /></NavigationProvider>);
    fireEvent.click(screen.getByLabelText("메뉴 열기"));
    const group = screen.getByRole("region", { name: "교무실" });
    const link = within(group).getByRole("link", { name: "운영비" });
    expect(link).toHaveAttribute("href", "/attendance/live");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.querySelector("img")).toHaveAttribute("src", "/icons/star.png");
  });
  it("모바일은 이동한 메뉴에도 실제 계정 권한을 적용한다", () => {
    const matrix = resolveMatrix([{ menu: "attendance", role: "manager", access: "none" }]);
    render(<NavigationProvider menus={configured.menus} groups={configured.groups}><MobileTopNav systemRole="manager" email="test@example.com" permMatrix={matrix} menuLayout={configured.menus} /></NavigationProvider>);
    fireEvent.click(screen.getByLabelText("메뉴 열기"));
    expect(screen.queryByRole("link", { name: "운영비" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "교무실" })).not.toBeInTheDocument();
  });
  it("화면 내부 탭도 변경 이름·아이콘을 적용한다", () => {
    render(<NavigationProvider menus={configured.menus} groups={configured.groups}><FaceTabs faces={[{ key: "live", href: "/attendance/live?date=2026-09-01", label: "오늘 출결" }]} active="live" /></NavigationProvider>);
    const link = screen.getByRole("link", { name: "운영비" });
    expect(link.querySelector("img")).toHaveAttribute("src", "/icons/star.png");
  });
  it("수납 이름을 바꿔도 화면 위 다른 탭(지출) 이름으로 번지지 않는다", () => {
    const faces = [{ key: "billing", href: "/billing", label: "수납" }, { key: "expenses", href: "/billing?tab=expenses&period=2026-09", label: "지출" }];
    render(<NavigationProvider menus={[{ href: "/billing", label: "청구실" }]}><FaceTabs faces={faces} active="expenses" /></NavigationProvider>);
    expect(screen.getByRole("link", { name: "지출" })).toBeInTheDocument();
    expect(screen.queryAllByRole("link", { name: "청구실" })).toHaveLength(1);
  });
  it("페이지의 메뉴 제목은 개명하지만 실제 내용인 제목은 보존한다", () => {
    render(<NavigationProvider menus={configured.menus}><span><MenuPageTitle title="오늘 출결" /></span><span><MenuPageTitle title="2026년 9월" /></span></NavigationProvider>);
    expect(screen.getByText("운영비")).toBeInTheDocument();
    expect(screen.getByText("2026년 9월")).toBeInTheDocument();
  });
  it("iframe 제목 갱신 후에도 변경 이름을 쓰며 상세 제목은 보존하고 초기화된다", () => {
    useWindowStore.getState().open("route", { id: "attendance", title: "오늘 출결", href: "/attendance/live" });
    const win = useWindowStore.getState().windows["route:attendance"];
    function Title({ href, title }: { href: string; title: string }) {
      const present = useWindowPresentation();
      return <span>{present(win, href, title).title}</span>;
    }
    const { rerender } = render(<NavigationProvider menus={configured.menus}><Title href="/attendance/live?embed=1" title="출석부" /></NavigationProvider>);
    expect(screen.getByText("운영비")).toBeInTheDocument();
    rerender(<NavigationProvider menus={configured.menus}><Title href="/attendance/live/record-123" title="김학생 출결 내역" /></NavigationProvider>);
    expect(screen.getByText("김학생 출결 내역")).toBeInTheDocument();
    rerender(<NavigationProvider menus={[]}><Title href="/attendance/live" title="출석부" /></NavigationProvider>);
    expect(screen.getByText("출석부")).toBeInTheDocument();
  });
  it("다른 문서 저장 신호는 같은 학원일 때만 서버값을 다시 읽는다", () => {
    render(<NavigationProvider tenantId="tenant-a" menus={[]}><span>메뉴</span></NavigationProvider>);
    mock.saved?.({ scope: "navigation:tenant-b" });
    expect(mock.refresh).not.toHaveBeenCalled();
    mock.saved?.({ scope: "navigation:tenant-a" });
    expect(mock.refresh).toHaveBeenCalledTimes(1);
  });
});
