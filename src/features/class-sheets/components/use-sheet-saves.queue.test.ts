import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SheetSaveStore } from "./use-sheet-saves";
import { buildSaveKey, type PlanFieldPatch } from "../lib/save-keys";

// 적대검증 2026-07-29가 실행 재현한 저장 큐 결함 3건을 잠근다.
// 전부 "강사가 친 내용이 조용히 사라지는" 계열이라 회귀하면 곧바로 데이터 손실이다.

type SendFn = (patches: PlanFieldPatch[]) => Promise<
  | { ok: true; results: { saveKey: string; status: "applied"; serverValue: string | null; clientRev: number }[] }
  | { ok: false; error: string }
>;

const applied = (patches: PlanFieldPatch[]) =>
  ({
    ok: true as const,
    results: patches.map((p) => ({
      saveKey: p.saveKey,
      status: "applied" as const,
      serverValue: p.newValue,
      clientRev: p.clientRev,
    })),
  });

const makeStore = (send: SendFn) => new SheetSaveStore(send as never, null, true);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("전송 중 입력이 큐에 갇히지 않는다", () => {
  it("🔴 in-flight 중 발화한 디바운스를 버리면 마지막 입력이 영영 안 나간다", async () => {
    const sent: string[][] = [];
    const gate: { release?: () => void } = {}; // 객체 프로퍼티 — 클로저 대입을 TS가 좁히지 못하는 문제 회피
    let first = true;
    const store = makeStore(async (patches) => {
      sent.push(patches.map((p) => p.field));
      if (first) {
        first = false; // 1회차만 응답을 붙잡아 in-flight 구간을 만든다(2회차는 즉시 응답)
        await new Promise<void>((r) => {
          gate.release = r;
        });
      }
      return applied(patches);
    });

    store.edit("L1", "textbook", "교재");
    await vi.advanceTimersByTimeAsync(900); // 전송 시작(응답 대기)
    store.edit("L1", "progress", "진도"); // 전송 중 다른 셀 입력
    await vi.advanceTimersByTimeAsync(900); // 디바운스 발화 — 예전엔 여기서 조용히 버려졌다
    gate.release?.();
    await vi.advanceTimersByTimeAsync(6000);

    expect(sent).toEqual([["textbook"], ["progress"]]);
    expect(store.pendingCount).toBe(0);
  });
});

describe("가짜 충돌이 나지 않는다", () => {
  it("🔴 canonical은 '보낸 값'이어야 한다 — 최신 draft로 덮으면 혼자 써도 충돌이 뜬다", async () => {
    const expectedSeen: (string | null)[] = [];
    const gate: { release?: () => void } = {};
    let first = true;
    const store = makeStore(async (patches) => {
      expectedSeen.push(patches[0]!.expectedValue);
      if (first) {
        first = false;
        await new Promise<void>((r) => {
          gate.release = r;
        });
      }
      return applied(patches);
    });

    store.edit("L1", "progress", "AB");
    await vi.advanceTimersByTimeAsync(900); // "AB" 전송 시작
    store.edit("L1", "progress", "ABC"); // 전송 중 이어 침
    gate.release?.();
    await vi.advanceTimersByTimeAsync(6000);

    // 2회차 전송의 expectedValue = 서버가 실제로 저장한 "AB"여야 한다("ABC"면 CAS 0행 → 가짜 충돌)
    expect(expectedSeen).toEqual([null, "AB"]);
    expect(store.conflictCount).toBe(0);
  });
});

describe("확정 순간 끝 공백이 사라지지 않는다", () => {
  it("🔴 'Unit 5 ' 저장 확정 후에도 화면값은 원문 — 안 그러면 이어 친 단어가 붙는다", async () => {
    const store = makeStore(async (patches) => applied(patches));
    store.edit("L1", "progress", "Unit 5 ");
    await vi.advanceTimersByTimeAsync(3000); // 저장 확정

    const cell = store.cellState(buildSaveKey("L1", "progress"));
    expect(cell?.value).toBe("Unit 5 ");
    expect(cell?.dirty).toBe(false);
  });

  it("서버가 다른 값을 알려주면 화면은 서버 값을 따른다(원문 고집 금지)", async () => {
    const store = makeStore(async (patches) => applied(patches));
    store.edit("L1", "progress", "AB ");
    await vi.advanceTimersByTimeAsync(3000);
    store.seed("L1", "progress", "ZZ"); // 서버 재조회로 canonical 갱신

    expect(store.cellState(buildSaveKey("L1", "progress"))?.value).toBe("ZZ");
  });
});
