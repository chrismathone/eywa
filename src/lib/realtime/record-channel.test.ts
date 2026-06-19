import { describe, it, expect, beforeAll, vi } from "vitest";

// happy-dom의 BroadcastChannel 지원 여부와 무관하게 결정적으로 검증하려고 in-memory mock으로 대체.
// 같은 이름의 모든 인스턴스(자기 포함)에 배달 → 모듈의 senderId self-ignore 가드를 실제로 검증할 수 있다.
class MockBroadcastChannel {
  static channels: Record<string, MockBroadcastChannel[]> = {};
  listeners = new Set<(e: { data: unknown }) => void>();
  constructor(public name: string) {
    (MockBroadcastChannel.channels[name] ??= []).push(this);
  }
  postMessage(data: unknown) {
    for (const ch of MockBroadcastChannel.channels[this.name] ?? []) {
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

describe("record-channel", () => {
  it("자기 자신이 보낸 저장 메시지는 무시(self senderId)", async () => {
    const { publishRecordSaved, subscribeRecordSaved } = await import("./record-channel");
    const seen: unknown[] = [];
    const unsub = subscribeRecordSaved((m) => seen.push(m));
    publishRecordSaved("student:1");
    expect(seen).toEqual([]); // 같은 발신자 → 무시
    unsub();
  });

  it("다른 발신자(다른 창/탭)의 저장은 수신", async () => {
    const { subscribeRecordSaved } = await import("./record-channel");
    const seen: { scope: string }[] = [];
    const unsub = subscribeRecordSaved((m) => seen.push(m));
    // 다른 문서가 보낸 것처럼 별도 채널로 직접 post.
    new BroadcastChannel("eywa-record-edits").postMessage({
      type: "saved",
      scope: "student:1",
      senderId: "other-document",
    });
    expect(seen.length).toBe(1);
    expect(seen[0].scope).toBe("student:1");
    unsub();
  });

  it("해제 후엔 더 이상 수신하지 않는다", async () => {
    const { subscribeRecordSaved } = await import("./record-channel");
    const seen: unknown[] = [];
    const unsub = subscribeRecordSaved((m) => seen.push(m));
    unsub();
    new BroadcastChannel("eywa-record-edits").postMessage({
      type: "saved",
      scope: "class:9",
      senderId: "other-document",
    });
    expect(seen).toEqual([]);
  });
});
