import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskEvent, ThreadDetailResponse, ThreadListResponse } from "@/features/assistant/protocol";
import type { SettledReport } from "@/features/assistant/report";
import { AssistantLauncher } from "./assistant-launcher";
import { ASSISTANT_OPEN_EVENT, ASSISTANT_TOGGLE_MESSAGE } from "./assistant-hotkey";

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
  };
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
    expect(within(dialog).getByRole("button", { name: /미납 현황을 반별로 정리해 줘/ })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((c) => c.url === "/api/assistant/threads")).toBe(true));
    expect(within(dialog).getByRole("radio", { name: "보통" })).toHaveAttribute("aria-checked", "true");
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
    expect(ask?.body).toEqual({ threadId: null, question: "미납 현황을 반별로", level: "normal" });
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
    fireEvent.click(within(dialog).getByRole("button", { name: /미납 현황을 반별로 정리해 줘/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    await act(async () => {
      push({ type: "started", messageId: "M5" });
      push({ type: "thread", threadId: "T5", title: "미납" });
      push({ type: "step", step: { id: "s1", kind: "understand", label: "질문을 이해하는 중", state: "done", at: 0, ms: 700 } });
      push({ type: "step", step: { id: "s2", kind: "write_sql", label: "조회문을 쓰는 중", state: "running", at: 800 } });
      push({ type: "step", step: { id: "s2", kind: "write_sql", label: "조회문을 쓰는 중 · 반별 미납액", state: "running", at: 800, tables: [{ name: "invoices", label: "청구서" }] } });
    });
    const steps = await within(dialog).findByRole("list", { name: "답을 만드는 단계" });
    // 기본은 접힘 — 최신 단계 한 줄만(원장 2026-11-06) · 펼치면 지난 단계까지
    await waitFor(() => expect(within(steps).getAllByRole("listitem")).toHaveLength(1));
    expect(within(steps).queryByText("질문을 이해하는 중")).toBeNull();
    const more = within(dialog).getByRole("button", { name: /지난 단계 1개 펼치기/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    await waitFor(() => expect(within(steps).getAllByRole("listitem")).toHaveLength(2));
    expect(within(dialog).getByRole("button", { name: /과정 접기/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(steps).getByText("조회문을 쓰는 중 · 반별 미납액")).toBeInTheDocument();
    expect(within(steps).getByText("청구서")).toHaveAttribute("data-tip", expect.stringContaining("invoices"));
    expect(within(steps).getByLabelText("진행 중")).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent("조회문을 쓰는 중 · 반별 미납액");
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
    fireEvent.click(within(dialog).getByRole("button", { name: /미납 현황을 반별로 정리해 줘/ }));
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

  it("번호로 보낸 멈춤이 실패하면(세션 만료 등) '지금 도는 내 질문'으로 한 번 더 보내고, 알림이 끝난 뒤 끊는다", async () => {
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
    routes["POST /api/assistant/messages/current/stop"] = () => json({ ok: true });
    render(<AssistantLauncher />);
    fireEvent.click(screen.getByRole("button", { name: /비서/ }));
    const dialog = await findDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: /미납 현황을 반별로 정리해 줘/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    await act(async () => {
      push({ type: "started", messageId: "M7" });
    });
    fireEvent.click(await within(dialog).findByRole("button", { name: "멈추기" }));
    await waitFor(() => expect(calls.some((x) => x.url === "/api/assistant/messages/current/stop")).toBe(true));
    const order = calls.filter((x) => x.url.startsWith("/api/assistant/messages/")).map((x) => x.url);
    expect(order).toEqual(["/api/assistant/messages/M7/stop", "/api/assistant/messages/current/stop"]);
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
    fireEvent.click(within(dialog).getByRole("button", { name: /미납 현황을 반별로 정리해 줘/ }));
    expect(await within(dialog).findByText("오늘 쓸 수 있는 횟수를 다 썼습니다.")).toBeInTheDocument();
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

  it("지난 대화를 열고 지운다(확인 단계)", async () => {
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
    fireEvent.click(await within(dialog).findByRole("button", { name: /지난 질문/ }));
    expect(await within(dialog).findByText("지난 질문 본문")).toBeInTheDocument();
    expect(within(dialog).getByText(/추론 강함/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "대화 지우기" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "지우기" }));
    await waitFor(() => expect(within(dialog).getByText("무엇이 궁금하세요?")).toBeInTheDocument());
    expect(within(dialog).queryByRole("button", { name: /지난 질문/ })).toBeNull();
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
    fireEvent.click(await within(dialog).findByRole("button", { name: /지난 질문/ }));
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
    fireEvent.click(within(dialog).getByRole("button", { name: /지난 질문/ }));
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
    expect(within(dialog).getByRole("button", { name: /김윤하 선생님 분석/ })).toBeInTheDocument();
    const patch = calls.filter((c) => c.method === "PATCH");
    expect(patch.at(-1)).toEqual({ url: "/api/assistant/threads/T1", method: "PATCH", body: { title: "김윤하 선생님 분석" } });
  });
});
