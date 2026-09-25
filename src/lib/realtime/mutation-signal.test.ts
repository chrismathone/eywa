import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// 같은 이름의 모든 인스턴스(자기 포함)에 배달하는 in-memory mock — record-channel.test와 같은 방식.
class MockBroadcastChannel {
  static channels: Record<string, MockBroadcastChannel[]> = {};
  listeners = new Set<(e: { data: unknown }) => void>();
  constructor(public name: string) {
    (MockBroadcastChannel.channels[name] ??= []).push(this);
  }
  postMessage(data: unknown) {
    for (const ch of MockBroadcastChannel.channels[this.name] ?? []) {
      if (ch === this) continue; // 진짜 BroadcastChannel처럼 보낸 객체 자신에겐 안 간다
      for (const l of ch.listeners) l({ data });
    }
  }
  addEventListener(_type: string, cb: (e: { data: unknown }) => void) {
    this.listeners.add(cb);
  }
  removeEventListener(_type: string, cb: (e: { data: unknown }) => void) {
    this.listeners.delete(cb);
  }
  close() {}
}

beforeAll(() => {
  vi.stubGlobal("BroadcastChannel", MockBroadcastChannel as unknown as typeof BroadcastChannel);
});

const ORIGIN = "http://localhost:3000";

describe("isMutationResponse — 무엇을 '바뀜'으로 보나", async () => {
  const { isMutationResponse } = await import("./mutation-signal");
  const ok = (revalidated: string | null = null) => ({ ok: true, revalidated });

  it("서버 액션은 Next가 재검증했다고 답한 것만(1|2) — 조회용 액션은 안 센다", () => {
    const req = { url: "/students", method: "POST", nextAction: true };
    expect(isMutationResponse(req, ok("1"), ORIGIN)).toBe(true);
    expect(isMutationResponse(req, ok("2"), ORIGIN)).toBe(true);
    expect(isMutationResponse(req, ok("0"), ORIGIN)).toBe(false);
    expect(isMutationResponse(req, ok(null), ORIGIN)).toBe(false);
  });

  it("실패한 요청은 안 센다(저장 실패로 다른 창을 새로고침하지 않는다)", () => {
    expect(isMutationResponse({ url: "/api/x", method: "POST", nextAction: false }, { ok: false, revalidated: null }, ORIGIN)).toBe(false);
    expect(isMutationResponse({ url: "/x", method: "POST", nextAction: true }, { ok: false, revalidated: null }, ORIGIN)).toBe(false);
  });

  it("🔴 redirect()로 끝나는 저장(303 — ok=false)도 재검증했으면 센다(출석 저장·'새 X' 폼)", () => {
    expect(isMutationResponse({ url: "/attendance", method: "POST", nextAction: true }, { ok: false, revalidated: "1" }, ORIGIN)).toBe(true);
  });

  it("GET·HEAD는 절대 안 센다", () => {
    expect(isMutationResponse({ url: "/api/x", method: "GET", nextAction: false }, ok(), ORIGIN)).toBe(false);
    expect(isMutationResponse({ url: "/api/x", method: "head", nextAction: false }, ok(), ORIGIN)).toBe(false);
  });

  it("같은 origin은 /api/* 쓰기만 — 페이지 경로 POST(서버 액션 아님)는 안 센다", () => {
    expect(isMutationResponse({ url: "/api/upload", method: "POST", nextAction: false }, ok(), ORIGIN)).toBe(true);
    expect(isMutationResponse({ url: `${ORIGIN}/api/a`, method: "DELETE", nextAction: false }, ok(), ORIGIN)).toBe(true);
    expect(isMutationResponse({ url: "/students", method: "POST", nextAction: false }, ok(), ORIGIN)).toBe(false);
  });

  it("Supabase REST 쓰기는 세고, rpc(조회가 대부분)·인증은 안 센다", () => {
    const sb = "https://abc.supabase.co";
    expect(isMutationResponse({ url: `${sb}/rest/v1/students`, method: "PATCH", nextAction: false }, ok(), ORIGIN)).toBe(true);
    expect(isMutationResponse({ url: `${sb}/rest/v1/rpc/f`, method: "POST", nextAction: false }, ok(), ORIGIN)).toBe(false);
    expect(isMutationResponse({ url: `${sb}/auth/v1/token`, method: "POST", nextAction: false }, ok(), ORIGIN)).toBe(false);
  });
});

describe("publish/subscribe — 같은 문서와 다른 문서 모두에 닿는다", () => {
  it("🔴 같은 문서에서 난 바뀜도 구독자에게 간다(BroadcastChannel은 자기 자신엔 안 보낸다)", async () => {
    const { publishMutation, subscribeMutations } = await import("./mutation-signal");
    const seen = vi.fn();
    const off = subscribeMutations(seen);
    publishMutation();
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    publishMutation();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("다른 문서(창·탭)가 보낸 바뀜을 받는다", async () => {
    const { subscribeMutations } = await import("./mutation-signal");
    const seen = vi.fn();
    const off = subscribeMutations(seen);
    new BroadcastChannel("eywa-mutations").postMessage({ type: "mutated", at: 1 });
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });
});

describe("installMutationDetector — fetch를 감싸도 결과는 그대로", () => {
  const realFetch = window.fetch;
  afterEach(() => {
    window.fetch = realFetch;
    delete (window as unknown as Record<string, unknown>).__eywaMutationFetch;
  });

  it("재검증한 서버 액션 응답에 방송하고, 응답 객체는 손대지 않는다 · 두 번 설치해도 한 번만 감싼다", async () => {
    const res = new Response("body", { status: 200, headers: { "x-action-revalidated": "1" } });
    const inner = vi.fn(async () => res);
    window.fetch = inner as unknown as typeof fetch;
    const { installMutationDetector, subscribeMutations } = await import("./mutation-signal");
    installMutationDetector();
    const wrapped = window.fetch;
    installMutationDetector();
    expect(window.fetch).toBe(wrapped);

    const seen = vi.fn();
    const off = subscribeMutations(seen);
    const got = await window.fetch("/students", { method: "POST", headers: { "Next-Action": "abc" } });
    expect(got).toBe(res);
    expect(await got.text()).toBe("body"); // 본문을 안 읽었다
    expect(seen).toHaveBeenCalledTimes(1);

    await window.fetch("/students"); // GET
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it("요청이 실패(throw)하면 그대로 던진다", async () => {
    window.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const { installMutationDetector } = await import("./mutation-signal");
    installMutationDetector();
    await expect(window.fetch("/api/x", { method: "POST" })).rejects.toThrow("offline");
  });
});
