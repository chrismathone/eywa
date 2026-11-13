import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_SUGGESTIONS, type AskEvent, type ThreadDetailResponse, type ThreadListResponse } from "@/features/assistant/protocol";
import { kstToday } from "@/lib/date-kst";
import type { SettledReport } from "@/features/assistant/report";
import { AssistantLauncher } from "./assistant-launcher";
import { ASSISTANT_OPEN_EVENT, ASSISTANT_NAVIGATE_EVENT, ASSISTANT_TOGGLE_MESSAGE } from "./assistant-hotkey";

vi.mock("./report-chart", () => ({ ReportChart: () => <div data-testid="chart" /> }));

const NOW = "2026-11-06T05:00:00.000Z";
const report: SettledReport = {
  title: "반별 미납 보고서",
  blocks: [
    { type: "summary", text: "미납이 늘었습니다." },
    { type: "advice", items: [{ action: "3반에 연락하세요", why: "미납 12건" }] },
  ],
  datasets: {},
};

/** NDJSON 흐름 — 줄을 조각 경계와 상관없이 쪼개 보낸다(실제 네트워크처럼). `close=false`면 끝 이벤트 없이 끊긴다. */
function ndjson(events: AskEvent[], { cutMidLine = true } = {}) {
  const text = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const bytes = new TextEncoder().encode(text);
  const mid = cutMidLine ? Math.floor(bytes.length / 2) : bytes.length;
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes.slice(0, mid));
      if (mid < bytes.length) c.enqueue(bytes.slice(mid));
      c.close();
    },
  });
}

type Handler = (url: string, init?: RequestInit) => unknown;
let routes: Record<string, Handler>;
const calls: { url: string; method: string; body?: unknown }[] = [];

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, body: null, json: async () => body });

beforeEach(() => {
  calls.length = 0;
  routes = {
    "GET /api/assistant/threads": () => json({ enabled: true, threads: [] } satisfies ThreadListResponse),
    "GET /api/assistant/suggestions*": () => json({ scope: "s1", day: kstToday(), items: ASSISTANT_SUGGESTIONS.map((text) => ({ text })) }),
  };
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const key = `${method} ${url}`;
      const h = routes[key] ?? Object.entries(routes).find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
      if (!h) throw new Error(`no route ${key}`);
      return h(url, init);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 판이 뜨기를 기다린다 — 첫 렌더(포털·판 전체)는 테스트 DOM에서 1초를 넘기기도 한다. */
const findDialog = () => screen.findByRole("dialog", {}, { timeout: 5000 });

const press = (init: KeyboardEventInit) => act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })));

describe("AssistantLauncher", () => {
  it("버튼으로 열면 지난 대화를 읽고 추천 질문을 보인다", async () => {
    render(<AssistantLauncher />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    expect(within(dialog).getByRole("heading", { name: "학원 비서" })).toBeInTheDocument();
    expect(within(dialog).getByText("무엇이 궁금하세요?")).toBeInTheDocument();
    expect(await within(dialog).findByRole("button", { name: /미납 현황을 반별로 정리해 줘/ })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url === "/api/assistant/threads")).toBe(true));
    expect(within(dialog).queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("추론 강도")).not.toBeInTheDocument();
  });

  it("상세 링크 이동은 판만 닫고 다시 열면 쓰던 질문이 남는다", async () => {
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "질문" }), { target: { value: "이어서 물을 질문" } });
    act(() => window.dispatchEvent(new Event(ASSISTANT_NAVIGATE_EVENT)));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    expect(within(await findDialog()).getByRole("textbox", { name: "질문" })).toHaveValue("이어서 물을 질문");
  });

  it("추천 질문 — 추세 질문·근거 · 직전 묶음에 없던 주제만 NEW(숫자만 바뀐 질문은 아님) · 같은 날 다시 열면 서버에 묻지 않는다 · 새로 고침", async () => {
    const day = kstToday();
    const unpaid = { text: "미납 10건(합계 95만 원) — 반별·청구 달별로 정리하고 오래된 것부터 알려 줘", reason: "2달 넘은 미납 2건", key: "unpaid" };
    let items: { text: string; reason?: string; key?: string }[] = [unpaid, { text: "과목·학년별 재원생 구성", key: "static:과목·학년별 재원생 구성" }];
    routes["GET /api/assistant/suggestions*"] = (url) =>
      url.includes(`have=s1.${day}`) ? json({ scope: "s1", day }) : json({ scope: "s1", day, items });
    const asked = () => calls.filter((c) => c.url.startsWith("/api/assistant/suggestions")).length;

    const first = render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    let dialog = await findDialog();
    const smart = await within(dialog).findByRole("button", { name: /미납 10건/ });
    expect(smart).toHaveTextContent("2달 넘은 미납 2건");
    expect(smart).toHaveTextContent("NEW");
    expect(within(dialog).getByRole("button", { name: /과목·학년별 재원생 구성/ })).not.toHaveTextContent("NEW");
    expect(asked()).toBe(1);
    first.unmount();

    // 같은 날 다시 열기 — 이 페이지에서 확인한 묶음을 바로 쓰고(묻지 않는다) NEW는 그대로 남는다.
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    dialog = await findDialog();
    expect(await within(dialog).findByRole("button", { name: /미납 10건/ })).toHaveTextContent("NEW");
    expect(asked()).toBe(1);

    // 새로 고침 — 다시 세고, 새 주제에만 NEW(미납은 숫자만 바뀌었으니 NEW 아님).
    items = [
      { text: "'중2 A반' 출석률이 93%에서 74%로 떨어졌어 — 원인을 분석해 줘", key: "classDrop:중2 A반" },
      { text: "미납 11건(합계 99만 원) — 반별·청구 달별로 정리하고 오래된 것부터 알려 줘", key: "unpaid" },
    ];
    fireEvent.click(within(dialog).getByRole("button", { name: /새로 고침/ }));
    expect(await within(dialog).findByRole("button", { name: /중2 A반/ })).toHaveTextContent("NEW");
    expect(within(dialog).getByRole("button", { name: /미납 11건/ })).not.toHaveTextContent("NEW");
    expect(calls.some((c) => c.url === "/api/assistant/suggestions?refresh=1")).toBe(true);
    expect(within(dialog).getByRole("button", { name: /새로 고침|세는 중/ })).toBeDisabled();
  });

  it("Ctrl+J로 열고 닫는다(한글 입력 상태 포함) · 창(iframe)에서 온 신호 · 다른 버튼의 열기 신호", async () => {
    render(<AssistantLauncher trigger={false} />);
    press({ key: "ㅓ", code: "KeyJ", ctrlKey: true });
    expect(await findDialog()).toBeInTheDocument();
    press({ key: "j", code: "KeyJ", ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    act(() => void window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data: { type: ASSISTANT_TOGGLE_MESSAGE } })));
    expect(await findDialog()).toBeInTheDocument();
    press({ key: "j", code: "KeyJ", metaKey: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // 다른 출처의 메시지는 무시
    act(() => void window.dispatchEvent(new MessageEvent("message", { origin: "https://evil.example", data: { type: ASSISTANT_TOGGLE_MESSAGE } })));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => void window.dispatchEvent(new Event(ASSISTANT_OPEN_EVENT)));
    expect(await findDialog()).toBeInTheDocument();
  });

  it("묻기 — 단계가 실시간으로 쌓이고 보고서로 바뀐다 · 새 대화가 목록에 선다 · 닫았다 열어도 그대로", async () => {
    routes["POST /api/assistant/ask"] = () => ({
      ok: true,
      status: 200,
      body: ndjson([
        { type: "thread", threadId: "T1", title: "반별 미납" },
        { type: "step", step: { id: "s1", kind: "understand", label: "질문을 이해하는 중", state: "running", at: 0 } },
        { type: "step", step: { id: "s1", kind: "understand", label: "질문을 이해하는 중", state: "done", at: 0, ms: 800 } },
        { type: "step", step: { id: "s2", kind: "query", label: "조회 1 · 반별 미납액", state: "done", at: 900, ms: 300, detail: "12행 · 0.3초", tables: [{ name: "invoices", label: "청구서" }] } },
        { type: "report", messageId: "M1", report },
      ]),
      json: async () => ({}),
    });
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    const input = within(dialog).getByRole("textbox", { name: "질문" });
    fireEvent.change(input, { target: { value: "미납 현황을 반별로" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await within(dialog).findByRole("heading", { name: "반별 미납 보고서" })).toBeInTheDocument();
    const ask = calls.find((c) => c.method === "POST");
    expect(ask?.body).toEqual({ threadId: null, question: "미납 현황을 반별로", clientRef: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(input).toHaveValue("");
    // 과정은 한 줄로 접혀서 남는다 — "조회 1번 · 표 1개 · 1.2초 — 과정 보기"
    expect(within(dialog).getByText("조회 1번 · 표 1개 · 1.2초")).toBeInTheDocument();
    expect(within(dialog).getByText("과정 보기")).toBeInTheDocument();
    expect(within(dialog).getByText("청구서")).toBeInTheDocument();
    // 새 대화가 목록·대화 머리에
    expect(within(dialog).getAllByText("반별 미납").length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByRole("heading", { name: "비서 의견" })).toBeInTheDocument();

    // 닫았다 열어도 대화가 남는다(다시 읽는 것은 목록뿐)
    fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const again = await findDialog();
    expect(within(again).getByRole("heading", { name: "반별 미납 보고서" })).toBeInTheDocument();
  });

  it("완료된 답에도 강도 상향 안내를 만들지 않고 질문 요청에 강도를 보내지 않는다", async () => {
    let n = 0;
    routes["POST /api/assistant/ask"] = () => {
      n += 1;
      return {
        ok: true,
        status: 200,
        body: ndjson([
          ...(n === 1 ? [{ type: "thread", threadId: "T1", title: "반별 미납" } as AskEvent] : []),
          { type: "report", messageId: `M${n}`, report: { ...report, title: "완료된 답" } },
        ]),
        json: async () => ({}),
      };
    };
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    const input = within(dialog).getByRole("textbox", { name: "질문" });
    fireEvent.change(input, { target: { value: "미납 몇 건" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await within(dialog).findByRole("heading", { name: "완료된 답" }, { timeout: 15_000 })).toBeInTheDocument();
    const ASK = "마음에 들지 않으면 추론 강도를 올려서 다시 물어보시겠습니까?";
    expect(within(dialog).queryByText(ASK)).toBeNull();
    expect(within(dialog).queryByRole("radio")).toBeNull();
    const sent = calls.filter((c) => c.method === "POST");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({ question: "미납 몇 건" });
    expect(sent[0]?.body).not.toHaveProperty("level");
  });

  it("답을 만드는 동안 — 단계 타임라인(같은 id는 덮어쓴다 · 표 칩) · 멈추기", async () => {
    let push: (e: AskEvent) => void = () => {};
    routes["POST /api/assistant/ask"] = (_url, init) => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          push = (e) => c.enqueue(enc.encode(`${JSON.stringify(e)}
`));
          init?.signal?.addEventListener("abort", () => c.error(new DOMException("멈춤", "AbortError")));
        },
      });
      return { ok: true, status: 200, body, json: async () => ({}) };
    };
    routes["POST /api/assistant/messages/*"] = () => json({ ok: true });
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    fireEvent.click(await within(dialog).findByRole("button", { name: /미납 현황을 반별로 정리해 줘/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    await act(async () => {
      push({ type: "started", messageId: "M5" });
      push({ type: "thread", threadId: "T5", title: "미납" });
      push({ type: "step", step: { id: "s1", kind: "understand", label: "질문을 이해하는 중", state: "running", at: 0 } });
    });
    // 단계가 하나뿐이면 큰 글씨 한 줄 — 같은 문장의 줄이 없다(적대 리뷰 2026-11-09)
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("질문을 이해하는 중"));
    expect(within(dialog).getAllByText("질문을 이해하는 중")).toHaveLength(1);
    expect(within(dialog).queryByRole("list", { name: "답을 만드는 단계" })).toBeNull();
    await act(async () => {
      push({ type: "step", step: { id: "s1", kind: "understand", label: "질문을 이해하는 중", state: "done", at: 0, ms: 700 } });
    });
    // 끝난 뒤 다음 단계가 열리기 전 — 줄을 띄우지 않는다(경계마다 카드가 늘었다 줄었다 하지 않게)
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("다음 단계를 준비하는 중"));
    expect(within(dialog).queryByRole("list", { name: "답을 만드는 단계" })).toBeNull();
    await act(async () => {
      push({ type: "step", step: { id: "s2", kind: "write_sql", label: "조회문을 쓰는 중", state: "running", at: 800 } });
      push({ type: "step", step: { id: "s2", kind: "write_sql", label: "조회문을 쓰는 중 · 반별 미납액", state: "running", at: 800, tables: [{ name: "invoices", label: "청구서" }] } });
    });
    // 기본은 접힘 — 지금 단계는 큰 글씨 한 줄로만(같은 문장을 아래에 또 그리지 않는다 · 원장 2026-11-09) + 그 단계의 표 칩 · 펼치면 지난 단계까지
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("조회문을 쓰는 중 · 반별 미납액"));
    expect(within(dialog).queryByRole("list", { name: "답을 만드는 단계" })).toBeNull();
    expect(within(dialog).getAllByText("조회문을 쓰는 중 · 반별 미납액")).toHaveLength(1);
    expect(within(dialog).getByText("청구서")).toHaveAttribute("data-tip", expect.stringContaining("invoices"));
    const more = within(dialog).getByRole("button", { name: /지난 단계 1개 펼치기/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    const steps = await within(dialog).findByRole("list", { name: "답을 만드는 단계" });
    await waitFor(() => expect(within(steps).getAllByRole("listitem")).toHaveLength(2));
    const less = within(dialog).getByRole("button", { name: /과정 접기/ });
    expect(less).toHaveAttribute("aria-expanded", "true");
    expect(less).toBe(more); // 펼쳐도 같은 버튼 — 초점이 남는다
    expect(within(steps).getByText("조회문을 쓰는 중 · 반별 미납액")).toBeInTheDocument();
    expect(within(steps).getByText("청구서")).toHaveAttribute("data-tip", expect.stringContaining("invoices"));
    expect(within(steps).getByLabelText("진행 중")).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("조회문을 쓰는 중 · 반별 미납액");
    // 다시 접고, 마지막 단계가 막히면 — 접혀 있어도 그 줄(까닭)을 보인다 · 펼치기 수는 숨은 단계 수
    fireEvent.click(less);
    await act(async () => {
      push({ type: "step", step: { id: "s2", kind: "write_sql", label: "조회문을 쓰는 중 · 반별 미납액", state: "done", at: 800, ms: 900 } });
    });
    // 단계 사이(마지막 단계가 끝나고 다음이 열리기 전) — 줄 없이, 펼치기 수는 숨은 단계 전부(둘)
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent("다음 단계를 준비하는 중"));
    expect(within(dialog).queryByRole("list", { name: "답을 만드는 단계" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: /지난 단계 2개 펼치기/ })).toBe(more);
    await act(async () => {
      push({ type: "step", step: { id: "s3", kind: "query", label: "조회 1 · 반별 미납액", state: "error", at: 1800, detail: "칸 이름이 틀렸습니다" } });
    });
    const blocked = await within(dialog).findByRole("list", { name: "답을 만드는 단계" });
    expect(within(blocked).getAllByRole("listitem")).toHaveLength(1);
    expect(within(blocked).getByText(/칸 이름이 틀렸습니다/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /지난 단계 2개 펼치기/ })).toBe(more);
    // 답을 받는 동안 보내기 대신 멈추기
    fireEvent.click(within(dialog).getByRole("button", { name: "멈추기" }));
    // 같은 문장이 화면 낭독기 알림 줄(sr-only)에도 선다.
    expect((await within(dialog).findAllByText("답을 멈췄습니다.")).length).toBeGreaterThanOrEqual(1);
    expect(within(dialog).getByRole("button", { name: "다시 묻기" })).toBeEnabled();
    // 서버에도 알렸다(연결만 끊으면 서버는 끝까지 돈다).
    expect(calls.some((x) => x.method === "POST" && x.url === "/api/assistant/messages/M5/stop")).toBe(true);
  });

  it("질문 번호(started)를 받기 전에 누른 멈추기는 기다렸다가 번호를 받자마자 서버에 알리고 끊는다", async () => {
    let push: (e: AskEvent) => void = () => {};
    let aborted = false;
    routes["POST /api/assistant/ask"] = (_url, init) => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          push = (e) => c.enqueue(enc.encode(`${JSON.stringify(e)}
`));
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            c.error(new DOMException("멈춤", "AbortError"));
          });
        },
      });
      return { ok: true, status: 200, body, json: async () => ({}) };
    };
    routes["POST /api/assistant/messages/*"] = () => json({ ok: true });
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    fireEvent.click(await within(dialog).findByRole("button", { name: /미납 현황을 반별로 정리해 줘/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    fireEvent.click(await within(dialog).findByRole("button", { name: "멈추기" }));
    // 아직 번호가 없다 — 끊지 않고 '멈추는 중'으로 기다린다.
    expect(await within(dialog).findByRole("button", { name: "멈추는 중…" })).toBeDisabled();
    expect(aborted).toBe(false);
    expect(calls.some((x) => x.url.startsWith("/api/assistant/messages/"))).toBe(false);
    await act(async () => {
      push({ type: "started", messageId: "M6" });
    });
    await waitFor(() => expect(calls.some((x) => x.method === "POST" && x.url === "/api/assistant/messages/M6/stop")).toBe(true));
    expect(aborted).toBe(true);
    expect((await within(dialog).findAllByText("답을 멈췄습니다.")).length).toBeGreaterThanOrEqual(1);
  });

  it("번호로 보낸 멈춤이 실패하면(세션 만료 등) 화면이 만든 번호(clientRef)로 한 번 더 보내고, 알림이 끝난 뒤 끊는다", async () => {
    let push: (e: AskEvent) => void = () => {};
    let aborted = false;
    routes["POST /api/assistant/ask"] = (_url, init) => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          push = (e) => c.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            c.error(new DOMException("멈춤", "AbortError"));
          });
        },
      });
      return { ok: true, status: 200, body, json: async () => ({}) };
    };
    routes["POST /api/assistant/messages/M7/stop"] = () => json({ error: "로그인이 필요합니다" }, 401);
    routes["POST /api/assistant/messages/*"] = () => json({ ok: true });
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    fireEvent.click(await within(dialog).findByRole("button", { name: /미납 현황을 반별로 정리해 줘/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    await act(async () => {
      push({ type: "started", messageId: "M7" });
    });
    fireEvent.click(await within(dialog).findByRole("button", { name: "멈추기" }));
    const ref = (calls.find((c) => c.url === "/api/assistant/ask")!.body as { clientRef: string }).clientRef;
    await waitFor(() => expect(calls.some((x) => x.url === `/api/assistant/messages/${ref}/stop?by=ref`)).toBe(true));
    const order = calls.filter((x) => x.url.startsWith("/api/assistant/messages/")).map((x) => x.url);
    expect(order).toEqual(["/api/assistant/messages/M7/stop", `/api/assistant/messages/${ref}/stop?by=ref`]);
    await waitFor(() => expect(aborted).toBe(true));
    expect((await within(dialog).findAllByText("답을 멈췄습니다.")).length).toBeGreaterThanOrEqual(1);
  });

  it("저장본이 아직 도는 중이면 '도는지'만 가볍게 묻고(?status=1), 끝나면 대화 전체를 한 번 읽는다", async () => {
    routes["POST /api/assistant/ask"] = () => ({
      ok: true,
      status: 200,
      body: ndjson([
        { type: "started", messageId: "M8" },
        { type: "thread", threadId: "T8", title: "도는 질문" },
      ]),
      json: async () => ({}),
    });
    let full = 0;
    routes["GET /api/assistant/threads/T8"] = () => {
      full += 1;
      return json({
        thread: { id: "T8", title: "도는 질문", level: "normal", updatedAt: NOW },
        messages: [{ id: "M8", question: "q", level: "normal", createdAt: NOW, report: full > 1 ? report : null, error: null, running: full === 1, queries: [], steps: [] }],
      } satisfies ThreadDetailResponse);
    };
    routes["GET /api/assistant/threads/T8?status=1"] = () => json({ running: false });
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "질문" }), { target: { value: "q" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));
    // 끊김 → 전체 한 번(아직 도는 중) → 3초 뒤 '도는지'만 → 끝났으니 전체 한 번 더 → 보고서
    expect(await within(dialog).findByRole("heading", { name: "반별 미납 보고서" }, { timeout: 6000 })).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "/api/assistant/threads/T8?status=1").length).toBeGreaterThanOrEqual(1);
    expect(full).toBe(2);
  }, 10_000);

  it("Enter는 한글 조합 중엔 보내지 않는다 · Shift+Enter는 줄바꿈", async () => {
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const input = within(await findDialog()).getByRole("textbox", { name: "질문" });
    fireEvent.change(input, { target: { value: "미납" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("흐름이 끝 이벤트 없이 끊기면 저장본을 다시 읽는다", async () => {
    routes["POST /api/assistant/ask"] = () => ({
      ok: true,
      status: 200,
      body: ndjson([
        { type: "thread", threadId: "T9", title: "끊긴 질문" },
        { type: "step", step: { id: "s1", kind: "understand", label: "질문을 이해하는 중", state: "running", at: 0 } },
      ]),
      json: async () => ({}),
    });
    routes["GET /api/assistant/threads/T9"] = () =>
      json({
        thread: { id: "T9", title: "끊긴 질문", level: "normal", updatedAt: NOW },
        messages: [{ id: "M9", question: "q", level: "normal", createdAt: NOW, report, error: null, running: false, queries: [], steps: [] }],
      } satisfies ThreadDetailResponse);
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    const input = within(dialog).getByRole("textbox", { name: "질문" });
    fireEvent.change(input, { target: { value: "q" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));
    expect(await within(dialog).findByRole("heading", { name: "반별 미납 보고서" })).toBeInTheDocument();
    expect(calls.some((c) => c.url === "/api/assistant/threads/T9")).toBe(true);
  });

  it("오류 이벤트 — 한국어 문구 + 다시 묻기", async () => {
    let n = 0;
    routes["POST /api/assistant/ask"] = () => {
      n += 1;
      return n === 1
        ? { ok: true, status: 200, body: ndjson([{ type: "error", message: "오늘 쓸 수 있는 횟수를 다 썼습니다." }], { cutMidLine: false }), json: async () => ({}) }
        : json({ error: "잠시 뒤 다시 물어봐 주세요." }, 429);
    };
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    fireEvent.click(await within(dialog).findByRole("button", { name: /미납 현황을 반별로 정리해 줘/ }));
    expect(await within(dialog).findByText("오늘 쓸 수 있는 횟수를 다 썼습니다.")).toBeInTheDocument();
    // 흐름이 다 닫혀야(ask/end) '다시 묻기'가 풀린다 — 그 전에 누르면 아무 일도 없다.
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "다시 묻기" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "다시 묻기" }));
    expect(await within(dialog).findByText("잠시 뒤 다시 물어봐 주세요.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST").map((c) => (c.body as { question: string }).question)).toEqual([
      "미납 현황을 반별로 정리해 줘",
      "미납 현황을 반별로 정리해 줘",
    ]);
  });

  it("비서를 쓸 수 없는 지점 — 안내하고 보내기를 막는다", async () => {
    routes["GET /api/assistant/threads"] = () => json({ enabled: false, threads: [] });
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    expect(await within(dialog).findByText("학원 비서를 쓸 수 없습니다")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "질문" }), { target: { value: "q" } });
    expect(within(dialog).getByRole("button", { name: "보내기" })).toBeDisabled();
  });

  it("지난 대화를 열고 지운다 — 목록 행의 x(원장 2026-11-06) · 확인 단계 · Esc는 확인만 닫는다", async () => {
    routes["GET /api/assistant/threads"] = () => json({ enabled: true, threads: [{ id: "T1", title: "지난 질문", level: "high", updatedAt: NOW }] });
    routes["GET /api/assistant/threads/T1"] = () =>
      json({
        thread: { id: "T1", title: "지난 질문", level: "high", updatedAt: NOW },
        messages: [{ id: "M1", question: "지난 질문 본문", level: "high", createdAt: NOW, report, error: null, running: false, queries: [], steps: [] }],
      });
    routes["DELETE /api/assistant/threads/T1"] = () => json({ ok: true });
    // 넓은 화면 — 목록이 펼친 채로 열린다.
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    fireEvent.click(await within(dialog).findByRole("button", { name: /^지난 질문/ }));
    expect(await within(dialog).findByText("지난 질문 본문")).toBeInTheDocument();
    expect(within(dialog).queryByText(/추론 강함/)).not.toBeInTheDocument();
    // 대화 머리에는 지우기가 없다(목록으로 옮김)
    expect(within(dialog).queryByRole("button", { name: "대화 지우기" })).toBeNull();
    // x → 확인(초점은 '취소') → Esc는 확인만 닫고 판은 그대로 · 초점은 다시 x로
    const x = within(dialog).getByRole("button", { name: "'지난 질문' 대화 지우기" });
    fireEvent.click(x);
    const confirm = within(dialog).getByRole("group", { name: "'지난 질문' 대화 지우기 확인" });
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "취소" })).toHaveFocus());
    fireEvent.keyDown(within(confirm).getByRole("button", { name: "취소" }), { key: "Escape" });
    await waitFor(() => expect(within(dialog).queryByRole("group", { name: /대화 지우기 확인/ })).toBeNull());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "'지난 질문' 대화 지우기" })).toHaveFocus());
    fireEvent.click(within(dialog).getByRole("button", { name: "'지난 질문' 대화 지우기" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(within(dialog).getByText("무엇이 궁금하세요?")).toBeInTheDocument());
    expect(within(dialog).queryByRole("button", { name: /^지난 질문/ })).toBeNull();
    expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/assistant/threads/T1")).toBe(true);
  });

  /** 넓은 화면 — 목록이 펼친 채로 열린다. */
  const wide = () => vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener() {}, removeEventListener() {} }));

  /** 끝 이벤트를 시험이 직접 흘려보내는 질문 흐름(질문마다 하나). */
  const liveAsk = () => {
    const pushes: Array<(e: AskEvent) => void> = [];
    routes["POST /api/assistant/ask"] = (_url, init) => {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          // 끝 이벤트(report·error)를 보내면 서버처럼 흐름을 닫는다.
          pushes.push((e) => {
            c.enqueue(enc.encode(`${JSON.stringify(e)}
`));
            if (e.type === "report" || e.type === "error") c.close();
          });
          init?.signal?.addEventListener("abort", () => c.error(new DOMException("멈춤", "AbortError")));
        },
      });
      return { ok: true, status: 200, body, json: async () => ({}) };
    };
    return pushes;
  };

  it("동시에 여러 대화(원장 2026-11-06 '동시에 3개까지') — 답을 받는 중에 새 대화에서 또 묻는다 · 셋이면 막고 안내 · 하나 끝나면 풀린다", async () => {
    const pushes = liveAsk();
    wide();
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    const input = within(dialog).getByRole("textbox", { name: "질문" });
    for (const [i, q] of ["하나", "둘", "셋"].entries()) {
      fireEvent.change(input, { target: { value: q } });
      fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));
      await waitFor(() => expect(calls.filter((c) => c.url === "/api/assistant/ask")).toHaveLength(i + 1));
      await act(async () => {
        pushes[i]!({ type: "started", messageId: `M${i}` });
        pushes[i]!({ type: "thread", threadId: `T${i}`, title: q });
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "새 질문" }));
    }
    // 셋이 도는 중 — 목록에 도는 표시 셋 · 넷째는 막고 까닭
    await waitFor(() => expect(within(dialog).getAllByLabelText("답을 만드는 중")).toHaveLength(3));
    fireEvent.change(input, { target: { value: "넷" } });
    expect(within(dialog).getByRole("button", { name: "보내기" })).toBeDisabled();
    expect(within(dialog).getByText(/답은 동시에 3개까지 만들 수 있습니다/)).toBeInTheDocument();
    // 하나가 끝나면 자리가 난다
    await act(async () => {
      pushes[1]!({ type: "report", messageId: "M1", report });
    });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "보내기" })).toBeEnabled());
    expect(within(dialog).getAllByLabelText("답을 만드는 중")).toHaveLength(2);
  });

  it("서버가 자리 없음으로 받지 않으면(다른 탭에서 셋이 도는 중) 실패 카드 대신 안내하고 보낸 글을 입력칸에 되돌린다", async () => {
    routes["POST /api/assistant/ask"] = () => json({ error: "답은 동시에 3개까지 만들 수 있습니다. 하나가 끝나면 물어봐 주세요", code: "busy" }, 429);
    // 처음 목록엔 도는 대화가 안 보였다(다른 탭이 방금 시작) — 거절 뒤 다시 읽으면 셋이 보인다.
    let listed = 0;
    routes["GET /api/assistant/threads"] = () => {
      listed += 1;
      const running = listed > 1;
      return json({
        enabled: true,
        threads: running ? ["A", "B", "C"].map((id) => ({ id, title: `다른 탭 ${id}`, level: "normal", updatedAt: NOW, running: true })) : [],
      } satisfies ThreadListResponse);
    };
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    const input = within(dialog).getByRole("textbox", { name: "질문" });
    fireEvent.change(input, { target: { value: "미납" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "보내기" }));
    // 실패 카드가 아니라 안내 — 목록을 다시 읽은 뒤엔 목록이 진실(셋이 도는 중 → 보내기 막힘과 까닭)
    expect(await within(dialog).findByText(/답은 동시에 3개까지 만들 수 있습니다/)).toBeInTheDocument();
    expect(input).toHaveValue("미납");
    expect(within(dialog).queryByRole("button", { name: "다시 묻기" })).toBeNull();
    expect(within(dialog).getByText("무엇이 궁금하세요?")).toBeInTheDocument();
    await waitFor(() => expect(listed).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "보내기" })).toBeDisabled());
    expect(within(dialog).getAllByLabelText("답을 만드는 중")).toHaveLength(3);
  });

  it("다른 탭에서 도는 대화 — 목록에 도는 표시(x 없음) · 그 대화에서는 보내기를 막고 까닭을 보인다", async () => {
    routes["GET /api/assistant/threads"] = () =>
      json({ enabled: true, threads: [{ id: "T1", title: "다른 탭 질문", level: "normal", updatedAt: NOW, running: true }] } satisfies ThreadListResponse);
    routes["GET /api/assistant/threads/T1"] = () =>
      json({
        thread: { id: "T1", title: "다른 탭 질문", level: "normal", updatedAt: NOW },
        messages: [{ id: "M1", question: "다른 탭 본문", level: "normal", createdAt: NOW, report: null, error: null, running: true, queries: [], steps: [] }],
      } satisfies ThreadDetailResponse);
    routes["GET /api/assistant/threads/T1?status=1"] = () => json({ running: true });
    wide();
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    const row = await within(dialog).findByRole("button", { name: /^다른 탭 질문/ });
    expect(within(dialog).queryByRole("button", { name: "'다른 탭 질문' 대화 지우기" })).toBeNull();
    fireEvent.click(row);
    expect(await within(dialog).findByText(/아직 답을 만드는 중입니다/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "질문" }), { target: { value: "더 묻기" } });
    expect(within(dialog).getByRole("button", { name: "보내기" })).toBeDisabled();
    expect(within(dialog).getByText(/이 대화는 아직 앞 질문의 답을 만드는 중입니다/)).toBeInTheDocument();
    // 다른 곳에서 쥔 자리도 여기서 풀 수 있다 — 질문 번호로 멈춤
    routes["POST /api/assistant/messages/M1/stop"] = () => json({ ok: true });
    fireEvent.click(within(dialog).getByRole("button", { name: "멈추기" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/assistant/messages/M1/stop")).toBe(true));
    expect(await within(dialog).findByRole("button", { name: "멈추는 중…" })).toBeDisabled();
  });

  it("도는 테두리 — 판을 닫아도 15초마다 끝났는지 물어, 끝나면 테두리가 풀린다(적대 리뷰 2026-11-09)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "clearInterval"] });
    try {
      let running = true;
      routes["GET /api/assistant/threads"] = () =>
        json({ enabled: true, threads: [{ id: "T1", title: "다른 탭 질문", level: "normal", updatedAt: NOW, running }] } satisfies ThreadListResponse);
      render(<AssistantLauncher />);
      fireEvent.click(screen.getByRole("button", { name: /비서/ }));
      const dialog = await findDialog();
      await within(dialog).findByRole("button", { name: /^다른 탭 질문/ });
      fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const trigger = screen.getByRole("button", { name: /비서/ });
      expect(trigger.querySelector("[data-assistant-busy-ring]")).not.toBeNull();
      expect(within(trigger).getByText(/답을 1개 만드는 중/)).toBeInTheDocument();

      running = false;
      const before = calls.filter((c) => c.method === "GET" && c.url === "/api/assistant/threads").length;
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      await waitFor(() => expect(calls.filter((c) => c.method === "GET" && c.url === "/api/assistant/threads").length).toBeGreaterThan(before));
      await waitFor(() => expect(trigger.querySelector("[data-assistant-busy-ring]")).toBeNull());
      expect(within(trigger).queryByText(/만드는 중/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("도는 테두리 — 지금 보던 대화가 판을 닫은 채 끝나도 15초마다 물어 풀린다(재리뷰 2026-11-09)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "clearInterval"] });
    try {
      let running = true;
      // 목록은 도는 줄 모름(running 없음) — 저장본만 '도는 중'이라 목록 쪽 다시 읽기로는 풀리지 않는다.
      routes["GET /api/assistant/threads"] = () => json({ enabled: true, threads: [{ id: "T1", title: "지난 질문", level: "normal", updatedAt: NOW }] } satisfies ThreadListResponse);
      routes["GET /api/assistant/threads/T1"] = () =>
        json({
          thread: { id: "T1", title: "지난 질문", level: "normal", updatedAt: NOW },
          messages: [{ id: "M1", question: "지난 본문", level: "normal", createdAt: NOW, report: null, error: running ? null : "끝내지 못했습니다", running, queries: [], steps: [] }],
        } satisfies ThreadDetailResponse);
      routes["GET /api/assistant/threads/T1?status=1"] = () => json({ running });
      render(<AssistantLauncher />);
      fireEvent.click(screen.getByRole("button", { name: /비서/ }));
      const dialog = await findDialog();
      fireEvent.click(await within(dialog).findByRole("button", { name: /^지난 질문/ }));
      expect(await within(dialog).findByText(/아직 답을 만드는 중입니다/)).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "닫기" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      const trigger = screen.getByRole("button", { name: /비서/ });
      expect(trigger.querySelector("[data-assistant-busy-ring]")).not.toBeNull();

      running = false;
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      await waitFor(() => expect(calls.some((c) => c.method === "GET" && c.url === "/api/assistant/threads/T1?status=1")).toBe(true));
      await waitFor(() => expect(trigger.querySelector("[data-assistant-busy-ring]")).toBeNull());
    } finally {
      vi.useRealTimers();
    }
  });

  it("'바로 결과 보기'(원장 2026-11-06) — 조회를 하나 마친 뒤 누를 수 있고, 서버에 알린 뒤 그 자리에 보고서를 받는다", async () => {
    const pushes = liveAsk();
    routes["POST /api/assistant/messages/*"] = () => json({ ok: true });
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: /미납 현황을 반별로 정리해 줘/ }));
    await waitFor(() => expect(pushes).toHaveLength(1));
    await act(async () => {
      pushes[0]!({ type: "started", messageId: "M3" });
      pushes[0]!({ type: "thread", threadId: "T3", title: "미납" });
      pushes[0]!({ type: "step", step: { id: "s1", kind: "write_sql", label: "조회문을 쓰는 중", state: "running", at: 0 } });
    });
    const finish = await within(dialog).findByRole("button", { name: "바로 결과 보기" });
    expect(finish).toBeDisabled();
    await act(async () => {
      pushes[0]!({ type: "step", step: { id: "s2", kind: "query", label: "조회 1 · 반별 미납액", state: "done", at: 100, ms: 30, detail: "3행" } });
    });
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "바로 결과 보기" })).toBeEnabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "바로 결과 보기" }));
    expect(await within(dialog).findByRole("button", { name: "결과 정리 중…" })).toBeDisabled();
    await waitFor(() => expect(calls.some((x) => x.method === "POST" && x.url === "/api/assistant/messages/M3/finish")).toBe(true));
    // 멈춤과 달리 흐름은 끊지 않는다 — 보고서가 그 자리에
    await act(async () => {
      pushes[0]!({ type: "report", messageId: "M3", report: { ...report, cutShort: "user" } });
    });
    expect(await within(dialog).findByRole("heading", { name: "반별 미납 보고서" })).toBeInTheDocument();
    expect(within(dialog).getByText(/'바로 결과 보기'로 여기서 조회를 끝내고/)).toBeInTheDocument();
    expect(calls.some((x) => x.url.endsWith("/stop"))).toBe(false);
  });

  it("대화 이름 바꾸기 — 머리·목록이 함께 · Esc는 판이 아니라 고치기만 닫는다 · 실패 이유(원장 2026-11-06)", async () => {
    routes["GET /api/assistant/threads"] = () => json({ enabled: true, threads: [{ id: "T1", title: "지난 질문", level: "high", updatedAt: NOW }] });
    routes["GET /api/assistant/threads/T1"] = () =>
      json({
        thread: { id: "T1", title: "지난 질문", level: "high", updatedAt: NOW },
        messages: [{ id: "M1", question: "지난 질문 본문", level: "high", createdAt: NOW, report, error: null, running: false, queries: [], steps: [] }],
      });
    let renameStatus = 200;
    routes["PATCH /api/assistant/threads/T1"] = () =>
      renameStatus === 200 ? json({ title: "김윤하 선생님 분석" }) : json({ error: "이름은 80자까지입니다" }, renameStatus);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width"), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    fireEvent.click(await within(dialog).findByRole("button", { name: /^지난 질문/ }));
    expect(await within(dialog).findByText("지난 질문 본문")).toBeInTheDocument();

    // Esc — 고치기만 닫고 판은 그대로
    fireEvent.click(within(dialog).getByRole("button", { name: "이름 바꾸기" }));
    const field = within(dialog).getByRole("textbox", { name: "대화 이름" });
    expect(field).toHaveValue("지난 질문");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(within(dialog).queryByRole("textbox", { name: "대화 이름" })).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // 저장·취소 뒤 포커스는 '이름 바꾸기' 버튼으로
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "이름 바꾸기" })).toHaveFocus());
    // 고치는 중에 목록에서 대화를 고르면 고치기는 닫힌다(남은 표시가 Esc를 삼키지 않게)
    fireEvent.click(within(dialog).getByRole("button", { name: "이름 바꾸기" }));
    expect(within(dialog).getByRole("textbox", { name: "대화 이름" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /^지난 질문/ }));
    await waitFor(() => expect(within(dialog).queryByRole("textbox", { name: "대화 이름" })).toBeNull());

    // 실패 — 이유를 보이고 고치기 칸은 남는다
    renameStatus = 400;
    fireEvent.click(within(dialog).getByRole("button", { name: "이름 바꾸기" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "대화 이름" }), { target: { value: "너무 긴 이름" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));
    expect(await within(dialog).findByText("이름은 80자까지입니다")).toBeInTheDocument();

    // 저장 중 Esc — 저장 버튼에 초점이 있어도(막지 않는다) 편집 칸은 닫히지 않고 결과를 기다린다(재리뷰 2026-11-09)
    let release: () => void = () => {};
    renameStatus = 409;
    routes['PATCH /api/assistant/threads/T1'] = () => new Promise((resolve) => (release = () => resolve(json({ error: '잠시 뒤 다시' }, 409))));
    const saveButton = within(dialog).getByRole('button', { name: '저장' });
    saveButton.focus();
    fireEvent.click(saveButton);
    expect(await within(dialog).findByRole('button', { name: '저장 중' })).toHaveFocus();
    fireEvent.keyDown(within(dialog).getByRole('button', { name: '저장 중' }), { key: 'Escape' });
    expect(within(dialog).getByRole('textbox', { name: '대화 이름' })).toBeInTheDocument();
    await act(async () => release());
    expect(await within(dialog).findByText('잠시 뒤 다시')).toBeInTheDocument();
    routes['PATCH /api/assistant/threads/T1'] = () =>
      renameStatus === 200 ? json({ title: '김윤하 선생님 분석' }) : json({ error: '이름은 80자까지입니다' }, renameStatus);

    // 성공 — 서버가 정리한 이름이 머리와 목록에
    renameStatus = 200;
    fireEvent.change(within(dialog).getByRole("textbox", { name: "대화 이름" }), { target: { value: "  김윤하   선생님 분석 " } });
    fireEvent.submit(within(dialog).getByRole("textbox", { name: "대화 이름" }).closest("form")!);
    expect(await within(dialog).findByRole("heading", { name: "김윤하 선생님 분석" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^김윤하 선생님 분석/ })).toBeInTheDocument();
    const patch = calls.filter((c) => c.method === "PATCH");
    expect(patch.at(-1)).toEqual({ url: "/api/assistant/threads/T1", method: "PATCH", body: { title: "김윤하 선생님 분석" } });
  });
});
