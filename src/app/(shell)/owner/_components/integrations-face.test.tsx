import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ slack: vi.fn(), mathOn: vi.fn(), canWrite: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ tenantId: "t1", systemRole: "admin" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: m.mathOn }));
vi.mock("./todays-math-card", () => ({
  TodaysMathCard: (p: { readOnly?: boolean; lockMenu?: string }) => <p data-readonly={String(!!p.readOnly)} data-lock={p.lockMenu}>오늘 수학 카드</p>,
}));
vi.mock("./todays-math-menus-card", () => ({ TodaysMathMenusCard: () => <p>오늘 수학 사용 메뉴</p> }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/features/slack/server/gate", () => ({ slackGate: m.slack }));
vi.mock("./slack-card", () => ({ SlackCard: () => <p>슬랙 카드</p> }));
vi.mock("./sheets-face", () => ({ SheetsFace: () => <p>시트 면</p> }));
vi.mock("./video-drive-card", () => ({ VideoDriveCard: () => <p>숙제영상 카드</p> }));
vi.mock("@/features/sync-agent/server/availability",()=>({agentTabAvailable:async(on:boolean)=>on}));
vi.mock("./agent-card",()=>({AgentCard:()=> <p>연동 PC 카드</p>}));
vi.mock("@/components/face-tabs", () => ({
  FaceTabs: ({ faces }: { faces: { key: string; label: string; href: string }[] }) => <nav>{faces.map((f) => <a key={f.key} href={f.href}>{f.label}</a>)}</nav>,
}));

import type { TenantSettings } from "@/features/owner/settings-types";
import { IntegrationsFace } from "./integrations-face";

const face = (disabled: string[], sub?: string, modulesOn = { makeedu: true, sheets: false }, canEdit = true) => IntegrationsFace({
  sub, settings: { modules: { disabled }, operations: { subjects: [] } } as unknown as TenantSettings, modulesOn, page: 1, isEmbed: false, canEdit,
});

beforeEach(() => {
  m.slack.mockResolvedValue({ error: "꺼짐" });
  m.mathOn.mockResolvedValue(false);
  m.canWrite.mockReset();
  m.canWrite.mockResolvedValue(true);
});

describe("연동 면의 내부 탭 — 숙제영상 드라이브는 ClassNote 기능이 있는 지점에만", () => {
  it("ClassNote 기능이 켜져 있으면 탭이 서고, 고른 탭만 그린다", async () => {
    const { unmount } = render(await face([]));
    expect(screen.getByRole("link", { name: "숙제영상 드라이브" })).toHaveAttribute("href", "/owner?tab=sheets&sub=video");
    // 고르지 않았으면 첫 탭(makeedu) — 카드는 그리지 않는다
    expect(screen.getByText("시트 면")).toBeInTheDocument();
    expect(screen.queryByText("숙제영상 카드")).toBeNull();
    unmount();
    render(await face([], "video"));
    expect(screen.getByText("숙제영상 카드")).toBeInTheDocument();
    expect(screen.queryByText("시트 면")).toBeNull();
  });
  it("🔴 ClassNote 기능이 꺼진 지점엔 탭도 카드도 없다 — 주소로 골라도 다른 탭으로 떨어진다", async () => {
    render(await face(["classnote"], "video"));
    expect(screen.queryByText("숙제영상 드라이브")).toBeNull();
    expect(screen.queryByText("숙제영상 카드")).toBeNull();
    expect(screen.getByText("시트 면")).toBeInTheDocument();
  });
  it("다른 연동이 하나도 없어도 ClassNote 기능이 있으면 이 카드 하나가 선다(탭 줄 없이) · 전부 꺼지면 빈 안내", async () => {
    const { unmount } = render(await face([], undefined, { makeedu: false, sheets: false }));
    expect(screen.getByText("숙제영상 카드")).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"연동 PC"})).toHaveAttribute("href","/owner?tab=sheets&sub=agent");
    unmount();
    render(await face(["classnote"], undefined, { makeedu: false, sheets: false }));
    expect(screen.getByText("이 학원은 켜진 외부 연동이 없습니다")).toBeInTheDocument();
    // 꺼진 연동의 이름을 늘어놓지 않는다
    expect(screen.queryByText(/숙제영상/)).toBeNull();
  });
});

describe("연동 면의 내부 탭 — 오늘 수학(개발 중 기능 스위치, 2026-10-17)", () => {
  it("지점 라이선스가 켜진 학원에만 탭이 서고, 고르면 카드를 그린다", async () => {
    m.mathOn.mockResolvedValue(true);
    render(await face([], "todaysMath"));
    expect(screen.getByRole("link", { name: "오늘 수학" })).toHaveAttribute("href", "/owner?tab=sheets&sub=todaysMath");
    expect(screen.getByText("오늘 수학 카드")).toBeInTheDocument();
  });
  it("🔴 토글 3개는 보고서 섹션에 저장되므로 보고서 설정 쓰기(report_settings)로 잠근다 — 연동 설정 쓰기만으론 열리지 않는다", async () => {
    m.mathOn.mockResolvedValue(true);
    m.canWrite.mockImplementation(async (_role: string, menu: string) => menu !== "report_settings");
    render(await face([], "todaysMath"));
    expect(m.canWrite).toHaveBeenCalledWith("admin", "report_settings");
    const card = screen.getByText("오늘 수학 카드");
    expect(card).toHaveAttribute("data-readonly", "true");
    expect(card).toHaveAttribute("data-lock", "report_settings");
  });
  it("연동 면 자체가 읽기(canEdit=false)면 보고서 설정 쓰기가 있어도 잠그고, 안내 키는 연동 설정이다", async () => {
    m.mathOn.mockResolvedValue(true);
    render(await face([], "todaysMath", undefined, false));
    const card = screen.getByText("오늘 수학 카드");
    expect(card).toHaveAttribute("data-readonly", "true");
    expect(card).toHaveAttribute("data-lock", "integration_settings");
  });
  it("🔴 라이선스가 꺼진 학원엔 탭도 카드도 없다 — 주소로 골라도 다른 탭으로", async () => {
    render(await face([], "todaysMath"));
    expect(screen.queryByText("오늘 수학")).toBeNull();
    expect(screen.queryByText("오늘 수학 카드")).toBeNull();
  });
});
