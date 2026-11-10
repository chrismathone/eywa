import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionSaveQueue, type SessionSaveResult } from "./session-save-queue";

/** 손으로 끝내는 요청 — 응답 순서를 시험이 정한다. */
function deferred() {
  let resolve!: (v: SessionSaveResult) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<SessionSaveResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => vi.advanceTimersByTimeAsync(0);

describe("원스크린 세션 자동저장 줄 세우기(P1-O · B4)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const reqs: ReturnType<typeof deferred>[] = [];
    /** 보낼 때 읽은 기준 시각 — 응답이 적용되면 바뀐다. */
    let base = "t0";
    const sentBases: string[] = [];
    const applied: SessionSaveResult[] = [];
    const gaveUp: string[] = [];
    const q = createSessionSaveQueue({
      send: () => {
        sentBases.push(base);
        const d = deferred();
        reqs.push(d);
        return d.promise;
      },
      apply: (_id, res) => {
        applied.push(res);
        if (res.updatedAt) base = res.updatedAt;
      },
      onGiveUp: (id) => gaveUp.push(id),
    });
    return { q, reqs, sentBases, applied, gaveUp };
  }

  it("디바운스 — 마지막 편집 800ms 뒤 한 번", async () => {
    const { q, reqs } = setup();
    q.queue("s1", 800);
    await vi.advanceTimersByTimeAsync(500);
    q.queue("s1", 800);
    await vi.advanceTimersByTimeAsync(799);
    expect(reqs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(reqs).toHaveLength(1);
  });

  it("🔴 같은 학생 요청이 나가 있으면 겹쳐 보내지 않고, 응답 적용 뒤 새 기준 시각으로 한 번 더 보낸다(응답 역전 없음)", async () => {
    const { q, reqs, sentBases } = setup();
    q.queue("s1", 800);
    await vi.advanceTimersByTimeAsync(800);
    q.queue("s1", 800);
    await vi.advanceTimersByTimeAsync(800);
    q.flush();
    expect(reqs).toHaveLength(1); // 둘째는 줄을 선다
    reqs[0]!.resolve({ ok: true, updatedAt: "t1" });
    await tick();
    expect(reqs).toHaveLength(2);
    expect(sentBases).toEqual(["t0", "t1"]);
  });

  it("🔴 던진 실패(네트워크)는 2초·5초 뒤 다시 보내고, 다 쓰면 한 번 알린다", async () => {
    const { q, reqs, gaveUp } = setup();
    q.queue("s1", 800);
    await vi.advanceTimersByTimeAsync(800);
    reqs[0]!.reject(new Error("network"));
    await tick();
    expect(q.pending("s1")).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(reqs).toHaveLength(2);
    reqs[1]!.reject(new Error("network"));
    await tick();
    await vi.advanceTimersByTimeAsync(5000);
    expect(reqs).toHaveLength(3);
    expect(gaveUp).toEqual([]);
    reqs[2]!.reject(new Error("network"));
    await tick();
    expect(gaveUp).toEqual(["s1"]);
    expect(q.pending("s1")).toBe(false);
  });

  it("재시도 대기 중 새 편집이 오면 그 디바운스가 대신한다(재시도를 겹쳐 보내지 않는다)", async () => {
    const { q, reqs } = setup();
    q.queue("s1", 800);
    await vi.advanceTimersByTimeAsync(800);
    reqs[0]!.reject(new Error("network"));
    await tick();
    q.queue("s1", 800);
    await vi.advanceTimersByTimeAsync(800);
    expect(reqs).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(reqs).toHaveLength(2);
  });

  it("서버 거절({ ok:false })은 다시 보내지 않고 apply로 넘긴다(화면이 사유를 알린다)", async () => {
    const { q, reqs, applied, gaveUp } = setup();
    q.queue("s1", 800);
    await vi.advanceTimersByTimeAsync(800);
    reqs[0]!.resolve({ ok: false, error: "담당 학생이 아닙니다" });
    await tick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reqs).toHaveLength(1);
    expect(applied).toEqual([{ ok: false, error: "담당 학생이 아닙니다" }]);
    expect(gaveUp).toEqual([]);
  });

  it("flush는 대기 중인 학생을 모두 지금 보낸다 · 학생끼리는 막지 않는다", async () => {
    const { q, reqs } = setup();
    q.queue("s1", 800);
    q.queue("s2", 800);
    q.flush();
    expect(reqs).toHaveLength(2);
  });

  it("🔴 진행 중 + 한 번 더 표시 상태에서 정리(날짜 이동)돼도 응답 뒤 마지막 편집을 보낸다", async () => {
    const { q, reqs, sentBases } = setup();
    q.queue("s1", 800);
    await vi.advanceTimersByTimeAsync(800);
    q.queue("s1", 800);
    q.flush(); // 진행 중이라 '한 번 더'만
    q.dispose();
    reqs[0]!.resolve({ ok: true, updatedAt: "t1" });
    await tick();
    expect(reqs).toHaveLength(2);
    expect(sentBases).toEqual(["t0", "t1"]);
  });

  it("정리 뒤 던진 실패는 재시도 없이 바로 알린다", async () => {
    const { q, reqs, gaveUp } = setup();
    q.queue("s1", 800);
    await vi.advanceTimersByTimeAsync(800);
    q.dispose();
    reqs[0]!.reject(new Error("network"));
    await tick();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reqs).toHaveLength(1);
    expect(gaveUp).toEqual(["s1"]);
  });

  it("결과 적용이 던져도 '한 번 더' 재전송은 실행된다", async () => {
    const reqs: ReturnType<typeof deferred>[] = [];
    const q = createSessionSaveQueue({
      send: () => {
        const d = deferred();
        reqs.push(d);
        return d.promise;
      },
      apply: () => {
        throw new Error("apply failed");
      },
      onGiveUp: () => {},
    });
    const swallow = (e: unknown) => e; // 적용 예외는 then 밖으로 나간다(처리 안 된 거부) — 시험에서는 삼킨다
    process.on("unhandledRejection", swallow);
    try {
      q.queue("s1", 800);
      await vi.advanceTimersByTimeAsync(800);
      q.queue("s1", 800);
      q.flush();
      reqs[0]!.resolve({ ok: true, updatedAt: "t1" });
      await tick();
      expect(reqs).toHaveLength(2);
    } finally {
      process.off("unhandledRejection", swallow);
    }
  });

  it("dispose 뒤엔 타이머도 재시도도 없다", async () => {
    const { q, reqs } = setup();
    q.queue("s1", 800);
    q.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reqs).toHaveLength(0);
  });
});
