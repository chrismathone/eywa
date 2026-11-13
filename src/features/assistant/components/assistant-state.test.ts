import { describe, expect, it } from "vitest";
import type { AskStep, ThreadDetailResponse, ThreadMessage } from "@/features/assistant/protocol";
import type { SettledReport } from "@/features/assistant/report";
import {
  assistantReducer,
  canStartIn,
  currentConversation,
  formatDuration,
  groupThreadsByDay,
  initialAssistantState,
  isConversationRunningElsewhere,
  isConversationStreaming,
  parseAskEvent,
  runningCount,
  staleRunningThreadIds,
  splitNdjson,
  parseStep,
  stepSummary,
  stepSummaryText,
  stepTrouble,
  threadKey,
  turnFromMessage,
  type AssistantAction,
  type AssistantState,
  type Turn,
} from "./assistant-state";

const NOW = "2026-11-06T05:00:00.000Z";
const report: SettledReport = { title: "보고서", blocks: [{ type: "summary", text: "요약" }], datasets: {} };

const turn = (key: string, question = "질문"): Turn => ({
  key,
  messageId: null,
  question,
  level: "normal",
  createdAt: NOW,
  status: "streaming",
  steps: [],
  queries: [],
  report: null,
  error: null,
});

const run = (state: AssistantState, ...actions: AssistantAction[]) => actions.reduce(assistantReducer, state);

const message = (over: Partial<ThreadMessage>): ThreadMessage => ({
  id: "m1",
  question: "질문",
  level: "normal",
  createdAt: NOW,
  report: null,
  error: null,
  running: false,
  queries: [],
  steps: [],
  ...over,
});

const step = (id: string, over: Partial<AskStep> = {}): AskStep => ({ id, kind: "query", label: `단계 ${id}`, state: "running", at: 0, ...over });

describe("새 대화에서 묻기 — thread 이벤트로 대화 키가 바뀌어도 흐름이 갈 곳을 잃지 않는다", () => {
  it("thread → step → report", () => {
    const s0 = initialAssistantState("new:0");
    const s = run(
      s0,
      { type: "ask/start", convKey: "new:0", turn: turn("k1") },
      { type: "ask/event", turnKey: "k1", event: { type: "thread", threadId: "T1", title: "미납 현황" }, now: NOW },
      { type: "ask/event", turnKey: "k1", event: { type: "step", step: step("s1", { kind: "understand", label: "질문을 이해하는 중" }) }, now: NOW },
      { type: "ask/event", turnKey: "k1", event: { type: "step", step: step("s2", { label: "조회 1 · 반별 미납" }) }, now: NOW },
    );
    expect(s.currentKey).toBe(threadKey("T1"));
    expect(s.conversations["new:0"]).toBeUndefined();
    const conv = currentConversation(s);
    expect(conv.threadId).toBe("T1");
    expect(conv.title).toBe("미납 현황");
    expect(conv.turns[0]!.steps.map((s) => s.label)).toEqual(["질문을 이해하는 중", "조회 1 · 반별 미납"]);
    expect(s.threads[0]).toMatchObject({ id: "T1", title: "미납 현황", level: "normal" });
    expect(isConversationStreaming(s, conv)).toBe(true);

    const done = run(
      s,
      { type: "ask/event", turnKey: "k1", event: { type: "report", messageId: "M1", report }, now: NOW },
      { type: "ask/end", turnKey: "k1" },
    );
    const t = currentConversation(done).turns[0]!;
    expect(t.status).toBe("done");
    expect(t.messageId).toBe("M1");
    expect(t.report).toBe(report);
    expect(done.inflight).toEqual([]);
  });

  it("다른 대화를 보는 동안에도 진행 중인 차례는 제 대화에 쌓인다", () => {
    const s = run(
      initialAssistantState("new:0"),
      { type: "ask/start", convKey: "new:0", turn: turn("k1") },
      { type: "conv/select", threadId: "OTHER", title: "다른 대화" },
      { type: "ask/event", turnKey: "k1", event: { type: "thread", threadId: "T1", title: "새 대화" }, now: NOW },
    );
    expect(s.currentKey).toBe(threadKey("OTHER"));
    expect(s.conversations[threadKey("T1")]!.turns).toHaveLength(1);
  });

  it("대화마다 하나 — 같은 대화에서 진행 중이면 두 번째 시작은 무시", () => {
    const s = run(
      initialAssistantState("new:0"),
      { type: "ask/start", convKey: "new:0", turn: turn("k1") },
      { type: "ask/start", convKey: "new:0", turn: turn("k2") },
    );
    expect(currentConversation(s).turns.map((t) => t.key)).toEqual(["k1"]);
  });

  it("동시에 여러 대화(원장 2026-11-06 '동시에 3개까지') — 대화마다 제 흐름 · 셋이면 더 시작할 수 없다", () => {
    let s = run(initialAssistantState("new:0"), { type: "ask/start", convKey: "new:0", turn: turn("k1") }, {
      type: "ask/event",
      turnKey: "k1",
      event: { type: "thread", threadId: "T1", title: "하나" },
      now: NOW,
    });
    s = run(s, { type: "conv/new", key: "new:1" }, { type: "ask/start", convKey: "new:1", turn: turn("k2") });
    s = run(s, { type: "conv/new", key: "new:2" });
    expect(s.inflight).toEqual(["k1", "k2"]);
    expect(runningCount(s)).toBe(2);
    expect(canStartIn(s, currentConversation(s))).toBe(true);
    s = run(s, { type: "ask/start", convKey: "new:2", turn: turn("k3") }, { type: "conv/new", key: "new:3" });
    expect(runningCount(s)).toBe(3);
    expect(canStartIn(s, currentConversation(s))).toBe(false);
    // 하나가 끝나면 자리가 난다 · 흐름은 서로 섞이지 않는다
    s = run(
      s,
      { type: "ask/event", turnKey: "k2", event: { type: "report", messageId: "M2", report }, now: NOW },
      { type: "ask/end", turnKey: "k2" },
    );
    expect(s.inflight).toEqual(["k1", "k3"]);
    expect(runningCount(s)).toBe(2);
    expect(canStartIn(s, currentConversation(s))).toBe(true);
    expect(s.conversations[threadKey("T1")]!.turns[0]!.status).toBe("streaming");
  });

  it("다른 탭·기기에서 도는 대화도 센다(목록 running) · 그 대화에서는 보낼 수 없다 · 저장본이 끝났으면 풀린다", () => {
    let s = run(initialAssistantState("new:0"), {
      type: "threads/loaded",
      enabled: true,
      threads: [
        { id: "A", title: "a", level: "normal", updatedAt: NOW, running: true },
        { id: "B", title: "b", level: "normal", updatedAt: NOW, running: true },
        { id: "C", title: "c", level: "normal", updatedAt: NOW, running: true },
      ],
    });
    expect(runningCount(s)).toBe(3);
    expect(canStartIn(s, currentConversation(s))).toBe(false);
    s = run(s, { type: "conv/select", threadId: "A" });
    expect(isConversationRunningElsewhere(s, currentConversation(s))).toBe(true);
    const detail: ThreadDetailResponse = { thread: { id: "A", title: "a", level: "normal", updatedAt: NOW }, messages: [message({ id: "MA", report })] };
    s = run(s, { type: "conv/loaded", key: threadKey("A"), detail });
    expect(s.threads.find((t) => t.id === "A")!.running).toBe(false);
    expect(isConversationRunningElsewhere(s, currentConversation(s))).toBe(false);
    expect(runningCount(s)).toBe(2);
    expect(canStartIn(s, currentConversation(s))).toBe(true);
  });

  it("서버가 자리 없음으로 받지 않으면(ask/rejected) 보낸 차례를 거둔다 — 실패 카드를 남기지 않는다", () => {
    const s = run(
      initialAssistantState("new:0"),
      { type: "ask/start", convKey: "new:0", turn: turn("k1") },
      { type: "ask/rejected", turnKey: "k1" },
      { type: "ask/end", turnKey: "k1" },
    );
    expect(currentConversation(s).turns).toEqual([]);
    expect(s.inflight).toEqual([]);
  });

  it("같은 단계 id는 그 자리에서 덮어쓴다(running → done) · 새 단계는 끝에", () => {
    const s = run(
      initialAssistantState("new:0"),
      { type: "ask/start", convKey: "new:0", turn: turn("k1") },
      { type: "ask/event", turnKey: "k1", event: { type: "step", step: step("s1") }, now: NOW },
      { type: "ask/event", turnKey: "k1", event: { type: "step", step: step("s2") }, now: NOW },
      { type: "ask/event", turnKey: "k1", event: { type: "step", step: step("s1", { state: "done", detail: "12행 · 0.3초", ms: 300 }) }, now: NOW },
    );
    expect(currentConversation(s).turns[0]!.steps.map((x) => [x.id, x.state, x.detail ?? null])).toEqual([
      ["s1", "done", "12행 · 0.3초"],
      ["s2", "running", null],
    ]);
  });
});

describe("실패·멈춤·끊김", () => {
  const started = run(initialAssistantState("new:0"), { type: "ask/start", convKey: "new:0", turn: turn("k1") });

  it("error 이벤트는 문구를 남긴다", () => {
    const s = run(started, { type: "ask/event", turnKey: "k1", event: { type: "error", message: "오늘 쓸 수 있는 횟수를 다 썼습니다." }, now: NOW });
    expect(currentConversation(s).turns[0]).toMatchObject({ status: "error", error: "오늘 쓸 수 있는 횟수를 다 썼습니다." });
  });
  it("멈춤", () => {
    const s = run(started, { type: "ask/stopped", turnKey: "k1" });
    expect(currentConversation(s).turns[0]!.status).toBe("stopped");
  });
  it("끊김 → 저장본을 다시 읽는 중 → 못 읽으면 이유를 적는다", () => {
    const s = run(
      started,
      { type: "ask/event", turnKey: "k1", event: { type: "thread", threadId: "T1", title: "t" }, now: NOW },
      { type: "ask/broken", turnKey: "k1" },
      { type: "ask/end", turnKey: "k1" },
    );
    expect(currentConversation(s).turns[0]!.status).toBe("recovering");
    const failed = run(s, { type: "conv/failed", key: threadKey("T1"), error: "네트워크" });
    expect(currentConversation(failed).turns[0]).toMatchObject({ status: "error", error: "연결이 끊겼고 결과를 다시 불러오지 못했습니다." });
  });
  it("보고서가 이미 왔으면 뒤늦은 실패가 덮지 않는다", () => {
    const s = run(
      started,
      { type: "ask/event", turnKey: "k1", event: { type: "report", messageId: "M1", report }, now: NOW },
      { type: "ask/failed", turnKey: "k1", error: "x" },
    );
    expect(currentConversation(s).turns[0]!.status).toBe("done");
  });
});

describe("저장본 읽기", () => {
  const detail = (messages: ThreadMessage[]): ThreadDetailResponse => ({
    thread: { id: "T1", title: "저장된 제목", level: "high", updatedAt: NOW },
    messages,
  });

  it("메시지 → 차례(끝남·도는 중·실패·아무것도 없음)", () => {
    expect(turnFromMessage(message({ report })).status).toBe("done");
    expect(turnFromMessage(message({ running: true })).status).toBe("running");
    expect(turnFromMessage(message({ error: "시간 초과" }))).toMatchObject({ status: "error", error: "시간 초과" });
    expect(turnFromMessage(message({}))).toMatchObject({ status: "error", error: "답을 받지 못했습니다." });
    expect(turnFromMessage(message({ level: "weird" as never })).level).toBe("low");
    expect(turnFromMessage(message({ report, steps: [step("s1", { state: "done" })] })).steps).toHaveLength(1);
    expect(turnFromMessage({ ...message({}), steps: undefined as never }).steps).toEqual([]);
  });

  it("끊겨서 다시 읽으면 저장본이 로컬 차례를 대신한다", () => {
    const s = run(
      initialAssistantState("new:0"),
      { type: "ask/start", convKey: "new:0", turn: turn("k1") },
      { type: "ask/event", turnKey: "k1", event: { type: "thread", threadId: "T1", title: "t" }, now: NOW },
      { type: "ask/broken", turnKey: "k1" },
      { type: "ask/end", turnKey: "k1" },
      { type: "conv/loaded", key: threadKey("T1"), detail: detail([message({ id: "M1", report })]) },
    );
    const conv = currentConversation(s);
    expect(conv.title).toBe("저장된 제목");
    expect(conv.turns.map((t) => [t.key, t.status])).toEqual([["m:M1", "done"]]);
  });

  it("🔴 답을 받는 중에 같은 대화를 다시 읽어도 진행 중 차례는 남는다(저장본의 '도는 중' 사본은 뺀다)", () => {
    const s = run(
      initialAssistantState("new:0"),
      { type: "conv/select", threadId: "T1" },
      { type: "ask/start", convKey: threadKey("T1"), turn: turn("k1", "두 번째 질문") },
      {
        type: "conv/loaded",
        key: threadKey("T1"),
        detail: detail([message({ id: "M0", question: "첫 질문", report }), message({ id: "M1", question: "두 번째 질문", running: true })]),
      },
    );
    expect(currentConversation(s).turns.map((t) => t.key)).toEqual(["m:M0", "k1"]);
  });

  it("번호(started)를 받은 뒤에는 번호로 맞춘다 — 같은 글을 앞에서 물은 차례(멈춘 질문 등)를 잘못 빼지 않는다", () => {
    const s = run(
      initialAssistantState("new:0"),
      { type: "conv/select", threadId: "T1" },
      { type: "ask/start", convKey: threadKey("T1"), turn: turn("k1", "같은 질문") },
      { type: "ask/event", turnKey: "k1", event: { type: "started", messageId: "M2" }, now: NOW },
      {
        type: "conv/loaded",
        key: threadKey("T1"),
        // M1 = 멈춘 뒤 마무리 중인 앞 차례(같은 글) · M2 = 지금 받는 차례의 저장본
        detail: detail([message({ id: "M1", question: "같은 질문", running: true }), message({ id: "M2", question: "같은 질문", running: true })]),
      },
    );
    expect(currentConversation(s).turns.map((t) => t.key)).toEqual(["m:M1", "k1"]);
  });
});

describe("대화 고르기·새 질문·지우기", () => {
  it("새 질문을 여러 번 눌러도 빈 대화는 하나", () => {
    const s = run(initialAssistantState("new:0"), { type: "conv/select", threadId: "T1" }, { type: "conv/new", key: "new:1" }, { type: "conv/new", key: "new:2" });
    expect(s.currentKey).toBe("new:0");
    expect(Object.keys(s.conversations).sort()).toEqual(["new:0", threadKey("T1")].sort());
  });
  it("지금 보던 대화를 지우면 빈 새 대화로", () => {
    const s = run(
      initialAssistantState("new:0"),
      { type: "threads/loaded", enabled: true, threads: [{ id: "T1", title: "a", level: "normal", updatedAt: NOW }] },
      { type: "ask/start", convKey: "new:0", turn: turn("k1") },
      { type: "ask/event", turnKey: "k1", event: { type: "thread", threadId: "T2", title: "b" }, now: NOW },
      { type: "ask/end", turnKey: "k1" },
      { type: "thread/deleted", threadId: "T2", newKey: "new:9" },
    );
    expect(s.currentKey).toBe("new:9");
    expect(s.threads.map((t) => t.id)).toEqual(["T1"]);
    expect(s.conversations[threadKey("T2")]).toBeUndefined();
  });
  it("목록 읽기 실패 — 이미 받은 목록은 지우지 않는다", () => {
    const s = run(
      initialAssistantState(),
      { type: "threads/loaded", enabled: true, threads: [{ id: "T1", title: "a", level: "normal", updatedAt: NOW }] },
      { type: "threads/loading" },
      { type: "threads/failed", error: "x" },
    );
    expect(s.threadsLoad).toBe("ready");
    expect(s.threads).toHaveLength(1);
    expect(s.threadsError).toBe("x");
  });
});

describe("진행 단계 요약", () => {
  it("걸린 시간 글자", () => {
    expect(formatDuration(3400)).toBe("3.4초");
    expect(formatDuration(18_400)).toBe("18초");
    expect(formatDuration(65_000)).toBe("1분 5초");
    expect(formatDuration(120_000)).toBe("2분");
    expect(formatDuration(-5)).toBe("0.0초");
  });
  it("조회 횟수 · 본 표(겹치지 않게) · 가장 늦게 끝난 시각 · 막힌 단계", () => {
    const steps: AskStep[] = [
      step("s1", { kind: "understand", state: "done", at: 0, ms: 900 }),
      step("s2", { kind: "schema", state: "done", at: 1000, ms: 400, tables: [{ name: "invoices", label: "청구서" }, { name: "students", label: "원생" }] }),
      step("s3", { kind: "query", state: "done", at: 2000, ms: 300, tables: [{ name: "invoices", label: "청구서" }] }),
      step("s4", { kind: "query", state: "error", at: 2500, ms: 100, detail: "문법 오류" }),
      step("s5", { kind: "report", state: "done", at: 3000, ms: 15_000 }),
    ];
    // 답이 실패한 차례(settled 아님) — 막힌 단계는 그대로 막힘(어디서 막혔는지가 곧 까닭)
    expect(stepSummary(steps)).toEqual({ queries: 2, tables: 2, ms: 18_000, retried: 0, limited: 0, cut: 0, failed: 1 });
    expect(stepSummaryText(steps)).toBe("조회 2번 · 표 2개 · 18초 · 막힌 단계 1개");
    expect(stepSummaryText([step("s1", { kind: "understand", state: "done", at: 0, ms: 1200 })])).toBe("1.2초");
  });

  it("parseStep — 한도 표식(limit)·원장이 끝낸 표식(user)만 받고 다른 값은 버린다", () => {
    expect(parseStep({ id: "s1", kind: "query", label: "l", state: "error", at: 0, cause: "limit" })).toMatchObject({ cause: "limit" });
    expect(parseStep({ id: "s1", kind: "query", label: "l", state: "error", at: 0, cause: "user" })).toMatchObject({ cause: "user" });
    expect(parseStep({ id: "s1", kind: "survey", label: "l", state: "done", at: 0 })).toMatchObject({ kind: "survey" });
    expect(parseStep({ id: "s1", kind: "query", label: "l", state: "error", at: 0, cause: "boom" })).not.toHaveProperty("cause");
  });

  it("막힌 단계의 뜻 — 답이 끝까지 나왔고 뒤에 같은 종류가 이어졌을 때만 '다시 시도'(원장 2026-11-06 · 적대 리뷰)", () => {
    const steps: AskStep[] = [
      step("s1", { kind: "query", state: "error", at: 0, ms: 100, detail: "없는 칸을 썼습니다" }),
      step("s2", { kind: "query", state: "done", at: 200, ms: 100 }),
      step("s3", { kind: "write_sql", state: "error", at: 400, ms: 100, cause: "limit", detail: "조회는 질문당 12번까지라 여기까지 봤습니다" }),
      step("s4", { kind: "report", state: "error", at: 600, ms: 100, detail: "조회 결과와 맞지 않는 곳이 있어 고칩니다" }),
      step("s5", { kind: "fix", state: "done", at: 800, ms: 100 }),
      step("s6", { kind: "query", state: "error", at: 1000, ms: 100, detail: "8초 안에 끝나지 않았습니다" }),
      step("s7", { kind: "report", state: "done", at: 1200, ms: 100 }),
    ];
    // 보고서로 끝난 차례: s1(뒤에 조회 성공) · s4(뒤에 고친 보고서) = 다시 시도 · s3 = 한도 · s6(뒤에 성공한 조회 없음) = 막힘
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => stepTrouble(steps, i, true))).toEqual(["retried", null, "limit", "retried", null, "failed", null]);
    expect(stepSummaryText(steps, true)).toBe("조회 3번 · 1.3초 · 다시 시도 2번 · 시간·한도로 여기까지 · 막힌 단계 1개");
    // 같은 단계라도 답이 실패한 차례면 다시 시도로 보지 않는다(한도는 그대로 한도)
    expect([0, 2, 3].map((i) => stepTrouble(steps, i, false))).toEqual(["failed", "limit", "failed"]);
  });
});

describe("groupThreadsByDay — KST 날짜로", () => {
  const t = (id: string, updatedAt: string) => ({ id, title: id, level: "normal" as const, updatedAt });
  it("오늘·어제·지난 7일·이전 · 최근 순 · 오늘은 시각, 그 밖은 월/일", () => {
    const groups = groupThreadsByDay(
      [
        t("old", "2026-10-01T03:00:00Z"),
        t("week", "2026-11-01T03:00:00Z"),
        // 2026-11-05 16:00 UTC = 2026-11-06 01:00 KST → 오늘
        t("today-early", "2026-11-05T16:00:00Z"),
        t("today", "2026-11-06T05:30:00Z"),
        t("yesterday", "2026-11-05T02:00:00Z"),
        t("broken", "언제"),
      ],
      "2026-11-06",
    );
    expect(groups.map((g) => [g.label, g.items.map((i) => `${i.thread.id}@${i.when}`)])).toEqual([
      ["오늘", ["today@14:30", "today-early@01:00"]],
      ["어제", ["yesterday@11/5"]],
      ["지난 7일", ["week@11/1"]],
      ["이전", ["old@10/1", "broken@"]],
    ]);
  });
});

describe("NDJSON", () => {
  it("줄로 나누고 덜 온 끝은 남긴다", () => {
    expect(splitNdjson('{"a":1}\n\n{"b":2}\n{"c"')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
    expect(splitNdjson("")).toEqual({ lines: [], rest: "" });
  });
  it("이벤트 모양을 확인한다 — 틀린 줄은 버린다", () => {
    expect(
      parseAskEvent(
        JSON.stringify({
          type: "step",
          step: { id: "s3", kind: "query", label: "조회 1 · 반별 미납", state: "done", at: 1200, ms: 300, detail: "12행 · 0.3초", tables: [{ name: "invoices", label: "청구서" }, { bad: 1 }] },
        }),
      ),
    ).toEqual({
      type: "step",
      step: { id: "s3", kind: "query", label: "조회 1 · 반별 미납", state: "done", at: 1200, ms: 300, detail: "12행 · 0.3초", tables: [{ name: "invoices", label: "청구서" }] },
    });
    expect(parseAskEvent('{"type":"step","step":{"id":"s1","kind":"dance","label":"x","state":"running","at":0}}')).toBeNull();
    expect(parseAskEvent('{"type":"step","step":{"id":"s1","kind":"query","label":"x","state":"maybe","at":0}}')).toBeNull();
    expect(parseAskEvent('{"type":"report","messageId":"M","report":{"title":"t","blocks":[],"datasets":{}}}')?.type).toBe("report");
    expect(parseAskEvent('{"type":"report","messageId":"M","report":{"title":"t"}}')).toBeNull();
    expect(parseAskEvent('{"type":"status","text":"옛 이벤트"}')).toBeNull();
    expect(parseAskEvent('{"type":"nope"}')).toBeNull();
    expect(parseAskEvent("not json")).toBeNull();
    expect(parseAskEvent("[1,2]")).toBeNull();
  });
});

describe("'바로 결과 보기'로 하지 않은 조회(cause user · 원장 2026-11-06)", () => {
  it("막힘이 아니라 원장이 끝낸 것 — 요약 줄은 '여기서 조회를 끝냄'", () => {
    const steps: AskStep[] = [
      step("a", { state: "done", ms: 1000 }),
      step("b", { state: "error", cause: "user", detail: "여기서 조회를 끝냈습니다", at: 1000, ms: 10 }),
      step("r", { kind: "report", state: "done", at: 2000, ms: 3000 }),
    ];
    expect(stepTrouble(steps, 1, true)).toBe("user");
    expect(stepSummary(steps, true)).toMatchObject({ cut: 1, failed: 0, limited: 0 });
    expect(stepSummaryText(steps, true)).toContain("여기서 조회를 끝냄");
    expect(stepSummaryText(steps, true)).not.toContain("막힌 단계");
  });
});

describe("도는 중 표시가 남지 않게(적대 리뷰 2026-11-09)", () => {
  it("저장본이 '도는 중'인 대화를 두고 다른 대화로 옮기면 따로 확인할 대화로 잡힌다", () => {
    const detail: ThreadDetailResponse = { thread: { id: "A", title: "a", level: "normal", updatedAt: NOW }, messages: [message({ id: "MA", running: true })] };
    let s = run(initialAssistantState("new:0"), { type: "conv/select", threadId: "A" }, { type: "conv/loaded", key: threadKey("A"), detail });
    expect(staleRunningThreadIds(s)).toEqual([]); // 보고 있는 대화는 3초 다시 읽기가 맡는다
    s = run(s, { type: "conv/new", key: "new:1" });
    expect(staleRunningThreadIds(s)).toEqual(["A"]);
    expect(runningCount(s)).toBe(1);
  });

  it("멈추면 목록의 '도는 중'이 바로 풀린다(멈춘 질문은 자리를 비운다)", () => {
    let s = run(initialAssistantState("new:0"), {
      type: "threads/loaded",
      enabled: true,
      threads: [{ id: "T1", title: "t", level: "normal", updatedAt: NOW, running: true }],
    });
    s = run(s, { type: "conv/select", threadId: "T1" }, { type: "ask/start", convKey: threadKey("T1"), turn: turn("k1") }, { type: "ask/stopped", turnKey: "k1" }, { type: "ask/end", turnKey: "k1" });
    expect(s.threads[0]!.running).toBe(false);
    expect(runningCount(s)).toBe(0);
  });

  it("늦게 온 목록이 방금 생긴(답을 받는 중인) 대화를 빼지 않는다", () => {
    let s = run(
      initialAssistantState("new:0"),
      { type: "ask/start", convKey: "new:0", turn: turn("k1") },
      { type: "ask/event", turnKey: "k1", event: { type: "thread", threadId: "T9", title: "새 대화" }, now: NOW },
    );
    s = run(s, { type: "threads/loaded", enabled: true, threads: [{ id: "OLD", title: "옛", level: "normal", updatedAt: NOW }] });
    expect(s.threads.map((t) => t.id)).toEqual(["T9", "OLD"]);
  });
});

describe("재리뷰 수리(2026-11-09)", () => {
  it("다른 곳에서 지운 대화(404) — 도는 표시를 풀고 목록에서 뺀다(끝없이 다시 묻지 않게)", () => {
    const detail: ThreadDetailResponse = { thread: { id: "X", title: "x", level: "normal", updatedAt: NOW }, messages: [message({ id: "MX", running: true })] };
    let s = run(
      initialAssistantState("new:0"),
      { type: "threads/loaded", enabled: true, threads: [{ id: "X", title: "x", level: "normal", updatedAt: NOW, running: true }] },
      { type: "conv/select", threadId: "X" },
      { type: "conv/loaded", key: threadKey("X"), detail },
      { type: "conv/new", key: "new:1" },
    );
    expect(staleRunningThreadIds(s)).toEqual(["X"]);
    s = run(s, { type: "conv/failed", key: threadKey("X"), error: "대화를 찾지 못했습니다", gone: true });
    expect(staleRunningThreadIds(s)).toEqual([]);
    expect(s.threads.some((t) => t.id === "X")).toBe(false);
    expect(runningCount(s)).toBe(0);
  });

  it("늦게 온 목록이 방금 지운·이름 바꾼 대화를 되돌리지 않는다", () => {
    const list = [
      { id: "A", title: "옛 이름", level: "normal" as const, updatedAt: NOW },
      { id: "B", title: "b", level: "normal" as const, updatedAt: NOW },
    ];
    let s = run(initialAssistantState("new:0"), { type: "threads/loaded", enabled: true, threads: list });
    const since = s.editSeq;
    s = run(s, { type: "thread/renamed", threadId: "A", title: "새 이름" }, { type: "thread/deleted", threadId: "B", newKey: "new:2" });
    // 고치기 전에 읽기 시작한 목록이 이제 도착한다
    s = run(s, { type: "threads/loaded", enabled: true, threads: list, since });
    expect(s.threads.map((t) => [t.id, t.title])).toEqual([["A", "새 이름"]]);
    // 고친 뒤에 읽은 목록은 그대로 믿는다
    s = run(s, { type: "threads/loaded", enabled: true, threads: [{ id: "A", title: "또 다른 이름", level: "normal", updatedAt: NOW }], since: s.editSeq });
    expect(s.threads[0]!.title).toBe("또 다른 이름");
  });
});

