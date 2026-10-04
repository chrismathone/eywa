import { afterEach, describe, expect, it } from "vitest";
import { coolVideoAccount, pickVideoJob, resetVideoJobPick } from "./video-job-pick.mjs";

afterEach(() => resetVideoJobPick());

const auth = { kind: "tenant-oauth", connectionId: "a", tokenVersion: 1, accessToken: async () => "t" };
function hooks(extra) {
  const calls = [];
  return {
    calls,
    resolve: (job) => job.decision,
    owned: async () => true,
    auth: async () => auth,
    paused: async () => false,
    claim: async (job) => job,
    fail: async (job) => { calls.push(["fail", job.id]); },
    requeue: async (job) => { calls.push(["requeue", job.id]); },
    defer: async (job) => { calls.push(["defer", job.id]); },
    ...extra,
  };
}

describe("계정별 작업 선택", () => {
  it("멈춘 옛 계정의 새 작업 때문에 다른 계정을 집지 못하지 않는다", async () => {
    const paused = { id: "old", decision: { kind: "active", rootId: "rootOld1234567", connectionId: "old-account", invalid: false } };
    const ready = { id: "next", decision: { kind: "active", rootId: "rootNew1234567", connectionId: "new-account", invalid: false } };
    const used = hooks({
      paused: async (_auth, decision) => decision.connectionId === "old-account",
      claim: async (job) => (job.id === "next" ? job : null),
    });
    const picked = await pickVideoJob([paused, ready], used);
    expect(picked.job.id).toBe("next");
    expect(used.calls).toEqual([["defer", "old"]]);
    expect(used.calls.some((call) => call[0] === "fail")).toBe(false);
  });

  it("다른 일이 없으면 멈춘 계정의 이미 찍힌 작업은 끝낸다", async () => {
    const pinned = { id: "pinned", decision: { kind: "pinned", rootId: "rootOld1234567", connectionId: "old-account", invalid: false } };
    const picked = await pickVideoJob([pinned], hooks({ paused: async () => true }));
    expect(picked.job.id).toBe("pinned");
  });

  it("계정이 맞지 않으면 그 작업만 실패로 두고 다음 작업을 집는다", async () => {
    const bad = { id: "bad", decision: { kind: "pinned", rootId: "rootBad1234567", connectionId: "bad-account", invalid: false } };
    const good = { id: "good", decision: { kind: "pinned", rootId: "rootOk12345678", connectionId: null, invalid: false } };
    const used = hooks({ owned: async (decision) => decision.connectionId == null });
    const picked = await pickVideoJob([bad, good], used);
    expect(picked.job.id).toBe("good");
    expect(picked.mismatched).toBe(true);
    expect(used.calls).toEqual([["fail", "bad"]]);
  });

  it("재연결이 필요한 계정은 실패로 두지 않고 뒤로 민다", async () => {
    const blocked = { id: "reauth", decision: { kind: "active", rootId: "rootOld1234567", connectionId: "old-account", invalid: false } };
    const open = { id: "open", decision: { kind: "active", rootId: "rootNew1234567", connectionId: null, invalid: false } };
    const used = hooks({ auth: async (decision) => {
      if (decision.connectionId) { const error = new Error("다시 연결"); error.code = "reauth"; throw error; }
      return auth;
    } });
    const picked = await pickVideoJob([blocked, open], used);
    expect(picked.job.id).toBe("open");
    expect(used.calls).toEqual([["defer", "reauth"]]);
  });

  it("선점이 비면 다음 작업을 집는다", async () => {
    const first = { id: "a", decision: { kind: "active", rootId: "rootA123456789", connectionId: null, invalid: false } };
    const second = { id: "b", decision: { kind: "active", rootId: "rootB123456789", connectionId: "new-account", invalid: false } };
    const used = hooks({ claim: async (job) => (job.id === "b" ? job : null) });
    const picked = await pickVideoJob([first, second], used);
    expect(picked.job.id).toBe("b");
  });

  it("식은 계정이 앞 8칸을 채워도 다음 조회에서 다른 계정을 집는다", async () => {
    const blocked = Array.from({ length: 9 }, (_, index) => ({
      id: `b${index}`,
      status: "queued",
      decision: { kind: "active", rootId: "rootBlocked1234", connectionId: "old-account", invalid: false },
    }));
    const healthy = { id: "ok", status: "queued", decision: { kind: "active", rootId: "rootHealthy1234", connectionId: "new-account", invalid: false } };
    const used = hooks({ paused: async (_auth, decision) => decision.connectionId === "old-account" });
    const first = await pickVideoJob([...blocked, healthy], used);
    expect(first.job).toBeNull();
    expect(used.calls.filter((call) => call[0] === "defer").map((call) => call[1])).toEqual(["b0", "b1", "b2", "b3", "b4", "b5", "b6", "b7"]);
    const later = hooks({ paused: async () => false });
    coolVideoAccount("old-account");
    const second = await pickVideoJob([blocked[8], healthy], later);
    expect(second.job.id).toBe("ok");
    expect(later.calls).toEqual([["defer", "b8"]]);
  });

  it("용량으로 식은 새 작업이 같은 계정의 찍힌 작업을 막지 않는다", async () => {
    const fresh = { id: "fresh", decision: { kind: "active", rootId: "rootOld1234567", connectionId: "old-account", invalid: false } };
    const pinned = { id: "pinned", decision: { kind: "pinned", rootId: "rootOld1234567", connectionId: "old-account", invalid: false } };
    let now = 1_000_000;
    const first = hooks({ paused: async () => true, now: () => now });
    expect((await pickVideoJob([fresh, pinned], first)).job.id).toBe("pinned");
    expect(first.calls).toEqual([["defer", "fresh"]]);
    const during = hooks({ paused: async () => true, now: () => now });
    expect((await pickVideoJob([fresh, pinned], during)).job.id).toBe("pinned");
    expect(during.calls).toEqual([["defer", "fresh"]]);
    now += 5 * 60_000;
    const later = hooks({ paused: async () => true, now: () => now });
    expect((await pickVideoJob([fresh, pinned], later)).job.id).toBe("pinned");
    expect(later.calls).toEqual([["defer", "fresh"]]);
  });

  it("인증으로 식은 계정은 찍힌 작업도 바로 집지 않는다", async () => {
    const fresh = { id: "fresh", decision: { kind: "active", rootId: "rootOld1234567", connectionId: "old-account", invalid: false } };
    const pinned = { id: "pinned", decision: { kind: "pinned", rootId: "rootOld1234567", connectionId: "old-account", invalid: false } };
    const used = hooks({ auth: async () => { const error = new Error("다시 연결"); error.code = "reauth"; throw error; } });
    expect((await pickVideoJob([fresh, pinned], used)).job).toBeNull();
    expect(used.calls).toEqual([["defer", "fresh"], ["defer", "pinned"]]);
    const later = hooks();
    expect((await pickVideoJob([pinned], later)).job).toBeNull();
    expect(later.calls).toEqual([["defer", "pinned"]]);
  });

  it("소유 확인이 일시 오류면 찍힌 작업을 다시 줄에 넣는다", async () => {
    const pinned = { id: "pinned", decision: { kind: "pinned", rootId: "rootOld1234567", connectionId: "old-account", invalid: false } };
    const used = hooks({ owned: async () => { throw new Error("영상 저장 폴더 설정을 확인하지 못했습니다."); } });
    expect((await pickVideoJob([pinned], used)).job).toBeNull();
    expect(used.calls).toEqual([["requeue", "pinned"]]);
  });
});
