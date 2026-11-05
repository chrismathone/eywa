import { describe, expect, it } from "vitest";
import { createReportSaver, REPORT_AUTOSAVE_NETWORK_ERROR, type ReportSaveResult, type ReportSaverStatus } from "./autosave";

/** 손으로 돌리는 타이머 + 손으로 끝내는 저장 — 동시 저장 순서를 그대로 재현한다. */
function harness(initialRevision = 1) {
  const timers = new Map<number, () => void>();
  let seq = 0;
  const statuses: ReportSaverStatus[] = [];
  const calls: { revision: number; body: string; resolve: (r: ReportSaveResult) => void; reject: (e: unknown) => void }[] = [];
  const saver = createReportSaver<string>(initialRevision, {
    save: (revision, body) => new Promise((resolve, reject) => { calls.push({ revision, body, resolve, reject }); }),
    onStatus: (s) => statuses.push(s),
    now: () => 1000,
    setTimer: (fn) => { const id = ++seq; timers.set(id, fn); return id; },
    clearTimer: (h) => { timers.delete(h as number); },
  });
  const fire = () => { const all = [...timers.values()]; timers.clear(); all.forEach((fn) => fn()); };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { saver, calls, statuses, fire, tick, timers, last: () => statuses.at(-1) };
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

  it("다른 화면이 먼저 고쳤으면(충돌) 멈추고 더는 보내지 않는다", async () => {
    const h = harness(5);
    h.saver.change("내 글"); h.fire(); await h.tick();
    h.calls[0].resolve({ ok: false, conflict: true, error: "보고서가 변경되었습니다." }); await h.tick();
    expect(h.last()).toEqual({ kind: "conflict" });
    h.saver.change("더 쓴 글"); h.fire(); await h.tick();
    expect(h.calls).toHaveLength(1);
    expect(await h.saver.settle()).toEqual({ ok: false, revision: 5 });
  });

  it("실패하면 글을 버리지 않고 다시 보낸다(재시도 타이머 · 새 입력이 오면 새 글)", async () => {
    const h = harness(1);
    h.saver.change("첫 글"); h.fire(); await h.tick();
    h.calls[0].reject(new Error("offline")); await h.tick();
    expect(h.last()).toEqual({ kind: "error", message: REPORT_AUTOSAVE_NETWORK_ERROR });
    expect(h.timers.size).toBe(1); // 재시도 예약
    h.fire(); await h.tick();
    expect(h.calls.map((c) => c.body)).toEqual(["첫 글", "첫 글"]);
    h.calls[1].resolve({ ok: true, revision: 2 }); await h.tick();
    expect(h.last()).toEqual({ kind: "saved", at: 1000 });
  });

  it("settle — 기다리던 글을 바로 보내고 끝날 때까지 기다려 지금 revision을 돌려준다", async () => {
    const h = harness(7);
    h.saver.change("마지막 글");
    const settled = h.saver.settle();
    await h.tick();
    expect(h.timers.size).toBe(0);
    expect(h.calls.map((c) => [c.revision, c.body])).toEqual([[7, "마지막 글"]]);
    h.calls[0].resolve({ ok: true, revision: 8 });
    expect(await settled).toEqual({ ok: true, revision: 8 });
  });

  it("settle — 저장이 실패하면 ok:false(제출하지 않는다)", async () => {
    const h = harness(2);
    h.saver.change("글");
    const settled = h.saver.settle();
    await h.tick();
    h.calls[0].resolve({ ok: false, conflict: false, error: "퇴원사유와 미납 여부를 확인해 주세요." });
    expect(await settled).toEqual({ ok: false, revision: 2 });
    expect(h.last()).toEqual({ kind: "error", message: "퇴원사유와 미납 여부를 확인해 주세요." });
  });

  it("보낼 글이 없을 때만 바깥 revision을 받아들이고, stop 뒤에는 아무것도 보내지 않는다", async () => {
    const h = harness(1);
    h.saver.adoptRevision(4);
    expect(h.saver.revision()).toBe(4);
    h.saver.change("글");
    h.saver.adoptRevision(9); // 보낼 글이 있으면 무시
    expect(h.saver.revision()).toBe(4);
    h.saver.stop();
    h.fire(); await h.tick();
    expect(h.calls).toHaveLength(0);
    expect(h.saver.isDirty()).toBe(false);
  });
});
