import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
    expect(container.querySelector('a[href="/owner?tab=sheets"]')).toHaveTextContent("학원 설정 → 연동에서 확인");
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
  it("영어 화면에서도 경고 확인 경로를 번역하고 원본 경고는 보존한다", async () => {
    g.lang = "en";
    const { container } = render(await MakeeduSyncBadge({ domain: "invoices" }));
    expect(container.querySelector("summary")).toHaveTextContent("View details");
    expect(container.textContent).toContain("학생 미매칭 4라인");
    expect(container.textContent).toContain("Open Academy settings → Integrations");
  });
});
