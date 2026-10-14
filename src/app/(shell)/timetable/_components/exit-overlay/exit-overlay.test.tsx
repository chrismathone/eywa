/**
 * 시간표 X 겹침(원장 2026-10-14) — 키로 열고 닫기 · 마우스 옆 · 달 이동 · 입력칸·드래그 중엔 안 연다.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExitOverlayData } from "@/features/withdrawals/exit-overlay-model";

const { loadExitOverlay } = vi.hoisted(() => ({ loadExitOverlay: vi.fn() }));
vi.mock("@/features/withdrawals/server/exit-overlay-actions", () => ({ loadExitOverlay }));
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { setTimetableDragging } from "../drag-flag";
import { placeNear, TimetableExitOverlay } from "./exit-overlay";

function data(anchor: string, canNewer: boolean): ExitOverlayData {
  const month = (m: string, live: boolean) => ({
    month: m,
    label: `${Number(m.slice(5))}월`,
    live,
    counts: { withdrawn: 1, subjectEnded: 0, excluded: 0 },
    groups: [
      {
        teacher: "박도윤",
        count: 1,
        inferred: 0,
        rows: [{ key: `r${m}`, kind: "withdrawn" as const, name: `학생${m.slice(5)}`, schoolGrade: "침산중2", dateLabel: `${Number(m.slice(5))}/2`, reason: "잦은 강사 변경", reasonTitle: "타 학원으로 이동 · 잦은 강사 변경", excluded: false, teacherNote: null }],
      },
    ],
    zero: ["윤하람"],
    holds: live ? [] : null,
  });
  const prev = (m: string) => {
    const [y, mm] = m.split("-").map(Number);
    return mm === 1 ? `${y! - 1}-12` : `${y}-${String(mm! - 1).padStart(2, "0")}`;
  };
  return {
    subjectLabel: "수학",
    anchor,
    months: [month(anchor, canNewer === false), month(prev(anchor), false), month(prev(prev(anchor)), false)],
    tints: { 박도윤: "#cfe2f3", 윤하람: "#d9d2e9" },
    canNewer,
    canOlder: true,
    withdrawalsHref: "/withdrawals?range=custom",
  };
}

const press = (code: string, init: Partial<KeyboardEventInit> = {}, target: EventTarget = document.body) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { code, key: init.key ?? code, bubbles: true, ...init }));
    await Promise.resolve();
  });

beforeEach(() => {
  loadExitOverlay.mockReset();
  loadExitOverlay.mockImplementation(async ({ anchor }: { anchor: string | null }) =>
    ({ ok: true, data: data(anchor ?? "2026-10", (anchor ?? "2026-10") !== "2026-10") }));
});
afterEach(() => {
  cleanup();
  setTimetableDragging(false);
});

describe("시간표 X 겹침", () => {
  it("X로 열면 석 달이 뜨고, 다시 X로 닫힌다 — 한글 입력 상태(key=ㅌ)도 같은 키 자리라 연다", async () => {
    render(<TimetableExitOverlay subject="math" />);
    await press("KeyX", { key: "ㅌ" });
    expect(loadExitOverlay).toHaveBeenCalledWith({ subject: "math", anchor: null });
    expect(await screen.findByRole("dialog", { name: "퇴원 · 수강종료 석 달" })).toBeTruthy();
    expect(screen.getByText("10월")).toBeTruthy();
    expect(screen.getByText("8월")).toBeTruthy();
    expect(screen.getAllByText("박도윤").length).toBe(3);
    await press("KeyX");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("←는 한 달 앞 묶음을 읽고, 이번 달 묶음에선 →가 막혀 있다 · Esc로 닫는다", async () => {
    render(<TimetableExitOverlay subject="math" />);
    await press("KeyX");
    await screen.findByText("10월");
    expect((screen.getByRole("button", { name: "다음 달 ›" }) as HTMLButtonElement).disabled).toBe(true);
    await press("ArrowLeft", { key: "ArrowLeft" });
    expect(loadExitOverlay).toHaveBeenLastCalledWith({ subject: "math", anchor: "2026-09" });
    await screen.findByText("7월");
    await press("Escape", { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("입력칸에서 친 X·조합키·드래그 중에는 열지 않는다", async () => {
    render(<><input aria-label="검색" /><TimetableExitOverlay subject="math" /></>);
    await press("KeyX", {}, screen.getByLabelText("검색"));
    await press("KeyX", { ctrlKey: true });
    setTimetableDragging(true);
    await press("KeyX");
    expect(loadExitOverlay).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("다른 팝업이 떠 있거나 팝업 안에서 친 X는 겹침을 열지 않는다", async () => {
    render(
      <>
        <div role="dialog" aria-label="반 이동"><button type="button">확인</button></div>
        <TimetableExitOverlay subject="math" />
      </>,
    );
    await press("KeyX", {}, screen.getByRole("button", { name: "확인" }));
    expect(loadExitOverlay).not.toHaveBeenCalled();
    cleanup();
    render(
      <>
        <div aria-modal="true">수강 종료 확인</div>
        <TimetableExitOverlay subject="math" />
      </>,
    );
    await press("KeyX");
    expect(loadExitOverlay).not.toHaveBeenCalled();
  });

  it("달을 옮기는 동안 직전 석 달을 흐리게 남겨 둔다(카드가 줄었다 커지지 않게)", async () => {
    render(<TimetableExitOverlay subject="math" />);
    await press("KeyX");
    await screen.findByText("10월");
    let finish: (v: unknown) => void = () => {};
    loadExitOverlay.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    await press("ArrowLeft", { key: "ArrowLeft" });
    expect(screen.getByText("10월")).toBeTruthy();
    expect(screen.queryByText("퇴원 목록을 불러오는 중…")).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
    await act(async () => finish({ ok: true, data: data("2026-09", true) }));
    expect(await screen.findByText("7월")).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("바깥을 누르면 닫히고, 카드 안을 누르면 그대로다", async () => {
    render(<TimetableExitOverlay subject="math" />);
    await press("KeyX");
    await screen.findByText("10월");
    fireEvent.pointerDown(screen.getByText("10월"));
    expect(screen.queryByRole("dialog")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("불러오기 실패는 사유를 보이고 카드는 남는다", async () => {
    loadExitOverlay.mockResolvedValueOnce({ ok: false, error: "퇴원관리를 볼 수 있는 계정만 열 수 있습니다" });
    render(<TimetableExitOverlay subject="math" />);
    await press("KeyX");
    expect((await screen.findByRole("alert")).textContent).toContain("퇴원관리를 볼 수 있는 계정만");
  });
});

describe("커서 옆 자리", () => {
  const view = { w: 1440, h: 900 };
  it("오른쪽 아래가 기본", () => {
    expect(placeNear({ x: 100, y: 100 }, { w: 600, h: 400 }, view)).toEqual({ left: 116, top: 116 });
  });
  it("오른쪽이 모자라면 커서 왼쪽, 아래가 모자라면 위로 올린다", () => {
    expect(placeNear({ x: 1200, y: 800 }, { w: 600, h: 400 }, view)).toEqual({ left: 584, top: 492 });
  });
  it("카드가 화면보다 넓으면 왼쪽 끝 8px에 붙인다", () => {
    expect(placeNear({ x: 300, y: 100 }, { w: 1430, h: 400 }, view).left).toBe(8);
  });
});
