// 비서 의견 처리 단추 · 확인 지표 줄(제안 → 결과 → 학습 1단계 · 2026-11-09).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, kstToday } from "@/lib/date-kst";
import { monthDayLabel, type AdviceView } from "../advice";
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
  check: { label: "A반 최근 14일 결석률", unit: "percent", better: "down", windowDays: 14, baseline: { value: 18, sample: 50, from: "2026-10-26", to: "2026-11-09" }, nextCheckOn: addDays(kstToday(), 30) },
  noCheck: null,
  measureState: "waiting",
  result: null,
  doneCheck: null,
  targets: null,
  askedOn: null,
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
  it("확인 지표 줄 — 기준값 · 표본 · 기간 · 좋아지는 쪽 · 다시 잴 날(재측정 기다림)", () => {
    render(<AdviceStatusPanel initial={fresh()} />);
    expect(screen.getByText(/A반 최근 14일 결석률/).textContent).toBe(
      `확인 지표 · A반 최근 14일 결석률 · 기준값 18.0% (50 중) · 10월 26일~11월 8일 · 내리면 좋음 · ${monthDayLabel(addDays(kstToday(), 30))}에 다시 잽니다`,
    );
  });

  it("다시 잴 날이 지났는데 아직 기다림이면 날짜를 약속하지 않는다", () => {
    render(<AdviceStatusPanel initial={fresh({ check: { ...VIEW.check!, nextCheckOn: "2026-01-01" } })} />);
    expect(screen.getByText(/다시 재기를 기다리는 중/)).toBeInTheDocument();
    expect(screen.queryByText(/에 다시 잽니다/)).toBeNull();
  });

  it("다시 잰 값 — 판정 칩 · 저장된 기준값 → 재측정 · 재측정 기간 · 잰 날(한국 날짜)", () => {
    const result = { verdict: "improved" as const, base: 18, baseSample: 50, value: 6.2, sample: 48, from: "2026-11-23", to: "2026-12-07", checkedAt: "2026-12-08T20:10:00+00:00", reason: null, basis: "asked" as const, anchor: "2026-11-09", threshold: 4.2 };
    render(<AdviceStatusPanel initial={fresh({ measureState: "measured", result })} />);
    expect(screen.queryByText(/다시 잽니다/)).toBeNull();
    expect(screen.getByText("개선")).toHaveClass("text-green");
    // 판정이 견준 값 = 저장된 기준값 · 무엇을 기준으로 쟀나 · 잰 날은 한국 날짜(05:10 KST = 전날 20:10 UTC)
    expect(screen.getByText("개선").nextElementSibling?.textContent).toBe("기준값 18.0% → 재측정 6.2% · 11월 23일~12월 6일 · 의견을 낸 뒤 · 12월 9일에 잼");
    expect(screen.getByText(/이 의견 때문이라고 단정하지 않습니다/)).toBeInTheDocument();
  });

  it("완료로 다시 잡은 결과는 '완료(날짜) 뒤'", () => {
    const result = { verdict: "flat" as const, base: 18, baseSample: 50, value: 17, sample: 48, from: "2026-11-20", to: "2026-12-04", checkedAt: "2026-12-06T00:00:00+00:00", reason: null, basis: "done" as const, anchor: "2026-11-20", threshold: 4.24 };
    const { unmount } = render(<AdviceStatusPanel initial={fresh({ status: "done", doneOn: "2026-11-20", measureState: "measured", result })} />);
    // '변화 없음'이 아니라 '뚜렷한 차이 없음' + 오차 범위
    expect(screen.getByText("뚜렷한 차이 없음")).toHaveClass("text-text-dim");
    expect(screen.getByText("뚜렷한 차이 없음").nextElementSibling?.textContent).toBe("기준값 18.0% → 재측정 17.0% (차이가 ±4.2%p 안) · 11월 20일~12월 3일 · 완료(11월 20일) 뒤 · 12월 6일에 잼");
    unmount();
    // 완료를 거둔 뒤에는 '완료 뒤'라고 하지 않는다
    render(<AdviceStatusPanel initial={fresh({ status: "open", measureState: "measured", result })} />);
    expect(screen.getByText(/11월 20일부터/)).toBeInTheDocument();
    expect(screen.queryByText(/완료\(11월 20일\) 뒤/)).toBeNull();
  });

  it("판정 보류는 까닭을 · 여러 번 못 잰 지표는 그렇다고", () => {
    const result = { verdict: "unknown" as const, base: 50, baseSample: 4, value: 75, sample: 4, from: "2026-11-23", to: "2026-12-07", checkedAt: "2026-12-09T00:00:00+00:00", reason: "표본이 적어(8 미만) 판정하지 않습니다", basis: "asked" as const, anchor: "2026-11-09", threshold: null };
    const { unmount } = render(<AdviceStatusPanel initial={fresh({ measureState: "measured", result })} />);
    expect(screen.getByText("판정 보류")).toBeInTheDocument();
    expect(screen.getByText(/표본이 적어/)).toBeInTheDocument();
    unmount();
    render(<AdviceStatusPanel initial={fresh({ measureState: "broken" })} />);
    expect(screen.getByText("다시 잰 값 — 여러 번 다시 재지 못해 판정하지 않습니다")).toBeInTheDocument();
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
