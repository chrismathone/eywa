import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemandTracker } from "./connection-demand";

const LINGER = 10_000;

function setup() {
  const onChange = vi.fn<(needed: boolean) => void>();
  const t = createDemandTracker({ onChange, lingerMs: LINGER });
  return { onChange, t };
}

describe("createDemandTracker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("첫 retain에서만 연결을 요청한다(0→1)", () => {
    const { onChange, t } = setup();
    t.retain();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);

    t.retain();
    t.retain();
    // 이미 열려 있으면 다시 열라고 하지 않는다.
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(t.count()).toBe(3);
  });

  it("마지막 release 후에도 lingerMs 동안은 연결을 유지한다", () => {
    const { onChange, t } = setup();
    t.retain();
    onChange.mockClear();

    t.release();
    expect(onChange).not.toHaveBeenCalled(); // 즉시 끊지 않는다

    vi.advanceTimersByTime(LINGER - 1);
    expect(onChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("유예 중 다시 retain하면 끊지 않고 재핸드셰이크도 없다", () => {
    const { onChange, t } = setup();
    t.retain();
    t.release();
    onChange.mockClear();

    vi.advanceTimersByTime(LINGER / 2);
    t.retain(); // 편집 토글로 곧바로 되돌아온 경우

    vi.advanceTimersByTime(LINGER * 2);
    // 끊김(false)도, 재연결(true)도 없어야 한다 — 열린 채널을 그대로 승계.
    expect(onChange).not.toHaveBeenCalled();
    expect(t.count()).toBe(1);
  });

  it("참조가 남아 있으면 release해도 유예 타이머를 걸지 않는다", () => {
    const { onChange, t } = setup();
    t.retain();
    t.retain();
    onChange.mockClear();

    t.release();
    vi.advanceTimersByTime(LINGER * 2);
    expect(onChange).not.toHaveBeenCalled();
    expect(t.count()).toBe(1);
  });

  it("release가 retain보다 많이 불려도 음수로 내려가지 않는다(중복 cleanup 방어)", () => {
    const { onChange, t } = setup();
    t.retain();
    onChange.mockClear();

    t.release();
    t.release();
    t.release();
    expect(t.count()).toBe(0);

    vi.advanceTimersByTime(LINGER);
    // 끊기 통지는 한 번만.
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false);

    // 이후 retain은 정상적으로 다시 연결을 요청한다.
    onChange.mockClear();
    t.retain();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("dispose는 대기 중인 유예 타이머를 발화시키지 않는다(언마운트)", () => {
    const { onChange, t } = setup();
    t.retain();
    t.release();
    onChange.mockClear();

    t.dispose();
    vi.advanceTimersByTime(LINGER * 2);
    expect(onChange).not.toHaveBeenCalled();
    expect(t.count()).toBe(0);
  });
});
