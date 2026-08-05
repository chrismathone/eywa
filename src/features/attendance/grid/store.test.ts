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

describe("합계 구독 — 값이 바뀔 때만, 바뀐 행에게만", () => {
  it("🔴 합계는 **보이는 열이 아니라 그 달 전체**를 센다 — 2주 보기에서 시수가 반토막 나면 안 된다", () => {
    // 열은 7/20 하나만 보이지만 기록은 7/01에도 있다(2주 보기).
    store.setSource([R1], [D2], {
      [K(R1, "2026-07-01")]: { s: "present", u: null },
      [K(R1, "2026-07-20")]: { s: "present", u: 1.5 },
    });
    expect(store.valuesOfRow(R1)).toHaveLength(2);
  });

  it("낙관적 입력이 즉시 합계에 들어간다(서버 왕복 전)", () => {
    const k = K(R1, D1);
    store.setLocal([[k, { s: "present", u: 2 }]]);
    expect(store.valuesOfRow(R1)).toEqual([{ s: "present", u: 2 }]);
  });

  it("지운 칸은 값이 null — 세는 쪽이 건너뛴다(색인엔 남아도 무해)", () => {
    const k = K(R1, D1);
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "present", u: null } });
    store.setLocal([[k, null]]);
    expect(store.valuesOfRow(R1)).toEqual([null]);
  });

  it("한 행을 고치면 그 행 구독자만 깨운다 — 옆 행은 안 다시 그린다", () => {
    const a = vi.fn();
    const b = vi.fn();
    store.subscribeRow(R1)(a);
    store.subscribeRow(R2)(b);
    store.setLocal([[K(R1, D1), { s: "present", u: null }]]);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(store.getRowVersion(R1)).toBe(1);
    expect(store.getRowVersion(R2)).toBe(0);
  });

  it("커서 이동·범위 선택은 합계를 건드리지 않는다(값이 안 바뀌었으니까)", () => {
    const all = vi.fn();
    store.subscribeValues(all);
    store.select({ row: R1, col: D1 }, false);
    store.extend(1, 1);
    store.setBuffer("1");
    expect(all).not.toHaveBeenCalled();
  });

  it("서버가 새 값을 싣고 오면(flush) 합계 구독자를 깨운다", () => {
    const all = vi.fn();
    const row = vi.fn();
    store.subscribeValues(all);
    store.subscribeRow(R1)(row);
    store.setSource([R1, R2], [D1, D2], { [K(R1, D1)]: { s: "absent", u: null } });
    expect(all).not.toHaveBeenCalled(); // 렌더 중엔 조용히
    store.flushSource();
    expect(all).toHaveBeenCalledTimes(1);
    expect(row).toHaveBeenCalledTimes(1);
    store.flushSource(); // 두 번째 flush는 아무 일도 없다(무한 루프 방지)
    expect(all).toHaveBeenCalledTimes(1);
  });

  it("🔴 반을 접어도(보이는 행이 줄어도) 총합은 그대로 — 접기는 표시일 뿐이다", () => {
    const initial = {
      [K(R1, D1)]: { s: "present", u: null },
      [K(R2, D1)]: { s: "present", u: 2 },
    };
    store.setSource([R1, R2], [D1, D2], initial);
    const before = [...store.valuesOfRows()];
    // R2가 속한 반을 접었다 = 보이는 행에서 빠졌다(같은 initial 객체를 그대로 다시 넘긴다).
    store.setSource([R1], [D1, D2], initial);
    expect([...store.valuesOfRows()]).toEqual(before);
    // 반면 명시한 행만 셀 땐 그 행만.
    expect([...store.valuesOfRows([R1])]).toHaveLength(1);
  });

  it("서버 갱신 뒤에도 아직 안 실려온 내 입력은 합계에 남는다", () => {
    const k = K(R1, D2);
    store.setLocal([[k, { s: "present", u: null }]]);
    store.setSource([R1, R2], [D1, D2], { [K(R1, D1)]: { s: "present", u: null } });
    expect(store.valuesOfRow(R1)).toHaveLength(2);
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
