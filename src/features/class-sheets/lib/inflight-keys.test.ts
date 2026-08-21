import { describe, expect, it } from "vitest";
import { createInflightKeys } from "./inflight-keys";

describe("createInflightKeys — 겹치는 저장을 세는 잠금", () => {
  it("잠그고 풀면 사라진다", () => {
    const k = createInflightKeys();
    expect(k.snapshot().has("a")).toBe(false);
    k.acquire("a");
    expect(k.snapshot().has("a")).toBe(true);
    k.release("a");
    expect(k.snapshot().has("a")).toBe(false);
  });

  it("🔴 같은 칸에 저장이 겹치면 **마지막 하나가 끝나야** 풀린다(Set이면 여기서 열렸다)", () => {
    const k = createInflightKeys();
    k.acquire("a");
    k.acquire("a");
    k.release("a");
    expect(k.snapshot().has("a")).toBe(true);
    k.release("a");
    expect(k.snapshot().has("a")).toBe(false);
  });

  it("없는 키를 풀어도 음수로 새지 않는다", () => {
    const k = createInflightKeys();
    k.release("a");
    k.acquire("a");
    expect(k.snapshot().has("a")).toBe(true);
    k.release("a");
    expect(k.snapshot().has("a")).toBe(false);
  });

  it("스냅샷은 그 시점의 사본 — 뒤에 잠근 키가 옛 스냅샷에 새지 않는다", () => {
    const k = createInflightKeys();
    k.acquire("a");
    const snap = k.snapshot();
    k.acquire("b");
    expect([...snap]).toEqual(["a"]);
  });
});
