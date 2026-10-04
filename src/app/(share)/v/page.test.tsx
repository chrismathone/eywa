import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 올리기 사이트 첫 화면(`/v`)이 지점을 폼에 어떻게 넘기나 — 하나뿐이면 그 지점에 고정, 여럿이거나 판정하지 못한 지점이 있으면 고르게 한다.
 * (지점 판정 자체는 server/site.test.ts, 폼 동작은 video-site-form.test.tsx.)
 */
const m = vi.hoisted(() => ({
  directory: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));
vi.mock("next/navigation", () => ({ notFound: m.notFound }));
vi.mock("@/features/video-submit/server/site", () => ({ siteDirectory: m.directory }));
vi.mock("./video-site-form", () => ({
  VideoSiteForm: (props: { academyName: string; branches: { id: string; name: string }[]; mustChoose: boolean }) => (
    <p data-testid="form">{JSON.stringify({ academyName: props.academyName, branches: props.branches, mustChoose: props.mustChoose })}</p>
  ),
}));

import VideoSitePage from "./page";

const A = { ok: true as const, tenantId: "11111111-1111-4111-8111-111111111111", academyName: "인재원", settings: {}, branchName: "인재원 침산" };
const B = { ok: true as const, tenantId: "99999999-9999-4999-8999-999999999999", academyName: "인재원", settings: {}, branchName: "인재원 수성" };
const props = async () => {
  render(await VideoSitePage());
  return JSON.parse(screen.getByTestId("form").textContent ?? "{}") as { academyName: string; branches: { id: string; name: string }[]; mustChoose: boolean };
};

beforeEach(() => {
  m.directory.mockReset();
  m.notFound.mockClear();
});

describe("올리기 사이트 첫 화면 — 지점 넘기기", () => {
  it("쓸 수 있는 지점이 하나뿐이면 그 지점을 넘기고 고르게 하지 않는다(요청은 그 지점에 고정된다)", async () => {
    m.directory.mockResolvedValue({ ok: true, sites: [A], partial: false });
    expect(await props()).toEqual({ academyName: "인재원", branches: [{ id: A.tenantId, name: "인재원 침산" }], mustChoose: false });
  });
  it("여럿이면 전부 넘기고 고르게 한다", async () => {
    m.directory.mockResolvedValue({ ok: true, sites: [A, B], partial: false });
    const got = await props();
    expect(got.mustChoose).toBe(true);
    expect(got.branches.map((b) => b.name)).toEqual(["인재원 침산", "인재원 수성"]);
  });
  it("🔴 판정하지 못한 지점이 있으면 하나만 남아도 자동으로 정하지 않는다 — 닫지도 않는다(멀쩡한 지점은 계속 쓴다)", async () => {
    m.directory.mockResolvedValue({ ok: true, sites: [A], partial: true });
    expect(await props()).toMatchObject({ branches: [{ id: A.tenantId, name: "인재원 침산" }], mustChoose: true });
    expect(screen.queryByText("지금은 영상을 받을 수 없습니다")).toBeNull();
  });
  it("쓰는 지점이 없으면 없는 주소(404) · 잠시 못 받거나 조회가 던지면 안내 한 줄", async () => {
    m.directory.mockResolvedValue({ ok: false, reason: "none" });
    await expect(VideoSitePage()).rejects.toThrow("NEXT_NOT_FOUND");
    m.directory.mockResolvedValue({ ok: false, reason: "unavailable" });
    const first = render(await VideoSitePage());
    expect(screen.getByText("지금은 영상을 받을 수 없습니다")).toBeInTheDocument();
    first.unmount();
    m.directory.mockRejectedValue(new Error("boom"));
    render(await VideoSitePage());
    expect(screen.getByText("지금은 영상을 받을 수 없습니다")).toBeInTheDocument();
  });
});
