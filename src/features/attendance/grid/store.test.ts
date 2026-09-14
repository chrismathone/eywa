import { beforeEach, describe, expect, it, vi } from "vitest";
import { cellKey, rowKey } from "./model";
import { GridStore } from "./store";
import { countCells } from "./totals";

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

/**
 * 팝오버의 낙관 쓰기 표식(재리뷰 2026-09-11) — 값 동일성으론 빈 칸(null)을 못 가려 '지우기' 실패가 안 돌아왔고,
 * 되돌릴 값을 새로 만들면 파생 표식 `d`가 빠졌다. 칸의 주인(지금 값을 칠한 쓰기) + 칠하기 전 자리로 판정하고,
 * 앞 쓰기가 응답을 기다리던 자리면 그 결과를 따라간다(paint-chain.ts).
 */
describe("낙관 쓰기 표식 — 응답 보정·실패 되돌리기(칸의 주인·사슬)", () => {
  it("🔴 빈 칸을 칠해도('지우기') 실패하면 되돌린다 — 덮개를 벗겨 서버 값을 보인다", () => {
    const k = K(R1, D1);
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "present", u: null } });
    const p = store.paintLocal(k, null);
    expect(store.valueOf(k)).toBeNull();
    expect(store.revertLocal(k, p)).toBe(true);
    expect(store.valueOf(k)).toEqual({ s: "present", u: null });
  });

  it("🔴 파생 칸은 표식 `d`까지 그대로 돌아오고, 그 뒤 서버가 바뀌면 그대로 따라간다", () => {
    const k = K(R1, D1);
    const server = { s: "present", u: null, d: true as const };
    store.setSource([R1, R2], [D1, D2], { [k]: server });
    const p = store.paintLocal(k, { s: "absent", u: null });
    store.revertLocal(k, p);
    expect(store.valueOf(k)).toBe(server);
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "absent", u: null } });
    expect(store.valueOf(k)).toEqual({ s: "absent", u: null });
  });

  it("칠한 뒤 누가 이 칸을 건드렸으면 되돌리지도 보정하지도 않는다", () => {
    const k = K(R1, D1);
    const p = store.paintLocal(k, { s: "absent", u: null });
    store.setLocal([[k, { s: "late", u: null }]]); // 새 입력
    expect(store.revertLocal(k, p)).toBe(false);
    expect(store.correctLocal(k, p, { s: "absent", u: 1.5 })).toBe(false);
    expect(store.valueOf(k)).toEqual({ s: "late", u: null });
  });

  it("칠하기 전에 덮개가 있었으면(서버가 아직 못 따라온 앞 입력) 그 덮개로 돌린다", () => {
    const k = K(R1, D1);
    const earlier = { s: "present", u: 1.5 };
    store.setLocal([[k, earlier]]);
    const p = store.paintLocal(k, { s: "absent", u: null });
    store.revertLocal(k, p);
    expect(store.valueOf(k)).toBe(earlier);
  });

  it("🔴 같은 칸에 연달아 저장하고 둘 다 실패하면 서버 값으로 — 앞이 먼저 실패해도", () => {
    const k = K(R1, D1);
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "present", u: null } });
    const a = store.paintLocal(k, { s: "absent", u: null });
    const b = store.paintLocal(k, { s: "late", u: null }); // 응답 전에 다시 열어 저장
    expect(store.revertLocal(k, a)).toBe(false); // 칸은 이미 b의 것
    expect(store.revertLocal(k, b)).toBe(true);
    expect(store.valueOf(k)).toEqual({ s: "present", u: null }); // 저장된 적 없는 '결석'에 굳지 않는다
  });

  it("🔴 …뒤가 먼저 실패하면 앞 값으로 돌아갔다가, 앞도 실패하면 서버 값으로", () => {
    const k = K(R1, D1);
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "present", u: null } });
    const a = store.paintLocal(k, { s: "absent", u: null });
    const b = store.paintLocal(k, { s: "late", u: null });
    expect(store.revertLocal(k, b)).toBe(true);
    expect(store.valueOf(k)).toEqual({ s: "absent", u: null }); // a는 아직 응답 대기
    expect(store.revertLocal(k, a)).toBe(true); // 칸이 a에게 돌아왔다
    expect(store.valueOf(k)).toEqual({ s: "present", u: null });
  });

  it("🔴 앞 저장이 성공해 보정됐는데 뒤 저장이 실패하면 보정된 값으로 — 보정 전 낙관값에 굳지 않는다", () => {
    const k = K(R1, D1);
    const a = store.paintLocal(k, { s: "present", u: 1.5 }); // 빈 칸 → 자동 시수 낙관값
    const b = store.paintLocal(k, null); // 응답 전에 '지우기'
    expect(store.correctLocal(k, a, { s: "present", u: 1 })).toBe(false); // 서버가 실제로 넣은 값 — 칸은 b의 것
    expect(store.revertLocal(k, b)).toBe(true);
    expect(store.valueOf(k)).toEqual({ s: "present", u: 1 });
  });

  it("…뒤가 먼저 실패하면 앞 낙관값으로 돌아갔다가, 앞의 보정이 오면 그 값으로", () => {
    const k = K(R1, D1);
    const a = store.paintLocal(k, { s: "present", u: 1.5 });
    const b = store.paintLocal(k, null);
    store.revertLocal(k, b);
    expect(store.valueOf(k)).toEqual({ s: "present", u: 1.5 });
    expect(store.correctLocal(k, a, { s: "present", u: 1 })).toBe(true);
    expect(store.valueOf(k)).toEqual({ s: "present", u: 1 });
  });

  it("셋이 겹쳐 가운데가 먼저 실패해도 사슬을 거슬러 간다", () => {
    const k = K(R1, D1);
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "present", u: null } });
    const a = store.paintLocal(k, { s: "absent", u: null });
    const b = store.paintLocal(k, { s: "late", u: null });
    const c = store.paintLocal(k, { s: "early", u: null });
    expect(store.revertLocal(k, b)).toBe(false);
    expect(store.revertLocal(k, c)).toBe(true);
    expect(store.valueOf(k)).toEqual({ s: "absent", u: null }); // b를 건너 a(응답 대기)의 값
    expect(store.revertLocal(k, a)).toBe(true);
    expect(store.valueOf(k)).toEqual({ s: "present", u: null });
  });
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

describe("setLocalIf — 늦은 응답이 새 입력을 덮지 않는다(팝오버·단건·범위 응답 보정)", () => {
  it("칠해 둔 그 값이 그대로면 바꾼다", () => {
    const k = K(R1, D1);
    const shown = { s: "present", u: 1.5 };
    store.setLocal([[k, shown]]);
    expect(store.setLocalIf(k, shown, { s: "present", u: null })).toBe(true);
    expect(store.valueOf(k)).toEqual({ s: "present", u: null });
  });

  it("🔴 그 사이 같은 칸을 또 고쳤으면 손대지 않는다 — 같은 값을 다시 쳐도(새 객체) 새 입력이 이긴다", () => {
    const k = K(R1, D1);
    const shown = { s: "present", u: 1.5 };
    store.setLocal([[k, shown]]);
    store.setLocal([[k, { s: "present", u: 2 }]]); // 팝오버를 닫고 곧바로 '2'를 쳤다
    expect(store.setLocalIf(k, shown, { s: "present", u: 1.5 })).toBe(false);
    expect(store.valueOf(k)).toEqual({ s: "present", u: 2 });
    store.setLocal([[k, { s: "present", u: 1.5 }]]); // 같은 값을 다시 친 새 입력
    expect(store.setLocalIf(k, shown, { s: "present", u: null })).toBe(false);
    expect(store.valueOf(k)).toEqual({ s: "present", u: 1.5 });
  });

  it("서버가 따라잡아 덮개가 벗겨졌으면(서버 값이 진실) 손대지 않는다", () => {
    const k = K(R1, D1);
    const shown = { s: "present", u: 1.5 };
    store.setLocal([[k, shown]]);
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "present", u: 1.5 } });
    expect(store.setLocalIf(k, shown, { s: "present", u: null })).toBe(false);
    expect(store.valueOf(k)).toEqual({ s: "present", u: 1.5 });
  });

  it("빈 칸(null)은 동일성으로 가릴 수 없다 — 판정하지 않는다", () => {
    expect(store.setLocalIf(K(R1, D1), null, { s: "present", u: null })).toBe(false);
    expect(store.valueOf(K(R1, D1))).toBeNull();
  });
});

describe("파생 칸(d) — 상태·시수가 같아도 기록 칸과 다른 사실", () => {
  it("🔴 파생 칸에 같은 값을 기록하면 스냅샷도 바뀐다 — 옛 d가 남으면 팝오버가 '행 없음'으로 오판한다", () => {
    const k = K(R1, D1);
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "present", u: null, d: true } });
    store.subscribe(k)(() => {});
    expect(store.snapshot(k).value).toEqual({ s: "present", u: null, d: true });
    store.setLocal([[k, { s: "present", u: null }]]); // 명시 '1'을 쳤다 = 이제 행이 있다
    expect(store.snapshot(k).value).toEqual({ s: "present", u: null });
  });

  it("🔴 서버가 아직 파생 값이면(내 저장 전에 시작한 조회) 내 기록 덮개를 안 벗긴다 — 기록을 싣고 오면 벗긴다", () => {
    const k = K(R1, D1);
    store.setLocal([[k, { s: "present", u: null }]]);
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "present", u: null, d: true } });
    expect(store.valueOf(k)).toEqual({ s: "present", u: null }); // 덮개 유지(d 없음)
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "present", u: null } }); // 기록이 실려 왔다
    store.setSource([R1, R2], [D1, D2], { [k]: { s: "absent", u: null } }); // 벗겨졌으니 이후 서버 값을 따라간다
    expect(store.valueOf(k)).toEqual({ s: "absent", u: null });
  });
});

/**
 * 🔴 원장 2026-09-14 — 빗금 칸에 친 값은 다른 선생님 교시에 상태만 옮기고, 이 표 칸엔 **빗금 위 흐린 값**으로만 보인다
 *    (합계 밖). 낙관값은 서버와 같아지면 벗겨져야 한다 — 안 벗겨지면 2026-09-11 '새로고침 롤백'이 이 칸에서 재발한다.
 */
describe("빗금 표시 값(g) — 합계 밖 · 상태가 따라잡으면 벗긴다", () => {
  const G = (s: string, u: number | null = null, p: number | null = null) => ({ s, u, g: true as const, p });

  it("🔴 합계에 안 든다 — 그 교시를 맡은 선생님 표와 이중 집계 금지", () => {
    store.setSource([R1, R2], [D1, D2], { [K(R1, D1)]: G("present", 2, 2), [K(R1, D2)]: { s: "present", u: null } });
    expect(countCells(store.valuesOfRow(R1))).toMatchObject({ recorded: 1, present: 1, units: 1 });
  });

  it("🔴 서버 상태가 따라잡으면 벗긴다 — 시수는 서버 값이 진실(그 사이 남이 고쳤어도)", () => {
    const k = K(R1, D1);
    store.setSource([R1, R2], [D1, D2], { [k]: G("absent", null, 2) });
    store.setLocal([[k, G("present", 2, 2)]]);
    store.setSource([R1, R2], [D1, D2], { [k]: G("present", 1.5, 1.5) });
    expect(store.valueOf(k)).toEqual(G("present", 1.5, 1.5));
    store.setSource([R1, R2], [D1, D2], { [k]: G("absent", null, 1.5) }); // 벗겨졌으니 그대로 따라간다
    expect(store.valueOf(k)).toEqual(G("absent", null, 1.5));
  });

  it("내 저장 전에 시작한 조회(옛 상태)가 오면 덮개를 유지한다 — 깜빡임 금지", () => {
    const k = K(R1, D1);
    store.setSource([R1, R2], [D1, D2], { [k]: G("absent", null, 2) });
    store.setLocal([[k, G("present", 2, 2)]]);
    store.setSource([R1, R2], [D1, D2], { [k]: G("absent", null, 2) });
    expect(store.valueOf(k)).toEqual(G("present", 2, 2));
  });

  it("🔴 칸의 성격이 바뀌면(한쪽만 g) 벗긴다 — 빗금으로 칠했는데 서버가 제 몫 값을 싣고 왔다 · 그 반대", () => {
    const k1 = K(R1, D1);
    store.setLocal([[k1, G("present")]]);
    store.setSource([R1, R2], [D1, D2], { [k1]: { s: "present", u: null } });
    store.setSource([R1, R2], [D1, D2], { [k1]: { s: "absent", u: null } });
    expect(store.valueOf(k1)).toEqual({ s: "absent", u: null });
    const k2 = K(R2, D1);
    store.setLocal([[k2, { s: "present", u: null }]]);
    store.setSource([R1, R2], [D1, D2], { [k2]: G("absent") });
    expect(store.valueOf(k2)).toEqual(G("absent"));
  });

  it("dropLocalIf — 칠한 **그 값 그 객체**일 때만 벗긴다(늦은 응답이 새 입력을 지우지 않게)", () => {
    const k = K(R1, D1);
    store.setSource([R1, R2], [D1, D2], { [k]: G("absent") });
    const shown = G("present");
    store.setLocal([[k, shown]]);
    store.setLocal([[k, G("late")]]); // 그 사이 새 입력
    expect(store.dropLocalIf(k, shown)).toBe(false);
    expect(store.valueOf(k)).toEqual(G("late"));
    const latest = store.valueOf(k);
    expect(store.dropLocalIf(k, latest)).toBe(true);
    expect(store.valueOf(k)).toEqual(G("absent"));
    expect(store.dropLocalIf(k, null)).toBe(false);
  });

  it("스냅샷은 g를 사실로 본다 — 같은 숫자여도 제 몫 값과 빗금 값은 칸이 다르게 그린다", () => {
    const k = K(R1, D1);
    store.setSource([R1, R2], [D1, D2], { [k]: G("present") });
    store.subscribe(k)(() => {});
    expect(store.snapshot(k).value).toEqual(G("present"));
    store.setLocal([[k, { s: "present", u: null }]]);
    expect(store.snapshot(k).value).toEqual({ s: "present", u: null });
  });
});

describe("활성 칸은 보이는 행에만", () => {
  it("🔴 좌표에 없는 행은 잡지 않는다 — 안 보이는 칸에 키 입력이 저장된다", () => {
    // 검색·반 접기로 R2가 화면에서 빠진 상태.
    store.setSource([R1], [D1, D2], {});
    store.select({ row: R2, col: D1 }, false);
    expect(store.active).toBeNull();
    store.select({ row: R1, col: D1 }, false);
    expect(store.active).toEqual({ row: R1, col: D1 });
    // 범위 확장도 마찬가지 — 안 보이는 행으로 사각형을 늘리지 않는다.
    store.select({ row: R2, col: D2 }, true);
    expect(store.focus).toBeNull();
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
