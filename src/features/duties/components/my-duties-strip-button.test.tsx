import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MyDutiesStripButton } from "./my-duties-strip-button";
import type { DutyPayload, DutyStripSummary } from "./my-duties-types";
import type { DutyItemView } from "../kinds";

const ping = vi.hoisted(() => ({ fire: () => {} }));
vi.mock("./use-duty-ping", () => ({ useDutyPing: (_tenant: unknown, callback: () => void) => { ping.fire = callback; } }));
vi.mock("@/components/icons/aywa-icons", () => ({ EyIcon: () => null }));
vi.mock("@/components/embed-link", () => ({ EmbedAnchor: ({ children }: { children: ReactNode }) => <a>{children}</a> }));
vi.mock("@/components/workspace/embed-context", () => ({ withEmbed: () => "about:blank" }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, onOpenChange }: { children: ReactNode; onOpenChange: (v: boolean) => void }) => <div role="dialog">{children}<button onClick={() => onOpenChange(false)}>닫기</button></div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

const DAY = "2026-11-13";
const count = { total: 1, done: 0, late: 1 };
const summary: DutyStripSummary = { date: DAY, month: "2026-11", today: count, week: count, counsel: count, exam: count, newcomer: { total: 0, done: 0, late: 0 }, byKind: [], lang: "ko" };
function item(overrides: Partial<DutyItemView> = {}): DutyItemView {
  return { id: "attendance", kind: "attendance", period: "daily", cycle: DAY, status: "open", dueAt: `${DAY}T08:00:00Z`, doneAt: null, voidReason: null, studentId: "student", studentName: "김학생", school: "침산초", grade: "초6", classId: "class", className: "수학 A", subject: "math", escalation: 0, ...overrides };
}
function payload(overrides: Partial<DutyPayload> = {}): DutyPayload {
  return { date: DAY, days: [DAY], items: [item()], week: [], month: [item({ id: "counsel", kind: "counsel_monthly", period: "monthly", cycle: "2026-11", dueAt: "2026-11-30T14:59:59Z" }), item({ id: "exam", kind: "exam_monthly", period: "monthly", cycle: "2026-11", dueAt: "2026-11-30T14:59:59Z" })], ...overrides };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const response = (data: unknown) => ({ ok: true, json: async () => data }) as Response;
async function flush() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
let getMine: (url: string) => Promise<Response>;
let getSummary: () => Promise<Response>;
let request: ReturnType<typeof vi.fn>;
const open = async () => { fireEvent.click(screen.getByRole("button", { name: /^내 업무/ })); await flush(); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${DAY}T09:00:00Z`));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  getMine = async () => response(payload());
  getSummary = async () => response(summary);
  request = vi.fn((url: string) => url.startsWith("/api/duties/mine") ? getMine(url) : getSummary());
  vi.stubGlobal("fetch", request);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("내 업무 — 화면을 유지하는 실시간 갱신", () => {
  it("신호를 받아도 목록·접은 반·스크롤을 유지하며 새 완료 상태만 반영한다", async () => {
    const { container } = render(<MyDutiesStripButton summary={summary} tenantId="tenant" />);
    await open();
    const scroller = container.querySelector(".overflow-y-auto")!;
    scroller.scrollTop = 240;
    fireEvent.click(screen.getByText("수학 A"));
    expect(screen.queryByText("김학생")).not.toBeInTheDocument();
    const pending = deferred<Response>();
    getMine = () => pending.promise;
    act(() => ping.fire());
    await flush();
    expect(screen.queryByText("불러오는 중…")).not.toBeInTheDocument();
    expect(container.querySelector(".overflow-y-auto")).toBe(scroller);
    pending.resolve(response(payload({ items: [item({ status: "done" })] })));
    await flush();
    expect(screen.queryByText("김학생")).not.toBeInTheDocument();
    expect(scroller.scrollTop).toBe(240);
    fireEvent.click(screen.getByText("수학 A"));
    expect(screen.getByText("김학생")).toBeInTheDocument();
    expect(screen.getByTitle("출결 · 완료")).toBeInTheDocument();
  });

  it("60초 정기 갱신과 창 다시 열기에서도 기존 목록을 먼저 보여 준다", async () => {
    render(<MyDutiesStripButton summary={summary} />);
    await open();
    const pending = deferred<Response>();
    getMine = () => pending.promise;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(screen.getByText("김학생")).toBeInTheDocument();
    expect(screen.queryByText("불러오는 중…")).not.toBeInTheDocument();
    pending.resolve(response(payload()));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    getMine = () => new Promise(() => {});
    await open();
    expect(screen.getByText("김학생")).toBeInTheDocument();
  });

  it("월말평가 탭은 신호와 업무 화면 왕복에도 유지된다", async () => {
    render(<MyDutiesStripButton summary={summary} />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "이번 달" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /11월 월말평가/ }));
    expect(screen.getByText("월말평가 응시")).toBeVisible();
    act(() => ping.fire());
    await flush();
    expect(screen.getByText("월말평가 응시")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /김학생/ }));
    expect(screen.getByTitle("김학생 · 월말평가 응시")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "‹ 목록" }));
    await flush();
    expect(screen.getByText("월말평가 응시")).toBeVisible();
    expect(screen.queryByText("불러오는 중…")).not.toBeInTheDocument();
  });

  it("백그라운드 조회 실패는 기존 목록을 지우지 않고 재시도 성공 때 안내가 사라진다", async () => {
    render(<MyDutiesStripButton summary={summary} />);
    await open();
    getMine = async () => { throw Error("offline"); };
    act(() => ping.fire());
    await flush();
    expect(screen.getByText("김학생")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("마지막으로 확인한 내용");
    getMine = async () => response(payload());
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("김학생")).toBeInTheDocument();
  });

  it("최초 조회 실패도 창을 닫지 않고 복구할 수 있다", async () => {
    getMine = async () => { throw Error("offline"); };
    render(<MyDutiesStripButton summary={summary} />);
    await open();
    expect(screen.getByRole("status")).toHaveTextContent("업무를 불러오지 못했습니다");
    getMine = async () => response(payload());
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await flush();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("김학생")).toBeInTheDocument();
  });

  it("숫자 조회가 실패해도 열려 있는 목록은 새 상태를 받는다", async () => {
    render(<MyDutiesStripButton summary={summary} />);
    await open();
    getSummary = async () => { throw Error("summary offline"); };
    getMine = async () => response(payload({ items: [item({ status: "done" })] }));
    act(() => ping.fire());
    await flush();
    expect(screen.getByTitle("출결 · 완료")).toBeInTheDocument();
    expect(screen.queryByText("불러오는 중…")).not.toBeInTheDocument();
  });

  it("조회 중 신호가 몰려도 동시 조회를 늘리지 않고 끝에 최신 값을 한 번 더 받는다", async () => {
    render(<MyDutiesStripButton summary={summary} />);
    await open();
    const pending = deferred<Response>();
    let active = 0, peak = 0, calls = 0;
    getMine = async () => {
      active++; peak = Math.max(peak, active); calls++;
      const result = calls === 1 ? await pending.promise : response(payload({ items: [item({ status: "done" })] }));
      active--; return result;
    };
    act(() => { ping.fire(); ping.fire(); ping.fire(); });
    await flush();
    expect(calls).toBe(1);
    pending.resolve(response(payload()));
    await flush();
    expect(peak).toBe(1);
    expect(calls).toBe(2);
    expect(screen.getByTitle("출결 · 완료")).toBeInTheDocument();
  });

  it("자정 이후 늦게 도착한 전날 응답이 새 날짜의 목록을 덮지 않는다", async () => {
    render(<MyDutiesStripButton summary={summary} />);
    await open();
    const old = deferred<Response>();
    const tomorrow = "2026-11-14";
    getMine = async (url) => url.endsWith(tomorrow) ? response(payload({ date: tomorrow, days: [tomorrow], items: [item({ cycle: tomorrow, studentName: "새날 학생" })] })) : old.promise;
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    await open(); // 전날 목록을 읽는 도중 자정이 지난 숫자가 도착한다.
    getSummary = async () => response({ ...summary, date: tomorrow });
    act(() => ping.fire());
    await flush();
    old.resolve(response(payload({ items: [item({ studentName: "어제 응답" })] })));
    await flush();
    expect(screen.queryByText("어제 응답")).not.toBeInTheDocument();
    expect(screen.getByText("새날 학생")).toBeInTheDocument();
    expect(request.mock.calls.some(([url]) => url === `/api/duties/mine?date=${tomorrow}`)).toBe(true);
  });

  it("숨은 탭에서는 쉬고 돌아오면 갱신하며, 언마운트하면 진행 중 요청을 취소한다", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const { unmount } = render(<MyDutiesStripButton summary={summary} />);
    await open();
    const before = request.mock.calls.length;
    visibility.mockReturnValue("hidden");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); ping.fire(); });
    expect(request.mock.calls).toHaveLength(before);
    getMine = () => new Promise(() => {});
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flush();
    expect(request.mock.calls.length).toBeGreaterThan(before);
    const options = request.mock.calls.at(-1)?.[1] as RequestInit | undefined;
    unmount();
    expect(options?.signal?.aborted).toBe(true);
    const stopped = request.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(request.mock.calls).toHaveLength(stopped);
  });
});
