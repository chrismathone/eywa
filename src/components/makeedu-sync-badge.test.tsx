import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MakeeduSyncBadge } from "./makeedu-sync-badge";
import { resolveMatrix } from "@/lib/permissions";

const g = vi.hoisted(() => ({
  state: null as null | { syncedAt: string; rowCount: number; status: string; issue: string | null },
  role: "master", lang: "ko",
}));
vi.mock("@/features/integrations/server/makeedu-sync", () => ({ getMakeeduSyncState: async () => g.state }));
vi.mock("@/features/teacher-view/server/lang", () => ({ getTeacherViewLang: async () => g.lang }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ systemRole: g.role }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ getUserPermMatrix: async () => resolveMatrix([]) }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
afterEach(cleanup);
beforeEach(() => {
  g.state = { syncedAt: "2026-09-21T04:41:24.251Z", rowCount: 0, status: "ok", issue: "학생 미매칭 4라인 · 부재 완납 4건(보존)" };
  g.role = "master"; g.lang = "ko";
});
describe("동기화 경고의 확인 경로", () => {
  it("성공한 실행의 미매칭 경고도 펼쳐 볼 수 있고 연동 화면으로 연결한다", async () => {
    const { container } = render(await MakeeduSyncBadge({ domain: "invoices" }));
    expect(container.querySelector("summary")).toHaveTextContent("확인 필요상세 확인");
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(container.textContent).toContain("학생 미매칭 4라인");
    expect(container.textContent).toContain("목록에 포함되지 않습니다");
    expect(container.querySelector('a[href="/owner?tab=sheets&sub=makeedu"]')).toHaveTextContent("학원 설정 → 연동에서 확인");
  });
  it("설정 권한이 없는 사용자는 막힌 링크 대신 관리자 확인 경로를 읽는다", async () => {
    g.role = "teacher";
    const { container } = render(await MakeeduSyncBadge({ domain: "invoices" }));
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("관리자에게 학원 설정 → 연동에서 확인을 요청하세요");
  });
  it("실패 원인을 읽을 수 있고 다른 도메인에는 수납 매칭 설명을 붙이지 않는다", async () => {
    g.state!.status = "error"; g.state!.issue = "scrape.cjs exited 1 — makeedu 세션 만료";
    const { container } = render(await MakeeduSyncBadge({ domain: "students" }));
    expect(container.querySelector("summary")).toHaveTextContent("동기화 실패");
    expect(container.textContent).toContain("다시 로그인이 필요합니다");
    expect(container.textContent).not.toContain("scrape.cjs");
    expect(container.textContent).not.toContain("학생 미매칭은");
  });
  it("정상 상태는 경고 없이 시각만 표시하고 미연동이면 배지를 표시하지 않는다", async () => {
    g.state!.issue = null;
    const { container, unmount } = render(await MakeeduSyncBadge({ domain: "invoices" }));
    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByText("상세 확인")).toBeNull();
    unmount(); g.state = null;
    expect(await MakeeduSyncBadge({ domain: "invoices" })).toBeNull();
  });
  it("한 줄을 나눠 쓰는 화면(overlay)은 상세를 배지 아래에 띄운다 — 다른 화면은 흐름 안 그대로", async () => {
    const floated = render(await MakeeduSyncBadge({ domain: "invoices", overlay: true }));
    expect(floated.container.querySelector("details")?.className).toContain("relative");
    const box = floated.container.querySelector('[role="region"]')!.parentElement!;
    expect(box.className).toContain("absolute");
    // 반투명 경고색 아래에 불투명 바탕 — 아래 표가 비치지 않게.
    expect(box.className).toContain("bg-card");
    floated.unmount();
    const inline = render(await MakeeduSyncBadge({ domain: "invoices" }));
    expect(inline.container.querySelector("details")?.className).not.toContain("relative");
    expect(inline.container.querySelector('[role="region"]')!.parentElement!.tagName).toBe("DETAILS");
  });
  it("띄운 상세는 바깥 클릭·Esc(초점이 밖이어도)로 닫히고, 다른 면으로 다시 그리면 닫힌 채 선다", async () => {
    const view = render(await MakeeduSyncBadge({ domain: "invoices", overlay: true }));
    // 브라우저처럼 열고 toggle을 보낸다 — 열린 상태가 바깥 클릭 감시까지 이어지는지(배선)를 함께 본다.
    const open = () => { const d = view.container.querySelector("details")!; d.open = true; fireEvent(d, new Event("toggle")); return d; };
    const pointer = (type: string) => {
      const Ctor = (globalThis as { PointerEvent?: typeof MouseEvent }).PointerEvent ?? MouseEvent;
      const ev = new Ctor(type, { bubbles: true, cancelable: true, clientX: 5, clientY: 5, button: 0 });
      Object.defineProperty(ev, "isPrimary", { value: true });
      return ev;
    };
    let details = open();
    act(() => { document.body.dispatchEvent(pointer("pointerdown")); document.body.dispatchEvent(pointer("pointerup")); });
    expect(details.open).toBe(false);
    details = open();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(details.open).toBe(false);
    // 면 전환(수납 → 교재)은 같은 자리에 다시 그린다 — 열린 상자를 물려받아 새 면 툴바를 덮지 않게.
    open();
    view.rerender(await MakeeduSyncBadge({ domain: "textbook_checks", overlay: true }));
    expect(view.container.querySelector("details")!.open).toBe(false);
  });
  it("영어 화면에서도 경고 확인 경로를 번역하고 원본 경고는 보존한다", async () => {
    g.lang = "en";
    const { container } = render(await MakeeduSyncBadge({ domain: "invoices" }));
    expect(container.querySelector("summary")).toHaveTextContent("View details");
    expect(container.textContent).toContain("학생 미매칭 4라인");
    expect(container.textContent).toContain("Open Academy settings → Integrations");
  });
});
