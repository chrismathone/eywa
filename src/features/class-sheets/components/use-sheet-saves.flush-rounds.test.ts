import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetSaveStore } from "./use-sheet-saves";
import { buildSaveKey, type PlanFieldPatch } from "../lib/save-keys";

// 칸 편집 감사로그(원장 결정 2026-09-14)와 저장 큐가 맞물리는 두 자리를 잠근다(리뷰 2026-09-14).
//  ① flush는 "전송 중 이어 친 최종 값"까지 보낸 뒤 돌아온다 — 안 그러면 감사로그가 중간 값을 읽고 최종 값은 영영 무기록.
//  ② '내 값으로 덮기'도 편집으로 알린다 — 안 그러면 충돌 해소가 감사로그에 한 줄도 안 남는다.

const applied = (patches: PlanFieldPatch[]) => ({
  ok: true as const,
  results: patches.map((p) => ({
    saveKey: p.saveKey,
    status: "applied" as const,
    serverValue: p.newValue,
    clientRev: p.clientRev,
  })),
});

const makeStore = (send: (patches: PlanFieldPatch[]) => Promise<unknown>) =>
  new SheetSaveStore(send as never, null, true);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("flush — 전송 중 이어 친 초안까지 보낸다", () => {
  it("🔴 한 묶음이 전송 중일 때 같은 칸에 이어 치고 곧바로 flush하면, 돌아오기 전에 최종 값을 보낸다", async () => {
    const sent: (string | null)[] = [];
    const gate: { release?: () => void } = {};
    let first = true;
    const store = makeStore(async (patches) => {
      sent.push(...patches.map((p) => p.newValue));
      if (first) {
        first = false; // 1회차만 응답을 붙잡아 전송 중 구간을 만든다
        await new Promise<void>((r) => {
          gate.release = r;
        });
      }
      return applied(patches);
    });

    store.edit("L1", "progress", "U3");
    await vi.advanceTimersByTimeAsync(900); // 전송1 시작(응답 대기)
    store.edit("L1", "progress", "U3 lesson"); // 전송 중 같은 칸에 이어 침
    const done = store.flush(); // 곧바로 칸을 떠남(Tab) — 감사로그가 이 flush를 기다린다
    gate.release?.();
    await done; // 🔴 타이머를 돌리지 않아도 최종 값이 나가 있어야 한다(재시도 타이머 5초 뒤가 아니라)

    expect(sent).toEqual(["U3", "U3 lesson"]);
    expect(store.pendingCount).toBe(0);
  });

  it("실패로 돌아온 초안은 flush가 즉시 되풀이하지 않는다(재시도는 종전대로 타이머 몫)", async () => {
    let calls = 0;
    const store = makeStore(async () => {
      calls += 1;
      return { ok: false as const, error: "네트워크 오류" };
    });
    store.edit("L1", "progress", "U3");
    await store.flush();
    expect(calls).toBe(1);
  });
});

describe("충돌 해소 — '내 값으로 덮기'도 편집이다", () => {
  it("mine을 고르면 이전 값 = 지금 서버에 있는 값으로 편집을 알린다", async () => {
    const store = makeStore(async (patches) => ({
      ok: true as const,
      results: patches.map((p) => ({
        saveKey: p.saveKey,
        status: "conflict" as const,
        serverValue: "남이 쓴 값",
        clientRev: p.clientRev,
      })),
    }));
    const onEdit = vi.fn();
    store.setCallbacks({ onEdit });
    store.edit("L1", "progress", "내 값");
    await vi.advanceTimersByTimeAsync(900); // 전송 → 충돌로 멈춤
    onEdit.mockClear();

    store.resolveConflict(buildSaveKey("L1", "progress"), "mine");
    expect(onEdit).toHaveBeenCalledWith("L1", "progress", "남이 쓴 값");

    // '서버값 사용'은 내가 바꾼 게 아니라 알리지 않는다.
    await vi.advanceTimersByTimeAsync(10);
    onEdit.mockClear();
    store.resolveConflict(buildSaveKey("L1", "progress"), "server");
    expect(onEdit).not.toHaveBeenCalled();
  });
});
