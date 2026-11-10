// '지난 의견' 화면 — 현황 · 거르기 · 대화 열기 · 처리하면 현황 숫자(제안 → 결과 → 학습 3단계 첫 조각 · 2026-11-10).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdviceView } from "../advice";
import type { AdviceListItem } from "../advice-list";
import { AdviceStatusPanel } from "./advice-controls";
import { AdviceList } from "./advice-list";

const NONE: ReadonlySet<string> = new Set();

const view = (id: string, itemNo: number, over: Partial<AdviceView> = {}): AdviceView => ({
  id,
  itemNo,
  status: "open",
  statusAt: "2026-11-09T06:00:00.123456+00:00",
  memo: null,
  doneOn: null,
  selfRating: null,
  check: { label: "A반 결석률", unit: "percent", better: "down", windowDays: 14, baseline: { value: 18, sample: 50, from: "2026-10-24", to: "2026-11-07" }, nextCheckOn: "2026-11-25" },
  noCheck: null,
  measureState: "waiting",
  result: null,
  doneCheck: null,
  targets: null,
  askedOn: "2026-11-09",
  ...over,
});
const item = (v: AdviceView, threadId: string, title: string): AdviceListItem => ({
  view: v,
  action: `**${v.id} 의견**`,
  why: "근거 문장",
  threadId,
  threadTitle: title,
  messageId: `m-${threadId}`,
  createdAt: threadId === "t1" ? "2026-11-09T05:00:00+00:00" : "2026-11-08T05:00:00+00:00",
});

function stubFetch(items: AdviceListItem[] | { status: number; error: string }) {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ url, method, body });
      if (method === "GET") {
        if (!Array.isArray(items)) return { ok: false, status: items.status, json: async () => ({ items: [], error: items.error }) } as Response;
        return { ok: true, status: 200, json: async () => ({ items }) } as Response;
      }
      const id = decodeURIComponent(url.split("/").pop()!);
      const v = (Array.isArray(items) ? items : []).find((i) => i.view.id === id)!.view;
      return { ok: true, status: 200, json: async () => ({ advice: { ...v, status: body.status, statusAt: "2026-11-10T01:00:00.000001+00:00" } }) } as Response;
    }),
  );
  return calls;
}

beforeEach(() => {
  // 오늘 = 2026-11-10(한국) — '가장 가까운 재측정'이 실제 날짜에 따라 바뀌지 않게(fetch·waitFor는 진짜 타이머)
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T03:00:00+09:00"));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AdviceList", () => {
  it("현황 · 답별 묶음(새 답이 위) · 대화 열기", async () => {
    stubFetch([item(view("l1-a", 0), "t2", "지난주 대화"), item(view("l1-b", 0), "t1", "학생 감소 원인"), item(view("l1-c", 1, { status: "declined" }), "t1", "학생 감소 원인")]);
    const onOpen = vi.fn();
    render(<AdviceList active hiddenThreads={NONE} onOpenThread={onOpen} />);
    expect(await screen.findByText("의견 3개")).toBeInTheDocument();
    expect(screen.getByText("처리 전 2 · 채택 0 · 완료 0 · 보류 0 · 안 함 1")).toBeInTheDocument();
    expect(screen.getByText("다시 잴 날을 기다리는 의견 3 · 가장 가까운 재측정 11월 25일")).toBeInTheDocument();
    const heads = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(heads).toEqual(["11월 9일 · 학생 감소 원인", "11월 8일 · 지난주 대화"]);
    fireEvent.click(screen.getAllByRole("button", { name: /대화 열기/ })[1]!);
    expect(onOpen).toHaveBeenCalledWith("t2");
  });

  it("처리하면 현황 숫자가 바로 바뀐다 · 거르는 중에 처리해 조건을 벗어난 의견은 거르기를 바꿀 때까지 그 자리에 남는다", async () => {
    const calls = stubFetch([item(view("l2-a", 0, { status: "declined" }), "t1", "대화"), item(view("l2-b", 1), "t1", "대화")]);
    render(<AdviceList active hiddenThreads={NONE} onOpenThread={() => {}} />);
    await screen.findByText("의견 2개");
    fireEvent.click(screen.getByRole("button", { name: "끝낸 것 1" }));
    expect(screen.queryByText("l2-b 의견")).toBeNull();
    const first = screen.getByText("l2-a 의견").closest("li")!;
    fireEvent.click(within(first).getByRole("button", { name: "채택" }));
    await waitFor(() => expect(screen.getByText("처리 전 1 · 채택 1 · 완료 0 · 보류 0 · 안 함 0")).toBeInTheDocument());
    expect(calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ status: "adopted" });
    // 이제 '끝낸 것'이 아니지만 누르자마자 사라지지 않는다 — 빠진다는 표시와 함께
    expect(screen.getByText("l2-a 의견")).toBeInTheDocument();
    expect(screen.getByText("처리해서 '끝낸 것'에서 빠집니다 — 보기를 다시 고르면 사라집니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "끝낸 것 0" }));
    expect(screen.getByText("'끝낸 것'에 맞는 의견이 없습니다.")).toBeInTheDocument();
  });

  it("'지난 의견'에서 처리하면 감춰 둔 대화 카드의 같은 의견도 바로 같은 상태(같은 문서 안 공유 · 409 없음)", async () => {
    const v = view("l5-a", 0);
    const calls = stubFetch([item(v, "t1", "대화")]);
    render(
      <>
        <section aria-label="대화 카드">
          <AdviceStatusPanel initial={v} />
        </section>
        <section aria-label="모음">
          <AdviceList active hiddenThreads={NONE} onOpenThread={() => {}} />
        </section>
      </>,
    );
    await screen.findByText("의견 1개");
    fireEvent.click(within(screen.getByRole("region", { name: "모음" })).getByRole("button", { name: "채택" }));
    const card = screen.getByRole("region", { name: "대화 카드" });
    await waitFor(() => expect(within(card).getByRole("button", { name: "채택" })).toHaveAttribute("aria-pressed", "true"));
    // 대화 카드에서 이어서 누르면 새 처리 시각으로 간다(옛 시각 → 409가 아니다)
    fireEvent.click(within(card).getByRole("button", { name: "보류" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "PATCH")[1]!.body).toMatchObject({ status: "on_hold", statusAt: "2026-11-10T01:00:00.000001+00:00" });
  });

  it("판을 다시 열 때 다시 읽는다 · 닫혀 있는 동안은 읽지 않는다 · 이 판에서 지운 대화의 의견은 다시 읽기를 기다리지 않고 바로 뺀다", async () => {
    const calls = stubFetch([item(view("l6-a", 0), "t1", "대화 하나"), item(view("l6-b", 0), "t2", "대화 둘")]);
    const { rerender } = render(<AdviceList active hiddenThreads={NONE} onOpenThread={() => {}} />);
    await screen.findByText("의견 2개");
    const gets = () => calls.filter((c) => c.method === "GET").length;
    expect(gets()).toBe(1);
    rerender(<AdviceList active={false} hiddenThreads={NONE} onOpenThread={() => {}} />);
    expect(gets()).toBe(1);
    rerender(<AdviceList active hiddenThreads={NONE} onOpenThread={() => {}} />);
    await waitFor(() => expect(gets()).toBe(2));
    rerender(<AdviceList active hiddenThreads={new Set(["t1"])} onOpenThread={() => {}} />);
    expect(screen.getByText("의견 1개")).toBeInTheDocument();
    expect(screen.queryByText("l6-a 의견")).toBeNull();
    expect(screen.getByText("l6-b 의견")).toBeInTheDocument();
    expect(gets()).toBe(2);
  });

  it("읽지 못하면 한국어 까닭 + 다시 불러오기", async () => {
    stubFetch({ status: 500, error: "지난 의견을 읽지 못했습니다" });
    render(<AdviceList active hiddenThreads={NONE} onOpenThread={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("지난 의견을 읽지 못했습니다");
    expect(screen.getByRole("button", { name: /다시 불러오기/ })).toBeInTheDocument();
  });

  it("의견이 없으면 안내", async () => {
    stubFetch([]);
    render(<AdviceList active hiddenThreads={NONE} onOpenThread={() => {}} />);
    expect(await screen.findByText(/아직 비서 의견이 없습니다/)).toBeInTheDocument();
  });
});
