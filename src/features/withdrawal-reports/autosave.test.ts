import { describe, expect, it } from "vitest";
import { createReportSaver, REPORT_AUTOSAVE_NETWORK_ERROR, type ReportSaveResult, type ReportSaverStatus } from "./autosave";

/** 손으로 돌리는 타이머 + 손으로 끝내는 저장 — 동시 저장 순서를 그대로 재현한다. */
function harness(initialRevision = 1, maxRetries?: number) {
  const timers = new Map<number, () => void>();
  const delays: number[] = [];
  let seq = 0;
  const statuses: ReportSaverStatus[] = [];
  const calls: { revision: number; body: string; unconfirmed: readonly string[]; resolve: (r: ReportSaveResult) => void; reject: (e: unknown) => void }[] = [];
  const saver = createReportSaver<string>(initialRevision, {
    save: (revision, body, unconfirmed) => new Promise((resolve, reject) => { calls.push({ revision, body, unconfirmed, resolve, reject }); }),
    onStatus: (s) => statuses.push(s),
    now: () => 1000,
    maxRetries,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, fn); delays.push(ms); return id; },
    clearTimer: (h) => { timers.delete(h as number); },
  });
  const fire = () => { const all = [...timers.values()]; timers.clear(); all.forEach((fn) => fn()); };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { saver, calls, statuses, fire, tick, timers, delays, last: () => statuses.at(-1) };
}

describe("퇴원보고서 자동 저장기", () => {
  it("입력이 멎은 뒤 한 번만 — 마지막 글을 지금 revision으로 보낸다", async () => {
    const h = harness(3);
    h.saver.change("가"); h.saver.change("가나"); h.saver.change("가나다");
    expect(h.calls).toHaveLength(0);
    expect(h.last()).toEqual({ kind: "pending" });
    h.fire(); await h.tick();
    expect(h.calls.map((c) => [c.revision, c.body])).toEqual([[3, "가나다"]]);
    h.calls[0].resolve({ ok: true, revision: 4 }); await h.tick();
    expect(h.last()).toEqual({ kind: "saved", at: 1000 });
    expect(h.saver.revision()).toBe(4);
    expect(h.saver.isDirty()).toBe(false);
  });

  it("저장 중에 또 고치면 겹쳐 보내지 않고, 끝난 뒤 앞 요청이 돌려준 revision으로 보낸다", async () => {
    const h = harness(1);
    h.saver.change("A"); h.fire(); await h.tick();
    expect(h.calls).toHaveLength(1);
    h.saver.change("AB"); h.fire(); await h.tick();
    expect(h.calls).toHaveLength(1); // 앞 저장이 안 끝났다
    expect(h.saver.isDirty()).toBe(true);
    h.calls[0].resolve({ ok: true, revision: 2 }); await h.tick(); await h.tick();
    expect(h.calls.map((c) => [c.revision, c.body])).toEqual([[1, "A"], [2, "AB"]]);
    h.calls[1].resolve({ ok: true, revision: 3 }); await h.tick();
    expect(h.saver.revision()).toBe(3);
  });

  it("다른 화면이 먼저 고쳤으면(충돌) 멈추고 더는 보내지 않는다 — 안 간 글은 남겨 창 닫기 경고가 산다", async () => {
    const h = harness(5);
    h.saver.change("내 글"); h.fire(); await h.tick();
    h.calls[0].resolve({ ok: false, conflict: true, error: "보고서가 변경되었습니다." }); await h.tick();
    expect(h.last()).toEqual({ kind: "conflict" });
    expect(h.saver.isDirty()).toBe(true);
    h.saver.change("더 쓴 글"); h.fire(); await h.tick();
    expect(h.calls).toHaveLength(1);
    expect(h.saver.isDirty()).toBe(true);
    expect(await h.saver.settle()).toEqual({ ok: false, conflict: true, revision: 5, error: null });
  });

  it("네트워크 실패는 글을 버리지 않고 간격을 늘려 몇 번만 다시 보낸다(끝없이 두드리지 않는다)", async () => {
    const h = harness(1, 2);
    h.saver.change("첫 글"); h.fire(); await h.tick();
    h.calls[0].reject(new Error("offline")); await h.tick();
    expect(h.last()).toEqual({ kind: "error", message: REPORT_AUTOSAVE_NETWORK_ERROR, retrying: true });
    expect(h.timers.size).toBe(1);
    h.fire(); await h.tick();
    h.calls[1].reject(new Error("offline")); await h.tick();
    h.fire(); await h.tick();
    h.calls[2].reject(new Error("offline")); await h.tick();
    expect(h.calls.map((c) => c.body)).toEqual(["첫 글", "첫 글", "첫 글"]);
    expect(h.delays.slice(1)).toEqual([5000, 10000]); // 첫 값은 입력 대기(1200)
    expect(h.last()).toEqual({ kind: "error", message: REPORT_AUTOSAVE_NETWORK_ERROR, retrying: false });
    expect(h.timers.size).toBe(0);
    expect(h.saver.isDirty()).toBe(true);
    // 다음 입력이 다시 시도한다
    h.saver.change("첫 글 더"); h.fire(); await h.tick();
    h.calls[3].resolve({ ok: true, revision: 2 }); await h.tick();
    expect(h.last()).toEqual({ kind: "saved", at: 1000 });
  });

  it("다시 해도 안 될 실패(권한 · 검사)는 다시 보내지 않고 알린다", async () => {
    const h = harness(1);
    h.saver.change("글"); h.fire(); await h.tick();
    h.calls[0].resolve({ ok: false, conflict: false, error: "이 화면에서는 보고서를 수정할 수 없습니다." }); await h.tick();
    expect(h.last()).toEqual({ kind: "error", message: "이 화면에서는 보고서를 수정할 수 없습니다.", retrying: false });
    expect(h.timers.size).toBe(0);
    expect(h.saver.isDirty()).toBe(true);
  });

  it("settle — 기다리던 글을 바로 보내고 끝날 때까지 기다려 지금 revision을 돌려준다", async () => {
    const h = harness(7);
    h.saver.change("마지막 글");
    const settled = h.saver.settle();
    await h.tick();
    expect(h.timers.size).toBe(0);
    expect(h.calls.map((c) => [c.revision, c.body])).toEqual([[7, "마지막 글"]]);
    h.calls[0].resolve({ ok: true, revision: 8 });
    expect(await settled).toEqual({ ok: true, conflict: false, revision: 8, error: null });
  });

  it("settle — 충돌이 아닌 실패는 conflict:false(처리 요청이 본문을 함께 보내 서버가 다시 검사한다)", async () => {
    const h = harness(2);
    h.saver.change("글");
    const settled = h.saver.settle();
    await h.tick();
    h.calls[0].resolve({ ok: false, conflict: false, error: "퇴원사유와 미납 여부를 확인해 주세요." });
    expect(await settled).toEqual({ ok: false, conflict: false, revision: 2, error: "퇴원사유와 미납 여부를 확인해 주세요." });
    expect(h.last()).toEqual({ kind: "error", message: "퇴원사유와 미납 여부를 확인해 주세요.", retrying: false });
  });

  it("settle 중에 충돌하면 conflict:true — 화면은 그 값만 보고 멈춘다(렌더를 기다리지 않는다)", async () => {
    const h = harness(3);
    h.saver.change("글");
    const settled = h.saver.settle();
    await h.tick();
    h.calls[0].resolve({ ok: false, conflict: true, error: "보고서가 변경되었습니다." });
    expect(await settled).toEqual({ ok: false, conflict: true, revision: 3, error: null });
  });

  it("새로고침으로 받은 revision — 깨끗하면 받아들이고(화면이 본문을 다시 맞춘다), 안 간 글이 있으면 충돌로 멈춘다", async () => {
    const h = harness(1);
    expect(h.saver.syncServer(1)).toBe("ignored"); // 같은 값
    expect(h.saver.syncServer(4)).toBe("adopted");
    expect(h.saver.revision()).toBe(4);
    h.saver.change("글");
    expect(h.saver.syncServer(9)).toBe("conflict"); // 다른 화면이 앞섰는데 내 글이 남아 있다 — 덮지 않는다
    expect(h.last()).toEqual({ kind: "conflict" });
    expect(h.timers.size).toBe(0);
    h.fire(); await h.tick();
    expect(h.calls).toHaveLength(0);
    expect(h.saver.isDirty()).toBe(true);
  });

  it("보내는 중이거나 내 저장의 메아리면 무시한다(그 응답이 판정한다)", async () => {
    const h = harness(1);
    h.saver.change("A"); h.fire(); await h.tick();
    expect(h.saver.syncServer(2)).toBe("ignored"); // 보내는 중
    h.calls[0].resolve({ ok: true, revision: 2 }); await h.tick();
    expect(h.saver.syncServer(2)).toBe("ignored"); // 메아리
    expect(h.last()).toEqual({ kind: "saved", at: 1000 });
  });

  // 2026-11-05 재리뷰 A — 응답만 끊긴 저장(모바일): 결과를 모르는 글을 기억해 다음 저장에 함께 보낸다(서버가 '내 저장이 들어갔나' 판정).
  it("결과를 모르는 저장 뒤 이어 쓴 글은 그 글을 함께 보낸다 — 성공하면 잊는다", async () => {
    const h = harness(3);
    h.saver.change("A"); h.fire(); await h.tick();
    h.calls[0].reject(new Error("offline")); await h.tick();
    h.saver.change("AB"); h.fire(); await h.tick();
    expect(h.calls.map((c) => [c.revision, c.body, c.unconfirmed])).toEqual([[3, "A", []], [3, "AB", ["A"]]]);
    h.calls[1].resolve({ ok: true, revision: 5 }); await h.tick();
    h.saver.change("ABC"); h.fire(); await h.tick();
    expect(h.calls.map((c) => [c.revision, c.unconfirmed]).at(-1)).toEqual([5, []]);
  });

  it("결과를 모르는 저장이 있으면 새로고침 revision은 판정하지 않는다(ignored) — 재시도가 판정한다", async () => {
    const h = harness(3);
    h.saver.change("A"); h.fire(); await h.tick();
    h.calls[0].reject(new Error("offline")); await h.tick();
    expect(h.saver.syncServer(4)).toBe("ignored"); // 내 저장이 들어간 revision일 수 있다
    expect(h.last()).toEqual({ kind: "error", message: REPORT_AUTOSAVE_NETWORK_ERROR, retrying: true });
    h.fire(); await h.tick();
    expect(h.calls.map((c) => [c.revision, c.body, c.unconfirmed])).toEqual([[3, "A", []], [3, "A", ["A"]]]);
  });

  it("검사 거절(다시 해도 안 될 실패)은 안 들어간 게 확실해 기억하지 않는다 · 결과 모르는 글은 최근 3개만", async () => {
    const h = harness(1, 10);
    h.saver.change("가"); h.fire(); await h.tick();
    h.calls[0].resolve({ ok: false, conflict: false, error: "퇴원사유와 미납 여부를 확인해 주세요." }); await h.tick();
    h.saver.change("가나"); h.fire(); await h.tick();
    expect(h.calls[1].unconfirmed).toEqual([]);
    for (const text of ["1", "2", "3", "4"]) {
      h.calls.at(-1)!.resolve({ ok: false, conflict: false, error: "서버에서 오류가 났습니다.", retry: true }); await h.tick();
      h.saver.change(text); h.fire(); await h.tick();
    }
    expect(h.calls.map((c) => c.body)).toEqual(["가", "가나", "1", "2", "3", "4"]);
    expect(h.calls.at(-1)?.unconfirmed).toEqual(["1", "2", "3"]);
  });

  it("stop 뒤에는 아무것도 보내지 않고 깨끗하다", async () => {
    const h = harness(1);
    h.saver.change("글");
    h.saver.stop();
    h.fire(); await h.tick();
    expect(h.calls).toHaveLength(0);
    expect(h.saver.isDirty()).toBe(false);
    expect(h.saver.syncServer(5)).toBe("ignored");
  });
});
