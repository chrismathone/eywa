import { describe, expect, it } from "vitest";
import {
  KEEPALIVE_EXPIRE_MS,
  KEEPALIVE_MAX,
  KEEPALIVE_REFRESH_AFTER_MS,
  KEEPALIVE_TOUCH_MS,
  needsModeReset,
  planKeepalive,
  type KeepaliveView,
} from "./keepalive-rules";
import { STALE_AFTER_MS } from "./window-signals-core";

const T0 = 1_000_000_000_000;
const MIN = 60_000;

type W = Record<string, { minimized: boolean }>;
function view(over: Partial<KeepaliveView> & { windows: W }): KeepaliveView {
  return {
    focusedId: null,
    cached: [],
    dirty: {},
    busy: {},
    lastUsed: {},
    spotlight: false,
    prevVisible: null,
    back: null,
    ...over,
  };
}
const ids = (n: number, minimized = true): W =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`w${i}`, { minimized }]));

describe("상수(원장 지시 2026-10-01)", () => {
  it("유지 5개 · 2시간 · 10분", () => {
    expect(KEEPALIVE_MAX).toBe(5);
    expect(KEEPALIVE_EXPIRE_MS).toBe(2 * 60 * MIN);
    expect(KEEPALIVE_REFRESH_AFTER_MS).toBe(10 * MIN);
  });

  it("10분 새로고침은 기존 '다시 보일 때 새로고침' 장치(STALE_AFTER_MS)와 같은 값이다 — 따로 두 번 정하지 않는다", () => {
    expect(KEEPALIVE_REFRESH_AFTER_MS).toBe(STALE_AFTER_MS);
  });
});

describe("방식이 바뀌면 영속본을 비운다 (needsModeReset)", () => {
  const P = (mode: "windows" | "keepalive" | "single" | null, epoch: string | null = "e1") => ({ mode, epoch });
  const C = (mode: "windows" | "keepalive" | "single", epoch: string | null = "e1") => ({ mode, epoch });

  it("같은 방식·같은 판은 그대로 복원한다", () => {
    expect(needsModeReset(P("windows"), C("windows"))).toBe(false);
    expect(needsModeReset(P("keepalive"), C("keepalive"))).toBe(false);
    expect(needsModeReset(P("single"), C("single"))).toBe(false);
  });

  it("어느 방향이든 방식이 다르면 초기화", () => {
    const all = ["windows", "keepalive", "single"] as const;
    for (const a of all) for (const b of all) expect(needsModeReset(P(a), C(b))).toBe(a !== b);
  });

  it("🔴 방식이 같아도 판이 다르면 초기화 — 창 모드 → 단일 화면 → 창 모드로 되돌린 사이 접속하지 않은 사람의 옛 창이 살아나지 않게", () => {
    expect(needsModeReset(P("windows", "2026-10-01T01:00:00+00:00"), C("windows", "2026-10-01T03:00:00+00:00"))).toBe(true);
    expect(needsModeReset(P("keepalive", "none"), C("keepalive", "2026-10-01T03:00:00+00:00"))).toBe(true);
  });

  it("방식 표식이 없는 옛 영속본 = 창 모드이고 판은 안 본다 — 배포 날 창 모드 지점의 새로고침 복원이 안 깨진다", () => {
    expect(needsModeReset(P(null, null), C("windows", "2026-09-25T00:00:00+00:00"))).toBe(false);
    expect(needsModeReset({ mode: undefined, epoch: undefined }, C("windows"))).toBe(false);
    expect(needsModeReset(P(null, null), C("keepalive"))).toBe(true);
    expect(needsModeReset(P(null, null), C("single"))).toBe(true);
  });

  it("🔴 모르는 판(조회 실패 = null)으로는 초기화하지 않는다", () => {
    expect(needsModeReset(P("keepalive", "e1"), C("keepalive", null))).toBe(false);
    expect(needsModeReset(P("keepalive", null), C("keepalive", "e2"))).toBe(false);
  });
});

describe("planKeepalive — 한 화면만 보인다", () => {
  it("포커스된 화면만 보이고 나머지는 숨는다", () => {
    const p = planKeepalive(
      view({ windows: { a: { minimized: false }, b: { minimized: false }, c: { minimized: true } }, focusedId: "b" }),
      T0,
    );
    expect(p.visible).toBe("b");
    expect(p.hide).toEqual(["a"]); // c는 이미 숨음
    expect(p.show).toBeNull();
    expect(p.changed).toBe(true);
  });

  it("포커스된 화면이 숨어 있으면 보이게 한다(닫힌 위 화면 뒤의 이전 화면으로 돌아오는 경로)", () => {
    const p = planKeepalive(view({ windows: { a: { minimized: true }, b: { minimized: true } }, focusedId: "a" }), T0);
    expect(p.show).toBe("a");
  });

  it("포커스가 없으면(첫 화면) 전부 숨긴다", () => {
    const p = planKeepalive(view({ windows: { a: { minimized: false }, b: { minimized: true } }, focusedId: null }), T0);
    expect(p.visible).toBeNull();
    expect(p.hide).toEqual(["a"]);
  });

  it("앨범(스포트라이트)은 이 방식에 없다 — 켜져 있으면 끈다", () => {
    const p = planKeepalive(
      view({ windows: { a: { minimized: false } }, focusedId: "a", spotlight: true, lastUsed: { a: T0 }, prevVisible: "a" }),
      T0,
    );
    expect(p.spotlightOff).toBe(true);
  });

  it("바뀔 게 없으면 changed=false (멱등 — 구독 루프가 끝난다)", () => {
    const p = planKeepalive(
      view({
        windows: { a: { minimized: false }, b: { minimized: true } },
        focusedId: "a",
        lastUsed: { a: T0, b: T0 - MIN },
        prevVisible: "a",
      }),
      T0 + 1000,
    );
    expect(p.changed).toBe(false);
  });
});

describe("planKeepalive — 개수 상한(최근 5개)", () => {
  it("5개까지는 안 버린다", () => {
    const lastUsed = Object.fromEntries(Object.keys(ids(5)).map((k, i) => [k, T0 - i * MIN]));
    const p = planKeepalive(view({ windows: ids(5), focusedId: null, lastUsed }), T0);
    expect(p.discard).toEqual([]);
  });

  it("6번째가 열리면 가장 오래 안 쓴 숨은 화면부터 버린다(보이는 것은 안 버림)", () => {
    const windows = { ...ids(5), w5: { minimized: false } };
    // w0이 가장 오래, w3이 가장 최근. w5가 방금 열려 보이는 화면.
    const lastUsed = { w0: T0 - 50 * MIN, w1: T0 - 40 * MIN, w2: T0 - 30 * MIN, w3: T0 - 5 * MIN, w4: T0 - 20 * MIN };
    const p = planKeepalive(view({ windows, focusedId: "w5", lastUsed, prevVisible: "w3" }), T0);
    expect(p.discard).toEqual(["w0"]);
    expect(p.visible).toBe("w5");
  });

  it("한꺼번에 넘쳐도 상한까지 — 오래된 순", () => {
    const windows = { ...ids(7) };
    const lastUsed = Object.fromEntries(Object.keys(windows).map((k, i) => [k, T0 - (10 - i) * MIN]));
    const p = planKeepalive(view({ windows, focusedId: "w6", lastUsed, prevVisible: "w6" }), T0);
    expect(p.discard).toEqual(["w0", "w1"]);
  });

  it("🔴 입력 중(미저장)·작업 중(녹음) 화면은 가장 오래됐어도 말없이 버리지 않는다 — 건너뛰고 다음 후보를 버린다", () => {
    const windows = { ...ids(5), w5: { minimized: false } };
    const lastUsed = { w0: T0 - 90 * MIN, w1: T0 - 80 * MIN, w2: T0 - 30 * MIN, w3: T0 - 20 * MIN, w4: T0 - 10 * MIN };
    const p = planKeepalive(
      view({ windows, focusedId: "w5", lastUsed, prevVisible: "w5", dirty: { w0: true }, busy: { w1: true } }),
      T0,
    );
    expect(p.discard).toEqual(["w2"]);
  });

  it("전부 보호 대상이면 상한을 넘어도 열려 있는다(버리지 않는다)", () => {
    const windows = { ...ids(6) };
    const dirty = Object.fromEntries(Object.keys(windows).map((k) => [k, true]));
    const lastUsed = Object.fromEntries(Object.keys(windows).map((k) => [k, T0]));
    const p = planKeepalive(view({ windows, focusedId: null, dirty, lastUsed }), T0);
    expect(p.discard).toEqual([]);
  });
});

describe("planKeepalive — 사용 없이 2시간이면 기억에서 지운다", () => {
  it("숨은 화면은 마지막 사용 후 2시간이 지나면 버리고, 안 지났으면 둔다", () => {
    const lastUsed = { old: T0 - KEEPALIVE_EXPIRE_MS - 1, fresh: T0 - KEEPALIVE_EXPIRE_MS + MIN };
    const p = planKeepalive(view({ windows: { old: { minimized: true }, fresh: { minimized: true } }, lastUsed }), T0);
    expect(p.discard).toEqual(["old"]);
  });

  it("정확히 2시간은 아직이다(넘어야 지운다)", () => {
    const p = planKeepalive(view({ windows: { a: { minimized: true } }, lastUsed: { a: T0 - KEEPALIVE_EXPIRE_MS } }), T0);
    expect(p.discard).toEqual([]);
  });

  it("🔴 입력 중·작업 중 화면은 2시간이 지나도 말없이 지우지 않는다", () => {
    const old = T0 - 5 * 60 * MIN;
    const p = planKeepalive(
      view({ windows: ids(3), lastUsed: { w0: old, w1: old, w2: old }, dirty: { w0: true }, busy: { w1: true } }),
      T0,
    );
    expect(p.discard).toEqual(["w2"]);
  });

  it("보이는 화면은 쓰는 중이라 평소엔 안 지운다 — 시작할 때(복원 직후)만 같은 기준을 적용한다", () => {
    const base = view({
      windows: { a: { minimized: false } },
      focusedId: "a",
      lastUsed: { a: T0 - 3 * 60 * MIN },
      prevVisible: "a",
    });
    expect(planKeepalive(base, T0).discard).toEqual([]);
    const boot = planKeepalive(base, T0, { expireVisible: true });
    expect(boot.discard).toEqual(["a"]);
    expect(boot.focus).toBeNull(); // 보이던 화면이 지워지면 첫 화면으로
    expect(boot.visible).toBeNull();
  });

  it("사용 시각이 아직 없는 화면은 지우지 않는다(처음 도장을 찍는다)", () => {
    const p = planKeepalive(
      view({ windows: { a: { minimized: false } }, focusedId: "a", lastUsed: {}, prevVisible: "a" }),
      T0,
    );
    expect(p.discard).toEqual([]);
    expect(p.lastUsed.a).toBe(T0);
  });

  it("도장이 없는 **숨은** 화면도 지금부터 센다 — 없는 채로 두면 영영 만료되지 않는다(방식 전환 때 남긴 입력 중 화면 등)", () => {
    const p = planKeepalive(view({ windows: { a: { minimized: false }, b: { minimized: true } }, focusedId: "a", lastUsed: { a: T0 }, prevVisible: "a" }), T0 + MIN);
    expect(p.lastUsed.b).toBe(T0 + MIN);
    const later = planKeepalive(
      view({ windows: { a: { minimized: false }, b: { minimized: true } }, focusedId: "a", lastUsed: p.lastUsed, prevVisible: "a" }),
      T0 + MIN + KEEPALIVE_EXPIRE_MS + 1,
    );
    expect(later.discard).toEqual(["b"]);
  });

  it("닫혀 보관된(cached) 화면은 이 방식에서 잊는다", () => {
    const p = planKeepalive(
      view({ windows: { a: { minimized: true }, b: { minimized: true } }, cached: ["b"], lastUsed: { a: T0, b: T0 } }),
      T0,
    );
    expect(p.discard).toEqual(["b"]);
  });
});

describe("planKeepalive — 사용 시각 도장", () => {
  it("보이는 화면이 바뀌면 새 화면과 떠난 화면 모두 지금으로 찍는다", () => {
    const p = planKeepalive(
      view({
        windows: { a: { minimized: true }, b: { minimized: false } },
        focusedId: "b",
        prevVisible: "a",
        lastUsed: { a: T0 - 30 * MIN, b: T0 - 60 * MIN },
      }),
      T0,
    );
    expect(p.lastUsed).toEqual({ a: T0, b: T0 });
  });

  it("같은 화면을 쓰는 동안은 사용이 확인될 때만(간격 제한) 찍는다 — 가만히 있는 사람의 화면이 영영 안 만료되는 일이 없게", () => {
    const base = view({ windows: { a: { minimized: false } }, focusedId: "a", prevVisible: "a", lastUsed: { a: T0 } });
    expect(planKeepalive(base, T0 + KEEPALIVE_TOUCH_MS + 1).lastUsed.a).toBe(T0); // 사용 신호 없음 = 그대로
    expect(planKeepalive(base, T0 + KEEPALIVE_TOUCH_MS - 1, { touch: "a" }).lastUsed.a).toBe(T0); // 간격 안
    const t = T0 + KEEPALIVE_TOUCH_MS + 1;
    expect(planKeepalive(base, t, { touch: "a" }).lastUsed.a).toBe(t);
  });

  it("사라진 화면의 도장은 정리한다", () => {
    const p = planKeepalive(view({ windows: { a: { minimized: true } }, lastUsed: { a: T0, ghost: T0 } }), T0);
    expect(Object.keys(p.lastUsed)).toEqual(["a"]);
  });
});

describe("planKeepalive — 보이던 화면이 닫히면 열기 전에 보이던 화면으로", () => {
  it("창 엔진이 고른 '다음 창'(숨은 화면)이 아니라 열기 전에 보이던 화면으로 돌아간다", () => {
    // N(생성폼)이 닫혔다 — 포커스는 엔진이 순서상 마지막인 a에 줬지만, 열기 전에 보던 화면은 b였다.
    const p = planKeepalive(
      view({
        windows: { a: { minimized: true }, b: { minimized: true } },
        focusedId: "a",
        prevVisible: "n",
        back: "b",
        lastUsed: { a: T0, b: T0 },
      }),
      T0,
    );
    expect(p.focus).toBe("b");
    expect(p.visible).toBe("b");
    expect(p.show).toBe("b");
    expect(p.back).toBeNull();
  });

  it("🔴 '오늘'(첫 화면)에서 연 화면을 닫으면 첫 화면으로 — 예전에 떠난 화면이 튀어나오지 않는다", () => {
    const p = planKeepalive(
      view({ windows: { a: { minimized: true } }, focusedId: "a", prevVisible: "n", back: null, lastUsed: { a: T0 } }),
      T0,
    );
    expect(p.focus).toBeNull();
    expect(p.visible).toBeNull();
    expect(p.show).toBeNull();
  });

  it("🔴 오래 띄워 둔 화면에서 다른 화면을 열면 — 떠난 화면은 '지금 쓴 것'이라 안 버려지고, 방금 연 화면이 그대로 보인다(재리뷰 회귀)", () => {
    const p = planKeepalive(
      view({
        windows: { a: { minimized: false }, b: { minimized: false } },
        focusedId: "b", // 방금 연 화면
        lastUsed: { a: T0 - 3 * KEEPALIVE_EXPIRE_MS }, // a는 3시간 클릭 없이 보이고 있었다
        prevVisible: "a",
        back: null,
      }),
      T0,
    );
    expect(p.discard).toEqual([]);
    expect(p.focus).toBeUndefined();
    expect(p.visible).toBe("b");
    expect(p.hide).toEqual(["a"]);
    expect(p.lastUsed.a).toBe(T0); // 숨는 순간이 마지막 사용 — 2시간은 여기서부터
  });

  it("🔴 6번째를 열 때도 막 떠난 화면은 상한 정리의 첫 후보가 아니다", () => {
    const windows = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((k) => [k, { minimized: k !== "f" && k !== "a" }]));
    const p = planKeepalive(
      view({
        windows,
        focusedId: "f",
        lastUsed: { a: T0 - 100 * MIN, b: T0 - 10 * MIN, c: T0 - 9 * MIN, d: T0 - 8 * MIN, e: T0 - 7 * MIN },
        prevVisible: "a",
      }),
      T0,
    );
    expect(p.discard).toEqual(["b"]);
  });

  it("보이던 화면이 **보관형으로 닫혀**(cached — windows엔 남아 있다) 버려져도 열기 전 화면으로 돌아간다", () => {
    const p = planKeepalive(
      view({
        windows: { a: { minimized: true }, b: { minimized: true }, c: { minimized: true } },
        focusedId: "a", // 창 엔진 close()가 고른 '다음 창' = 숨은 옛 화면
        cached: ["c"],
        lastUsed: { a: T0, b: T0, c: T0 },
        prevVisible: "c",
        back: "b",
      }),
      T0 + MIN,
    );
    expect(p.discard).toEqual(["c"]);
    expect(p.focus).toBe("b");
    expect(p.show).toBe("b");
  });

  it("돌아갈 화면이 이미 사라졌으면 첫 화면", () => {
    const p = planKeepalive(
      view({ windows: { a: { minimized: true } }, focusedId: "a", prevVisible: "n", back: "gone", lastUsed: { a: T0 } }),
      T0,
    );
    expect(p.focus).toBeNull();
  });

  it("보이는 화면이 바뀌면 떠난 화면이 '앞 화면'이 된다(첫 화면에서 열면 null)", () => {
    const fromA = planKeepalive(
      view({
        windows: { a: { minimized: true }, b: { minimized: false } },
        focusedId: "b",
        prevVisible: "a",
        lastUsed: { a: T0, b: T0 },
      }),
      T0,
    );
    expect(fromA.back).toBe("a");
    const fromHome = planKeepalive(
      view({ windows: { b: { minimized: false } }, focusedId: "b", prevVisible: null, lastUsed: { b: T0 } }),
      T0,
    );
    expect(fromHome.back).toBeNull();
  });
});
