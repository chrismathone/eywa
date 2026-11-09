// 비서 의견 처리 단추 · 확인 지표 줄(제안 → 결과 → 학습 1단계 · 2026-11-09).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdviceView } from "../advice";
import type { SettledReport } from "../report";
import { AdviceStatusPanel } from "./advice-controls";
import { ReportView } from "./report-view";

const VIEW: AdviceView = {
  id: "11111111-1111-4111-8111-111111111111",
  itemNo: 0,
  status: "open",
  statusAt: "2026-11-09T06:00:00.123456+00:00",
  memo: null,
  doneOn: null,
  selfRating: null,
  check: { label: "A반 최근 14일 결석률", unit: "percent", better: "down", windowDays: 14, baseline: { value: 18, sample: 50, from: "2026-10-26", to: "2026-11-09" }, nextCheckOn: "2026-12-09" },
  noCheck: null,
};

type Call = { url: string; body: Record<string, unknown> };
function stubFetch(reply: (body: Record<string, unknown>) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ url, body });
      const r = reply(body);
      return { ok: r.status < 400, status: r.status, json: async () => r.json } as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// 이 화면에서 저장한 값은 부품 밖(문서)에 남는다 — 시험마다 다른 의견으로.
let seq = 0;
const fresh = (over: Partial<AdviceView> = {}): AdviceView => ({ ...VIEW, id: `11111111-1111-4111-8111-${String(++seq).padStart(12, "0")}`, ...over });

describe("비서 의견 처리", () => {
  it("확인 지표 줄 — 기준값 · 표본 · 기간 · 좋아지는 쪽(다시 잴 날은 약속하지 않는다)", () => {
    render(<AdviceStatusPanel initial={fresh()} />);
    expect(screen.getByText(/A반 최근 14일 결석률/).textContent).toBe("확인 지표 · A반 최근 14일 결석률 · 기준값 18.0% (50 중) · 10월 26일~11월 8일 · 내리면 좋음");
    expect(screen.queryByText(/다시 잽니다/)).toBeNull();
  });

  it("채택은 바로 저장 · 고른 것을 다시 누르면 처리 전으로 · 저장을 낭독으로 알린다", async () => {
    const v = fresh();
    const calls = stubFetch((b) => ({ status: 200, json: { advice: { ...v, status: b.status, statusAt: `2026-11-09T07:00:0${calls.length}.000+00:00` } } }));
    render(<AdviceStatusPanel initial={v} />);
    fireEvent.click(screen.getByRole("button", { name: "채택" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "채택" })).toHaveAttribute("aria-pressed", "true"));
    expect(calls[0]).toEqual({ url: `/api/assistant/advice/${v.id}`, body: { status: "adopted", statusAt: v.statusAt } });
    expect(screen.getByText("채택으로 저장했습니다")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "채택" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "채택" })).toHaveAttribute("aria-pressed", "false"));
    expect(calls[1]!.body).toEqual({ status: "open", statusAt: "2026-11-09T07:00:01.000+00:00" });
  });

  it("빠르게 두 번 눌러도 한 번만 보낸다", async () => {
    const v = fresh();
    const calls = stubFetch((b) => ({ status: 200, json: { advice: { ...v, status: b.status, statusAt: "2026-11-09T07:00:00.000+00:00" } } }));
    render(<AdviceStatusPanel initial={v} />);
    fireEvent.click(screen.getByRole("button", { name: "보류" }));
    fireEvent.click(screen.getByRole("button", { name: "보류" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "보류" })).toHaveAttribute("aria-pressed", "true"));
    expect(calls).toHaveLength(1);
  });

  it("다른 대화에 갔다 와도(같은 의견 다시 그림) 이 화면에서 저장한 값을 쓴다", async () => {
    const v = fresh();
    stubFetch(() => ({ status: 200, json: { advice: { ...v, status: "adopted", statusAt: "2026-11-09T07:00:00.000+00:00" } } }));
    const first = render(<AdviceStatusPanel initial={v} />);
    fireEvent.click(screen.getByRole("button", { name: "채택" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "채택" })).toHaveAttribute("aria-pressed", "true"));
    first.unmount();
    render(<AdviceStatusPanel initial={v} />);
    expect(screen.getByRole("button", { name: "채택" })).toHaveAttribute("aria-pressed", "true");
  });

  it("완료 — 한 날 · 해 본 내용 · 어땠나 를 받아 저장 · 다시 누르면 지우지 않고 고친다 · 되돌리기는 따로", async () => {
    const v = fresh();
    const calls = stubFetch((b) => ({ status: 200, json: { advice: { ...v, status: b.status, statusAt: `2026-11-09T07:00:0${calls.length}.000+00:00`, memo: b.memo ?? null, doneOn: b.doneOn ?? null, selfRating: b.selfRating ?? null } } }));
    render(<AdviceStatusPanel initial={v} />);
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    fireEvent.change(screen.getByLabelText("한 날"), { target: { value: "2026-11-08" } });
    fireEvent.change(screen.getByLabelText("해 본 내용(선택)"), { target: { value: "학부모 3명 전화" } });
    fireEvent.click(within(screen.getByRole("group", { name: "어땠나요(선택)" })).getByRole("button", { name: "좋았음" }));
    fireEvent.click(screen.getByRole("button", { name: "완료로 저장" }));
    await waitFor(() => expect(screen.getByText("완료 · 11월 8일 · 좋았음 — 학부모 3명 전화")).toBeInTheDocument());
    expect(calls[0]!.body).toEqual({ status: "done", statusAt: v.statusAt, memo: "학부모 3명 전화", doneOn: "2026-11-08", selfRating: "good" });
    // 다시 누르면 처리 전으로 지우지 않고 고치는 창(쓴 내용이 채워져 있다)
    fireEvent.click(screen.getByRole("button", { name: "완료" }));
    expect(screen.getByLabelText("해 본 내용(선택)")).toHaveValue("학부모 3명 전화");
    expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "처리 전으로" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "완료" })).toHaveAttribute("aria-pressed", "false"));
    expect(calls[1]!.body).toMatchObject({ status: "open" });
  });

  it("다른 곳에서 먼저 바꿨으면 서버 문구를 그대로 알린다", async () => {
    stubFetch(() => ({ status: 409, json: { error: "다른 곳에서 먼저 바꿨습니다. 대화를 다시 열어 확인해 주세요", code: "stale" } }));
    render(<AdviceStatusPanel initial={fresh()} />);
    fireEvent.click(screen.getByRole("button", { name: "보류" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("다른 곳에서 먼저 바꿨습니다");
    expect(screen.getByRole("button", { name: "보류" })).toHaveAttribute("aria-pressed", "false");
  });

  it("보고서 — 의견 표 줄이 있는 항목만 처리 단추 · 없으면 의견만", () => {
    const report: SettledReport = {
      title: "t",
      blocks: [
        { type: "summary", text: "s" },
        { type: "advice", items: [{ action: "A반 전화", why: "결석 18%" }, { action: "규정", why: "b" }] },
      ],
      datasets: {},
      advice: [fresh()],
    };
    render(<ReportView report={report} />);
    const items = screen.getAllByRole("listitem");
    expect(within(items[0]!).getByRole("group", { name: "처리" })).toBeInTheDocument();
    expect(within(items[1]!).queryByRole("group", { name: "처리" })).toBeNull();
  });

  it("다시 그려도 열어 둔 창이 그대로 · 받은 값이 더 새면(다른 탭) 그쪽을 보인다", async () => {
    const v = fresh();
    const { rerender } = render(<AdviceStatusPanel initial={v} />);
    fireEvent.click(screen.getByRole("button", { name: "안 함" }));
    fireEvent.change(screen.getByLabelText("안 하는 까닭(선택)"), { target: { value: "이미 했다" } });
    rerender(<AdviceStatusPanel initial={{ ...v }} />);
    expect(screen.getByLabelText("안 하는 까닭(선택)")).toHaveValue("이미 했다");
    rerender(<AdviceStatusPanel initial={{ ...v, status: "on_hold", statusAt: "2026-11-09T09:00:00.000+00:00" }} />);
    expect(screen.getByText("보류")).toBeInTheDocument();
  });

  it("잴 수 없는 의견은 까닭 한 줄", () => {
    render(<AdviceStatusPanel initial={fresh({ check: null, noCheck: "사람을 뽑는 일입니다" })} />);
    expect(screen.getByText("숫자로 다시 재기 어려운 의견입니다 — 사람을 뽑는 일입니다")).toBeInTheDocument();
  });
});
