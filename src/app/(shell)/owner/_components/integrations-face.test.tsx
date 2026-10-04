import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ slack: vi.fn() }));
vi.mock("@/features/slack/server/gate", () => ({ slackGate: m.slack }));
vi.mock("./slack-card", () => ({ SlackCard: () => <p>슬랙 카드</p> }));
vi.mock("./sheets-face", () => ({ SheetsFace: () => <p>시트 면</p> }));
vi.mock("./video-drive-card", () => ({ VideoDriveCard: () => <p>숙제영상 카드</p> }));
vi.mock("@/components/face-tabs", () => ({
  FaceTabs: ({ faces }: { faces: { key: string; label: string; href: string }[] }) => <nav>{faces.map((f) => <a key={f.key} href={f.href}>{f.label}</a>)}</nav>,
}));

import type { TenantSettings } from "@/features/owner/settings-types";
import { IntegrationsFace } from "./integrations-face";

const face = (disabled: string[], sub?: string, modulesOn = { makeedu: true, sheets: false }) => IntegrationsFace({
  sub, settings: { modules: { disabled }, operations: { subjects: [] } } as unknown as TenantSettings, modulesOn, page: 1, isEmbed: false,
});

beforeEach(() => m.slack.mockResolvedValue({ error: "꺼짐" }));

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
    expect(screen.queryByRole("navigation")).toBeNull();
    unmount();
    render(await face(["classnote"], undefined, { makeedu: false, sheets: false }));
    expect(screen.getByText("이 학원은 켜진 외부 연동이 없습니다")).toBeInTheDocument();
    // 꺼진 연동의 이름을 늘어놓지 않는다
    expect(screen.queryByText(/숙제영상/)).toBeNull();
  });
});
