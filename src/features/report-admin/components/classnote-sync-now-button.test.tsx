import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const m = vi.hoisted(() => ({ status: vi.fn(), request: vi.fn() }));
vi.mock("@/features/report-admin/server/classnote-sync-actions", () => ({
  getClassnoteSyncStatus: m.status,
  requestClassnoteBoardSync: m.request,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ClassnoteSyncNowButton } from "./classnote-sync-now-button";

const now = Date.now();
const st = (p: Record<string, unknown>) => ({ available: true, workerReady: true, active: null, latest: null, nowMs: now, ...p });
const req = (p: Record<string, unknown>) => ({
  id: "r1",
  status: "pending",
  requestedAt: new Date(now - 60_000).toISOString(),
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
  scope: { full: true, classIds: [], studentIds: [] },
  mergeCount: 0,
  ...p,
});

beforeEach(() => vi.clearAllMocks());

describe("지금 반 보드 동기화 버튼", () => {
  it("숨김 상태(모듈 꺼짐·SQL 전·권한 없음)면 아무것도 그리지 않는다", async () => {
    m.status.mockResolvedValue(st({ available: false }));
    const { container } = render(<ClassnoteSyncNowButton source="t" />);
    await waitFor(() => expect(m.status).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("다른 화면에서 이미 요청됨 = 잠긴 '요청됨 · 연동 PC 대기 중'", async () => {
    m.status.mockResolvedValue(st({ active: req({}) }));
    render(<ClassnoteSyncNowButton source="t" />);
    const b = await screen.findByRole("button", { name: /요청됨 · 연동 PC 대기 중/ });
    expect(b).toBeDisabled();
  });

  it("설명은 연동 PC가 실제로 하는 일만 말한다 — 자동 동기화를 하는 지점에서만 '스스로 맞춘다'고 적는다", async () => {
    m.status.mockResolvedValue(st({}));
    const { unmount } = render(<ClassnoteSyncNowButton source="t" />);
    const plain = await screen.findByRole("button", { name: /지금 반 보드 동기화/ });
    expect(plain.getAttribute("title")).toContain("매일 새벽 5시");
    expect(plain.getAttribute("title")).not.toContain("스스로 맞추고");
    unmount();
    m.status.mockResolvedValue(st({ autoSync: true }));
    render(<ClassnoteSyncNowButton source="t" />);
    const auto = await screen.findByRole("button", { name: /지금 반 보드 동기화/ });
    expect(auto.getAttribute("title")).toContain("낮 동안 달라진 반을 몇 분 안에 스스로 맞추고");
    expect(auto.getAttribute("title")).toContain("매일 새벽 5시");
  });

  it("실행 중 = '동기화 중…' 잠김", async () => {
    m.status.mockResolvedValue(st({ active: req({ status: "running", startedAt: new Date(now - 30_000).toISOString() }) }));
    render(<ClassnoteSyncNowButton source="t" />);
    expect(await screen.findByRole("button", { name: /동기화 중…/ })).toBeDisabled();
  });

  it("누르는 즉시 잠기고(연타 방지) 응답 상태로 바뀐다", async () => {
    m.status.mockResolvedValue(st({}));
    let resolve!: (v: unknown) => void;
    m.request.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<ClassnoteSyncNowButton source="t" />);
    const b = await screen.findByRole("button", { name: /지금 반 보드 동기화/ });
    fireEvent.click(b);
    fireEvent.click(b);
    expect(m.request).toHaveBeenCalledTimes(1);
    expect(b).toBeDisabled();
    await act(async () => resolve({ ok: true, message: "요청했습니다", status: st({ active: req({}) }) }));
    expect(await screen.findByRole("button", { name: /요청됨/ })).toBeDisabled();
  });

  it("실패 = 한글 사유 표시, 원문은 툴팁", async () => {
    m.status.mockResolvedValue(
      st({ latest: req({ status: "failed", finishedAt: new Date(now - 60_000).toISOString(), error: "ClassNote 로그인에 실패했습니다", result: { raw: "Error: 401" } }) }),
    );
    render(<ClassnoteSyncNowButton source="t" />);
    const note = await screen.findByText(/ClassNote 로그인에 실패했습니다/);
    expect(note.getAttribute("title")).toBe("Error: 401");
  });
});

describe("🔴 배치 — 필요한 곳 네 자리", () => {
  it.each([
    ["src/app/(shell)/owner/_components/classnote-math-board-field.tsx", "owner_report_route"],
    ["src/app/(shell)/lesson-reports/_components/classnote-queue-card.tsx", "lesson_reports_queue"],
    ["src/app/(shell)/lesson-reports/_components/class-notice-panel.tsx", "class_notice"],
    ["src/features/onescreen/components/send-class-dialog.tsx", "onescreen_send_class"],
  ])("%s", (file, source) => {
    const src = readFileSync(join(process.cwd(), file), "utf8");
    expect(src).toContain(`<ClassnoteSyncNowButton source="${source}"`);
  });
});
