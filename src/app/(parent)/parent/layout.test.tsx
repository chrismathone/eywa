import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  state: vi.fn(),
  branding: vi.fn(),
  notices: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/app/(auth)/login/actions", () => ({ signOut: vi.fn() }));
vi.mock("@/features/shuttle/parent/server/parent-viewer", () => ({ getParentViewer: mocks.viewer }));
vi.mock("@/features/shuttle/parent/server/parent-availability", () => ({
  PARENT_PORTAL_UNAVAILABLE_MESSAGE: "지금은 이용할 수 있는 화면이 없습니다",
  PARENT_PORTAL_RETRY_MESSAGE: "지금 화면을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요",
  parentPortalState: mocks.state,
}));
vi.mock("@/features/owner/server/public-branding", () => ({ getPublicBrandingByTenantId: mocks.branding }));
vi.mock("@/features/shuttle/parent/server/parent-departure", () => ({ loadParentNotices: mocks.notices }));
vi.mock("@/features/shuttle/parent/components/departure-notice-list", () => ({
  DepartureNoticeList: () => <div>알림 줄</div>,
}));
vi.mock("./_components/parent-tabs", () => ({ ParentTabs: () => <nav>학부모 탭</nav> }));

import ParentSectionLayout from "./layout";

const viewer = { parentAccountId: "p1", tenantId: "t1", displayName: "김보호", children: [] };

describe("학부모 포털 레이아웃", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.viewer.mockResolvedValue(viewer);
    mocks.branding.mockResolvedValue({ settings: { profile: { name: "테스트 학원" } } });
    mocks.notices.mockResolvedValue([]);
  });

  afterEach(cleanup);

  it("셔틀이 켜지면 종전 포털 머리·탭·내용을 그린다", async () => {
    mocks.state.mockResolvedValue("on");
    render(await ParentSectionLayout({ children: <div>포털 내용</div> }));

    expect(screen.getByText("테스트 학원")).toBeInTheDocument();
    expect(screen.getByText("학부모 탭")).toBeInTheDocument();
    expect(screen.getByText("포털 내용")).toBeInTheDocument();
    expect(mocks.notices).toHaveBeenCalledWith(viewer);
  });

  it("셔틀이 꺼지면 기능 이름 없는 종착 안내와 로그아웃만 보이고 포털 데이터는 읽지 않는다", async () => {
    mocks.state.mockResolvedValue("off");
    render(await ParentSectionLayout({ children: <div>포털 내용</div> }));

    expect(screen.getByRole("heading", { name: "지금은 이용할 수 있는 화면이 없습니다" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeInTheDocument();
    expect(screen.queryByText("포털 내용")).not.toBeInTheDocument();
    expect(screen.queryByText(/셔틀/)).not.toBeInTheDocument();
    expect(mocks.branding).not.toHaveBeenCalled();
    expect(mocks.notices).not.toHaveBeenCalled();
  });

  it("설정을 확인하지 못하면 '기능 없음'이 아니라 다시 시도 안내를 보이고 데이터는 읽지 않는다", async () => {
    mocks.state.mockResolvedValue("unknown");
    render(await ParentSectionLayout({ children: <div>포털 내용</div> }));

    expect(screen.getByRole("heading", { name: /잠시 후 다시 시도해 주세요/ })).toBeInTheDocument();
    expect(screen.queryByText("포털 내용")).not.toBeInTheDocument();
    expect(mocks.branding).not.toHaveBeenCalled();
  });
});
