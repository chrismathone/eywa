import { beforeEach, describe, expect, it, vi } from "vitest";
import { cellKey, rowKey } from "./model";
import { GridStore } from "./store";

const C = "11111111-1111-1111-1111-111111111111";
const S1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const R1 = rowKey(C, S1);
const R2 = rowKey(C, S2);
const D1 = "2026-07-01";
const D2 = "2026-07-02";
const K = (r: string, d: string) => cellKey(r, d);

let store: GridStore;
beforeEach(() => {
  store = new GridStore();
  store.setSource([R1, R2], [D1, D2], {});
});

describe("낙관적 덮개 vs 서버 갱신", () => {
  it("🔴 서버가 아직 못 따라왔으면 내 값을 유지한다 — 통째로 벗기면 방금 친 칸이 깜빡인다", () => {
    store.setLocal([[K(R1, D1), { s: "present", u: null }]]);
    // 내 입력 **전에** 시작된 조회가 옛 값(빈 칸)을 싣고 도착한 상황.
    store.setSource([R1, R2], [D1, D2], {});
    expect(store.valueOf(K(R1, D1))).toEqual({ s: "present", u: null });
  });

  it("서버가 같은 값을 들고 오면 덮개를 벗긴다(따라잡음)", () => {
    const k = K(R1, D1);
    store.setLocal([[k, { s: "present", u: null }]]);
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "present", u: null } });
    expect(store.valueOf(k)).toEqual({ s: "present", u: null });
    // 덮개가 벗겨졌으므로 이후 서버 값이 바뀌면 그대로 따라간다.
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "absent", u: null } });
    expect(store.valueOf(k)).toEqual({ s: "absent", u: null });
  });

  it("시수까지 같아야 따라잡은 것으로 본다", () => {
    const k = K(R1, D1);
    store.setLocal([[k, { s: "present", u: 1.5 }]]);
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "present", u: null } }); // 시수가 다르다
    expect(store.valueOf(k)).toEqual({ s: "present", u: 1.5 });
  });

  it("같은 initial 객체가 다시 와도 아무 일도 없다", () => {
    const initial = { [K(R1, D1)]: { s: "present", u: null } };
    store.setSource([R1], [D1], initial);
    store.setLocal([[K(R1, D1), null]]);
    store.setSource([R1], [D1], initial);
    expect(store.valueOf(K(R1, D1))).toBeNull();
  });
});

describe("칸별 구독 — 바뀐 칸에게만 알린다", () => {
  it("🔴 활성 칸을 옮기면 관련된 칸만 다시 그린다(표 전체가 아니라)", () => {
    const hits: Record<string, number> = {};
    for (const k of [K(R1, D1), K(R1, D2), K(R2, D1), K(R2, D2)]) {
      hits[k] = 0;
      store.subscribe(k)(() => {
        hits[k]!++;
      });
    }
    store.select({ row: R1, col: D1 }, false);
    expect(hits[K(R1, D1)]).toBe(1);
    expect(hits[K(R2, D2)]).toBe(0); // 무관한 칸은 건드리지 않는다

    store.move(0, 1); // R1 → R2
    expect(hits[K(R1, D1)]).toBe(2); // 떠난 칸
    expect(hits[K(R2, D1)]).toBe(1); // 새 칸
    expect(hits[K(R1, D2)]).toBe(0); // 여전히 무관
  });

  it("스냅샷은 내용이 같으면 같은 객체 — 아니면 무한 리렌더가 난다", () => {
    const k = K(R1, D1);
    store.subscribe(k)(() => {});
    expect(store.snapshot(k)).toBe(store.snapshot(k));
    store.select({ row: R1, col: D1 }, false);
    const a = store.snapshot(k);
    expect(a.active).toBe(true);
    expect(store.snapshot(k)).toBe(a);
  });

  it("구독이 다 끊기면 캐시도 버린다(메모리 누수 방지)", () => {
    const k = K(R1, D1);
    const off = store.subscribe(k)(() => {});
    store.snapshot(k);
    off();
    const cb = vi.fn();
    store.subscribe(k)(cb);
    store.setLocal([[k, { s: "present", u: null }]]);
    expect(cb).toHaveBeenCalled();
  });
});

describe("범위 선택", () => {
  it("Shift 이동은 anchor를 두고 focus만 넓힌다", () => {
    store.select({ row: R1, col: D1 }, false);
    store.extend(1, 1);
    expect(store.selected.size).toBe(4);
    expect(store.active).toEqual({ row: R1, col: D1 });
  });

  it("일반 이동은 범위를 푼다", () => {
    store.select({ row: R1, col: D1 }, false);
    store.extend(1, 1);
    store.move(0, 1);
    expect(store.selected.size).toBe(1);
  });

  it("Escape로 전부 해제하면 선택이 빈다", () => {
    store.select({ row: R1, col: D1 }, false);
    store.clearUi();
    expect(store.active).toBeNull();
    expect(store.selected.size).toBe(0);
  });
});
